import { spawn } from 'child_process'
import { realpathSync, statSync } from 'fs'
import { win32 } from 'path'

const TaskkillDeadlineMilliseconds = 10_000

export interface ITaskkillPathDependencies {
  readonly realpath: (path: string) => string
  readonly isFile: (path: string) => boolean
}

const DefaultTaskkillPathDependencies: ITaskkillPathDependencies = {
  realpath: realpathSync,
  isFile: path => statSync(path).isFile(),
}

function isValidatedDriveRootedPath(value: string): boolean {
  if (
    !/^[A-Za-z]:[\\/](?![\\/])/.test(value) ||
    /[\u0000-\u001f:"<>|?*]/.test(value.slice(2)) ||
    /[\\/]{2}/.test(value.slice(3))
  ) {
    return false
  }
  return !value
    .slice(3)
    .split(/[\\/]/)
    .some(segment => segment === '.' || segment === '..')
}

/** Resolve taskkill only from a validated Windows installation directory. */
export function resolveTrustedTaskkillPath(
  configuredSystemRoot: string | undefined = process.env.SystemRoot,
  dependencies: ITaskkillPathDependencies = DefaultTaskkillPathDependencies
): string {
  const systemRoot = configuredSystemRoot ?? 'C:\\Windows'
  if (!isValidatedDriveRootedPath(systemRoot)) {
    throw new Error('The Windows system root is invalid.')
  }

  const resolvedSystemRoot = dependencies.realpath(systemRoot)
  const resolvedSystem32 = dependencies.realpath(
    win32.join(resolvedSystemRoot, 'System32')
  )
  if (
    !isValidatedDriveRootedPath(resolvedSystemRoot) ||
    !isValidatedDriveRootedPath(resolvedSystem32) ||
    win32.relative(resolvedSystemRoot, resolvedSystem32).toLowerCase() !==
      'system32'
  ) {
    throw new Error('The Windows system directory is invalid.')
  }
  const resolved = dependencies.realpath(
    win32.join(resolvedSystem32, 'taskkill.exe')
  )
  const relative = win32.relative(resolvedSystem32, resolved)
  if (
    relative.toLowerCase() !== 'taskkill.exe' ||
    !dependencies.isFile(resolved)
  ) {
    throw new Error('The Windows process-tree terminator is unavailable.')
  }
  return resolved
}

function stillOwned(isStillOwned: () => boolean): boolean {
  try {
    return isStillOwned()
  } catch {
    return false
  }
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
  if (!stillOwned(isStillOwned)) {
    return true
  }

  if (process.platform === 'win32') {
    return await new Promise(resolve => {
      try {
        const taskkillPath = resolveTrustedTaskkillPath()
        // Path resolution can touch the filesystem. Recheck immediately before
        // spawning so a PID which exited during that work is never targeted.
        if (!stillOwned(isStillOwned)) {
          resolve(true)
          return
        }
        const child = spawn(taskkillPath, ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
          shell: false,
        })
        let settled = false
        let deadline: ReturnType<typeof setTimeout> | null = null
        const finish = (ok: boolean) => {
          if (!settled) {
            settled = true
            if (deadline !== null) {
              clearTimeout(deadline)
            }
            resolve(ok)
          }
        }
        deadline = setTimeout(() => {
          try {
            child.kill()
          } catch {
            // The helper may have exited at the deadline boundary.
          }
          finish(false)
        }, TaskkillDeadlineMilliseconds)
        child.once('error', () => finish(false))
        child.once('close', code => finish(code === 0))
      } catch {
        resolve(false)
      }
    })
  }

  // POSIX children are detached process-group leaders in the owning runners.
  if (!stillOwned(isStillOwned)) {
    return true
  }
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
  if (!stillOwned(isStillOwned)) {
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
    void killTreeAndWait(pid).catch(() => undefined)
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
