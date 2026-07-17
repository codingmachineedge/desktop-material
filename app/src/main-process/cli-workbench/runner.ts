import {
  spawn,
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio,
} from 'child_process'
import { WebContents } from 'electron'
import {
  ICLICommandOutputEvent,
  ICLICommandStateEvent,
} from '../../lib/cli-workbench'
import * as ipcWebContents from '../ipc-webcontents'
import { killTreeAndWait } from '../build-run/kill-tree'
import {
  CLICommandConcurrencyCap,
  CLICommandOutputLimiter,
  IResolvedCLICommandRequest,
  validateCLICommandRequest,
} from './runner-helpers'
import { resolveCLIWorkbenchTool } from './tool-resolver'

interface IActiveCLICommand {
  readonly request: IResolvedCLICommandRequest
  readonly sender: WebContents
  readonly child: ChildProcessWithoutNullStreams
  readonly pid: number | null
  readonly output: CLICommandOutputLimiter
  readonly closed: Promise<void>
  readonly resolveClosed: () => void
  cancelled: boolean
  exited: boolean
  finished: boolean
  cancellation: Promise<void> | null
  cleanup: () => void
}

const OutputTruncatedMessage =
  '\n[CLI workbench output truncated at the 4 MiB safety limit.]\n'
const CLICommandTerminationDeadlineMilliseconds = 15_000

type SpawnCLICommand = (
  executable: string,
  args: ReadonlyArray<string>,
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams

export interface ICLIWorkbenchRunnerDependencies {
  readonly spawn?: SpawnCLICommand
  readonly killTree?: (
    pid: number,
    isStillOwned: () => boolean
  ) => Promise<boolean>
  readonly validateRequest?: (
    value: unknown
  ) => Promise<IResolvedCLICommandRequest>
  readonly resolveTool?: typeof resolveCLIWorkbenchTool
  readonly terminationDeadlineMilliseconds?: number
}

function logRunnerFailure(message: string, error?: unknown): void {
  try {
    log.error(message, error instanceof Error ? error : undefined)
  } catch {
    // Diagnostics cannot turn a bounded teardown into an unhandled failure.
  }
}

/** Bounded main-process runner for explicit Git and GitHub CLI argv. */
export class CLIWorkbenchRunner {
  private readonly runs = new Map<string, IActiveCLICommand>()
  private readonly spawnCommand: SpawnCLICommand
  private readonly killProcessTree: (
    pid: number,
    isStillOwned: () => boolean
  ) => Promise<boolean>
  private readonly validateRequest: (
    value: unknown
  ) => Promise<IResolvedCLICommandRequest>
  private readonly resolveTool: typeof resolveCLIWorkbenchTool
  private readonly terminationDeadlineMilliseconds: number

  public constructor(dependencies: ICLIWorkbenchRunnerDependencies = {}) {
    this.spawnCommand = dependencies.spawn ?? spawn
    this.killProcessTree = dependencies.killTree ?? killTreeAndWait
    this.validateRequest =
      dependencies.validateRequest ?? validateCLICommandRequest
    this.resolveTool = dependencies.resolveTool ?? resolveCLIWorkbenchTool
    this.terminationDeadlineMilliseconds =
      dependencies.terminationDeadlineMilliseconds ??
      CLICommandTerminationDeadlineMilliseconds
  }

  public async start(value: unknown, sender: WebContents): Promise<void> {
    if (this.runs.size >= CLICommandConcurrencyCap) {
      throw new Error('Too many CLI commands are already running.')
    }

    const request = await this.validateRequest(value)
    // Validation touches the filesystem. Recheck after that await so a burst
    // of simultaneous requests cannot all pass the initial capacity check.
    if (this.runs.size >= CLICommandConcurrencyCap) {
      throw new Error('Too many CLI commands are already running.')
    }
    if (this.runs.has(request.id)) {
      throw new Error('A CLI command with this id is already running.')
    }

    let executable: string
    let toolEnv: Record<string, string | undefined>
    try {
      const resolved = this.resolveTool(request.tool)
      executable = resolved.executable
      toolEnv = resolved.env
    } catch {
      throw new Error(`Unable to start ${request.tool}.`)
    }
    let child: ChildProcessWithoutNullStreams
    try {
      child = this.spawnCommand(executable, [...request.args], {
        cwd: request.repositoryPath,
        env: toolEnv,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      })
    } catch {
      throw new Error(`Unable to start ${request.tool}.`)
    }

    let resolveClosed: () => void = () => undefined
    const closed = new Promise<void>(resolve => {
      resolveClosed = resolve
    })
    const run: IActiveCLICommand = {
      request,
      sender,
      child,
      pid: child.pid ?? null,
      output: new CLICommandOutputLimiter(),
      closed,
      resolveClosed,
      cancelled: false,
      exited: false,
      finished: false,
      cancellation: null,
      cleanup: () => {},
    }
    this.runs.set(request.id, run)

    const onNavigate = () => {
      void this.cancel(request.id, sender).catch(error =>
        logRunnerFailure(
          '[cli-workbench] renderer navigation cancel failed',
          error
        )
      )
    }
    const onDestroyed = () => {
      void this.cancel(request.id, sender).catch(error =>
        logRunnerFailure(
          '[cli-workbench] renderer teardown cancel failed',
          error
        )
      )
    }
    sender.on('did-start-navigation', onNavigate)
    sender.once('destroyed', onDestroyed)
    run.cleanup = () => {
      try {
        sender.removeListener('did-start-navigation', onNavigate)
        sender.removeListener('destroyed', onDestroyed)
      } catch {
        // The originating renderer may already be gone.
      }
    }

    child.stdout.on('data', (chunk: Buffer) =>
      this.emitOutputChunk(run, 'stdout', chunk)
    )
    child.stderr.on('data', (chunk: Buffer) =>
      this.emitOutputChunk(run, 'stderr', chunk)
    )
    // Current named operations never accept stdin. Closing it prevents a
    // fixed recipe from becoming an interactive command surface.
    child.stdin.on('error', () => undefined)
    child.stdin.end()
    child.once('error', () => {
      this.finish(run, {
        id: request.id,
        state: 'failed',
        exitCode: null,
        signal: null,
        error: `Unable to run ${request.tool}.`,
      })
    })
    child.once('exit', () => {
      run.exited = true
    })
    child.once('close', (code, signal) => {
      run.exited = true
      run.resolveClosed()
      if (run.finished) {
        return
      }
      this.flushOutput(run)
      const state = run.cancelled
        ? 'cancelled'
        : code === 0
        ? 'completed'
        : 'failed'
      this.finish(run, {
        id: request.id,
        state,
        exitCode: code,
        signal,
      })
    })

    this.emitState(run, {
      id: request.id,
      state: 'running',
      exitCode: null,
      signal: null,
    })
  }

  /** Cancel only the matching run owned by the requesting renderer. */
  public async cancel(id: string, sender?: WebContents): Promise<boolean> {
    const run = this.runs.get(id)
    if (run === undefined || (sender !== undefined && run.sender !== sender)) {
      return false
    }
    if (run.finished && run.exited) {
      return true
    }
    await this.cancelRun(run)
    return true
  }

  /** Kill every exact PID tree during application shutdown. */
  public async killAll(): Promise<void> {
    const runs = [...this.runs.values()]
    await Promise.all(runs.map(run => this.cancelRun(run)))
  }

  private async cancelRun(run: IActiveCLICommand): Promise<void> {
    if (run.cancellation === null) {
      run.cancelled = true
      run.cancellation = this.terminate(run).catch(error => {
        logRunnerFailure('[cli-workbench] command teardown failed', error)
      })
    }
    await run.cancellation
  }

  private async terminate(run: IActiveCLICommand): Promise<void> {
    try {
      run.child.stdin.end()
    } catch {
      // The process may have closed its pipe before cancellation arrived.
    }

    const isStillOwned = () => !run.exited
    if (run.pid !== null && isStillOwned()) {
      let killed = false
      try {
        killed = await this.killProcessTree(run.pid, isStillOwned)
      } catch (error) {
        logRunnerFailure(
          '[cli-workbench] process-tree termination failed',
          error
        )
      }
      if (!killed && isStillOwned()) {
        try {
          run.child.kill('SIGKILL')
        } catch {
          // The exact child may have exited at the fallback boundary.
        }
      }
    }

    let deadline: ReturnType<typeof setTimeout> | null = null
    const closed = await Promise.race([
      run.closed.then(() => true),
      new Promise<false>(resolve => {
        deadline = setTimeout(
          () => resolve(false),
          this.terminationDeadlineMilliseconds
        )
      }),
    ])
    if (deadline !== null) {
      clearTimeout(deadline)
    }
    if (!closed) {
      logRunnerFailure(
        `[cli-workbench] timed out waiting for command ${run.request.id} to close`
      )
    }
  }

  private emitOutputChunk(
    run: IActiveCLICommand,
    stream: ICLICommandOutputEvent['stream'],
    chunk: Buffer
  ): void {
    const limited = run.output.write(stream, chunk)
    if (limited.data.length > 0) {
      this.emitOutput(run, { id: run.request.id, stream, data: limited.data })
    }
    if (limited.didTruncate) {
      this.emitOutput(run, {
        id: run.request.id,
        stream: 'stderr',
        data: OutputTruncatedMessage,
      })
    }
  }

  private flushOutput(run: IActiveCLICommand): void {
    for (const stream of ['stdout', 'stderr'] as const) {
      const data = run.output.end(stream)
      if (data.length > 0) {
        this.emitOutput(run, { id: run.request.id, stream, data })
      }
    }
  }

  private emitOutput(
    run: IActiveCLICommand,
    event: ICLICommandOutputEvent
  ): void {
    if (!run.sender.isDestroyed()) {
      ipcWebContents.send(run.sender, 'cli-command-output', event)
    }
  }

  private emitState(
    run: IActiveCLICommand,
    event: ICLICommandStateEvent
  ): void {
    if (!run.sender.isDestroyed()) {
      ipcWebContents.send(run.sender, 'cli-command-state', event)
    }
  }

  private finish(run: IActiveCLICommand, event: ICLICommandStateEvent): void {
    if (run.finished) {
      return
    }
    run.finished = true
    run.cleanup()
    if (this.runs.get(run.request.id) === run) {
      this.runs.delete(run.request.id)
    }
    this.emitState(run, event)
  }
}

export const cliWorkbenchRunner = new CLIWorkbenchRunner()
