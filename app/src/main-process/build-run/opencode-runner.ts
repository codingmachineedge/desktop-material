import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { WebContents } from 'electron'
import * as ipcMain from '../ipc-main'
import * as ipcWebContents from '../ipc-webcontents'
import { BuildRunLogStream } from '../../lib/build-run/types'
import { resolveRunEnv } from '../../lib/build-run/resolve-user-path'
import {
  IOpencodeInstallResult,
  IOpencodeRunResult,
  IOpencodeStatus,
  buildOpencodeFixPrompt,
  buildOpencodeRunArgs,
  buildOpencodeUserPrompt,
  ensureOpencodeRepoConfig,
} from '../../lib/build-run/opencode'
import {
  IOpencodeInstallPlan,
  planOpencodeInstall,
} from '../../lib/build-run/opencode-install'
import { batchSpawnSpec, resolveExecutable } from './runner'
import { killTreeAndWait } from './kill-tree'

/**
 * Main-process launcher for the opencode AI coding agent CLI.
 *
 * This is a sibling of the `BuildRunner` that owns the same spawn discipline —
 * `resolveExecutable` + `spawn(shell:false)`, Windows batch-shim wrapping via
 * `batchSpawnSpec`, and process-tree teardown — for the "Fix with opencode"
 * flow. The natural-language fix prompt is NEVER an argv element: the argv from
 * {@link buildOpencodeRunArgs} is metacharacter-free (so it survives the
 * `opencode.cmd` shim), and the prompt is written to the child's stdin. The
 * caller must judge success by re-running Build & Run — `opencode run` is known
 * to exit 0 even when its session errored, so exit code is not trusted here.
 */

/** Trailing characters of detection output kept for parsing. */
const DETECT_OUTPUT_CAP = 8000

/** A line sink for streamed opencode output. */
type OnLog = (stream: BuildRunLogStream, text: string) => void

/** Parameters for a single opencode fix run (prompt already composed). */
export interface IOpencodeFixRun {
  /** Git repository root — where opencode.json is ensured. */
  readonly repoPath: string
  /** Working directory the agent runs in (spawn cwd and `--dir`). */
  readonly cwd: string
  /** Launch in `--auto` (auto-approve) mode, scoped to the repository. */
  readonly autoApprove: boolean
  /** The fix instruction, fed to the child over stdin. */
  readonly prompt: string
  readonly model?: string
}

/** A resolved spawn spec, or a refusal message from the batch-shim guard. */
type SpawnResolution =
  | { readonly exe: string; readonly args: ReadonlyArray<string> }
  | { readonly error: string }

/**
 * Resolve `exe`/`args` to a concrete `spawn` invocation, wrapping a Windows
 * `.cmd`/`.bat` shim in a validated verbatim cmd.exe command line exactly as the
 * build runner does. Returns an error message when the batch guard refuses an
 * argument rather than risking cmd.exe reinterpretation.
 */
async function resolveSpawn(
  exe: string,
  args: ReadonlyArray<string>,
  env: Record<string, string>
): Promise<SpawnResolution & { readonly verbatim: boolean }> {
  const resolved = await resolveExecutable(exe, env)
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    const spec = batchSpawnSpec(resolved, args, env.ComSpec ?? env.COMSPEC)
    if ('error' in spec) {
      return { error: spec.error, verbatim: false }
    }
    return { exe: spec.exe, args: spec.args, verbatim: true }
  }
  return { exe: resolved, args: [...args], verbatim: false }
}

/** The outcome of running a spawned opencode-family process to completion. */
interface IProcessResult {
  readonly code: number
  readonly output: string
  readonly spawnError: boolean
}

export class OpencodeRunner {
  /** Live children, tracked so shutdown can tear every one down. */
  private readonly children = new Set<ChildProcessWithoutNullStreams>()

  /**
   * Probe the host for a usable opencode install. Runs `opencode --version` and
   * `opencode auth list` with `shell:false`; both argv are metacharacter-free so
   * the Windows shim path is safe. A missing binary surfaces as a spawn error
   * and yields `installed: false` rather than throwing.
   */
  public async detect(
    env: Record<string, string> = resolveRunEnv()
  ): Promise<IOpencodeStatus> {
    const version = await this.capture('opencode', ['--version'], env)
    if (version.spawnError || version.code !== 0) {
      return { installed: false, version: null, authConfigured: false }
    }

    const auth = await this.capture('opencode', ['auth', 'list'], env)
    return {
      installed: true,
      version: parseVersion(version.output),
      authConfigured: isAuthConfigured(auth),
    }
  }

  /**
   * Install the opencode CLI from a pure {@link planOpencodeInstall} plan,
   * streaming output to `onLog`. Resolves with the process exit code; the caller
   * re-detects to confirm the binary is now present.
   */
  public async install(
    plan: IOpencodeInstallPlan,
    onLog: OnLog,
    signal: AbortSignal,
    env: Record<string, string> = resolveRunEnv()
  ): Promise<IOpencodeInstallResult> {
    onLog('command', plan.label)
    const result = await this.stream(
      plan.exe,
      plan.args,
      env,
      undefined,
      null,
      onLog,
      signal
    )
    return { ok: !result.spawnError, code: result.code }
  }

  /**
   * Launch `opencode run` to fix the failed build. Ensures the scoped repo
   * config (including non-interactive question handling), spawns with the
   * metacharacter-free argv, writes
   * the prompt to stdin, and streams output to `onLog`. Resolves `ok: true` once
   * the process exits without a spawn error — never interpreting the exit code
   * as fix-success (that is the caller's re-run job).
   */
  public async runFix(
    run: IOpencodeFixRun,
    onLog: OnLog,
    signal: AbortSignal,
    env: Record<string, string> = resolveRunEnv()
  ): Promise<IOpencodeRunResult> {
    try {
      const ensured = await ensureOpencodeRepoConfig(run.repoPath)
      if (ensured.malformed) {
        onLog(
          'meta',
          'Existing opencode.json could not be parsed; leaving it untouched.'
        )
      } else if (ensured.written) {
        onLog('meta', 'Wrote repo-scoped opencode.json permission block.')
      }
    } catch (err) {
      onLog(
        'meta',
        `Could not write opencode.json: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }

    const args = buildOpencodeRunArgs({
      cwd: run.cwd,
      autoApprove: run.autoApprove,
      model: run.model,
    })
    onLog('command', `opencode ${args.join(' ')}`)
    const result = await this.stream(
      'opencode',
      args,
      env,
      run.cwd,
      run.prompt,
      onLog,
      signal
    )
    return { ok: !result.spawnError }
  }

  /** Tear down every live child before application shutdown continues. */
  public async killAll(): Promise<void> {
    await Promise.all(
      [...this.children].map(child =>
        child.pid !== undefined
          ? killTreeAndWait(
              child.pid,
              () => child.exitCode === null && child.signalCode === null
            )
          : Promise.resolve(true)
      )
    )
  }

  /** Spawn a process and capture bounded, non-streamed output for detection. */
  private capture(
    exe: string,
    args: ReadonlyArray<string>,
    env: Record<string, string>
  ): Promise<IProcessResult> {
    const noop = () => {}
    const controller = new AbortController()
    return this.stream(exe, args, env, undefined, null, noop, controller.signal)
  }

  /**
   * Spawn one opencode-family process, streaming line-buffered output to
   * `onLog` and accumulating a bounded copy for callers that parse it. Writes
   * `stdin` (when provided) and closes it, kills the tree on `signal` abort, and
   * resolves once the process closes.
   */
  private stream(
    exe: string,
    args: ReadonlyArray<string>,
    env: Record<string, string>,
    cwd: string | undefined,
    stdin: string | null,
    onLog: OnLog,
    signal: AbortSignal
  ): Promise<IProcessResult> {
    return new Promise<IProcessResult>(resolve => {
      if (signal.aborted) {
        resolve({ code: -1, output: '', spawnError: false })
        return
      }

      void resolveSpawn(exe, args, env).then(spec => {
        if ('error' in spec) {
          onLog('meta', spec.error)
          resolve({ code: -1, output: spec.error, spawnError: true })
          return
        }
        if (signal.aborted) {
          resolve({ code: -1, output: '', spawnError: false })
          return
        }

        let child: ChildProcessWithoutNullStreams
        try {
          child = spawn(spec.exe, [...spec.args], {
            cwd,
            env,
            windowsHide: true,
            shell: false,
            windowsVerbatimArguments: spec.verbatim,
            // Own a POSIX process group so the tree can be signalled on cancel.
            detached: process.platform !== 'win32',
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          onLog('meta', `Failed to run ${exe}: ${message}`)
          resolve({ code: -1, output: message, spawnError: true })
          return
        }

        this.children.add(child)

        if (stdin !== null) {
          child.stdin.on('error', () => {})
          child.stdin.end(stdin)
        } else {
          child.stdin.end()
        }

        let output = ''
        const buffers = { stdout: '', stderr: '' }
        const onData = (name: 'stdout' | 'stderr') => (chunk: Buffer) => {
          const text = chunk.toString('utf8')
          output = (output + text).slice(-DETECT_OUTPUT_CAP)
          buffers[name] += text.replace(/\r\n/g, '\n')
          let idx = buffers[name].indexOf('\n')
          while (idx !== -1) {
            onLog(name, buffers[name].slice(0, idx))
            buffers[name] = buffers[name].slice(idx + 1)
            idx = buffers[name].indexOf('\n')
          }
        }
        child.stdout.on('data', onData('stdout'))
        child.stderr.on('data', onData('stderr'))

        const onAbort = () => {
          if (child.pid !== undefined) {
            void killTreeAndWait(
              child.pid,
              () => child.exitCode === null && child.signalCode === null
            )
          }
        }
        signal.addEventListener('abort', onAbort, { once: true })

        let spawnError = false
        let settled = false
        const done = (code: number) => {
          if (settled) {
            return
          }
          settled = true
          signal.removeEventListener('abort', onAbort)
          this.children.delete(child)
          for (const name of ['stdout', 'stderr'] as const) {
            if (buffers[name].length > 0) {
              onLog(name, buffers[name])
            }
          }
          resolve({ code, output, spawnError })
        }

        child.on('error', err => {
          spawnError = true
          const message = err instanceof Error ? err.message : String(err)
          output = (output + message).slice(-DETECT_OUTPUT_CAP)
          onLog('meta', `Failed to run ${exe}: ${message}`)
          done(-1)
        })
        child.on('close', code => done(code ?? -1))
      })
    })
  }
}

/** Extract a version-looking token from `opencode --version` output. */
function parseVersion(output: string): string | null {
  const match = output.match(/\d+\.\d+\.\d+(?:[-.\w]*)?/)
  return match ? match[0] : output.trim().length > 0 ? output.trim() : null
}

/**
 * Decide whether `opencode auth list` reports a configured provider. The command
 * exits 0 whether or not a provider is set, so we treat a non-empty listing that
 * doesn't announce an empty state as "configured". Heuristic by necessity, but a
 * false negative only prompts the user to run `opencode auth login`.
 */
function isAuthConfigured(result: IProcessResult): boolean {
  if (result.spawnError || result.code !== 0) {
    return false
  }
  const text = result.output.trim()
  if (text.length === 0) {
    return false
  }
  return !/\bno\b.*\b(credential|provider|account|auth)/i.test(text)
}

/** The process-wide opencode runner wired into the IPC layer and lifecycle. */
export const opencodeRunner = new OpencodeRunner()

/** Correlates in-flight IPC operations with their cancellation controllers. */
const controllers = new Map<string, AbortController>()

function emit(
  sender: WebContents,
  operationId: string,
  stream: BuildRunLogStream,
  text: string
): void {
  if (sender.isDestroyed()) {
    return
  }
  ipcWebContents.send(sender, 'opencode-log', { operationId, stream, text })
}

/**
 * Register the opencode IPC handlers, mirroring `registerBuildRunIpc`. Streamed
 * output is pushed to whichever renderer invoked the handler on the dedicated
 * `opencode-log` channel; cancellation is keyed by the caller's operation id.
 */
export function registerOpencodeIpc(): void {
  ipcMain.handle('opencode-detect', async () => opencodeRunner.detect())

  ipcMain.handle('opencode-install', async (event, request) => {
    const controller = new AbortController()
    controllers.set(request.operationId, controller)
    try {
      return await opencodeRunner.install(
        planOpencodeInstall(process.platform),
        (stream, text) => emit(event.sender, request.operationId, stream, text),
        controller.signal
      )
    } finally {
      controllers.delete(request.operationId)
    }
  })

  ipcMain.handle('opencode-run-fix', async (event, request) => {
    const controller = new AbortController()
    controllers.set(request.operationId, controller)
    const prompt = buildOpencodeFixPrompt({
      stageKind: request.stageKind,
      exitCode: request.exitCode,
      tailText: request.tailText,
      cwd: request.cwd,
    })
    try {
      return await opencodeRunner.runFix(
        {
          repoPath: request.repoPath,
          cwd: request.cwd,
          autoApprove: request.autoApprove,
          prompt,
          model: request.model,
        },
        (stream, text) => emit(event.sender, request.operationId, stream, text),
        controller.signal
      )
    } finally {
      controllers.delete(request.operationId)
    }
  })

  ipcMain.handle('opencode-run-prompt', async (event, request) => {
    // A blank prompt never spawns opencode. Reject before allocating an
    // operation/controller so the renderer sees a clean no-op result.
    const prompt = buildOpencodeUserPrompt(request.prompt)
    if (prompt === null) {
      return { ok: false }
    }
    const controller = new AbortController()
    controllers.set(request.operationId, controller)
    try {
      return await opencodeRunner.runFix(
        {
          repoPath: request.repoPath,
          cwd: request.cwd,
          autoApprove: request.autoApprove,
          prompt,
          model: request.model,
        },
        (stream, text) => emit(event.sender, request.operationId, stream, text),
        controller.signal
      )
    } finally {
      controllers.delete(request.operationId)
    }
  })

  ipcMain.handle('opencode-cancel', async (_event, operationId) => {
    controllers.get(operationId)?.abort()
  })
}
