import {
  copyFile,
  lstat,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import { Buffer } from 'buffer'
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
  isSafeBatchCloneItem,
} from '../../models/batch-clone'
import { pathExists } from '../path-exists'
import { git } from '../git/core'
import { urlsMatch } from '../repository-matching'
import { validateEmptyFolder } from '../path-validation'

export const BatchCloneJournalVersion = 1
export const MaxBatchCloneJournalBytes = 2 * 1024 * 1024
export const MaxBatchCloneJournalStatusTextLength = 8192

export interface IBatchCloneJournalSnapshot {
  readonly version: typeof BatchCloneJournalVersion
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
  readonly version: number
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

  public constructor(userDataPath: string) {
    this.userDataPath = userDataPath
    this.path = join(userDataPath, 'clone-queue-v1.json')
    this.backupPath = `${this.path}.backup`
  }

  public async load(): Promise<IBatchCloneJournalSnapshot | null> {
    await this.scrubLegacyQuarantines()
    const raw = await readBoundedJournalFile(this.path).catch(error => {
      if (error.code === 'ENOENT') {
        return null
      }
      log.error('Clone queue journal is unreadable; preserving it', error)
      return 'corrupt'
    })
    if (raw === null) {
      return this.loadBackup()
    }

    const parsed = raw === 'corrupt' ? null : parseBatchCloneJournal(raw)
    if (parsed !== null) {
      return parsed
    }

    const quarantine = `${this.path}.corrupt-${Date.now()}`
    await replaceWithSafeQuarantineMarker(
      this.path,
      quarantine,
      'active clone queue journal'
    )
    return this.loadBackup()
  }

  public async save(snapshot: IBatchCloneJournalSnapshot): Promise<void> {
    const temporaryPath = `${this.path}.tmp-${process.pid}`
    const serialized = serializeBatchCloneJournal(snapshot)
    await writeFile(temporaryPath, serialized, 'utf8')
    try {
      await copyFile(this.path, this.backupPath).catch(error => {
        if (error.code !== 'ENOENT') {
          throw error
        }
      })
      await rename(temporaryPath, this.path)
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  public async clear(): Promise<void> {
    await Promise.all(
      [this.path, this.backupPath].map(path =>
        unlink(path).catch(error => {
          if (error.code !== 'ENOENT') {
            throw error
          }
        })
      )
    )
  }

  private async loadBackup(): Promise<IBatchCloneJournalSnapshot | null> {
    let backup: string
    try {
      backup = await readBoundedJournalFile(this.backupPath)
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null
      }
      log.error('Clone queue journal backup is unreadable', error)
      await replaceWithSafeQuarantineMarker(
        this.backupPath,
        `${this.backupPath}.corrupt-${Date.now()}`,
        'clone queue journal backup'
      )
      return null
    }

    const parsed = parseBatchCloneJournal(backup)
    if (parsed !== null) {
      return parsed
    }
    await replaceWithSafeQuarantineMarker(
      this.backupPath,
      `${this.backupPath}.corrupt-${Date.now()}`,
      'clone queue journal backup'
    )
    return null
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
    version: BatchCloneJournalVersion,
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
    journal.version !== BatchCloneJournalVersion ||
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

async function readBoundedJournalFile(path: string): Promise<string> {
  const metadata = await stat(path)
  if (metadata.size > MaxBatchCloneJournalBytes) {
    throw new Error('Clone queue journal exceeds its maximum size.')
  }
  return readFile(path, 'utf8')
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
