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

  it('pauses pending work, lets the active clone finish, and resumes', async () => {
    let firstStarted = false
    let finishFirst: () => void = () =>
      assert.fail('first clone has not started')
    const cloned: string[] = []
    const cloningStore = {
      clone: async (_url: string, path: string, _options: CloneOptions) => {
        cloned.push(path)
        if (path === first.path) {
          await new Promise<void>(resolve => {
            finishFirst = resolve
            firstStarted = true
          })
        }
        return true
      },
    } as unknown as CloningRepositoriesStore
    const journal = new MemoryJournal()
    const store = new BatchCloneStore(
      cloningStore,
      journal,
      async () => 'empty'
    )
    await store.initialize()

    const running = store.startBatch([first, second], BatchCloneMode.Sequential)
    while (!firstStarted) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    store.requestPause()
    finishFirst()
    await running

    assert.deepEqual(cloned, [first.path])
    assert.equal(store.getState()?.isPaused, true)
    assert.equal(store.getState()?.statuses.get(second.path)?.kind, 'pending')

    await store.resume()
    assert.deepEqual(cloned, [first.path, second.path])
    assert.equal(store.getState()?.isDone, true)
    assert.equal(journal.saved?.statuses[1][1].kind, 'done')
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

    store.dismiss()
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
