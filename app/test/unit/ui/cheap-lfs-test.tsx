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
