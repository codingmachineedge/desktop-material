import assert from 'node:assert'
import { describe, it } from 'node:test'
import { Account, getAccountKey } from '../../../src/models/account'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import { IGitHubReleaseAsset } from '../../../src/lib/github-releases'
import {
  autoPinLargeFilesForCommit,
  ICheapLfsAutoPinTarget,
  ICheapLfsPinResult,
  ICheapLfsPointerEntry,
  materializeCheapLfsPointers,
  selectCheapLfsAutoPinTargets,
  shouldAutoMaterializeCheapLfs,
  shouldAutoPinLargeFilesOnCommit,
} from '../../../src/lib/cheap-lfs/operations'
import {
  CHEAP_LFS_POINTER_VERSION,
  ICheapLfsPointer,
  serializeCheapLfsPointer,
} from '../../../src/lib/cheap-lfs/pointer'

const selected = new Account(
  'selected',
  'https://api.github.com',
  'selected-token',
  [],
  '',
  2,
  'Selected'
)

const gitHubRepository = new GitHubRepository(
  'material',
  new Owner('desktop', 'https://api.github.com', 1),
  1
)

function repository(path: string = 'C:/repo'): Repository {
  return new Repository(
    path,
    1,
    gitHubRepository,
    false,
    null,
    {},
    false,
    undefined,
    getAccountKey(selected)
  )
}

const asset: IGitHubReleaseAsset = {
  id: 1,
  name: 'big.bin',
  label: null,
  state: 'uploaded',
  contentType: 'application/octet-stream',
  sizeInBytes: 200,
  downloadCount: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  digest: `sha256:${'a'.repeat(64)}`,
}

function pinResult(assetName: string): ICheapLfsPinResult {
  return {
    pointer: {
      version: CHEAP_LFS_POINTER_VERSION,
      releaseTag: 'assets',
      assetName,
      sizeInBytes: 200,
      sha256: 'a'.repeat(64),
    },
    asset: { ...asset, name: assetName },
    releaseId: 7,
  }
}

function pointerEntry(
  relativePath: string,
  sizeInBytes: number
): ICheapLfsPointerEntry {
  return {
    relativePath,
    pointer: {
      version: CHEAP_LFS_POINTER_VERSION,
      releaseTag: 'assets',
      assetName: relativePath,
      sizeInBytes,
      sha256: 'b'.repeat(64),
    },
  }
}

describe('cheap LFS automation gates', () => {
  it('auto-materialize runs only when enabled and an account is selected', () => {
    assert.equal(shouldAutoMaterializeCheapLfs(true, selected), true)
    assert.equal(shouldAutoMaterializeCheapLfs(false, selected), false)
    assert.equal(shouldAutoMaterializeCheapLfs(true, null), false)
    assert.equal(shouldAutoMaterializeCheapLfs(false, null), false)
  })

  it('auto-pin runs only when enabled and Releases are available', () => {
    assert.equal(shouldAutoPinLargeFilesOnCommit(true, 'available'), true)
    assert.equal(shouldAutoPinLargeFilesOnCommit(false, 'available'), false)
    // A non-GitHub repository is never eligible, even when the toggle is on.
    assert.equal(shouldAutoPinLargeFilesOnCommit(true, 'not-github'), false)
    assert.equal(shouldAutoPinLargeFilesOnCommit(true, 'signed-out'), false)
    assert.equal(shouldAutoPinLargeFilesOnCommit(true, 'unsupported'), false)
  })
})

describe('materializeCheapLfsPointers', () => {
  it('returns an empty summary when there are no pointers', async () => {
    let calls = 0
    const summary = await materializeCheapLfsPointers(
      [],
      async relativePath => {
        calls++
        return { path: relativePath, bytes: 0 }
      },
      new AbortController().signal
    )
    assert.equal(calls, 0)
    assert.equal(summary.materialized.length, 0)
    assert.equal(summary.failures.length, 0)
    assert.equal(summary.totalBytes, 0)
    assert.equal(summary.canceled, false)
  })

  it('materializes every pointer and reports cumulative byte progress', async () => {
    const entries = [pointerEntry('a.bin', 100), pointerEntry('b.bin', 300)]
    const progresses: number[] = []
    const summary = await materializeCheapLfsPointers(
      entries,
      async (relativePath, _signal, onProgress) => {
        onProgress({
          operationId: 'test',
          direction: 'download',
          transferredBytes: 10,
          totalBytes: 10,
        })
        return {
          path: relativePath,
          bytes: relativePath === 'a.bin' ? 100 : 300,
        }
      },
      new AbortController().signal,
      progress => progresses.push(progress.transferredBytes)
    )
    assert.equal(summary.materialized.length, 2)
    assert.equal(summary.failures.length, 0)
    assert.equal(summary.totalBytes, 400)
    assert.equal(summary.canceled, false)
    // The second file's per-transfer progress is offset by the first file's
    // completed bytes, proving progress is cumulative across the batch.
    assert.ok(progresses.includes(110))
  })

  it('records a per-pointer failure and keeps going', async () => {
    const entries = [
      pointerEntry('bad.bin', 100),
      pointerEntry('good.bin', 200),
    ]
    const summary = await materializeCheapLfsPointers(
      entries,
      async relativePath => {
        if (relativePath === 'bad.bin') {
          throw new Error('boom')
        }
        return { path: relativePath, bytes: 200 }
      },
      new AbortController().signal
    )
    assert.equal(summary.materialized.length, 1)
    assert.equal(summary.materialized[0].path, 'good.bin')
    assert.equal(summary.failures.length, 1)
    assert.equal(summary.failures[0].relativePath, 'bad.bin')
    assert.match(summary.failures[0].message, /boom/)
    assert.equal(summary.canceled, false)
  })

  it('stops early and reports cancellation on an AbortError', async () => {
    const entries = [pointerEntry('a.bin', 100), pointerEntry('b.bin', 200)]
    let calls = 0
    const summary = await materializeCheapLfsPointers(
      entries,
      async () => {
        calls++
        const error = new Error('canceled')
        error.name = 'AbortError'
        throw error
      },
      new AbortController().signal
    )
    assert.equal(calls, 1)
    assert.equal(summary.canceled, true)
    assert.equal(summary.materialized.length, 0)
    assert.equal(summary.failures.length, 0)
  })

  it('does not start when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const summary = await materializeCheapLfsPointers(
      [pointerEntry('a.bin', 100)],
      async relativePath => {
        calls++
        return { path: relativePath, bytes: 100 }
      },
      controller.signal
    )
    assert.equal(calls, 0)
    assert.equal(summary.canceled, true)
  })
})

describe('selectCheapLfsAutoPinTargets', () => {
  const threshold = 100

  function deps(
    sizes: ReadonlyMap<string, number>,
    pointerText: ReadonlyMap<string, string> = new Map()
  ) {
    return {
      statSize: async (absolutePath: string) => {
        const size = [...sizes.entries()].find(([rel]) =>
          absolutePath.endsWith(rel)
        )?.[1]
        if (size === undefined) {
          throw new Error('missing')
        }
        return size
      },
      readPointerText: async (absolutePath: string) => {
        const text = [...pointerText.entries()].find(([rel]) =>
          absolutePath.endsWith(rel)
        )?.[1]
        return text ?? 'not a pointer\n'
      },
    }
  }

  it('selects only files strictly over the threshold', async () => {
    const targets = await selectCheapLfsAutoPinTargets(
      repository(),
      ['big.bin', 'small.bin', 'exact.bin'],
      threshold,
      deps(
        new Map([
          ['big.bin', 200],
          ['small.bin', 50],
          ['exact.bin', 100],
        ])
      )
    )
    assert.deepEqual(
      targets.map(t => t.relativePath),
      ['big.bin']
    )
    assert.equal(targets[0].sizeInBytes, 200)
  })

  it('skips a file that already holds a committed pointer', async () => {
    const pointer: ICheapLfsPointer = {
      version: CHEAP_LFS_POINTER_VERSION,
      releaseTag: 'assets',
      assetName: 'already.bin',
      sizeInBytes: 200,
      sha256: 'c'.repeat(64),
    }
    const targets = await selectCheapLfsAutoPinTargets(
      repository(),
      ['already.bin'],
      threshold,
      deps(
        new Map([['already.bin', 200]]),
        new Map([['already.bin', serializeCheapLfsPointer(pointer)]])
      )
    )
    assert.equal(targets.length, 0)
  })

  it('skips a file that cannot be stat', async () => {
    const targets = await selectCheapLfsAutoPinTargets(
      repository(),
      ['vanished.bin'],
      threshold,
      deps(new Map())
    )
    assert.equal(targets.length, 0)
  })
})

describe('autoPinLargeFilesForCommit', () => {
  const threshold = 100

  it('pins each over-threshold file and returns them for restaging', async () => {
    const pinned: ICheapLfsAutoPinTarget[] = []
    const result = await autoPinLargeFilesForCommit(
      repository(),
      ['big.bin', 'small.bin'],
      threshold,
      {
        statSize: async absolutePath =>
          absolutePath.endsWith('big.bin') ? 200 : 20,
        readPointerText: async () => 'not a pointer\n',
        pin: async target => {
          pinned.push(target)
          return pinResult(target.relativePath)
        },
      }
    )
    assert.deepEqual(
      pinned.map(t => t.relativePath),
      ['big.bin']
    )
    assert.equal(result.length, 1)
    assert.equal(result[0].relativePath, 'big.bin')
    assert.equal(result[0].sizeInBytes, 200)
  })

  it('never pins an under-threshold file', async () => {
    let pinCalls = 0
    const result = await autoPinLargeFilesForCommit(
      repository(),
      ['small.bin'],
      threshold,
      {
        statSize: async () => 20,
        readPointerText: async () => 'not a pointer\n',
        pin: async target => {
          pinCalls++
          return pinResult(target.relativePath)
        },
      }
    )
    assert.equal(pinCalls, 0)
    assert.equal(result.length, 0)
  })

  it('aborts the whole batch by throwing on the first pin failure', async () => {
    const attempted: string[] = []
    await assert.rejects(
      autoPinLargeFilesForCommit(
        repository(),
        ['first.bin', 'second.bin'],
        threshold,
        {
          statSize: async () => 200,
          readPointerText: async () => 'not a pointer\n',
          pin: async target => {
            attempted.push(target.relativePath)
            throw new Error('upload failed')
          },
        }
      ),
      /upload failed/
    )
    // The first failure stops the batch before the second file is attempted, so
    // the caller can abort the commit rather than commit a half-pinned tree.
    assert.deepEqual(attempted, ['first.bin'])
  })
})
