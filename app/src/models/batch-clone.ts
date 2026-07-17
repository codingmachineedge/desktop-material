import * as Path from 'path'
import { URL } from 'url'
import { parseRepositoryIdentifier } from '../lib/remote-parsing'

/** How a batch of repositories should be cloned. */
export enum BatchCloneMode {
  /** Clone several repositories concurrently (bounded by the parallel limit). */
  Parallel = 'parallel',
  /** Clone repositories one at a time in order. */
  Sequential = 'sequential',
}

/** The maximum number of concurrent clones when running in parallel mode. */
export const BatchCloneParallelLimit = 3

/** Defensive queue/input limits shared by persistence and execution. */
export const MaxBatchCloneItems = 500
export const MaxBatchCloneURLLength = 8192
export const MaxBatchCloneRawFolderNameLength = 1024
export const MaxBatchCloneFolderNameLength = 100
export const MaxBatchClonePathLength = 32767
export const MaxBatchCloneBranchLength = 1024
export const MaxBatchCloneAccountKeyLength = 4096
export const BatchCloneRecoveryIdBytes = 24
export const BatchCloneRecoveryIdLength = BatchCloneRecoveryIdBytes * 2

/** The lifecycle state of a single repository within a batch clone. */
export type BatchCloneItemStatusKind =
  | 'pending'
  | 'cloning'
  | 'interrupted'
  | 'review'
  | 'done'
  | 'failed'
  | 'skipped'

/** Where a batch originated. Auto-clone batches never open a progress dialog. */
export type BatchCloneSource = 'manual' | 'auto'

/**
 * The status of a single item in the batch, tracked separately from the item
 * itself so the (immutable) item list can be shared while statuses churn.
 */
export interface IBatchCloneItemStatus {
  readonly kind: BatchCloneItemStatusKind

  /** Clone progress between 0 and 1, present while cloning or once done. */
  readonly progress?: number

  /** The most recent human-readable progress description from git. */
  readonly description?: string

  /** The error that caused a `failed` status, when applicable. */
  readonly error?: Error

  /** Stable identity that completed the clone, when fallback was used. */
  readonly accountKey?: string

  /** The completed clone has been registered with the local repository list. */
  readonly finalized?: boolean
}

/** A single repository to be cloned as part of a batch. */
export interface IBatchCloneItem {
  /** The clone URL of the repository. */
  readonly url: string

  /** The (collision-resolved) folder name the repository is cloned into. */
  readonly name: string

  /** The absolute destination path (baseDirectory joined with the name). */
  readonly path: string

  /** The repository's default branch, when known. */
  readonly defaultBranch?: string

  /** Stable signed-in account identity preferred for the first HTTPS attempt. */
  readonly accountKey?: string

  /**
   * Unguessable ownership proof for v2 staged clones. Legacy v1 queue items do
   * not have one and are therefore recovered without deleting or promoting
   * any destination data.
   */
  readonly recoveryId?: string
}

/** Public state describing the progress of an in-flight (or finished) batch. */
export interface IBatchCloneState {
  /** The items being cloned, in display order. */
  readonly items: ReadonlyArray<IBatchCloneItem>

  /** The status of each item, keyed by its destination path. */
  readonly statuses: ReadonlyMap<string, IBatchCloneItemStatus>

  /** Whether the batch is running in parallel or sequential mode. */
  readonly mode: BatchCloneMode

  /** Whether new work is currently being launched. */
  readonly isRunning: boolean

  /** Whether the queue is paused; active Git clones are aborted for restart. */
  readonly isPaused: boolean

  /** Whether this batch was user-started or created by background auto-clone. */
  readonly source: BatchCloneSource

  /** The overall progress across the whole batch, between 0 and 1. */
  readonly overallProgress: number

  /** True once every item has reached a terminal status. */
  readonly isDone: boolean
}

/** A single input row describing a repository the user wants to clone. */
export interface IBatchCloneInput {
  readonly url: string
  /** A preferred folder name; when omitted it is derived from the URL. */
  readonly name?: string
  readonly defaultBranch?: string
  readonly accountKey?: string
}

/** True when a status is terminal (no further transitions expected). */
export function isTerminalStatus(status: IBatchCloneItemStatus): boolean {
  return (
    status.kind === 'done' ||
    status.kind === 'failed' ||
    status.kind === 'review' ||
    status.kind === 'skipped'
  )
}

/**
 * Derive a folder name for a repository from its clone URL, falling back to the
 * final path segment when the URL isn't a recognizable owner/name remote.
 */
export function deriveBatchCloneName(url: string): string {
  const identifier = parseRepositoryIdentifier(url)
  if (identifier !== null && identifier.name.length > 0) {
    return identifier.name
  }

  // Strip a trailing ".git" and any trailing slashes, then take the basename.
  const cleaned = url.replace(/\/+$/, '').replace(/\.git$/i, '')
  const segments = cleaned.split(/[\\/]/).filter(s => s.length > 0)
  const last = segments[segments.length - 1]
  return last && last.length > 0 ? last : 'repository'
}

/**
 * Ensure a candidate name is unique within a set of already-taken names,
 * suffixing `-2`, `-3`, … on collision. The chosen name is added to `taken`.
 */
export function uniquifyName(candidate: string, taken: Set<string>): string {
  const sanitized = sanitizeBatchCloneFolderName(candidate)
  const collisionKeys = new Set(Array.from(taken, nameCollisionKey))
  if (!collisionKeys.has(nameCollisionKey(sanitized))) {
    taken.add(sanitized)
    return sanitized
  }

  let counter = 2
  let name = withNumericSuffix(sanitized, counter)
  while (collisionKeys.has(nameCollisionKey(name))) {
    counter += 1
    name = withNumericSuffix(sanitized, counter)
  }

  taken.add(name)
  return name
}

const WindowsReservedFolderName =
  /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .]|$)/i

/**
 * Convert API/user supplied labels into one portable path segment. Separators,
 * control characters, Windows-reserved punctuation/names, trailing dots/spaces,
 * and traversal-only segments are never allowed through.
 */
export function sanitizeBatchCloneFolderName(candidate: string): string {
  let name = candidate
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  if (name === '' || name === '.' || name === '..') {
    name = 'repository'
  }
  if (WindowsReservedFolderName.test(name)) {
    name = `_${name}`
  }

  const codePoints = Array.from(name)
  if (codePoints.length > MaxBatchCloneFolderNameLength) {
    name = codePoints.slice(0, MaxBatchCloneFolderNameLength).join('')
    name = name.replace(/[. ]+$/g, '') || 'repository'
  }
  return name
}

/** Resolve and prove that a sanitized name is exactly one child of base. */
export function resolveBatchCloneDestination(
  baseDirectory: string,
  folderName: string
): string {
  if (typeof baseDirectory !== 'string' || !Path.isAbsolute(baseDirectory)) {
    throw new Error('Clone base directory must be absolute.')
  }
  if (
    typeof folderName !== 'string' ||
    folderName !== sanitizeBatchCloneFolderName(folderName)
  ) {
    throw new Error('Clone destination folder name is unsafe.')
  }
  const base = Path.resolve(baseDirectory)
  const resolvedDestination = Path.resolve(base, folderName)
  const relative = Path.relative(base, resolvedDestination)
  if (
    relative === '' ||
    Path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${Path.sep}`) ||
    Path.dirname(relative) !== '.'
  ) {
    throw new Error(
      'Clone destination must be a direct child of the base directory.'
    )
  }
  if (resolvedDestination.length > MaxBatchClonePathLength) {
    throw new Error('Clone destination path is too long.')
  }
  return resolvedDestination
}

function nameCollisionKey(name: string): string {
  return name.normalize('NFC').toLocaleLowerCase('en-US')
}

function withNumericSuffix(candidate: string, counter: number): string {
  const suffix = `-${counter}`
  const available = MaxBatchCloneFolderNameLength - suffix.length
  const prefix = Array.from(candidate).slice(0, available).join('')
  return `${prefix}${suffix}`
}

export function isSafeBatchCloneItem(item: IBatchCloneItem): boolean {
  if (typeof item !== 'object' || item === null) {
    return false
  }
  if (
    typeof item.url !== 'string' ||
    item.url.length === 0 ||
    item.url.length > MaxBatchCloneURLLength ||
    batchCloneURLContainsEmbeddedCredentials(item.url) ||
    typeof item.name !== 'string' ||
    item.name.length > MaxBatchCloneRawFolderNameLength ||
    item.name !== sanitizeBatchCloneFolderName(item.name) ||
    Array.from(item.name).length > MaxBatchCloneFolderNameLength ||
    typeof item.path !== 'string' ||
    item.path.length === 0 ||
    item.path.length > MaxBatchClonePathLength ||
    !Path.isAbsolute(item.path) ||
    (item.defaultBranch !== undefined &&
      (typeof item.defaultBranch !== 'string' ||
        item.defaultBranch.length > MaxBatchCloneBranchLength)) ||
    (item.accountKey !== undefined &&
      (typeof item.accountKey !== 'string' ||
        item.accountKey.length > MaxBatchCloneAccountKeyLength)) ||
    (item.recoveryId !== undefined && !isBatchCloneRecoveryId(item.recoveryId))
  ) {
    return false
  }

  const expected = Path.resolve(Path.dirname(item.path), item.name)
  return (
    Path.resolve(item.path).toLocaleLowerCase('en-US') ===
    expected.toLocaleLowerCase('en-US')
  )
}

/** A fixed-width lowercase hex id with 192 bits of randomness. */
export function isBatchCloneRecoveryId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === BatchCloneRecoveryIdLength &&
    /^[a-f\d]+$/.test(value)
  )
}

/**
 * Whether a clone URL contains credentials that must never enter the durable
 * batch queue. HTTP(S) userinfo is always rejected because a username-only PAT
 * is indistinguishable from a harmless username. Passwordless SSH usernames
 * remain supported, including scp-like `git@host:owner/repo.git` URLs.
 */
export function batchCloneURLContainsEmbeddedCredentials(url: string): boolean {
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(url)
  if (scheme === null) {
    return false
  }

  const protocol = scheme[1].toLocaleLowerCase('en-US')
  const authorityPrefix = url.slice(scheme[0].length)
  if (!/^[\\/]{2}/.test(authorityPrefix)) {
    return false
  }

  try {
    const parsed = new URL(url)
    if (parsed.password.length > 0) {
      return true
    }
    if (parsed.username.length === 0) {
      return false
    }
    return protocol !== 'ssh' && protocol !== 'git+ssh'
  } catch {
    // An explicit URL authority that cannot be parsed is still fail-closed
    // when it contains userinfo. This also covers malformed percent escapes.
    const authority = authorityPrefix.slice(2).split(/[\\/?#]/, 1)[0]
    return authority.includes('@')
  }
}

export function assertSafeBatchCloneItems(
  items: ReadonlyArray<IBatchCloneItem>
): void {
  if (items.length > MaxBatchCloneItems || !items.every(isSafeBatchCloneItem)) {
    throw new Error('Clone queue contains an unsafe or oversized destination.')
  }
  const paths = items.map(item =>
    Path.resolve(item.path).toLocaleLowerCase('en-US')
  )
  const parents = items.map(item =>
    Path.dirname(Path.resolve(item.path)).toLocaleLowerCase('en-US')
  )
  if (new Set(paths).size !== paths.length || new Set(parents).size > 1) {
    throw new Error('Clone queue contains an unsafe or oversized destination.')
  }
}

/**
 * Build the immutable list of batch clone items from user inputs and a base
 * directory. Names are derived from the URL when absent and de-duplicated so no
 * two repositories target the same folder.
 */
export function buildBatchCloneItems(
  inputs: ReadonlyArray<IBatchCloneInput>,
  baseDirectory: string
): ReadonlyArray<IBatchCloneItem> {
  if (inputs.length > MaxBatchCloneItems) {
    throw new Error(
      `A clone batch cannot contain more than ${MaxBatchCloneItems} repositories.`
    )
  }
  const taken = new Set<string>()

  return inputs.map(input => {
    if (
      typeof input.url !== 'string' ||
      input.url.length === 0 ||
      input.url.length > MaxBatchCloneURLLength
    ) {
      throw new Error('Clone URL is empty or exceeds the supported length.')
    }
    if (batchCloneURLContainsEmbeddedCredentials(input.url)) {
      throw new Error(
        'Clone URLs with embedded credentials cannot be saved in a batch. Use the credential manager or a passwordless SSH URL.'
      )
    }
    if (input.name !== undefined && typeof input.name !== 'string') {
      throw new Error('Repository folder name must be text.')
    }
    if (
      input.defaultBranch !== undefined &&
      (typeof input.defaultBranch !== 'string' ||
        input.defaultBranch.length > MaxBatchCloneBranchLength)
    ) {
      throw new Error('Default branch name exceeds the supported length.')
    }
    if (
      input.accountKey !== undefined &&
      (typeof input.accountKey !== 'string' ||
        input.accountKey.length > MaxBatchCloneAccountKeyLength)
    ) {
      throw new Error('Account identity exceeds the supported length.')
    }
    const preferred =
      input.name && input.name.length > 0
        ? input.name
        : deriveBatchCloneName(input.url)
    if (preferred.length > MaxBatchCloneRawFolderNameLength) {
      throw new Error('Repository folder name exceeds the supported length.')
    }
    const name = uniquifyName(preferred, taken)

    return {
      url: input.url,
      name,
      path: resolveBatchCloneDestination(baseDirectory, name),
      ...(input.defaultBranch !== undefined
        ? { defaultBranch: input.defaultBranch }
        : {}),
      ...(input.accountKey !== undefined
        ? { accountKey: input.accountKey }
        : {}),
    }
  })
}

/** A count of items in each terminal/active state. */
export interface IBatchCloneSummary {
  readonly total: number
  readonly pending: number
  readonly cloning: number
  readonly interrupted: number
  readonly review: number
  readonly done: number
  readonly failed: number
  readonly skipped: number
}

/** Tally the statuses of every item in the batch. */
export function summarizeBatchClone(
  items: ReadonlyArray<IBatchCloneItem>,
  statuses: ReadonlyMap<string, IBatchCloneItemStatus>
): IBatchCloneSummary {
  let pending = 0
  let cloning = 0
  let interrupted = 0
  let review = 0
  let done = 0
  let failed = 0
  let skipped = 0

  for (const item of items) {
    const kind = statuses.get(item.path)?.kind ?? 'pending'
    switch (kind) {
      case 'pending':
        pending += 1
        break
      case 'cloning':
        cloning += 1
        break
      case 'interrupted':
        interrupted += 1
        break
      case 'review':
        review += 1
        break
      case 'done':
        done += 1
        break
      case 'failed':
        failed += 1
        break
      case 'skipped':
        skipped += 1
        break
    }
  }

  return {
    total: items.length,
    pending,
    cloning,
    interrupted,
    review,
    done,
    failed,
    skipped,
  }
}

/**
 * Compute the overall progress of the batch as a fraction between 0 and 1. Each
 * item contributes an equal share; a done/failed/skipped item counts as fully
 * complete and a cloning item contributes its in-flight fraction.
 */
export function computeBatchCloneProgress(
  items: ReadonlyArray<IBatchCloneItem>,
  statuses: ReadonlyMap<string, IBatchCloneItemStatus>
): number {
  if (items.length === 0) {
    return 1
  }

  let sum = 0
  for (const item of items) {
    const status = statuses.get(item.path)
    if (
      status === undefined ||
      status.kind === 'pending' ||
      status.kind === 'interrupted'
    ) {
      continue
    }

    if (status.kind === 'cloning') {
      sum += clampFraction(status.progress ?? 0)
    } else {
      // done / failed / skipped all count as a completed unit of work.
      sum += 1
    }
  }

  return clampFraction(sum / items.length)
}

/** True once every item has reached a terminal status. */
export function isBatchCloneDone(
  items: ReadonlyArray<IBatchCloneItem>,
  statuses: ReadonlyMap<string, IBatchCloneItemStatus>
): boolean {
  if (items.length === 0) {
    return true
  }

  return items.every(item => {
    const status = statuses.get(item.path)
    return status !== undefined && isTerminalStatus(status)
  })
}

/** Whether an explicit user request should reopen retained queue status. */
export function batchCloneNeedsAttention(
  state: IBatchCloneState | null
): boolean {
  if (state === null) {
    return false
  }
  if (!state.isDone || state.isPaused || state.isRunning) {
    return true
  }
  return state.items.some(item => {
    const status = state.statuses.get(item.path)
    const kind = status?.kind
    return (
      kind === 'failed' ||
      kind === 'review' ||
      kind === 'interrupted' ||
      (kind === 'done' && status?.finalized !== true)
    )
  })
}

function clampFraction(value: number): number {
  if (Number.isNaN(value) || value < 0) {
    return 0
  }
  return value > 1 ? 1 : value
}
