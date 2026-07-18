/**
 * Pure `.gitmodules` helpers.
 *
 * This module deliberately has no imports so it can be consumed from UI
 * components, the git layer, and node-only unit tests alike without dragging
 * in dugite or React.
 */

/** A single `[submodule "…"]` stanza parsed from a `.gitmodules` file. */
export interface IGitModulesEntry {
  /** The logical submodule name (the quoted section header). */
  readonly name: string
  /** The path within the working tree the submodule is checked out to. */
  readonly path: string
  /** The remote URL the submodule is cloned from. */
  readonly url: string
  /** The tracked branch, or null when none is configured. */
  readonly branch: string | null
}

/**
 * Parse the contents of a `.gitmodules` file into its constituent entries.
 *
 * The format is a git-config style INI file: one `[submodule "name"]` header
 * per submodule followed by indented `key = value` pairs. Only the `path`,
 * `url` and (optional) `branch` keys are surfaced. Entries missing a `path`
 * are skipped since they cannot be reconciled against working-tree status.
 */
export function parseGitModules(
  contents: string
): ReadonlyArray<IGitModulesEntry> {
  const entries = new Array<IGitModulesEntry>()

  let name: string | null = null
  let path: string | null = null
  let url: string | null = null
  let branch: string | null = null

  const flush = () => {
    if (name !== null && path !== null) {
      entries.push({ name, path, url: url ?? '', branch })
    }
    name = null
    path = null
    url = null
    branch = null
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (line.length === 0 || line.startsWith('#') || line.startsWith(';')) {
      continue
    }

    const header = /^\[submodule "(.+)"\]$/.exec(line)
    if (header !== null) {
      // Starting a new stanza — commit the one we were building.
      flush()
      name = header[1]
      continue
    }

    if (name === null) {
      // A key outside of any `[submodule "…"]` header; ignore it.
      continue
    }

    const kv = /^(\w+)\s*=\s*(.*)$/.exec(line)
    if (kv === null) {
      continue
    }

    const key = kv[1].toLowerCase()
    const value = kv[2].trim()

    if (key === 'path') {
      path = value
    } else if (key === 'url') {
      url = value
    } else if (key === 'branch') {
      branch = value.length > 0 ? value : null
    }
  }

  flush()

  return entries
}

/**
 * Resolve a submodule's configured URL into a cloneable absolute URL.
 *
 * Git allows `.gitmodules` URLs to be relative (`./x`, `../x`) to the
 * superproject's own remote. This mirrors git's resolution: the parent URL is
 * treated as a path whose final segment is the repository itself, `..` pops
 * one segment and `.` is a no-op. Absolute URLs (https, ssh, scp-like
 * `git@host:owner/repo`) pass through unchanged.
 *
 * Returns null when the submodule URL is empty or escapes above the parent
 * URL's host — there is nothing safe to clone in either case.
 */
export function resolveSubmoduleCloneUrl(
  parentCloneUrl: string,
  submoduleUrl: string
): string | null {
  const url = submoduleUrl.trim()
  if (url.length === 0) {
    return null
  }

  if (!url.startsWith('./') && !url.startsWith('../')) {
    return url
  }

  const parent = parentCloneUrl.trim().replace(/\/+$/, '')
  if (parent.length === 0) {
    return null
  }

  // Split the parent into an immutable prefix (scheme://host or scp-like
  // user@host:) and the path we resolve the relative URL against.
  let prefix: string
  let separator: string
  let pathPart: string

  const schemeMatch = /^([a-z][a-z0-9+.-]*:\/\/[^/]+)(\/.*)?$/i.exec(parent)
  const scpMatch = /^([^/@]+@[^/:]+:)(.*)$/.exec(parent)

  if (schemeMatch !== null) {
    prefix = schemeMatch[1]
    separator = '/'
    pathPart = schemeMatch[2] ?? ''
  } else if (scpMatch !== null) {
    prefix = scpMatch[1]
    separator = ''
    pathPart = scpMatch[2]
  } else {
    // A plain filesystem path parent.
    prefix = ''
    separator = ''
    pathPart = parent
  }

  const segments = pathPart.split('/').filter(s => s.length > 0)

  let remaining = url
  while (remaining.startsWith('./') || remaining.startsWith('../')) {
    if (remaining.startsWith('./')) {
      remaining = remaining.slice(2)
      continue
    }

    if (segments.length === 0) {
      // `..` would climb above the host; refuse rather than guess.
      return null
    }

    segments.pop()
    remaining = remaining.slice(3)
  }

  if (remaining.length === 0) {
    return null
  }

  const joined = [...segments, remaining].join('/')
  return prefix === '' ? joined : `${prefix}${separator}${joined}`
}
