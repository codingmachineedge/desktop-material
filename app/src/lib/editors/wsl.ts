import { spawn } from 'child_process'
import { ExternalEditorError } from './shared'
import { t } from '../i18n'

const MaximumWslOutputBytes = 64 * 1024
const MaximumWslDistributions = 32
const MaximumWslDistributionLength = 128
const WslCommandTimeoutMs = 5_000

export type WslRunner = (
  args: ReadonlyArray<string>,
  timeoutMs?: number
) => Promise<Buffer>

function runWsl(
  args: ReadonlyArray<string>,
  timeoutMs = WslCommandTimeoutMs
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('wsl.exe', [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let settled = false

    const finish = (error?: Error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      if (error === undefined) {
        resolve(Buffer.concat(stdout))
      } else {
        reject(error)
      }
    }
    const append = (target: Buffer[], value: Buffer) => {
      outputBytes += value.length
      if (outputBytes > MaximumWslOutputBytes) {
        child.kill()
        finish(new Error('WSL returned too much output.'))
        return
      }
      target.push(value)
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish(new Error('WSL did not respond in time.'))
    }, timeoutMs)

    child.stdout?.on('data', value => append(stdout, Buffer.from(value)))
    child.stderr?.on('data', value => append(stderr, Buffer.from(value)))
    child.on('error', error => finish(error))
    child.on('close', code => {
      finish(
        code === 0
          ? undefined
          : new Error(
              Buffer.concat(stderr).toString('utf8').trim() ||
                `WSL exited with code ${code}.`
            )
      )
    })
  })
}

/** WSL emits UTF-16LE on some Windows releases and UTF-8 on others. */
export function decodeWslOutput(value: Buffer): string {
  const sampleLength = Math.min(value.length, 256)
  let nulls = 0
  for (let index = 1; index < sampleLength; index += 2) {
    if (value[index] === 0) {
      nulls++
    }
  }
  const encoding = nulls > sampleLength / 8 ? 'utf16le' : 'utf8'
  return value.toString(encoding).replace(/^\uFEFF/, '')
}

function normalizeDistribution(value: string): string | null {
  const normalized = value.trim()
  return normalized.length > 0 &&
    normalized.length <= MaximumWslDistributionLength &&
    !/[\0-\x1f\x7f]/.test(normalized)
    ? normalized
    : null
}

/** Discover bounded, unique WSL distributions without invoking a shell. */
export async function getWslDistributions(
  runner: WslRunner = runWsl
): Promise<ReadonlyArray<string>> {
  if (!__WIN32__) {
    return []
  }
  const output = decodeWslOutput(await runner(['--list', '--quiet']))
  const seen = new Set<string>()
  const distributions: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const distribution = normalizeDistribution(line)
    const key = distribution?.toLocaleLowerCase()
    if (distribution === null || key === undefined || seen.has(key)) {
      continue
    }
    seen.add(key)
    distributions.push(distribution)
    if (distributions.length === MaximumWslDistributions) {
      break
    }
  }
  return distributions
}

/** Convert `\\wsl.localhost\Distro\path` without starting a process. */
export function parseWslUNCPath(
  fullPath: string,
  distribution: string
): string | null {
  const normalized = fullPath.replace(/\//g, '\\')
  const match = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(?:\\(.*))?$/i.exec(
    normalized
  )
  if (match === null) {
    return null
  }
  if (match[1].toLocaleLowerCase() !== distribution.toLocaleLowerCase()) {
    throw new ExternalEditorError(
      t('editor.wslDistributionMismatch', { distribution: match[1] })
    )
  }
  return `/${(match[2] ?? '').replace(/\\/g, '/')}`
}

/** Resolve a Windows or WSL UNC path into the selected distribution. */
export async function resolveWslPath(
  fullPath: string,
  distribution: string,
  runner: WslRunner = runWsl
): Promise<string> {
  const safeDistribution = normalizeDistribution(distribution)
  if (safeDistribution === null || /[\r\n\0]/.test(fullPath)) {
    throw new ExternalEditorError(t('editor.wslInvalidDistributionPath'))
  }

  const uncPath = parseWslUNCPath(fullPath, safeDistribution)
  if (uncPath !== null) {
    return uncPath
  }
  if (fullPath.startsWith('/')) {
    return fullPath
  }

  let output: string
  try {
    output = decodeWslOutput(
      await runner([
        '--distribution',
        safeDistribution,
        '--exec',
        'wslpath',
        '-a',
        '-u',
        fullPath,
      ])
    ).trim()
  } catch (error) {
    log.error(
      'Unable to translate an editor path through WSL.',
      error instanceof Error ? error : undefined
    )
    throw new ExternalEditorError(t('editor.wslTranslateFailed'))
  }
  if (
    output.length === 0 ||
    output.length > 32_768 ||
    !output.startsWith('/') ||
    /[\r\n\0]/.test(output)
  ) {
    throw new ExternalEditorError(t('editor.wslInvalidTranslatedPath'))
  }
  return output
}

export function getWslEditorArguments(
  distribution: string,
  linuxPath: string
): ReadonlyArray<string> {
  const safeDistribution = normalizeDistribution(distribution)
  if (safeDistribution === null || !linuxPath.startsWith('/')) {
    throw new ExternalEditorError(t('editor.wslInvalidTarget'))
  }
  return ['--remote', `wsl+${safeDistribution}`, linuxPath]
}
