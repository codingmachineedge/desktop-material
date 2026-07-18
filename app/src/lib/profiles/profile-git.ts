import { appendFile, mkdir, open, readFile, stat, rm } from 'fs/promises'
import { join } from 'path'
import { git } from '../git/core'
import { initGitRepository } from '../git/init'
import { setConfigValue } from '../git/config'
import { getChangedFiles, getCommits } from '../git/log'
import { getCommitDiff } from '../git/diff'
import { Repository } from '../../models/repository'
import { Commit } from '../../models/commit'
import { DiffType, IDiff } from '../../models/diff/diff-data'
import { CrashSafePersistenceGitIgnorePattern } from '../crash-safe-file'
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
const ProfileLockRetryMs = 25
const ProfileLockWaitMs = 5000
const ProfileLockStaleMs = 30000
const ProfileHistoryScanBatchSize = 100
const ProfileTabsPath = 'tabs.json'

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

  const repository = profileRepository(path)
  await withProfileRepositoryLock(repository, async () => {
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

    await ensureCrashSafePersistenceIgnored(path)

    // Git config writes take an exclusive lock, so keep these sequential.
    await setConfigValue(repository, 'user.name', commitAuthorName)
    await setConfigValue(repository, 'user.email', commitAuthorEmail)
    await setConfigValue(repository, 'commit.gpgsign', 'false')
  })

  return repository
}

async function ensureCrashSafePersistenceIgnored(path: string): Promise<void> {
  const infoPath = join(path, '.git', 'info')
  const excludePath = join(infoPath, 'exclude')
  await mkdir(infoPath, { recursive: true })
  const existing = await readFile(excludePath, 'utf8').catch(error => {
    if (isFileSystemError(error, 'ENOENT')) {
      return ''
    }
    throw error
  })
  if (
    existing
      .split(/\r?\n/g)
      .some(line => line.trim() === CrashSafePersistenceGitIgnorePattern)
  ) {
    return
  }
  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n'
  await appendFile(
    excludePath,
    `${prefix}${CrashSafePersistenceGitIgnorePattern}\n`,
    'utf8'
  )
}

/**
 * Serialize profile file and Git mutations across renderer processes. Each app
 * window owns a separate ProfileStore, so an in-memory promise queue alone is
 * insufficient once multi-window support is enabled.
 */
export async function withProfileRepositoryLock<T>(
  repository: Repository,
  action: () => Promise<T>
): Promise<T> {
  const lockPath = `${repository.path}.desktop-material.lock`
  const startedAt = Date.now()

  while (true) {
    try {
      const handle = await open(lockPath, 'wx')
      try {
        await handle.writeFile(String(process.pid), 'utf8')
        return await action()
      } finally {
        await handle.close()
        await rm(lockPath, { force: true })
      }
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error
      }

      if (await isAbandonedProfileLock(lockPath)) {
        await rm(lockPath, { force: true })
        continue
      }

      if (Date.now() - startedAt >= ProfileLockWaitMs) {
        throw new Error(`Timed out waiting for profile lock at ${lockPath}`)
      }
      await new Promise(resolve => setTimeout(resolve, ProfileLockRetryMs))
    }
  }
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  )
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}

async function isAbandonedProfileLock(lockPath: string): Promise<boolean> {
  try {
    const [contents, lockStat] = await Promise.all([
      readFile(lockPath, 'utf8'),
      stat(lockPath),
    ])
    if (Date.now() - lockStat.mtimeMs >= ProfileLockStaleMs) {
      return true
    }

    const ownerPid = Number(contents)
    if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
      return false
    }
    try {
      process.kill(ownerPid, 0)
      return false
    } catch (error) {
      return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ESRCH'
      )
    }
  } catch {
    return false
  }
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

/** Restricts a history read to commits relevant to one profile subject. */
export interface IProfileHistoryFilter {
  /**
   * Show only commits where this tab's serialized object or presence differs
   * from its first parent. The id is always compared as a literal string.
   */
  readonly tabId: string
}

/** Return one bounded, newest-first page of the profile repository's history. */
export async function getProfileHistory(
  repository: Repository,
  skip: number = 0,
  limit: number = ProfileHistoryPageSize,
  filter?: IProfileHistoryFilter
): Promise<IProfileHistoryPage> {
  const normalizedSkip = normalizeNonNegativeInteger(skip)
  const normalizedLimit = Math.min(
    ProfileHistoryPageSize,
    Math.max(1, normalizeNonNegativeInteger(limit))
  )

  if (filter !== undefined) {
    return getTabProfileHistory(
      repository,
      normalizedSkip,
      normalizedLimit,
      filter.tabId
    )
  }

  const [commits, allCommits] = await Promise.all([
    getCommits(repository, 'HEAD', normalizedLimit, normalizedSkip),
    getCommits(repository, 'HEAD'),
  ])
  const total = allCommits.length

  const traversal = buildProfileHistoryTraversal(allCommits)

  return {
    entries: commits.map(toProfileHistoryEntry),
    total,
    hasMore: normalizedSkip + commits.length < total,
    canUndo: traversal.undoable.length > 0,
    canRedo: traversal.redoable.length > 0,
  }
}

/**
 * Return an exact tab-scoped page without retaining the complete timeline.
 *
 * The pathspec first removes commits that cannot have changed a tab object.
 * Candidate commits are then processed in fixed-size batches. For each commit
 * we batch-read `tabs.json` at that commit and its first parent, find the tab by
 * literal id, and compare `JSON.stringify` output. This catches style and label
 * edits where the id line itself is unchanged while excluding changes to other
 * tabs, active-tab state, and array order.
 *
 * The complete candidate history still has to be scanned to produce the exact
 * `total`, but only one batch of commits/blobs and the requested page are held
 * at a time. Profile repositories are linear in normal operation; first-parent
 * comparison also gives merge commits an unambiguous commit boundary.
 */
async function getTabProfileHistory(
  repository: Repository,
  skip: number,
  limit: number,
  tabId: string
): Promise<IProfileHistoryPage> {
  const entries = new Array<IProfileHistoryEntry>()
  let candidateSkip = 0
  let total = 0

  while (true) {
    // getCommits appends its own trailing `--`; after this explicit separator
    // that becomes a harmless second literal pathspec.
    const candidates = await getCommits(
      repository,
      'HEAD',
      ProfileHistoryScanBatchSize,
      candidateSkip,
      ['--full-history', '--', ProfileTabsPath]
    )
    if (candidates.length === 0) {
      break
    }

    const snapshots = await readProfileTabsSnapshots(repository, candidates)
    for (const commit of candidates) {
      const current = serializedTabAtSnapshot(snapshots.get(commit.sha), tabId)
      const parentSha = commit.parentSHAs[0]
      const parent =
        parentSha === undefined
          ? null
          : serializedTabAtSnapshot(snapshots.get(parentSha), tabId)

      if (current === parent) {
        continue
      }

      if (total >= skip && entries.length < limit) {
        entries.push(toProfileHistoryEntry(commit))
      }
      total++
    }

    candidateSkip += candidates.length
    if (candidates.length < ProfileHistoryScanBatchSize) {
      break
    }
  }

  return {
    entries,
    total,
    hasMore: skip + entries.length < total,
    // Scoped history is intentionally read-only because mutations apply to
    // the whole profile rather than to a single tab.
    canUndo: false,
    canRedo: false,
  }
}

/** Read current and first-parent tabs.json blobs with one Git process. */
async function readProfileTabsSnapshots(
  repository: Repository,
  commits: ReadonlyArray<Commit>
): Promise<ReadonlyMap<string, string | null>> {
  const refs = new Set<string>()
  for (const commit of commits) {
    refs.add(commit.sha)
    const parentSha = commit.parentSHAs[0]
    if (parentSha !== undefined) {
      refs.add(parentSha)
    }
  }

  const orderedRefs = [...refs]
  const result = await git(
    ['cat-file', '--batch'],
    repository.path,
    'profileTabsHistorySnapshots',
    {
      encoding: 'buffer',
      stdin: `${orderedRefs
        .map(ref => `${ref}:${ProfileTabsPath}`)
        .join('\n')}\n`,
    }
  )

  return parseProfileTabsSnapshots(result.stdout, orderedRefs)
}

/** Parse `git cat-file --batch` output in request order. */
function parseProfileTabsSnapshots(
  output: Buffer,
  refs: ReadonlyArray<string>
): ReadonlyMap<string, string | null> {
  const snapshots = new Map<string, string | null>()
  let offset = 0

  for (const ref of refs) {
    const headerEnd = output.indexOf(0x0a, offset)
    if (headerEnd < 0) {
      throw new Error('Unexpected end of profile tabs history batch')
    }

    const header = output.toString('utf8', offset, headerEnd)
    offset = headerEnd + 1
    if (header.endsWith(' missing')) {
      snapshots.set(ref, null)
      continue
    }

    const match = /^[0-9a-f]+ blob ([0-9]+)$/.exec(header)
    if (match === null) {
      throw new Error(`Unexpected profile tabs history object: ${header}`)
    }

    const size = Number(match[1])
    const contentEnd = offset + size
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      contentEnd >= output.length ||
      output[contentEnd] !== 0x0a
    ) {
      throw new Error('Invalid profile tabs history object size')
    }

    snapshots.set(ref, output.toString('utf8', offset, contentEnd))
    offset = contentEnd + 1
  }

  return snapshots
}

/** Return the selected tab object's exact JSON serialization, or absence. */
function serializedTabAtSnapshot(
  contents: string | null | undefined,
  tabId: string
): string | null {
  if (contents === null || contents === undefined) {
    return null
  }

  let file: unknown
  try {
    file = JSON.parse(contents)
  } catch {
    return null
  }

  if (!isRecord(file)) {
    return null
  }

  const states = [
    file,
    ...(isRecord(file.windows) ? Object.values(file.windows) : []),
  ]
  for (const state of states) {
    if (!isRecord(state) || !Array.isArray(state.tabs)) {
      continue
    }
    const tab = state.tabs.find(value => isRecord(value) && value.id === tabId)
    if (tab !== undefined) {
      return JSON.stringify(tab)
    }
  }

  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
