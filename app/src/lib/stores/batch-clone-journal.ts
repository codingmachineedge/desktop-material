import {
  lstat,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'fs/promises'
import { Buffer } from 'buffer'
import { randomUUID } from 'crypto'
import { dirname, join } from 'path'
import {
  BatchCloneMode,
  BatchCloneSource,
  IBatchCloneItem,
  IBatchCloneItemStatus,
  MaxBatchCloneAccountKeyLength,
  MaxBatchCloneItems,
  MaxBatchClonePathLength,
  assertSafeBatchCloneItems,
  isBatchCloneRecoveryId,
  isSafeBatchCloneItem,
} from '../../models/batch-clone'
import { pathExists } from '../path-exists'
import { git } from '../git/core'
import { urlsMatch } from '../repository-matching'
import { validateEmptyFolder } from '../path-validation'
import {
  CrashSafeFileCorruptError,
  CrashSafeFilePersistence,
  sharedCrashSafeFilePersistence,
} from '../crash-safe-file'

/** Legacy direct-to-destination queues remain readable but never gain staging. */
export const BatchCloneJournalVersion = 1
/** New queues use app-owned staging and an unguessable recovery id per item. */
export const CurrentBatchCloneJournalVersion = 2
export type SupportedBatchCloneJournalVersion =
  | typeof BatchCloneJournalVersion
  | typeof CurrentBatchCloneJournalVersion
export const MaxBatchCloneJournalBytes = 2 * 1024 * 1024
export const MaxBatchCloneJournalStatusTextLength = 8192

/** Attempts (after the first) a journal write makes before surfacing failure. */
export const BatchCloneJournalWriteRetries = 3
const BatchCloneJournalRetryBaseDelayMs = 20

/**
 * File-lock/permission errors that are usually momentary on Windows — an
 * antivirus scan or the Search indexer briefly holding a handle in the user
 * data directory. A short opportunistic retry clears them without ever
 * surfacing a scary error while a clone is otherwise healthy.
 */
const TransientJournalWriteErrorCodes = new Set([
  'EPERM',
  'EACCES',
  'EBUSY',
  'ETXTBSY',
  'EMFILE',
  'ENFILE',
])

function isTransientJournalWriteError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    TransientJournalWriteErrorCodes.has(
      String((error as { readonly code?: unknown }).code)
    )
  )
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export interface IBatchCloneJournalSnapshot {
  readonly version: SupportedBatchCloneJournalVersion
  readonly updatedAt: string
  readonly items: ReadonlyArray<IBatchCloneItem>
  readonly statuses: ReadonlyArray<readonly [string, IBatchCloneItemStatus]>
  readonly mode: BatchCloneMode
  readonly source: BatchCloneSource
  readonly paused: boolean
  /** Monotonic within this queue; incremented whenever work is retried. */
  readonly generation?: number
  /** Last generation whose terminal summary was durably acknowledged. */
  readonly notifiedGeneration?: number
}

export interface IBatchCloneJournal {
  load(): Promise<IBatchCloneJournalSnapshot | null>
  save(snapshot: IBatchCloneJournalSnapshot): Promise<void>
  clear(): Promise<void>
}

interface ISerializedStatus {
  readonly kind: IBatchCloneItemStatus['kind']
  readonly progress?: number
  readonly description?: string
  readonly error?: string
  readonly accountKey?: string
  readonly finalized?: boolean
}

interface ISerializedBatchCloneJournal {
  readonly version: SupportedBatchCloneJournalVersion
  readonly updatedAt: string
  readonly items: ReadonlyArray<IBatchCloneItem>
  readonly statuses: ReadonlyArray<readonly [string, ISerializedStatus]>
  readonly mode: BatchCloneMode
  readonly source: BatchCloneSource
  readonly paused: boolean
  readonly generation?: number
  readonly notifiedGeneration?: number
}

/**
 * A small, versioned renderer-owned journal. It never contains account tokens,
 * and corrupt files are preserved beside the active journal for diagnosis.
 */
export class FileBatchCloneJournal implements IBatchCloneJournal {
  private readonly userDataPath: string
  private readonly path: string
  private readonly backupPath: string
  private operationChain: Promise<void> = Promise.resolve()

  public constructor(
    userDataPath: string,
    private readonly persistence: Pick<
      CrashSafeFilePersistence,
      'readText' | 'writeText' | 'clear'
    > = sharedCrashSafeFilePersistence
  ) {
    this.userDataPath = userDataPath
    this.path = join(userDataPath, 'clone-queue-v1.json')
    this.backupPath = `${this.path}.backup`
  }

  public load(): Promise<IBatchCloneJournalSnapshot | null> {
    return this.enqueue(() => this.loadUnlocked())
  }

  public save(snapshot: IBatchCloneJournalSnapshot): Promise<void> {
    return this.enqueue(async () => {
      // Serialize once: invalid input is a programming error, not a retryable
      // condition, so only the write itself is retried below.
      const serialized = serializeBatchCloneJournal(snapshot)
      for (let attempt = 0; ; attempt++) {
        try {
          await this.persistence.writeText(this.path, serialized, {
            backupPath: this.backupPath,
            maxPreviousBytes: MaxBatchCloneJournalBytes,
            validatePrevious: isBatchCloneJournal,
          })
          return
        } catch (error) {
          if (
            attempt >= BatchCloneJournalWriteRetries ||
            !isTransientJournalWriteError(error)
          ) {
            throw error
          }
          await delay(BatchCloneJournalRetryBaseDelayMs * (attempt + 1))
        }
      }
    })
  }

  public clear(): Promise<void> {
    return this.enqueue(async () => {
      await this.persistence.clear(this.path, {
        backupPath: this.backupPath,
      })
      await this.removeLegacyTemporaryFiles()
    })
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.operationChain.then(action)
    this.operationChain = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  private async loadUnlocked(): Promise<IBatchCloneJournalSnapshot | null> {
    await this.scrubLegacyQuarantines()
    await this.removeLegacyTemporaryFiles()

    const primaryInspection = await inspectJournalFile(this.path)
    if (primaryInspection === 'invalid') {
      await replaceWithSafeQuarantineMarker(
        this.path,
        `${this.path}.corrupt-${Date.now()}-${randomUUID()}`,
        'active clone queue journal'
      )
    }

    try {
      const saved = await this.persistence.readText(this.path, {
        backupPath: this.backupPath,
        maxBytes: MaxBatchCloneJournalBytes,
        validate: isBatchCloneJournal,
      })
      return saved === null ? null : parseBatchCloneJournal(saved.contents)
    } catch (error) {
      log.error('Clone queue journal is unreadable; preserving it', error)
      if (error instanceof CrashSafeFileCorruptError) {
        await replaceWithSafeQuarantineMarker(
          this.backupPath,
          `${this.backupPath}.corrupt-${Date.now()}-${randomUUID()}`,
          'clone queue journal backup'
        )
      }
      return null
    }
  }

  /**
   * Older builds preserved raw corrupt payloads. Replace every legacy marker
   * with metadata-only diagnostics before reading current queue files so an
   * embedded password from an old journal cannot remain at rest.
   */
  private async scrubLegacyQuarantines(): Promise<void> {
    let names: ReadonlyArray<string>
    try {
      names = await readdir(this.userDataPath)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        log.error('Unable to inspect clone queue quarantine files', error)
      }
      return
    }

    for (const name of names) {
      if (
        name.startsWith('clone-queue-v1.json') &&
        name.includes('.corrupt-')
      ) {
        const quarantinePath = join(this.userDataPath, name)
        await replaceWithSafeQuarantineMarker(
          quarantinePath,
          quarantinePath,
          'legacy clone queue quarantine'
        )
      }
    }
  }

  private async removeLegacyTemporaryFiles(): Promise<void> {
    let names: ReadonlyArray<string>
    try {
      names = await readdir(this.userDataPath)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
      return
    }

    for (const name of names) {
      if (name.startsWith('clone-queue-v1.json.tmp-')) {
        await unlink(join(this.userDataPath, name)).catch(error => {
          if (error.code !== 'ENOENT') {
            throw error
          }
        })
      }
    }
  }
}

/**
 * Destroy raw corrupt bytes before retaining a diagnostic marker. writeFile
 * truncates a regular file before writing; symlinks are removed first so an
 * attacker-controlled quarantine cannot redirect that overwrite elsewhere.
 */
async function replaceWithSafeQuarantineMarker(
  sourcePath: string,
  quarantinePath: string,
  source: string
): Promise<void> {
  const marker = `${JSON.stringify(
    {
      version: 1,
      kind: 'redacted-corrupt-clone-queue',
      source,
      discardedAt: new Date().toISOString(),
      message:
        'Raw queue data was discarded because it was invalid and may have contained credentials.',
    },
    null,
    2
  )}\n`

  try {
    const metadata = await lstat(sourcePath)
    if (metadata.isSymbolicLink()) {
      await unlink(sourcePath)
      await writeFile(sourcePath, marker, 'utf8')
    } else if (metadata.isFile()) {
      await writeFile(sourcePath, marker, 'utf8')
    } else {
      log.error(`Unable to redact ${source}: path is not a regular file`)
      return
    }

    if (sourcePath !== quarantinePath) {
      await rename(sourcePath, quarantinePath)
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log.error(`Unable to redact ${source}`, error)
    }
  }
}

export function serializeBatchCloneJournal(
  snapshot: IBatchCloneJournalSnapshot
): string {
  assertSafeBatchCloneItems(snapshot.items)
  if (snapshot.statuses.length > MaxBatchCloneItems) {
    throw new Error('Clone queue journal contains too many statuses.')
  }
  const serialized: ISerializedBatchCloneJournal = {
    ...snapshot,
    statuses: snapshot.statuses.map(([path, status]) => [
      path,
      {
        kind: status.kind,
        ...(status.progress !== undefined ? { progress: status.progress } : {}),
        ...(status.description !== undefined
          ? {
              description: truncateJournalText(status.description),
            }
          : {}),
        ...(status.error !== undefined
          ? { error: truncateJournalText(status.error.message) }
          : {}),
        ...(status.accountKey !== undefined
          ? {
              accountKey: status.accountKey.slice(
                0,
                MaxBatchCloneAccountKeyLength
              ),
            }
          : {}),
        ...(status.finalized !== undefined
          ? { finalized: status.finalized }
          : {}),
      },
    ]),
  }
  if (!isSerializedJournal(serialized)) {
    throw new Error('Clone queue journal snapshot is incomplete or invalid.')
  }
  const raw = `${JSON.stringify(serialized, null, 2)}\n`
  if (Buffer.byteLength(raw, 'utf8') > MaxBatchCloneJournalBytes) {
    throw new Error('Clone queue journal exceeds its maximum size.')
  }
  return raw
}

export function parseBatchCloneJournal(
  raw: string
): IBatchCloneJournalSnapshot | null {
  if (Buffer.byteLength(raw, 'utf8') > MaxBatchCloneJournalBytes) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isSerializedJournal(value)) {
    return null
  }

  return {
    version: value.version,
    updatedAt: value.updatedAt,
    items: value.items,
    statuses: value.statuses.map(([path, status]) => [
      path,
      {
        kind: status.kind,
        ...(status.progress !== undefined ? { progress: status.progress } : {}),
        ...(status.description !== undefined
          ? { description: status.description }
          : {}),
        ...(status.error !== undefined
          ? { error: new Error(status.error) }
          : {}),
        ...(status.accountKey !== undefined
          ? { accountKey: status.accountKey }
          : {}),
        ...(status.finalized !== undefined
          ? { finalized: status.finalized }
          : {}),
      },
    ]),
    mode: value.mode,
    source: value.source,
    paused: value.paused,
    ...(value.generation !== undefined ? { generation: value.generation } : {}),
    ...(value.notifiedGeneration !== undefined
      ? { notifiedGeneration: value.notifiedGeneration }
      : {}),
  }
}

function isSerializedJournal(
  value: unknown
): value is ISerializedBatchCloneJournal {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const journal = value as Partial<ISerializedBatchCloneJournal>
  if (
    (journal.version !== BatchCloneJournalVersion &&
      journal.version !== CurrentBatchCloneJournalVersion) ||
    typeof journal.updatedAt !== 'string' ||
    journal.updatedAt.length > 64 ||
    !Array.isArray(journal.items) ||
    journal.items.length === 0 ||
    journal.items.length > MaxBatchCloneItems ||
    !Array.isArray(journal.statuses) ||
    journal.statuses.length !== journal.items.length ||
    journal.statuses.length > MaxBatchCloneItems ||
    (journal.mode !== BatchCloneMode.Parallel &&
      journal.mode !== BatchCloneMode.Sequential) ||
    (journal.source !== 'manual' && journal.source !== 'auto') ||
    typeof journal.paused !== 'boolean' ||
    (journal.generation !== undefined &&
      (!Number.isSafeInteger(journal.generation) || journal.generation < 1)) ||
    (journal.notifiedGeneration !== undefined &&
      (journal.generation === undefined ||
        !Number.isSafeInteger(journal.notifiedGeneration) ||
        journal.notifiedGeneration < 0 ||
        journal.notifiedGeneration > (journal.generation ?? 1)))
  ) {
    return false
  }

  if (!journal.items.every(isBatchCloneItem)) {
    return false
  }

  try {
    assertSafeBatchCloneItems(journal.items)
  } catch {
    return false
  }

  if (
    journal.version === CurrentBatchCloneJournalVersion
      ? !journal.items.every(item => isBatchCloneRecoveryId(item.recoveryId))
      : journal.items.some(item => item.recoveryId !== undefined)
  ) {
    return false
  }

  const itemPaths = new Set(journal.items.map(item => item.path))
  const statusPaths = new Set<string>()
  const statusesValid = journal.statuses.every(entry => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return false
    }
    const path = entry[0]
    if (
      typeof path !== 'string' ||
      path.length > MaxBatchClonePathLength ||
      !itemPaths.has(path) ||
      statusPaths.has(path) ||
      !isSerializedStatus(entry[1])
    ) {
      return false
    }
    statusPaths.add(path)
    return true
  })
  if (!statusesValid) {
    return false
  }
  if (
    (journal.notifiedGeneration ?? 0) > 0 &&
    journal.statuses.some(([, status]) =>
      ['pending', 'cloning', 'interrupted'].includes(status.kind)
    )
  ) {
    return false
  }
  return true
}

function isBatchCloneItem(value: unknown): value is IBatchCloneItem {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const item = value as Partial<IBatchCloneItem>
  return (
    typeof item.url === 'string' &&
    typeof item.name === 'string' &&
    typeof item.path === 'string' &&
    (item.defaultBranch === undefined ||
      typeof item.defaultBranch === 'string') &&
    (item.accountKey === undefined || typeof item.accountKey === 'string') &&
    isSafeBatchCloneItem(item as IBatchCloneItem)
  )
}

function isSerializedStatus(value: unknown): value is ISerializedStatus {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const status = value as Partial<ISerializedStatus>
  const kinds = new Set([
    'pending',
    'cloning',
    'interrupted',
    'review',
    'done',
    'failed',
    'skipped',
  ])
  return (
    typeof status.kind === 'string' &&
    kinds.has(status.kind) &&
    (status.progress === undefined ||
      (typeof status.progress === 'number' &&
        Number.isFinite(status.progress) &&
        status.progress >= 0 &&
        status.progress <= 1)) &&
    (status.description === undefined ||
      (typeof status.description === 'string' &&
        status.description.length <= MaxBatchCloneJournalStatusTextLength)) &&
    (status.error === undefined ||
      (typeof status.error === 'string' &&
        status.error.length <= MaxBatchCloneJournalStatusTextLength)) &&
    (status.accountKey === undefined ||
      (typeof status.accountKey === 'string' &&
        status.accountKey.length <= MaxBatchCloneAccountKeyLength)) &&
    (status.finalized === undefined ||
      (status.kind === 'done' && typeof status.finalized === 'boolean'))
  )
}

/**
 * Semantic gate for the crash-safe persistence layer: true only when the
 * payload parses into a supported, bounded clone-queue journal.
 */
function isBatchCloneJournal(contents: string): boolean {
  return parseBatchCloneJournal(contents) !== null
}

/**
 * Inspect the on-disk journal before the crash-safe read. Symlinked,
 * oversized, or unparsable payloads report `invalid` so the caller replaces
 * them with a redacted quarantine marker — raw bytes from an invalid journal
 * may embed credentials and must never survive at rest.
 */
async function inspectJournalFile(
  path: string
): Promise<'missing' | 'valid' | 'invalid'> {
  let metadata
  try {
    metadata = await lstat(path)
  } catch (error) {
    return error.code === 'ENOENT' ? 'missing' : 'invalid'
  }

  if (!metadata.isFile() || metadata.size > MaxBatchCloneJournalBytes) {
    return 'invalid'
  }

  try {
    return isBatchCloneJournal(await readFile(path, 'utf8'))
      ? 'valid'
      : 'invalid'
  } catch {
    return 'invalid'
  }
}

function truncateJournalText(value: string): string {
  return value.slice(0, MaxBatchCloneJournalStatusTextLength)
}

export type CloneDestinationInspection =
  | 'empty'
  | 'matching-repository'
  | 'review'

/**
 * Inspect an interrupted/failed destination without deleting or moving any
 * user data. A matching, usable Git repository is finalized; an empty path can
 * be retried; everything else requires explicit user review.
 */
export async function inspectCloneDestination(
  item: IBatchCloneItem
): Promise<CloneDestinationInspection> {
  try {
    const parent = await lstat(dirname(item.path))
    // Batch destinations are direct children of the selected base. Reject a
    // base that has become a link/junction so an absent child cannot silently
    // be created somewhere outside the path the user selected.
    if (!parent.isDirectory() || parent.isSymbolicLink()) {
      return 'review'
    }

    const destination = await lstat(item.path)
    // Never follow a destination symlink or Windows junction. Even when its
    // target is empty, cloning through it would escape the user-visible base
    // directory and make recovery reason about a different path than the one
    // recorded in the journal.
    if (destination.isSymbolicLink()) {
      return 'review'
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log.error(`Unable to inspect clone destination ${item.path}`, error)
      return 'review'
    }
  }

  if ((await validateEmptyFolder(item.path)) === null) {
    return 'empty'
  }

  const gitDirectoryPath = join(item.path, '.git')
  if (!(await pathExists(gitDirectoryPath))) {
    return 'review'
  }

  try {
    // A normal clone owns a real .git directory. Reject gitfiles and symlinked
    // metadata so recovery cannot be tricked into accepting a worktree whose
    // repository data lives at an unrelated path.
    const gitDirectory = await lstat(gitDirectoryPath)
    if (!gitDirectory.isDirectory() || gitDirectory.isSymbolicLink()) {
      return 'review'
    }

    const repository = await git(
      ['rev-parse', '--is-inside-work-tree'],
      item.path,
      'batchCloneRecoveryRepository',
      { successExitCodes: new Set([0, 128]), isBackgroundTask: true }
    )
    if (repository.exitCode !== 0 || repository.stdout.trim() !== 'true') {
      return 'review'
    }

    const bare = await git(
      ['rev-parse', '--is-bare-repository'],
      item.path,
      'batchCloneRecoveryBareRepository',
      { successExitCodes: new Set([0, 128]), isBackgroundTask: true }
    )
    if (bare.exitCode !== 0 || bare.stdout.trim() !== 'false') {
      return 'review'
    }

    const head = await git(
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      item.path,
      'batchCloneRecoveryHead',
      { successExitCodes: new Set([0, 128]), isBackgroundTask: true }
    )
    if (head.exitCode !== 0 || head.stdout.trim().length === 0) {
      return 'review'
    }

    const checkout = await git(
      ['status', '--porcelain=v1', '--untracked-files=no'],
      item.path,
      'batchCloneRecoveryCheckout',
      { successExitCodes: new Set([0, 128]), isBackgroundTask: true }
    )
    if (checkout.exitCode !== 0 || checkout.stdout.trim().length > 0) {
      return 'review'
    }

    const origin = await git(
      ['remote', 'get-url', 'origin'],
      item.path,
      'batchCloneRecoveryOrigin',
      { successExitCodes: new Set([0, 2, 128]), isBackgroundTask: true }
    )
    return origin.exitCode === 0 && urlsMatch(origin.stdout.trim(), item.url)
      ? 'matching-repository'
      : 'review'
  } catch (error) {
    log.error(`Unable to inspect interrupted clone at ${item.path}`, error)
    return 'review'
  }
}
