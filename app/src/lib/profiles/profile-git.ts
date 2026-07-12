import { mkdir, stat, rm } from 'fs/promises'
import { join } from 'path'
import { git } from '../git/core'
import { initGitRepository } from '../git/init'
import { setConfigValue } from '../git/config'
import { getChangedFiles, getCommits } from '../git/log'
import { getCommitDiff } from '../git/diff'
import { Repository } from '../../models/repository'
import { Commit } from '../../models/commit'
import { DiffType, IDiff } from '../../models/diff/diff-data'
import {
  composeProfileCommitMessage,
  IProfileHistoryEntry,
  IProfileHistoryPage,
  ProfileHistoryPageSize,
} from '../../models/profile'

const commitAuthorName = 'Desktop Material'
const commitAuthorEmail = 'desktop-material@localhost'

export const ProfileUndoTrailer = 'Desktop-Material-Undo-Of'
export const ProfileRedoTrailer = 'Desktop-Material-Redo-Of'
export const ProfileRestoreTrailer = 'Desktop-Material-Restore-Of'

const profileStateFiles = ['settings.json', 'tabs.json'] as const
const fullSHA = /^[0-9a-f]{40}$/i

/** Construct a lightweight Repository model pointing at a profile directory. */
export function profileRepository(path: string): Repository {
  return new Repository(path, -1, null, false)
}

/**
 * Ensure a git repository exists at the given path, creating the directory and
 * initializing git on first use. Any stale `index.lock` left behind by a
 * crashed session is removed (safe because Desktop is single-instance).
 */
export async function ensureProfileRepository(
  path: string
): Promise<Repository> {
  await mkdir(path, { recursive: true })

  let initialized = false
  try {
    await stat(join(path, '.git'))
    initialized = true
  } catch {
    initialized = false
  }

  if (!initialized) {
    await initGitRepository(path)
  } else {
    await clearStaleLock(path)
  }

  const repository = profileRepository(path)
  // Git config writes take an exclusive lock, so keep these sequential.
  await setConfigValue(repository, 'user.name', commitAuthorName)
  await setConfigValue(repository, 'user.email', commitAuthorEmail)
  await setConfigValue(repository, 'commit.gpgsign', 'false')

  return repository
}

/** Remove a leftover `.git/index.lock` from a previous crashed session. */
export async function clearStaleLock(path: string): Promise<void> {
  try {
    await rm(join(path, '.git', 'index.lock'), { force: true })
  } catch {
    // Best effort — nothing to do if it can't be removed.
  }
}

/**
 * Stage everything under the profile repository and create a commit when there
 * is something to record. Returns true if a commit was created, false when the
 * working tree was already clean.
 *
 * Author identity and signing are forced on the command line so the commit
 * never depends on (or triggers) the user's global git configuration.
 */
export async function commitAllChanges(
  repository: Repository,
  message: string,
  options: { readonly allowEmpty?: boolean } = {}
): Promise<boolean> {
  const { path } = repository

  await git(['add', '-A'], path, 'profileStage')

  const status = await git(['status', '--porcelain'], path, 'profileStatus')
  if (status.stdout.trim().length === 0 && options.allowEmpty !== true) {
    return false
  }

  const commitArgs = [
    '-c',
    `user.name=${commitAuthorName}`,
    '-c',
    `user.email=${commitAuthorEmail}`,
    '-c',
    'commit.gpgsign=false',
    'commit',
  ]
  if (options.allowEmpty === true) {
    commitArgs.push('--allow-empty')
  }
  commitArgs.push('-m', message)

  await git(commitArgs, path, 'profileCommit')

  return true
}

/**
 * Serializes settings and tab writes into a single debounced commit. Rapid
 * changes within the debounce window collapse into one commit whose message is
 * composed at flush time from the accumulated change descriptions.
 */
export class ProfileCommitQueue {
  private timer: ReturnType<typeof setTimeout> | null = null
  private chain: Promise<void> = Promise.resolve()
  private readonly pending: Array<string> = []

  public constructor(
    private readonly repository: Repository,
    private readonly composeMessage: (
      descriptions: ReadonlyArray<string>
    ) => string = composeProfileCommitMessage,
    private readonly delayMs: number = 1000,
    private readonly enqueueFlush?: (
      flush: () => Promise<void>
    ) => Promise<void>
  ) {}

  /** Record a change and (re)start the debounce timer. */
  public schedule(description: string): void {
    this.pending.push(description)

    if (this.timer !== null) {
      clearTimeout(this.timer)
    }

    this.timer = setTimeout(() => {
      this.timer = null
      const flush = () => this.flush()
      const operation =
        this.enqueueFlush === undefined ? flush() : this.enqueueFlush(flush)
      operation.catch(err => log.error('Failed to commit profile changes', err))
    }, this.delayMs)
  }

  /**
   * Commit any pending changes immediately. Safe to call at any time (e.g. on
   * profile switch or before quit); resolves once the in-flight commit settles.
   */
  public flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }

    this.chain = this.chain
      // A failed batch must not permanently poison the serialization chain.
      // Its descriptions are restored by drainPendingChanges for the retry.
      .catch(() => undefined)
      .then(() => this.drainPendingChanges())

    return this.chain
  }

  private async drainPendingChanges(): Promise<void> {
    while (this.pending.length > 0) {
      if (this.timer !== null) {
        clearTimeout(this.timer)
        this.timer = null
      }

      const descriptions = this.pending.splice(0)
      const message = this.composeMessage(descriptions)

      try {
        await commitAllChanges(this.repository, message)
      } catch (err) {
        this.pending.unshift(...descriptions)
        throw err
      }
    }
  }
}

/** Return one bounded, newest-first page of the profile repository's history. */
export async function getProfileHistory(
  repository: Repository,
  skip: number = 0,
  limit: number = ProfileHistoryPageSize
): Promise<IProfileHistoryPage> {
  const normalizedSkip = normalizeNonNegativeInteger(skip)
  const normalizedLimit = Math.min(
    ProfileHistoryPageSize,
    Math.max(1, normalizeNonNegativeInteger(limit))
  )
  const [commits, allCommits] = await Promise.all([
    getCommits(repository, 'HEAD', normalizedLimit, normalizedSkip),
    getCommits(repository, 'HEAD'),
  ])
  const traversal = buildProfileHistoryTraversal(allCommits)
  const total = allCommits.length

  return {
    entries: commits.map(toProfileHistoryEntry),
    total,
    hasMore: normalizedSkip + commits.length < total,
    canUndo: traversal.undoable.length > 0,
    canRedo: traversal.redoable.length > 0,
  }
}

/** Load changed paths for a commit only when its row is expanded. */
export async function getProfileCommitFiles(
  repository: Repository,
  sha: string
): Promise<ReadonlyArray<string>> {
  await assertReachableProfileCommit(repository, sha)
  const { files } = await getChangedFiles(repository, sha)
  return files.map(file => file.path)
}

/** Load a unified text diff lazily for one path, or all paths in a commit. */
export async function getProfileCommitDiff(
  repository: Repository,
  sha: string,
  path?: string
): Promise<string> {
  await assertReachableProfileCommit(repository, sha)
  const { files } = await getChangedFiles(repository, sha)
  const selected =
    path === undefined ? files : files.filter(file => file.path === path)

  if (path !== undefined && selected.length === 0) {
    throw new Error(`Path ${path} was not changed by profile commit ${sha}`)
  }

  const rendered = await Promise.all(
    selected.map(async file =>
      renderProfileDiff(await getCommitDiff(repository, file, sha), file.path)
    )
  )
  return rendered.filter(diff => diff.length > 0).join('\n')
}

/** Revert the latest active logical change and append a linked audit commit. */
export async function undoLastProfileChange(
  repository: Repository
): Promise<void> {
  const traversal = await getProfileHistoryTraversal(repository)
  const head = traversal.head
  const target = traversal.undoable.at(-1)
  if (head === null || target === undefined) {
    throw new Error('There is no profile change to undo')
  }

  await runProfileHistoryMutation(
    repository,
    head.sha,
    () => revertWithoutCommitting(repository, target.sha),
    operationMessage(`Undo ${target.summary}`, ProfileUndoTrailer, target.sha)
  )
}

/** Reapply the latest logically undone change and append a linked audit commit. */
export async function redoLastProfileChange(
  repository: Repository
): Promise<void> {
  const traversal = await getProfileHistoryTraversal(repository)
  const head = traversal.head
  const target = traversal.redoable.at(-1)
  if (head === null || target === undefined) {
    throw new Error('The latest profile change cannot be redone')
  }

  await runProfileHistoryMutation(
    repository,
    head.sha,
    () => revertWithoutCommitting(repository, target.undo.sha),
    operationMessage(
      `Redo ${target.change.summary}`,
      ProfileRedoTrailer,
      target.undo.sha
    )
  )
}

/**
 * Restore Git-backed state files from a commit and append an audit commit.
 *
 * The set of files to restore defaults to the settings profile's own state
 * files, but callers backing other stores (e.g. the notification centre) pass
 * their own file list so the same non-destructive restore mechanism applies.
 */
export async function restoreProfileTo(
  repository: Repository,
  sha: string,
  stateFiles: ReadonlyArray<string> = profileStateFiles
): Promise<void> {
  await assertReachableProfileCommit(repository, sha)
  const traversal = await getProfileHistoryTraversal(repository)
  const head = traversal.head
  if (head === null) {
    throw new Error('There is no profile history to restore')
  }

  await runProfileHistoryMutation(
    repository,
    head.sha,
    async () => {
      for (const file of stateFiles) {
        if (await profileFileExistsAtCommit(repository, sha, file)) {
          await git(
            ['checkout', sha, '--', file],
            repository.path,
            'profileRestoreFile'
          )
        } else {
          await rm(join(repository.path, file), { force: true })
        }
      }
    },
    operationMessage(
      `Restore profile to ${sha.slice(0, 7)}`,
      ProfileRestoreTrailer,
      sha
    )
  )
}

interface IProfileRedoTarget {
  readonly change: Commit
  readonly undo: Commit
}

interface IProfileHistoryTraversal {
  readonly head: Commit | null
  readonly undoable: ReadonlyArray<Commit>
  readonly redoable: ReadonlyArray<IProfileRedoTarget>
}

/**
 * Replay audit trailers from oldest to newest to derive the logical state.
 * Undo and redo commits remain in Git history, but are not themselves treated
 * as user changes. A new ordinary (or restore) commit starts a new branch of
 * logical history and therefore invalidates the redo stack.
 */
function buildProfileHistoryTraversal(
  newestFirst: ReadonlyArray<Commit>
): IProfileHistoryTraversal {
  const undoable = new Array<Commit>()
  const redoable = new Array<IProfileRedoTarget>()

  for (const commit of [...newestFirst].reverse()) {
    const undoOf = trailerValue(commit, ProfileUndoTrailer)
    if (undoOf !== null) {
      const target = undoable.at(-1)
      if (target !== undefined && target.sha === undoOf) {
        undoable.pop()
        redoable.push({ change: target, undo: commit })
      }
      continue
    }

    const redoOf = trailerValue(commit, ProfileRedoTrailer)
    if (redoOf !== null) {
      const target = redoable.at(-1)
      if (target !== undefined && target.undo.sha === redoOf) {
        redoable.pop()
        undoable.push(target.change)
      }
      continue
    }

    redoable.length = 0
    if (commit.parentSHAs.length > 0) {
      undoable.push(commit)
    }
  }

  return {
    head: newestFirst[0] ?? null,
    undoable,
    redoable,
  }
}

async function getProfileHistoryTraversal(
  repository: Repository
): Promise<IProfileHistoryTraversal> {
  return buildProfileHistoryTraversal(await getCommits(repository, 'HEAD'))
}

function toProfileHistoryEntry(commit: Commit): IProfileHistoryEntry {
  return {
    sha: commit.sha,
    shortSha: commit.shortSha,
    summary: commit.summary,
    body: commit.body,
    committedAt: commit.committer.date,
    undoOf: trailerValue(commit, ProfileUndoTrailer),
    redoOf: trailerValue(commit, ProfileRedoTrailer),
    restoreOf: trailerValue(commit, ProfileRestoreTrailer),
  }
}

function trailerValue(commit: Commit, token: string): string | null {
  return (
    commit.trailers.find(
      trailer => trailer.token.toLowerCase() === token.toLowerCase()
    )?.value ?? null
  )
}

function operationMessage(subject: string, trailer: string, sha: string) {
  return `${subject}\n\n${trailer}: ${sha}`
}

async function assertReachableProfileCommit(
  repository: Repository,
  sha: string
): Promise<void> {
  if (!fullSHA.test(sha)) {
    throw new Error('Profile history requires a full commit SHA')
  }

  const result = await git(
    ['merge-base', '--is-ancestor', sha, 'HEAD'],
    repository.path,
    'profileValidateCommit',
    { successExitCodes: new Set([0, 1, 128]) }
  )
  if (result.exitCode !== 0) {
    throw new Error(`Commit ${sha} is not in the active profile history`)
  }
}

async function revertWithoutCommitting(
  repository: Repository,
  sha: string
): Promise<void> {
  await git(['revert', '--no-commit', sha], repository.path, 'profileRevert')
}

/**
 * Keep an audited mutation atomic. Both a failed worktree mutation and a
 * failed audit commit restore HEAD, the index, and tracked profile files to
 * their exact pre-operation state.
 */
async function runProfileHistoryMutation(
  repository: Repository,
  originalHead: string,
  mutate: () => Promise<void>,
  message: string
): Promise<void> {
  try {
    await mutate()
    await commitAllChanges(repository, message, { allowEmpty: true })
  } catch (err) {
    try {
      await git(
        ['reset', '--hard', originalHead],
        repository.path,
        'profileHistoryRollback'
      )
    } catch (rollbackError) {
      log.error('Failed to roll back profile history mutation', rollbackError)
    }
    throw err
  }
}

async function profileFileExistsAtCommit(
  repository: Repository,
  sha: string,
  path: string
): Promise<boolean> {
  const result = await git(
    ['cat-file', '-e', `${sha}:${path}`],
    repository.path,
    'profileFileAtCommit',
    { successExitCodes: new Set([0, 1, 128]) }
  )
  return result.exitCode === 0
}

function renderProfileDiff(diff: IDiff, path: string): string {
  switch (diff.kind) {
    case DiffType.Text:
    case DiffType.LargeText:
      return diff.text
    case DiffType.Binary:
      return `Binary file ${path} changed.`
    case DiffType.Image:
      return `Image file ${path} changed.`
    case DiffType.Submodule:
      return `Submodule ${path} changed.`
    case DiffType.Unrenderable:
      return `Diff for ${path} cannot be rendered.`
  }
}

function normalizeNonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}
