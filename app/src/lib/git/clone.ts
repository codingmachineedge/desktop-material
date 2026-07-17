import { ChildProcess, spawn } from 'child_process'
import { realpathSync, statSync } from 'fs'
import { win32 } from 'path'
import { git, IGitStringExecutionOptions } from './core'
import { ICloneProgress } from '../../models/progress'
import { CloneOptions, getShallowCloneArgs } from '../../models/clone-options'
import { CloneProgressParser, executionOptionsWithProgress } from '../progress'
import { getDefaultBranch } from '../helpers/default-branch'
import { envForRemoteOperation } from './environment'

const CloneProcessTerminationDeadlineMilliseconds = 10_000
const CloneProcessGraceMilliseconds = 1_000

function cloneAbortError(): Error {
  const error = new Error('Repository clone cancelled.')
  error.name = 'AbortError'
  return error
}

function throwIfCloneAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw cloneAbortError()
  }
}

function processIsRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

const cloneProcessClosePromises = new WeakMap<ChildProcess, Promise<void>>()

function waitForProcessClose(child: ChildProcess): Promise<void> {
  const existing = cloneProcessClosePromises.get(child)
  if (existing !== undefined) {
    return existing
  }
  const closed = new Promise<void>(resolve => {
    child.once('close', () => resolve())
  })
  cloneProcessClosePromises.set(child, closed)
  return closed
}

function trustedTaskkillPath(): string {
  const configured = process.env.SystemRoot
  const candidate =
    configured !== undefined &&
    /^[A-Za-z]:\\/.test(configured) &&
    win32.isAbsolute(configured) &&
    !configured.includes('\0')
      ? configured
      : 'C:\\Windows'
  const systemRoot = realpathSync(candidate)
  const system32 = realpathSync(win32.join(systemRoot, 'System32'))
  const resolved = realpathSync(win32.join(system32, 'taskkill.exe'))
  const isStrictlyWithin = (root: string, path: string) => {
    const relative = win32.relative(root, path)
    return (
      relative.length > 0 &&
      !win32.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${win32.sep}`)
    )
  }
  if (
    !statSync(systemRoot).isDirectory() ||
    !statSync(system32).isDirectory() ||
    !isStrictlyWithin(systemRoot, system32) ||
    !isStrictlyWithin(system32, resolved) ||
    win32.basename(resolved).toLocaleLowerCase('en-US') !== 'taskkill.exe' ||
    !statSync(resolved).isFile()
  ) {
    throw new Error('The Windows process-tree terminator is unavailable.')
  }
  return resolved
}

async function killWindowsProcessTree(pid: number): Promise<void> {
  await new Promise<void>(resolve => {
    try {
      const terminator = spawn(
        trustedTaskkillPath(),
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore', shell: false }
      )
      let settled = false
      const finish = () => {
        if (!settled) {
          settled = true
          clearTimeout(deadline)
          resolve()
        }
      }
      const deadline = setTimeout(() => {
        try {
          terminator.kill()
        } catch {
          // The bounded helper may exit at the deadline boundary.
        }
        finish()
      }, CloneProcessTerminationDeadlineMilliseconds)
      terminator.once('error', finish)
      terminator.once('close', finish)
    } catch {
      resolve()
    }
  })
}

async function terminateCloneProcess(child: ChildProcess): Promise<void> {
  const closed = waitForProcessClose(child)
  if (!processIsRunning(child)) {
    await closed
    return
  }

  if (process.platform === 'win32' && child.pid !== undefined) {
    await killWindowsProcessTree(child.pid)
  } else {
    try {
      child.kill('SIGTERM')
    } catch {
      // The process may have exited at the abort boundary.
    }
    await Promise.race([
      closed,
      new Promise(resolve =>
        setTimeout(resolve, CloneProcessGraceMilliseconds)
      ),
    ])
  }

  if (processIsRunning(child)) {
    try {
      child.kill('SIGKILL')
    } catch {
      // The process may have exited before the forced fallback.
    }
  }
  // Dugite resolves/rejects only after this same close event. Waiting here
  // ensures callers never reuse or remove the staged path while Git owns it.
  await closed
}

/**
 * Attach abort ownership before any progress observer runs. The injected
 * terminator makes the registration races independently testable without
 * spawning a real process tree.
 */
export function createCloneProcessAbortHandler(
  signal: AbortSignal,
  terminate: (child: ChildProcess) => Promise<void> = terminateCloneProcess
) {
  let activeChild: ChildProcess | null = null
  let termination: Promise<void> | null = null

  const abortActive = () => {
    if (activeChild !== null) {
      termination ??= terminate(activeChild)
    }
  }

  return {
    processCallback(
      next: ((child: ChildProcess) => void) | undefined
    ): (child: ChildProcess) => void {
      return child => {
        // Observe `close` before any abort or progress callback can race it.
        void waitForProcessClose(child)
        activeChild = child
        const abort = () => {
          termination ??= terminate(child)
        }
        const cleanup = () => signal.removeEventListener('abort', abort)
        child.once('close', cleanup)
        child.once('error', cleanup)
        if (signal.aborted) {
          abort()
        } else {
          signal.addEventListener('abort', abort, { once: true })
        }

        try {
          next?.(child)
        } catch (error) {
          // The process is already live even if progress setup fails. Retain
          // ownership, terminate it, and let the original error propagate.
          abort()
          throw error
        }
      }
    },
    async abortAndWait(): Promise<void> {
      abortActive()
      await termination
    },
    async waitForTermination(): Promise<void> {
      await termination
    },
  }
}

/**
 * Clones a repository from a given url into to the specified path.
 *
 * @param url     - The remote repository URL to clone from
 *
 * @param path    - The destination path for the cloned repository. If the
 *                  path does not exist it will be created. Cloning into an
 *                  existing directory is only allowed if the directory is
 *                  empty.
 *
 * @param options  - Options specific to the clone operation, see the
 *                   documentation for CloneOptions for more details.
 *
 * @param progressCallback - An optional function which will be invoked
 *                           with information about the current progress
 *                           of the clone operation. When provided this enables
 *                           the '--progress' command line flag for
 *                           'git clone'.
 */
export async function clone(
  url: string,
  path: string,
  options: CloneOptions,
  progressCallback?: (progress: ICloneProgress) => void,
  credentialAccountKey?: string,
  signal?: AbortSignal
): Promise<void> {
  throwIfCloneAborted(signal)
  const env = {
    ...(await envForRemoteOperation(url)),
    GIT_CLONE_PROTECTION_ACTIVE: 'false',
  }
  throwIfCloneAborted(signal)

  const defaultBranch = options.defaultBranch ?? (await getDefaultBranch())
  throwIfCloneAborted(signal)

  const args = [
    '-c',
    `init.defaultBranch=${defaultBranch}`,
    'clone',
    '--recursive',
  ]

  let opts: IGitStringExecutionOptions = { env, credentialAccountKey }

  if (progressCallback) {
    args.push('--progress')

    const title = `Cloning into ${path}`
    const kind = 'clone'

    opts = await executionOptionsWithProgress(
      { ...opts, trackLFSProgress: true },
      new CloneProgressParser(),
      progress => {
        const description =
          progress.kind === 'progress' ? progress.details.text : progress.text
        const value = progress.percent

        progressCallback({ kind, title, description, value })
      }
    )
    throwIfCloneAborted(signal)

    // Initial progress
    progressCallback({ kind, title, value: 0 })
  }

  if (options.branch) {
    args.push('-b', options.branch)
  }

  args.push(...getShallowCloneArgs(options))

  args.push('--', url, path)

  const progressProcessCallback = opts.processCallback
  const abortHandler =
    signal !== undefined ? createCloneProcessAbortHandler(signal) : null
  if (abortHandler !== null) {
    opts = {
      ...opts,
      processCallback: abortHandler.processCallback(progressProcessCallback),
    }
  }

  try {
    await git(args, __dirname, 'clone', opts)
  } catch (error) {
    if (signal?.aborted) {
      await abortHandler?.abortAndWait()
      throw cloneAbortError()
    }
    await abortHandler?.waitForTermination()
    throw error
  }

  if (signal?.aborted) {
    await abortHandler?.abortAndWait()
    throw cloneAbortError()
  }
}
