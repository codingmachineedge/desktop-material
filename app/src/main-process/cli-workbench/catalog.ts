import {
  spawn,
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio,
} from 'child_process'
import { dirname } from 'path'
import {
  CLIWorkbenchTool,
  ICLIWorkbenchCatalog,
  ICLIWorkbenchRuntime,
  ICLIWorkbenchToolCatalog,
} from '../../lib/cli-workbench'
import {
  parseCLIWorkbenchVersion,
  parseGitHelpCatalog,
  parseGitHubHelpCatalog,
  parseGitHubReferenceCatalog,
} from '../../lib/cli-workbench-catalog'
import { killTreeAndWait } from '../build-run/kill-tree'
import { resolveCLIWorkbenchTool } from './tool-resolver'

const CatalogOutputCap = 8 * 1024 * 1024
const CatalogTimeoutMilliseconds = 30_000
const CatalogTerminationDeadlineMilliseconds = 15_000

interface ICapturedCommand {
  readonly exitCode: number
  readonly stdout: string
  readonly spawnFailed: boolean
  readonly truncated: boolean
  readonly timedOut: boolean
}

interface IActiveCatalogProcess {
  readonly child: ChildProcessWithoutNullStreams
  readonly closed: Promise<void>
  readonly resolveClosed: () => void
  forceSettle: () => void
  exited: boolean
  termination: Promise<boolean> | null
}

type SpawnCatalogCommand = (
  executable: string,
  args: ReadonlyArray<string>,
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams

export interface ICLIWorkbenchCatalogDependencies {
  readonly spawn?: SpawnCatalogCommand
  readonly killTree?: (
    pid: number,
    isStillOwned: () => boolean
  ) => Promise<boolean>
  readonly resolveTool?: typeof resolveCLIWorkbenchTool
  readonly catalogTimeoutMilliseconds?: number
  readonly terminationDeadlineMilliseconds?: number
}

function logCatalogFailure(message: string, error?: unknown): void {
  try {
    log.error(message, error instanceof Error ? error : undefined)
  } catch {
    // A diagnostic failure cannot escape a shutdown or timer callback.
  }
}

/** Runtime command discovery. No command output is logged or persisted. */
export class CLIWorkbenchCatalogService {
  private readonly children = new Set<IActiveCatalogProcess>()
  private readonly spawnCommand: SpawnCatalogCommand
  private readonly killProcessTree: (
    pid: number,
    isStillOwned: () => boolean
  ) => Promise<boolean>
  private readonly resolveTool: typeof resolveCLIWorkbenchTool
  private readonly catalogTimeoutMilliseconds: number
  private readonly terminationDeadlineMilliseconds: number
  private activeDiscovery: Promise<ICLIWorkbenchCatalog> | null = null
  private accepting = true

  public constructor(dependencies: ICLIWorkbenchCatalogDependencies = {}) {
    this.spawnCommand = dependencies.spawn ?? spawn
    this.killProcessTree = dependencies.killTree ?? killTreeAndWait
    this.resolveTool = dependencies.resolveTool ?? resolveCLIWorkbenchTool
    this.catalogTimeoutMilliseconds =
      dependencies.catalogTimeoutMilliseconds ?? CatalogTimeoutMilliseconds
    this.terminationDeadlineMilliseconds =
      dependencies.terminationDeadlineMilliseconds ??
      CatalogTerminationDeadlineMilliseconds
  }

  public getCatalog(): Promise<ICLIWorkbenchCatalog> {
    if (this.activeDiscovery !== null) {
      return this.activeDiscovery
    }
    const discovery = this.discoverCatalog()
    this.activeDiscovery = discovery
    const clear = () => {
      if (this.activeDiscovery === discovery) {
        this.activeDiscovery = null
      }
    }
    void discovery.then(clear, clear)
    return discovery
  }

  /**
   * Expose availability only. Complete command entries remain an internal
   * implementation-audit input and never become a renderer search surface.
   */
  public async getRuntime(): Promise<ICLIWorkbenchRuntime> {
    const catalog = await this.getCatalog()
    return {
      tools: catalog.tools.map(({ entries: _entries, ...runtime }) => runtime),
    }
  }

  private async discoverCatalog(): Promise<ICLIWorkbenchCatalog> {
    const tools = await Promise.all([
      this.discoverTool('git'),
      this.discoverTool('gh'),
    ])
    return { tools, entries: tools.flatMap(x => x.entries) }
  }

  /** Kill catalog probes if the app exits during discovery. */
  public async killAll(): Promise<void> {
    this.accepting = false
    const children = [...this.children]
    await Promise.all(children.map(child => this.terminate(child)))
  }

  private async discoverTool(
    tool: CLIWorkbenchTool
  ): Promise<ICLIWorkbenchToolCatalog> {
    let executable: string
    let toolEnv: Record<string, string | undefined>
    try {
      const resolved = this.resolveTool(tool)
      executable = resolved.executable
      toolEnv = resolved.env
    } catch {
      return this.unavailable(tool)
    }

    const versionResult = await this.capture(executable, ['--version'], toolEnv)
    if (versionResult.spawnFailed || versionResult.exitCode !== 0) {
      return this.unavailable(tool)
    }

    const version = parseCLIWorkbenchVersion(tool, versionResult.stdout)
    if (tool === 'git') {
      const help = await this.capture(executable, ['help', '-a'], toolEnv)
      if (help.exitCode !== 0 || help.truncated || help.timedOut) {
        return this.catalogFailure(tool, version)
      }
      const entries = parseGitHelpCatalog(help.stdout)
      return entries.length === 0
        ? this.catalogFailure(tool, version)
        : { tool, available: true, version, error: null, entries }
    }

    const [reference, help] = await Promise.all([
      this.capture(executable, ['help', 'reference'], toolEnv),
      this.capture(executable, ['help'], toolEnv),
    ])
    let entries =
      reference.exitCode === 0 && !reference.truncated && !reference.timedOut
        ? parseGitHubReferenceCatalog(reference.stdout)
        : []
    if (help.exitCode === 0 && !help.truncated && !help.timedOut) {
      const seen = new Set(entries.map(x => x.command))
      for (const entry of parseGitHubHelpCatalog(help.stdout)) {
        if (!seen.has(entry.command)) {
          entries = [...entries, entry]
          seen.add(entry.command)
        }
      }
    }
    return entries.length === 0
      ? this.catalogFailure(tool, version)
      : { tool, available: true, version, error: null, entries }
  }

  private unavailable(tool: CLIWorkbenchTool): ICLIWorkbenchToolCatalog {
    return {
      tool,
      available: false,
      version: null,
      error:
        tool === 'git'
          ? 'Bundled Git is unavailable.'
          : 'GitHub CLI is unavailable on PATH.',
      entries: [],
    }
  }

  private catalogFailure(
    tool: CLIWorkbenchTool,
    version: string | null
  ): ICLIWorkbenchToolCatalog {
    const toolName = tool === 'git' ? 'Git' : 'GitHub CLI'
    return {
      tool,
      available: true,
      version,
      error: `The ${toolName} command catalog could not be loaded.`,
      entries: [],
    }
  }

  private capture(
    executable: string,
    args: ReadonlyArray<string>,
    toolEnv: Record<string, string | undefined>
  ): Promise<ICapturedCommand> {
    if (!this.accepting) {
      return Promise.resolve({
        exitCode: -1,
        stdout: '',
        spawnFailed: true,
        truncated: false,
        timedOut: false,
      })
    }
    return new Promise(resolve => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = this.spawnCommand(executable, [...args], {
          cwd: dirname(process.execPath),
          env: {
            ...toolEnv,
            GH_PAGER: 'cat',
            GIT_PAGER: 'cat',
            LANG: 'C',
            LC_ALL: 'C',
            NO_COLOR: '1',
            PAGER: 'cat',
            TERM: 'dumb',
          },
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        })
      } catch {
        resolve({
          exitCode: -1,
          stdout: '',
          spawnFailed: true,
          truncated: false,
          timedOut: false,
        })
        return
      }

      let resolveClosed: () => void = () => undefined
      const closed = new Promise<void>(resolveClose => {
        resolveClosed = resolveClose
      })
      const active: IActiveCatalogProcess = {
        child,
        closed,
        resolveClosed,
        forceSettle: () => undefined,
        exited: false,
        termination: null,
      }
      this.children.add(active)
      const stdout = new Array<Buffer>()
      let stdoutBytes = 0
      let totalBytes = 0
      let spawnFailed = false
      let truncated = false
      let timedOut = false
      let finished = false

      const finish = (code: number | null) => {
        if (finished) {
          return
        }
        finished = true
        clearTimeout(timeout)
        resolve({
          exitCode: code ?? -1,
          stdout: Buffer.concat(stdout, stdoutBytes).toString('utf8'),
          spawnFailed,
          truncated,
          timedOut,
        })
      }
      active.forceSettle = () => {
        timedOut = true
        finish(null)
      }
      const terminate = () => {
        void this.terminate(active).catch(error =>
          logCatalogFailure(
            '[cli-workbench] catalog termination callback failed',
            error
          )
        )
      }
      const timeout = setTimeout(() => {
        timedOut = true
        terminate()
      }, this.catalogTimeoutMilliseconds)

      child.stdout.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length
        if (totalBytes > CatalogOutputCap) {
          truncated = true
          terminate()
          return
        }
        stdout.push(chunk)
        stdoutBytes += chunk.length
      })
      child.stderr.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length
        if (totalBytes > CatalogOutputCap) {
          truncated = true
          terminate()
        }
      })
      child.once('error', () => {
        spawnFailed = true
      })
      child.once('exit', () => {
        active.exited = true
      })
      child.once('close', code => {
        active.exited = true
        active.resolveClosed()
        this.children.delete(active)
        finish(code)
      })
    })
  }

  private terminate(active: IActiveCatalogProcess): Promise<boolean> {
    if (active.termination !== null) {
      return active.termination
    }
    active.termination = this.terminateOnce(active)
      .catch(error => {
        logCatalogFailure(
          '[cli-workbench] catalog probe teardown failed',
          error
        )
        return false
      })
      .then(closed => {
        if (!closed) {
          try {
            active.forceSettle()
          } catch (error) {
            logCatalogFailure(
              '[cli-workbench] failed to settle a stopped catalog probe',
              error
            )
          }
        }
        return closed
      })
    return active.termination
  }

  private async terminateOnce(active: IActiveCatalogProcess): Promise<boolean> {
    try {
      active.child.stdin.end()
    } catch {
      // The probe may already have closed its stdin pipe.
    }

    const isStillOwned = () => !active.exited
    if (active.child.pid !== undefined && isStillOwned()) {
      let killed = false
      try {
        killed = await this.killProcessTree(active.child.pid, isStillOwned)
      } catch (error) {
        logCatalogFailure(
          '[cli-workbench] catalog process-tree termination failed',
          error
        )
      }
      if (!killed && isStillOwned()) {
        try {
          active.child.kill('SIGKILL')
        } catch {
          // The exact child may have exited at the fallback boundary.
        }
      }
    }

    let deadline: ReturnType<typeof setTimeout> | null = null
    const closed = await Promise.race([
      active.closed.then(() => true),
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
      logCatalogFailure(
        '[cli-workbench] timed out waiting for a catalog probe to close'
      )
    }
    return closed
  }
}

/** The catalog service does not depend on any renderer or window. */
export const cliWorkbenchCatalog = new CLIWorkbenchCatalogService()
