const MaximumLFSJSONBytes = 256 * 1024
const MaximumLFSPatterns = 1000
const MaximumLFSStatusPaths = 1000
const MaximumLFSPatternBytes = 1024

export interface IRepositoryLFSPattern {
  readonly pattern: string
  readonly lockable: boolean
}

export interface IRepositoryLFSStatus {
  readonly paths: ReadonlyArray<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseBoundedJSON(output: string, label: string): unknown {
  if (Buffer.byteLength(output, 'utf8') > MaximumLFSJSONBytes) {
    throw new Error(`Git LFS returned too much ${label} data to review.`)
  }
  try {
    return JSON.parse(output)
  } catch {
    throw new Error(`Git LFS returned invalid ${label} data.`)
  }
}

export function parseRepositoryLFSVersion(output: string): string {
  if (Buffer.byteLength(output, 'utf8') > 1024) {
    throw new Error('Git LFS returned an invalid version.')
  }
  const match = /^git-lfs\/(\d+\.\d+\.\d+)(?:\s|$)/.exec(output.trim())
  if (match === null) {
    throw new Error('Git LFS returned an invalid version.')
  }
  return match[1]
}

export function normalizeRepositoryLFSPattern(value: string): string {
  const pattern = value.trim()
  const segments = pattern.split('/')
  if (
    pattern.length === 0 ||
    Buffer.byteLength(pattern, 'utf8') > MaximumLFSPatternBytes ||
    /[\u0000-\u001f\u007f]/.test(pattern) ||
    pattern.startsWith('-') ||
    pattern.startsWith('!') ||
    pattern.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(pattern) ||
    pattern.includes('\\') ||
    segments.includes('..') ||
    segments.some(segment => segment.length === 0) ||
    /^\.git(?:\/|$)/i.test(pattern) ||
    /^\.gitattributes$/i.test(pattern)
  ) {
    throw new Error(
      'Enter a safe repository-relative LFS pattern without options, parent traversal, or Git metadata paths.'
    )
  }
  return pattern
}

export function parseRepositoryLFSPatterns(
  output: string
): ReadonlyArray<IRepositoryLFSPattern> {
  const value = parseBoundedJSON(output, 'tracked-pattern')
  if (!isRecord(value) || !Array.isArray(value.patterns)) {
    throw new Error('Git LFS returned invalid tracked-pattern data.')
  }

  const patterns = new Array<IRepositoryLFSPattern>()
  const seen = new Set<string>()
  for (const item of value.patterns) {
    if (!isRecord(item) || typeof item.pattern !== 'string') {
      throw new Error('Git LFS returned an invalid tracked pattern.')
    }
    if (item.tracked === false) {
      continue
    }
    if (item.tracked !== undefined && typeof item.tracked !== 'boolean') {
      throw new Error('Git LFS returned an invalid tracked pattern.')
    }
    const pattern = normalizeRepositoryLFSPattern(item.pattern)
    if (seen.has(pattern)) {
      throw new Error('Git LFS returned duplicate tracked patterns.')
    }
    if (item.lockable !== undefined && typeof item.lockable !== 'boolean') {
      throw new Error('Git LFS returned an invalid lockable state.')
    }
    seen.add(pattern)
    patterns.push({ pattern, lockable: item.lockable === true })
    if (patterns.length > MaximumLFSPatterns) {
      throw new Error('Git LFS returned too many tracked patterns to review.')
    }
  }
  return patterns.sort((left, right) =>
    left.pattern.localeCompare(right.pattern)
  )
}

function normalizeStatusPath(value: string): string {
  if (
    value.length === 0 ||
    value.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.split(/[\\/]/).includes('..')
  ) {
    throw new Error('Git LFS returned an invalid repository-relative path.')
  }
  return value
}

export function parseRepositoryLFSStatus(output: string): IRepositoryLFSStatus {
  const value = parseBoundedJSON(output, 'status')
  if (!isRecord(value) || !isRecord(value.files)) {
    throw new Error('Git LFS returned invalid status data.')
  }
  const paths = Object.keys(value.files).map(normalizeStatusPath)
  if (paths.length > MaximumLFSStatusPaths) {
    throw new Error('Git LFS returned too many status paths to review.')
  }
  return { paths: paths.sort((left, right) => left.localeCompare(right)) }
}

export function summarizeRepositoryLFSPrunePreview(output: string): string {
  if (Buffer.byteLength(output, 'utf8') > MaximumLFSJSONBytes) {
    throw new Error('Git LFS returned too much prune-preview data to review.')
  }
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
  return lines.length === 0
    ? 'Git LFS found no local objects eligible for pruning.'
    : `Git LFS completed the dry-run preview and reported ${lines.length.toLocaleString(
        'en-US'
      )} bounded result ${lines.length === 1 ? 'line' : 'lines'}.`
}
