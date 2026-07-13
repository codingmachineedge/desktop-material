import { git, GitError } from './core'
import * as Path from 'path'
import { ChildProcess } from 'child_process'
import { Repository } from '../../models/repository'
import {
  IStashEntry,
  StashedChangesLoadStates,
  StashedFileChanges,
} from '../../models/stash-entry'
import {
  WorkingDirectoryFileChange,
  CommittedFileChange,
} from '../../models/status'
import { parseRawLogWithNumstat } from './log'
import { stageFiles } from './update-index'
import { Branch } from '../../models/branch'
import { createLogParser } from './git-delimiter-parser'
import { coerceToString } from './coerce-to-string'

export const DesktopStashEntryMarker = '!!GitHub_Desktop'
export const DesktopMaterialStashEntryMarker = '!!Desktop_Material_Stash_v2:'

/** Keep repository-wide stash inventory and metadata reads bounded. */
export const MaximumStashEntries = 500
export const MaximumReviewedStashes = 100
export const MaximumStashDisplayNameLength = 120
const MaximumStashDisplayNameBytes = 512
const MaximumBranchNameBytes = 1024
const MaximumSelectedPaths = 500
const MaximumSelectedPathBytes = 64 * 1024
const StashInventoryOutputLimit = 4 * 1024 * 1024

/**
 * RegEx for determining if a stash entry is created by Desktop
 *
 * This is done by looking for a magic string with the following
 * format: `!!GitHub_Desktop<branch>`
 */
const desktopStashEntryMessageRe = /!!GitHub_Desktop<(.+)>$/
const desktopMaterialStashEntryMessageRe =
  /!!Desktop_Material_Stash_v2:([^:\r\n]+):([^\r\n]*)$/

export type StashManagerErrorKind =
  | 'aborted'
  | 'invalid-input'
  | 'stale-entry'
  | 'too-many'

export class StashManagerError extends Error {
  public constructor(
    public readonly kind: StashManagerErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'StashManagerError'
  }
}

export type StashResult = {
  /** The stash entries created by Desktop */
  readonly desktopEntries: ReadonlyArray<IStashEntry>

  /**
   * The total amount of stash entries,
   * i.e. stash entries created both by Desktop and outside of Desktop
   */
  readonly stashEntryCount: number

  /** Entries not carrying a recognized Desktop marker in the bounded page. */
  readonly foreignStashEntryCount: number

  /** Whether more stash reflog entries exist beyond the bounded inventory. */
  readonly isTruncated: boolean
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new StashManagerError('aborted', 'Stash operation cancelled.')
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

function stashGitOptions(signal?: AbortSignal) {
  return {
    maxBuffer: StashInventoryOutputLimit,
    processCallback: getAbortableProcessCallback(signal),
  }
}

/**
 * Get the list of stash entries created by Desktop in the current repository
 * using the default ordering of refs (which is LIFO ordering),
 * as well as the total amount of stash entries.
 */
export async function getStashes(
  repository: Repository,
  signal?: AbortSignal
): Promise<StashResult> {
  throwIfAborted(signal)
  const { formatArgs, parse } = createLogParser({
    name: '%gD',
    stashSha: '%H',
    message: '%gs',
    tree: '%T',
    parents: '%P',
    createdAt: '%cI',
  })

  const result = await git(
    [
      'log',
      '-g',
      `--max-count=${MaximumStashEntries + 1}`,
      ...formatArgs,
      'refs/stash',
      '--',
    ],
    repository.path,
    'getStashEntries',
    {
      ...stashGitOptions(signal),
      successExitCodes: new Set([0, 128]),
    }
  )

  throwIfAborted(signal)

  // There's no refs/stashes reflog in the repository or it's not
  // even a repository. In either case we don't care
  if (result.exitCode === 128) {
    return {
      desktopEntries: [],
      stashEntryCount: 0,
      foreignStashEntryCount: 0,
      isTruncated: false,
    }
  }

  const desktopEntries: Array<IStashEntry> = []
  const files: StashedFileChanges = { kind: StashedChangesLoadStates.NotLoaded }

  const parsedEntries = parse(result.stdout)
  const isTruncated = parsedEntries.length > MaximumStashEntries
  const entries = parsedEntries.slice(0, MaximumStashEntries)

  for (const { name, message, stashSha, tree, parents, createdAt } of entries) {
    const metadata = extractDesktopMetadataFromMessage(message)

    if (metadata !== null) {
      desktopEntries.push({
        name,
        stashSha,
        branchName: metadata.branchName,
        displayName: metadata.displayName,
        createdAt: normalizeCreatedAt(createdAt),
        tree,
        parents: parents.length > 0 ? parents.split(' ') : [],
        files,
      })
    }
  }

  return {
    desktopEntries,
    stashEntryCount: entries.length,
    foreignStashEntryCount: entries.length - desktopEntries.length,
    isTruncated,
  }
}

function decodeMetadataComponent(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function normalizeCreatedAt(value: string): string | null {
  if (value.length > 64 || /[\r\n\0]/.test(value)) {
    return null
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function extractDesktopMetadataFromMessage(
  message: string
): { readonly branchName: string; readonly displayName: string | null } | null {
  const materialMatch = desktopMaterialStashEntryMessageRe.exec(message)
  if (materialMatch !== null) {
    const branchName = decodeMetadataComponent(materialMatch[1])
    const displayName = decodeMetadataComponent(materialMatch[2])
    if (
      branchName === null ||
      displayName === null ||
      branchName.length === 0
    ) {
      return null
    }
    try {
      return {
        branchName: normalizeStashBranchName(branchName),
        displayName: normalizeStashDisplayName(displayName),
      }
    } catch {
      return null
    }
  }

  const legacyMatch = desktopStashEntryMessageRe.exec(message)
  if (legacyMatch === null || legacyMatch[1].length === 0) {
    return null
  }
  try {
    return {
      branchName: normalizeStashBranchName(legacyMatch[1]),
      displayName: null,
    }
  } catch {
    return null
  }
}

export function normalizeStashDisplayName(value: string): string {
  const normalized = value.trim()
  if (
    normalized.length === 0 ||
    Array.from(normalized).length > MaximumStashDisplayNameLength ||
    Buffer.byteLength(normalized, 'utf8') > MaximumStashDisplayNameBytes ||
    /[\0-\x1f\x7f]/.test(normalized)
  ) {
    throw new StashManagerError(
      'invalid-input',
      `Stash names must be 1–${MaximumStashDisplayNameLength} printable characters.`
    )
  }
  return normalized
}

export function normalizeStashBranchName(value: string): string {
  const normalized = value.trim()
  if (
    normalized.length === 0 ||
    Buffer.byteLength(normalized, 'utf8') > MaximumBranchNameBytes ||
    /[\0-\x1f\x7f]/.test(normalized)
  ) {
    throw new StashManagerError(
      'invalid-input',
      'Choose a valid, bounded branch name.'
    )
  }
  return normalized
}

function normalizeStashSHA(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(normalized)) {
    throw new StashManagerError(
      'invalid-input',
      'The selected stash no longer has a valid object identity.'
    )
  }
  return normalized
}

function normalizeSelectedPaths(
  paths: ReadonlyArray<string>
): ReadonlyArray<string> {
  if (paths.length > MaximumSelectedPaths) {
    throw new StashManagerError(
      'too-many',
      `Select at most ${MaximumSelectedPaths} paths for one stash.`
    )
  }

  const unique = new Set<string>()
  let totalBytes = 0
  for (const candidate of paths) {
    if (
      candidate.length === 0 ||
      Path.isAbsolute(candidate) ||
      /^[a-zA-Z]:[\\/]/.test(candidate) ||
      /[\0\r\n]/.test(candidate) ||
      candidate.split(/[\\/]/).some(part => part === '..')
    ) {
      throw new StashManagerError(
        'invalid-input',
        'A selected path is outside the repository or is not safe to pass to Git.'
      )
    }
    totalBytes += Buffer.byteLength(candidate, 'utf8')
    if (totalBytes > MaximumSelectedPathBytes) {
      throw new StashManagerError(
        'too-many',
        'The selected path list is too large for one stash operation.'
      )
    }
    unique.add(candidate)
  }
  return [...unique]
}

async function validateBranchNameWithGit(
  repository: Repository,
  branchName: string,
  signal?: AbortSignal
): Promise<string> {
  const normalized = normalizeStashBranchName(branchName)
  try {
    await git(
      ['check-ref-format', '--branch', normalized],
      repository.path,
      'validateStashBranchName',
      stashGitOptions(signal)
    )
  } catch (error) {
    throwIfAborted(signal)
    throw new StashManagerError(
      'invalid-input',
      'Choose a branch name accepted by Git.'
    )
  }
  return normalized
}

async function requireDesktopStashEntry(
  repository: Repository,
  stashSha: string,
  signal?: AbortSignal
): Promise<IStashEntry> {
  const normalizedSha = normalizeStashSHA(stashSha)
  const stash = await getStashes(repository, signal)
  const entry = stash.desktopEntries.find(e => e.stashSha === normalizedSha)
  if (entry === undefined) {
    throw new StashManagerError(
      'stale-entry',
      'That Desktop-managed stash changed or no longer exists. Refresh and review the current list.'
    )
  }
  return entry
}

/**
 * Moves a stash entry to a different branch by means of creating
 * a new stash entry associated with the new branch and dropping the old
 * stash entry.
 */
export async function moveStashEntry(
  repository: Repository,
  stashEntry: IStashEntry,
  branchName: string,
  signal?: AbortSignal
) {
  return updateDesktopStashEntry(
    repository,
    stashEntry.stashSha,
    branchName,
    stashEntry.displayName ?? null,
    signal
  )
}

/** Re-record reviewed metadata without changing the stash tree or parents. */
export async function updateDesktopStashEntry(
  repository: Repository,
  stashSha: string,
  branchName: string,
  displayName: string | null,
  signal?: AbortSignal
): Promise<string> {
  throwIfAborted(signal)
  const normalizedBranch = await validateBranchNameWithGit(
    repository,
    branchName,
    signal
  )
  const normalizedName =
    displayName === null ? null : normalizeStashDisplayName(displayName)
  const liveEntry = await requireDesktopStashEntry(repository, stashSha, signal)
  const marker = createDesktopStashMessage(normalizedBranch, normalizedName)
  const message = `On ${normalizedBranch}: ${marker}`
  const parentArgs = liveEntry.parents.flatMap(p => ['-p', p])

  const { stdout: commitId } = await git(
    [
      'commit-tree',
      ...parentArgs,
      '-m',
      message,
      '--no-gpg-sign',
      liveEntry.tree,
    ],
    repository.path,
    'updateDesktopStashMetadata',
    stashGitOptions(signal)
  )

  await git(
    ['stash', 'store', '-m', message, commitId.trim()],
    repository.path,
    'updateDesktopStashMetadata',
    stashGitOptions(signal)
  )

  await dropReviewedDesktopStashEntry(repository, liveEntry.stashSha, signal)
  return commitId.trim()
}

/**
 * Returns the last Desktop created stash entry for the given branch
 */
export async function getLastDesktopStashEntryForBranch(
  repository: Repository,
  branch: Branch | string
) {
  const stash = await getStashes(repository)
  const branchName = typeof branch === 'string' ? branch : branch.name

  // Since stash objects are returned in a LIFO manner, the first
  // entry found is guaranteed to be the last entry created
  return (
    stash.desktopEntries.find(stash => stash.branchName === branchName) || null
  )
}

/** Creates a stash entry message that indicates the entry was created by Desktop */
export function createDesktopStashMessage(
  branchName: string,
  displayName?: string | null
) {
  if (displayName === undefined || displayName === null) {
    return `${DesktopStashEntryMarker}<${branchName}>`
  }

  return `${DesktopMaterialStashEntryMarker}${encodeURIComponent(
    normalizeStashBranchName(branchName)
  )}:${encodeURIComponent(normalizeStashDisplayName(displayName))}`
}

/**
 * Create a named Desktop Material stash with an explicit all/selected scope.
 * Untracked files are included only when the reviewed option says so.
 */
export async function createNamedDesktopStashEntry(
  repository: Repository,
  branch: Branch | string,
  displayName: string,
  selectedPaths: ReadonlyArray<string> | null,
  includeUntracked: boolean,
  signal?: AbortSignal
): Promise<boolean> {
  throwIfAborted(signal)
  const branchName = await validateBranchNameWithGit(
    repository,
    typeof branch === 'string' ? branch : branch.name,
    signal
  )
  const safeName = normalizeStashDisplayName(displayName)
  const paths =
    selectedPaths === null ? null : normalizeSelectedPaths(selectedPaths)
  if (paths !== null && paths.length === 0) {
    throw new StashManagerError(
      'invalid-input',
      'Select at least one changed path, or choose all changes.'
    )
  }

  const args = [
    'stash',
    'push',
    '-m',
    createDesktopStashMessage(branchName, safeName),
  ]
  if (includeUntracked) {
    args.push('--include-untracked')
  }
  if (paths !== null) {
    args.push('--', ...paths)
  }

  const result = await git(
    args,
    repository.path,
    'createNamedDesktopStashEntry',
    stashGitOptions(signal)
  )
  throwIfAborted(signal)
  return result.stdout !== 'No local changes to save\n'
}

/**
 * Stash the working directory changes for the current branch
 */
export async function createDesktopStashEntry(
  repository: Repository,
  branch: Branch | string,
  untrackedFilesToStage: ReadonlyArray<WorkingDirectoryFileChange>,
  selectedFiles: ReadonlyArray<string> | null = null
): Promise<boolean> {
  // We must ensure that no untracked files are present before stashing
  // See https://github.com/desktop/desktop/pull/8085
  // First ensure that all changes in file are selected
  // (in case the user has not explicitly checked the checkboxes for the untracked files)
  const fullySelectedUntrackedFiles = untrackedFilesToStage
    .filter(file => selectedFiles === null || selectedFiles.includes(file.path))
    .map(x => x.withIncludeAll(true))
  await stageFiles(repository, fullySelectedUntrackedFiles)

  const branchName = typeof branch === 'string' ? branch : branch.name
  const message = createDesktopStashMessage(branchName)
  const args = ['stash', 'push', '-m', message]
  if (selectedFiles !== null) {
    args.push('--', ...selectedFiles)
  }

  const result = await git(args, repository.path, 'createStashEntry').catch(
    e => {
      // Note: 2024: Here be dragons. As I converted this code to get rid of the
      // successExitCode use I got curious about the assumptions made in the
      // following logic. It assumes that as long as the exit code for `git
      // stash push` is 1 and there are no lines beginning with "error: " then
      // a stash was created. That didn't hold up to a quick read of the stash
      // code. For example, running git stash push in an unborn repository will
      // get you an exit code of 1 but no stash was created:
      //
      // % git stash push -m foo ; echo $?
      // You do not have the initial commit yet
      // 1
      //
      // I'm not going to mess with this now but I felt the need to document
      // my findings should I or any other brave soul choose to tackle this in
      // the future.
      if (e instanceof GitError && e.result.exitCode === 1) {
        // search for any line starting with `error:` -  /m here to ensure this is
        // applied to each line, without needing to split the text
        const errorPrefixRe = /^error: /m

        const matches = errorPrefixRe.exec(coerceToString(e.result.stderr))
        if (matches !== null && matches.length > 0) {
          // rethrow, because these messages should prevent the stash from being created
          return Promise.reject(e)
        }

        // if no error messages were emitted by Git, we should log but continue because
        // a valid stash was created and this should not interfere with the checkout

        log.info(
          `[createDesktopStashEntry] a stash was created successfully but exit code ${result.exitCode} reported. stderr: ${result.stderr}`
        )
        return e.result
      }
      return Promise.reject(e)
    }
  )

  // Stash doesn't consider it an error that there aren't any local changes to save.
  if (result.stdout === 'No local changes to save\n') {
    return false
  }

  return true
}

async function getStashEntryMatchingSha(
  repository: Repository,
  sha: string,
  signal?: AbortSignal
) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(sha.trim())) {
    return null
  }
  const stash = await getStashes(repository, signal)
  return (
    stash.desktopEntries.find(e => e.stashSha === sha.trim().toLowerCase()) ||
    null
  )
}

/**
 * Removes the given stash entry if it exists
 *
 * @param stashSha the SHA that identifies the stash entry
 */
export async function dropDesktopStashEntry(
  repository: Repository,
  stashSha: string,
  signal?: AbortSignal
) {
  const entryToDelete = await getStashEntryMatchingSha(
    repository,
    stashSha,
    signal
  )

  if (entryToDelete !== null) {
    const args = ['stash', 'drop', entryToDelete.name]
    await git(args, repository.path, 'dropStashEntry', stashGitOptions(signal))
  }
}

async function dropReviewedDesktopStashEntry(
  repository: Repository,
  stashSha: string,
  signal?: AbortSignal
): Promise<void> {
  const entry = await requireDesktopStashEntry(repository, stashSha, signal)
  await git(
    ['stash', 'drop', entry.name],
    repository.path,
    'dropReviewedDesktopStashEntry',
    stashGitOptions(signal)
  )
  throwIfAborted(signal)
}

/** Apply one reviewed stash while retaining it in the repository. */
export async function applyDesktopStashEntry(
  repository: Repository,
  stashSha: string,
  signal?: AbortSignal
): Promise<void> {
  const entry = await requireDesktopStashEntry(repository, stashSha, signal)
  try {
    await git(
      ['stash', 'apply', '--quiet', entry.name],
      repository.path,
      'applyDesktopStashEntry',
      stashGitOptions(signal)
    )
  } catch (error) {
    throwIfAborted(signal)
    if (
      error instanceof GitError &&
      error.result.exitCode === 1 &&
      error.result.stderr.length === 0
    ) {
      // Some cleanly applied stash merges return 1 with no diagnostics. Never
      // infer success from that alone: inspect the index and retain the stash
      // whenever an unresolved path exists.
      const unresolved = await git(
        ['diff', '--name-only', '--diff-filter=U', '-z', '--'],
        repository.path,
        'checkStashApplyConflicts',
        stashGitOptions(signal)
      )
      if (unresolved.stdout.length === 0) {
        return
      }
    }
    throw error
  }
}

/**
 * Pops the stash entry identified by matching `stashSha` to its commit hash.
 *
 * To see the commit hash of stash entry, run
 * `git log -g refs/stash --pretty="%nentry: %gd%nsubject: %gs%nhash: %H%n"`
 * in a repo with some stash entries.
 */
export async function popStashEntry(
  repository: Repository,
  stashSha: string,
  signal?: AbortSignal
): Promise<void> {
  const entry = await requireDesktopStashEntry(repository, stashSha, signal)
  await applyDesktopStashEntry(repository, entry.stashSha, signal)
  // Re-resolve by object identity after apply. A conflict throws above and the
  // stash remains available for recovery; only a clean apply reaches this drop.
  await dropReviewedDesktopStashEntry(repository, entry.stashSha, signal)
}

/** Create and check out a new branch from a revalidated stash. */
export async function createBranchFromDesktopStash(
  repository: Repository,
  stashSha: string,
  branchName: string,
  signal?: AbortSignal
): Promise<void> {
  const safeBranch = await validateBranchNameWithGit(
    repository,
    branchName,
    signal
  )
  const ref = `refs/heads/${safeBranch}`
  const existing = await git(
    ['show-ref', '--verify', '--quiet', ref],
    repository.path,
    'checkStashBranchDoesNotExist',
    { ...stashGitOptions(signal), successExitCodes: new Set([0, 1]) }
  )
  if (existing.exitCode === 0) {
    throw new StashManagerError(
      'invalid-input',
      `A local branch named “${safeBranch}” already exists.`
    )
  }

  const entry = await requireDesktopStashEntry(repository, stashSha, signal)
  // Mutation-boundary ref check closes the review/execution race.
  const rechecked = await git(
    ['show-ref', '--verify', '--quiet', ref],
    repository.path,
    'recheckStashBranchDoesNotExist',
    { ...stashGitOptions(signal), successExitCodes: new Set([0, 1]) }
  )
  if (rechecked.exitCode === 0) {
    throw new StashManagerError(
      'stale-entry',
      `The branch “${safeBranch}” appeared after review. Nothing was changed.`
    )
  }
  await requireDesktopStashEntry(repository, entry.stashSha, signal)
  await git(
    ['stash', 'branch', safeBranch, entry.name],
    repository.path,
    'createBranchFromDesktopStash',
    stashGitOptions(signal)
  )
  throwIfAborted(signal)
}

/** Drop only the exact Desktop-managed stashes the user reviewed. */
export async function clearReviewedDesktopStashes(
  repository: Repository,
  reviewedStashShas: ReadonlyArray<string>,
  signal?: AbortSignal
): Promise<number> {
  const reviewed = [...new Set(reviewedStashShas.map(normalizeStashSHA))]
  if (reviewed.length === 0) {
    throw new StashManagerError(
      'invalid-input',
      'Review and select at least one Desktop-managed stash to clear.'
    )
  }
  if (reviewed.length > MaximumReviewedStashes) {
    throw new StashManagerError(
      'too-many',
      `Clear at most ${MaximumReviewedStashes} reviewed stashes at a time.`
    )
  }

  const inventory = await getStashes(repository, signal)
  const managed = new Set(inventory.desktopEntries.map(entry => entry.stashSha))
  for (const sha of reviewed) {
    if (!managed.has(sha)) {
      throw new StashManagerError(
        'stale-entry',
        'The reviewed stash list changed. Nothing was cleared; refresh and review it again.'
      )
    }
  }

  let cleared = 0
  for (const sha of reviewed) {
    await dropReviewedDesktopStashEntry(repository, sha, signal)
    cleared++
  }
  return cleared
}

/** Get the files that were changed in the given stash commit */
export async function getStashedFiles(
  repository: Repository,
  stashSha: string
): Promise<ReadonlyArray<CommittedFileChange>> {
  const args = [
    'stash',
    'show',
    stashSha,
    '--raw',
    '--numstat',
    '-z',
    '--format=format:',
    '--no-show-signature',
    '--',
  ]

  const { stdout } = await git(args, repository.path, 'getStashedFiles')

  return parseRawLogWithNumstat(stdout, stashSha, `${stashSha}^`).files
}
