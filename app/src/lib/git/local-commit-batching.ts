import { isAbsolute } from 'path'

import {
  AutomaticCommitPushBatchByteLimit,
  AutomaticLocalCommitBatchFileCountLimit,
  CommitPushBatchError,
  splitCommitPushBatches,
} from '../commit-push-batching'

export const LocalCommitBatchBackupRefNamespace =
  'refs/desktop-material/commit-batch-backup'

const ObjectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const RemoteNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/
const BackupNoncePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MaximumCommitMessageBytes = 64 * 1024
const MaximumFingerprintBytes = 4 * 1024

export type LocalCommitBatchingErrorCode =
  | 'invalid-inspection'
  | 'detached'
  | 'no-upstream'
  | 'dirty'
  | 'operation-in-progress'
  | 'conflicts'
  | 'not-ahead'
  | 'diverged'
  | 'non-linear'
  | 'not-oversized'
  | 'invalid-plan'
  | 'stale-state'
  | 'backup-failed'
  | 'reset-failed'
  | 'commit-failed'
  | 'push-failed'
  | 'remote-proof-failed'
  | 'restore-failed'
  | 'cleanup-failed'
  | 'unavailable'

/**
 * An execution failure records whether the original local tip was restored or
 * whether its CAS backup ref was intentionally retained for recovery.
 */
export class LocalCommitBatchingError extends Error {
  public constructor(
    public readonly code: LocalCommitBatchingErrorCode,
    message: string,
    public readonly backupRef: string | null = null,
    public readonly publishedBatches: number = 0,
    public readonly backupRetained: boolean = false,
    public readonly restoredOriginalTip: boolean = false,
    public readonly originalError?: unknown
  ) {
    super(message)
    this.name = 'LocalCommitBatchingError'
  }
}

export interface ILocalCommitBatchingChange {
  readonly path: string
  readonly sizeInBytes: number
}

export interface ILocalCommitBatch {
  /** Stable, repository-relative paths passed explicitly to Git. */
  readonly changes: ReadonlyArray<ILocalCommitBatchingChange>
  readonly sizeInBytes: number
  /** The complete message passed to the commit operation. */
  readonly message: string
}

export interface ILocalCommitBatchPlan {
  readonly byteLimit: number
  /** Maximum number of files any one batch may commit. */
  readonly fileCountLimit: number
  readonly totalSizeInBytes: number
  readonly batches: ReadonlyArray<ILocalCommitBatch>
}

export type LocalCommitPushBatchingDecision =
  | {
      readonly kind: 'not-needed'
      readonly reason: 'no-local-only-commits' | 'within-limit'
      readonly totalSizeInBytes: number
    }
  | {
      readonly kind: 'push-existing'
      readonly totalSizeInBytes: number
    }
  | {
      readonly kind: 'rewrite'
      readonly totalSizeInBytes: number
      readonly oversizedCommitShas: ReadonlyArray<string>
    }

export type LocalCommitBatchMessageFactory = (
  paths: ReadonlyArray<string>,
  index: number,
  total: number
) => string

function planError(message: string, originalError?: unknown): never {
  throw new LocalCommitBatchingError(
    'invalid-plan',
    message,
    null,
    0,
    false,
    false,
    originalError
  )
}

function isSafeRepositoryRelativePath(path: string): boolean {
  if (
    path.length === 0 ||
    path.includes('\0') ||
    isAbsolute(path) ||
    path.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith('\\\\')
  ) {
    return false
  }

  const components = path.replace(/\\/g, '/').split('/')
  return components.every(
    component => component.length > 0 && component !== '.' && component !== '..'
  )
}

function validateCommitMessage(message: string): void {
  if (
    message.trim().length === 0 ||
    message.includes('\0') ||
    Buffer.byteLength(message, 'utf8') > MaximumCommitMessageBytes
  ) {
    planError('Every automatic commit batch needs a valid explicit message.')
  }
}

function validateChangedPaths(
  changes: ReadonlyArray<ILocalCommitBatchingChange>,
  allowEmpty: boolean
): number {
  if (!allowEmpty && changes.length === 0) {
    inspectionFailure(
      'invalid-inspection',
      'Git returned an empty payload for a reviewed local commit.'
    )
  }

  const seen = new Set<string>()
  let total = 0
  for (const change of changes) {
    if (!isSafeRepositoryRelativePath(change.path) || seen.has(change.path)) {
      inspectionFailure(
        'invalid-inspection',
        'Git returned an unsafe or duplicate changed-file path.'
      )
    }
    seen.add(change.path)
    if (!Number.isSafeInteger(change.sizeInBytes) || change.sizeInBytes < 0) {
      inspectionFailure(
        'invalid-inspection',
        'Git returned an invalid changed-file size.'
      )
    }
    if (!Number.isSafeInteger(total + change.sizeInBytes)) {
      inspectionFailure(
        'invalid-inspection',
        'Git returned a local-commit payload larger than a safe integer.'
      )
    }
    total += change.sizeInBytes
  }
  return total
}

/**
 * Decide before checking cleanliness so an ordinary small push is never
 * blocked merely because the user has unrelated current working-tree edits.
 *
 * A batch is bounded by BOTH a byte ceiling and a file-count ceiling, whichever
 * is reached first. A commit is treated as oversized (and therefore rewritten)
 * when it exceeds either ceiling; a combined range that stays within both
 * ceilings per commit but crosses one in aggregate is pushed one existing tip
 * at a time.
 */
export function decideLocalCommitPushBatching(
  inspection: ILocalCommitBatchingInspection,
  byteLimit: number = AutomaticCommitPushBatchByteLimit,
  fileCountLimit: number = AutomaticLocalCommitBatchFileCountLimit
): LocalCommitPushBatchingDecision {
  if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0) {
    planError('Automatic local-commit batching requires a positive byte limit.')
  }
  if (!Number.isSafeInteger(fileCountLimit) || fileCountLimit <= 0) {
    planError(
      'Automatic local-commit batching requires a positive file-count limit.'
    )
  }
  if (inspection.localOnlyCommits.length === 0) {
    return {
      kind: 'not-needed',
      reason: 'no-local-only-commits',
      totalSizeInBytes: 0,
    }
  }

  let totalSizeInBytes = 0
  let totalFileCount = 0
  const oversizedCommitShas = new Array<string>()
  for (const commit of inspection.localOnlyCommits) {
    const measured = validateChangedPaths(commit.changes, true)
    if (
      !Number.isSafeInteger(commit.payloadSizeInBytes) ||
      commit.payloadSizeInBytes < 0 ||
      commit.payloadSizeInBytes !== measured ||
      !Number.isSafeInteger(totalSizeInBytes + commit.payloadSizeInBytes)
    ) {
      inspectionFailure(
        'invalid-inspection',
        'Git returned an inconsistent local-commit payload size.'
      )
    }
    totalSizeInBytes += commit.payloadSizeInBytes
    totalFileCount += commit.changes.length
    if (
      commit.payloadSizeInBytes > byteLimit ||
      commit.changes.length > fileCountLimit
    ) {
      oversizedCommitShas.push(commit.sha)
    }
  }

  if (totalSizeInBytes <= byteLimit && totalFileCount <= fileCountLimit) {
    return { kind: 'not-needed', reason: 'within-limit', totalSizeInBytes }
  }
  if (oversizedCommitShas.length === 0) {
    return { kind: 'push-existing', totalSizeInBytes }
  }
  return { kind: 'rewrite', totalSizeInBytes, oversizedCommitShas }
}

/**
 * Build a deterministic next-fit plan. The input order is preserved and a batch
 * is closed as soon as it would cross either the byte ceiling or the file-count
 * ceiling. A one-batch plan is useful when an older commit was oversized but its
 * final upstream-to-HEAD tree delta is now small.
 */
export function createLocalCommitBatchPlan(
  changes: ReadonlyArray<ILocalCommitBatchingChange>,
  messageForBatch: LocalCommitBatchMessageFactory,
  byteLimit: number = AutomaticCommitPushBatchByteLimit,
  fileCountLimit: number = AutomaticLocalCommitBatchFileCountLimit
): ILocalCommitBatchPlan {
  if (!Number.isSafeInteger(fileCountLimit) || fileCountLimit <= 0) {
    planError(
      'Automatic local-commit batching requires a positive file-count limit.'
    )
  }
  const seenPaths = new Set<string>()
  let totalSizeInBytes = 0
  for (const change of changes) {
    if (!isSafeRepositoryRelativePath(change.path)) {
      planError(`Automatic local-commit batching refused ${change.path}.`)
    }
    if (seenPaths.has(change.path)) {
      planError(
        `Automatic local-commit batching received ${change.path} twice.`
      )
    }
    seenPaths.add(change.path)
    if (!Number.isSafeInteger(change.sizeInBytes) || change.sizeInBytes < 0) {
      planError(
        `Automatic local-commit batching received an invalid file size.`
      )
    }
    if (!Number.isSafeInteger(totalSizeInBytes + change.sizeInBytes)) {
      planError('The automatic local-commit batch total is not a safe integer.')
    }
    totalSizeInBytes += change.sizeInBytes
  }

  let split
  try {
    split = splitCommitPushBatches(
      changes.map(change => ({
        item: change,
        path: change.path,
        sizeInBytes: change.sizeInBytes,
      })),
      byteLimit,
      { maximumPathsPerBatch: fileCountLimit }
    )
  } catch (error) {
    if (error instanceof CommitPushBatchError) {
      planError(error.message, error)
    }
    throw error
  }

  if (split.length === 0) {
    const message = messageForBatch([], 0, 1)
    validateCommitMessage(message)
    return {
      byteLimit,
      fileCountLimit,
      totalSizeInBytes,
      batches: [{ changes: [], sizeInBytes: 0, message }],
    }
  }

  const batches = split.map((batch, index) => {
    const message = messageForBatch(batch.paths, index, split.length)
    validateCommitMessage(message)
    return {
      changes: batch.items,
      sizeInBytes: batch.sizeInBytes,
      message,
    }
  })

  return { byteLimit, fileCountLimit, totalSizeInBytes, batches }
}

export interface ILocalCommitBatchingFingerprint {
  readonly branchRef: string | null
  readonly upstreamRef: string | null
  readonly headSha: string | null
  readonly upstreamSha: string | null
  /** `git write-tree` (or an equivalent exact index-tree identifier). */
  readonly indexTreeSha: string | null
  /** An opaque, exact fingerprint of the working-tree contents. */
  readonly worktreeFingerprint: string
  readonly isIndexClean: boolean
  readonly isWorktreeClean: boolean
  readonly hasConflicts: boolean
  /** Null only when no merge, rebase, cherry-pick, revert, or bisect is active. */
  readonly operationState: string | null
}

export interface ILocalOnlyCommit {
  readonly sha: string
  readonly parentShas: ReadonlyArray<string>
  /** Complete original message, retained when the commit can be pushed as-is. */
  readonly message: string
  /** Conservative source bytes introduced by this commit. */
  readonly payloadSizeInBytes: number
  readonly changes: ReadonlyArray<ILocalCommitBatchingChange>
}

export interface ILocalCommitBatchingInspection {
  readonly remoteName: string | null
  readonly remoteBranchRef: string | null
  readonly headTreeSha: string | null
  readonly upstreamTreeSha: string | null
  readonly ahead: number
  readonly behind: number
  /** Oldest local-only commit first. */
  readonly localOnlyCommits: ReadonlyArray<ILocalOnlyCommit>
  /** Stable, deduplicated upstream-to-HEAD tree delta used only for rewrites. */
  readonly netChanges: ReadonlyArray<ILocalCommitBatchingChange>
  readonly fingerprint: ILocalCommitBatchingFingerprint
}

export type LocalCommitBatchPushResult = 'pushed' | 'rejected' | 'unknown'

export interface ILocalCommitBatchCommitResult {
  readonly headSha: string
  /** Null only for the first commit of a proven-empty remote branch. */
  readonly parentSha: string | null
  readonly treeSha: string
  /** Exact committed paths proven from parent-to-commit Git objects. */
  readonly paths: ReadonlyArray<string>
  /** Exact sum of committed non-deletion blob sizes. */
  readonly sizeInBytes: number
}

export interface ILocalCommitBatchingOperations {
  /** A fresh, authoritative eligibility inspection. */
  readonly inspect: () => Promise<ILocalCommitBatchingInspection>
  readonly readFingerprint: () => Promise<ILocalCommitBatchingFingerprint>
  readonly createBackupNonce: () => string
  /** Create only when `ref` is absent; this must be one atomic CAS update. */
  readonly createBackupRef: (request: {
    readonly ref: string
    readonly newSha: string
    readonly expectedOldSha: null
  }) => Promise<void>
  /** Delete only when the ref still names `expectedOldSha`. */
  readonly deleteBackupRef: (request: {
    readonly ref: string
    readonly expectedOldSha: string
  }) => Promise<void>
  /**
   * Atomically require the expected branch/index/worktree before performing a
   * mixed reset. Implementations must not fall back to an unconditional reset.
   */
  readonly mixedReset: (request: {
    /** Null rebuilds a first publication from an unborn branch. */
    readonly targetSha: string | null
    readonly expected: ILocalCommitBatchingFingerprint
    readonly mode: 'mixed'
  }) => Promise<void>
  /** Stage and commit only these paths, with the supplied complete message. */
  readonly commitPaths: (request: {
    readonly paths: ReadonlyArray<string>
    readonly message: string
    readonly expectedSizeInBytes: number
    /** Protected final tree whose exact object identities these paths must use. */
    readonly expectedTargetTreeSha: string
    readonly expected: ILocalCommitBatchingFingerprint
    /** True only for a reviewed rewrite whose final tree delta is empty. */
    readonly allowEmpty: boolean
  }) => Promise<ILocalCommitBatchCommitResult>
  /** A normal push. `force` is intentionally unrepresentable as true. */
  readonly push: (request: {
    readonly remoteName: string
    readonly localBranchRef: string
    readonly remoteBranchRef: string
    /** Null proves that the exact target branch does not yet exist. */
    readonly expectedRemoteSha: string | null
    readonly headSha: string
    readonly force: false
  }) => Promise<LocalCommitBatchPushResult>
  /** Authoritative remote ref read that does not update local refs. */
  readonly readRemoteTip: (request: {
    readonly remoteName: string
    readonly remoteBranchRef: string
  }) => Promise<string | null>
  /** Authoritative all-remote-ref reachability proof without local ref writes. */
  readonly isCommitReachableFromAnyRemote: (request: {
    readonly commitSha: string
  }) => Promise<boolean>
  /** Restore by CAS and mixed reset; never overwrite a mismatched branch tip. */
  readonly restoreFromBackup: (request: {
    readonly branchRef: string
    readonly backupRef: string
    readonly backupSha: string
    readonly expected: ILocalCommitBatchingFingerprint
    readonly mode: 'mixed'
  }) => Promise<void>
}

export type ILocalCommitBatchingResult =
  | {
      readonly status: 'not-needed'
      readonly reason: 'no-local-only-commits' | 'within-limit'
      readonly totalSizeInBytes: number
    }
  | {
      readonly status: 'completed'
      readonly mode: 'existing-commits' | 'rewritten-commits'
      readonly backupRef: string | null
      readonly batchesCommitted: number
      readonly batchesPushed: number
      readonly finalHeadSha: string
    }

function isObjectId(value: string | null): value is string {
  return value !== null && ObjectIdPattern.test(value)
}

function isSafeRef(ref: string, prefix: string): boolean {
  if (!ref.startsWith(prefix) || ref.length <= prefix.length) {
    return false
  }
  const suffix = ref.slice(prefix.length)
  return (
    !suffix.startsWith('/') &&
    !suffix.endsWith('/') &&
    !suffix.endsWith('.') &&
    !suffix.endsWith('.lock') &&
    !suffix.includes('..') &&
    !suffix.includes('@{') &&
    !/[\x00-\x20\x7f~^:?*[\\]/.test(suffix) &&
    suffix.split('/').every(component => component.length > 0)
  )
}

function isValidFingerprintToken(value: string): boolean {
  return (
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= MaximumFingerprintBytes &&
    !value.includes('\0')
  )
}

function inspectionFailure(
  code: LocalCommitBatchingErrorCode,
  message: string
): never {
  throw new LocalCommitBatchingError(code, message)
}

/**
 * Fail closed unless every reviewed local commit is a linear chain. A missing
 * upstream SHA is valid only for an exact first-publication target and makes
 * the oldest reviewed commit a root commit.
 */
export function validateLocalCommitBatchingInspection(
  inspection: ILocalCommitBatchingInspection,
  requireClean: boolean = true
): void {
  const fingerprint = inspection.fingerprint
  if (fingerprint.branchRef === null) {
    inspectionFailure(
      'detached',
      'Check out a branch before automatic rebatching.'
    )
  }
  if (!isSafeRef(fingerprint.branchRef, 'refs/heads/')) {
    inspectionFailure(
      'invalid-inspection',
      'Git returned an invalid local branch ref.'
    )
  }
  if (
    inspection.remoteName === null ||
    !RemoteNamePattern.test(inspection.remoteName) ||
    inspection.remoteName === '.' ||
    inspection.remoteName === '..' ||
    fingerprint.upstreamRef === null ||
    !isSafeRef(fingerprint.upstreamRef, 'refs/remotes/') ||
    !fingerprint.upstreamRef.startsWith(
      `refs/remotes/${inspection.remoteName}/`
    ) ||
    inspection.remoteBranchRef === null ||
    !isSafeRef(inspection.remoteBranchRef, 'refs/heads/') ||
    (fingerprint.upstreamSha !== null &&
      !isObjectId(fingerprint.upstreamSha)) ||
    !isObjectId(inspection.upstreamTreeSha)
  ) {
    inspectionFailure(
      'no-upstream',
      'Configure a valid remote-tracking upstream before automatic rebatching.'
    )
  }
  if (
    !isObjectId(fingerprint.headSha) ||
    !isObjectId(fingerprint.indexTreeSha) ||
    !isObjectId(inspection.headTreeSha) ||
    !isValidFingerprintToken(fingerprint.worktreeFingerprint)
  ) {
    inspectionFailure(
      'invalid-inspection',
      'Git returned an invalid repository fingerprint.'
    )
  }
  if (fingerprint.operationState !== null) {
    inspectionFailure(
      'operation-in-progress',
      'Finish the active Git operation before automatic rebatching.'
    )
  }
  if (fingerprint.hasConflicts) {
    inspectionFailure(
      'conflicts',
      'Resolve conflicts before automatic rebatching.'
    )
  }
  if (
    requireClean &&
    (!fingerprint.isIndexClean || !fingerprint.isWorktreeClean)
  ) {
    inspectionFailure(
      'dirty',
      'Automatic rebatching only starts from a clean index and working tree.'
    )
  }
  if (inspection.behind !== 0) {
    inspectionFailure(
      'diverged',
      'The branch must not be behind its upstream before automatic rebatching.'
    )
  }
  if (
    inspection.ahead <= 0 ||
    inspection.localOnlyCommits.length === 0 ||
    inspection.ahead !== inspection.localOnlyCommits.length ||
    (fingerprint.upstreamSha !== null &&
      fingerprint.headSha === fingerprint.upstreamSha)
  ) {
    inspectionFailure(
      'not-ahead',
      'There are no reviewed local-only commits to rebatch.'
    )
  }
  if (
    (requireClean && fingerprint.indexTreeSha !== inspection.headTreeSha) ||
    !Number.isSafeInteger(inspection.ahead) ||
    !Number.isSafeInteger(inspection.behind)
  ) {
    inspectionFailure(
      'invalid-inspection',
      'Git returned an inconsistent clean state.'
    )
  }

  const seen = new Set<string>()
  for (let index = 0; index < inspection.localOnlyCommits.length; index++) {
    const commit = inspection.localOnlyCommits[index]
    const expectedParent: string | null =
      index === 0
        ? fingerprint.upstreamSha
        : inspection.localOnlyCommits[index - 1].sha
    const hasExpectedParents =
      expectedParent === null
        ? commit.parentShas.length === 0
        : commit.parentShas.length === 1 &&
          commit.parentShas[0] === expectedParent
    if (
      !isObjectId(commit.sha) ||
      seen.has(commit.sha) ||
      !hasExpectedParents ||
      commit.message.includes('\0') ||
      !Number.isSafeInteger(commit.payloadSizeInBytes) ||
      commit.payloadSizeInBytes < 0 ||
      validateChangedPaths(commit.changes, true) !== commit.payloadSizeInBytes
    ) {
      inspectionFailure(
        'non-linear',
        'Only a linear, one-parent local-only commit range can be rebatched.'
      )
    }
    seen.add(commit.sha)
  }
  if (
    inspection.localOnlyCommits[inspection.localOnlyCommits.length - 1].sha !==
    fingerprint.headSha
  ) {
    inspectionFailure(
      'non-linear',
      'The local-only range does not end at HEAD.'
    )
  }
  validateChangedPaths(inspection.netChanges, true)
  if (
    inspection.netChanges.length === 0 &&
    inspection.headTreeSha !== inspection.upstreamTreeSha
  ) {
    inspectionFailure(
      'invalid-inspection',
      'Git returned an empty net change list for different endpoint trees.'
    )
  }
}

function changesMatch(
  left: ReadonlyArray<ILocalCommitBatchingChange>,
  right: ReadonlyArray<ILocalCommitBatchingChange>
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (change, index) =>
        change.path === right[index].path &&
        change.sizeInBytes === right[index].sizeInBytes
    )
  )
}

function fingerprintMatches(
  left: ILocalCommitBatchingFingerprint,
  right: ILocalCommitBatchingFingerprint
): boolean {
  return (
    left.branchRef === right.branchRef &&
    left.upstreamRef === right.upstreamRef &&
    left.headSha === right.headSha &&
    left.upstreamSha === right.upstreamSha &&
    left.indexTreeSha === right.indexTreeSha &&
    left.worktreeFingerprint === right.worktreeFingerprint &&
    left.isIndexClean === right.isIndexClean &&
    left.isWorktreeClean === right.isWorktreeClean &&
    left.hasConflicts === right.hasConflicts &&
    left.operationState === right.operationState
  )
}

function inspectionsMatch(
  reviewed: ILocalCommitBatchingInspection,
  current: ILocalCommitBatchingInspection
): boolean {
  return (
    reviewed.remoteName === current.remoteName &&
    reviewed.remoteBranchRef === current.remoteBranchRef &&
    reviewed.headTreeSha === current.headTreeSha &&
    reviewed.upstreamTreeSha === current.upstreamTreeSha &&
    reviewed.ahead === current.ahead &&
    reviewed.behind === current.behind &&
    fingerprintMatches(reviewed.fingerprint, current.fingerprint) &&
    reviewed.localOnlyCommits.length === current.localOnlyCommits.length &&
    reviewed.localOnlyCommits.every(
      (commit, index) =>
        commit.sha === current.localOnlyCommits[index].sha &&
        commit.message === current.localOnlyCommits[index].message &&
        commit.payloadSizeInBytes ===
          current.localOnlyCommits[index].payloadSizeInBytes &&
        changesMatch(commit.changes, current.localOnlyCommits[index].changes) &&
        commit.parentShas.length ===
          current.localOnlyCommits[index].parentShas.length &&
        commit.parentShas.every(
          (parent, parentIndex) =>
            parent === current.localOnlyCommits[index].parentShas[parentIndex]
        )
    ) &&
    changesMatch(reviewed.netChanges, current.netChanges)
  )
}

function validatePlan(plan: ILocalCommitBatchPlan): void {
  if (
    !Number.isSafeInteger(plan.byteLimit) ||
    plan.byteLimit <= 0 ||
    !Number.isSafeInteger(plan.fileCountLimit) ||
    plan.fileCountLimit <= 0 ||
    !Number.isSafeInteger(plan.totalSizeInBytes) ||
    plan.totalSizeInBytes < 0 ||
    plan.batches.length < 1
  ) {
    planError(
      'Automatic local-commit rebatching requires a valid reviewed plan.'
    )
  }

  const seen = new Set<string>()
  let total = 0
  for (const batch of plan.batches) {
    validateCommitMessage(batch.message)
    if (
      (batch.changes.length === 0 &&
        (plan.totalSizeInBytes !== 0 || plan.batches.length !== 1)) ||
      !Number.isSafeInteger(batch.sizeInBytes) ||
      batch.sizeInBytes < 0 ||
      batch.sizeInBytes > plan.byteLimit ||
      batch.changes.length > plan.fileCountLimit
    ) {
      planError('Automatic local-commit rebatching received an invalid batch.')
    }
    let batchTotal = 0
    for (const change of batch.changes) {
      if (!isSafeRepositoryRelativePath(change.path) || seen.has(change.path)) {
        planError(
          'Automatic local-commit rebatching received an unsafe or duplicate path.'
        )
      }
      seen.add(change.path)
      if (!Number.isSafeInteger(change.sizeInBytes) || change.sizeInBytes < 0) {
        planError(
          'Automatic local-commit rebatching received an invalid file size.'
        )
      }
      batchTotal += change.sizeInBytes
    }
    if (!Number.isSafeInteger(batchTotal) || batchTotal !== batch.sizeInBytes) {
      planError(
        'Automatic local-commit rebatching received an inconsistent batch size.'
      )
    }
    total += batchTotal
  }
  if (!Number.isSafeInteger(total) || total !== plan.totalSizeInBytes) {
    planError(
      'Automatic local-commit rebatching received an inconsistent total size.'
    )
  }
}

function requirePlanMatchesReviewedNetChanges(
  plan: ILocalCommitBatchPlan,
  reviewed: ILocalCommitBatchingInspection
): void {
  const planned = plan.batches.flatMap(batch => batch.changes)
  if (!changesMatch(planned, reviewed.netChanges)) {
    planError(
      'The rewrite plan must contain the exact reviewed upstream-to-HEAD paths in stable order.'
    )
  }
}

function validateRuntimeFingerprint(
  fingerprint: ILocalCommitBatchingFingerprint,
  reviewed: ILocalCommitBatchingInspection,
  expectedHeadSha: string | null,
  expectedIndexTreeSha: string,
  requireCleanIndex: boolean = true
): void {
  if (
    fingerprint.branchRef !== reviewed.fingerprint.branchRef ||
    fingerprint.upstreamRef !== reviewed.fingerprint.upstreamRef ||
    fingerprint.headSha !== expectedHeadSha ||
    fingerprint.indexTreeSha !== expectedIndexTreeSha ||
    fingerprint.worktreeFingerprint !==
      reviewed.fingerprint.worktreeFingerprint ||
    (requireCleanIndex && !fingerprint.isIndexClean) ||
    fingerprint.hasConflicts ||
    fingerprint.operationState !== null
  ) {
    throw new LocalCommitBatchingError(
      'stale-state',
      'The branch, index, working tree, or Git operation changed during automatic rebatching.'
    )
  }
}

async function requireFingerprint(
  operations: ILocalCommitBatchingOperations,
  expected: ILocalCommitBatchingFingerprint
): Promise<void> {
  const current = await operations.readFingerprint()
  if (!fingerprintMatches(expected, current)) {
    throw new LocalCommitBatchingError(
      'stale-state',
      'The repository changed after its last automatic-rebatch checkpoint.'
    )
  }
}

function executionError(
  error: unknown,
  fallbackCode: LocalCommitBatchingErrorCode,
  fallbackMessage: string,
  backupRef: string | null,
  publishedBatches: number,
  backupRetained: boolean,
  restoredOriginalTip: boolean
): LocalCommitBatchingError {
  const source =
    error instanceof LocalCommitBatchingError
      ? error
      : new LocalCommitBatchingError(
          fallbackCode,
          fallbackMessage,
          null,
          0,
          false,
          false,
          error
        )
  return new LocalCommitBatchingError(
    source.code,
    source.message,
    backupRef,
    publishedBatches,
    backupRetained,
    restoredOriginalTip,
    source.originalError ?? error
  )
}

function backupRefForNonce(nonce: string): string {
  if (
    !BackupNoncePattern.test(nonce) ||
    nonce.endsWith('.') ||
    nonce.endsWith('.lock') ||
    nonce.includes('..')
  ) {
    throw new LocalCommitBatchingError(
      'backup-failed',
      'Automatic local-commit batching could not create a safe backup ref name.'
    )
  }
  return `${LocalCommitBatchBackupRefNamespace}/${nonce}`
}

/**
 * Push already-safe local commits one tip at a time. This preserves every SHA,
 * author, timestamp, and message and performs no local history mutation.
 */
export async function executeExistingLocalCommitPushBatches(
  reviewed: ILocalCommitBatchingInspection,
  operations: ILocalCommitBatchingOperations,
  byteLimit: number = AutomaticCommitPushBatchByteLimit,
  pushEvenWhenCombinedSizeIsWithinLimit: boolean = false,
  fileCountLimit: number = AutomaticLocalCommitBatchFileCountLimit
): Promise<ILocalCommitBatchingResult> {
  const decision = decideLocalCommitPushBatching(
    reviewed,
    byteLimit,
    fileCountLimit
  )
  const shouldFlushWithinLimit =
    pushEvenWhenCombinedSizeIsWithinLimit &&
    decision.kind === 'not-needed' &&
    decision.reason === 'within-limit' &&
    reviewed.localOnlyCommits.length > 0
  if (decision.kind === 'not-needed' && !shouldFlushWithinLimit) {
    return {
      status: 'not-needed',
      reason: decision.reason,
      totalSizeInBytes: decision.totalSizeInBytes,
    }
  }
  if (decision.kind !== 'push-existing' && !shouldFlushWithinLimit) {
    throw new LocalCommitBatchingError(
      'invalid-plan',
      'An individually oversized local commit must be rebuilt before it can be pushed.'
    )
  }

  validateLocalCommitBatchingInspection(reviewed, false)
  const remoteName = reviewed.remoteName as string
  const remoteBranchRef = reviewed.remoteBranchRef as string
  const branchRef = reviewed.fingerprint.branchRef as string
  const upstreamSha = reviewed.fingerprint.upstreamSha
  const finalHeadSha = reviewed.fingerprint.headSha as string
  let expectedFingerprint = reviewed.fingerprint
  let publishedBatches = 0

  try {
    const fresh = await operations.inspect()
    validateLocalCommitBatchingInspection(fresh, false)
    if (!inspectionsMatch(reviewed, fresh)) {
      throw new LocalCommitBatchingError(
        'stale-state',
        'The local-only commits changed after push batching was reviewed.'
      )
    }
    const initialRemoteTip = await operations.readRemoteTip({
      remoteName,
      remoteBranchRef,
    })
    if (initialRemoteTip !== upstreamSha) {
      throw new LocalCommitBatchingError(
        'stale-state',
        'The upstream changed before existing local commits could be batch-pushed.'
      )
    }

    for (let index = 0; index < reviewed.localOnlyCommits.length; index++) {
      const commit = reviewed.localOnlyCommits[index]
      await requireFingerprint(operations, expectedFingerprint)
      let pushResult: LocalCommitBatchPushResult
      try {
        pushResult = await operations.push({
          remoteName,
          localBranchRef: branchRef,
          remoteBranchRef,
          expectedRemoteSha:
            index === 0
              ? upstreamSha
              : reviewed.localOnlyCommits[index - 1].sha,
          headSha: commit.sha,
          force: false,
        })
      } catch {
        pushResult = 'unknown'
      }

      const observedRemoteTip = await operations.readRemoteTip({
        remoteName,
        remoteBranchRef,
      })
      if (observedRemoteTip === commit.sha) {
        publishedBatches++
      } else if (pushResult === 'pushed') {
        throw new LocalCommitBatchingError(
          'remote-proof-failed',
          `Existing local commit batch ${
            index + 1
          } was not proven at the remote tip.`
        )
      } else {
        throw new LocalCommitBatchingError(
          'push-failed',
          `Existing local commit batch ${index + 1} did not complete.`
        )
      }

      expectedFingerprint = await operations.readFingerprint()
      validateRuntimeFingerprint(
        expectedFingerprint,
        reviewed,
        finalHeadSha,
        reviewed.fingerprint.indexTreeSha as string,
        false
      )
    }

    if (
      (await operations.readRemoteTip({ remoteName, remoteBranchRef })) !==
      finalHeadSha
    ) {
      throw new LocalCommitBatchingError(
        'remote-proof-failed',
        'The final existing local commit was not proven at the remote tip.'
      )
    }
    return {
      status: 'completed',
      mode: 'existing-commits',
      backupRef: null,
      batchesCommitted: 0,
      batchesPushed: publishedBatches,
      finalHeadSha,
    }
  } catch (error) {
    throw executionError(
      error,
      'unavailable',
      'Existing local commits could not be batch-pushed.',
      null,
      publishedBatches,
      false,
      false
    )
  }
}

/**
 * Entry point for the normal push flow. A not-needed result means the caller
 * should continue with its ordinary push; a completed result means this helper
 * already performed and proved all necessary pushes. Any unsafe oversized
 * state throws, which deliberately prevents an ordinary oversized fallback.
 */
export async function handleLocalCommitPushBatching(
  reviewed: ILocalCommitBatchingInspection,
  operations: ILocalCommitBatchingOperations,
  rewritePlan?: ILocalCommitBatchPlan,
  byteLimit: number = AutomaticCommitPushBatchByteLimit,
  flushExistingBeforeNewCommit: boolean = false,
  fileCountLimit: number = AutomaticLocalCommitBatchFileCountLimit
): Promise<ILocalCommitBatchingResult> {
  const decision = decideLocalCommitPushBatching(
    reviewed,
    byteLimit,
    fileCountLimit
  )
  if (decision.kind === 'not-needed') {
    if (
      flushExistingBeforeNewCommit &&
      decision.reason === 'within-limit' &&
      reviewed.localOnlyCommits.length > 0
    ) {
      return executeExistingLocalCommitPushBatches(
        reviewed,
        operations,
        byteLimit,
        true,
        fileCountLimit
      )
    }
    return {
      status: 'not-needed',
      reason: decision.reason,
      totalSizeInBytes: decision.totalSizeInBytes,
    }
  }
  if (decision.kind === 'push-existing') {
    return executeExistingLocalCommitPushBatches(
      reviewed,
      operations,
      byteLimit,
      false,
      fileCountLimit
    )
  }
  if (
    rewritePlan === undefined ||
    rewritePlan.byteLimit !== byteLimit ||
    rewritePlan.fileCountLimit !== fileCountLimit
  ) {
    throw new LocalCommitBatchingError(
      'invalid-plan',
      'An individually oversized local commit needs an exact reviewed rewrite plan.'
    )
  }
  return executeLocalCommitBatchPlan(reviewed, rewritePlan, operations)
}

/**
 * Replace an eligible old-app local-only range with bounded commits. Every
 * commit is pushed and authoritatively proven before another commit is made.
 * No force-capable operation exists in this interface.
 */
export async function executeLocalCommitBatchPlan(
  reviewed: ILocalCommitBatchingInspection,
  plan: ILocalCommitBatchPlan,
  operations: ILocalCommitBatchingOperations
): Promise<ILocalCommitBatchingResult> {
  validateLocalCommitBatchingInspection(reviewed)
  validatePlan(plan)
  requirePlanMatchesReviewedNetChanges(plan, reviewed)
  if (
    decideLocalCommitPushBatching(reviewed, plan.byteLimit, plan.fileCountLimit)
      .kind !== 'rewrite'
  ) {
    throw new LocalCommitBatchingError(
      'not-oversized',
      'The reviewed local-only history no longer needs a destructive rewrite.'
    )
  }

  let fresh: ILocalCommitBatchingInspection
  try {
    fresh = await operations.inspect()
    validateLocalCommitBatchingInspection(fresh)
  } catch (error) {
    throw executionError(
      error,
      'unavailable',
      'Automatic local-commit batching could not inspect the repository.',
      null,
      0,
      false,
      false
    )
  }
  if (!inspectionsMatch(reviewed, fresh)) {
    throw new LocalCommitBatchingError(
      'stale-state',
      'The local-only commits changed after automatic rebatching was reviewed.'
    )
  }

  const remoteName = reviewed.remoteName as string
  const remoteBranchRef = reviewed.remoteBranchRef as string
  const branchRef = reviewed.fingerprint.branchRef as string
  const originalHeadSha = reviewed.fingerprint.headSha as string
  const upstreamSha = reviewed.fingerprint.upstreamSha
  const upstreamTreeSha = reviewed.upstreamTreeSha as string
  const initialFingerprint = reviewed.fingerprint

  let initialRemoteTip: string | null
  try {
    initialRemoteTip = await operations.readRemoteTip({
      remoteName,
      remoteBranchRef,
    })
  } catch (error) {
    throw executionError(
      error,
      'remote-proof-failed',
      'The upstream tip could not be verified before automatic rebatching.',
      null,
      0,
      false,
      false
    )
  }
  if (initialRemoteTip !== upstreamSha) {
    throw new LocalCommitBatchingError(
      'stale-state',
      'The upstream changed before automatic rebatching could start.'
    )
  }

  const backupRef = backupRefForNonce(operations.createBackupNonce())
  let backupCreated = false
  let resetAttempted = false
  let expectedFingerprint = initialFingerprint
  let currentHeadSha: string | null = originalHeadSha
  let currentTreeSha = reviewed.headTreeSha as string
  let publishedBatches = 0
  let committedBatches = 0
  const createdCommitShas = new Array<string>()

  try {
    try {
      await operations.createBackupRef({
        ref: backupRef,
        newSha: originalHeadSha,
        expectedOldSha: null,
      })
      backupCreated = true
    } catch (error) {
      throw executionError(
        error,
        'backup-failed',
        'The original local tip could not be protected with a CAS backup ref.',
        backupRef,
        0,
        false,
        false
      )
    }

    const immediatelyBeforeReset = await operations.inspect()
    validateLocalCommitBatchingInspection(immediatelyBeforeReset)
    if (!inspectionsMatch(reviewed, immediatelyBeforeReset)) {
      throw new LocalCommitBatchingError(
        'stale-state',
        'The repository changed immediately before automatic rebatching.'
      )
    }
    const remoteImmediatelyBeforeReset = await operations.readRemoteTip({
      remoteName,
      remoteBranchRef,
    })
    if (remoteImmediatelyBeforeReset !== upstreamSha) {
      throw new LocalCommitBatchingError(
        'stale-state',
        'The upstream changed immediately before automatic rebatching.'
      )
    }
    for (const commit of reviewed.localOnlyCommits) {
      if (
        await operations.isCommitReachableFromAnyRemote({
          commitSha: commit.sha,
        })
      ) {
        throw new LocalCommitBatchingError(
          'remote-proof-failed',
          'A reviewed local commit is already reachable from a remote ref, so it was not rewritten.'
        )
      }
    }

    resetAttempted = true
    try {
      await operations.mixedReset({
        targetSha: upstreamSha,
        expected: expectedFingerprint,
        mode: 'mixed',
      })
    } catch (error) {
      throw executionError(
        error,
        'reset-failed',
        'The mixed reset for automatic rebatching did not complete.',
        backupRef,
        0,
        true,
        false
      )
    }
    currentHeadSha = upstreamSha
    currentTreeSha = upstreamTreeSha
    expectedFingerprint = await operations.readFingerprint()
    validateRuntimeFingerprint(
      expectedFingerprint,
      reviewed,
      currentHeadSha,
      currentTreeSha
    )

    for (let index = 0; index < plan.batches.length; index++) {
      const batch = plan.batches[index]
      await requireFingerprint(operations, expectedFingerprint)

      let commitResult: ILocalCommitBatchCommitResult
      try {
        commitResult = await operations.commitPaths({
          paths: batch.changes.map(change => change.path),
          message: batch.message,
          expectedSizeInBytes: batch.sizeInBytes,
          expectedTargetTreeSha: reviewed.headTreeSha as string,
          expected: expectedFingerprint,
          allowEmpty: batch.changes.length === 0,
        })
      } catch (error) {
        throw executionError(
          error,
          'commit-failed',
          `Automatic commit batch ${index + 1} did not complete.`,
          backupRef,
          publishedBatches,
          true,
          false
        )
      }
      if (
        !isObjectId(commitResult.headSha) ||
        (commitResult.parentSha !== null &&
          !isObjectId(commitResult.parentSha)) ||
        !isObjectId(commitResult.treeSha) ||
        commitResult.parentSha !== currentHeadSha ||
        commitResult.headSha === currentHeadSha
      ) {
        throw new LocalCommitBatchingError(
          'commit-failed',
          `Automatic commit batch ${index + 1} returned an invalid commit.`
        )
      }
      currentHeadSha = commitResult.headSha
      currentTreeSha = commitResult.treeSha
      createdCommitShas.push(currentHeadSha)
      committedBatches++
      expectedFingerprint = await operations.readFingerprint()
      validateRuntimeFingerprint(
        expectedFingerprint,
        reviewed,
        currentHeadSha,
        currentTreeSha
      )
      const plannedPaths = new Set(batch.changes.map(change => change.path))
      const committedPaths = new Set(commitResult.paths)
      if (
        committedPaths.size !== commitResult.paths.length ||
        committedPaths.size !== plannedPaths.size ||
        [...plannedPaths].some(path => !committedPaths.has(path)) ||
        !Number.isSafeInteger(commitResult.sizeInBytes) ||
        commitResult.sizeInBytes < 0 ||
        commitResult.sizeInBytes !== batch.sizeInBytes ||
        commitResult.sizeInBytes > plan.byteLimit ||
        commitResult.paths.length > plan.fileCountLimit
      ) {
        throw new LocalCommitBatchingError(
          'commit-failed',
          `Automatic commit batch ${
            index + 1
          } contained unplanned paths or exceeded the byte or file-count limit.`
        )
      }
      if (
        index === plan.batches.length - 1 &&
        currentTreeSha !== reviewed.headTreeSha
      ) {
        throw new LocalCommitBatchingError(
          'commit-failed',
          'The rebuilt final tree does not match the protected original tree.'
        )
      }
      await requireFingerprint(operations, expectedFingerprint)

      let pushResult: LocalCommitBatchPushResult
      try {
        pushResult = await operations.push({
          remoteName,
          localBranchRef: branchRef,
          remoteBranchRef,
          expectedRemoteSha:
            publishedBatches === 0
              ? upstreamSha
              : createdCommitShas[publishedBatches - 1],
          headSha: currentHeadSha,
          force: false,
        })
      } catch {
        pushResult = 'unknown'
      }

      let observedRemoteTip: string | null
      try {
        observedRemoteTip = await operations.readRemoteTip({
          remoteName,
          remoteBranchRef,
        })
      } catch (error) {
        throw executionError(
          error,
          'remote-proof-failed',
          `The remote result for automatic push batch ${index + 1} is unknown.`,
          backupRef,
          publishedBatches,
          true,
          false
        )
      }

      if (observedRemoteTip === currentHeadSha) {
        publishedBatches++
      } else if (pushResult === 'pushed') {
        throw new LocalCommitBatchingError(
          'remote-proof-failed',
          `Automatic push batch ${index + 1} was not visible at the remote tip.`
        )
      } else {
        throw new LocalCommitBatchingError(
          'push-failed',
          `Automatic push batch ${index + 1} did not complete.`
        )
      }

      expectedFingerprint = await operations.readFingerprint()
      validateRuntimeFingerprint(
        expectedFingerprint,
        reviewed,
        currentHeadSha,
        currentTreeSha
      )
    }

    await requireFingerprint(operations, expectedFingerprint)
    if (currentTreeSha !== reviewed.headTreeSha) {
      throw new LocalCommitBatchingError(
        'commit-failed',
        'The rebuilt final tree does not match the protected original tree.'
      )
    }
    const finalRemoteTip = await operations.readRemoteTip({
      remoteName,
      remoteBranchRef,
    })
    if (finalRemoteTip !== currentHeadSha) {
      throw new LocalCommitBatchingError(
        'remote-proof-failed',
        'The final automatic batch was not proven at the remote tip.'
      )
    }
    try {
      await operations.deleteBackupRef({
        ref: backupRef,
        expectedOldSha: originalHeadSha,
      })
      backupCreated = false
    } catch (error) {
      throw executionError(
        error,
        'cleanup-failed',
        'All batches were pushed, but the CAS backup ref could not be removed.',
        backupRef,
        publishedBatches,
        true,
        false
      )
    }

    return {
      status: 'completed',
      mode: 'rewritten-commits',
      backupRef,
      batchesCommitted: committedBatches,
      batchesPushed: publishedBatches,
      finalHeadSha: currentHeadSha as string,
    }
  } catch (error) {
    if (!backupCreated) {
      throw executionError(
        error,
        'unavailable',
        'Automatic local-commit batching failed.',
        null,
        publishedBatches,
        false,
        false
      )
    }

    // Once a push was proven, never move the branch backwards. Keep both the
    // current state and the original CAS backup for a safe retry or recovery.
    if (publishedBatches > 0) {
      throw executionError(
        error,
        'unavailable',
        'Automatic local-commit batching stopped after publishing a batch.',
        backupRef,
        publishedBatches,
        true,
        false
      )
    }

    try {
      const current = await operations.readFingerprint()
      if (fingerprintMatches(current, initialFingerprint)) {
        expectedFingerprint = current
        resetAttempted = false
      } else {
        const isCompletedReset =
          resetAttempted &&
          createdCommitShas.length === 0 &&
          current.headSha === upstreamSha &&
          current.indexTreeSha === upstreamTreeSha &&
          current.branchRef === initialFingerprint.branchRef &&
          current.upstreamRef === initialFingerprint.upstreamRef &&
          current.upstreamSha === initialFingerprint.upstreamSha &&
          current.worktreeFingerprint ===
            initialFingerprint.worktreeFingerprint &&
          current.isIndexClean &&
          !current.hasConflicts &&
          current.operationState === null
        const isHeadOnlyReset =
          resetAttempted &&
          createdCommitShas.length === 0 &&
          current.headSha === upstreamSha &&
          current.indexTreeSha === initialFingerprint.indexTreeSha &&
          current.branchRef === initialFingerprint.branchRef &&
          current.upstreamRef === initialFingerprint.upstreamRef &&
          current.upstreamSha === initialFingerprint.upstreamSha &&
          current.worktreeFingerprint ===
            initialFingerprint.worktreeFingerprint &&
          current.isIndexClean ===
            (initialFingerprint.indexTreeSha === upstreamTreeSha) &&
          current.isWorktreeClean === initialFingerprint.isWorktreeClean &&
          !current.hasConflicts &&
          current.operationState === null
        if (
          !fingerprintMatches(current, expectedFingerprint) &&
          !isCompletedReset &&
          !isHeadOnlyReset
        ) {
          throw new LocalCommitBatchingError(
            'stale-state',
            'The repository changed while automatic rebatching was recovering.'
          )
        }
        expectedFingerprint = current
      }

      for (const commitSha of createdCommitShas) {
        if (
          await operations.isCommitReachableFromAnyRemote({
            commitSha,
          })
        ) {
          throw new LocalCommitBatchingError(
            'restore-failed',
            'A replacement commit is remote-reachable, so the original tip was not restored.'
          )
        }
      }

      if (resetAttempted) {
        await requireFingerprint(operations, expectedFingerprint)
        await operations.restoreFromBackup({
          branchRef,
          backupRef,
          backupSha: originalHeadSha,
          expected: expectedFingerprint,
          mode: 'mixed',
        })
        const restored = await operations.readFingerprint()
        if (!fingerprintMatches(restored, initialFingerprint)) {
          throw new LocalCommitBatchingError(
            'restore-failed',
            'The original repository fingerprint was not restored exactly.'
          )
        }
      }

      await operations.deleteBackupRef({
        ref: backupRef,
        expectedOldSha: originalHeadSha,
      })
      backupCreated = false
      throw executionError(
        error,
        'unavailable',
        'Automatic local-commit batching failed before publishing a batch.',
        null,
        0,
        false,
        resetAttempted
      )
    } catch (recoveryError) {
      if (
        recoveryError instanceof LocalCommitBatchingError &&
        recoveryError.backupRef === null &&
        !backupCreated
      ) {
        throw recoveryError
      }
      throw executionError(
        recoveryError,
        'restore-failed',
        'Automatic rebatching stopped without changing a possibly remote-reachable commit.',
        backupRef,
        0,
        true,
        false
      )
    }
  }
}
