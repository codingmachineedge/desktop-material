import { spawn } from 'child_process'
import { realpathSync, statSync } from 'fs'
import { win32 } from 'path'

const TaskkillDeadlineMilliseconds = 10_000

function trustedTaskkillPath(): string {
  const configured = process.env.SystemRoot
  const systemRoot =
    configured !== undefined && /^[A-Za-z]:\\Windows$/i.test(configured)
      ? configured
      : 'C:\\Windows'
  const resolved = realpathSync(
    win32.join(systemRoot, 'System32', 'taskkill.exe')
  )
  if (!statSync(resolved).isFile()) {
    throw new Error('The Windows process-tree terminator is unavailable.')
  }
  return resolved
}

/**
 * Start termination of one exact process tree and await the bounded kill
 * attempt. Callers that own a ChildProcess must separately await its `close`
 * event before releasing streams, paths, or temporary directories.
 */
export async function killTreeAndWait(
  pid: number,
  isStillOwned: () => boolean = () => true
): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  if (process.platform === 'win32') {
    return await new Promise(resolve => {
      try {
        const child = spawn(
          trustedTaskkillPath(),
          ['/PID', String(pid), '/T', '/F'],
          {
            windowsHide: true,
            stdio: 'ignore',
            shell: false,
          }
        )
        let settled = false
        const deadline = setTimeout(() => {
          try {
            child.kill()
          } catch {
            // The helper may have exited at the deadline boundary.
          }
          finish(false)
        }, TaskkillDeadlineMilliseconds)
        const finish = (ok: boolean) => {
          if (!settled) {
            settled = true
            clearTimeout(deadline)
            resolve(ok)
          }
        }
        child.once('error', () => finish(false))
        child.once('close', code => finish(code === 0))
      } catch {
        resolve(false)
      }
    })
  }

  // POSIX children are detached process-group leaders in the owning runners.
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      return false
    }
  }
  await new Promise(resolve => setTimeout(resolve, 1_000))
  if (!isStillOwned()) {
    return true
  }
  try {
    process.kill(-pid, 0)
    process.kill(-pid, 'SIGKILL')
  } catch {
    try {
      process.kill(pid, 0)
      process.kill(pid, 'SIGKILL')
    } catch {
      // The process or group exited during the bounded grace period.
    }
  }
  return true
}

/** Backwards-compatible fire-and-forget wrapper for existing callers. */
export function killTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return
  }
  if (process.platform === 'win32') {
    void killTreeAndWait(pid)
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // The process has already exited.
    }
  }
}
