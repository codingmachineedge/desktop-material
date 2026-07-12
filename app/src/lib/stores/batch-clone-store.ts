import pLimit from 'p-limit'
import { TypedBaseStore } from './base-store'
import { CloningRepositoriesStore } from './cloning-repositories-store'
import {
  BatchCloneMode,
  BatchCloneParallelLimit,
  IBatchCloneItem,
  IBatchCloneItemStatus,
  IBatchCloneState,
  computeBatchCloneProgress,
  isBatchCloneDone,
} from '../../models/batch-clone'

/**
 * Coordinates cloning many repositories at once. Composes
 * {@link CloningRepositoriesStore} for the actual git work (so each clone still
 * appears in the sidebar) while tracking per-item and overall progress and
 * bounding concurrency with `p-limit`.
 */
export class BatchCloneStore extends TypedBaseStore<IBatchCloneState | null> {
  private items: ReadonlyArray<IBatchCloneItem> = []
  private statuses = new Map<string, IBatchCloneItemStatus>()
  private mode: BatchCloneMode = BatchCloneMode.Parallel
  private running = false
  private cancelRequested = false

  public constructor(
    private readonly cloningRepositoriesStore: CloningRepositoriesStore
  ) {
    super()
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
      overallProgress: computeBatchCloneProgress(this.items, this.statuses),
      isDone: !this.running && isBatchCloneDone(this.items, this.statuses),
    }
  }

  private emit() {
    this.emitUpdate(this.getState())
  }

  private setStatus(path: string, status: IBatchCloneItemStatus) {
    this.statuses.set(path, status)
    this.emit()
  }

  /**
   * Begin cloning the supplied items. Any previous batch state is replaced.
   */
  public async startBatch(
    items: ReadonlyArray<IBatchCloneItem>,
    mode: BatchCloneMode
  ): Promise<void> {
    this.items = items
    this.mode = mode
    const initial: Array<[string, IBatchCloneItemStatus]> = items.map(i => [
      i.path,
      { kind: 'pending' },
    ])
    this.statuses = new Map(initial)
    this.cancelRequested = false
    await this.run(items)
  }

  /** Re-run the clone for every item that previously failed. */
  public async retryFailed(): Promise<void> {
    const failed = this.items.filter(
      item => this.statuses.get(item.path)?.kind === 'failed'
    )

    if (failed.length === 0) {
      return
    }

    this.cancelRequested = false
    for (const item of failed) {
      this.statuses.set(item.path, { kind: 'pending' })
    }
    this.emit()

    await this.run(failed)
  }

  /**
   * Request cancellation. Items that haven't started cloning yet are marked
   * skipped; already in-flight clones are allowed to finish (git has no clean
   * mid-clone abort here).
   */
  public requestCancel(): void {
    this.cancelRequested = true
    for (const item of this.items) {
      if (this.statuses.get(item.path)?.kind === 'pending') {
        this.statuses.set(item.path, { kind: 'skipped' })
      }
    }
    this.emit()
  }

  /** Clear all batch state (called when the progress popup is dismissed). */
  public dismiss(): void {
    this.items = []
    this.statuses = new Map<string, IBatchCloneItemStatus>()
    this.running = false
    this.cancelRequested = false
    this.emit()
  }

  private async run(items: ReadonlyArray<IBatchCloneItem>): Promise<void> {
    this.running = true
    this.emit()

    const limit = pLimit(
      this.mode === BatchCloneMode.Parallel ? BatchCloneParallelLimit : 1
    )

    await Promise.all(items.map(item => limit(() => this.cloneItem(item))))

    this.running = false
    this.emit()
  }

  private async cloneItem(item: IBatchCloneItem): Promise<void> {
    if (this.cancelRequested) {
      this.setStatus(item.path, { kind: 'skipped' })
      return
    }

    this.setStatus(item.path, { kind: 'cloning', progress: 0 })

    const success = await this.cloningRepositoriesStore.clone(
      item.url,
      item.path,
      { defaultBranch: item.defaultBranch },
      {
        onError: error => {
          this.setStatus(item.path, { kind: 'failed', error })
        },
        onProgress: progress => {
          // Preserve a failed status if an error already landed.
          if (this.statuses.get(item.path)?.kind === 'cloning') {
            this.setStatus(item.path, {
              kind: 'cloning',
              progress: progress.value,
              description: progress.description,
            })
          }
        },
      }
    )

    if (success) {
      this.setStatus(item.path, { kind: 'done', progress: 1 })
    } else if (this.statuses.get(item.path)?.kind !== 'failed') {
      // clone returned false without invoking onError — treat as failed.
      this.setStatus(item.path, { kind: 'failed' })
    }
  }
}
