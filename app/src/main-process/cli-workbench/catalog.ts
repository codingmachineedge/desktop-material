import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { dirname } from 'path'
import {
  CLIWorkbenchTool,
  ICLIWorkbenchCatalog,
  ICLIWorkbenchToolCatalog,
} from '../../lib/cli-workbench'
import {
  parseCLIWorkbenchVersion,
  parseGitHelpCatalog,
  parseGitHubHelpCatalog,
  parseGitHubReferenceCatalog,
} from '../../lib/cli-workbench-catalog'
import { killTree } from '../build-run/kill-tree'
import { resolveCLIWorkbenchTool } from './tool-resolver'

const CatalogOutputCap = 8 * 1024 * 1024
const CatalogTimeoutMilliseconds = 30_000

interface ICapturedCommand {
  readonly exitCode: number
  readonly stdout: string
  readonly spawnFailed: boolean
  readonly truncated: boolean
  readonly timedOut: boolean
}

/** Runtime command discovery. No command output is logged or persisted. */
export class CLIWorkbenchCatalogService {
  private readonly children = new Set<ChildProcessWithoutNullStreams>()
  private activeDiscovery: Promise<ICLIWorkbenchCatalog> | null = null

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

  private async discoverCatalog(): Promise<ICLIWorkbenchCatalog> {
    const tools = await Promise.all([
      this.discoverTool('git'),
      this.discoverTool('gh'),
    ])
    return { tools, entries: tools.flatMap(x => x.entries) }
  }

  /** Kill catalog probes if the app exits during discovery. */
  public killAll(): void {
    for (const child of this.children) {
      if (child.pid !== undefined) {
        killTree(child.pid)
      }
    }
    this.children.clear()
  }

  private async discoverTool(
    tool: CLIWorkbenchTool
  ): Promise<ICLIWorkbenchToolCatalog> {
    let executable: string
    let toolEnv: Record<string, string | undefined>
    try {
      const resolved = resolveCLIWorkbenchTool(tool)
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
    return new Promise(resolve => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(executable, [...args], {
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

      this.children.add(child)
      const stdout = new Array<Buffer>()
      let stdoutBytes = 0
      let totalBytes = 0
      let spawnFailed = false
      let truncated = false
      let timedOut = false
      let finished = false

      const kill = () => {
        if (child.pid !== undefined) {
          killTree(child.pid)
        }
      }
      const timeout = setTimeout(() => {
        timedOut = true
        kill()
      }, CatalogTimeoutMilliseconds)

      child.stdout.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length
        if (totalBytes > CatalogOutputCap) {
          truncated = true
          kill()
          return
        }
        stdout.push(chunk)
        stdoutBytes += chunk.length
      })
      child.stderr.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length
        if (totalBytes > CatalogOutputCap) {
          truncated = true
          kill()
        }
      })
      child.once('error', () => {
        spawnFailed = true
      })
      child.once('close', code => {
        if (finished) {
          return
        }
        finished = true
        clearTimeout(timeout)
        this.children.delete(child)
        resolve({
          exitCode: code ?? -1,
          stdout: Buffer.concat(stdout, stdoutBytes).toString('utf8'),
          spawnFailed,
          truncated,
          timedOut,
        })
      })
    })
  }
}

/** The catalog service does not depend on any renderer or window. */
export const cliWorkbenchCatalog = new CLIWorkbenchCatalogService()
