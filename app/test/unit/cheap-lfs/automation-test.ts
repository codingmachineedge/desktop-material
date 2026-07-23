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
import type {
  ICheapLfsTrackedFileProof,
  ICheapLfsTrackedPathStore,
} from '../../../src/lib/cheap-lfs/tracked-path-store'

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
    workingTreeState: 'pointer',
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
  it('auto-materialize accepts authenticated or validated anonymous read accounts', () => {
    assert.equal(shouldAutoMaterializeCheapLfs(true, selected), true)
    assert.equal(shouldAutoMaterializeCheapLfs(true, Account.anonymous()), true)
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

  it('stats every selection before proving only oversized destinations', async () => {
    const events: string[] = []
    const repo = repository('C:/secure-repo')
    const trackedPaths = {
      proveDestination: async (
        repositoryPath: string,
        relativePath: string
      ) => {
        events.push(`prove:${relativePath}`)
        assert.equal(repositoryPath, repo.path)
        assert.equal(relativePath, 'large.bin')
        return {
          repositoryRoot: repositoryPath,
          relativePath,
          absolutePath: `${repositoryPath}/${relativePath}`,
          exists: true,
          sizeInBytes: 220,
          sha256: 'a'.repeat(64),
        } as unknown as ICheapLfsTrackedFileProof
      },
      readText: async (proof: ICheapLfsTrackedFileProof) => {
        events.push(`read:${proof.relativePath}`)
        return 'not a pointer\n'
      },
    } as unknown as ICheapLfsTrackedPathStore

    const targets = await selectCheapLfsAutoPinTargets(
      repo,
      ['small.bin', 'large.bin', 'exact.bin'],
      threshold,
      {
        statSize: async absolutePath => {
          const relativePath = ['small.bin', 'large.bin', 'exact.bin'].find(
            path => absolutePath.endsWith(path)
          )
          assert.ok(relativePath !== undefined)
          events.push(`stat:${relativePath}`)
          return relativePath === 'large.bin'
            ? 200
            : relativePath === 'exact.bin'
            ? threshold
            : 20
        },
        readPointerText: async () => {
          throw new Error('tracked paths must provide bounded pointer reads')
        },
        trackedPaths,
      }
    )

    assert.deepEqual(events, [
      'stat:small.bin',
      'stat:large.bin',
      'stat:exact.bin',
      'prove:large.bin',
      'read:large.bin',
    ])
    assert.equal(targets.length, 1)
    assert.equal(targets[0].relativePath, 'large.bin')
    assert.ok(targets[0].absolutePath.endsWith('large.bin'))
    assert.equal(targets[0].sizeInBytes, 220)
  })

  it('requires an existing over-threshold tracked proof before selecting', async () => {
    const repo = repository('C:/secure-repo')
    const proved: string[] = []
    const read: string[] = []
    const trackedPaths = {
      proveDestination: async (
        repositoryPath: string,
        relativePath: string
      ) => {
        assert.equal(repositoryPath, repo.path)
        proved.push(relativePath)
        const exists = relativePath !== 'absent.bin'
        const sizeInBytes = relativePath === 'shrunk.bin' ? 80 : 240
        return {
          repositoryRoot: repositoryPath,
          relativePath,
          absolutePath: `${repositoryPath}/${relativePath}`,
          exists,
          sizeInBytes: exists ? sizeInBytes : 0,
          sha256: exists ? 'b'.repeat(64) : null,
        } as unknown as ICheapLfsTrackedFileProof
      },
      readText: async (proof: ICheapLfsTrackedFileProof) => {
        read.push(proof.relativePath)
        return 'not a pointer\n'
      },
    } as unknown as ICheapLfsTrackedPathStore

    const targets = await selectCheapLfsAutoPinTargets(
      repo,
      ['absent.bin', 'shrunk.bin', 'large.bin'],
      threshold,
      {
        statSize: async () => 200,
        readPointerText: async () => {
          throw new Error('tracked paths must provide bounded pointer reads')
        },
        trackedPaths,
      }
    )

    assert.deepEqual(proved, ['absent.bin', 'shrunk.bin', 'large.bin'])
    assert.deepEqual(read, ['large.bin'])
    assert.deepEqual(
      targets.map(target => [target.relativePath, target.sizeInBytes]),
      [['large.bin', 240]]
    )
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
    assert.equal(result.pinned.length, 1)
    assert.equal(result.pinned[0].relativePath, 'big.bin')
    assert.equal(result.pinned[0].sizeInBytes, 200)
    assert.deepEqual(result.failures, [])
  })

  it('reports preparation before pinning and a terminal upload state', async () => {
    const progress = new Array<{
      phase: string
      completedFiles: number
      currentPath: string | null
      transferredBytes: number
    }>()
    const result = await autoPinLargeFilesForCommit(
      repository(),
      ['windows.iso'],
      threshold,
      {
        statSize: async () => 200,
        readPointerText: async () => 'not a pointer\n',
        pin: async (target, _signal, onProgress, onStage, onHashProgress) => {
          assert.equal(progress.at(-1)?.phase, 'preparing')
          onStage?.('hashing')
          onHashProgress?.(100)
          onProgress({
            operationId: 'upload',
            direction: 'upload',
            transferredBytes: 100,
            totalBytes: 200,
          })
          return pinResult(target.relativePath)
        },
      },
      undefined,
      update => progress.push(update)
    )

    assert.equal(result.pinned.length, 1)
    assert.equal(progress[0].phase, 'preparing')
    assert.equal(progress[1].phase, 'hashing')
    assert.equal(progress[2].phase, 'hashing')
    assert.equal(progress[2].transferredBytes, 0)
    assert.equal(progress[3].phase, 'uploading')
    assert.equal(progress[3].transferredBytes, 100)
    assert.deepEqual(progress.at(-1), {
      phase: 'uploading',
      completedFiles: 1,
      succeededFiles: 1,
      failedFiles: 0,
      totalFiles: 1,
      currentPath: null,
      transferredBytes: 200,
      totalBytes: 200,
      activeFiles: [],
    })
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
    assert.equal(result.pinned.length, 0)
  })

  it('collects failures and continues the remaining safe work', async () => {
    const attempted: string[] = []
    const result = await autoPinLargeFilesForCommit(
      repository(),
      ['first.bin', 'second.bin'],
      threshold,
      {
        statSize: async () => 200,
        readPointerText: async () => 'not a pointer\n',
        pin: async target => {
          attempted.push(target.relativePath)
          if (target.relativePath === 'first.bin') {
            throw new Error('upload failed')
          }
          return pinResult(target.relativePath)
        },
      }
    )
    assert.deepEqual(attempted, ['first.bin', 'second.bin'])
    assert.deepEqual(
      result.pinned.map(file => file.relativePath),
      ['second.bin']
    )
    assert.deepEqual(result.failures, [
      {
        relativePath: 'first.bin',
        sizeInBytes: 200,
        message: 'upload failed',
      },
    ])
  })

  it('uses at most three stable lanes and returns callbacks in input order', async () => {
    const started: string[] = []
    const lanes: number[] = []
    const callbacks: string[] = []
    const resolvers = new Map<string, () => void>()
    const operation = autoPinLargeFilesForCommit(
      repository(),
      ['one.bin', 'two.bin', 'three.bin', 'four.bin'],
      threshold,
      {
        statSize: async () => 200,
        readPointerText: async () => 'not a pointer\n',
        pin: async (target, _signal, _progress, _stage, _hash, lane = -1) => {
          started.push(target.relativePath)
          lanes.push(lane)
          await new Promise<void>(resolve =>
            resolvers.set(target.relativePath, resolve)
          )
          return pinResult(target.relativePath)
        },
      },
      undefined,
      undefined,
      file => callbacks.push(file.relativePath),
      3
    )

    await new Promise<void>(resolve => setImmediate(resolve))
    assert.deepEqual(started, ['one.bin', 'two.bin', 'three.bin'])
    assert.deepEqual(lanes, [0, 1, 2])

    // The fourth file belongs to lane 0 and cannot start until that lane frees.
    resolvers.get('one.bin')?.()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.deepEqual(started, ['one.bin', 'two.bin', 'three.bin', 'four.bin'])
    assert.deepEqual(lanes, [0, 1, 2, 0])

    // Finish out of order; externally visible results remain input ordered.
    resolvers.get('three.bin')?.()
    resolvers.get('four.bin')?.()
    resolvers.get('two.bin')?.()
    const result = await operation
    assert.deepEqual(
      result.pinned.map(file => file.relativePath),
      ['one.bin', 'two.bin', 'three.bin', 'four.bin']
    )
    assert.deepEqual(callbacks, ['one.bin', 'two.bin', 'three.bin', 'four.bin'])
  })

  it('retains sequential behavior when concurrency is one', async () => {
    let active = 0
    let maximumActive = 0
    const result = await autoPinLargeFilesForCommit(
      repository(),
      ['one.bin', 'two.bin', 'three.bin'],
      threshold,
      {
        statSize: async () => 200,
        readPointerText: async () => 'not a pointer\n',
        pin: async target => {
          active++
          maximumActive = Math.max(maximumActive, active)
          await new Promise<void>(resolve => setImmediate(resolve))
          active--
          return pinResult(target.relativePath)
        },
      },
      undefined,
      undefined,
      undefined,
      1
    )
    assert.equal(maximumActive, 1)
    assert.equal(result.pinned.length, 3)
  })

  it('cancels all active lanes, drains them, and starts no later work', async () => {
    const controller = new AbortController()
    const started: string[] = []
    let settled = 0
    let progressCalls = 0
    const operation = autoPinLargeFilesForCommit(
      repository(),
      ['one.bin', 'two.bin', 'three.bin', 'four.bin'],
      threshold,
      {
        statSize: async () => 200,
        readPointerText: async () => 'not a pointer\n',
        pin: (target, signal) =>
          new Promise<ICheapLfsPinResult>((_resolve, reject) => {
            started.push(target.relativePath)
            signal?.addEventListener(
              'abort',
              () => {
                settled++
                const error = new Error('canceled')
                error.name = 'AbortError'
                reject(error)
              },
              { once: true }
            )
          }),
      },
      controller.signal,
      () => progressCalls++,
      undefined,
      3
    )

    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(started.length, 3)
    controller.abort()
    const result = await operation
    assert.equal(result.canceled, true)
    assert.equal(settled, 3)
    assert.deepEqual(started, ['one.bin', 'two.bin', 'three.bin'])
    const callsAtReturn = progressCalls
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(progressCalls, callsAtReturn)
  })
})
