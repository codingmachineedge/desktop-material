import { spawn } from 'child_process'
import * as path from 'path'
import { pathExists } from '../../lib/path-exists'
import { IActionsLocalToolAvailability } from '../../lib/actions-local-run/types'

/**
 * Locate the external tools the Local Actions runner needs (`act` and
 * `docker`) on the user's PATH, feature-detecting them the same way the CLI
 * workbench feature-detects `gh`. Nothing is bundled; a missing tool degrades
 * to a clear "not installed" result the UI turns into install guidance.
 */

/**
 * Resolve a bare executable name to a concrete path on the user's PATH,
 * honouring PATHEXT on Windows. Returns null when it cannot be found. Mirrors
 * the Build & Run runner's resolver but reports absence instead of echoing the
 * bare name back.
 */
export async function locateExecutable(
  exe: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | null> {
  const dirs = (env.Path ?? env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)

  if (process.platform !== 'win32') {
    for (const dir of dirs) {
      const candidate = path.join(dir, exe)
      if (await pathExists(candidate)) {
        return candidate
      }
    }
    return null
  }

  const pathext = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
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
  return null
}

/** Best-effort `<exe> --version`, resolving the first output line or null. */
function readVersion(exe: string): Promise<string | null> {
  return new Promise<string | null>(resolve => {
    let settled = false
    const finish = (value: string | null) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    let child
    try {
      child = spawn(exe, ['--version'], { windowsHide: true, shell: false })
    } catch {
      finish(null)
      return
    }
    let out = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('error', () => finish(null))
    child.on('close', () => {
      const firstLine = out.split(/\r?\n/).find(l => l.trim().length > 0)
      finish(firstLine?.trim() ?? null)
    })
    // Never let a hung probe stall detection.
    setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      finish(null)
    }, 5000)
  })
}

/**
 * Probe the host for a usable local-run toolchain. `act` runs the workflow and
 * Docker is the container backend it drives; a run is only launchable when both
 * are present.
 */
export async function detectActionsLocalTools(
  env: NodeJS.ProcessEnv = process.env
): Promise<IActionsLocalToolAvailability> {
  const [actPath, dockerPath] = await Promise.all([
    locateExecutable('act', env),
    locateExecutable('docker', env),
  ])

  const actVersion = actPath !== null ? await readVersion(actPath) : null

  return {
    actAvailable: actPath !== null,
    actPath,
    actVersion,
    dockerAvailable: dockerPath !== null,
    dockerPath,
    runnable: actPath !== null && dockerPath !== null,
  }
}
