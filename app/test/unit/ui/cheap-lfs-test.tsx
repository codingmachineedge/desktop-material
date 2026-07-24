import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'node:path'
import * as React from 'react'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import { CheapLfs, ICheapLfsDispatcher } from '../../../src/ui/repository-tools'
import {
  ICheapLfsBatchMaterializeResult,
  ICheapLfsMaterializeResult,
  ICheapLfsManagedPointerEntry,
  ICheapLfsPinOptions,
  ICheapLfsPinResult,
} from '../../../src/lib/cheap-lfs/operations'
import {
  CHEAP_LFS_POINTER_VERSION,
  ICheapLfsPointer,
} from '../../../src/lib/cheap-lfs/pointer'
import {
  CHEAP_LFS_OCI_POINTER_VERSION,
  ICheapLfsGhcrPointer,
} from '../../../src/lib/cheap-lfs/ghcr-pointer'
import { IGitHubReleaseAsset } from '../../../src/lib/github-releases'
import { IGitHubReleaseTransferProgressEvent } from '../../../src/lib/github-release-transfer'
import {
  defaultBuildRunPreferences,
  IBuildRunPreferences,
} from '../../../src/models/build-run-preferences'
import { getCheapLfsCloudCompressionPolicy } from '../../../src/lib/cheap-lfs/cloud-compression'
import { Popup, PopupType } from '../../../src/models/popup'
import { RepositorySettingsTab } from '../../../src/ui/repository-settings/repository-settings'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'

const gitHubRepository = new GitHubRepository(
  'material',
  new Owner('desktop', 'https://api.github.com', 1),
  1
)
// Build the repository path with the running platform's separators so the
// panel's Path.relative/basename default-path logic behaves identically on
// Windows and POSIX CI runners.
const repoPath = Path.resolve('work', 'material')
const pickedFile = (name: string) => Path.join(repoPath, name)
const repository = new Repository(repoPath, 1, gitHubRepository, false)

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

function repositoryWithVisibility(
  isPrivate: boolean,
  id: number = 1,
  path: string = repoPath,
  preferences: IBuildRunPreferences = defaultBuildRunPreferences
): Repository {
  return new Repository(
    path,
    id,
    new GitHubRepository(
      'material',
      new Owner('desktop', 'https://api.github.com', 1),
      id,
      isPrivate
    ),
    false,
    null,
    {},
    false,
    undefined,
    null,
    preferences
  )
}

function pointerEntry(
  relativePath: string,
  overrides: Partial<ICheapLfsPointer>
): ICheapLfsManagedPointerEntry {
  return {
    kind: 'release',
    provider: 'release',
    relativePath,
    workingTreeState: 'pointer',
    pointer: {
      version: CHEAP_LFS_POINTER_VERSION,
      releaseTag: 'assets',
      assetName: 'asset.bin',
      sizeInBytes: 1024,
      sha256: 'a'.repeat(64),
      ...overrides,
    },
  }
}

function ociPointerEntry(
  relativePath: string,
  overrides: Partial<ICheapLfsGhcrPointer> = {},
  workingTreeState: ICheapLfsManagedPointerEntry['workingTreeState'] = 'pointer'
): ICheapLfsManagedPointerEntry {
  return {
    kind: 'oci',
    provider: 'ghcr',
    relativePath,
    workingTreeState,
    pointer: {
      version: CHEAP_LFS_OCI_POINTER_VERSION,
      image: `ghcr.io/desktop/material@sha256:${'d'.repeat(64)}`,
      object: `sha256:${'e'.repeat(64)}`,
      sizeInBytes: 3 * 1024 * 1024,
      layers: [`sha256:${'f'.repeat(64)}`],
      ...overrides,
    },
  }
}

const pointers: ReadonlyArray<ICheapLfsManagedPointerEntry> = [
  pointerEntry('assets/logo.psd', {
    releaseTag: 'assets',
    assetName: 'logo.psd',
    sizeInBytes: 5 * 1024 * 1024,
  }),
  pointerEntry('docs/diagram.png', {
    releaseTag: 'v1',
    assetName: 'diagram.png',
    sizeInBytes: 2048,
    sha256: 'b'.repeat(64),
  }),
]

const uploadedAsset: IGitHubReleaseAsset = {
  id: 7,
  name: 'big.psd',
  label: null,
  state: 'uploaded',
  contentType: 'application/octet-stream',
  sizeInBytes: 5,
  downloadCount: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  digest: null,
}

class FakeCheapLfsDispatcher implements ICheapLfsDispatcher {
  public pointers: ReadonlyArray<ICheapLfsManagedPointerEntry>
  public readonly pinCalls: ICheapLfsPinOptions[] = []
  public readonly materializeCalls: string[] = []
  public readonly materializeAllCalls = new Array<{
    readonly signal: AbortSignal | undefined
    readonly onProgress:
      | ((progress: IGitHubReleaseTransferProgressEvent) => void)
      | undefined
  }>()
  public readonly cancelMaterializeCalls: Array<AbortSignal | undefined> = []
  public readonly removeCalls: string[] = []
  public readonly popupCalls: Popup[] = []
  public materializeAllGate: Promise<void> = Promise.resolve()
  public materializeAllResult: ICheapLfsBatchMaterializeResult = {
    materialized: [],
    failures: [],
    totalBytes: 0,
    canceled: false,
  }
  /** When set, materializeAllCheapLfsPointers rejects with this after the gate. */
  public materializeAllRejectWith: Error | null = null
  public listCalls = 0

  public constructor(initial: ReadonlyArray<ICheapLfsManagedPointerEntry>) {
    this.pointers = initial
  }

  public listCheapLfsPointers = async (_repository: Repository) => {
    this.listCalls++
    return this.pointers
  }

  public showPopup = async (popup: Popup): Promise<void> => {
    this.popupCalls.push(popup)
  }

  public pinFileToRelease = async (
    _repository: Repository,
    options: ICheapLfsPinOptions
  ): Promise<ICheapLfsPinResult> => {
    this.pinCalls.push(options)
    return {
      pointer: {
        version: CHEAP_LFS_POINTER_VERSION,
        releaseTag: options.releaseTag,
        assetName: uploadedAsset.name,
        sizeInBytes: uploadedAsset.sizeInBytes,
        sha256: 'c'.repeat(64),
      },
      asset: uploadedAsset,
      releaseId: 1,
    }
  }

  public materializePointer = async (
    _repository: Repository,
    trackedRelativePath: string
  ): Promise<ICheapLfsMaterializeResult> => {
    this.materializeCalls.push(trackedRelativePath)
    return { path: trackedRelativePath, bytes: 10 }
  }

  public materializeAllCheapLfsPointers = async (
    _repository: Repository,
    signal?: AbortSignal,
    onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
  ): Promise<ICheapLfsBatchMaterializeResult> => {
    this.materializeAllCalls.push({ signal, onProgress })
    onProgress?.({
      operationId: 'materialize-all-test',
      direction: 'download',
      transferredBytes: 5,
      totalBytes: 10,
    })
    await this.materializeAllGate
    if (this.materializeAllRejectWith !== null) {
      throw this.materializeAllRejectWith
    }
    return this.materializeAllResult
  }

  public cancelAutoMaterializeCheapLfs = (
    _repository: Repository,
    requestSignal?: AbortSignal
  ): void => {
    this.cancelMaterializeCalls.push(requestSignal)
  }

  public removeCheapLfsPointer = async (
    _repository: Repository,
    trackedRelativePath: string
  ): Promise<void> => {
    this.removeCalls.push(trackedRelativePath)
  }
}

class CloudCheapLfsDispatcher extends FakeCheapLfsDispatcher {
  public readonly preferenceCalls = new Array<IBuildRunPreferences>()
  public readonly ensureCalls = new Array<{
    readonly repository: Repository
    readonly preferences: IBuildRunPreferences
  }>()

  public async updateRepositoryBuildRunPreferences(
    repository: Repository,
    preferences: IBuildRunPreferences
  ) {
    this.preferenceCalls.push(preferences)
    return await this.ensureCheapLfsCloudCompressionWorkflow(
      repository,
      preferences
    )
  }

  public async ensureCheapLfsCloudCompressionWorkflow(
    target: Repository,
    preferences: IBuildRunPreferences
  ) {
    this.ensureCalls.push({ repository: target, preferences })
    const policy = getCheapLfsCloudCompressionPolicy(target, preferences)
    return {
      path: Path.join(target.path, '.github', 'workflows', 'cheap-lfs.yml'),
      changed: policy === 'automatic-public' || policy === 'enabled-private',
      policy,
    }
  }
}

class DeferredCloudCheapLfsDispatcher extends CloudCheapLfsDispatcher {
  private readonly updateGate = deferred<void>()

  public releasePreferenceUpdate() {
    this.updateGate.resolve()
  }

  public async updateRepositoryBuildRunPreferences(
    repository: Repository,
    preferences: IBuildRunPreferences
  ) {
    this.preferenceCalls.push(preferences)
    await this.updateGate.promise
    return await this.ensureCheapLfsCloudCompressionWorkflow(
      repository,
      preferences
    )
  }
}

class FailingCloudCheapLfsDispatcher extends CloudCheapLfsDispatcher {
  private readonly updateGate = deferred<void>()

  public releasePreferenceUpdate() {
    this.updateGate.resolve()
  }

  public async updateRepositoryBuildRunPreferences(
    repository: Repository,
    preferences: IBuildRunPreferences
  ): Promise<never> {
    this.preferenceCalls.push(preferences)
    await this.updateGate.promise
    this.ensureCalls.push({ repository, preferences })
    throw new Error('Workflow creation failed after persistence.')
  }
}

function rowFor(path: string): HTMLElement {
  const row = Array.from(
    document.querySelectorAll<HTMLElement>('.cheap-lfs-row')
  ).find(
    candidate =>
      candidate.querySelector('.cheap-lfs-row-path')?.textContent === path
  )
  assert.ok(row, `Expected a pinned-file row for ${path}`)
  return row
}

describe('CheapLfs panel', () => {
  it('identifies itself as the manager without requiring Releases browsing', async () => {
    const dispatcher = new FakeCheapLfsDispatcher([])
    render(
      <CheapLfs repository={repository} accounts={[]} dispatcher={dispatcher} />
    )
    assert.ok(await screen.findByText('Cheap LFS manager'))
    assert.ok(screen.getByText(/do not need to browse GitHub Releases/i))
  })

  it('opens the Cheap LFS settings directly on Build & run', async () => {
    const dispatcher = new FakeCheapLfsDispatcher([])
    render(
      <CheapLfs repository={repository} accounts={[]} dispatcher={dispatcher} />
    )
    await screen.findByText('Cheap LFS manager')

    fireEvent.click(
      screen.getByRole('button', { name: 'Open Cheap LFS settings' })
    )

    assert.equal(dispatcher.popupCalls.length, 1)
    const popup = dispatcher.popupCalls[0]
    if (popup.type !== PopupType.RepositorySettings) {
      assert.fail(`Expected Repository settings, got ${popup.type}`)
    }
    assert.equal(popup.repository, repository)
    assert.equal(popup.initialSelectedTab, RepositorySettingsTab.BuildRun)
  })

  it('lists committed pointers with path, tag, asset, and size', async () => {
    const dispatcher = new FakeCheapLfsDispatcher(pointers)
    render(
      <CheapLfs repository={repository} accounts={[]} dispatcher={dispatcher} />
    )

    await screen.findByText('assets/logo.psd')
    const logoRow = rowFor('assets/logo.psd')
    assert.match(
      logoRow.querySelector('.cheap-lfs-row-meta')?.textContent ?? '',
      /assets · logo\.psd/
    )
    assert.match(
      logoRow.querySelector('.cheap-lfs-row-size')?.textContent ?? '',
      /5\.0 MiB/
    )
    assert.ok(screen.getByText('docs/diagram.png'))
  })

  it('labels an OCI pointer and republishes the logical image on removal', async () => {
    const dispatcher = new FakeCheapLfsDispatcher([
      ociPointerEntry('models/weights.bin'),
    ])
    const originalConfirm = window.confirm
    window.confirm = () => true
    try {
      render(
        <CheapLfs
          repository={repository}
          accounts={[]}
          dispatcher={dispatcher}
        />
      )

      await screen.findByText('models/weights.bin')
      const row = rowFor('models/weights.bin')
      assert.match(
        row.querySelector('.cheap-lfs-row-meta')?.textContent ?? '',
        /GHCR · one OCI image · ghcr\.io\/desktop\/material@sha256:/
      )
      fireEvent.click(
        within(row).getByRole('button', { name: 'Remove from image' })
      )
      await waitFor(() =>
        assert.deepStrictEqual(dispatcher.removeCalls, ['models/weights.bin'])
      )
    } finally {
      window.confirm = originalConfirm
    }
  })

  it('shows a verified materialized entry without offering another download', async () => {
    const dispatcher = new FakeCheapLfsDispatcher([
      ociPointerEntry('models/local.bin', {}, 'materialized'),
    ])
    render(
      <CheapLfs repository={repository} accounts={[]} dispatcher={dispatcher} />
    )
    await screen.findByText('models/local.bin')
    const row = rowFor('models/local.bin')
    assert.ok(
      within(row).getByText(
        'Materialized locally · verified against the committed pointer'
      )
    )
    assert.equal(
      within(row)
        .getByRole('button', { name: 'Already materialized' })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.ok(within(row).getByRole('button', { name: 'Remove from image' }))
  })

  it('shows mixed cloud-compression state without hiding raw objects', async () => {
    const dispatcher = new FakeCheapLfsDispatcher([
      pointerEntry('mixed.bin', {
        sizeInBytes: 1000,
        parts: [
          { name: 'mixed.part1', sizeInBytes: 500, sha256: 'd'.repeat(64) },
          {
            name: 'mixed.part2.deflate',
            sizeInBytes: 500,
            sha256: 'e'.repeat(64),
            deflatedSizeInBytes: 100,
          },
        ],
      }),
    ])
    render(
      <CheapLfs repository={repository} accounts={[]} dispatcher={dispatcher} />
    )

    await screen.findByText('mixed.bin')
    assert.ok(screen.getByText(/Mixed · 1\/2 objects compressed/i))
  })

  it('sets up cloud compression automatically for a public repository', async () => {
    const dispatcher = new CloudCheapLfsDispatcher([])
    render(
      <CheapLfs
        repository={repositoryWithVisibility(false)}
        accounts={[]}
        dispatcher={dispatcher}
      />
    )

    assert.ok(await screen.findByText(/automatic for public repositories/i))
    assert.ok(screen.getByText(/Desktop Material downloads and decompresses/i))
    await waitFor(() => assert.equal(dispatcher.ensureCalls.length, 1))
    assert.equal(dispatcher.preferenceCalls.length, 0)
  })

  it('does not manage the workflow after an unrelated preference rerender', async () => {
    const dispatcher = new CloudCheapLfsDispatcher([])
    const initialRepository = repositoryWithVisibility(
      false,
      21,
      Path.resolve('work', 'public-preferences')
    )
    const view = render(
      <CheapLfs
        repository={initialRepository}
        accounts={[]}
        dispatcher={dispatcher}
      />
    )

    await waitFor(() => assert.equal(dispatcher.ensureCalls.length, 1))
    view.rerender(
      <CheapLfs
        repository={repositoryWithVisibility(
          false,
          initialRepository.id,
          initialRepository.path,
          { ...defaultBuildRunPreferences, elevated: true }
        )}
        accounts={[]}
        dispatcher={dispatcher}
      />
    )

    await Promise.resolve()
    assert.equal(dispatcher.ensureCalls.length, 1)
  })

  it('requires a UI opt-in before private cloud compression is enabled', async () => {
    const dispatcher = new CloudCheapLfsDispatcher([])
    render(
      <CheapLfs
        repository={repositoryWithVisibility(true)}
        accounts={[]}
        dispatcher={dispatcher}
      />
    )

    const checkbox = await screen.findByRole<HTMLInputElement>('checkbox', {
      name: /enable cloud compression for this private repository/i,
    })
    assert.equal(checkbox.checked, false)
    fireEvent.click(checkbox)

    await waitFor(() => assert.equal(dispatcher.preferenceCalls.length, 1))
    assert.equal(dispatcher.preferenceCalls[0].cheapLfsCloudCompression, true)
    await waitFor(() => assert.equal(dispatcher.ensureCalls.length, 2))
    assert.equal(
      dispatcher.ensureCalls[1].preferences.cheapLfsCloudCompression,
      true
    )
    assert.ok(await screen.findByText(/workflow added to Changes/i))
  })

  it('keeps a persisted private opt-in when workflow setup fails', async () => {
    const dispatcher = new FailingCloudCheapLfsDispatcher([])
    const initialRepository = repositoryWithVisibility(
      true,
      31,
      Path.resolve('work', 'private-failure')
    )
    const view = render(
      <CheapLfs
        repository={initialRepository}
        accounts={[]}
        dispatcher={dispatcher}
      />
    )

    const checkbox = await screen.findByRole<HTMLInputElement>('checkbox', {
      name: /enable cloud compression for this private repository/i,
    })
    fireEvent.click(checkbox)
    await waitFor(() => assert.equal(dispatcher.preferenceCalls.length, 1))

    view.rerender(
      <CheapLfs
        repository={repositoryWithVisibility(
          true,
          initialRepository.id,
          initialRepository.path,
          {
            ...defaultBuildRunPreferences,
            cheapLfsCloudCompression: true,
          }
        )}
        accounts={[]}
        dispatcher={dispatcher}
      />
    )
    dispatcher.releasePreferenceUpdate()

    assert.ok(await screen.findByText(/workflow creation failed/i))
    assert.equal(
      screen.getByRole<HTMLInputElement>('checkbox', {
        name: /enable cloud compression for this private repository/i,
      }).checked,
      true
    )
  })

  it('keeps a deferred private opt-in bound to its originating repository', async () => {
    const dispatcher = new DeferredCloudCheapLfsDispatcher([])
    const firstRepository = repositoryWithVisibility(
      true,
      11,
      Path.resolve('work', 'private-a')
    )
    const secondRepository = repositoryWithVisibility(
      true,
      12,
      Path.resolve('work', 'private-b')
    )
    const view = render(
      <CheapLfs
        repository={firstRepository}
        accounts={[]}
        dispatcher={dispatcher}
      />
    )

    const firstCheckbox = await screen.findByRole<HTMLInputElement>(
      'checkbox',
      { name: /enable cloud compression for this private repository/i }
    )
    fireEvent.click(firstCheckbox)
    await waitFor(() => assert.equal(dispatcher.preferenceCalls.length, 1))

    view.rerender(
      <CheapLfs
        repository={secondRepository}
        accounts={[]}
        dispatcher={dispatcher}
      />
    )
    await waitFor(() =>
      assert.ok(
        dispatcher.ensureCalls.some(
          call => call.repository.id === secondRepository.id
        )
      )
    )

    dispatcher.releasePreferenceUpdate()
    await waitFor(() =>
      assert.ok(
        dispatcher.ensureCalls.some(
          call =>
            call.repository.id === firstRepository.id &&
            call.preferences.cheapLfsCloudCompression === true
        )
      )
    )

    assert.equal(
      dispatcher.ensureCalls.some(
        call =>
          call.repository.id === secondRepository.id &&
          call.preferences.cheapLfsCloudCompression === true
      ),
      false
    )
    const secondCheckbox = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /enable cloud compression for this private repository/i,
    })
    assert.equal(secondCheckbox.checked, false)
  })

  it('filters the pinned files case-insensitively over their paths', async () => {
    const dispatcher = new FakeCheapLfsDispatcher(pointers)
    render(
      <CheapLfs repository={repository} accounts={[]} dispatcher={dispatcher} />
    )
    await screen.findByText('assets/logo.psd')

    const search = screen.getByRole('searchbox', {
      name: 'Search pinned files',
    })
    fireEvent.change(search, { target: { value: 'DIAGRAM' } })

    assert.ok(screen.getByText('docs/diagram.png'))
    assert.equal(screen.queryByText('assets/logo.psd'), null)
  })

  it('materializes the exact row through the dispatcher with its path', async () => {
    const dispatcher = new FakeCheapLfsDispatcher(pointers)
    render(
      <CheapLfs repository={repository} accounts={[]} dispatcher={dispatcher} />
    )
    await screen.findByText('assets/logo.psd')

    const row = rowFor('assets/logo.psd')
    fireEvent.click(within(row).getByRole('button', { name: 'Materialize' }))

    await waitFor(() =>
      assert.deepStrictEqual(dispatcher.materializeCalls, ['assets/logo.psd'])
    )
  })

  it('routes Materialize all through one shared batch instead of per-file calls', async () => {
    const dispatcher = new FakeCheapLfsDispatcher(pointers)
    const gate = deferred<void>()
    dispatcher.materializeAllGate = gate.promise
    render(
      <CheapLfs repository={repository} accounts={[]} dispatcher={dispatcher} />
    )
    await screen.findByText('assets/logo.psd')

    fireEvent.click(screen.getByRole('button', { name: 'Materialize all' }))

    await waitFor(() => assert.equal(dispatcher.materializeAllCalls.length, 1))
    assert.deepStrictEqual(dispatcher.materializeCalls, [])
    assert.ok(dispatcher.materializeAllCalls[0].signal instanceof AbortSignal)
    assert.equal(
      typeof dispatcher.materializeAllCalls[0].onProgress,
      'function'
    )
    await screen.findByText('5 B of 10 B')
    gate.resolve()
    await screen.findByText(/Materialize all finished/i)
  })

  it('cancels Materialize all repository-wide so queued batches stop too', async () => {
    const dispatcher = new FakeCheapLfsDispatcher(pointers)
    const gate = deferred<void>()
    dispatcher.materializeAllGate = gate.promise
    render(
      <CheapLfs repository={repository} accounts={[]} dispatcher={dispatcher} />
    )
    await screen.findByText('assets/logo.psd')
    fireEvent.click(screen.getByRole('button', { name: 'Materialize all' }))
    await waitFor(() => assert.equal(dispatcher.materializeAllCalls.length, 1))
    const requestSignal = dispatcher.materializeAllCalls[0].signal

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      assert.equal(dispatcher.cancelMaterializeCalls.length, 1)
    )
    // No request signal: the store cancels every pending batch for the
    // repository, including queued automatic restores.
    assert.strictEqual(dispatcher.cancelMaterializeCalls[0], undefined)
    assert.equal(requestSignal?.aborted, true)
    gate.resolve()
    await waitFor(() =>
      assert.equal(screen.queryByRole('button', { name: 'Cancel' }), null)
    )
  })

  it('scopes a single-file materialize cancel to its own request signal', async () => {
    const dispatcher = new FakeCheapLfsDispatcher(pointers)
    const gate = deferred<ICheapLfsMaterializeResult>()
    dispatcher.materializePointer = async (
      _repository: Repository,
      trackedRelativePath: string
    ) => {
      dispatcher.materializeCalls.push(trackedRelativePath)
      return await gate.promise
    }
    render(
      <CheapLfs repository={repository} accounts={[]} dispatcher={dispatcher} />
    )
    await screen.findByText('assets/logo.psd')
    const row = rowFor('assets/logo.psd')
    fireEvent.click(within(row).getByRole('button', { name: 'Materialize' }))
    await waitFor(() => assert.equal(dispatcher.materializeCalls.length, 1))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() =>
      assert.equal(dispatcher.cancelMaterializeCalls.length, 1)
    )
    assert.ok(dispatcher.cancelMaterializeCalls[0] instanceof AbortSignal)
    assert.equal(dispatcher.cancelMaterializeCalls[0]?.aborted, true)
    gate.resolve({ path: 'assets/logo.psd', bytes: 10 })
  })

  it('reports partial Materialize-all failure instead of unconditional success', async () => {
    const dispatcher = new FakeCheapLfsDispatcher(pointers)
    dispatcher.materializeAllResult = {
      materialized: [{ path: pickedFile('docs/diagram.png'), bytes: 2048 }],
      failures: [{ relativePath: 'assets/logo.psd', message: 'asset missing' }],
      totalBytes: 5 * 1024 * 1024 + 2048,
      canceled: false,
    }
    render(
      <CheapLfs repository={repository} accounts={[]} dispatcher={dispatcher} />
    )
    await screen.findByText('assets/logo.psd')
    const listCallsBefore = dispatcher.listCalls

    fireEvent.click(screen.getByRole('button', { name: 'Materialize all' }))

    await screen.findByText(
      'Materialized 1 file; 1 file failed and was left as a pointer.'
    )
    assert.equal(screen.queryByText(/Materialize all finished/i), null)
    assert.ok(dispatcher.listCalls > listCallsBefore)
  })

  it('refreshes the pinned-file list after a canceled Materialize all', async () => {
    const dispatcher = new FakeCheapLfsDispatcher(pointers)
    const gate = deferred<void>()
    dispatcher.materializeAllGate = gate.promise
    const abortError = new Error('Cheap LFS materialization was canceled.')
    abortError.name = 'AbortError'
    dispatcher.materializeAllRejectWith = abortError
    render(
      <CheapLfs repository={repository} accounts={[]} dispatcher={dispatcher} />
    )
    await screen.findByText('assets/logo.psd')
    const listCallsBefore = dispatcher.listCalls

    fireEvent.click(screen.getByRole('button', { name: 'Materialize all' }))
    await waitFor(() => assert.equal(dispatcher.materializeAllCalls.length, 1))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    gate.resolve()

    await screen.findByText(/Materialize canceled/i)
    await waitFor(() => assert.ok(dispatcher.listCalls > listCallsBefore))
  })

  it('pins a picked file after review with a repo-relative default path', async () => {
    const dispatcher = new FakeCheapLfsDispatcher([])
    render(
      <CheapLfs
        repository={repository}
        accounts={[]}
        dispatcher={dispatcher}
        chooseFileToPin={async () => pickedFile('big.psd')}
        statFileSize={async () => 5 * 1024 * 1024}
      />
    )
    await screen.findByText(
      'No cheap LFS pointers are committed in this working tree yet.'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pin a large file…' }))
    const trackedInput = (await screen.findByLabelText(
      'Tracked file path'
    )) as HTMLInputElement
    assert.equal(trackedInput.value, 'big.psd')
    assert.ok(
      screen.getByText(
        /larger files are split automatically into 1.5 GiB parts/
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'Review pin' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Pin file' }))

    await waitFor(() => assert.equal(dispatcher.pinCalls.length, 1))
    assert.equal(dispatcher.pinCalls[0].trackedRelativePath, 'big.psd')
    assert.equal(dispatcher.pinCalls[0].releaseTag, 'assets')
    assert.equal(dispatcher.pinCalls[0].absoluteFilePath, pickedFile('big.psd'))
  })

  it('splits a file above the 2 GiB cap and pins it after review', async () => {
    const dispatcher = new FakeCheapLfsDispatcher([])
    render(
      <CheapLfs
        repository={repository}
        accounts={[]}
        dispatcher={dispatcher}
        chooseFileToPin={async () => pickedFile('huge.bin')}
        statFileSize={async () => 3 * 1024 * 1024 * 1024}
      />
    )
    await screen.findByText(
      'No cheap LFS pointers are committed in this working tree yet.'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pin a large file…' }))
    await screen.findByLabelText('Tracked file path')
    fireEvent.click(screen.getByRole('button', { name: 'Review pin' }))

    // The review notes the split into parts and the pin still proceeds; the
    // split itself is exercised in the operations unit tests.
    await screen.findByText(/split into 2 parts/i)
    fireEvent.click(await screen.findByRole('button', { name: 'Pin file' }))

    await waitFor(() => assert.equal(dispatcher.pinCalls.length, 1))
    assert.equal(dispatcher.pinCalls[0].trackedRelativePath, 'huge.bin')
    assert.equal(
      dispatcher.pinCalls[0].absoluteFilePath,
      pickedFile('huge.bin')
    )
  })

  it('rejects an unsafe tracked path before calling the dispatcher', async () => {
    const dispatcher = new FakeCheapLfsDispatcher([])
    render(
      <CheapLfs
        repository={repository}
        accounts={[]}
        dispatcher={dispatcher}
        chooseFileToPin={async () => pickedFile('big.psd')}
        statFileSize={async () => 1024}
      />
    )
    await screen.findByText(
      'No cheap LFS pointers are committed in this working tree yet.'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pin a large file…' }))
    const trackedInput = await screen.findByLabelText('Tracked file path')
    fireEvent.change(trackedInput, { target: { value: '../escape.psd' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review pin' }))

    await screen.findByText(/safe repository-relative path/i)
    assert.equal(screen.queryByRole('button', { name: 'Pin file' }), null)
    assert.equal(dispatcher.pinCalls.length, 0)
  })
})
