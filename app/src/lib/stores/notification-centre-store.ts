import { join } from 'path'
import { readFile, writeFile, rename } from 'fs/promises'
import { randomUUID } from 'crypto'
import { TypedBaseStore } from './base-store'
import { getPath } from '../../ui/main-process-proxy'
import { Repository } from '../../models/repository'
import { git } from '../git/core'
import {
  ensureProfileRepository,
  commitAllChanges,
  ProfileCommitQueue,
  getProfileHistory,
  getProfileCommitFiles,
  getProfileCommitDiff,
  undoLastProfileChange,
  redoLastProfileChange,
  restoreProfileTo,
} from '../profiles/profile-git'
import {
  countUnread,
  insertNotification,
  parseNotificationLog,
  serializeNotificationLog,
  INotificationEntry,
  NotificationInput,
} from '../../models/notification-centre'
import { IProfileHistoryPage } from '../../models/profile'

/** The single notifications file tracked by the notification repository. */
const NotificationsFileName = 'notifications.json'

/** How many commits back to search when recovering a corrupt working file. */
const MaxCorruptionRecoveryDepth = 5

/** Public state surfaced by the notification centre store. */
export interface INotificationCentreState {
  readonly entries: ReadonlyArray<INotificationEntry>
  readonly unreadCount: number
  readonly isOpen: boolean
}

/**
 * Collects app events into an in-app notification centre backed by a single
 * global Git repository under `userData/notifications/`. Every mutation (post,
 * mark read/unread, delete, mark-all, clear) updates the in-memory list, emits,
 * and queues a granular commit so the full history can be browsed and restored.
 *
 * Like {@link ProfileStore} the store is defensive: if it cannot initialize it
 * disables itself and every method becomes a no-op, so a failure here can never
 * break the rest of the application.
 */
export class NotificationCentreStore extends TypedBaseStore<INotificationCentreState> {
  private repository: Repository | null = null
  private queue: ProfileCommitQueue | null = null
  private entries: ReadonlyArray<INotificationEntry> = []
  private open = false
  private enabled = false

  /** Serializes file writes so the last write always reflects final state. */
  private writeChain: Promise<void> = Promise.resolve()

  /** Resolves once initialization has been attempted (success or failure). */
  private initialization: Promise<void> | null = null

  /**
   * Resolve the userData directory, prepare the notification repository and load
   * (or initialize) the notifications file. Safe to call more than once; the
   * work only happens on the first call.
   */
  public initialize(): Promise<void> {
    if (this.initialization === null) {
      this.initialization = this.initializeOnce().catch(err => {
        log.error(
          'NotificationCentreStore failed to initialize; disabled',
          err
        )
        this.enabled = false
      })
    }
    return this.initialization
  }

  private async initializeOnce(): Promise<void> {
    const dir = join(await getPath('userData'), 'notifications')
    let repository = await ensureProfileRepository(dir)
    let recovered = false

    try {
      await this.loadOrInitialize(repository)
    } catch {
      // The working file is corrupt and no committed version could be
      // recovered. Preserve the corrupt directory for forensics and start
      // fresh; a recovery notice is recorded once the store is live.
      repository = await this.recoverFromUnrecoverableCorruption(dir)
      recovered = true
    }

    this.repository = repository
    this.queue = new ProfileCommitQueue(repository)
    this.enabled = true

    if (recovered) {
      await this.postInternal({
        kind: 'app-error',
        title: 'Notifications reset',
        body: 'The notifications history was corrupt and could not be recovered, so it was reset. The previous data was kept on disk for inspection.',
      })
    }

    this.emitState()
  }

  public getState(): INotificationCentreState {
    return {
      entries: this.entries,
      unreadCount: countUnread(this.entries),
      isOpen: this.open,
    }
  }

  /** Record a new notification (or coalesce a recent duplicate). */
  public async post(input: NotificationInput): Promise<void> {
    await this.initialize()
    if (!this.enabled) {
      return
    }
    await this.postInternal(input)
  }

  private async postInternal(input: NotificationInput): Promise<void> {
    const { entries, entry, deduped, pruned } = insertNotification(
      this.entries,
      input,
      randomUUID(),
      new Date()
    )
    this.entries = entries
    this.emitState()

    const verb = deduped ? 'Update' : 'Add'
    const prunedNote = pruned > 0 ? ` (pruned ${pruned})` : ''
    await this.persist(`${verb} notification: ${entry.title}${prunedNote}`)
  }

  /** Mark a single notification as read. */
  public markRead(id: string): Promise<void> {
    return this.setRead(id, true)
  }

  /** Mark a single notification as unread. */
  public markUnread(id: string): Promise<void> {
    return this.setRead(id, false)
  }

  private async setRead(id: string, read: boolean): Promise<void> {
    await this.initialize()
    if (!this.enabled) {
      return
    }

    const target = this.entries.find(entry => entry.id === id)
    if (target === undefined || target.read === read) {
      return
    }

    this.entries = this.entries.map(entry =>
      entry.id === id ? { ...entry, read } : entry
    )
    this.emitState()

    const verb = read ? 'Mark read' : 'Mark unread'
    await this.persist(`${verb}: ${target.title}`)
  }

  /** Delete a single notification. */
  public async delete(id: string): Promise<void> {
    await this.initialize()
    if (!this.enabled) {
      return
    }

    const target = this.entries.find(entry => entry.id === id)
    if (target === undefined) {
      return
    }

    this.entries = this.entries.filter(entry => entry.id !== id)
    this.emitState()

    await this.persist(`Delete notification: ${target.title}`)
  }

  /** Mark every notification as read. */
  public async markAllRead(): Promise<void> {
    await this.initialize()
    if (!this.enabled || this.entries.every(entry => entry.read)) {
      return
    }

    this.entries = this.entries.map(entry =>
      entry.read ? entry : { ...entry, read: true }
    )
    this.emitState()

    await this.persist('Mark all notifications read')
  }

  /** Remove every notification. */
  public async clearAll(): Promise<void> {
    await this.initialize()
    if (!this.enabled || this.entries.length === 0) {
      return
    }

    this.entries = []
    this.emitState()

    await this.persist('Clear all notifications')
  }

  /** Toggle whether the notification centre panel is open. */
  public setOpen(open: boolean): void {
    if (this.open === open) {
      return
    }
    this.open = open
    this.emitState()
  }

  /**
   * Re-read the notifications file from disk. Used after a history undo, redo or
   * restore, which mutate the file behind the store's back.
   */
  public async reload(): Promise<void> {
    if (!this.enabled || this.repository === null) {
      return
    }

    const raw = await readFile(
      join(this.repository.path, NotificationsFileName),
      'utf8'
    ).catch(() => null)
    const parsed = raw === null ? null : parseNotificationLog(raw)
    this.entries = parsed?.entries ?? []
    this.emitState()
  }

  /** Flush any pending commit (e.g. before the window closes). */
  public async flush(): Promise<void> {
    if (!this.enabled) {
      return
    }
    await this.writeChain.catch(() => undefined)
    await this.queue?.flush()
  }

  // --- History source (consumed by the notification history manager) ---------

  public async getHistory(
    skip?: number,
    limit?: number
  ): Promise<IProfileHistoryPage> {
    await this.initialize()
    if (!this.enabled || this.repository === null) {
      return emptyHistoryPage()
    }
    await this.flush()
    return getProfileHistory(this.repository, skip, limit)
  }

  public async getHistoryFiles(sha: string): Promise<ReadonlyArray<string>> {
    await this.initialize()
    if (!this.enabled || this.repository === null) {
      return []
    }
    await this.flush()
    return getProfileCommitFiles(this.repository, sha)
  }

  public async getHistoryDiff(sha: string, file?: string): Promise<string> {
    await this.initialize()
    if (!this.enabled || this.repository === null) {
      return ''
    }
    await this.flush()
    return getProfileCommitDiff(this.repository, sha, file)
  }

  public async undoLastChange(): Promise<void> {
    await this.runHistoryMutation(repository =>
      undoLastProfileChange(repository)
    )
  }

  public async redoLastChange(): Promise<void> {
    await this.runHistoryMutation(repository =>
      redoLastProfileChange(repository)
    )
  }

  public async restoreTo(sha: string): Promise<void> {
    await this.runHistoryMutation(repository =>
      restoreProfileTo(repository, sha, [NotificationsFileName])
    )
  }

  private async runHistoryMutation(
    action: (repository: Repository) => Promise<void>
  ): Promise<void> {
    await this.initialize()
    if (!this.enabled || this.repository === null) {
      return
    }
    await this.flush()
    await action(this.repository)
    await this.reload()
  }

  // --- Internals -------------------------------------------------------------

  private emitState(): void {
    this.emitUpdate(this.getState())
  }

  /**
   * Write the current entries to disk and queue a commit. File writes are
   * serialized behind {@link writeChain}; because each write serializes the full
   * entry list, the last write always reflects the final in-memory state even
   * when several mutations race.
   */
  private persist(description: string): Promise<void> {
    const repository = this.repository
    const queue = this.queue
    if (repository === null || queue === null) {
      return Promise.resolve()
    }

    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        await writeFile(
          join(repository.path, NotificationsFileName),
          serializeNotificationLog(this.entries)
        )
        queue.schedule(description)
      })

    return this.writeChain
  }

  private async loadOrInitialize(repository: Repository): Promise<void> {
    const path = join(repository.path, NotificationsFileName)

    const raw = await readFile(path, 'utf8').catch(() => null)
    if (raw === null) {
      // Fresh install — seed an empty log and record the first commit.
      this.entries = []
      await writeFile(path, serializeNotificationLog([]))
      await commitAllChanges(repository, 'Initialize notifications')
      return
    }

    const parsed = parseNotificationLog(raw)
    if (parsed !== null) {
      this.entries = parsed.entries
      return
    }

    // The working file is corrupt. Walk back through committed history looking
    // for the most recent parseable version.
    for (let back = 0; back < MaxCorruptionRecoveryDepth; back++) {
      const recovered = await this.readEntriesFromCommit(repository, back)
      if (recovered !== null) {
        this.entries = recovered
        await writeFile(path, serializeNotificationLog(recovered))
        await commitAllChanges(
          repository,
          `Recover notifications from HEAD~${back}`
        )
        return
      }
    }

    throw new Error('The notifications file is corrupt beyond recovery')
  }

  private async readEntriesFromCommit(
    repository: Repository,
    back: number
  ): Promise<ReadonlyArray<INotificationEntry> | null> {
    const result = await git(
      ['show', `HEAD~${back}:${NotificationsFileName}`],
      repository.path,
      'notificationShow',
      { successExitCodes: new Set([0, 128]) }
    )
    if (result.exitCode !== 0) {
      return null
    }
    return parseNotificationLog(result.stdout)?.entries ?? null
  }

  private async recoverFromUnrecoverableCorruption(
    dir: string
  ): Promise<Repository> {
    const quarantine = `${dir}-corrupt-${Date.now()}`
    await rename(dir, quarantine).catch(err =>
      log.error('Failed to quarantine corrupt notifications directory', err)
    )

    const repository = await ensureProfileRepository(dir)
    this.entries = []
    await writeFile(
      join(repository.path, NotificationsFileName),
      serializeNotificationLog([])
    )
    await commitAllChanges(
      repository,
      'Reinitialize notifications after corruption'
    )
    return repository
  }
}

function emptyHistoryPage(): IProfileHistoryPage {
  return {
    entries: [],
    total: 0,
    hasMore: false,
    canUndo: false,
    canRedo: false,
  }
}
