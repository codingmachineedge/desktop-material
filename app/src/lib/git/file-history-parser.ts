import * as Path from 'path'

/** Avoid mounting an unbounded number of interactive source rows. */
export const FileBlameLineLimit = 5_000

export type FileHistoryUnavailableKind =
  | 'aborted'
  | 'binary'
  | 'directory'
  | 'invalid-path'
  | 'malformed-output'
  | 'missing'
  | 'symbolic-link'
  | 'too-large'
  | 'untracked'

/** A user-actionable reason why file history or blame cannot be displayed. */
export class FileHistoryUnavailableError extends Error {
  public constructor(
    public readonly kind: FileHistoryUnavailableKind,
    message: string
  ) {
    super(message)
    this.name = 'FileHistoryUnavailableError'
  }
}

export interface IFileHistoryEntry {
  readonly sha: string
  readonly shortSha: string
  readonly summary: string
  readonly authorName: string
  readonly authorEmail: string
  readonly authoredAt: Date
}

export interface IFileHistoryResult {
  readonly path: string
  readonly entries: ReadonlyArray<IFileHistoryEntry>
  readonly truncated: boolean
}

export interface IFileBlameLine {
  readonly sha: string
  readonly shortSha: string
  readonly originalLine: number
  readonly finalLine: number
  readonly authorName: string
  readonly authorEmail: string
  readonly authoredAt: Date
  readonly summary: string
  readonly originalPath: string
  readonly content: string
  readonly boundary: boolean
  readonly uncommitted: boolean
}

export interface IFileBlameResult {
  readonly path: string
  readonly lines: ReadonlyArray<IFileBlameLine>
}

/**
 * Normalize and contain a repository-relative path before it reaches Git or
 * the filesystem. Both slash forms are accepted because Git paths use `/`
 * even on Windows.
 */
export function normalizeFileHistoryPath(
  repositoryPath: string,
  value: string
): string {
  if (value.length === 0 || value.includes('\0') || Path.isAbsolute(value)) {
    throw new FileHistoryUnavailableError(
      'invalid-path',
      'Choose a file inside this repository.'
    )
  }

  const nativeValue = value.replace(/[\\/]+/g, Path.sep)
  const resolved = Path.resolve(repositoryPath, nativeValue)
  const relative = Path.relative(Path.resolve(repositoryPath), resolved)

  if (
    relative.length === 0 ||
    relative === '..' ||
    relative.startsWith(`..${Path.sep}`) ||
    Path.isAbsolute(relative)
  ) {
    throw new FileHistoryUnavailableError(
      'invalid-path',
      'Choose a file inside this repository.'
    )
  }

  return relative.split(Path.sep).join('/')
}

interface IMutableBlameLine {
  sha: string
  originalLine: number
  finalLine: number
  authorName: string
  authorEmail: string
  authorTime: number
  summary: string
  originalPath: string
  content: string
  boundary: boolean
}

const blameHeader = /^([0-9a-f]+) (\d+) (\d+)(?: \d+)?$/

/** Parse `git blame --line-porcelain` without app or renderer dependencies. */
export function parseFileBlamePorcelain(
  output: string,
  fallbackPath: string
): ReadonlyArray<IFileBlameLine> {
  if (output.length === 0) {
    return []
  }

  const result = new Array<IFileBlameLine>()
  let current: IMutableBlameLine | null = null

  for (const line of output.split('\n')) {
    const header = blameHeader.exec(line)
    if (header !== null) {
      if (current !== null) {
        throw new FileHistoryUnavailableError(
          'malformed-output',
          'Git returned incomplete blame metadata.'
        )
      }
      current = {
        sha: header[1],
        originalLine: Number(header[2]),
        finalLine: Number(header[3]),
        authorName: 'Unknown author',
        authorEmail: '',
        authorTime: 0,
        summary: '',
        originalPath: fallbackPath,
        content: '',
        boundary: false,
      }
      continue
    }

    if (current === null) {
      if (line.length === 0) {
        continue
      }
      throw new FileHistoryUnavailableError(
        'malformed-output',
        'Git returned unexpected blame metadata.'
      )
    }

    if (line.startsWith('\t')) {
      current.content = line.substring(1)
      const authoredAt = new Date(current.authorTime * 1000)
      const uncommitted = /^0+$/.test(current.sha)
      result.push({
        sha: current.sha,
        shortSha: uncommitted ? 'Working tree' : current.sha.substring(0, 8),
        originalLine: current.originalLine,
        finalLine: current.finalLine,
        authorName: current.authorName,
        authorEmail: current.authorEmail,
        authoredAt,
        summary: current.summary,
        originalPath: current.originalPath,
        content: current.content,
        boundary: current.boundary,
        uncommitted,
      })
      current = null

      if (result.length > FileBlameLineLimit) {
        throw new FileHistoryUnavailableError(
          'too-large',
          `Blame has more than ${FileBlameLineLimit.toLocaleString()} lines.`
        )
      }
      continue
    }

    const separator = line.indexOf(' ')
    const key = separator === -1 ? line : line.substring(0, separator)
    const value = separator === -1 ? '' : line.substring(separator + 1)
    switch (key) {
      case 'author':
        current.authorName = value
        break
      case 'author-mail':
        current.authorEmail = value.replace(/^</, '').replace(/>$/, '')
        break
      case 'author-time':
        current.authorTime = Number(value)
        break
      case 'summary':
        current.summary = value
        break
      case 'filename':
        current.originalPath = value
        break
      case 'boundary':
        current.boundary = true
        break
    }
  }

  if (current !== null) {
    throw new FileHistoryUnavailableError(
      'malformed-output',
      'Git returned incomplete blame metadata.'
    )
  }

  return result
}
