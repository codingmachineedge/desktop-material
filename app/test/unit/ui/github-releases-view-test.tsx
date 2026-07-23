import assert from 'node:assert'
import { describe, it } from 'node:test'
import { resolve } from 'node:path'
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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'

const repositoryPath = resolve('release-fixtures', 'material')
const uploadAssetPath = resolve('release-fixtures', 'build', 'desktop.exe')
const downloadAssetPath = resolve(
  'release-fixtures',
  'downloads',
  'desktop.exe'
)

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
  repositoryPath,
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
    create: async () => draft,
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
      path: downloadAssetPath,
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

  it('shows incomplete assets as processing and blocks their download', async () => {
    const starter = { ...asset, state: 'starter' }
    let downloads = 0
    const store = fakeStore({
      listAssets: async () => ({
        assets: [starter],
        page: 1,
        nextPage: null,
        capped: false,
      }),
      downloadAsset: async () => {
        downloads++
        throw new Error('unexpected incomplete download')
      },
    })
    render(
      <GitHubReleasesView
        repository={repository}
        accounts={[account]}
        releasesStore={store}
      />
    )

    await waitFor(() => assert.ok(screen.getByText('Processing')))
    const download = screen.getByRole('button', { name: 'Download' })
    assert.equal(download.getAttribute('aria-disabled'), 'true')
    assert.equal(
      screen
        .getByRole('button', { name: 'Delete' })
        .getAttribute('aria-disabled'),
      null
    )
    assert.equal(downloads, 0)
  })

  it('summarizes, filters, and exposes rich metadata for loaded releases', async () => {
    const stable = {
      ...draft,
      id: 8,
      tagName: 'v0.9.0',
      name: 'Stable Material',
      draft: false,
      publishedAt: new Date('2026-07-12T12:00:00Z'),
      authorLogin: 'release-bot',
    }
    const preview = {
      ...draft,
      id: 9,
      tagName: 'v1.1.0-beta.1',
      name: 'Material Preview',
      body: 'Preview channel notes',
      draft: false,
      prerelease: true,
      publishedAt: new Date('2026-07-13T08:00:00Z'),
      assets: [],
    }
    const linkedRemote = new GitHubRepository(
      'material',
      new Owner('desktop', 'https://api.github.com', 1),
      1,
      false,
      'https://github.com/desktop/material'
    )
    const linkedRepository = new Repository(
      repositoryPath,
      1,
      linkedRemote,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(account)
    )
    const store = fakeStore({
      list: async () => ({
        releases: [draft, preview, stable],
        page: 1,
        nextPage: null,
        capped: false,
      }),
    })
    render(
      <GitHubReleasesView
        repository={linkedRepository}
        accounts={[account]}
        releasesStore={store}
      />
    )

    await waitFor(() =>
      assert.ok(screen.getByRole('heading', { name: 'Desktop Material 1.0' }))
    )
    assert.equal(
      screen.queryByText(/Filtering \d+ of \d+ loaded releases/),
      null
    )
    const summary = screen.getByRole('region', {
      name: 'Loaded release summary',
    })
    assert.ok(within(summary).getByText('v0.9.0'))
    assert.match(
      within(summary).getByText('Published').closest('article')?.textContent ??
        '',
      /Published1Stable releases/
    )
    assert.match(
      within(summary).getByText('Pre-releases').closest('article')
        ?.textContent ?? '',
      /Pre-releases1Published previews/
    )

    fireEvent.click(screen.getByRole('button', { name: /Stable Material/ }))
    await waitFor(() =>
      assert.ok(screen.getByRole('heading', { name: 'Stable Material' }))
    )
    const metadata = screen.getByLabelText('Release metadata')
    assert.match(metadata.textContent ?? '', /StatusPublished/)
    assert.match(metadata.textContent ?? '', /Author@release-bot/)
    assert.match(metadata.textContent ?? '', /Loaded assets1 · 3 downloads/)
    assert.ok(screen.getByText('application/octet-stream'))
    const timestamps = [...document.querySelectorAll('time')]
    assert.ok(timestamps.length >= 6)
    for (const timestamp of timestamps) {
      assert.match(timestamp.textContent ?? '', /\b\d{2}:\d{2}\b/)
      assert.ok(timestamp.getAttribute('datetime')?.endsWith('Z'))
    }
    assert.equal(
      screen
        .getByRole('link', { name: 'Open release page' })
        .getAttribute('href'),
      'https://github.com/desktop/material/releases/tag/v0.9.0'
    )

    fireEvent.change(screen.getByLabelText('Search loaded releases'), {
      target: { value: 'Preview' },
    })
    assert.ok(screen.getByText('Filtering 1 of 3 loaded releases'))
    assert.ok(screen.getByRole('button', { name: /Material Preview/ }))
    assert.equal(
      screen.queryByRole('button', { name: /Stable Material/ }),
      null
    )
    await waitFor(() =>
      assert.ok(
        screen.getByRole('heading', { name: 'Select or create a release' })
      )
    )
    assert.equal(screen.queryByRole('button', { name: 'Review delete' }), null)

    fireEvent.click(screen.getByRole('button', { name: /Material Preview/ }))
    await waitFor(() =>
      assert.ok(screen.getByRole('heading', { name: 'Material Preview' }))
    )

    fireEvent.change(screen.getByLabelText('Search loaded releases'), {
      target: { value: '' },
    })
    assert.equal(
      screen.queryByText(/Filtering \d+ of \d+ loaded releases/),
      null
    )
    fireEvent.change(screen.getByLabelText('Release status'), {
      target: { value: 'draft' },
    })
    assert.ok(screen.getByText('Filtering 1 of 3 loaded releases'))
    assert.ok(screen.getByRole('button', { name: /Desktop Material 1.0/ }))
    assert.equal(
      screen.queryByRole('button', { name: /Material Preview/ }),
      null
    )
    await waitFor(() =>
      assert.ok(
        screen.getByRole('heading', { name: 'Select or create a release' })
      )
    )
  })

  it('shows loading and a retryable provider error before recovering', async () => {
    let rejectInitial!: (error: Error) => void
    const initialRequest = new Promise<never>((_resolve, reject) => {
      rejectInitial = reject
    })
    let calls = 0
    const store = fakeStore({
      list: async () => {
        calls++
        if (calls === 1) {
          return await initialRequest
        }
        return {
          releases: [draft],
          page: 1,
          nextPage: null,
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
      assert.ok(screen.getAllByText('Loading releases…').length >= 1)
    )
    rejectInitial(new Error('Provider temporarily unavailable'))
    await waitFor(() =>
      assert.ok(screen.getByRole('alert').textContent?.includes('temporarily'))
    )
    assert.ok(screen.getByText('Releases could not be loaded'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry releases' }))
    await waitFor(() =>
      assert.ok(screen.getByRole('heading', { name: 'Desktop Material 1.0' }))
    )
    assert.equal(calls, 2)
  })

  it('distinguishes a loaded repository with no releases', async () => {
    const store = fakeStore({
      list: async () => ({
        releases: [],
        page: 1,
        nextPage: null,
        capped: false,
      }),
    })
    render(
      <GitHubReleasesView
        repository={repository}
        accounts={[account]}
        releasesStore={store}
      />
    )

    await waitFor(() => assert.ok(screen.getByText('No releases yet')))
    assert.ok(
      screen.getByText(
        'Create a public release or save an unpublished draft to start.'
      )
    )
    assert.equal(
      screen.queryByRole('region', { name: 'Loaded release summary' }),
      null
    )
  })

  it('creates a public release by default after an explicit metadata review', async () => {
    const created = new Array<Record<string, unknown>>()
    const store = fakeStore({
      create: async (
        _repository: Repository,
        value: Record<string, unknown>,
        publishImmediately: boolean
      ) => {
        created.push({ ...value, publishImmediately })
        return {
          ...draft,
          tagName: String(value.tagName),
          draft: !publishImmediately,
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
      assert.ok(screen.getByRole('button', { name: 'New release' }))
    )
    fireEvent.click(screen.getByRole('button', { name: 'New release' }))
    fireEvent.change(screen.getByLabelText('Tag'), {
      target: { value: 'v2.0.0' },
    })
    fireEvent.change(screen.getByLabelText('Target branch or commit'), {
      target: { value: 'release/v2' },
    })
    fireEvent.change(screen.getByLabelText('Release name'), {
      target: { value: 'Desktop Material 2.0' },
    })
    assert.equal(
      screen.getByLabelText<HTMLInputElement>('Publish immediately').checked,
      true
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    assert.equal(created.length, 0)
    assert.ok(screen.getByRole('region', { name: 'Release review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish release' }))
    await waitFor(() => assert.equal(created.length, 1))
    assert.equal(created[0].tagName, 'v2.0.0')
    assert.equal(created[0].targetCommitish, 'release/v2')
    assert.equal(created[0].publishImmediately, true)
    await waitFor(() => assert.ok(screen.getByText('Published v2.0.0.')))
  })

  it('still creates an unpublished draft when publish immediately is off', async () => {
    const publicationChoices = new Array<boolean>()
    const store = fakeStore({
      create: async (
        _repository: Repository,
        _value: Record<string, unknown>,
        publishImmediately: boolean
      ) => {
        publicationChoices.push(publishImmediately)
        return draft
      },
    })
    render(
      <GitHubReleasesView
        repository={repository}
        accounts={[account]}
        releasesStore={store}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'New release' }))
    fireEvent.change(screen.getByLabelText('Tag'), {
      target: { value: 'v2.1.0' },
    })
    fireEvent.click(screen.getByLabelText('Publish immediately'))
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }))
    await waitFor(() => assert.deepEqual(publicationChoices, [false]))
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

  it('reviews exact bulk selections before publishing drafts or deleting releases', async () => {
    const stable = {
      ...draft,
      id: 8,
      tagName: 'v0.9.0',
      name: 'Stable Material',
      draft: false,
    }
    const published = new Array<number>()
    const deleted = new Array<number>()
    const store = fakeStore({
      list: async () => ({
        releases: [draft, stable],
        page: 1,
        nextPage: null,
        capped: false,
      }),
      publish: async (
        _repository: Repository,
        review: IGitHubReleaseMutationReview
      ) => {
        published.push(review.releaseId)
        return { ...draft, draft: false }
      },
      delete: async (
        _repository: Repository,
        review: IGitHubReleaseMutationReview
      ) => {
        deleted.push(review.releaseId)
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
      assert.ok(screen.getByLabelText('Select all visible releases'))
    )
    assert.equal(
      screen.queryByRole('button', { name: 'Publish drafts (1)' }),
      null
    )
    assert.equal(
      screen.queryByRole('button', { name: 'Delete selected (2)' }),
      null
    )
    assert.equal(
      screen.queryByRole('button', { name: 'Clear selection' }),
      null
    )
    const selectAllVisible = screen.getByLabelText(
      'Select all visible releases'
    )
    fireEvent.click(selectAllVisible)
    assert.ok(screen.getByText('2 selected'))
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    assert.equal(document.activeElement, selectAllVisible)
    assert.ok(screen.getByText('0 selected'))
    fireEvent.click(selectAllVisible)
    fireEvent.click(screen.getByRole('button', { name: 'Publish drafts (1)' }))
    assert.deepEqual(published, [])
    const publishDialog = screen.getByRole('alertdialog', {
      name: 'Publish 1 selected release?',
    })
    assert.ok(within(publishDialog).getByText('v1.0.0'))
    assert.equal(within(publishDialog).queryByText('v0.9.0'), null)
    fireEvent.click(
      within(publishDialog).getByRole('button', {
        name: 'Publish reviewed drafts',
      })
    )
    await waitFor(() => assert.deepEqual(published, [draft.id]))

    fireEvent.click(screen.getByLabelText('Select all visible releases'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (2)' }))
    assert.deepEqual(deleted, [])
    const deleteDialog = screen.getByRole('alertdialog', {
      name: 'Delete 2 selected releases?',
    })
    assert.ok(within(deleteDialog).getByText('v1.0.0'))
    assert.ok(within(deleteDialog).getByText('v0.9.0'))
    fireEvent.click(
      within(deleteDialog).getByRole('button', {
        name: 'Delete reviewed releases',
      })
    )
    await waitFor(() => assert.deepEqual(deleted, [draft.id, stable.id]))
  })

  it('focuses an enabled fallback after clearing a filtered-out selection', async () => {
    const store = fakeStore({
      list: async () => ({
        releases: [draft],
        page: 1,
        nextPage: null,
        capped: false,
      }),
    })
    render(
      <GitHubReleasesView
        repository={repository}
        accounts={[account]}
        releasesStore={store}
      />
    )

    const releaseSelection = await screen.findByLabelText(
      'Select release v1.0.0'
    )
    fireEvent.click(releaseSelection)
    const search = screen.getByLabelText('Search loaded releases')
    fireEvent.change(search, { target: { value: 'no matching release' } })

    const selectAllVisible = screen.getByLabelText(
      'Select all visible releases'
    ) as HTMLInputElement
    assert.equal(selectAllVisible.disabled, true)
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))

    assert.equal(document.activeElement, search)
    assert.ok(screen.getByText('0 selected'))
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
    const opens = new Array<string>()
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
        chooseUploadFile={async () => uploadAssetPath}
        chooseDownloadDestination={async () => downloadAssetPath}
        revealDownload={async path => {
          reveals.push(path)
        }}
        openDownload={async path => {
          opens.push(path)
          return ''
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
    assert.equal(screen.queryByText(uploadAssetPath), null)
    const uploadButtons = screen.getAllByRole('button', {
      name: 'Upload asset',
    })
    fireEvent.click(uploadButtons[uploadButtons.length - 1])
    await waitFor(() => assert.equal(uploads.length, 1))
    assert.deepEqual(uploads[0], {
      path: uploadAssetPath,
      name: 'desktop.exe',
      label: 'Reviewed Windows installer',
    })
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Download' }))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await waitFor(() => assert.equal(downloads.length, 1))
    fireEvent.click(screen.getByRole('button', { name: 'Open file' }))
    await waitFor(() => assert.equal(opens.length, 1))
    assert.equal(opens[0], downloadAssetPath)
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }))
    await waitFor(() => assert.equal(reveals.length, 1))
    assert.equal(reveals[0], downloadAssetPath)
  })

  it('reports an actionable error when Windows cannot open a download', async () => {
    let openAttempts = 0
    render(
      <GitHubReleasesView
        repository={repository}
        accounts={[account]}
        releasesStore={fakeStore()}
        chooseDownloadDestination={async () => downloadAssetPath}
        openDownload={async () =>
          openAttempts++ === 0
            ? 'No application is associated with this file type'
            : ''
        }
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Download' }))
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Open file' }))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open file' }))

    await waitFor(() => {
      const alert = screen.getByRole('alert').textContent ?? ''
      assert.match(
        alert,
        /Check that Windows has an app associated with this file type/
      )
      assert.match(alert, /No application is associated/)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open file' }))
    await waitFor(() => assert.equal(screen.queryByRole('alert'), null))
  })

  it('ignores a late Open file failure after the view is disposed', async () => {
    let finishOpen: (result: string) => void = () => undefined
    const component = new GitHubReleasesView({
      repository,
      accounts: [account],
      releasesStore: fakeStore(),
      openDownload: () =>
        new Promise<string>(resolveOpen => {
          finishOpen = resolveOpen
        }),
    }) as unknown as {
      mounted: boolean
      state: {
        completedDownload: {
          path: string
          assetName: string
          localDigest: string
          matchesGitHubDigest: boolean | null
        } | null
        error: string | null
      }
      setState: (update: Record<string, unknown>) => void
      openDownload: () => Promise<void>
    }
    Object.assign(component.state, {
      completedDownload: {
        path: downloadAssetPath,
        assetName: asset.name,
        localDigest: `sha256:${'b'.repeat(64)}`,
        matchesGitHubDigest: true,
      },
    })
    component.mounted = true
    component.setState = update => Object.assign(component.state, update)

    const opening = component.openDownload()
    component.mounted = false
    finishOpen('late Windows association failure')
    await opening

    assert.equal(component.state.error, null)
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
        chooseUploadFile={async () => uploadAssetPath}
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
      resolve('release-fixtures', 'current'),
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
      resolve('release-fixtures', 'enterprise'),
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
