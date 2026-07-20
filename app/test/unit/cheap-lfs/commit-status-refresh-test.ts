import assert from 'node:assert'
import { describe, it } from 'node:test'
import { AppStore } from '../../../src/lib/stores/app-store'
import { Repository } from '../../../src/models/repository'

describe('cheap LFS commit status diff refresh', () => {
  it('suppresses pre-Git diffs but refreshes the final post-commit diff', async () => {
    const repository = new Repository('C:/repo', 1, null, false)
    const store = Object.create(AppStore.prototype) as AppStore
    let phase: unknown = { kind: 'preparing' }
    let isCommitting = true
    let diffRefreshes = 0

    Object.assign(store, {
      selectedRepository: null,
      gitStoreCache: {
        get: () => ({ loadStatus: async () => ({}) }),
      },
      repositoryStateCache: {
        updateChangesState: () => undefined,
        get: () => ({ isCommitting, commitOperationPhase: phase }),
      },
      isTemporaryRepositoryActive: () => true,
      updateMultiCommitOperationConflictsIfFound: () => undefined,
      initializeMultiCommitOperationIfConflictsFound: async () => undefined,
      emitUpdate: () => undefined,
      updateChangesWorkingDirectoryDiff: () => {
        diffRefreshes++
      },
    })

    await store._loadStatus(repository)
    assert.equal(diffRefreshes, 0)

    phase = {
      kind: 'cheap-lfs',
      progress: {
        phase: 'uploading',
        completedFiles: 0,
        totalFiles: 1,
        currentPath: 'windows.iso',
        transferredBytes: 1,
        totalBytes: 2,
      },
    }
    await store._loadStatus(repository)
    assert.equal(diffRefreshes, 0)

    phase = { kind: 'git-commit', cheapLfsPointerCount: 1 }
    await store._loadStatus(repository)
    assert.equal(diffRefreshes, 1)

    isCommitting = false
    phase = null
    await store._loadStatus(repository)
    assert.equal(diffRefreshes, 2)
  })

  it('refreshes a partially pinned tree only after the commit phase clears', async () => {
    const repository = new Repository('C:/repo', 1, null, false)
    const store = Object.create(AppStore.prototype) as AppStore
    const events = new Array<string>()
    let commitPhaseActive = false

    Object.assign(store, {
      assertTemporaryRepositoryIsSafe: async () => undefined,
      isTemporaryRepositoryActive: () => true,
      repositoryStateCache: {
        get: () => ({
          changesState: { workingDirectory: { files: [] } },
        }),
      },
      gitStoreCache: { get: () => ({}) },
      withIsCommitting: async (
        _repository: Repository,
        operation: () => Promise<boolean>
      ) => {
        commitPhaseActive = true
        try {
          return await operation()
        } finally {
          commitPhaseActive = false
          events.push('phase-cleared')
        }
      },
      autoPinLargeFilesBeforeCommit: async () => {
        events.push('pin-failed')
        throw new Error('synthetic second-file upload failure')
      },
      emitError: () => events.push('error-reported'),
      _refreshRepository: async () => {
        events.push(`refreshed-with-phase-${commitPhaseActive}`)
      },
    })

    const committed = await store._commitIncludedChanges(
      repository,
      {} as Parameters<AppStore['_commitIncludedChanges']>[1]
    )

    assert.equal(committed, false)
    assert.deepEqual(events, [
      'pin-failed',
      'error-reported',
      'phase-cleared',
      'refreshed-with-phase-false',
    ])
  })
})
