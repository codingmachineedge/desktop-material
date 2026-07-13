export const SparseCheckoutDirectoryLimit = 1_000
export const SparseCheckoutDirectoryLengthLimit = 4_096

export type SparseCheckoutValidationIssueKind =
  | 'absolute'
  | 'control-character'
  | 'duplicate'
  | 'empty'
  | 'option-looking'
  | 'too-long'
  | 'too-many'
  | 'traversal'

export interface ISparseCheckoutValidationIssue {
  readonly kind: SparseCheckoutValidationIssueKind
  readonly line: number
  readonly value: string
  readonly message: string
}

export interface ISparseCheckoutDirectoryValidation {
  readonly directories: ReadonlyArray<string>
  readonly issues: ReadonlyArray<ISparseCheckoutValidationIssue>
}

interface ISparseCheckoutParseOptions {
  readonly allowEmpty?: boolean
}

const hasControlCharacter = (value: string) =>
  /[\u0000-\u001f\u007f]/.test(value)

const isAbsolutePath = (value: string) =>
  value.startsWith('/') ||
  value.startsWith('\\') ||
  /^[A-Za-z]:[\\/]/.test(value)

/**
 * Parse one repository-relative directory per line for cone-mode sparse
 * checkout. This parser has no renderer or Git dependencies and never turns
 * user input into a shell command.
 */
export function parseSparseCheckoutDirectories(
  input: string,
  options: ISparseCheckoutParseOptions = {}
): ISparseCheckoutDirectoryValidation {
  if (options.allowEmpty === true && input.trim().length === 0) {
    return { directories: [], issues: [] }
  }

  const directories = new Array<string>()
  const issues = new Array<ISparseCheckoutValidationIssue>()
  const seen = new Map<string, number>()
  const lines = input.split('\n')

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1
    const raw = lines[index].endsWith('\r')
      ? lines[index].substring(0, lines[index].length - 1)
      : lines[index]
    const trimmed = raw.trim()

    if (hasControlCharacter(raw)) {
      issues.push({
        kind: 'control-character',
        line: lineNumber,
        value: raw,
        message: `Line ${lineNumber} contains a control character.`,
      })
      continue
    }

    if (trimmed.length === 0) {
      issues.push({
        kind: 'empty',
        line: lineNumber,
        value: raw,
        message: `Line ${lineNumber} is empty after normalization.`,
      })
      continue
    }

    if (isAbsolutePath(trimmed)) {
      issues.push({
        kind: 'absolute',
        line: lineNumber,
        value: raw,
        message: `Line ${lineNumber} must be relative to the repository.`,
      })
      continue
    }

    const normalized = trimmed
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/')
      .replace(/\/+$/g, '')

    if (normalized.length === 0) {
      issues.push({
        kind: 'empty',
        line: lineNumber,
        value: raw,
        message: `Line ${lineNumber} is empty after normalization.`,
      })
      continue
    }

    if (normalized.startsWith('-')) {
      issues.push({
        kind: 'option-looking',
        line: lineNumber,
        value: raw,
        message: `Line ${lineNumber} cannot begin with a hyphen.`,
      })
      continue
    }

    if (normalized.split('/').some(part => part === '.' || part === '..')) {
      issues.push({
        kind: 'traversal',
        line: lineNumber,
        value: raw,
        message: `Line ${lineNumber} contains a . or .. traversal segment.`,
      })
      continue
    }

    if (normalized.length > SparseCheckoutDirectoryLengthLimit) {
      issues.push({
        kind: 'too-long',
        line: lineNumber,
        value: raw,
        message: `Line ${lineNumber} is longer than ${SparseCheckoutDirectoryLengthLimit.toLocaleString()} characters.`,
      })
      continue
    }

    const duplicateLine = seen.get(normalized)
    if (duplicateLine !== undefined) {
      issues.push({
        kind: 'duplicate',
        line: lineNumber,
        value: raw,
        message: `Line ${lineNumber} duplicates line ${duplicateLine}.`,
      })
      continue
    }

    seen.set(normalized, lineNumber)
    directories.push(normalized)
  }

  if (directories.length > SparseCheckoutDirectoryLimit) {
    issues.push({
      kind: 'too-many',
      line: SparseCheckoutDirectoryLimit + 1,
      value: '',
      message: `Use at most ${SparseCheckoutDirectoryLimit.toLocaleString()} directories.`,
    })
  }

  return {
    directories: directories.slice(0, SparseCheckoutDirectoryLimit),
    issues,
  }
}

export function parseGitBoolean(value: string): boolean {
  return value.trim().toLowerCase() === 'true'
}

export function isSparseCheckoutCommandSupported(output: string): boolean {
  return /usage:\s+git sparse-checkout\b/i.test(output)
}

/** Parse bounded line output from `git sparse-checkout list`. */
export function parseSparseCheckoutList(
  output: string,
  coneMode: boolean
): ReadonlyArray<string> {
  if (output.trim().length === 0) {
    return []
  }

  if (!coneMode) {
    return output
      .split(/\r?\n/)
      .filter(line => line.length > 0)
      .slice(0, SparseCheckoutDirectoryLimit)
  }

  const parsed = parseSparseCheckoutDirectories(output.replace(/\r?\n$/, ''), {
    allowEmpty: true,
  })
  if (parsed.issues.length > 0) {
    throw new Error('Git returned invalid cone-mode sparse-checkout entries.')
  }
  return parsed.directories
}
