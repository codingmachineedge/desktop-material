import assert from 'node:assert'
import { describe, it, TestContext } from 'node:test'
import { exec } from 'dugite'

import { Branch, BranchType } from '../../src/models/branch'
import { Repository } from '../../src/models/repository'
import { WorkingDirectoryStatus } from '../../src/models/status'
import { TipState } from '../../src/models/tip'
import { IStatusResult } from '../../src/lib/git'
import { getPullPreview, IPullPreview } from '../../src/lib/git/pull-preview'
import { createPullStrategyPlan } from '../../src/lib/git/pull-strategy'
import { IPreparedPullPreview } from '../../src/lib/pull-preview'
import { PullPreviewError } from '../../src/lib/pull-preview'
import { AppStore } from '../../src/lib/stores/app-store'
import { setupEmptyRepository } from '../helpers/repositories'
import { makeCommit, switchTo } from '../helpers/repository-scaffolding'

const oid = async (repository: Repository, ref = 'HEAD') =>
  (await exec(['rev-parse', ref], repository.path)).stdout.trim()

const reviewedPreview: IPullPreview = {
  kind: 'ready',
  currentBranchRef: 'refs/heads/master',
  currentBranchOid: '1'.repeat(40),
  upstreamRef: 'refs/remotes/origin/master',
  upstreamOid: '2'.repeat(40),
  mergeBaseOid: '1'.repeat(40),
  ahead: 0,
  behind: 1,
  incomingCommits: [],
  incomingCommitsTruncated: false,
  changedFiles: [],
  changedFileCount: 0,
  changedFilesTruncated: false,
}

const cleanStatus: IStatusResult = {
  exists: true,
  mergeHeadFound: false,
  squashMsgFound: false,
  rebaseInternalState: null,
  isCherryPickingHeadFound: false,
  workingDirectory: WorkingDirectoryStatus.fromFiles([]),
  doConflictedFilesExist: false,
}

function prepare(preview: IPullPreview): IPreparedPullPreview {
  return {
    result: preview,
    integrationPlan: createPullStrategyPlan(
      { rebase: 'false', ff: 'ff' },
      preview.ahead,
      preview.behind
    ),
    worktreeState: 'clean',
  }
}

function setRefreshedRepositoryWrapper(store: AppStore): void {
  Reflect.set(
    store,
    'withRefreshedGitHubRepository',
    async <T>(
      repository: Repository,
      action: (repository: Repository) => Promise<T>
    ) => action(repository)
  )
}

async function setupTrackedPreviewRepository(t: TestContext): Promise<{
  readonly repository: Repository
  readonly localOid: string
  readonly upstreamOid: string
}> {
  const repository = await setupEmptyRepository(t)
  await makeCommit(repository, {
    commitMessage: 'Base',
    entries: [{ path: 'base.txt', contents: 'base' }],
  })
  const localOid = await oid(repository)

  await switchTo(repository, 'upstream-work')
  await makeCommit(repository, {
    commitMessage: 'Incoming',
    entries: [{ path: 'incoming.txt', contents: 'incoming' }],
  })
  const upstreamOid = await oid(repository)
  await switchTo(repository, 'master')

  await exec(['remote', 'add', 'origin', '.'], repository.path)
  await exec(['remote', 'add', 'fallback', '.'], repository.path)
  await exec(
    ['update-ref', 'refs/remotes/origin/master', upstreamOid],
    repository.path
  )
  await exec(
    ['update-ref', 'refs/remotes/fallback/master', upstreamOid],
    repository.path
  )
  await exec(['config', 'branch.master.remote', 'origin'], repository.path)
  await exec(
    ['config', 'branch.master.merge', 'refs/heads/master'],
    repository.path
  )

  return { repository, localOid, upstreamOid }
}

function createPreparationStore(
  repository: Repository,
  localOid: string,
  events: Array<string>
): AppStore {
  const store = Object.create(AppStore.prototype) as AppStore
  const origin = { name: 'origin', url: '.' }
  const fallback = { name: 'fallback', url: '.' }
  const branch = new Branch(
    'master',
    'origin/master',
    { sha: localOid },
    BranchType.Local,
    'refs/heads/master'
  )

  setRefreshedRepositoryWrapper(store)
  Reflect.set(store, '_refreshRepository', async () => {
    events.push('refresh')
  })
  Reflect.set(store, 'loadPullPreviewStatus', async () => {
    events.push('fresh-status')
    return cleanStatus
  })
  Reflect.set(store, 'gitStoreCache', {
    get: () => {
      events.push('read-state')
      return {
        tip: { kind: TipState.Valid, branch },
        remotes: [origin, fallback],
        currentRemote: fallback,
        pullWithRebase: false,
      }
    },
  })
  Reflect.set(store, 'repositoryStateCache', {
    get: (candidate: Repository) => {
      assert.equal(candidate, repository)
      return { changesState: { workingDirectory: { files: [] } } }
    },
  })

  return store
}

describe('pull preview app-store safety', () => {
  it('reports a busy reviewed pull, refreshes after the failure, and preserves ordinary busy semantics', async () => {
    const repository = new Repository('C:/reviewed-pull', 1, null, false)
    const store = Object.create(AppStore.prototype) as AppStore
    let refreshes = 0

    setRefreshedRepositoryWrapper(store)
    Reflect.set(store, 'withPushPullFetch', async () => undefined)
    Reflect.set(store, '_refreshRepository', async () => {
      refreshes++
    })
    Reflect.set(store, 'loadPullPreviewStatus', async () => cleanStatus)

    await assert.rejects(
      store._pullReviewed(repository, prepare(reviewedPreview)),
      (error: unknown) =>
        error instanceof PullPreviewError && error.code === 'busy'
    )
    assert.equal(refreshes, 1)

    await store._pull(repository)
    assert.equal(refreshes, 1)
  })

  it('refreshes best-effort and localizes an unexpected reviewed-pull failure', async () => {
    const repository = new Repository('C:/reviewed-pull', 1, null, false)
    const store = Object.create(AppStore.prototype) as AppStore
    let refreshes = 0

    setRefreshedRepositoryWrapper(store)
    Reflect.set(store, 'withPushPullFetch', async () => {
      throw new Error('synthetic partial mutation')
    })
    Reflect.set(store, '_refreshRepository', async () => {
      refreshes++
      throw new Error('synthetic refresh failure')
    })

    await assert.rejects(
      store._pullReviewed(repository, prepare(reviewedPreview)),
      (error: unknown) =>
        error instanceof PullPreviewError && error.code === 'pull-failed'
    )
    assert.equal(refreshes, 1)
  })

  it('keeps preview-fetch failures on the localized surface without invoking the GitStore emitter', async t => {
    const repository = await setupEmptyRepository(t)
    const missingRemote = {
      name: 'missing',
      url: `${repository.path}-does-not-exist`,
    }
    await exec(
      ['remote', 'add', missingRemote.name, missingRemote.url],
      repository.path
    )

    const store = Object.create(AppStore.prototype) as AppStore
    let emitterCalls = 0
    Reflect.set(store, 'accounts', [])
    Reflect.set(store, 'gitStoreCache', {
      get: () => ({
        performFailableOperation: async () => {
          emitterCalls++
        },
      }),
    })
    Reflect.set(
      store,
      'withPushPullFetch',
      async (_repository: Repository, action: () => Promise<void>) => action()
    )
    Reflect.set(store, 'updatePushPullFetchProgress', () => undefined)
    Reflect.set(store, '_refreshRepository', async () => undefined)

    const performPullPreviewFetch = Reflect.get(
      store,
      'performPullPreviewFetch'
    ) as (
      repository: Repository,
      remote: { readonly name: string; readonly url: string }
    ) => Promise<void>

    await assert.rejects(
      performPullPreviewFetch.call(store, repository, missingRemote),
      (error: unknown) =>
        error instanceof PullPreviewError && error.code === 'fetch-failed'
    )
    assert.equal(emitterCalls, 0)
  })

  it('keeps reviewed-pull Git failures on the localized surface without invoking the GitStore emitter', async t => {
    const { repository, localOid } = await setupTrackedPreviewRepository(t)
    const preview = await getPullPreview(repository)
    assert.equal(preview.kind, 'ready')
    if (preview.kind !== 'ready') {
      return
    }

    const store = Object.create(AppStore.prototype) as AppStore
    const origin = { name: 'origin', url: '.' }
    const branch = new Branch(
      'master',
      'origin/master',
      { sha: localOid },
      BranchType.Local,
      'refs/heads/master'
    )
    let emitterCalls = 0
    let refreshes = 0

    setRefreshedRepositoryWrapper(store)
    Reflect.set(store, 'accounts', [])
    Reflect.set(
      store,
      'withPushPullFetch',
      async (_repository: Repository, action: () => Promise<void>) => action()
    )
    Reflect.set(store, '_refreshRepository', async () => {
      refreshes++
    })
    Reflect.set(store, 'loadPullPreviewStatus', async () => cleanStatus)
    Reflect.set(store, 'repositoryStateCache', {
      get: () => ({
        branchesState: { tip: { kind: TipState.Valid, branch } },
        changesState: { workingDirectory: { files: [] } },
      }),
    })
    Reflect.set(store, 'gitStoreCache', {
      get: () => ({
        remotes: [origin],
        currentRemote: origin,
        pullWithRebase: false,
        performFailableOperation: async () => {
          emitterCalls++
        },
      }),
    })
    Reflect.set(store, 'statsStore', { increment: () => undefined })
    Reflect.set(store, 'updatePushPullFetchProgress', () => undefined)
    Reflect.set(store, 'withTemporaryRepositoryMutationGuard', async () => {
      throw new Error('synthetic Git failure after validation')
    })

    await assert.rejects(
      store._pullReviewed(repository, prepare(preview)),
      (error: unknown) =>
        error instanceof PullPreviewError && error.code === 'pull-failed'
    )
    assert.equal(emitterCalls, 0)
    assert.equal(refreshes, 2)
  })

  it('refreshes first and fetches the configured upstream instead of the current-remote fallback', async t => {
    const { repository, localOid } = await setupTrackedPreviewRepository(t)
    const events = new Array<string>()
    const store = createPreparationStore(repository, localOid, events)

    Reflect.set(
      store,
      'performPullPreviewFetch',
      async (_repository: Repository, remote: { readonly name: string }) => {
        events.push(`fetch:${remote.name}`)
      }
    )

    const prepared = await store._preparePullPreview(repository)

    assert.equal(prepared.result.kind, 'ready')
    assert.deepEqual(events.slice(0, 4), [
      'refresh',
      'fresh-status',
      'read-state',
      'fetch:origin',
    ])
    assert.equal(events.includes('fetch:fallback'), false)
  })

  it('rejects a branch identity that changes after the upstream fetch', async t => {
    const { repository, localOid, upstreamOid } =
      await setupTrackedPreviewRepository(t)
    const store = createPreparationStore(repository, localOid, [])

    Reflect.set(store, 'performPullPreviewFetch', async () => {
      await exec(
        ['update-ref', 'refs/heads/master', upstreamOid],
        repository.path
      )
    })

    await assert.rejects(
      store._preparePullPreview(repository),
      (error: unknown) =>
        error instanceof PullPreviewError && error.code === 'stale-preview'
    )
  })

  it('rejects an upstream that changes away from the fetched remote', async t => {
    const { repository, localOid } = await setupTrackedPreviewRepository(t)
    const store = createPreparationStore(repository, localOid, [])

    Reflect.set(store, 'performPullPreviewFetch', async () => {
      await exec(
        ['config', 'branch.master.remote', 'fallback'],
        repository.path
      )
    })

    await assert.rejects(
      store._preparePullPreview(repository),
      (error: unknown) =>
        error instanceof PullPreviewError && error.code === 'stale-preview'
    )
  })

  it('rejects a failed final status read instead of trusting cached clean state', async t => {
    const { repository, localOid } = await setupTrackedPreviewRepository(t)
    const events = new Array<string>()
    const store = createPreparationStore(repository, localOid, events)
    let statusReads = 0
    Reflect.set(store, 'loadPullPreviewStatus', async () => {
      statusReads++
      return statusReads === 1 ? cleanStatus : null
    })
    Reflect.set(store, 'performPullPreviewFetch', async () => {
      events.push('fetch:origin')
    })

    await assert.rejects(
      store._preparePullPreview(repository),
      (error: unknown) =>
        error instanceof PullPreviewError && error.code === 'stale-preview'
    )
    assert.equal(events.includes('fetch:origin'), true)
    assert.equal(statusReads, 2)
  })

  it('does not enter reviewed pull mutation after a failed fresh status gate', async () => {
    const repository = new Repository('C:/reviewed-pull', 1, null, false)
    const store = Object.create(AppStore.prototype) as AppStore
    let mutationCalls = 0

    setRefreshedRepositoryWrapper(store)
    Reflect.set(
      store,
      'withPushPullFetch',
      async (_repository: Repository, action: () => Promise<void>) => action()
    )
    Reflect.set(store, '_refreshRepository', async () => undefined)
    Reflect.set(store, 'loadPullPreviewStatus', async () => null)
    Reflect.set(store, 'gitStoreCache', { get: () => ({}) })
    Reflect.set(store, 'withTemporaryRepositoryMutationGuard', async () => {
      mutationCalls++
    })

    await assert.rejects(
      store._pullReviewed(repository, prepare(reviewedPreview)),
      (error: unknown) =>
        error instanceof PullPreviewError && error.code === 'stale-preview'
    )
    assert.equal(mutationCalls, 0)
  })
})
