import { spawn } from 'child_process'
import * as Path from 'path'

export type NetworkRepositoryPathKind = 'unc' | 'mapped-drive' | 'wsl'
export type MappedDriveProbe = (drive: string) => Promise<boolean>

const NetworkProbeTimeoutMs = 2_000
const NetworkProbeOutputLimit = 32 * 1024

function probeMappedDrive(drive: string): Promise<boolean> {
  if (!__WIN32__ || !/^[A-Za-z]:$/.test(drive)) {
    return Promise.resolve(false)
  }
  return new Promise(resolve => {
    const child = spawn('net.exe', ['use', drive], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let bytes = 0
    let settled = false
    const finish = (mapped: boolean) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      resolve(mapped)
    }
    const count = (value: Buffer) => {
      bytes += value.length
      if (bytes > NetworkProbeOutputLimit) {
        child.kill()
        finish(false)
      }
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish(false)
    }, NetworkProbeTimeoutMs)
    child.stdout?.on('data', value => count(Buffer.from(value)))
    child.stderr?.on('data', value => count(Buffer.from(value)))
    child.once('error', () => finish(false))
    child.once('close', code => finish(code === 0))
  })
}

/** Identify UNC, mapped-drive, and WSL paths without resolving the share. */
export async function classifyNetworkRepositoryPath(
  value: string,
  mappedDriveProbe: MappedDriveProbe = probeMappedDrive
): Promise<NetworkRepositoryPathKind | null> {
  if (!__WIN32__) {
    return null
  }
  const normalized = value.trim().replace(/\//g, '\\')
  if (/^\\\\(?:wsl\$|wsl\.localhost)\\[^\\]+(?:\\|$)/i.test(normalized)) {
    return 'wsl'
  }
  if (/^\\\\[^\\]+\\[^\\]+(?:\\|$)/.test(normalized)) {
    return 'unc'
  }
  const drive = /^([A-Za-z]:)(?:\\|$)/.exec(normalized)?.[1]
  return drive !== undefined && (await mappedDriveProbe(drive))
    ? 'mapped-drive'
    : null
}

/** Preserve valid UNC roots instead of folding them through a local drive. */
export function resolveRepositoryInputPath(value: string): string {
  const normalized = value.trim()
  if (
    normalized.length === 0 ||
    /[\0-\x1f\x7f]/.test(normalized) ||
    /^\\\\[?.]\\/.test(normalized)
  ) {
    throw new Error('Repository path is invalid.')
  }
  if (__WIN32__ && /^\\\\[^\\/]+[\\/][^\\/]+/.test(normalized)) {
    return Path.win32.normalize(normalized)
  }
  return Path.resolve('/', normalized)
}
