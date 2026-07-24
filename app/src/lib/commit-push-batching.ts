import { lstat } from 'fs/promises'
import { isAbsolute, relative, resolve } from 'path'

/** User-facing upper bound for one Git push: decimal 1.5 GB. */
export const AutomaticCommitPushMaximumBytes = 1_500_000_000

/**
 * Conservative changed-blob ceiling. The remaining 100 MB is reserved for
 * worst-case pack compression overhead, trees, commits, path names, and
 * protocol framing; large raw files have already gone through Cheap LFS.
 */
export const AutomaticCommitPushBatchByteLimit = 1_400_000_000

/** Bound both Git argument/proof work and pathological tiny-file batches. */
export const AutomaticCommitPushBatchMaximumPaths = 10_000

/**
 * Default file-count ceiling for one automatic local-commit batch. A batch is
 * flushed and a new one started once it would exceed EITHER this many files OR
 * the byte limit, whichever is reached first. It is kept in lockstep with the
 * per-batch path bound above so the split planner and the batching decision
 * agree on a single, configurable file ceiling.
 *
 * The companion size ceiling stays at `AutomaticCommitPushBatchByteLimit`
 * (~1.4 GB of changed blobs). That conservative value — rather than a nominal
 * 1.5 GiB (1_610_612_736 bytes) — is intentional: it keeps the resulting pack
 * comfortably below the app's hard 1.5 GB (`AutomaticCommitPushMaximumBytes`,
 * 1_500_000_000 bytes) push ceiling after pack/tree/commit/protocol overhead.
 */
export const AutomaticLocalCommitBatchFileCountLimit =
  AutomaticCommitPushBatchMaximumPaths

/**
 * Process-local Git config that suppresses BOTH the classic `gc --auto` and the
 * newer background `maintenance --auto` for the duration of a single Git
 * invocation. Batched commits, staging, and pushes carry this so that a long
 * auto-repack never fires mid-batch — observed live to burn 1000+ CPU-seconds,
 * contend for the object-store lock, and effectively hang a large batched
 * commit-and-push. A single controlled repack is run once after every batch is
 * pushed instead. These `-c` values apply only to the process they are passed
 * to and never persist to repository configuration, so ordinary small commits
 * keep their normal maintenance behavior.
 */
export const AutomaticCommitPushBatchGitMaintenanceArgs: ReadonlyArray<string> =
  ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false']

/** Stay comfortably below the proof reader's hard 64 MiB stdout ceiling. */
export const AutomaticCommitPushBatchProofByteBudget = 48 * 1024 * 1024

/** Keep large working trees responsive without opening one stat per file. */
export const CommitPushBatchSizeScanConcurrency = 16

export type CommitPushBatchErrorKind =
  | 'invalid-limit'
  | 'unsafe-path'
  | 'unreadable-size'
  | 'invalid-size'
  | 'file-over-limit'
  | 'amend-not-supported'
  | 'conflict-state'
  | 'multi-commit-operation'
  | 'push-unavailable'
  | 'stale-commit'
  | 'unexpected-commit-path'
  | 'missing-commit-path'
  | 'commit-over-limit'
  | 'proof-over-limit'
  | 'invalid-commit-proof'
  | 'commit-failed'
  | 'push-failed'

export class CommitPushBatchError extends Error {
  public constructor(
    public readonly kind: CommitPushBatchErrorKind,
    message: string,
    public readonly path: string | null = null,
    public readonly batchIndex: number | null = null
  ) {
    super(message)
    this.name = 'CommitPushBatchError'
  }
}

export interface ICommitPushBatchCandidate<T> {
  readonly item: T
  readonly path: string
  readonly sizeInBytes: number
  /** Exact paths expected from `diff-tree --no-renames`; defaults to `path`. */
  readonly proofPaths?: ReadonlyArray<string>
}

export interface ICommitPushBatch<T> {
  readonly items: ReadonlyArray<T>
  readonly paths: ReadonlyArray<string>
  readonly sizeInBytes: number
}

export interface IAutomaticCommitPushBatchSafetyState {
  /** Rewriting one existing commit cannot be split into several new commits. */
  readonly amend: boolean
  /** Includes unresolved merge, rebase, and cherry-pick conflict states. */
  readonly hasConflict: boolean
  /** Includes an active merge, rebase, cherry-pick, or revert sequence. */
  readonly hasMultiCommitOperation: boolean
  /** Whether the current branch has a non-force push destination. */
  readonly canPush: boolean
}

/**
 * Guard the behavioral jump from one ordinary commit to multiple
 * commit-and-push mutations. Single-batch commits keep their existing behavior.
 */
export function assertAutomaticCommitPushBatchSafety(
  batchCount: number,
  state: IAutomaticCommitPushBatchSafetyState
): void {
  if (batchCount <= 1) {
    return
  }
  if (state.amend) {
    throw new CommitPushBatchError(
      'amend-not-supported',
      'An amended commit cannot be automatically split into push batches.'
    )
  }
  if (state.hasConflict) {
    throw new CommitPushBatchError(
      'conflict-state',
      'Resolve merge, rebase, or cherry-pick conflicts before automatically splitting a commit.'
    )
  }
  if (state.hasMultiCommitOperation) {
    throw new CommitPushBatchError(
      'multi-commit-operation',
      'Finish the current multi-commit Git operation before automatically splitting a commit.'
    )
  }
  if (!state.canPush) {
    throw new CommitPushBatchError(
      'push-unavailable',
      'Automatic commit splitting needs a current branch and push remote before it creates the first batch.'
    )
  }
}

export interface IWorkingTreeBatchFile<T> {
  readonly item: T
  readonly path: string
  /** A deleted entry contributes no new working-tree bytes to the push. */
  readonly deleted: boolean
  /** Includes both old and new path for a rename. */
  readonly proofPaths?: ReadonlyArray<string>
}

export interface IFileSizeStat {
  readonly size: number
}

export type CommitPushBatchStat = (path: string) => Promise<IFileSizeStat>

function ensureSafeRelativePath(repositoryPath: string, candidate: string) {
  if (candidate.length === 0 || isAbsolute(candidate)) {
    throw new CommitPushBatchError(
      'unsafe-path',
      `Automatic commit batching refused an unsafe changed-file path: ${
        candidate || '<empty>'
      }.`,
      candidate
    )
  }

  const root = resolve(repositoryPath)
  const absolutePath = resolve(root, candidate)
  const fromRoot = relative(root, absolutePath)
  if (
    fromRoot === '' ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..\\`) ||
    fromRoot.startsWith('../') ||
    isAbsolute(fromRoot)
  ) {
    throw new CommitPushBatchError(
      'unsafe-path',
      `Automatic commit batching refused a changed-file path outside the repository: ${candidate}.`,
      candidate
    )
  }

  return absolutePath
}

function normalizeSize(path: string, size: number): number {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new CommitPushBatchError(
      'invalid-size',
      `Automatic commit batching received an invalid size for ${path}.`,
      path
    )
  }
  return size
}

/**
 * Read conservative working-tree sizes with a fixed worker bound. Deleted
 * entries are zero-byte operations. Any other unreadable entry fails closed so
 * it can never be silently placed in a supposedly safe push batch.
 */
export async function measureWorkingTreeBatchFiles<T>(
  repositoryPath: string,
  files: ReadonlyArray<IWorkingTreeBatchFile<T>>,
  statFile: CommitPushBatchStat = lstat,
  concurrency: number = CommitPushBatchSizeScanConcurrency
): Promise<ReadonlyArray<ICommitPushBatchCandidate<T>>> {
  const workerCount = Math.min(
    files.length,
    Math.max(1, Math.floor(Number.isFinite(concurrency) ? concurrency : 1))
  )
  const measured = new Array<ICommitPushBatchCandidate<T> | undefined>(
    files.length
  )
  const failures = new Array<unknown>(files.length)
  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const index = nextIndex++
      if (index >= files.length) {
        return
      }
      const file = files[index]
      try {
        const absolutePath = ensureSafeRelativePath(repositoryPath, file.path)
        const proofPaths = file.proofPaths ?? [file.path]
        const uniqueProofPaths = new Set<string>()
        if (proofPaths.length === 0 || !proofPaths.includes(file.path)) {
          throw new CommitPushBatchError(
            'unsafe-path',
            `Automatic commit batching received incomplete proof paths for ${file.path}.`,
            file.path
          )
        }
        for (const proofPath of proofPaths) {
          ensureSafeRelativePath(repositoryPath, proofPath)
          if (uniqueProofPaths.has(proofPath)) {
            throw new CommitPushBatchError(
              'unsafe-path',
              `Automatic commit batching received a duplicate proof path: ${proofPath}.`,
              proofPath
            )
          }
          uniqueProofPaths.add(proofPath)
        }
        const sizeInBytes = file.deleted
          ? 0
          : normalizeSize(file.path, (await statFile(absolutePath)).size)
        measured[index] = {
          item: file.item,
          path: file.path,
          sizeInBytes,
          ...(file.proofPaths === undefined
            ? {}
            : { proofPaths: [...uniqueProofPaths] }),
        }
      } catch (error) {
        failures[index] = error
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker))
  const failureIndex = failures.findIndex(error => error !== undefined)
  if (failureIndex !== -1) {
    const failure = failures[failureIndex]
    if (failure instanceof CommitPushBatchError) {
      throw failure
    }
    throw new CommitPushBatchError(
      'unreadable-size',
      `Automatic commit batching could not read the size of ${files[failureIndex].path}.`,
      files[failureIndex].path
    )
  }

  return measured as ReadonlyArray<ICommitPushBatchCandidate<T>>
}

export interface ICommitPushBatchPlanningLimits {
  readonly maximumPathsPerBatch?: number
  readonly maximumProofBytesPerBatch?: number
}

/** A control-plane file which must be committed by the first planned batch. */
export interface IFirstCommitPushBatchFile {
  readonly path: string
  readonly sizeInBytes: number
}

function estimatedRawProofBytes(path: string): number {
  // Two full object ids, two modes, status and delimiters plus the NUL-ended
  // UTF-8 path. The 256-byte metadata allowance covers SHA-256 repositories.
  return 256 + Buffer.byteLength(path, 'utf8')
}

/** Stable next-fit partitioning. The caller's file order is never changed. */
export function splitCommitPushBatches<T>(
  candidates: ReadonlyArray<ICommitPushBatchCandidate<T>>,
  byteLimit: number = AutomaticCommitPushBatchByteLimit,
  limits: ICommitPushBatchPlanningLimits = {}
): ReadonlyArray<ICommitPushBatch<T>> {
  if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0) {
    throw new CommitPushBatchError(
      'invalid-limit',
      'Automatic commit batching requires a positive safe-integer byte limit.'
    )
  }
  const maximumPaths =
    limits.maximumPathsPerBatch ?? AutomaticCommitPushBatchMaximumPaths
  const maximumProofBytes =
    limits.maximumProofBytesPerBatch ?? AutomaticCommitPushBatchProofByteBudget
  if (
    !Number.isSafeInteger(maximumPaths) ||
    maximumPaths <= 0 ||
    !Number.isSafeInteger(maximumProofBytes) ||
    maximumProofBytes <= 0
  ) {
    throw new CommitPushBatchError(
      'invalid-limit',
      'Automatic commit batching requires positive proof limits.'
    )
  }

  const batches = new Array<ICommitPushBatch<T>>()
  let items = new Array<T>()
  let paths = new Array<string>()
  let pathSet = new Set<string>()
  const allPaths = new Set<string>()
  let sizeInBytes = 0
  let proofBytes = 0

  const flush = () => {
    if (items.length === 0) {
      return
    }
    batches.push({ items, paths, sizeInBytes })
    items = []
    paths = []
    pathSet = new Set<string>()
    sizeInBytes = 0
    proofBytes = 0
  }

  for (const candidate of candidates) {
    const size = normalizeSize(candidate.path, candidate.sizeInBytes)
    const candidatePaths = candidate.proofPaths ?? [candidate.path]
    const candidatePathSet = new Set<string>()
    let candidateProofBytes = 0
    for (const path of candidatePaths) {
      if (
        path.length === 0 ||
        path.includes('\0') ||
        candidatePathSet.has(path)
      ) {
        throw new CommitPushBatchError(
          'unsafe-path',
          'Automatic commit batching received an invalid proof path.',
          path
        )
      }
      candidatePathSet.add(path)
      candidateProofBytes += estimatedRawProofBytes(path)
      if (!Number.isSafeInteger(candidateProofBytes)) {
        throw new CommitPushBatchError(
          'proof-over-limit',
          'Automatic commit batching received overflowing proof metadata.',
          path
        )
      }
    }
    if (!candidatePathSet.has(candidate.path)) {
      throw new CommitPushBatchError(
        'unsafe-path',
        `Automatic commit batching omitted the primary path ${candidate.path} from its proof.`,
        candidate.path
      )
    }
    if (size > byteLimit) {
      throw new CommitPushBatchError(
        'file-over-limit',
        `The file ${candidate.path} is larger than the automatic ${byteLimit}-byte push batch limit.`,
        candidate.path
      )
    }
    if (
      candidatePathSet.size > maximumPaths ||
      candidateProofBytes > maximumProofBytes
    ) {
      throw new CommitPushBatchError(
        'proof-over-limit',
        `The file ${candidate.path} has proof metadata larger than one safe automatic batch.`,
        candidate.path
      )
    }
    for (const path of candidatePathSet) {
      if (allPaths.has(path)) {
        throw new CommitPushBatchError(
          'unsafe-path',
          `Automatic commit batching received the path ${path} more than once.`,
          path
        )
      }
      allPaths.add(path)
    }
    if (
      items.length > 0 &&
      (sizeInBytes + size > byteLimit ||
        pathSet.size + candidatePathSet.size > maximumPaths ||
        proofBytes + candidateProofBytes > maximumProofBytes)
    ) {
      flush()
    }
    items.push(candidate.item)
    for (const path of candidatePathSet) {
      pathSet.add(path)
      paths.push(path)
    }
    sizeInBytes += size
    proofBytes += candidateProofBytes
  }
  flush()
  return batches
}

type FirstBatchPlanningItem<T> =
  | { readonly kind: 'candidate'; readonly item: T }
  | { readonly kind: 'required-file' }

interface IFirstBatchCandidateRecord<T> {
  readonly candidate: ICommitPushBatchCandidate<T>
  promoted: boolean
  primaryRequiredSize: number | null
  additionalRequiredSize: number
}

/**
 * Add required control files before partitioning, so their paths and bytes are
 * bounded by the same planner as ordinary changes. A required file which was
 * already selected is promoted to batch one and counted exactly once.
 */
export function splitCommitPushBatchesWithFirstBatchFiles<T>(
  candidates: ReadonlyArray<ICommitPushBatchCandidate<T>>,
  requiredFiles: ReadonlyArray<IFirstCommitPushBatchFile>,
  byteLimit: number = AutomaticCommitPushBatchByteLimit,
  limits: ICommitPushBatchPlanningLimits = {}
): ReadonlyArray<ICommitPushBatch<T>> {
  if (requiredFiles.length === 0) {
    return splitCommitPushBatches(candidates, byteLimit, limits)
  }

  const records = candidates.map(
    (candidate): IFirstBatchCandidateRecord<T> => ({
      candidate,
      promoted: false,
      primaryRequiredSize: null,
      additionalRequiredSize: 0,
    })
  )
  const requiredIdentities = new Set<string>()
  const prefix = new Array<
    | {
        readonly kind: 'candidate'
        readonly record: IFirstBatchCandidateRecord<T>
      }
    | {
        readonly kind: 'required-file'
        readonly file: IFirstCommitPushBatchFile
      }
  >()

  for (const file of requiredFiles) {
    const size = normalizeSize(file.path, file.sizeInBytes)
    if (file.path.length === 0 || file.path.includes('\0')) {
      throw new CommitPushBatchError(
        'unsafe-path',
        'Automatic commit batching received an invalid required-file path.',
        file.path
      )
    }
    const identity = file.path.toLowerCase()
    if (requiredIdentities.has(identity)) {
      throw new CommitPushBatchError(
        'unsafe-path',
        `Automatic commit batching received the required path ${file.path} more than once.`,
        file.path
      )
    }
    requiredIdentities.add(identity)

    const matches = records.filter(record =>
      (record.candidate.proofPaths ?? [record.candidate.path]).some(
        path => path.toLowerCase() === identity
      )
    )
    if (matches.length > 1) {
      throw new CommitPushBatchError(
        'unsafe-path',
        `Automatic commit batching received an ambiguous required path: ${file.path}.`,
        file.path
      )
    }

    const match = matches[0]
    if (match === undefined) {
      prefix.push({
        kind: 'required-file',
        file: { ...file, sizeInBytes: size },
      })
      continue
    }

    if (!match.promoted) {
      match.promoted = true
      prefix.push({ kind: 'candidate', record: match })
    }
    if (match.candidate.path.toLowerCase() === identity) {
      // The later measurement of the required file is authoritative and
      // replaces (rather than duplicates) the selected candidate's size.
      match.primaryRequiredSize = size
    } else {
      const total = match.additionalRequiredSize + size
      if (!Number.isSafeInteger(total)) {
        throw new CommitPushBatchError(
          'invalid-size',
          `Automatic commit batching received overflowing required-file sizes for ${file.path}.`,
          file.path
        )
      }
      match.additionalRequiredSize = total
    }
  }

  const entries = [
    ...prefix,
    ...records
      .filter(record => !record.promoted)
      .map(record => ({ kind: 'candidate' as const, record })),
  ]
  const planned = splitCommitPushBatches<FirstBatchPlanningItem<T>>(
    entries.map(entry => {
      if (entry.kind === 'required-file') {
        return {
          item: { kind: 'required-file' as const },
          path: entry.file.path,
          sizeInBytes: entry.file.sizeInBytes,
        }
      }
      const { candidate, primaryRequiredSize, additionalRequiredSize } =
        entry.record
      const baseSize = primaryRequiredSize ?? candidate.sizeInBytes
      const sizeInBytes = baseSize + additionalRequiredSize
      if (!Number.isSafeInteger(sizeInBytes)) {
        throw new CommitPushBatchError(
          'invalid-size',
          `Automatic commit batching received an overflowing size for ${candidate.path}.`,
          candidate.path
        )
      }
      return {
        item: { kind: 'candidate' as const, item: candidate.item },
        path: candidate.path,
        sizeInBytes,
        ...(candidate.proofPaths === undefined
          ? {}
          : { proofPaths: candidate.proofPaths }),
      }
    }),
    byteLimit,
    limits
  )

  const firstPathIdentities = new Set(
    planned[0]?.paths.map(path => path.toLowerCase()) ?? []
  )
  for (const file of requiredFiles) {
    if (!firstPathIdentities.has(file.path.toLowerCase())) {
      throw new CommitPushBatchError(
        'file-over-limit',
        `The required file ${file.path} could not fit in the first automatic commit batch.`,
        file.path
      )
    }
  }

  return planned.map(batch => ({
    ...batch,
    items: batch.items.flatMap(item =>
      item.kind === 'candidate' ? [item.item] : []
    ),
  }))
}

export interface ICommitPushBatchExecution<T> {
  readonly commit: (
    batch: ICommitPushBatch<T>,
    index: number,
    total: number
  ) => Promise<boolean>
  readonly push: (
    batch: ICommitPushBatch<T>,
    index: number,
    total: number
  ) => Promise<boolean>
  readonly onProgress?: (
    phase: 'committing' | 'pushing',
    batch: ICommitPushBatch<T>,
    index: number,
    total: number
  ) => void
}

/**
 * Detailed, UI-facing snapshot of how far an automatic commit-and-push
 * sequence has progressed. Surfaced so a large change set shows real motion
 * (which batch, how many files/bytes are already committed) instead of a
 * generic "committing files" state that can look stuck.
 */
export interface ICommitBatchProgress {
  /** The stage of the current batch: still committing, or pushing it. */
  readonly phase: 'committing' | 'pushing'
  /** 1-based index of the batch currently being processed. */
  readonly batchNumber: number
  /** Total number of batches this commit was split into. */
  readonly batchCount: number
  /** Files whose batch commit has already completed. */
  readonly filesCommitted: number
  /** Total files across every batch of this commit. */
  readonly filesTotal: number
  /** Changed bytes whose batch commit has already completed. */
  readonly bytesCommitted: number
  /** Total changed bytes across every batch of this commit. */
  readonly bytesTotal: number
}

/**
 * Derive a cumulative progress snapshot for `executeCommitPushBatches`. A
 * batch's files and bytes count as committed once its own commit has completed:
 * during the `committing` stage only earlier batches are done, and during the
 * `pushing` stage this batch's commit has completed too.
 */
export function computeCommitBatchProgress<T>(
  batches: ReadonlyArray<ICommitPushBatch<T>>,
  phase: 'committing' | 'pushing',
  index: number
): ICommitBatchProgress {
  if (!Number.isInteger(index) || index < 0 || index >= batches.length) {
    throw new CommitPushBatchError(
      'invalid-limit',
      'Automatic commit batch progress received an out-of-range batch index.',
      null,
      index
    )
  }

  let filesTotal = 0
  let bytesTotal = 0
  let filesBefore = 0
  let bytesBefore = 0
  for (let i = 0; i < batches.length; i++) {
    const batchFiles = batches[i].items.length
    const batchBytes = batches[i].sizeInBytes
    filesTotal += batchFiles
    bytesTotal += batchBytes
    if (i < index) {
      filesBefore += batchFiles
      bytesBefore += batchBytes
    }
  }

  const includeCurrent = phase === 'pushing'
  return {
    phase,
    batchNumber: index + 1,
    batchCount: batches.length,
    filesCommitted:
      filesBefore + (includeCurrent ? batches[index].items.length : 0),
    filesTotal,
    bytesCommitted:
      bytesBefore + (includeCurrent ? batches[index].sizeInBytes : 0),
    bytesTotal,
  }
}

/**
 * Execute a reviewed split plan. A later commit is unreachable until the prior
 * batch push returns true; a thrown/reported failure stops the sequence.
 */
export async function executeCommitPushBatches<T>(
  batches: ReadonlyArray<ICommitPushBatch<T>>,
  execution: ICommitPushBatchExecution<T>
): Promise<void> {
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index]
    execution.onProgress?.('committing', batch, index, batches.length)
    if (!(await execution.commit(batch, index, batches.length))) {
      throw new CommitPushBatchError(
        'commit-failed',
        `Automatic commit batch ${index + 1} of ${
          batches.length
        } did not complete.`,
        null,
        index
      )
    }
    execution.onProgress?.('pushing', batch, index, batches.length)
    if (!(await execution.push(batch, index, batches.length))) {
      throw new CommitPushBatchError(
        'push-failed',
        `Automatic push batch ${index + 1} of ${
          batches.length
        } did not complete.`,
        null,
        index
      )
    }
  }
}
