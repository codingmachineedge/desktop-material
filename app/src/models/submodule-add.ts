import * as Path from 'path'
import { sanitizedRefName } from '../lib/sanitize-ref-name'

const InvalidPathCharacter = /[\0\r\n]/
const InvalidSourceCharacter = /[\0\r\n]/
const InvalidRemoteRepositoryNameCharacter = /[^A-Za-z0-9._-]/

export const MaximumRemoteRepositoryNameLength = 100
export const MaximumRemoteRepositoryDescriptionLength = 350

/** Normalize a user-facing submodule path to Git's portable slash form. */
export function normalizeSubmodulePath(value: string): string {
  return value.trim().replace(/\\/g, '/')
}

/** Validate the repository-relative checkout path used by `git submodule add`. */
export function getSubmodulePathError(
  value: string,
  existingPaths: ReadonlyArray<string> = []
): string | null {
  const normalized = normalizeSubmodulePath(value)
  if (normalized.length === 0) {
    return 'Enter a path inside this repository.'
  }
  if (
    InvalidPathCharacter.test(normalized) ||
    Path.posix.isAbsolute(normalized) ||
    Path.win32.isAbsolute(value.trim())
  ) {
    return 'Choose a relative path inside this repository.'
  }

  const segments = normalized.split('/')
  if (
    segments.some(
      segment => segment.length === 0 || segment === '.' || segment === '..'
    )
  ) {
    return 'The path cannot contain empty, current-directory, or parent-directory segments.'
  }
  if (segments.some(segment => segment.toLowerCase() === '.git')) {
    return 'The path cannot use Git metadata directories.'
  }

  const folded = normalized.toLocaleLowerCase()
  if (
    existingPaths.some(
      path => normalizeSubmodulePath(path).toLocaleLowerCase() === folded
    )
  ) {
    return 'A submodule already uses this path.'
  }

  return null
}

/** Validate an optional branch without silently changing what Git will track. */
export function getSubmoduleBranchError(value: string): string | null {
  const branch = value.trim()
  if (branch.length === 0) {
    return null
  }
  if (
    branch === '@' ||
    branch.startsWith('-') ||
    branch.includes('//') ||
    sanitizedRefName(branch) !== branch
  ) {
    return 'Enter a valid branch name, or leave the branch empty to use the remote default.'
  }
  return null
}

/** Keep source validation broad enough for HTTPS, SSH, and local Git remotes. */
export function getSubmoduleSourceError(value: string): string | null {
  const source = value.trim()
  if (source.length === 0) {
    return 'Choose a repository or enter its URL.'
  }
  if (InvalidSourceCharacter.test(source)) {
    return 'The repository URL contains unsupported control characters.'
  }
  return null
}

/**
 * Validate a GitHub repository name before creating a remote for a submodule.
 * Keeping this strict avoids creating a repository under a silently rewritten
 * name and then pinning a different-looking submodule path.
 */
export function getSubmoduleRemoteNameError(value: string): string | null {
  const name = value.trim()
  if (name.length === 0) {
    return 'Enter a name for the new remote repository.'
  }
  if (name.length > MaximumRemoteRepositoryNameLength) {
    return `Repository names must be ${MaximumRemoteRepositoryNameLength} characters or fewer.`
  }
  if (
    value !== name ||
    name === '.' ||
    name === '..' ||
    InvalidRemoteRepositoryNameCharacter.test(name)
  ) {
    return 'Use only letters, numbers, periods, hyphens, and underscores in the repository name.'
  }
  return null
}

/** Validate the optional description sent to the remote host. */
export function getSubmoduleRemoteDescriptionError(
  value: string
): string | null {
  if (value.length > MaximumRemoteRepositoryDescriptionLength) {
    return `Repository descriptions must be ${MaximumRemoteRepositoryDescriptionLength} characters or fewer.`
  }
  if (/[\0\r\n]/.test(value)) {
    return 'The repository description contains unsupported control characters.'
  }
  return null
}

/** Suggest a conventional checkout path without overwriting a user's edit. */
export function getSuggestedSubmodulePath(source: string): string {
  const withoutSuffix = source
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/[\\/]+$/, '')
    .replace(/\.git$/i, '')
  const rawName = withoutSuffix.split(/[\\/:]/).at(-1) ?? ''
  const name = rawName
    .replace(/[<>:"|?*\x00-\x1f]/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/^[-. ]+/g, '')

  return name.length > 0 ? `vendor/${name}` : ''
}
