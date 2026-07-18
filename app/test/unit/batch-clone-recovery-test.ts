import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  BatchCloneJournalVersion,
  CurrentBatchCloneJournalVersion,
  FileBatchCloneJournal,
  IBatchCloneJournal,
  IBatchCloneJournalSnapshot,
  MaxBatchCloneJournalBytes,
  MaxBatchCloneJournalStatusTextLength,
  inspectCloneDestination,
  parseBatchCloneJournal,
  serializeBatchCloneJournal,
} from '../../src/lib/stores/batch-clone-journal'
import {
  BatchCloneStore,
  selectRegisteredBatchClonePaths,
} from '../../src/lib/stores/batch-clone-store'
import {
  BatchCloneStagingCompletion,
  BatchCloneStagingPreparation,
  IBatchCloneStagingManager,
} from '../../src/lib/stores/batch-clone-staging'
import { CloningRepositoriesStore } from '../../src/lib/stores/cloning-repositories-store'
import {
  BatchCloneMode,
  IBatchCloneItem,
  MaxBatchCloneItems,
} from '../../src/models/batch-clone'
import { CloneOptions } from '../../src/models/clone-options'
import { git } from '../../src/lib/git/core'

class MemoryJournal implements IBatchCloneJournal {
  public saved: IBatchCloneJournalSnapshot | null
  public saveCount = 0
  public clearCount = 0

  public constructor(snapshot: IBatchCloneJournalSnapshot | null = null) {
    this.saved = snapshot
  }

  public async load() {
    return this.saved
  }

  public async save(snapshot: IBatchCloneJournalSnapshot) {
    this.saved = snapshot
    this.saveCount += 1
  }

  public async clear() {
    this.saved = null
    this.clearCount += 1
  }
}

class FailingJournal extends MemoryJournal {
  private saveAttempts = 0

  public constructor(
    snapshot: IBatchCloneJournalSnapshot | null = null,
    private readonly successfulSaves = 0
  ) {
    super(snapshot)
  }

  public override async save(snapshot: IBatchCloneJournalSnapshot) {
    this.saveAttempts += 1
    if (this.saveAttempts > this.successfulSaves) {
      throw new Error('injected journal failure')
    }
    await super.save(snapshot)
  }
}

class ToggleJournal extends MemoryJournal {
  public failSaves = true

  public override async save(snapshot: IBatchCloneJournalSnapshot) {
    if (this.failSaves) {
      throw new Error('injected journal failure')
    }
    await super.save(snapshot)
  }
}

function stagingManager(
  overrides: Partial<IBatchCloneStagingManager> = {}
): IBatchCloneStagingManager {
  return {
    prepare: async (): Promise<BatchCloneStagingPreparation> => ({
      kind: 'clone',
      clonePath: '/staging/checkout',
    }),
    reinspect: async () => true,
    completeAndPromote: async (): Promise<BatchCloneStagingCompletion> => ({
      kind: 'done',
      accountKey: null,
    }),
    cleanupPromoted: async () => true,
    discard: async () => true,
    ...overrides,
  }
}

const first: IBatchCloneItem = {
  url: 'https://github.com/o/first.git',
  name: 'first',
  path: '/clones/first',
}
const second: IBatchCloneItem = {
  url: 'https://github.com/o/second.git',
  name: 'second',
  path: '/clones/second',
}

describe('batch clone journal and recovery', () => {
  it('finalizes only clone paths which were actually registered', () => {
    assert.deepEqual(
      selectRegisteredBatchClonePaths(
        [first.path, second.path],
        [{ path: first.path }]
      ),
      [first.path]
    )
    assert.deepEqual(selectRegisteredBatchClonePaths([second.path], []), [])
  })

  it('round-trips versioned state and Error messages', () => {
    const snapshot: IBatchCloneJournalSnapshot = {
      version: BatchCloneJournalVersion,
      updatedAt: '2026-07-17T00:00:00.000Z',
      items: [first],
      statuses: [[first.path, { kind: 'failed', error: new Error('boom') }]],
      mode: BatchCloneMode.Sequential,
      source: 'manual',
      paused: false,
    }
    const parsed = parseBatchCloneJournal(serializeBatchCloneJournal(snapshot))
    assert.equal(parsed?.version, 1)
    assert.equal(parsed?.statuses[0][1].error?.message, 'boom')
    assert.equal(parseBatchCloneJournal('{broken'), null)
  })

  it('accepts v2 recovery identities while preserving v1 conservatively', () => {
    const recoveryItem: IBatchCloneItem = {
      ...first,
      recoveryId: 'a'.repeat(48),
    }
    const v2 = {
      version: CurrentBatchCloneJournalVersion,
      updatedAt: '2026-07-17T00:00:00.000Z',
      items: [recoveryItem],
      statuses: [[recoveryItem.path, { kind: 'pending' }]],
      mode: BatchCloneMode.Sequential,
      source: 'manual',
      paused: true,
    }

    assert.equal(parseBatchCloneJournal(JSON.stringify(v2))?.version, 2)
    assert.equal(
      parseBatchCloneJournal(JSON.stringify({ ...v2, items: [first] })),
      null
    )
    assert.equal(
      parseBatchCloneJournal(
        JSON.stringify({
          ...v2,
          version: BatchCloneJournalVersion,
        })
      ),
      null
    )
  })

  it('does not create staging or invoke Git until the v2 queue is durable', async () => {
    let prepareCalls = 0
    let cloneCalls = 0
    const manager = stagingManager({
      prepare: async () => {
        prepareCalls += 1
        return { kind: 'clone', clonePath: '/staging/checkout' }
      },
    })
    const store = new BatchCloneStore(
      {
        clone: async () => {
          cloneCalls += 1
          return true
        },
      } as unknown as CloningRepositoriesStore,
      new FailingJournal(),
      async () => 'empty',
      manager
    )
    await store.initialize()

    await store.startBatch([first], BatchCloneMode.Sequential)

    assert.equal(prepareCalls, 0)
    assert.equal(cloneCalls, 0)
    assert.equal(store.getState()?.items[0].recoveryId?.length, 48)
    assert.equal(store.getState()?.statuses.get(first.path)?.kind, 'review')
  })

  it('retains promotion proof when the done snapshot is not durable', async () => {
    let cleanupCalls = 0
    let completionCalls = 0
    const manager = stagingManager({
      completeAndPromote: async () => {
        completionCalls += 1
        return { kind: 'done', accountKey: 'github.com#fallback' }
      },
      cleanupPromoted: async () => {
        cleanupCalls += 1
        return true
      },
    })
    // The first four snapshots reach the durable `cloning` state. Both the
    // per-item `done` save and the final queue save then fail.
    const journal = new FailingJournal(null, 4)
    const store = new BatchCloneStore(
      {
        clone: async (
          _url: string,
          _path: string,
          _options: CloneOptions,
          callbacks?: { onSuccess?: (accountKey: string | null) => void }
        ) => {
          callbacks?.onSuccess?.('github.com#fallback')
          return true
        },
      } as unknown as CloningRepositoriesStore,
      journal,
      async () => 'empty',
      manager
    )
    await store.initialize()

    await store.startBatch([first], BatchCloneMode.Sequential)

    assert.equal(completionCalls, 1)
    assert.equal(cleanupCalls, 0)
    assert.equal(store.getState()?.statuses.get(first.path)?.kind, 'done')
    assert.equal(journal.saved?.statuses[0][1].kind, 'cloning')
  })

  it('retains ambiguous staged roots on dismiss and clears exact roots first', async () => {
    const recoveryItem: IBatchCloneItem = {
      ...first,
      recoveryId: 'b'.repeat(48),
    }
    const journal = new MemoryJournal({
      version: CurrentBatchCloneJournalVersion,
      updatedAt: '2026-07-17T00:00:00.000Z',
      items: [recoveryItem],
      statuses: [[recoveryItem.path, { kind: 'failed' }]],
      mode: BatchCloneMode.Sequential,
      source: 'manual',
      paused: false,
    })
    let allowDiscard = false
    let discardCalls = 0
    const store = new BatchCloneStore(
      {} as CloningRepositoriesStore,
      journal,
      async () => 'review',
      stagingManager({
        discard: async () => {
          discardCalls += 1
          return allowDiscard
        },
      })
    )
    await store.initialize()

    assert.equal(await store.dismiss(), false)
    assert.equal(discardCalls, 1)
    assert.equal(journal.clearCount, 0)
    assert.equal(store.getState()?.statuses.get(first.path)?.kind, 'review')

    allowDiscard = true
    assert.equal(await store.dismiss(), true)
    assert.equal(discardCalls, 2)
    assert.equal(journal.clearCount, 1)
    assert.equal(store.getState(), null)
  })

  it('durably marks cancellation before discarding skipped staging', async () => {
    const recoveryItem: IBatchCloneItem = {
      ...first,
      recoveryId: 'c'.repeat(48),
    }
    const journal = new MemoryJournal({
      version: CurrentBatchCloneJournalVersion,
      updatedAt: '2026-07-17T00:00:00.000Z',
      items: [recoveryItem],
      statuses: [[recoveryItem.path, { kind: 'pending' }]],
      mode: BatchCloneMode.Sequential,
      source: 'manual',
      paused: true,
    })
    let discardCalls = 0
    const store = new BatchCloneStore(
      {} as CloningRepositoriesStore,
      journal,
      async () => 'empty',
      stagingManager({
        discard: async () => {
          discardCalls += 1
          assert.equal(journal.saved?.statuses[0][1].kind, 'skipped')
          return true
        },
      })
    )
    await store.initialize()

    store.requestCancel()
    await store.flush()

    assert.equal(discardCalls, 1)
    assert.equal(store.getState()?.statuses.get(first.path)?.kind, 'skipped')
    assert.equal(journal.saved?.statuses[0][1].kind, 'skipped')
  })

  it('never writes credentialed URLs to primary, backup, or quarantine files', async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), 'desktop-material-clone-credential-journal-')
    )
    const secret = 'super-secret-journal-token'
    const credentialedItem: IBatchCloneItem = {
      url: `https://x-access-token:${secret}@github.com/o/private.git`,
      name: 'private',
      path: join(temporaryRoot, 'private'),
    }
    const unsafeSnapshot: IBatchCloneJournalSnapshot = {
      version: BatchCloneJournalVersion,
      updatedAt: '2026-07-17T00:00:00.000Z',
      items: [credentialedItem],
      statuses: [[credentialedItem.path, { kind: 'pending' }]],
      mode: BatchCloneMode.Sequential,
      source: 'manual',
      paused: true,
    }
    const raw = `${JSON.stringify(unsafeSnapshot, null, 2)}\n`
    const primaryPath = join(temporaryRoot, 'clone-queue-v1.json')
    const backupPath = `${primaryPath}.backup`
    const legacyQuarantinePath = `${primaryPath}.corrupt-legacy`

    try {
      assert.throws(
        () => serializeBatchCloneJournal(unsafeSnapshot),
        error => error instanceof Error && !error.message.includes(secret)
      )

      await Promise.all([
        writeFile(primaryPath, raw, 'utf8'),
        writeFile(backupPath, raw, 'utf8'),
        writeFile(legacyQuarantinePath, raw, 'utf8'),
      ])

      const journal = new FileBatchCloneJournal(temporaryRoot)
      assert.equal(await journal.load(), null)

      const journalFiles = (await readdir(temporaryRoot)).filter(name =>
        name.startsWith('clone-queue-v1.json')
      )
      assert.ok(journalFiles.length >= 3)
      assert.ok(!journalFiles.includes('clone-queue-v1.json'))
      assert.ok(!journalFiles.includes('clone-queue-v1.json.backup'))
      for (const name of journalFiles) {
        const contents = await readFile(join(temporaryRoot, name), 'utf8')
        assert.ok(!contents.includes(secret), `${name} retained the secret`)
        assert.match(contents, /redacted-corrupt-clone-queue/)
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('rejects oversized, incomplete, duplicate, and multi-parent journals', () => {
    assert.equal(
      parseBatchCloneJournal(' '.repeat(MaxBatchCloneJournalBytes + 1)),
      null
    )

    const valid = {
      version: BatchCloneJournalVersion,
      updatedAt: '2026-07-17T00:00:00.000Z',
      items: [first],
      statuses: [[first.path, { kind: 'pending' }]],
      mode: BatchCloneMode.Sequential,
      source: 'manual',
      paused: false,
    }
    const tooManyItems = Array.from(
      { length: MaxBatchCloneItems + 1 },
      (_, index) => ({
        url: `https://example.test/repo-${index}.git`,
        name: `repo-${index}`,
        path: resolve(`/clones/repo-${index}`),
      })
    )
    assert.equal(
      parseBatchCloneJournal(
        JSON.stringify({
          ...valid,
          items: tooManyItems,
          statuses: tooManyItems.map(item => [item.path, { kind: 'pending' }]),
        })
      ),
      null
    )

    assert.equal(
      parseBatchCloneJournal(
        JSON.stringify({
          ...valid,
          generation: 1,
          notifiedGeneration: 1,
        })
      ),
      null
    )
    assert.equal(
      parseBatchCloneJournal(JSON.stringify({ ...valid, statuses: [] })),
      null
    )

    const duplicate = {
      ...first,
      name: 'FIRST',
      path: resolve('/clones/FIRST'),
    }
    assert.equal(
      parseBatchCloneJournal(
        JSON.stringify({
          ...valid,
          items: [first, duplicate],
          statuses: [
            [first.path, { kind: 'pending' }],
            [duplicate.path, { kind: 'pending' }],
          ],
        })
      ),
      null
    )

    assert.equal(
      parseBatchCloneJournal(
        JSON.stringify({
          ...valid,
          statuses: [[first.path, { kind: 'pending', finalized: true }]],
        })
      ),
      null
    )

    const otherParent = {
      ...second,
      path: resolve('/other-clones/second'),
    }
    assert.equal(
      parseBatchCloneJournal(
        JSON.stringify({
          ...valid,
          items: [first, otherParent],
          statuses: [
            [first.path, { kind: 'pending' }],
            [otherParent.path, { kind: 'pending' }],
          ],
        })
      ),
      null
    )

    assert.equal(
      parseBatchCloneJournal(
        JSON.stringify({
          ...valid,
          statuses: [
            [
              first.path,
              {
                kind: 'failed',
                error: 'x'.repeat(MaxBatchCloneJournalStatusTextLength + 1),
              },
            ],
          ],
        })
      ),
      null
    )
  })

  it('bounds persisted status text and preserves finalization state', () => {
    const parsed = parseBatchCloneJournal(
      serializeBatchCloneJournal({
        version: BatchCloneJournalVersion,
        updatedAt: '2026-07-17T00:00:00.000Z',
        items: [first],
        statuses: [
          [
            first.path,
            {
              kind: 'done',
              finalized: true,
              error: new Error(
                'x'.repeat(MaxBatchCloneJournalStatusTextLength + 100)
              ),
            },
          ],
        ],
        mode: BatchCloneMode.Sequential,
        source: 'manual',
        paused: false,
      })
    )
    assert.equal(
      parsed?.statuses[0][1].error?.message.length,
      MaxBatchCloneJournalStatusTextLength
    )
    assert.equal(parsed?.statuses[0][1].finalized, true)
  })

  it('restores an in-flight clone as paused and interrupted', async () => {
    const journal = new MemoryJournal({
      version: BatchCloneJournalVersion,
      updatedAt: '2026-07-17T00:00:00.000Z',
      items: [first],
      statuses: [[first.path, { kind: 'cloning', progress: 0.4 }]],
      mode: BatchCloneMode.Sequential,
      source: 'manual',
      paused: false,
    })
    const store = new BatchCloneStore(
      {} as CloningRepositoriesStore,
      journal,
      async () => 'empty'
    )

    await store.initialize()
    assert.equal(store.getState()?.isPaused, true)
    assert.equal(store.getState()?.isRunning, false)
    assert.equal(
      store.getState()?.statuses.get(first.path)?.kind,
      'interrupted'
    )
    assert.equal(journal.saved?.statuses[0][1].kind, 'interrupted')
  })

  it('aborts an active clone on pause and relaunches with the same recovery identity', async () => {
    let firstStarted: () => void = () => {}
    const started = new Promise<void>(resolve => {
      firstStarted = resolve
    })
    let markAbortObserved: () => void = () => {}
    const abortObserved = new Promise<void>(resolve => {
      markAbortObserved = resolve
    })
    let releaseProcessClose: () => void = () =>
      assert.fail('the clone process has not started')
    const processClosed = new Promise<void>(resolve => {
      releaseProcessClose = resolve
    })
    const clonePaths: string[] = []
    const preparedRecoveryIds: string[] = []
    let attempts = 0
    const journal = new MemoryJournal()
    const manager = stagingManager({
      prepare: async item => {
        assert.ok(item.recoveryId)
        preparedRecoveryIds.push(item.recoveryId)
        return {
          kind: 'clone',
          clonePath: `/staging/${item.recoveryId}`,
        }
      },
      discard: async item => {
        assert.equal(journal.saved?.statuses[0][1].kind, 'interrupted')
        assert.equal(item.recoveryId, preparedRecoveryIds[0])
        return true
      },
    })
    const cloningStore = {
      clone: async (
        _url: string,
        path: string,
        _options: CloneOptions,
        callbacks?: {
          signal?: AbortSignal
          onAbort?: () => void
          onSuccess?: (accountKey: string | null) => void
        }
      ) => {
        attempts += 1
        clonePaths.push(path)
        if (attempts === 1) {
          firstStarted()
          await new Promise<void>(resolve => {
            const abort = () => {
              markAbortObserved()
              void processClosed.then(() => {
                callbacks?.onAbort?.()
                resolve()
              })
            }
            if (callbacks?.signal?.aborted) {
              abort()
            } else {
              callbacks?.signal?.addEventListener('abort', abort, {
                once: true,
              })
            }
          })
          return false
        }
        callbacks?.onSuccess?.(null)
        return true
      },
    } as unknown as CloningRepositoriesStore
    const pausedStore = new BatchCloneStore(
      cloningStore,
      journal,
      async () => 'empty',
      manager
    )
    await pausedStore.initialize()

    const running = pausedStore.startBatch(
      [first, second],
      BatchCloneMode.Sequential
    )
    await started
    const recoveryId = pausedStore.getState()?.items[0].recoveryId
    let pauseResolved = false
    const pause = pausedStore.requestPause().then(() => {
      pauseResolved = true
    })
    await abortObserved
    await Promise.resolve()
    assert.equal(
      pauseResolved,
      false,
      'pause must wait for the owned Git process to close'
    )
    releaseProcessClose()
    await pause
    await running

    assert.equal(pausedStore.getState()?.isPaused, true)
    assert.equal(
      pausedStore.getState()?.statuses.get(first.path)?.kind,
      'interrupted'
    )
    assert.equal(
      pausedStore.getState()?.statuses.get(second.path)?.kind,
      'pending'
    )
    assert.equal(journal.saved?.statuses[0][1].kind, 'interrupted')

    const relaunchedStore = new BatchCloneStore(
      cloningStore,
      journal,
      async () => 'empty',
      manager
    )
    await relaunchedStore.initialize()
    assert.equal(relaunchedStore.getState()?.items[0].recoveryId, recoveryId)
    await relaunchedStore.resume()

    assert.equal(relaunchedStore.getState()?.isDone, true)
    assert.equal(relaunchedStore.getState()?.items[0].recoveryId, recoveryId)
    assert.equal(clonePaths[0], clonePaths[1])
    assert.equal(preparedRecoveryIds[0], preparedRecoveryIds[2])
    assert.equal(journal.saved?.statuses[1][1].kind, 'done')
  })

  it('aborts an active clone on cancel before discarding staged data', async () => {
    let markStarted: () => void = () => {}
    const started = new Promise<void>(resolve => {
      markStarted = resolve
    })
    let markAbortObserved: () => void = () => {}
    const abortObserved = new Promise<void>(resolve => {
      markAbortObserved = resolve
    })
    let releaseProcessClose: () => void = () =>
      assert.fail('the clone process has not started')
    const processClosed = new Promise<void>(resolve => {
      releaseProcessClose = resolve
    })
    const journal = new MemoryJournal()
    let discardCalls = 0
    const manager = stagingManager({
      discard: async () => {
        discardCalls += 1
        assert.equal(journal.saved?.statuses[0][1].kind, 'skipped')
        return true
      },
    })
    const store = new BatchCloneStore(
      {
        clone: async (
          _url: string,
          _path: string,
          _options: CloneOptions,
          callbacks?: { signal?: AbortSignal; onAbort?: () => void }
        ) => {
          markStarted()
          await new Promise<void>(resolve => {
            const abort = () => {
              markAbortObserved()
              void processClosed.then(() => {
                callbacks?.onAbort?.()
                resolve()
              })
            }
            if (callbacks?.signal?.aborted) {
              abort()
            } else {
              callbacks?.signal?.addEventListener('abort', abort, {
                once: true,
              })
            }
          })
          return false
        },
      } as unknown as CloningRepositoriesStore,
      journal,
      async () => 'empty',
      manager
    )
    await store.initialize()

    const running = store.startBatch([first], BatchCloneMode.Sequential)
    await started
    let cancelResolved = false
    const cancel = store.requestCancel().then(() => {
      cancelResolved = true
    })
    await abortObserved
    await Promise.resolve()
    assert.equal(
      cancelResolved,
      false,
      'cancel must wait for the owned Git process to close'
    )
    releaseProcessClose()
    await cancel
    await running

    assert.ok(discardCalls >= 1)
    assert.equal(store.getState()?.statuses.get(first.path)?.kind, 'skipped')
    assert.equal(store.getState()?.isRunning, false)
    assert.equal(journal.saved?.statuses[0][1].kind, 'skipped')
  })

  it('retains partial staging when an interrupted snapshot cannot be saved', async () => {
    let markStarted: () => void = () => {}
    const started = new Promise<void>(resolve => {
      markStarted = resolve
    })
    // Initial queue, preparation, run, and `cloning` snapshots succeed. The
    // interrupted snapshot and final queue snapshot both fail.
    const journal = new FailingJournal(null, 4)
    let discardCalls = 0
    const store = new BatchCloneStore(
      {
        clone: async (
          _url: string,
          _path: string,
          _options: CloneOptions,
          callbacks?: { signal?: AbortSignal; onAbort?: () => void }
        ) => {
          markStarted()
          await new Promise<void>(resolve => {
            const abort = () => {
              callbacks?.onAbort?.()
              resolve()
            }
            if (callbacks?.signal?.aborted) {
              abort()
            } else {
              callbacks?.signal?.addEventListener('abort', abort, {
                once: true,
              })
            }
          })
          return false
        },
      } as unknown as CloningRepositoriesStore,
      journal,
      async () => 'empty',
      stagingManager({
        discard: async () => {
          discardCalls += 1
          return true
        },
      })
    )
    await store.initialize()

    const running = store.startBatch([first], BatchCloneMode.Sequential)
    await started
    await store.requestPause()
    await running

    assert.equal(discardCalls, 0)
    assert.equal(journal.saved?.statuses[0][1].kind, 'cloning')
    assert.equal(store.getState()?.statuses.get(first.path)?.kind, 'review')
  })

  it('serializes rapid resume requests during destination inspection', async () => {
    const journal = new MemoryJournal({
      version: BatchCloneJournalVersion,
      updatedAt: '2026-07-17T00:00:00.000Z',
      items: [first],
      statuses: [[first.path, { kind: 'interrupted' }]],
      mode: BatchCloneMode.Sequential,
      source: 'manual',
      paused: true,
    })
    let inspections = 0
    let releaseInspection: () => void = () =>
      assert.fail('inspection has not started')
    const inspectionStarted = new Promise<void>(resolve => {
      releaseInspection = resolve
    })
    let finishInspection: () => void = () =>
      assert.fail('inspection has not started')
    const inspectionBlocked = new Promise<void>(resolve => {
      finishInspection = resolve
    })
    const store = new BatchCloneStore(
      {} as CloningRepositoriesStore,
      journal,
      async () => {
        inspections += 1
        releaseInspection()
        await inspectionBlocked
        return 'matching-repository'
      }
    )
    await store.initialize()

    const firstResume = store.resume()
    await inspectionStarted
    const secondResume = store.resume()
    finishInspection()
    await Promise.all([firstResume, secondResume])

    assert.equal(inspections, 1)
    assert.equal(store.getState()?.statuses.get(first.path)?.kind, 'done')
  })

  it('does not resurrect an item cancelled during destination inspection', async () => {
    let inspectionStarted = false
    let finishInspection: () => void = () =>
      assert.fail('inspection has not started')
    const inspectionBlocked = new Promise<void>(resolve => {
      finishInspection = resolve
    })
    let cloneCalls = 0
    const store = new BatchCloneStore(
      {
        clone: async () => {
          cloneCalls += 1
          return true
        },
      } as unknown as CloningRepositoriesStore,
      new MemoryJournal(),
      async () => {
        inspectionStarted = true
        await inspectionBlocked
        return 'empty'
      }
    )
    await store.initialize()

    const running = store.startBatch([first], BatchCloneMode.Sequential)
    while (!inspectionStarted) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    store.requestCancel()
    finishInspection()
    await running

    assert.equal(cloneCalls, 0)
    assert.equal(store.getState()?.statuses.get(first.path)?.kind, 'skipped')
  })

  it('reinspects a queued destination immediately before invoking Git', async () => {
    let inspections = 0
    let cloneCalls = 0
    const store = new BatchCloneStore(
      {
        clone: async () => {
          cloneCalls += 1
          return true
        },
      } as unknown as CloningRepositoriesStore,
      new MemoryJournal(),
      async () => (++inspections === 1 ? 'empty' : 'review')
    )
    await store.initialize()
    await store.startBatch([first], BatchCloneMode.Sequential)

    assert.equal(inspections, 2)
    assert.equal(cloneCalls, 0)
    assert.equal(store.getState()?.statuses.get(first.path)?.kind, 'review')
  })

  it('degrades journal write failures to a soft, non-modal recovery notice', async () => {
    const journal = new ToggleJournal()
    let modalErrors = 0
    const store = new BatchCloneStore(
      {
        clone: async () => true,
      } as unknown as CloningRepositoriesStore,
      journal,
      async () => 'empty'
    )
    store.onDidError(() => {
      modalErrors += 1
    })
    await store.initialize()
    await store.startBatch([first], BatchCloneMode.Sequential)

    // No modal error is raised; the failure is surfaced only as soft state.
    assert.equal(modalErrors, 0)
    assert.equal(store.getState()?.recoveryUnavailable, true)
    assert.equal(store.getState()?.statuses.get(first.path)?.kind, 'done')

    // A later successful write clears the notice again.
    journal.failSaves = false
    await store.markFinalized([first.path])
    assert.equal(store.getState()?.recoveryUnavailable, false)
  })

  it('retries a journal write through a transient file lock', async () => {
    let attempts = 0
    const journal = new FileBatchCloneJournal('/user-data', {
      readText: async () => null,
      clear: async () => undefined,
      writeText: async () => {
        attempts += 1
        if (attempts < 3) {
          throw Object.assign(new Error('locked'), { code: 'EPERM' })
        }
      },
    })

    await journal.save({
      version: BatchCloneJournalVersion,
      updatedAt: '2026-07-17T00:00:00.000Z',
      items: [first],
      statuses: [[first.path, { kind: 'pending' }]],
      mode: BatchCloneMode.Sequential,
      source: 'manual',
      paused: false,
    })

    assert.equal(attempts, 3)
  })

  it('does not retry a non-transient journal write failure', async () => {
    let attempts = 0
    const journal = new FileBatchCloneJournal('/user-data', {
      readText: async () => null,
      clear: async () => undefined,
      writeText: async () => {
        attempts += 1
        throw Object.assign(new Error('no space'), { code: 'ENOSPC' })
      },
    })

    await assert.rejects(
      journal.save({
        version: BatchCloneJournalVersion,
        updatedAt: '2026-07-17T00:00:00.000Z',
        items: [first],
        statuses: [[first.path, { kind: 'pending' }]],
        mode: BatchCloneMode.Sequential,
        source: 'manual',
        paused: false,
      })
    )

    assert.equal(attempts, 1)
  })

  it('skips a single review item and discards only its staging', async () => {
    const recoveryItem: IBatchCloneItem = {
      ...first,
      recoveryId: 'e'.repeat(48),
    }
    const journal = new MemoryJournal({
      version: CurrentBatchCloneJournalVersion,
      updatedAt: '2026-07-17T00:00:00.000Z',
      items: [recoveryItem],
      statuses: [[recoveryItem.path, { kind: 'review' }]],
      mode: BatchCloneMode.Sequential,
      source: 'manual',
      paused: false,
    })
    let discardCalls = 0
    const store = new BatchCloneStore(
      {} as CloningRepositoriesStore,
      journal,
      async () => 'review',
      stagingManager({
        discard: async () => {
          discardCalls += 1
          return true
        },
      })
    )
    await store.initialize()

    await store.skipItem(first.path)

    assert.equal(store.getState()?.statuses.get(first.path)?.kind, 'skipped')
    assert.ok(discardCalls >= 1)
  })

  it('adopts an existing matching folder from review without touching it', async () => {
    const recoveryItem: IBatchCloneItem = {
      ...first,
      recoveryId: 'f'.repeat(48),
    }
    const journal = new MemoryJournal({
      version: CurrentBatchCloneJournalVersion,
      updatedAt: '2026-07-17T00:00:00.000Z',
      items: [recoveryItem],
      statuses: [[recoveryItem.path, { kind: 'review' }]],
      mode: BatchCloneMode.Sequential,
      source: 'manual',
      paused: false,
    })
    let discardCalls = 0
    const store = new BatchCloneStore(
      {} as CloningRepositoriesStore,
      journal,
      async () => 'matching-repository',
      stagingManager({
        discard: async () => {
          discardCalls += 1
          return true
        },
      })
    )
    await store.initialize()

    await store.adoptExistingItem(first.path)

    const status = store.getState()?.statuses.get(first.path)
    assert.equal(status?.kind, 'done')
    assert.equal(status?.finalized, undefined)
    assert.equal(discardCalls, 1)
  })

  it('keeps a non-matching folder in review when adoption is attempted', async () => {
    const journal = new MemoryJournal({
      version: BatchCloneJournalVersion,
      updatedAt: '2026-07-17T00:00:00.000Z',
      items: [first],
      statuses: [[first.path, { kind: 'review' }]],
      mode: BatchCloneMode.Sequential,
      source: 'manual',
      paused: false,
    })
    const store = new BatchCloneStore(
      {} as CloningRepositoriesStore,
      journal,
      async () => 'review'
    )
    await store.initialize()

    await store.adoptExistingItem(first.path)

    const status = store.getState()?.statuses.get(first.path)
    assert.equal(status?.kind, 'review')
    assert.match(status?.error?.message ?? '', /not a matching clone/i)
  })

  it('requires review for occupied or mismatched destinations', async () => {
    const journal = new MemoryJournal()
    const store = new BatchCloneStore(
      {
        clone: async () => {
          assert.fail('unsafe destination must not be cloned')
        },
      } as unknown as CloningRepositoriesStore,
      journal,
      async () => 'review'
    )
    await store.initialize()
    await store.startBatch([first], BatchCloneMode.Sequential)

    const status = store.getState()?.statuses.get(first.path)
    assert.equal(status?.kind, 'review')
    assert.match(status?.error?.message ?? '', /will not delete/i)
  })

  it('contains unexpected inspection and clone exceptions in recoverable states', async () => {
    const inspectionFailure = new BatchCloneStore(
      {} as CloningRepositoriesStore,
      new MemoryJournal(),
      async () => {
        throw new Error('inspection failed')
      }
    )
    await inspectionFailure.initialize()
    await inspectionFailure.startBatch([first], BatchCloneMode.Sequential)
    assert.equal(
      inspectionFailure.getState()?.statuses.get(first.path)?.kind,
      'review'
    )

    const cloneFailure = new BatchCloneStore(
      {
        clone: async () => {
          throw new Error('clone failed unexpectedly')
        },
      } as unknown as CloningRepositoriesStore,
      new MemoryJournal(),
      async () => 'empty'
    )
    await cloneFailure.initialize()
    await cloneFailure.startBatch([first], BatchCloneMode.Sequential)
    assert.equal(cloneFailure.getState()?.isRunning, false)
    assert.equal(cloneFailure.getState()?.isDone, true)
    assert.equal(
      cloneFailure.getState()?.statuses.get(first.path)?.kind,
      'failed'
    )
  })

  it('does not replace a retained failed queue until explicit dismissal', async () => {
    const store = new BatchCloneStore(
      {
        clone: async () => false,
      } as unknown as CloningRepositoriesStore,
      new MemoryJournal(),
      async () => 'empty'
    )
    await store.initialize()
    await store.startBatch([first], BatchCloneMode.Sequential)

    assert.equal(store.isBusy, false)
    assert.equal(store.requiresAttention, true)
    await assert.rejects(
      store.startBatch([second], BatchCloneMode.Sequential),
      /needs review/i
    )

    await store.dismiss()
    await store.startBatch([second], BatchCloneMode.Sequential)
    assert.equal(store.getState()?.items[0].path, second.path)
  })

  it('marks successful paths finalized exactly once', async () => {
    const journal = new MemoryJournal()
    const store = new BatchCloneStore(
      {
        clone: async () => true,
      } as unknown as CloningRepositoriesStore,
      journal,
      async () => 'empty'
    )
    await store.initialize()
    await store.startBatch([first], BatchCloneMode.Sequential)
    assert.equal(store.requiresAttention, true)

    const before = journal.saveCount
    await store.markFinalized([first.path])
    const afterFirst = journal.saveCount
    await store.markFinalized([first.path])

    assert.ok(afterFirst > before)
    assert.equal(journal.saveCount, afterFirst)
    assert.equal(store.getState()?.statuses.get(first.path)?.finalized, true)
    assert.equal(store.requiresAttention, true)

    await store.markCompletionNotified()
    assert.equal(store.requiresAttention, false)
    const afterNotification = journal.saveCount
    await store.markCompletionNotified()
    assert.equal(journal.saveCount, afterNotification)
    assert.equal(journal.saved?.notifiedGeneration, 1)
  })

  it('requires a checked-out HEAD before accepting a matching origin', async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), 'desktop-material-clone-recovery-')
    )
    const repositoryPath = join(temporaryRoot, 'unfinished')
    try {
      await mkdir(repositoryPath)
      await git(['init'], repositoryPath, 'batchCloneRecoveryMissingHeadTest', {
        isBackgroundTask: true,
      })
      await git(
        ['remote', 'add', 'origin', first.url],
        repositoryPath,
        'batchCloneRecoveryMissingHeadOriginTest',
        { isBackgroundTask: true }
      )

      assert.equal(
        await inspectCloneDestination({
          ...first,
          name: 'unfinished',
          path: repositoryPath,
        }),
        'review'
      )
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('rejects destination symlinks and external .git metadata', async t => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), 'desktop-material-clone-symlink-')
    )
    const targetPath = join(temporaryRoot, 'target')
    const destinationPath = join(temporaryRoot, 'destination')
    const linkedBasePath = join(temporaryRoot, 'linked-base')
    const gitFilePath = join(temporaryRoot, 'git-file-repository')
    try {
      await mkdir(targetPath)
      try {
        await symlink(
          targetPath,
          destinationPath,
          process.platform === 'win32' ? 'junction' : 'dir'
        )
      } catch (error) {
        if (error.code === 'EPERM' || error.code === 'EACCES') {
          t.skip('Creating filesystem links is not permitted in this runner')
          return
        }
        throw error
      }

      assert.equal(
        await inspectCloneDestination({
          ...first,
          name: 'destination',
          path: destinationPath,
        }),
        'review'
      )

      await symlink(
        targetPath,
        linkedBasePath,
        process.platform === 'win32' ? 'junction' : 'dir'
      )
      assert.equal(
        await inspectCloneDestination({
          ...first,
          name: 'child',
          path: join(linkedBasePath, 'child'),
        }),
        'review'
      )

      await mkdir(gitFilePath)
      await writeFile(join(gitFilePath, '.git'), 'gitdir: ../target\n')
      assert.equal(
        await inspectCloneDestination({
          ...first,
          name: 'git-file-repository',
          path: gitFilePath,
        }),
        'review'
      )
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })
})
