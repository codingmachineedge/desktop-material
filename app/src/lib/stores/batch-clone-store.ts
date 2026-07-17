import pLimit from 'p-limit'
import { TypedBaseStore } from './base-store'
import { CloningRepositoriesStore } from './cloning-repositories-store'
import {
  BatchCloneMode,
  BatchCloneParallelLimit,
  BatchCloneSource,
  IBatchCloneItem,
  IBatchCloneItemStatus,
  IBatchCloneState,
  assertSafeBatchCloneItems,
  batchCloneNeedsAttention,
  computeBatchCloneProgress,
  isBatchCloneDone,
} from '../../models/batch-clone'
import { getPath } from '../../ui/main-process-proxy'
import { matchExistingRepository } from '../repository-matching'
import {
  BatchCloneJournalVersion,
  CloneDestinationInspection,
  FileBatchCloneJournal,
  IBatchCloneJournal,
  IBatchCloneJournalSnapshot,
  inspectCloneDestination,
} from './batch-clone-journal'

/**
 * Select only completed clone paths which `_addRepositories` actually
 * registered (or matched to an existing repository). Missing or temporarily
 * unreadable destinations must remain unfinalized so recovery can retry them.
 */
export function selectRegisteredBatchClonePaths(
  paths: ReadonlyArray<string>,
  repositories: ReadonlyArray<{ readonly path: string }>
): ReadonlyArray<string> {
  return paths.filter(
    path => matchExistingRepository(repositories, path) !== undefined
  )
}

/**
 * Coordinates cloning many repositories at once. Queue transitions are
 * journaled, so a renderer/app crash can restore the unfinished work without
 * ever deleting an occupied destination.
 */
export class BatchCloneStore extends TypedBaseStore<IBatchCloneState | null> {
  private items: ReadonlyArray<IBatchCloneItem> = []
  private statuses = new Map<string, IBatchCloneItemStatus>()
  private mode: BatchCloneMode = BatchCloneMode.Parallel
  private source: BatchCloneSource = 'manual'
  private running = false
  private paused = false
  private pauseRequested = false
  private cancelRequested = false
  private generation = 0
  private notifiedGeneration = 0
  private initialized = false
  private journal: IBatchCloneJournal | null
  private writeChain: Promise<void> = Promise.resolve()
  private journalFailureReported = false

  public constructor(
    private readonly cloningRepositoriesStore: CloningRepositoriesStore,
    journal?: IBatchCloneJournal,
    private readonly inspectDestination = inspectCloneDestination
  ) {
    super()
    this.journal = journal ?? null
  }

  /** Load and normalize an interrupted queue from disk once per app lifetime. */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }
    this.initialized = true

    try {
      if (this.journal === null) {
        this.journal = new FileBatchCloneJournal(await getPath('userData'))
      }
      const snapshot = await this.journal.load()
      if (snapshot === null || snapshot.items.length === 0) {
        return
      }

      assertSafeBatchCloneItems(snapshot.items)
      this.items = snapshot.items
      this.mode = snapshot.mode
      this.source = snapshot.source
      this.generation = snapshot.generation ?? 1
      this.notifiedGeneration = snapshot.notifiedGeneration ?? 0
      this.statuses = new Map(
        snapshot.items.map(item => {
          const restored = new Map(snapshot.statuses).get(item.path) ?? {
            kind: 'pending' as const,
          }
          return [
            item.path,
            restored.kind === 'cloning'
              ? {
                  kind: 'interrupted' as const,
                  description:
                    'The app closed while this repository was cloning.',
                }
              : restored,
          ]
        })
      )
      this.paused =
        snapshot.paused ||
        Array.from(this.statuses.values()).some(
          status => status.kind === 'pending' || status.kind === 'interrupted'
        )
      this.pauseRequested = this.paused
      this.emit()
      await this.persist()
    } catch (error) {
      log.error('Unable to restore the clone queue journal', error)
    }
  }

  /** The current batch state, or null when no batch has been started. */
  public getState(): IBatchCloneState | null {
    if (this.items.length === 0) {
      return null
    }

    return {
      items: this.items,
      statuses: new Map(this.statuses),
      mode: this.mode,
      source: this.source,
      isRunning: this.running,
      isPaused: this.paused,
      overallProgress: computeBatchCloneProgress(this.items, this.statuses),
      isDone: !this.running && isBatchCloneDone(this.items, this.statuses),
    }
  }

  /** True while this store owns an unfinished queue. */
  public get isBusy(): boolean {
    const state = this.getState()
    return state !== null && !state.isDone
  }

  /** True while replacing the queue would hide unfinished or failed work. */
  public get requiresAttention(): boolean {
    return (
      batchCloneNeedsAttention(this.getState()) ||
      this.completionNotificationPending
    )
  }

  /** Whether this terminal generation still needs one summary notification. */
  public get completionNotificationPending(): boolean {
    const state = this.getState()
    return (
      state !== null &&
      state.isDone &&
      this.notifiedGeneration !== this.generation
    )
  }

  private emit() {
    this.emitUpdate(this.getState())
  }

  private setStatus(
    path: string,
    status: IBatchCloneItemStatus,
    journal = true
  ) {
    this.statuses.set(path, status)
    this.emit()
    if (journal) {
      this.schedulePersist()
    }
  }

  /** Begin cloning the supplied items. Any completed batch state is replaced. */
  public async startBatch(
    items: ReadonlyArray<IBatchCloneItem>,
    mode: BatchCloneMode,
    source: BatchCloneSource = 'manual'
  ): Promise<void> {
    assertSafeBatchCloneItems(items)
    if (items.length === 0) {
      throw new Error('A clone queue must contain at least one repository.')
    }
    if (
      (mode !== BatchCloneMode.Parallel &&
        mode !== BatchCloneMode.Sequential) ||
      (source !== 'manual' && source !== 'auto')
    ) {
      throw new Error('Clone queue mode or source is invalid.')
    }
    if (this.requiresAttention) {
      throw new Error(
        'A clone queue is already active or needs review. Resume, dismiss, or finish it before starting another batch.'
      )
    }

    this.items = items
    this.mode = mode
    this.source = source
    this.statuses = new Map(items.map(item => [item.path, { kind: 'pending' }]))
    this.cancelRequested = false
    this.pauseRequested = false
    this.paused = false
    this.generation = 1
    this.notifiedGeneration = 0
    this.emit()
    await this.prepareAndRun(items)
  }

  /** Re-run every failed item whose destination is now safe. */
  public async retryFailed(): Promise<void> {
    if (this.running) {
      return
    }
    const failed = this.items.filter(
      item => this.statuses.get(item.path)?.kind === 'failed'
    )
    if (failed.length === 0) {
      return
    }

    this.cancelRequested = false
    this.pauseRequested = false
    this.paused = false
    this.generation += 1
    await this.prepareAndRun(failed)
  }

  /**
   * Pause queue-level scheduling. Active Git processes finish; pending items do
   * not start until resume is requested.
   */
  public requestPause(): void {
    if (!this.isBusy || this.paused) {
      return
    }
    this.pauseRequested = true
    this.paused = true
    this.emit()
    this.schedulePersist()
  }

  /** Resume pending/interrupted work after safely inspecting each destination. */
  public async resume(): Promise<void> {
    if (this.running) {
      return
    }

    this.cancelRequested = false
    this.pauseRequested = false
    this.paused = false
    const candidates = this.items.filter(item => {
      const kind = this.statuses.get(item.path)?.kind
      return kind === 'pending' || kind === 'interrupted' || kind === 'review'
    })
    if (candidates.length === 0) {
      return
    }
    this.generation += 1
    await this.prepareAndRun(candidates)
  }

  /**
   * Request cancellation. Items that haven't started are marked skipped;
   * already in-flight clones finish because Git has no clean abort here.
   */
  public requestCancel(): void {
    this.cancelRequested = true
    this.pauseRequested = false
    this.paused = false
    for (const item of this.items) {
      const kind = this.statuses.get(item.path)?.kind
      if (kind === 'pending' || kind === 'interrupted' || kind === 'review') {
        this.statuses.set(item.path, { kind: 'skipped' })
      }
    }
    this.emit()
    this.schedulePersist()
  }

  /** Clear completed state. An active/recoverable queue is never discarded. */
  public dismiss(): void {
    if (this.isBusy) {
      return
    }
    this.items = []
    this.statuses = new Map<string, IBatchCloneItemStatus>()
    this.running = false
    this.paused = false
    this.pauseRequested = false
    this.cancelRequested = false
    this.generation = 0
    this.notifiedGeneration = 0
    this.emit()
    this.scheduleClear()
  }

  public async flush(): Promise<void> {
    await this.writeChain.catch(() => undefined)
  }

  /** Persist that completed paths were added to the local repository list. */
  public async markFinalized(paths: ReadonlyArray<string>): Promise<void> {
    let changed = false
    for (const path of paths) {
      const status = this.statuses.get(path)
      if (status?.kind === 'done' && status.finalized !== true) {
        this.statuses.set(path, { ...status, finalized: true })
        changed = true
      }
    }
    if (changed) {
      this.emit()
      await this.persist()
    }
  }

  /** Durably suppress duplicate completion summaries for this run generation. */
  public async markCompletionNotified(): Promise<void> {
    if (!this.completionNotificationPending) {
      return
    }
    this.notifiedGeneration = this.generation
    this.emit()
    await this.persist()
  }

  private async prepareItemsForRun(
    items: ReadonlyArray<IBatchCloneItem>
  ): Promise<ReadonlyArray<IBatchCloneItem>> {
    const runnable: IBatchCloneItem[] = []
    for (const item of items) {
      let inspection: CloneDestinationInspection
      try {
        inspection = await this.inspectDestination(item)
      } catch (error) {
        if (
          this.cancelRequested ||
          this.statuses.get(item.path)?.kind === 'skipped'
        ) {
          this.statuses.set(item.path, { kind: 'skipped' })
          continue
        }
        const normalizedError =
          error instanceof Error ? error : new Error(String(error))
        log.error(
          `Unable to inspect clone destination ${item.path}`,
          normalizedError
        )
        this.statuses.set(item.path, {
          kind: 'review',
          error: new Error(
            'The destination could not be inspected safely. Review it manually; Desktop Material will not delete it.'
          ),
        })
        continue
      }
      // Cancellation can arrive while an asynchronous filesystem/Git probe is
      // in flight. Never let that stale result resurrect a skipped item.
      if (
        this.cancelRequested ||
        this.statuses.get(item.path)?.kind === 'skipped'
      ) {
        this.statuses.set(item.path, { kind: 'skipped' })
        continue
      }
      if (inspection === 'empty') {
        this.statuses.set(item.path, { kind: 'pending' })
        runnable.push(item)
      } else if (inspection === 'matching-repository') {
        this.statuses.set(item.path, {
          kind: 'done',
          progress: 1,
          description: 'Recovered an existing clone with the matching origin.',
          ...(item.accountKey !== undefined
            ? { accountKey: item.accountKey }
            : {}),
        })
      } else {
        this.statuses.set(item.path, {
          kind: 'review',
          error: new Error(
            'The destination is incomplete, contains data, or has a different Git origin. Review or move it; Desktop Material will not delete it.'
          ),
        })
      }
    }
    this.emit()
    await this.persist()
    return runnable
  }

  /**
   * Own the inspection + scheduling phase as part of the running operation.
   * This closes the window where two rapid Resume/Retry calls could both see
   * running=false and launch the same destination twice.
   */
  private async prepareAndRun(
    items: ReadonlyArray<IBatchCloneItem>
  ): Promise<void> {
    this.running = true
    this.emit()
    await this.persist()

    try {
      const runnable = await this.prepareItemsForRun(items)
      await this.run(runnable)
    } catch (error) {
      this.running = false
      this.emit()
      await this.persist()
      throw error
    }
  }

  private async run(items: ReadonlyArray<IBatchCloneItem>): Promise<void> {
    if (items.length === 0) {
      this.running = false
      this.paused = false
      this.emit()
      await this.persist()
      return
    }

    this.running = true
    this.emit()
    await this.persist()

    const limit = pLimit(
      this.mode === BatchCloneMode.Parallel ? BatchCloneParallelLimit : 1
    )
    await Promise.all(items.map(item => limit(() => this.cloneItem(item))))

    this.running = false
    if (isBatchCloneDone(this.items, this.statuses)) {
      this.paused = false
      this.pauseRequested = false
    }
    this.emit()
    await this.persist()
  }

  private async cloneItem(item: IBatchCloneItem): Promise<void> {
    if (this.cancelRequested) {
      this.setStatus(item.path, { kind: 'skipped' })
      return
    }
    if (this.pauseRequested) {
      return
    }

    // Items can wait behind other clones for minutes. Reinspect immediately
    // before invoking Git so a newly-created file, junction, symlink, or clone
    // is handled safely instead of relying on the earlier queue-wide probe.
    let inspection: CloneDestinationInspection
    try {
      inspection = await this.inspectDestination(item)
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error))
      log.error(
        `Unable to reinspect clone destination ${item.path}`,
        normalizedError
      )
      this.setStatus(item.path, {
        kind: 'review',
        error: new Error(
          'The destination could not be inspected safely. Review it manually; Desktop Material will not delete it.'
        ),
      })
      return
    }

    if (this.cancelRequested) {
      this.setStatus(item.path, { kind: 'skipped' })
      return
    }
    if (this.pauseRequested) {
      return
    }
    if (inspection === 'matching-repository') {
      this.setStatus(item.path, {
        kind: 'done',
        progress: 1,
        description: 'Recovered an existing clone with the matching origin.',
        ...(item.accountKey !== undefined
          ? { accountKey: item.accountKey }
          : {}),
      })
      return
    }
    if (inspection === 'review') {
      this.setStatus(item.path, {
        kind: 'review',
        error: new Error(
          'The destination is incomplete, contains data, or has a different Git origin. Review or move it; Desktop Material will not delete it.'
        ),
      })
      return
    }

    this.setStatus(item.path, { kind: 'cloning', progress: 0 }, false)
    await this.persist()

    let successfulAccountKey: string | null = null
    let success = false
    try {
      success = await this.cloningRepositoriesStore.clone(
        item.url,
        item.path,
        {
          defaultBranch: item.defaultBranch,
          accountKey: item.accountKey,
        },
        {
          onError: error => {
            this.setStatus(item.path, { kind: 'failed', error })
          },
          onProgress: progress => {
            if (this.statuses.get(item.path)?.kind === 'cloning') {
              // Progress is intentionally memory-only; lifecycle transitions
              // are journaled without turning every Git progress tick into I/O.
              this.setStatus(
                item.path,
                {
                  kind: 'cloning',
                  progress: progress.value,
                  description: progress.description,
                },
                false
              )
            }
          },
          onSuccess: accountKey => {
            successfulAccountKey = accountKey
          },
        }
      )
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error))
      log.error(`Unexpected clone failure for ${item.url}`, normalizedError)
      this.setStatus(item.path, { kind: 'failed', error: normalizedError })
    }

    if (success) {
      this.setStatus(item.path, {
        kind: 'done',
        progress: 1,
        ...(successfulAccountKey !== null
          ? { accountKey: successfulAccountKey }
          : {}),
      })
    } else if (this.statuses.get(item.path)?.kind !== 'failed') {
      this.setStatus(item.path, { kind: 'failed' })
    }
  }

  private snapshot(): IBatchCloneJournalSnapshot {
    return {
      version: BatchCloneJournalVersion,
      updatedAt: new Date().toISOString(),
      items: this.items,
      statuses: Array.from(this.statuses.entries()),
      mode: this.mode,
      source: this.source,
      paused: this.paused,
      generation: this.generation,
      notifiedGeneration: this.notifiedGeneration,
    }
  }

  private schedulePersist(): void {
    void this.persist()
  }

  private persist(): Promise<void> {
    if (!this.initialized || this.journal === null || this.items.length === 0) {
      return Promise.resolve()
    }
    const snapshot = this.snapshot()
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => this.journal?.save(snapshot))
      .then(() => {
        this.journalFailureReported = false
      })
      .catch(error => this.reportJournalFailure('persist', error))
    return this.writeChain
  }

  private scheduleClear(): void {
    if (!this.initialized || this.journal === null) {
      return
    }
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => this.journal?.clear())
      .then(() => {
        this.journalFailureReported = false
      })
      .catch(error => this.reportJournalFailure('clear', error))
  }

  private reportJournalFailure(operation: string, error: unknown): void {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error))
    log.error(`Unable to ${operation} clone queue journal`, normalizedError)
    if (!this.journalFailureReported) {
      this.journalFailureReported = true
      this.emitError(
        new Error(
          'Clone recovery state could not be saved. Cloning can continue, but crash recovery may be unavailable until storage access is restored.'
        )
      )
    }
  }
}
