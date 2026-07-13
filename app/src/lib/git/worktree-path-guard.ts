import { ChildProcess } from 'child_process'
import { lstat, readdir, realpath } from 'fs/promises'
import * as Path from 'path'

import { isErrnoException } from '../errno-exception'
import { git, isMaxBufferExceededError } from './core'

const RepositoryPathProbeOutputLimit = 64 * 1024
const GitIndexProbeOutputLimit = 16 * 1024 * 1024

export const WorktreeSafetyEntryLimit = 200_000
export const WorktreeSafetyDepthLimit = 128

export type WorktreePathSafetyErrorKind =
  | 'aborted'
  | 'invalid-repository'
  | 'path-escape'
  | 'reparse-point'
  | 'scan-error'
  | 'scan-too-large'

/** A fail-closed physical-filesystem boundary used before Git worktree I/O. */
export class WorktreePathSafetyError extends Error {
  public constructor(
    public readonly kind: WorktreePathSafetyErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'WorktreePathSafetyError'
  }
}

export interface IPhysicalRepositoryPath {
  /** Canonical physical worktree root, with any root alias already resolved. */
  readonly root: string
  /** Canonical-root-relative target path. It may not exist yet. */
  readonly path: string
  readonly exists: boolean
}

export interface IWorktreeSafetyScanOptions {
  readonly maximumEntries?: number
  readonly maximumDepth?: number
}

interface IPhysicalWorktreeContext {
  readonly root: string
  readonly gitStorage: ReadonlyArray<string>
  readonly gitlinks: ReadonlySet<string>
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new WorktreePathSafetyError('aborted', 'Request cancelled.')
  }
}

function getAbortableProcessCallback(signal?: AbortSignal) {
  if (signal === undefined) {
    return undefined
  }

  return (process: ChildProcess) => {
    const abort = () => {
      if (!process.killed) {
        process.kill()
      }
    }
    const cleanup = () => signal.removeEventListener('abort', abort)

    if (signal.aborted) {
      abort()
    } else {
      signal.addEventListener('abort', abort, { once: true })
      process.once('exit', cleanup)
      process.once('error', cleanup)
    }
  }
}

function isWithin(root: string, target: string): boolean {
  const relative = Path.relative(root, target)
  return (
    relative.length === 0 ||
    (relative !== '..' &&
      !relative.startsWith(`..${Path.sep}`) &&
      !Path.isAbsolute(relative))
  )
}

function samePath(first: string, second: string): boolean {
  return Path.relative(first, second).length === 0
}

function parseGitPathOutput(output: string, label: string): string {
  const value = output.replace(/\r?\n$/, '')
  if (
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\r') ||
    value.includes('\n')
  ) {
    throw new WorktreePathSafetyError(
      'invalid-repository',
      `Git returned an invalid ${label}.`
    )
  }
  return value
}

async function readGitPath(
  repositoryPath: string,
  args: ReadonlyArray<string>,
  label: string,
  signal?: AbortSignal
): Promise<string> {
  throwIfAborted(signal)
  const result = await git([...args], repositoryPath, 'guardRepositoryPath', {
    maxBuffer: RepositoryPathProbeOutputLimit,
    processCallback: getAbortableProcessCallback(signal),
  })
  throwIfAborted(signal)
  return parseGitPathOutput(result.stdout, label)
}

async function canonicalizeExistingPath(
  value: string,
  label: string
): Promise<string> {
  try {
    return await realpath(value)
  } catch {
    throw new WorktreePathSafetyError(
      'invalid-repository',
      `The repository ${label} is no longer available.`
    )
  }
}

async function getPhysicalWorktreeRoot(
  repositoryPath: string,
  signal?: AbortSignal
): Promise<string> {
  const topLevel = await readGitPath(
    repositoryPath,
    ['rev-parse', '--show-toplevel'],
    'worktree root',
    signal
  )
  const logicalRoot = Path.resolve(repositoryPath, topLevel)
  const root = await canonicalizeExistingPath(logicalRoot, 'worktree root')
  let rootStat
  try {
    rootStat = await lstat(root)
  } catch {
    throw new WorktreePathSafetyError(
      'invalid-repository',
      'The repository worktree root is no longer available.'
    )
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new WorktreePathSafetyError(
      'invalid-repository',
      'The repository worktree root is not a physical directory.'
    )
  }
  return root
}

function normalizeRelativePath(value: string): ReadonlyArray<string> {
  if (value.length === 0 || value.includes('\0') || Path.isAbsolute(value)) {
    throw new WorktreePathSafetyError(
      'path-escape',
      'Choose a path inside this repository.'
    )
  }

  const segments = value.replace(/\\/g, '/').split('/')
  if (
    segments.some(
      segment => segment.length === 0 || segment === '.' || segment === '..'
    )
  ) {
    throw new WorktreePathSafetyError(
      'path-escape',
      'Choose a path inside this repository.'
    )
  }
  return segments
}

/**
 * Resolve a repository-relative path beneath the physical worktree root. Every
 * existing component is inspected without following links. Missing targets are
 * allowed so a reviewed tracked file can be restored safely.
 */
export async function resolveSafeRepositoryPath(
  repositoryPath: string,
  relativePath: string,
  signal?: AbortSignal
): Promise<IPhysicalRepositoryPath> {
  throwIfAborted(signal)
  const root = await getPhysicalWorktreeRoot(repositoryPath, signal)
  const segments = normalizeRelativePath(relativePath)
  const target = Path.join(root, ...segments)
  if (!isWithin(root, target)) {
    throw new WorktreePathSafetyError(
      'path-escape',
      'Choose a path inside this repository.'
    )
  }

  let current = root
  for (let index = 0; index < segments.length; index++) {
    throwIfAborted(signal)
    current = Path.join(current, segments[index])
    let stat
    try {
      stat = await lstat(current)
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        return { root, path: target, exists: false }
      }
      throw new WorktreePathSafetyError(
        'scan-error',
        'Desktop could not inspect the selected repository path safely.'
      )
    }

    if (stat.isSymbolicLink()) {
      throw new WorktreePathSafetyError(
        'reparse-point',
        'The selected path crosses a symbolic link or junction.'
      )
    }

    let physical
    try {
      physical = await realpath(current)
    } catch {
      throw new WorktreePathSafetyError(
        'scan-error',
        'Desktop could not resolve the selected repository path safely.'
      )
    }
    if (!isWithin(root, physical) || !samePath(current, physical)) {
      throw new WorktreePathSafetyError(
        'reparse-point',
        'The selected path crosses a symbolic link or junction.'
      )
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      return { root, path: target, exists: false }
    }
  }

  return { root, path: target, exists: true }
}

function parseGitlinks(output: string): ReadonlySet<string> {
  const gitlinks = new Set<string>()
  for (const record of output.split('\0')) {
    if (record.length === 0) {
      continue
    }
    const match = /^160000 [0-9a-fA-F]{40,64} [0-3]\t([\s\S]+)$/.exec(record)
    if (match !== null) {
      gitlinks.add(match[1].replace(/\\/g, '/'))
    }
  }
  return gitlinks
}

async function getPhysicalWorktreeContext(
  repositoryPath: string,
  signal?: AbortSignal
): Promise<IPhysicalWorktreeContext> {
  throwIfAborted(signal)
  const [root, gitDirectory, commonDirectory, indexResult] = await Promise.all([
    getPhysicalWorktreeRoot(repositoryPath, signal),
    readGitPath(
      repositoryPath,
      ['rev-parse', '--absolute-git-dir'],
      'Git directory',
      signal
    ),
    readGitPath(
      repositoryPath,
      ['rev-parse', '--git-common-dir'],
      'Git common directory',
      signal
    ),
    git(['ls-files', '--stage', '-z'], repositoryPath, 'guardGitlinks', {
      maxBuffer: GitIndexProbeOutputLimit,
      processCallback: getAbortableProcessCallback(signal),
    }).catch(error => {
      if (isMaxBufferExceededError(error)) {
        throw new WorktreePathSafetyError(
          'scan-too-large',
          'The repository index is too large to inspect safely.'
        )
      }
      throw error
    }),
  ])
  throwIfAborted(signal)

  const gitStorage = new Array<string>()
  for (const value of [gitDirectory, commonDirectory]) {
    const resolved = Path.resolve(repositoryPath, value)
    const physical = await canonicalizeExistingPath(resolved, 'Git storage')
    if (!gitStorage.some(existing => samePath(existing, physical))) {
      gitStorage.push(physical)
    }
  }
  return {
    root,
    gitStorage,
    gitlinks: parseGitlinks(indexResult.stdout),
  }
}

function isExactGitStorage(
  path: string,
  gitStorage: ReadonlyArray<string>
): boolean {
  return gitStorage.some(storage => samePath(path, storage))
}

/**
 * Perform a bounded, no-follow walk immediately before a Git command that can
 * add, remove, or rewrite working-tree paths. Exact Git storage and populated
 * gitlink worktrees are not descended into.
 */
export async function assertSafeWorktreeMutation(
  repositoryPath: string,
  signal?: AbortSignal,
  options: IWorktreeSafetyScanOptions = {}
): Promise<void> {
  const maximumEntries = options.maximumEntries ?? WorktreeSafetyEntryLimit
  const maximumDepth = options.maximumDepth ?? WorktreeSafetyDepthLimit
  if (
    !Number.isSafeInteger(maximumEntries) ||
    maximumEntries < 1 ||
    !Number.isSafeInteger(maximumDepth) ||
    maximumDepth < 1
  ) {
    throw new WorktreePathSafetyError(
      'scan-error',
      'The worktree safety limits are invalid.'
    )
  }

  const context = await getPhysicalWorktreeContext(repositoryPath, signal)
  const pending = [{ path: context.root, relative: '', depth: 0 }]
  let inspectedEntries = 0

  while (pending.length > 0) {
    throwIfAborted(signal)
    const directory = pending.pop()!
    let directoryStat
    let physicalDirectory
    try {
      directoryStat = await lstat(directory.path)
      physicalDirectory = await realpath(directory.path)
    } catch {
      throw new WorktreePathSafetyError(
        'scan-error',
        'The worktree changed while Desktop was checking it safely.'
      )
    }
    if (
      directoryStat.isSymbolicLink() ||
      !directoryStat.isDirectory() ||
      !samePath(directory.path, physicalDirectory) ||
      !isWithin(context.root, physicalDirectory)
    ) {
      throw new WorktreePathSafetyError(
        'reparse-point',
        'The worktree contains a symbolic link, junction, or redirected directory.'
      )
    }

    let entries
    try {
      entries = await readdir(directory.path, { withFileTypes: true })
    } catch {
      throw new WorktreePathSafetyError(
        'scan-error',
        'Desktop could not complete the worktree safety scan.'
      )
    }

    for (const entry of entries) {
      throwIfAborted(signal)
      inspectedEntries++
      if (inspectedEntries > maximumEntries) {
        throw new WorktreePathSafetyError(
          'scan-too-large',
          `The worktree contains more than ${maximumEntries.toLocaleString()} entries to inspect safely.`
        )
      }

      const child = Path.join(directory.path, entry.name)
      const relative =
        directory.relative.length === 0
          ? entry.name
          : `${directory.relative}/${entry.name}`
      let childStat
      let physicalChild
      try {
        childStat = await lstat(child)
        physicalChild = await realpath(child)
      } catch {
        throw new WorktreePathSafetyError(
          'scan-error',
          'The worktree changed while Desktop was checking it safely.'
        )
      }

      if (
        childStat.isSymbolicLink() ||
        !samePath(child, physicalChild) ||
        !isWithin(context.root, physicalChild)
      ) {
        throw new WorktreePathSafetyError(
          'reparse-point',
          `Sparse checkout stopped because ${relative} is a symbolic link, junction, or redirected path.`
        )
      }

      if (!childStat.isDirectory()) {
        continue
      }
      if (
        isExactGitStorage(physicalChild, context.gitStorage) ||
        context.gitlinks.has(relative.replace(/\\/g, '/'))
      ) {
        continue
      }
      if (directory.depth + 1 > maximumDepth) {
        throw new WorktreePathSafetyError(
          'scan-too-large',
          `The worktree is deeper than ${maximumDepth.toLocaleString()} directories to inspect safely.`
        )
      }
      pending.push({
        path: child,
        relative,
        depth: directory.depth + 1,
      })
    }
  }
  throwIfAborted(signal)
}
