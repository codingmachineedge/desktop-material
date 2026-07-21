import { type ChildProcess, spawn } from 'child_process'
import { realpathSync, statSync } from 'fs'
import { win32 } from 'path'

const ProcessTerminationDeadlineMilliseconds = 10_000
const ProcessTerminationGraceMilliseconds = 1_000

export type GitProcessTerminator = (child: ChildProcess) => Promise<void>

function processIsRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

const processClosePromises = new WeakMap<ChildProcess, Promise<void>>()

function observeProcessClose(child: ChildProcess): Promise<void> {
  const existing = processClosePromises.get(child)
  if (existing !== undefined) {
    return existing
  }

  const closed = new Promise<void>(resolve => {
    child.once('close', () => resolve())
  })
  processClosePromises.set(child, closed)
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
      }, ProcessTerminationDeadlineMilliseconds)
      terminator.once('error', finish)
      terminator.once('close', finish)
    } catch {
      resolve()
    }
  })
}

/**
 * Terminate a Git child process and wait for its close event. On Windows this
 * terminates the complete process tree so credential helpers, SSH, hooks, and
 * other descendants cannot outlive the operation which spawned them.
 */
async function terminateGitProcess(child: ChildProcess): Promise<void> {
  const closed = observeProcessClose(child)
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
        setTimeout(resolve, ProcessTerminationGraceMilliseconds)
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

  // Dugite settles only after this same close event. Waiting here prevents a
  // timed-out operation from returning while Git or its streams remain live.
  await closed
}

/**
 * Own the process spawned for one Git operation and make cancellation settle
 * only after that process (and, on Windows, its complete tree) has closed.
 * The injectable terminator keeps registration and settlement races directly
 * unit-testable without launching a real process tree.
 */
export function createGitProcessAbortHandler(
  signal: AbortSignal,
  terminate: GitProcessTerminator = terminateGitProcess
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
        // Observe `close` before abort or a caller callback can race it.
        void observeProcessClose(child)
        activeChild = child
        const abort = () => {
          termination ??= terminate(child)
        }
        const cleanup = () => {
          signal.removeEventListener('abort', abort)
          child.removeListener('close', cleanup)
          child.removeListener('error', cleanup)
        }
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
          // The process is live even if observer setup fails. Keep ownership,
          // terminate it, and preserve the caller's original exception.
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
