import assert from 'node:assert'
import { Disposable } from 'event-kit'
import { describe, it } from 'node:test'
import { Account, getAccountKey } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { Repository } from '../../src/models/repository'
import { AccountsStore } from '../../src/lib/stores/accounts-store'
import {
  getGitHubReleasesAvailability,
  GitHubReleasesError,
  GitHubReleasesStore,
  githubReleasesError,
  IGitHubReleasesAPI,
  IGitHubReleasesStoreDependencies,
} from '../../src/lib/stores/github-releases-store'
import {
  IGitHubRelease,
  IGitHubReleaseAsset,
} from '../../src/lib/github-releases'
import { APIError } from '../../src/lib/http'

const selected = new Account(
  'selected',
  'https://api.github.com',
  'selected-token',
  [],
  '',
  2,
  'Selected'
)
const other = new Account(
  'other',
  'https://api.github.com',
  'other-token',
  [],
  '',
  3,
  'Other'
)
const gitHubRepository = new GitHubRepository(
  'material',
  new Owner('desktop', 'https://api.github.com', 1),
  1
)
const repository = new Repository(
  'C:\\work\\material',
  1,
  gitHubRepository,
  false,
  null,
  {},
  false,
  undefined,
  getAccountKey(selected)
)

const asset: IGitHubReleaseAsset = {
  id: 19,
  name: 'desktop.exe',
  label: null,
  state: 'uploaded',
  contentType: 'application/octet-stream',
  sizeInBytes: 4,
  downloadCount: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  digest: `sha256:${'a'.repeat(64)}`,
}
const release: IGitHubRelease = {
  id: 7,
  tagName: 'v1.0.0',
  targetCommitish: 'main',
  name: 'Stable',
  body: 'Notes',
  draft: true,
  prerelease: false,
  createdAt: new Date(0),
  publishedAt: null,
  authorLogin: 'fixture-bot',
  assets: [asset],
}

class FakeAccountsStore {
  private readonly callbacks = new Set<
    (accounts: ReadonlyArray<Account>) => void
  >()

  public constructor(private accounts: ReadonlyArray<Account>) {}

  public async getAll() {
    return this.accounts
  }

  public onDidUpdate(callback: (accounts: ReadonlyArray<Account>) => void) {
    this.callbacks.add(callback)
    return new Disposable(() => this.callbacks.delete(callback))
  }

  public update(accounts: ReadonlyArray<Account>) {
    this.accounts = accounts
    for (const callback of this.callbacks) {
      callback(accounts)
    }
  }
}

function fakeAPI(
  overrides: Partial<IGitHubReleasesAPI> = {}
): IGitHubReleasesAPI {
  return {
    fetchReleases: async () => ({
      releases: [release],
      page: 1,
      nextPage: null,
      capped: false,
    }),
    fetchRelease: async () => release,
    fetchReleaseAssets: async () => ({
      assets: [asset],
      page: 1,
      nextPage: null,
      capped: false,
    }),
    fetchReleaseAsset: async () => asset,
    createReleaseDraft: async () => release,
    updateRelease: async () => release,
    publishRelease: async () => ({
      ...release,
      draft: false,
      publishedAt: new Date(),
    }),
    deleteRelease: async () => undefined,
    deleteReleaseAsset: async () => undefined,
    ...overrides,
  }
}

function dependencies(
  apiFor: IGitHubReleasesStoreDependencies['apiFor']
): IGitHubReleasesStoreDependencies {
  return {
    apiFor,
    downloadAsset: async () => ({
      ok: true,
      path: 'C:\\Downloads\\desktop.exe',
      bytes: 4,
      localDigest: asset.digest!,
      matchesGitHubDigest: true,
    }),
    uploadAsset: async () => ({
      ok: true,
      asset,
      bytes: 4,
      localDigest: asset.digest!,
    }),
  }
}

async function storeWith(
  accountsStore: FakeAccountsStore,
  deps: IGitHubReleasesStoreDependencies
) {
  const store = new GitHubReleasesStore(
    accountsStore as unknown as AccountsStore,
    deps
  )
  await Promise.resolve()
  return store
}

describe('GitHub Releases store', () => {
  it('routes every request through the repository-selected account', async () => {
    const accountsStore = new FakeAccountsStore([other, selected])
    const accountKeys = new Array<string>()
    let requested:
      | {
          owner: string
          name: string
          page: number | undefined
          signal: AbortSignal | undefined
        }
      | undefined
    const controller = new AbortController()
    const store = await storeWith(
      accountsStore,
      dependencies(account => {
        accountKeys.push(getAccountKey(account))
        return fakeAPI({
          fetchReleases: async (owner, name, page, signal) => {
            requested = { owner, name, page, signal }
            return { releases: [release], page: 2, nextPage: 3, capped: false }
          },
        })
      })
    )

    const result = await store.list(repository, 2, controller.signal)
    assert.equal(result.nextPage, 3)
    assert.deepEqual(accountKeys, [getAccountKey(selected)])
    assert.equal(requested?.owner, 'desktop')
    assert.equal(requested?.name, 'material')
    assert.equal(requested?.page, 2)
    assert.ok(requested?.signal instanceof AbortSignal)
    assert.notEqual(requested?.signal, controller.signal)
  })

  it('cancels and rejects stale results when the selected account changes', async () => {
    const accountsStore = new FakeAccountsStore([selected])
    let resolveRequest:
      | ((value: {
          releases: IGitHubRelease[]
          page: number
          nextPage: null
          capped: false
        }) => void)
      | undefined
    let requestSignal: AbortSignal | undefined
    const store = await storeWith(
      accountsStore,
      dependencies(() =>
        fakeAPI({
          fetchReleases: async (_owner, _name, _page, signal) => {
            requestSignal = signal
            return await new Promise(resolve => {
              resolveRequest = resolve
            })
          },
        })
      )
    )
    const pending = store.list(repository)
    await Promise.resolve()
    accountsStore.update([selected.withToken('rotated-token')])
    assert.equal(requestSignal?.aborted, true)
    resolveRequest?.({
      releases: [release],
      page: 1,
      nextPage: null,
      capped: false,
    })
    await assert.rejects(
      pending,
      error => (error as Error).name === 'AbortError'
    )
  })

  it('provides distinct signed-out, unsupported, and non-GitHub states', async () => {
    const signedOut = new Repository(
      repository.path,
      2,
      gitHubRepository,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(other)
    )
    assert.equal(
      getGitHubReleasesAvailability(signedOut, [selected]),
      'signed-out'
    )
    const local = new Repository('C:\\work\\local', 3, null, false)
    assert.equal(getGitHubReleasesAvailability(local, [selected]), 'not-github')

    const accountsStore = new FakeAccountsStore([])
    const store = await storeWith(
      accountsStore,
      dependencies(() => fakeAPI())
    )
    await assert.rejects(
      store.list(repository),
      error =>
        error instanceof GitHubReleasesError && error.kind === 'authentication'
    )
  })

  it('runs reviewed metadata, publish/delete, and asset operations', async () => {
    const accountsStore = new FakeAccountsStore([selected])
    const calls = new Array<string>()
    const store = await storeWith(
      accountsStore,
      dependencies(() =>
        fakeAPI({
          createReleaseDraft: async () => {
            calls.push('create')
            return release
          },
          updateRelease: async () => {
            calls.push('update')
            return release
          },
          publishRelease: async () => {
            calls.push('publish')
            return { ...release, draft: false }
          },
          deleteRelease: async () => {
            calls.push('delete')
          },
          deleteReleaseAsset: async () => {
            calls.push('delete-asset')
          },
        })
      )
    )
    await store.createDraft(repository, {
      tagName: 'v1.0.0',
      targetCommitish: 'main',
      name: 'Stable',
      body: 'Notes',
      prerelease: false,
    })
    await store.update(
      repository,
      store.createMutationReview(repository, release),
      { ...release, releaseId: 7 }
    )
    await store.publish(
      repository,
      store.createMutationReview(repository, release)
    )
    await store.deleteAsset(
      repository,
      store.createMutationReview(repository, release, asset)
    )
    await store.delete(
      repository,
      store.createMutationReview(repository, release)
    )
    const transferController = new AbortController()
    await store.downloadAsset(
      repository,
      7,
      asset,
      'C:\\Downloads\\desktop.exe',
      transferController.signal
    )
    await store.uploadAsset(
      repository,
      store.createMutationReview(repository, release),
      'C:\\Build\\desktop.exe',
      asset.name,
      null,
      transferController.signal
    )
    assert.deepEqual(calls, [
      'create',
      'update',
      'publish',
      'delete-asset',
      'delete',
    ])
  })

  it('rejects an update whose release id differs from the reviewed release', async () => {
    const accountsStore = new FakeAccountsStore([selected])
    let fetches = 0
    let updates = 0
    const store = await storeWith(
      accountsStore,
      dependencies(() =>
        fakeAPI({
          fetchRelease: async () => {
            fetches++
            return release
          },
          updateRelease: async () => {
            updates++
            return release
          },
        })
      )
    )

    await assert.rejects(
      store.update(
        repository,
        store.createMutationReview(repository, release),
        { ...release, releaseId: release.id + 1 }
      ),
      error => error instanceof GitHubReleasesError && error.kind === 'conflict'
    )
    assert.equal(fetches, 0)
    assert.equal(updates, 0)
  })

  it('re-fetches exact reviewed state and fails every mutation closed when stale', async () => {
    const accountsStore = new FakeAccountsStore([selected])
    let remoteRelease: IGitHubRelease = {
      ...release,
      body: 'Changed after review',
    }
    const remoteAsset: IGitHubReleaseAsset = {
      ...asset,
      sizeInBytes: asset.sizeInBytes + 1,
    }
    const mutations = new Array<string>()
    const api = fakeAPI({
      fetchRelease: async () => remoteRelease,
      fetchReleaseAsset: async () => remoteAsset,
      publishRelease: async () => {
        mutations.push('publish')
        return { ...release, draft: false }
      },
      updateRelease: async () => {
        mutations.push('update')
        return release
      },
      deleteRelease: async () => {
        mutations.push('delete')
      },
      deleteReleaseAsset: async () => {
        mutations.push('delete-asset')
      },
    })
    const baseDependencies = dependencies(() => api)
    const store = await storeWith(accountsStore, {
      ...baseDependencies,
      uploadAsset: async () => {
        mutations.push('upload')
        return {
          ok: true,
          asset,
          bytes: asset.sizeInBytes,
          localDigest: asset.digest!,
        }
      },
    })
    const review = store.createMutationReview(repository, release)
    const isStaleReview = (error: unknown) =>
      error instanceof GitHubReleasesError && error.kind === 'conflict'

    await assert.rejects(store.publish(repository, review), isStaleReview)
    await assert.rejects(
      store.update(repository, review, { ...release, releaseId: release.id }),
      isStaleReview
    )
    await assert.rejects(store.delete(repository, review), isStaleReview)
    await assert.rejects(
      store.uploadAsset(
        repository,
        review,
        'C:\\Build\\desktop.exe',
        asset.name,
        null,
        new AbortController().signal
      ),
      isStaleReview
    )
    assert.deepEqual(mutations, [])

    remoteRelease = release
    const assetReview = store.createMutationReview(repository, release, asset)
    await assert.rejects(
      store.deleteAsset(repository, assetReview),
      isStaleReview
    )
    assert.deepEqual(mutations, [])
  })

  it('invalidates reviews when the repository or selected account generation changes', async () => {
    const accountsStore = new FakeAccountsStore([selected])
    let fetches = 0
    const store = await storeWith(
      accountsStore,
      dependencies(() =>
        fakeAPI({
          fetchRelease: async () => {
            fetches++
            return release
          },
        })
      )
    )
    const review = store.createMutationReview(repository, release)
    const otherRepository = new Repository(
      repository.path,
      99,
      gitHubRepository,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(selected)
    )
    const isStaleReview = (error: unknown) =>
      error instanceof GitHubReleasesError && error.kind === 'conflict'
    await assert.rejects(store.publish(otherRepository, review), isStaleReview)
    accountsStore.update([selected.withToken('rotated-token')])
    await assert.rejects(store.publish(repository, review), isStaleReview)
    assert.equal(fetches, 0)
  })

  it('maps provider messages to permission-safe app errors', () => {
    const error = githubReleasesError(
      new APIError(
        new Response(JSON.stringify({ message: 'private-provider-detail' }), {
          status: 403,
        }),
        { message: 'private-provider-detail' }
      ),
      'publish'
    )
    assert.ok(error instanceof GitHubReleasesError)
    assert.equal((error as GitHubReleasesError).kind, 'permission')
    assert.equal(error.message.includes('private-provider-detail'), false)
  })
})
