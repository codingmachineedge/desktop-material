import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { Account, getAccountKey } from '../../../src/models/account'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import {
  GitHubReleasesStore,
  IGitHubReleaseMutationReview,
} from '../../../src/lib/stores/github-releases-store'
import {
  IGitHubRelease,
  IGitHubReleaseAsset,
} from '../../../src/lib/github-releases'
import { IGitHubReleaseTransferProgressEvent } from '../../../src/lib/github-release-transfer'
import { updateEndpointVersion } from '../../../src/lib/endpoint-capabilities'
import { GitHubReleasesView } from '../../../src/ui/github-releases'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const account = new Account(
  'fixture-bot',
  'https://api.github.com',
  'fixture-token',
  [],
  '',
  42,
  'Fixture Bot'
)
const remote = new GitHubRepository(
  'material',
  new Owner('desktop', 'https://api.github.com', 1),
  1
)
const repository = new Repository(
  'C:\\fixture\\material',
  1,
  remote,
  false,
  null,
  {},
  false,
  undefined,
  getAccountKey(account)
)
const asset: IGitHubReleaseAsset = {
  id: 19,
  name: 'desktop.exe',
  label: 'Windows installer',
  state: 'uploaded',
  contentType: 'application/octet-stream',
  sizeInBytes: 4096,
  downloadCount: 3,
  createdAt: new Date('2026-07-13T10:00:00Z'),
  updatedAt: new Date('2026-07-13T10:00:00Z'),
  digest: `sha256:${'a'.repeat(64)}`,
}
const draft: IGitHubRelease = {
  id: 7,
  tagName: 'v1.0.0',
  targetCommitish: 'main',
  name: 'Desktop Material 1.0',
  body: 'Reviewed release notes',
  draft: true,
  prerelease: false,
  createdAt: new Date('2026-07-13T09:00:00Z'),
  publishedAt: null,
  authorLogin: 'fixture-bot',
  assets: [asset],
}

function fakeStore(overrides: Record<string, unknown> = {}) {
  return {
    list: async (_repository: Repository, page: number) => ({
      releases:
        page === 1
          ? [draft]
          : [
              {
                ...draft,
                id: 8,
                tagName: 'v0.9.0',
                name: 'Earlier release',
                draft: false,
              },
            ],
      page,
      nextPage: page === 1 ? 2 : null,
      capped: false,
    }),
    listAssets: async () => ({
      assets: [asset],
      page: 1,
      nextPage: null,
      capped: false,
    }),
    createMutationReview: (
      _repository: Repository,
      release: IGitHubRelease,
      reviewedAsset: IGitHubReleaseAsset | null = null
    ): IGitHubReleaseMutationReview => ({
      repositoryFingerprint: 'fixture-repository',
      accountKey: getAccountKey(account),
      accountGeneration: 1,
      releaseId: release.id,
      releaseFingerprint: `release-${release.id}`,
      assetId: reviewedAsset?.id ?? null,
      assetFingerprint:
        reviewedAsset === null ? null : `asset-${reviewedAsset.id}`,
    }),
    createDraft: async () => draft,
    update: async () => draft,
    publish: async () => ({ ...draft, draft: false }),
    delete: async () => undefined,
    deleteAsset: async () => undefined,
    uploadAsset: async () => ({
      ok: true,
      asset,
      bytes: asset.sizeInBytes,
      localDigest: asset.digest!,
    }),
    downloadAsset: async () => ({
      ok: true,
      path: 'C:\\fixture\\downloads\\desktop.exe',
      bytes: asset.sizeInBytes,
      localDigest: asset.digest!,
      matchesGitHubDigest: true,
    }),
    ...overrides,
  } as unknown as GitHubReleasesStore
}

describe('GitHub Releases view', () => {
  it('browses bounded release and asset pages with accessible detail controls', async () => {
    const pages = new Array<number>()
    const store = fakeStore({
      list: async (_repository: Repository, page: number) => {
        pages.push(page)
        return {
          releases:
            page === 1
              ? [draft]
              : [{ ...draft, id: 8, tagName: 'v0.9.0', name: 'Earlier' }],
          page,
          nextPage: page === 1 ? 2 : null,
          capped: false,
        }
      },
    })
    render(
      <GitHubReleasesView
        repository={repository}
        accounts={[account]}
        releasesStore={store}
      />
    )

    await waitFor(() =>
      assert.ok(screen.getByRole('heading', { name: 'Desktop Material 1.0' }))
    )
    assert.ok(screen.getByRole('main', { name: 'GitHub Releases' }))
    assert.ok(screen.getByRole('heading', { name: 'Assets' }))
    assert.ok(screen.getByRole('button', { name: 'Download' }))
    assert.ok(screen.getByText(asset.digest!))
    fireEvent.click(screen.getByRole('button', { name: 'Load more releases' }))
    await waitFor(() => assert.ok(screen.getByText('Earlier')))
    assert.deepEqual(pages, [1, 2])
  })

  it('creates only an unpublished draft after an explicit metadata review', async () => {
    const created = new Array<Record<string, unknown>>()
    const store = fakeStore({
      createDraft: async (
        _repository: Repository,
        value: Record<string, unknown>
      ) => {
        created.push(value)
        return { ...draft, tagName: String(value.tagName) }
      },
    })
    render(
      <GitHubReleasesView
        repository={repository}
        accounts={[account]}
        releasesStore={store}
      />
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'New draft' }))
    )
    fireEvent.click(screen.getByRole('button', { name: 'New draft' }))
    fireEvent.change(screen.getByLabelText('Tag'), {
      target: { value: 'v2.0.0' },
    })
    fireEvent.change(screen.getByLabelText('Target branch or commit'), {
      target: { value: 'release/v2' },
    })
    fireEvent.change(screen.getByLabelText('Release name'), {
      target: { value: 'Desktop Material 2.0' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    assert.equal(created.length, 0)
    assert.ok(screen.getByRole('region', { name: 'Release review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }))
    await waitFor(() => assert.equal(created.length, 1))
    assert.equal(created[0].tagName, 'v2.0.0')
    assert.equal(created[0].targetCommitish, 'release/v2')
  })

  it('edits release metadata only after review and preserves completion status', async () => {
    const updates = new Array<Record<string, unknown>>()
    const store = fakeStore({
      update: async (
        _repository: Repository,
        _review: IGitHubReleaseMutationReview,
        value: Record<string, unknown>
      ) => {
        updates.push(value)
        return { ...draft, name: String(value.name) }
      },
    })
    render(
      <GitHubReleasesView
        repository={repository}
        accounts={[account]}
        releasesStore={store}
      />
    )
    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Edit' })))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Release name'), {
      target: { value: 'Reviewed release name' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    assert.equal(updates.length, 0)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => assert.equal(updates.length, 1))
    assert.equal(updates[0].releaseId, draft.id)
    assert.equal(updates[0].name, 'Reviewed release name')
    await waitFor(() => assert.ok(screen.getByText('Updated v1.0.0.')))
  })

  it('publishes and deletes only after purpose-specific confirmations', async () => {
    let publishes = 0
    let deletes = 0
    const store = fakeStore({
      publish: async () => {
        publishes++
        return { ...draft, draft: false }
      },
      delete: async () => {
        deletes++
      },
    })
    render(
      <GitHubReleasesView
        repository={repository}
        accounts={[account]}
        releasesStore={store}
      />
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Review publish' }))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review publish' }))
    assert.equal(publishes, 0)
    assert.ok(screen.getByRole('alertdialog', { name: 'Publish v1.0.0?' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Publish reviewed release' })
    )
    await waitFor(() => assert.equal(publishes, 1))

    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Review delete' }))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review delete' }))
    assert.equal(deletes, 0)
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => assert.equal(deletes, 1))
  })

  it('deletes an individual asset only after its destructive review', async () => {
    const deletedAssetIds = new Array<number>()
    const store = fakeStore({
      deleteAsset: async (
        _repository: Repository,
        review: IGitHubReleaseMutationReview
      ) => {
        deletedAssetIds.push(review.assetId!)
      },
    })
    render(
      <GitHubReleasesView
        repository={repository}
        accounts={[account]}
        releasesStore={store}
      />
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Delete' }))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    assert.deepEqual(deletedAssetIds, [])
    assert.ok(screen.getByRole('alertdialog', { name: 'Delete desktop.exe?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => assert.deepEqual(deletedAssetIds, [asset.id]))
    await waitFor(() =>
      assert.ok(screen.getByText('Deleted asset desktop.exe.'))
    )
  })

  it('reviews upload metadata and reveals a verified downloaded asset', async () => {
    const uploads = new Array<{
      path: string
      name: string
      label: string | null
    }>()
    const downloads = new Array<string>()
    const reveals = new Array<string>()
    const store = fakeStore({
      uploadAsset: async (
        _repository: Repository,
        _review: IGitHubReleaseMutationReview,
        path: string,
        name: string,
        label: string | null
      ) => {
        uploads.push({ path, name, label })
        return {
          ok: true,
          asset,
          bytes: asset.sizeInBytes,
          localDigest: asset.digest!,
        }
      },
      downloadAsset: async (
        _repository: Repository,
        _releaseId: number,
        _asset: IGitHubReleaseAsset,
        destination: string
      ) => {
        downloads.push(destination)
        return {
          ok: true,
          path: destination,
          bytes: asset.sizeInBytes,
          localDigest: asset.digest!,
          matchesGitHubDigest: true,
        }
      },
    })
    render(
      <GitHubReleasesView
        repository={repository}
        accounts={[account]}
        releasesStore={store}
        chooseUploadFile={async () => 'C:\\fixture\\build\\desktop.exe'}
        chooseDownloadDestination={async () =>
          'C:\\fixture\\downloads\\desktop.exe'
        }
        revealDownload={async path => {
          reveals.push(path)
        }}
      />
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Upload asset' }))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Upload asset' }))
    await waitFor(() => assert.ok(screen.getByLabelText('Asset name')))
    fireEvent.change(screen.getByLabelText('Optional label'), {
      target: { value: 'Reviewed Windows installer' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review upload' }))
    assert.equal(uploads.length, 0)
    assert.equal(screen.queryByText('C:\\fixture\\build\\desktop.exe'), null)
    const uploadButtons = screen.getAllByRole('button', {
      name: 'Upload asset',
    })
    fireEvent.click(uploadButtons[uploadButtons.length - 1])
    await waitFor(() => assert.equal(uploads.length, 1))
    assert.deepEqual(uploads[0], {
      path: 'C:\\fixture\\build\\desktop.exe',
      name: 'desktop.exe',
      label: 'Reviewed Windows installer',
    })
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Download' }))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => assert.equal(downloads.length, 1))
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }))
    await waitFor(() => assert.equal(reveals.length, 1))
    assert.equal(reveals[0], 'C:\\fixture\\downloads\\desktop.exe')
  })

  it('shows transfer progress and cancels an in-flight upload', async () => {
    let uploadWasCanceled = false
    const store = fakeStore({
      uploadAsset: async (
        _repository: Repository,
        _review: IGitHubReleaseMutationReview,
        _path: string,
        _name: string,
        _label: string | null,
        signal: AbortSignal,
        onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
      ) => {
        onProgress?.({
          operationId: 'fixture-upload',
          transferredBytes: 1024,
          totalBytes: 4096,
          direction: 'upload',
        })
        return await new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              uploadWasCanceled = true
              const error = new Error('canceled')
              error.name = 'AbortError'
              reject(error)
            },
            { once: true }
          )
        })
      },
    })
    render(
      <GitHubReleasesView
        repository={repository}
        accounts={[account]}
        releasesStore={store}
        chooseUploadFile={async () => 'C:\\fixture\\build\\desktop.exe'}
      />
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Upload asset' }))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Upload asset' }))
    await waitFor(() => assert.ok(screen.getByLabelText('Asset name')))
    fireEvent.click(screen.getByRole('button', { name: 'Review upload' }))
    const uploadButtons = screen.getAllByRole('button', {
      name: 'Upload asset',
    })
    fireEvent.click(uploadButtons[uploadButtons.length - 1])
    await waitFor(() =>
      assert.ok(
        screen.getByRole('progressbar', {
          name: 'Release asset upload progress',
        })
      )
    )
    const cancel = screen
      .getAllByRole('button', { name: 'Cancel' })
      .find(button => button.getAttribute('aria-disabled') !== 'true')
    assert.ok(cancel)
    fireEvent.click(cancel)
    await waitFor(() => assert.equal(uploadWasCanceled, true))
    await waitFor(() =>
      assert.ok(screen.getByText('Release asset upload canceled.'))
    )
    assert.equal(screen.queryByRole('progressbar'), null)
  })

  it('aborts and ignores a stale release page after the repository changes', async () => {
    type ReleasePage = {
      readonly releases: ReadonlyArray<IGitHubRelease>
      readonly page: number
      readonly nextPage: number | null
      readonly capped: boolean
    }
    let resolveStale!: (page: ReleasePage) => void
    const stalePage = new Promise<ReleasePage>(resolve => {
      resolveStale = resolve
    })
    let staleRequestStarted = false
    let staleRequestAborted = false
    const currentRelease = {
      ...draft,
      id: 88,
      tagName: 'v-current',
      name: 'Current repository release',
    }
    const otherRemote = new GitHubRepository(
      'current',
      new Owner('desktop', 'https://api.github.com', 1),
      2
    )
    const otherRepository = new Repository(
      'C:\\fixture\\current',
      2,
      otherRemote,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(account)
    )
    const store = fakeStore({
      list: async (
        selectedRepository: Repository,
        page: number,
        signal: AbortSignal
      ) => {
        if (selectedRepository.id === repository.id) {
          staleRequestStarted = true
          signal.addEventListener(
            'abort',
            () => {
              staleRequestAborted = true
            },
            { once: true }
          )
          return await stalePage
        }
        return {
          releases: [currentRelease],
          page,
          nextPage: null,
          capped: false,
        }
      },
    })
    const accounts = [account]
    const result = render(
      <GitHubReleasesView
        repository={repository}
        accounts={accounts}
        releasesStore={store}
      />
    )
    await waitFor(() => assert.equal(staleRequestStarted, true))
    result.rerender(
      <GitHubReleasesView
        repository={otherRepository}
        accounts={accounts}
        releasesStore={store}
      />
    )
    await waitFor(() =>
      assert.ok(
        screen.getByRole('heading', { name: 'Current repository release' })
      )
    )
    assert.equal(staleRequestAborted, true)
    resolveStale({
      releases: [{ ...draft, name: 'Stale repository release' }],
      page: 1,
      nextPage: null,
      capped: false,
    })
    await stalePage
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(screen.queryByText('Stale repository release'), null)
    assert.ok(
      screen.getByRole('heading', { name: 'Current repository release' })
    )
  })

  it('shows unsupported GitHub Enterprise without invoking the store', () => {
    const endpoint = 'https://unsupported.fixture/api/v3'
    updateEndpointVersion(endpoint, '3.0.0')
    const unsupportedAccount = new Account(
      'fixture-enterprise',
      endpoint,
      'fixture-token',
      [],
      '',
      91,
      'Fixture Enterprise'
    )
    const unsupportedRepository = new Repository(
      'C:\\fixture\\enterprise',
      91,
      new GitHubRepository(
        'enterprise',
        new Owner('desktop', endpoint, 91),
        91
      ),
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(unsupportedAccount)
    )
    let calls = 0
    const store = fakeStore({
      list: async () => {
        calls++
        throw new Error('should not run')
      },
    })
    render(
      <GitHubReleasesView
        repository={unsupportedRepository}
        accounts={[unsupportedAccount]}
        releasesStore={store}
      />
    )
    assert.ok(screen.getByRole('heading', { name: 'Releases are unavailable' }))
    assert.equal(calls, 0)
  })

  it('shows a complete signed-out state without invoking the store', () => {
    let calls = 0
    const store = fakeStore({
      list: async () => {
        calls++
        throw new Error('should not run')
      },
    })
    render(
      <GitHubReleasesView
        repository={repository}
        accounts={[]}
        releasesStore={store}
      />
    )
    assert.ok(
      screen.getByRole('heading', { name: 'Sign in to manage Releases' })
    )
    assert.match(
      screen.getByText(/No other signed-in account/).textContent ?? '',
      /implicitly/
    )
    assert.equal(calls, 0)
  })
})
