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
  CurrentBatchCloneJournalVersion,
  FileBatchCloneJournal,
  IBatchCloneJournal,
  IBatchCloneJournalSnapshot,
  inspectCloneDestination,
} from './batch-clone-journal'
import {
  IBatchCloneStagingManager,
  createBatchCloneRecoveryId,
} from './batch-clone-staging'

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
  private maintenanceChain: Promise<void> = Promise.resolve()
  private recoveryUnavailable = false
  private journalVersion:
    | typeof BatchCloneJournalVersion
    | typeof CurrentBatchCloneJournalVersion = BatchCloneJournalVersion
  private stagingTargets = new Map<string, string>()
  private activeCloneControllers = new Map<string, AbortController>()
  private operationCompletion: Promise<void> | null = null
  private itemResolutionChains = new Map<string, Promise<void>>()
  private dismissal: Promise<boolean> | null = null
  private dismissing = false

  public constructor(
    private readonly cloningRepositoriesStore: CloningRepositoriesStore,
    journal?: IBatchCloneJournal,
    private readonly inspectDestination = inspectCloneDestination,
    private readonly stagingManager: IBatchCloneStagingManager | null = null
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
      this.journalVersion = snapshot.version
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
      const normalizedSnapshot = await this.persist()
      if (this.stagingManager !== null) {
        // The loaded snapshot itself is durable proof for terminal items even
        // when normalizing an interrupted status cannot be written back.
        const cleanupSnapshot = normalizedSnapshot ?? snapshot
        await this.cleanupCompletedStaging(cleanupSnapshot)
        await this.cleanupSkippedStaging(cleanupSnapshot)
      }
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
      recoveryUnavailable: this.recoveryUnavailable,
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

    this.journalVersion =
      this.stagingManager === null
        ? BatchCloneJournalVersion
        : CurrentBatchCloneJournalVersion
    this.items =
      this.stagingManager === null
        ? items.map(({ recoveryId: _recoveryId, ...item }) => item)
        : items.map(item => ({
            ...item,
            recoveryId: createBatchCloneRecoveryId(),
          }))
    assertSafeBatchCloneItems(this.items)
    this.mode = mode
    this.source = source
    this.statuses = new Map(
      this.items.map(item => [item.path, { kind: 'pending' }])
    )
    this.stagingTargets.clear()
    this.cancelRequested = false
    this.pauseRequested = false
    this.paused = false
    this.generation = 1
    this.notifiedGeneration = 0
    this.emit()
    await this.prepareAndRun(this.items)
  }

  /** Re-run every failed item whose destination is now safe. */
  public async retryFailed(): Promise<void> {
    if (this.running || this.dismissing) {
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

  /** Abort active Git work and retain it as a strictly restartable queue. */
  public async requestPause(): Promise<void> {
    if (!this.isBusy || this.paused) {
      return
    }
    this.pauseRequested = true
    this.paused = true
    const operation = this.operationCompletion
    for (const controller of this.activeCloneControllers.values()) {
      controller.abort()
    }
    this.emit()
    if (operation !== null) {
      await operation
    } else {
      await this.persist()
    }
  }

  /** Resume pending/interrupted work after safely inspecting each destination. */
  public async resume(): Promise<void> {
    if (this.running || this.dismissing) {
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
   * Resolve a single unfinished item by skipping it, so the rest of the batch
   * can complete without reviewing every occupied destination. The destination
   * is never touched; only app-owned staging for the skipped item is discarded.
   */
  public async skipItem(path: string): Promise<void> {
    if (this.running || this.dismissing) {
      return
    }
    await this.resolveItem(path, async () => {
      const kind = this.statuses.get(path)?.kind
      if (
        kind !== 'review' &&
        kind !== 'failed' &&
        kind !== 'interrupted' &&
        kind !== 'pending'
      ) {
        return
      }
      this.setStatus(path, { kind: 'skipped' }, false)
      const durableSnapshot = await this.persist()
      if (
        durableSnapshot !== null &&
        this.statuses.get(path)?.kind === 'skipped'
      ) {
        await this.cleanupSkippedStaging(durableSnapshot, new Set([path]))
      }
    })
  }

  /**
   * Adopt the folder already at a review item's destination when it is a Git
   * repository whose origin matches this queue item. The existing data is never
   * modified: a matching repository is registered as done, and anything else is
   * left in review with a clearer explanation.
   */
  public async adoptExistingItem(path: string): Promise<void> {
    if (this.running || this.dismissing) {
      return
    }
    await this.resolveItem(path, async () => {
      const item = this.items.find(candidate => candidate.path === path)
      if (item === undefined || this.statuses.get(path)?.kind !== 'review') {
        return
      }

      let inspection: CloneDestinationInspection
      try {
        inspection = await this.inspectDestination(item)
      } catch (error) {
        if (this.statuses.get(path)?.kind !== 'review') {
          return
        }
        const normalizedError =
          error instanceof Error ? error : new Error(String(error))
        log.error(
          `Unable to inspect existing clone folder ${item.path}`,
          normalizedError
        )
        this.setStatus(path, {
          kind: 'review',
          error: new Error(
            'The existing folder could not be inspected safely. Review it manually; Desktop Material will not delete it.'
          ),
        })
        await this.persist()
        return
      }

      // Skip, cancel, or another resolution may have won while the filesystem
      // inspection was in flight. Never publish that stale result.
      if (this.statuses.get(path)?.kind !== 'review') {
        return
      }
      if (inspection !== 'matching-repository') {
        this.setStatus(path, {
          kind: 'review',
          error: new Error(
            inspection === 'empty'
              ? 'The folder is now empty, so there is nothing to adopt. Use Recheck destinations to clone it again.'
              : 'The existing folder is not a matching clone of this repository and was left unchanged. Skip it or move it aside and recheck.'
          ),
        })
        await this.persist()
        return
      }

      this.setStatus(
        path,
        {
          kind: 'done',
          progress: 1,
          description: 'Adopted the existing clone with the matching origin.',
          ...(item.accountKey !== undefined
            ? { accountKey: item.accountKey }
            : {}),
        },
        false
      )
      const durableSnapshot = await this.persist()
      if (
        durableSnapshot !== null &&
        item.recoveryId !== undefined &&
        this.stagingManager !== null &&
        this.statuses.get(path)?.kind === 'done'
      ) {
        // A durable `done` snapshot authorizes cleanup. cleanupPromoted also
        // recognizes a verified matching destination with an unpromoted owned
        // root, so a crash or transient failure can retry this exact adoption.
        await this.cleanupCompletedStaging(durableSnapshot, new Set([path]))
      }
    })
  }

  /** Abort active Git work and durably discard verified cancelled staging. */
  public requestCancel(): Promise<void> {
    const cancellation = this.cancelAndWait()
    this.maintenanceChain = this.maintenanceChain
      .catch(() => undefined)
      .then(() => cancellation)
    return cancellation
  }

  private async cancelAndWait(): Promise<void> {
    this.cancelRequested = true
    this.pauseRequested = false
    this.paused = false
    for (const item of this.items) {
      const kind = this.statuses.get(item.path)?.kind
      if (kind === 'pending' || kind === 'interrupted' || kind === 'review') {
        this.statuses.set(item.path, { kind: 'skipped' })
      }
    }
    const operation = this.operationCompletion
    for (const controller of this.activeCloneControllers.values()) {
      controller.abort()
    }
    this.emit()
    if (operation !== null) {
      await operation
    } else {
      await this.waitForItemResolutions()
      const durableSnapshot = await this.persist()
      if (durableSnapshot !== null) {
        await this.cleanupSkippedStaging(durableSnapshot)
      }
    }
  }

  /**
   * Clear terminal state only after every app-owned staging root is gone and
   * the journal clear itself succeeds. Ambiguous roots retain their recovery
   * identity and remain visible for review.
   */
  public dismiss(): Promise<boolean> {
    if (this.dismissal !== null) {
      return this.dismissal
    }
    const operation = this.dismissUnlocked()
    this.dismissal = operation
    void operation.then(
      () => {
        if (this.dismissal === operation) {
          this.dismissal = null
        }
      },
      () => {
        if (this.dismissal === operation) {
          this.dismissal = null
        }
      }
    )
    return operation
  }

  private async dismissUnlocked(): Promise<boolean> {
    if (this.isBusy) {
      return false
    }
    if (this.items.length === 0) {
      return true
    }
    this.dismissing = true
    try {
      await this.maintenanceChain.catch(() => undefined)
      await this.waitForItemResolutions()
      if (this.isBusy) {
        return false
      }
      if (this.items.length === 0) {
        return true
      }

      if (this.journalVersion === CurrentBatchCloneJournalVersion) {
        const durableSnapshot = await this.persist()
        if (durableSnapshot === null || this.stagingManager === null) {
          return false
        }

        const durableStatuses = new Map(durableSnapshot.statuses)
        let cleanupSucceeded = true
        for (const item of durableSnapshot.items) {
          const status = durableStatuses.get(item.path)
          const cleaned =
            status?.kind === 'done'
              ? await this.stagingManager.cleanupPromoted(item)
              : await this.stagingManager.discard(item)
          if (!cleaned) {
            cleanupSucceeded = false
            if (status?.kind !== 'done') {
              this.statuses.set(item.path, {
                kind: 'review',
                error: new Error(
                  'The staged clone ownership marker changed or could not be removed. The queue was retained for review.'
                ),
              })
            }
          }
        }
        if (!cleanupSucceeded) {
          this.emit()
          await this.persist()
          this.emitError(
            new Error(
              'Some staged clone data could not be verified for removal. The clone queue was retained.'
            )
          )
          return false
        }
      }

      if (!(await this.clearJournal())) {
        return false
      }
      this.resetState()
      return true
    } finally {
      this.dismissing = false
    }
  }

  private resetState(): void {
    this.items = []
    this.statuses = new Map<string, IBatchCloneItemStatus>()
    this.running = false
    this.paused = false
    this.pauseRequested = false
    this.cancelRequested = false
    this.generation = 0
    this.notifiedGeneration = 0
    this.stagingTargets.clear()
    this.activeCloneControllers.clear()
    this.itemResolutionChains.clear()
    this.emit()
  }

  public async flush(): Promise<void> {
    await this.maintenanceChain.catch(() => undefined)
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
      const shouldRun = await this.resolveItem(item.path, async () => {
        const initialKind = this.statuses.get(item.path)?.kind
        if (
          initialKind !== 'pending' &&
          initialKind !== 'interrupted' &&
          initialKind !== 'review' &&
          initialKind !== 'failed'
        ) {
          return false
        }

        if (item.recoveryId !== undefined) {
          if (this.stagingManager === null) {
            this.statuses.set(item.path, {
              kind: 'review',
              error: new Error(
                'This staged clone queue cannot be recovered in the current app session.'
              ),
            })
            return false
          }
          const prepared = await this.stagingManager.prepare(item)
          if (
            this.cancelRequested ||
            this.statuses.get(item.path)?.kind === 'skipped'
          ) {
            this.statuses.set(item.path, { kind: 'skipped' })
            return false
          }
          // Another explicit resolution cannot mutate this item while its
          // per-path chain is held. Still revalidate cancellation and the
          // original unresolved state after every filesystem await.
          const currentKind = this.statuses.get(item.path)?.kind
          if (currentKind !== initialKind) {
            return false
          }
          if (prepared.kind === 'clone') {
            this.stagingTargets.set(item.path, prepared.clonePath)
            this.statuses.set(item.path, { kind: 'pending' })
            return true
          }
          if (prepared.kind === 'done') {
            this.statuses.set(item.path, {
              kind: 'done',
              progress: 1,
              description: 'Recovered and promoted a verified staged clone.',
              ...(prepared.accountKey !== null
                ? { accountKey: prepared.accountKey }
                : {}),
            })
          } else {
            this.statuses.set(item.path, {
              kind: 'review',
              error: prepared.error,
            })
          }
          return false
        }

        let inspection: CloneDestinationInspection
        try {
          inspection = await this.inspectDestination(item)
        } catch (error) {
          if (
            this.cancelRequested ||
            this.statuses.get(item.path)?.kind === 'skipped'
          ) {
            this.statuses.set(item.path, { kind: 'skipped' })
            return false
          }
          const currentKind = this.statuses.get(item.path)?.kind
          if (currentKind !== initialKind) {
            return false
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
          return false
        }
        // Cancellation can arrive while an asynchronous filesystem/Git probe
        // is in flight. Never let that stale result resurrect a skipped item.
        if (
          this.cancelRequested ||
          this.statuses.get(item.path)?.kind === 'skipped'
        ) {
          this.statuses.set(item.path, { kind: 'skipped' })
          return false
        }
        if (this.statuses.get(item.path)?.kind !== initialKind) {
          return false
        }
        if (inspection === 'empty') {
          this.statuses.set(item.path, { kind: 'pending' })
          return true
        }
        if (inspection === 'matching-repository') {
          this.statuses.set(item.path, {
            kind: 'done',
            progress: 1,
            description:
              'Recovered an existing clone with the matching origin.',
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
        return false
      })
      if (shouldRun) {
        runnable.push(item)
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
    let finishOperation: () => void = () => {}
    const operation = new Promise<void>(resolve => {
      finishOperation = resolve
    })
    this.operationCompletion = operation

    try {
      this.running = true
      this.emit()
      const durable = await this.persist()
      if (this.journalVersion === CurrentBatchCloneJournalVersion && !durable) {
        this.running = false
        this.paused = false
        for (const item of items) {
          const kind = this.statuses.get(item.path)?.kind
          if (
            kind === 'pending' ||
            kind === 'interrupted' ||
            kind === 'failed' ||
            kind === 'review'
          ) {
            this.statuses.set(item.path, {
              kind: 'review',
              error: new Error(
                'Clone recovery state could not be saved, so no staging directory or Git process was started.'
              ),
            })
          }
        }
        this.emit()
        return
      }

      try {
        const runnable = await this.prepareItemsForRun(items)
        await this.run(runnable)
      } catch (error) {
        this.running = false
        this.emit()
        await this.persist()
        throw error
      }
    } finally {
      if (this.operationCompletion === operation) {
        this.operationCompletion = null
      }
      finishOperation()
    }
  }

  private async run(items: ReadonlyArray<IBatchCloneItem>): Promise<void> {
    if (items.length === 0) {
      this.running = false
      this.paused = false
      this.emit()
      const durableSnapshot = await this.persist()
      if (durableSnapshot !== null) {
        await this.cleanupCompletedStaging(durableSnapshot)
        await this.cleanupSkippedStaging(durableSnapshot)
      }
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
    const durableSnapshot = await this.persist()
    if (durableSnapshot !== null) {
      await this.cleanupCompletedStaging(durableSnapshot)
      await this.cleanupSkippedStaging(durableSnapshot)
    }
  }

  private async cloneItem(item: IBatchCloneItem): Promise<void> {
    if (this.cancelRequested) {
      this.setStatus(item.path, { kind: 'skipped' })
      return
    }
    if (this.pauseRequested) {
      return
    }

    let clonePath = item.path
    if (item.recoveryId !== undefined) {
      const stagedPath = this.stagingTargets.get(item.path)
      if (
        this.stagingManager === null ||
        stagedPath === undefined ||
        !(await this.stagingManager.reinspect(item, stagedPath))
      ) {
        this.setStatus(item.path, {
          kind: 'review',
          error: new Error(
            'The staged clone or final destination changed before Git started and was left unchanged.'
          ),
        })
        return
      }
      clonePath = stagedPath
    } else {
      // Legacy v1 queues cloned directly into the final path. Keep their
      // conservative inspection path without ever deleting old partial data.
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
    }

    if (this.cancelRequested) {
      this.setStatus(item.path, { kind: 'skipped' })
      return
    }
    if (this.pauseRequested) {
      return
    }
    const controller = new AbortController()
    this.activeCloneControllers.set(item.path, controller)
    if (this.cancelRequested || this.pauseRequested) {
      controller.abort()
    }
    this.setStatus(item.path, { kind: 'cloning', progress: 0 }, false)
    await this.persist()

    let aborted = controller.signal.aborted
    let successfulAccountKey: string | null = null
    let success = false
    try {
      if (!aborted) {
        success = await this.cloningRepositoriesStore.clone(
          item.url,
          clonePath,
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
                // Progress (including the stage/speed/ETA the cloning store
                // derives) is intentionally memory-only; lifecycle transitions
                // are journaled without turning every Git progress tick into I/O.
                this.setStatus(
                  item.path,
                  {
                    kind: 'cloning',
                    progress: progress.value,
                    description: progress.description,
                    ...(progress.stage !== undefined
                      ? { stage: progress.stage }
                      : {}),
                    ...(progress.speedBytesPerSecond !== undefined
                      ? { speedBytesPerSecond: progress.speedBytesPerSecond }
                      : {}),
                    ...(progress.etaSeconds !== undefined
                      ? { etaSeconds: progress.etaSeconds }
                      : {}),
                  },
                  false
                )
              }
            },
            onSuccess: accountKey => {
              successfulAccountKey = accountKey
            },
            onAbort: () => {
              aborted = true
            },
            displayPath: item.path,
            signal: controller.signal,
          }
        )
      }
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        aborted = true
      } else {
        const normalizedError =
          error instanceof Error ? error : new Error(String(error))
        log.error(`Unexpected clone failure for ${item.url}`, normalizedError)
        this.setStatus(item.path, { kind: 'failed', error: normalizedError })
      }
    } finally {
      aborted = aborted || controller.signal.aborted
      this.activeCloneControllers.delete(item.path)
    }

    if (aborted) {
      await this.handleAbortedClone(item)
      return
    }

    if (success) {
      if (item.recoveryId !== undefined) {
        if (this.stagingManager === null) {
          this.setStatus(item.path, {
            kind: 'review',
            error: new Error('The staged clone manager is unavailable.'),
          })
          return
        }
        const promoted = await this.stagingManager.completeAndPromote(
          item,
          clonePath,
          successfulAccountKey
        )
        if (promoted.kind === 'review') {
          this.setStatus(item.path, {
            kind: 'review',
            error: promoted.error,
          })
          return
        }
        successfulAccountKey = promoted.accountKey
      }
      this.setStatus(
        item.path,
        {
          kind: 'done',
          progress: 1,
          ...(successfulAccountKey !== null
            ? { accountKey: successfulAccountKey }
            : {}),
        },
        false
      )
      const durableSnapshot = await this.persist()
      if (
        durableSnapshot !== null &&
        item.recoveryId !== undefined &&
        this.stagingManager !== null
      ) {
        await this.cleanupCompletedStaging(
          durableSnapshot,
          new Set([item.path])
        )
      }
    } else if (this.statuses.get(item.path)?.kind !== 'failed') {
      this.setStatus(item.path, { kind: 'failed' })
    }
  }

  private async handleAbortedClone(item: IBatchCloneItem): Promise<void> {
    if (item.recoveryId === undefined || this.stagingManager === null) {
      this.setStatus(
        item.path,
        {
          kind: 'review',
          error: new Error(
            'The legacy direct clone was interrupted and its destination was left unchanged for review.'
          ),
        },
        false
      )
      await this.persist()
      return
    }

    let kind: 'skipped' | 'interrupted' = this.cancelRequested
      ? 'skipped'
      : 'interrupted'
    this.setStatus(
      item.path,
      {
        kind,
        description:
          kind === 'skipped'
            ? 'The active clone was cancelled.'
            : 'The active clone was paused and can be restarted safely.',
      },
      false
    )

    // The terminal/interrupted transition must be durable before the marker
    // authorizes deleting the partial checkout.
    if (!(await this.persist())) {
      this.setStatus(
        item.path,
        {
          kind: 'review',
          error: new Error(
            'The interrupted clone state could not be saved. Its staged data was retained for recovery.'
          ),
        },
        false
      )
      return
    }

    // Cancellation can supersede a pause while the interrupted snapshot is
    // being written. Persist the stronger terminal state before deletion.
    if (kind === 'interrupted' && this.cancelRequested) {
      kind = 'skipped'
      this.setStatus(
        item.path,
        {
          kind,
          description: 'The active clone was cancelled.',
        },
        false
      )
      if (!(await this.persist())) {
        this.setStatus(
          item.path,
          {
            kind: 'review',
            error: new Error(
              'The cancelled clone state could not be saved. Its staged data was retained for recovery.'
            ),
          },
          false
        )
        return
      }
    }

    let discarded = false
    try {
      discarded = await this.stagingManager.discard(item)
    } catch (error) {
      log.error('Unable to discard an interrupted staged clone', error)
    }
    if (discarded) {
      this.stagingTargets.delete(item.path)
      return
    }

    this.setStatus(
      item.path,
      {
        kind: 'review',
        error: new Error(
          'The interrupted staged clone could not be verified for removal and was retained for review.'
        ),
      },
      false
    )
    await this.persist()
  }

  private snapshot(): IBatchCloneJournalSnapshot {
    return {
      version: this.journalVersion,
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

  /** Return the exact snapshot which was durably saved, or null on failure. */
  private persist(): Promise<IBatchCloneJournalSnapshot | null> {
    if (!this.initialized || this.journal === null || this.items.length === 0) {
      return Promise.resolve(null)
    }
    const snapshot = this.snapshot()
    const journal = this.journal
    const operation = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        try {
          await journal.save(snapshot)
          this.markRecoveryAvailable()
          return snapshot
        } catch (error) {
          this.reportJournalFailure('persist', error)
          return null
        }
      })
    this.writeChain = operation.then(() => undefined)
    return operation
  }

  private clearJournal(): Promise<boolean> {
    if (!this.initialized || this.journal === null) {
      return Promise.resolve(false)
    }
    const journal = this.journal
    const operation = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        try {
          await journal.clear()
          this.markRecoveryAvailable()
          return true
        } catch (error) {
          this.reportJournalFailure('clear', error)
          return false
        }
      })
    this.writeChain = operation.then(() => undefined)
    return operation
  }

  private async cleanupCompletedStaging(
    durableSnapshot: IBatchCloneJournalSnapshot,
    paths?: ReadonlySet<string>
  ): Promise<boolean> {
    if (this.stagingManager === null) {
      return this.journalVersion !== CurrentBatchCloneJournalVersion
    }
    const durableStatuses = new Map(durableSnapshot.statuses)
    let succeeded = true
    for (const item of durableSnapshot.items) {
      if (
        (paths === undefined || paths.has(item.path)) &&
        item.recoveryId !== undefined &&
        durableStatuses.get(item.path)?.kind === 'done' &&
        !(await this.stagingManager.cleanupPromoted(item))
      ) {
        succeeded = false
      }
    }
    return succeeded
  }

  private async cleanupSkippedStaging(
    durableSnapshot: IBatchCloneJournalSnapshot,
    paths?: ReadonlySet<string>
  ): Promise<boolean> {
    if (this.stagingManager === null) {
      return this.journalVersion !== CurrentBatchCloneJournalVersion
    }
    const durableStatuses = new Map(durableSnapshot.statuses)
    let succeeded = true
    let changed = false
    for (const item of durableSnapshot.items) {
      if (
        (paths === undefined || paths.has(item.path)) &&
        item.recoveryId !== undefined &&
        durableStatuses.get(item.path)?.kind === 'skipped' &&
        !(await this.stagingManager.discard(item))
      ) {
        succeeded = false
        if (this.statuses.get(item.path)?.kind === 'skipped') {
          changed = true
          this.statuses.set(item.path, {
            kind: 'review',
            error: new Error(
              'The cancelled staged clone could not be verified for removal and was retained for review.'
            ),
          })
        }
      }
    }
    if (changed) {
      this.emit()
      await this.persist()
    }
    return succeeded
  }

  /** Serialize every explicit resolution for one destination path. */
  private resolveItem<T>(path: string, action: () => Promise<T>): Promise<T> {
    const previous = this.itemResolutionChains.get(path) ?? Promise.resolve()
    const operation = previous.then(action)
    const tail = operation.then(
      () => undefined,
      () => undefined
    )
    this.itemResolutionChains.set(path, tail)
    void tail.then(() => {
      if (this.itemResolutionChains.get(path) === tail) {
        this.itemResolutionChains.delete(path)
      }
    })
    return operation
  }

  /** Wait until every resolution which began before dismissal/cancel settles. */
  private async waitForItemResolutions(): Promise<void> {
    while (this.itemResolutionChains.size > 0) {
      await Promise.all(this.itemResolutionChains.values())
    }
  }

  /**
   * A journal write failed. Crash recovery degrades gracefully: the clone keeps
   * running, the failure is logged once per outage, and the state carries a soft
   * `recoveryUnavailable` flag the progress dialog renders inline. The next state
   * transition re-attempts the write (and the journal itself retries transient
   * file locks), so no modal error interrupts an otherwise-healthy clone.
   */
  private reportJournalFailure(operation: string, error: unknown): void {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error))
    if (!this.recoveryUnavailable) {
      log.error(
        `Unable to ${operation} clone queue journal; crash recovery is temporarily unavailable but cloning continues`,
        normalizedError
      )
      this.recoveryUnavailable = true
      this.emit()
    }
  }

  /** Clear the soft recovery-unavailable notice once a write succeeds again. */
  private markRecoveryAvailable(): void {
    if (this.recoveryUnavailable) {
      log.info('Clone queue crash recovery resumed after a transient failure')
      this.recoveryUnavailable = false
      this.emit()
    }
  }
}
