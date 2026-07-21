import { Dirent } from 'fs'
import { lstat, opendir } from 'fs/promises'
import * as Path from 'path'

import { getRepositoryType } from './rev-parse'

const DefaultMaximumDepth = 6
const DefaultMaximumRepositories = 100
const DefaultMaximumDirectories = 5_000
const DefaultMaximumEntries = 20_000
const DefaultMaximumEntriesPerDirectory = 2_000

const ignoredDirectoryNames = new Set([
  '.cache',
  '.git',
  '.hg',
  '.next',
  '.svn',
  '.tox',
  '.venv',
  '__pycache__',
  'bin',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'obj',
  'out',
  'target',
  'vendor',
  'venv',
])

export interface IFindRepositoriesOptions {
  /** The number of directory levels below the selected folder to inspect. */
  readonly maximumDepth?: number

  /** Stop after finding this many repositories. */
  readonly maximumRepositories?: number

  /** Stop after opening this many directories. */
  readonly maximumDirectories?: number

  /** Stop after inspecting this many directory entries in total. */
  readonly maximumEntries?: number

  /** Stop inspecting an individual directory after this many entries. */
  readonly maximumEntriesPerDirectory?: number

  /** Directory-open seam used by deterministic scanner tests. */
  readonly openDirectory?: typeof opendir

  /** Repository-type seam used by deterministic scanner tests. */
  readonly getRepositoryType?: typeof getRepositoryType
}

export interface IFindRepositoriesResult {
  readonly repositories: ReadonlyArray<string>

  /** Whether a traversal bound or unreadable descendant hid part of the tree. */
  readonly truncated: boolean
}

interface IQueuedDirectory {
  readonly path: string
  readonly depth: number
}

interface IReadDirectoryResult {
  readonly entries: ReadonlyArray<Dirent>
  readonly truncated: boolean
  readonly unreadable: boolean
}

const positiveInteger = (value: number | undefined, fallback: number) =>
  value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(1, Math.floor(value))

const nonNegativeInteger = (value: number | undefined, fallback: number) =>
  value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(0, Math.floor(value))

const pathKey = (path: string) => {
  const normalizedPath = Path.normalize(path)
  return process.platform === 'win32'
    ? normalizedPath.toLowerCase()
    : normalizedPath
}

const isGitMarkerName = (name: string) =>
  process.platform === 'win32' ? name.toLowerCase() === '.git' : name === '.git'

const isWorktreesDirName = (name: string) =>
  pathKey(name) === pathKey('worktrees')

/**
 * Decide whether a resolved Git directory belongs to a linked worktree.
 *
 * A primary working tree keeps its Git directory at `<repo>/.git`. A linked
 * worktree instead points (via a `.git` file at its root) at
 * `<repo>/.git/worktrees/<name>`. Such a path is administered by the primary
 * repository and is not an independently-addable repository, so the scanner
 * skips it. Detection walks the path segments and looks for a `.git` segment
 * immediately followed by a `worktrees` segment, matching the platform's
 * case sensitivity through the shared marker/path helpers.
 */
const isLinkedWorktreeGitDir = (gitDir: string) => {
  const segments = Path.resolve(gitDir).split(/[\\/]+/)

  for (let index = 0; index + 1 < segments.length; index++) {
    if (
      isGitMarkerName(segments[index]) &&
      isWorktreesDirName(segments[index + 1])
    ) {
      return true
    }
  }

  return false
}

async function readDirectory(
  path: string,
  maximumEntries: number,
  openDirectory: typeof opendir
): Promise<IReadDirectoryResult> {
  let directory

  try {
    directory = await openDirectory(path)
  } catch {
    return { entries: [], truncated: false, unreadable: true }
  }

  const entries = new Array<Dirent>()
  let truncated = false
  let unreadable = false

  try {
    while (entries.length < maximumEntries) {
      const entry = await directory.read()
      if (entry === null) {
        return { entries, truncated, unreadable }
      }

      entries.push(entry)
    }

    truncated = (await directory.read()) !== null
  } catch {
    unreadable = true
  } finally {
    await directory.close().catch(() => undefined)
  }

  return { entries, truncated, unreadable }
}

/**
 * Find working-tree Git repositories below a selected folder.
 *
 * The scan is deliberately bounded. It does not follow symbolic links or
 * junctions, skips generated/dependency directories, and stops descending as
 * soon as it reaches a repository root. Repository markers are validated with
 * Git before their paths are returned.
 */
export async function findRepositoriesInDirectory(
  rootPath: string,
  options: IFindRepositoriesOptions = {}
): Promise<IFindRepositoriesResult> {
  const maximumDepth = nonNegativeInteger(
    options.maximumDepth,
    DefaultMaximumDepth
  )
  const maximumRepositories = positiveInteger(
    options.maximumRepositories,
    DefaultMaximumRepositories
  )
  const maximumDirectories = positiveInteger(
    options.maximumDirectories,
    DefaultMaximumDirectories
  )
  const maximumEntries = positiveInteger(
    options.maximumEntries,
    DefaultMaximumEntries
  )
  const maximumEntriesPerDirectory = positiveInteger(
    options.maximumEntriesPerDirectory,
    DefaultMaximumEntriesPerDirectory
  )
  const openDirectory = options.openDirectory ?? opendir
  const resolveRepositoryType = options.getRepositoryType ?? getRepositoryType

  const resolvedRootPath = Path.resolve(rootPath)
  const rootStats = await lstat(resolvedRootPath).catch(() => null)

  if (
    rootStats === null ||
    !rootStats.isDirectory() ||
    rootStats.isSymbolicLink()
  ) {
    return { repositories: [], truncated: false }
  }

  const queue: IQueuedDirectory[] = [{ path: resolvedRootPath, depth: 0 }]
  const repositories = new Array<string>()
  const repositoryKeys = new Set<string>()
  let queueIndex = 0
  let directoriesInspected = 0
  let entriesInspected = 0
  let truncated = false

  while (queueIndex < queue.length) {
    if (
      directoriesInspected >= maximumDirectories ||
      entriesInspected >= maximumEntries ||
      repositories.length >= maximumRepositories
    ) {
      truncated = true
      break
    }

    const current = queue[queueIndex++]
    const remainingEntries = maximumEntries - entriesInspected
    const entryLimit = Math.min(remainingEntries, maximumEntriesPerDirectory)
    const result = await readDirectory(current.path, entryLimit, openDirectory)
    directoriesInspected++
    entriesInspected += result.entries.length
    truncated ||= result.truncated

    if (result.unreadable) {
      if (current.depth === 0) {
        throw new Error(
          `The selected folder could not be read: ${current.path}`
        )
      }

      truncated = true
    }

    const entries = [...result.entries].sort((a, b) =>
      a.name.localeCompare(b.name)
    )
    const gitMarker = entries.find(
      entry =>
        isGitMarkerName(entry.name) &&
        !entry.isSymbolicLink() &&
        (entry.isDirectory() || entry.isFile())
    )

    if (gitMarker !== undefined) {
      const repositoryType = await resolveRepositoryType(current.path).catch(
        () => null
      )

      if (
        repositoryType?.kind === 'regular' &&
        pathKey(repositoryType.topLevelWorkingDirectory) ===
          pathKey(current.path) &&
        // A linked worktree passes the primary-working-tree test above, but it
        // is administered by another repository and is not independently
        // addable, so skip recording it (while still treating it as a boundary
        // via the `continue` below).
        !isLinkedWorktreeGitDir(repositoryType.gitDir)
      ) {
        const repositoryPath = Path.resolve(
          repositoryType.topLevelWorkingDirectory
        )
        const key = pathKey(repositoryPath)

        if (!repositoryKeys.has(key)) {
          repositoryKeys.add(key)
          repositories.push(repositoryPath)
        }
      }

      // A Git marker is a repository boundary even when Git rejects it. This
      // avoids walking an unsafe, bare, malformed, or very large worktree.
      continue
    }

    const childDirectories = entries.filter(
      entry =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !ignoredDirectoryNames.has(entry.name.toLowerCase())
    )

    if (current.depth >= maximumDepth) {
      truncated ||= childDirectories.length > 0
      continue
    }

    for (const entry of childDirectories) {
      queue.push({
        path: Path.join(current.path, entry.name),
        depth: current.depth + 1,
      })
    }
  }

  return { repositories, truncated }
}
