import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { WebContents } from 'electron'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as ipcWebContents from '../ipc-webcontents'
import { killTreeAndWait } from '../build-run/kill-tree'
import {
  ActionsLocalRunLogStream,
  ActionsLocalRunPhase,
  IActionsLocalRunPlan,
} from '../../lib/actions-local-run/types'
import {
  buildActArgs,
  buildSecretFileContents,
} from '../../lib/actions-local-run/command'

/**
 * Main-process executor for the Local GitHub Actions runner.
 *
 * The renderer resolves a fully-formed {@link IActionsLocalRunPlan} (chosen
 * workflow, event, job, inputs, secrets and the resolved `act` path) and hands
 * it here. This class owns the single `act` spawn, line-buffered log streaming,
 * cancellation and process-tree teardown, and the lifecycle of the temporary
 * secrets file (written 0600, deleted on completion, never logged). Living in
 * the main process — like Build & Run — keeps long-lived children from being
 * orphaned by a renderer reload.
 */

const RunTerminationDeadlineMilliseconds = 15_000

interface IActiveRun {
  readonly plan: IActionsLocalRunPlan
  readonly sender: WebContents
  seq: number
  cancelled: boolean
  child: ChildProcessWithoutNullStreams | null
  secretFilePath: string | null
  secretDir: string | null
  completion: Promise<void>
  cancellation: Promise<void> | null
  cleanup: () => void
}

export class ActionsLocalRunner {
  private readonly runs = new Map<string, IActiveRun>()

  /**
   * Launch a plan. Returns immediately once the run is registered; execution
   * proceeds in the background and streams to the invoking renderer. A run id
   * already in flight is ignored (idempotent start).
   */
  public start(plan: IActionsLocalRunPlan, sender: WebContents): void {
    if (this.runs.has(plan.runId)) {
      return
    }

    const run: IActiveRun = {
      plan,
      sender,
      seq: 0,
      cancelled: false,
      child: null,
      secretFilePath: null,
      secretDir: null,
      completion: Promise.resolve(),
      cancellation: null,
      cleanup: () => {},
    }
    this.runs.set(plan.runId, run)

    const cancelSafely = () => {
      void this.cancel(plan.runId).catch(error =>
        log.error(
          '[actions-local-run] failed to cancel an owned run',
          error instanceof Error ? error : undefined
        )
      )
    }
    sender.on('did-start-navigation', cancelSafely)
    sender.once('destroyed', cancelSafely)
    run.cleanup = () => {
      try {
        sender.removeListener('did-start-navigation', cancelSafely)
        sender.removeListener('destroyed', cancelSafely)
      } catch {
        /* sender already gone */
      }
    }

    run.completion = this.execute(run)
  }

  /** Request cancellation of a run; safe for unknown / finished ids. */
  public async cancel(runId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (run === undefined) {
      return
    }
    if (run.cancellation === null) {
      run.cancelled = true
      run.cancellation = this.terminate(run)
    }
    await run.cancellation
    await this.awaitCompletion(run)
  }

  /** Stop and await every live run before application shutdown continues. */
  public async killAll(): Promise<void> {
    await Promise.all([...this.runs.keys()].map(runId => this.cancel(runId)))
  }

  private async terminate(run: IActiveRun): Promise<void> {
    const child = run.child
    if (child?.pid !== undefined) {
      await killTreeAndWait(
        child.pid,
        () => child.exitCode === null && child.signalCode === null
      )
    }
  }

  private async awaitCompletion(run: IActiveRun): Promise<void> {
    let deadline: ReturnType<typeof setTimeout> | null = null
    const timedOut = await Promise.race([
      run.completion.then(
        () => false,
        () => false
      ),
      new Promise<true>(resolve => {
        deadline = setTimeout(
          () => resolve(true),
          RunTerminationDeadlineMilliseconds
        )
      }),
    ])
    if (deadline !== null) {
      clearTimeout(deadline)
    }
    if (timedOut) {
      log.error(
        `[actions-local-run] timed out waiting for run ${run.plan.runId} to close`
      )
    }
  }

  private async execute(run: IActiveRun): Promise<void> {
    try {
      await this.run(run)
    } catch (error) {
      log.error(
        '[actions-local-run] unexpected runner error',
        error instanceof Error ? error : undefined
      )
      this.emitLog(
        run,
        'meta',
        `Unexpected error: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      this.emitState(run, 'failed')
    } finally {
      await this.disposeSecrets(run)
      run.cleanup()
      this.runs.delete(run.plan.runId)
    }
  }

  private async run(run: IActiveRun): Promise<void> {
    // Materialise the secrets file (if any) before assembling the argv.
    let secretFilePath: string | null = null
    if (run.plan.secrets.length > 0) {
      const contents = buildSecretFileContents(run.plan.secrets)
      const dir = await mkdtemp(path.join(os.tmpdir(), 'desktop-act-secrets-'))
      run.secretDir = dir
      secretFilePath = path.join(dir, 'secrets.env')
      await writeFile(secretFilePath, contents, { mode: 0o600 })
      run.secretFilePath = secretFilePath
    }

    if (run.cancelled) {
      this.emitState(run, 'cancelled')
      return
    }

    let args: ReadonlyArray<string>
    try {
      args = buildActArgs({
        workflowRelativePath: run.plan.workflowRelativePath,
        event: run.plan.event,
        job: run.plan.job,
        inputs: run.plan.inputs,
        dryRun: run.plan.dryRun,
        secretFilePath,
      })
    } catch (error) {
      this.emitLog(
        run,
        'meta',
        error instanceof Error ? error.message : String(error)
      )
      this.emitState(run, 'failed')
      return
    }

    const displayArgs = args
      .map(a =>
        secretFilePath !== null && a === secretFilePath ? '<secrets>' : a
      )
      .join(' ')
    this.emitLog(run, 'command', `act ${displayArgs}`)
    this.emitState(run, 'running')

    await new Promise<void>(resolve => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(run.plan.actPath, [...args], {
          cwd: run.plan.repositoryPath,
          env: process.env,
          windowsHide: true,
          shell: false,
          detached: process.platform !== 'win32',
        })
      } catch (error) {
        this.emitLog(
          run,
          'meta',
          `Failed to launch act: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
        this.emitState(run, 'failed')
        resolve()
        return
      }

      run.child = child
      this.emitState(run, 'running', undefined, child.pid)

      const buffers: { stdout: string; stderr: string } = {
        stdout: '',
        stderr: '',
      }
      const onData = (name: 'stdout' | 'stderr') => (chunk: Buffer) => {
        buffers[name] += chunk.toString('utf8').replace(/\r\n/g, '\n')
        let idx = buffers[name].indexOf('\n')
        while (idx !== -1) {
          this.emitLog(run, name, buffers[name].slice(0, idx))
          buffers[name] = buffers[name].slice(idx + 1)
          idx = buffers[name].indexOf('\n')
        }
      }
      child.stdout.on('data', onData('stdout'))
      child.stderr.on('data', onData('stderr'))

      let settled = false
      const done = (code: number, spawnError: boolean) => {
        if (settled) {
          return
        }
        settled = true
        for (const name of ['stdout', 'stderr'] as const) {
          if (buffers[name].length > 0) {
            this.emitLog(run, name, buffers[name])
            buffers[name] = ''
          }
        }
        if (run.child === child) {
          run.child = null
        }
        if (run.cancelled) {
          this.emitState(run, 'cancelled', code)
        } else if (spawnError) {
          this.emitState(run, 'failed', code)
        } else if (code === 0) {
          this.emitState(run, 'succeeded', 0)
        } else {
          this.emitState(run, 'failed', code)
        }
        resolve()
      }

      child.on('error', error => {
        this.emitLog(
          run,
          'meta',
          `act failed to run: ${
            error instanceof Error ? error.message : String(error)
          }. Is act installed and on your PATH?`
        )
        done(-1, true)
      })
      child.on('close', code => done(code ?? -1, false))
    })
  }

  private async disposeSecrets(run: IActiveRun): Promise<void> {
    if (run.secretDir === null) {
      return
    }
    try {
      await rm(run.secretDir, { recursive: true, force: true })
    } catch (error) {
      log.error(
        '[actions-local-run] failed to remove temporary secrets',
        error instanceof Error ? error : undefined
      )
    } finally {
      run.secretDir = null
      run.secretFilePath = null
    }
  }

  private emitLog(
    run: IActiveRun,
    stream: ActionsLocalRunLogStream,
    text: string
  ): void {
    if (run.sender.isDestroyed()) {
      return
    }
    ipcWebContents.send(run.sender, 'actions-local-run-log', {
      runId: run.plan.runId,
      seq: run.seq++,
      stream,
      text,
    })
  }

  private emitState(
    run: IActiveRun,
    phase: ActionsLocalRunPhase,
    exitCode?: number,
    pid?: number
  ): void {
    if (run.sender.isDestroyed()) {
      return
    }
    ipcWebContents.send(run.sender, 'actions-local-run-state', {
      runId: run.plan.runId,
      repositoryId: run.plan.repositoryId,
      phase,
      exitCode,
      pid,
    })
  }
}

/** Process-wide runner singleton wired into the IPC layer and lifecycle. */
export const actionsLocalRunner = new ActionsLocalRunner()
