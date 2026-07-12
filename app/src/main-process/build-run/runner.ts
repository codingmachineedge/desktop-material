import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { WebContents } from 'electron'
import * as path from 'path'
import { pathExists } from '../../lib/path-exists'
import * as ipcWebContents from '../ipc-webcontents'
import {
  BuildRunLogStream,
  BuildRunPhase,
  BuildStageKind,
  IBuildRunPlan,
  ICommand,
} from '../../lib/build-run/types'
import { planRemediation } from '../../lib/build-run/auto-fix'
import { planToolchainInstall } from '../../lib/build-run/toolchain-install'
import { resolveRunEnv } from '../../lib/build-run/resolve-user-path'
import { assertNever } from '../../lib/fatal-error'
import { killTree } from './kill-tree'
import { IElevatedRun, startElevatedRun } from './elevated-runner'

/**
 * Main-process Build & Run executor.
 *
 * The renderer resolves a fully-formed {@link IBuildRunPlan} (detection, env,
 * auto-gitignore) and hands it here; this class owns the sequential stage
 * execution, line-buffered streaming, the bounded auto-fix retry loop,
 * cancellation and process-tree teardown. Nothing here re-inspects the working
 * tree. Progress is pushed to the invoking renderer via `build-run-log` and
 * `build-run-state`; the invoke itself resolves as soon as the run is launched.
 *
 * Living in the main process (rather than the renderer, as git/shell spawns do)
 * is deliberate: a renderer reload must not orphan long-lived children, and the
 * elevated log-tail wants a stable host process.
 */

/** Number of trailing output characters kept for the auto-fix planner. */
const TAIL_CAP = 8000

/** Thrown to unwind a stage when the run was cancelled. */
class CancelledError extends Error {}

/** Thrown when a stage exhausts its remediation budget. */
class StageFailedError extends Error {
  public constructor(public readonly code: number) {
    super(`stage failed with exit code ${code}`)
  }
}

/** The result of running a single command to completion. */
interface IExecResult {
  readonly code: number
  readonly tail: string
  readonly spawnError: boolean
}

/** Book-keeping for one in-flight run. */
interface IActiveRun {
  readonly plan: IBuildRunPlan
  readonly sender: WebContents
  /**
   * The live environment child processes run in. Seeded from the plan, but
   * mutable: after an auto-install the PATH is re-resolved from the registry so
   * the freshly installed toolchain is visible to the re-check and the stages.
   */
  env: Record<string, string>
  seq: number
  cancelled: boolean
  child: ChildProcessWithoutNullStreams | null
  elevated: IElevatedRun | null
  cleanup: () => void
}

function stageToPhase(kind: BuildStageKind): BuildRunPhase {
  switch (kind) {
    case 'install':
      return 'installing'
    case 'build':
      return 'building'
    case 'run':
      return 'running'
    default:
      return assertNever(kind, `Unknown stage kind: ${kind}`)
  }
}

/**
 * Resolve a bare executable name to a concrete path on Windows, honouring
 * PATHEXT so `npm` finds `npm.cmd` without ever falling back to a shell
 * (`shell: false` is a hard requirement). No-op on POSIX and for paths that are
 * already qualified.
 */
async function resolveExecutable(
  exe: string,
  env: Record<string, string>
): Promise<string> {
  if (process.platform !== 'win32') {
    return exe
  }
  if (exe.includes('/') || exe.includes('\\') || path.isAbsolute(exe)) {
    return exe
  }
  const pathext = (env.PATHEXT ?? env.Pathext ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
  const dirs = (env.Path ?? env.PATH ?? '').split(';').filter(Boolean)
  const lower = exe.toLowerCase()
  const hasKnownExt = pathext.some(ext => lower.endsWith(ext.toLowerCase()))
  for (const dir of dirs) {
    if (hasKnownExt) {
      const candidate = path.join(dir, exe)
      if (await pathExists(candidate)) {
        return candidate
      }
      continue
    }
    for (const ext of pathext) {
      const candidate = path.join(dir, exe + ext)
      if (await pathExists(candidate)) {
        return candidate
      }
    }
  }
  return exe
}

export class BuildRunner {
  private readonly runs = new Map<string, IActiveRun>()

  /**
   * Launch a plan. Returns immediately once the run is registered; execution
   * proceeds in the background and streams to the invoking renderer. A run id
   * already in flight is ignored (idempotent start).
   */
  public start(plan: IBuildRunPlan, sender: WebContents): void {
    if (this.runs.has(plan.runId)) {
      return
    }

    const run: IActiveRun = {
      plan,
      sender,
      env: { ...plan.env },
      seq: 0,
      cancelled: false,
      child: null,
      elevated: null,
      cleanup: () => {},
    }
    this.runs.set(plan.runId, run)

    // A renderer reload or teardown must not orphan live children.
    const onNavigate = () => this.cancel(plan.runId)
    const onDestroyed = () => this.cancel(plan.runId)
    sender.on('did-start-navigation', onNavigate)
    sender.once('destroyed', onDestroyed)
    run.cleanup = () => {
      try {
        sender.removeListener('did-start-navigation', onNavigate)
        sender.removeListener('destroyed', onDestroyed)
      } catch {
        /* sender already gone */
      }
    }

    void this.execute(run)
  }

  /** Request cancellation of a run; safe to call for unknown / finished ids. */
  public async cancel(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (run === undefined || run.cancelled) {
      return
    }
    run.cancelled = true
    if (run.elevated !== null) {
      run.elevated.cancel()
    } else if (run.child?.pid !== undefined) {
      killTree(run.child.pid)
    }
  }

  /** Kill every live run. Wired to `app.on('will-quit')`. */
  public killAll(): void {
    for (const run of this.runs.values()) {
      run.cancelled = true
      if (run.elevated !== null) {
        run.elevated.cancel()
      } else if (run.child?.pid !== undefined) {
        killTree(run.child.pid)
      }
    }
  }

  private async execute(run: IActiveRun): Promise<void> {
    try {
      if (run.plan.elevated) {
        await this.runElevated(run)
      } else {
        await this.runNonElevated(run)
      }
    } catch (err) {
      if (err instanceof CancelledError) {
        this.emitState(run, 'cancelled')
      } else if (err instanceof StageFailedError) {
        this.emitState(run, 'failed', err.code)
      } else {
        log.error(
          '[build-run] unexpected runner error',
          err instanceof Error ? err : undefined
        )
        this.emitLog(
          run,
          'toolchain',
          'meta',
          `Unexpected error: ${
            err instanceof Error ? err.message : String(err)
          }`
        )
        this.emitState(run, 'failed')
      }
    } finally {
      run.cleanup()
      this.runs.delete(run.plan.runId)
    }
  }

  private async runNonElevated(run: IActiveRun): Promise<void> {
    const toolchainOk = await this.runToolchain(run)
    if (!toolchainOk) {
      this.emitState(run, 'failed')
      return
    }

    for (const stage of run.plan.stages) {
      if (run.cancelled) {
        throw new CancelledError()
      }
      this.emitState(run, stageToPhase(stage.kind))
      for (const command of stage.commands) {
        const onSpawn =
          stage.kind === 'run'
            ? (pid: number | undefined) =>
                this.emitState(run, 'running', undefined, pid)
            : undefined
        await this.runStageCommand(run, stage.kind, command, onSpawn)
      }
    }

    this.emitState(run, 'succeeded', 0)
  }

  private async runElevated(run: IActiveRun): Promise<void> {
    const elevated = startElevatedRun(run.plan, (stage, stream, text) => {
      if (stream === 'command' && stage !== 'toolchain') {
        this.emitState(run, stageToPhase(stage))
      }
      this.emitLog(run, stage, stream, text)
    })
    run.elevated = elevated

    const result = await elevated.whenDone
    if (result.cancelled || run.cancelled) {
      this.emitState(run, 'cancelled', result.code)
    } else if (result.code === 0) {
      this.emitState(run, 'succeeded', 0)
    } else {
      this.emitState(run, 'failed', result.code)
    }
  }

  /**
   * Ensure the toolchain is available before any stage runs.
   *
   * Runs the cheap probe; on failure, if the plan opted into auto-install, it
   * installs the missing tool (winget behind a single UAC prompt, or corepack),
   * refreshes PATH from the registry, and re-checks exactly once. Returns false
   * only when the toolchain is still missing after that, having emitted the
   * profile's hint.
   */
  private async runToolchain(run: IActiveRun): Promise<boolean> {
    if (await this.probeToolchain(run)) {
      return true
    }

    if (run.plan.autoInstall) {
      const installed = await this.autoInstallToolchain(run)
      if (run.cancelled) {
        throw new CancelledError()
      }
      if (installed) {
        // Re-resolve PATH from the registry so a just-installed tool is found.
        run.env = resolveRunEnv(run.env)
        this.emitLog(
          run,
          'toolchain',
          'meta',
          'Refreshed PATH — re-checking the toolchain…'
        )
        if (await this.probeToolchain(run)) {
          return true
        }
      }
    }

    this.emitLog(run, 'toolchain', 'meta', run.plan.toolchainCheck.missingHint)
    return false
  }

  /** Run the toolchain probe once; true when the tool ran successfully. */
  private async probeToolchain(run: IActiveRun): Promise<boolean> {
    const check = run.plan.toolchainCheck
    this.emitLog(run, 'toolchain', 'command', check.cmd.label)
    const res = await this.exec(run, 'toolchain', check.cmd)
    if (run.cancelled) {
      throw new CancelledError()
    }
    return !res.spawnError && res.code === 0
  }

  /**
   * Install the missing toolchain from the pure {@link planToolchainInstall}
   * mapping. Elevated steps (winget) are batched into a single UAC prompt via
   * the elevated runner; non-elevated steps (corepack) run inline. Returns true
   * only when every step succeeded.
   */
  private async autoInstallToolchain(run: IActiveRun): Promise<boolean> {
    const installPlan = planToolchainInstall(
      run.plan.ecosystem,
      run.plan.toolchainCheck.cmd.exe,
      process.platform
    )
    if (installPlan === null || installPlan.steps.length === 0) {
      return false
    }

    const elevatedSteps = installPlan.steps.filter(s => s.needsElevation)
    const localSteps = installPlan.steps.filter(s => !s.needsElevation)

    // Elevated batch first (a just-installed SDK enables the local steps).
    if (elevatedSteps.length > 0) {
      for (const step of elevatedSteps) {
        this.emitLog(run, 'toolchain', 'meta', `Installing ${step.toolLabel}…`)
      }
      const ok = await this.runElevatedInstall(
        run,
        elevatedSteps.map(s => s.command)
      )
      if (!ok || run.cancelled) {
        return false
      }
    }

    for (const step of localSteps) {
      this.emitLog(run, 'toolchain', 'meta', `Installing ${step.toolLabel}…`)
      this.emitLog(run, 'toolchain', 'command', step.command.label)
      const res = await this.exec(run, 'toolchain', step.command)
      if (run.cancelled || res.spawnError || res.code !== 0) {
        return false
      }
    }

    return true
  }

  /**
   * Run install commands elevated behind a single UAC prompt, reusing the
   * elevated runner's temp-dir log tail. Resolves true on a clean (code 0,
   * non-cancelled) completion.
   */
  private runElevatedInstall(
    run: IActiveRun,
    commands: ReadonlyArray<ICommand>
  ): Promise<boolean> {
    const installPlan: IBuildRunPlan = {
      ...run.plan,
      elevated: true,
      env: run.env,
      stages: [{ kind: 'install', commands }],
    }
    return new Promise<boolean>(resolve => {
      const elevated = startElevatedRun(installPlan, (_stage, stream, text) =>
        this.emitLog(run, 'toolchain', stream, text)
      )
      run.elevated = elevated
      elevated.whenDone.then(
        result => {
          run.elevated = null
          resolve(!result.cancelled && result.code === 0)
        },
        () => {
          run.elevated = null
          resolve(false)
        }
      )
    })
  }

  /**
   * Run one stage command, applying the bounded output-driven auto-fix loop.
   * The loop is naturally capped: {@link planRemediation} stops proposing fixes
   * once the per-stage attempt budget is exhausted.
   */
  private async runStageCommand(
    run: IActiveRun,
    stage: BuildStageKind,
    command: ICommand,
    onSpawn?: (pid: number | undefined) => void
  ): Promise<void> {
    let current = command
    let attempt = 0

    for (;;) {
      this.emitLog(run, stage, 'command', current.label)
      const res = await this.exec(run, stage, current, onSpawn)
      if (run.cancelled) {
        throw new CancelledError()
      }
      if (res.code === 0) {
        return
      }

      const remediation = planRemediation(
        stage,
        run.plan.ecosystem,
        res.tail,
        attempt,
        run.plan.probeFlags
      )
      if (remediation === null) {
        if (res.spawnError) {
          this.emitLog(
            run,
            'toolchain',
            'meta',
            run.plan.toolchainCheck.missingHint
          )
        }
        throw new StageFailedError(res.code)
      }

      attempt++
      this.emitLog(run, stage, 'meta', remediation.note)
      if (remediation.replacesStage) {
        current = remediation.command
      } else {
        // Run the remediation as a pre-step, then re-run the original command.
        this.emitLog(run, stage, 'command', remediation.command.label)
        await this.exec(run, stage, remediation.command)
        if (run.cancelled) {
          throw new CancelledError()
        }
      }
    }
  }

  /** Spawn a single command, streaming line-buffered output; resolves on exit. */
  private async exec(
    run: IActiveRun,
    stage: BuildStageKind | 'toolchain',
    command: ICommand,
    onSpawn?: (pid: number | undefined) => void
  ): Promise<IExecResult> {
    const exe = await resolveExecutable(command.exe, run.env)

    return new Promise<IExecResult>(resolve => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(exe, [...command.args], {
          cwd: run.plan.cwd,
          env: run.env,
          windowsHide: true,
          shell: false,
        })
      } catch (err) {
        resolve({
          code: -1,
          tail: err instanceof Error ? err.message : String(err),
          spawnError: true,
        })
        return
      }

      run.child = child
      if (onSpawn !== undefined) {
        onSpawn(child.pid)
      }

      let tail = ''
      const appendTail = (text: string) => {
        tail = (tail + text).slice(-TAIL_CAP)
      }

      const buffers: { stdout: string; stderr: string } = {
        stdout: '',
        stderr: '',
      }
      const onData = (name: 'stdout' | 'stderr') => (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        appendTail(text)
        buffers[name] += text.replace(/\r\n/g, '\n')
        let idx = buffers[name].indexOf('\n')
        while (idx !== -1) {
          const line = buffers[name].slice(0, idx)
          buffers[name] = buffers[name].slice(idx + 1)
          this.emitLog(run, stage, name, line)
          idx = buffers[name].indexOf('\n')
        }
      }
      child.stdout.on('data', onData('stdout'))
      child.stderr.on('data', onData('stderr'))

      let spawnError = false
      let settled = false
      const done = (code: number) => {
        if (settled) {
          return
        }
        settled = true
        for (const name of ['stdout', 'stderr'] as const) {
          if (buffers[name].length > 0) {
            this.emitLog(run, stage, name, buffers[name])
            buffers[name] = ''
          }
        }
        if (run.child === child) {
          run.child = null
        }
        resolve({ code, tail, spawnError })
      }

      child.on('error', err => {
        spawnError = true
        const message = err instanceof Error ? err.message : String(err)
        appendTail(message)
        this.emitLog(
          run,
          stage,
          'meta',
          `Failed to run ${command.label}: ${message}`
        )
        done(-1)
      })
      child.on('close', code => done(code ?? -1))
    })
  }

  private emitLog(
    run: IActiveRun,
    stage: BuildStageKind | 'toolchain',
    stream: BuildRunLogStream,
    text: string
  ): void {
    if (run.sender.isDestroyed()) {
      return
    }
    ipcWebContents.send(run.sender, 'build-run-log', {
      runId: run.plan.runId,
      seq: run.seq++,
      stage,
      stream,
      text,
    })
  }

  private emitState(
    run: IActiveRun,
    phase: BuildRunPhase,
    exitCode?: number,
    pid?: number
  ): void {
    if (run.sender.isDestroyed()) {
      return
    }
    ipcWebContents.send(run.sender, 'build-run-state', {
      runId: run.plan.runId,
      repositoryId: run.plan.repositoryId,
      phase,
      exitCode,
      pid,
    })
  }
}

/** The process-wide runner singleton wired into the IPC layer and lifecycle. */
export const buildRunner = new BuildRunner()
