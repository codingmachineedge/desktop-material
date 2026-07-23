import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'node:path'
import * as React from 'react'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import { CheapLfs, ICheapLfsDispatcher } from '../../../src/ui/repository-tools'
import {
  ICheapLfsMaterializeResult,
  ICheapLfsPinOptions,
  ICheapLfsPinResult,
  ICheapLfsPointerEntry,
} from '../../../src/lib/cheap-lfs/operations'
import {
  CHEAP_LFS_POINTER_VERSION,
  ICheapLfsPointer,
} from '../../../src/lib/cheap-lfs/pointer'
import { IGitHubReleaseAsset } from '../../../src/lib/github-releases'
import {
  defaultBuildRunPreferences,
  IBuildRunPreferences,
} from '../../../src/models/build-run-preferences'
import { getCheapLfsCloudCompressionPolicy } from '../../../src/lib/cheap-lfs/cloud-compression'
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
): ICheapLfsPointerEntry {
  return {
    relativePath,
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

const pointers: ReadonlyArray<ICheapLfsPointerEntry> = [
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
  public pointers: ReadonlyArray<ICheapLfsPointerEntry>
  public readonly pinCalls: ICheapLfsPinOptions[] = []
  public readonly materializeCalls: string[] = []

  public constructor(initial: ReadonlyArray<ICheapLfsPointerEntry>) {
    this.pointers = initial
  }

  public listCheapLfsPointers = async (_repository: Repository) => this.pointers

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
