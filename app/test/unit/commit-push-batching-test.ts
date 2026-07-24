import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  AutomaticCommitPushBatchByteLimit,
  AutomaticCommitPushBatchGitMaintenanceArgs,
  AutomaticCommitPushBatchMaximumPaths,
  AutomaticCommitPushMaximumBytes,
  AutomaticLocalCommitBatchFileCountLimit,
  assertAutomaticCommitPushBatchSafety,
  computeCommitBatchProgress,
  CommitPushBatchError,
  executeCommitPushBatches,
  measureWorkingTreeBatchFiles,
  splitCommitPushBatches,
  splitCommitPushBatchesWithFirstBatchFiles,
} from '../../src/lib/commit-push-batching'

describe('automatic commit and push batching', () => {
  it('reserves Git overhead below the exact decimal 1.5 GB push ceiling', () => {
    assert.equal(AutomaticCommitPushMaximumBytes, 1_500_000_000)
    assert.equal(AutomaticCommitPushBatchByteLimit, 1_400_000_000)
  })

  it('keeps an exact-boundary stable batch together and splits the next byte', () => {
    const limit = 100
    const batches = splitCommitPushBatches(
      [
        { item: 'a', path: 'a.bin', sizeInBytes: 40 },
        { item: 'b', path: 'b.bin', sizeInBytes: 60 },
        { item: 'c', path: 'c.bin', sizeInBytes: 1 },
      ],
      limit
    )
    assert.deepEqual(batches, [
      { items: ['a', 'b'], paths: ['a.bin', 'b.bin'], sizeInBytes: 100 },
      { items: ['c'], paths: ['c.bin'], sizeInBytes: 1 },
    ])
  })

  it('budgets a required control file before splitting an exact-boundary payload', () => {
    const batches = splitCommitPushBatchesWithFirstBatchFiles(
      [{ item: 'payload', path: 'payload.bin', sizeInBytes: 100 }],
      [{ path: '.desktop-material/cheap-lfs.key', sizeInBytes: 1 }],
      100
    )

    assert.deepEqual(batches, [
      {
        items: [],
        paths: ['.desktop-material/cheap-lfs.key'],
        sizeInBytes: 1,
      },
      { items: ['payload'], paths: ['payload.bin'], sizeInBytes: 100 },
    ])
  })

  it('promotes an already-selected required file to batch one without counting it twice', () => {
    const batches = splitCommitPushBatchesWithFirstBatchFiles(
      [
        { item: 'first', path: 'first.bin', sizeInBytes: 60 },
        {
          item: 'key',
          path: '.desktop-material/cheap-lfs.key',
          sizeInBytes: 5,
        },
        { item: 'last', path: 'last.bin', sizeInBytes: 40 },
      ],
      [{ path: '.DESKTOP-MATERIAL/CHEAP-LFS.KEY', sizeInBytes: 5 }],
      100
    )

    assert.deepEqual(
      batches.map(batch => ({
        items: batch.items,
        sizeInBytes: batch.sizeInBytes,
      })),
      [
        { items: ['key', 'first'], sizeInBytes: 65 },
        { items: ['last'], sizeInBytes: 40 },
      ]
    )
    assert.equal(
      batches
        .flatMap(batch => batch.paths)
        .filter(path => path.toLowerCase().endsWith('cheap-lfs.key')).length,
      1
    )
  })

  it('keeps zero-byte deletions in order without inflating a batch', () => {
    const batches = splitCommitPushBatches(
      [
        { item: 'a', path: 'a.bin', sizeInBytes: 10 },
        { item: 'deleted', path: 'old.bin', sizeInBytes: 0 },
        { item: 'b', path: 'b.bin', sizeInBytes: 10 },
      ],
      10
    )
    assert.deepEqual(
      batches.map(batch => batch.items),
      [['a', 'deleted'], ['b']]
    )
  })

  it('adds a rename source path to proof without inflating its batch', () => {
    const renamed = { path: 'new-name.bin', oldPath: 'old-name.bin' }
    const expanded = splitCommitPushBatches(
      [
        {
          item: renamed,
          path: renamed.path,
          sizeInBytes: 10,
          proofPaths: [renamed.path, renamed.oldPath],
        },
      ],
      10
    )

    assert.deepEqual(expanded, [
      {
        items: [renamed],
        paths: ['new-name.bin', 'old-name.bin'],
        sizeInBytes: 10,
      },
    ])
  })

  it('splits tiny files before the path-count or proof-output bounds', () => {
    const byCount = splitCommitPushBatches(
      Array.from({ length: 4 }, (_, index) => ({
        item: index,
        path: `tiny-${index}.txt`,
        sizeInBytes: 0,
      })),
      100,
      { maximumPathsPerBatch: 3, maximumProofBytesPerBatch: 10_000 }
    )
    assert.deepEqual(
      byCount.map(batch => batch.items),
      [[0, 1, 2], [3]]
    )

    const byProofBytes = splitCommitPushBatches(
      [
        { item: 'a', path: 'a'.repeat(40), sizeInBytes: 0 },
        { item: 'b', path: 'b'.repeat(40), sizeInBytes: 0 },
      ],
      100,
      { maximumPathsPerBatch: 3, maximumProofBytesPerBatch: 300 }
    )
    assert.deepEqual(
      byProofBytes.map(batch => batch.items),
      [['a'], ['b']]
    )
    assert.equal(AutomaticCommitPushBatchMaximumPaths, 10_000)
  })

  it('fails closed for a single file above the limit', () => {
    assert.throws(
      () =>
        splitCommitPushBatches(
          [{ item: 'big', path: 'big.bin', sizeInBytes: 101 }],
          100
        ),
      (error: unknown) =>
        error instanceof CommitPushBatchError &&
        error.kind === 'file-over-limit' &&
        error.path === 'big.bin'
    )
  })

  it('preserves caller objects, including partial selections, in stable batches', () => {
    type SelectionFixture = {
      readonly path: string
      readonly selection: 'partial' | 'all'
    }
    const partial: SelectionFixture = {
      path: 'partial.txt',
      selection: 'partial',
    }
    const all: SelectionFixture = { path: 'all.txt', selection: 'all' }
    const batches = splitCommitPushBatches(
      [
        { item: partial, path: partial.path, sizeInBytes: 7 },
        { item: all, path: all.path, sizeInBytes: 7 },
      ],
      10
    )

    assert.equal(batches[0].items[0], partial)
    assert.equal(batches[1].items[0], all)
  })

  it('fails closed for unsafe multi-batch Git states before committing', () => {
    const base = {
      amend: false,
      hasConflict: false,
      hasMultiCommitOperation: false,
      canPush: true,
    }
    const cases = [
      [{ ...base, amend: true }, 'amend-not-supported'],
      [{ ...base, hasConflict: true }, 'conflict-state'],
      [{ ...base, hasMultiCommitOperation: true }, 'multi-commit-operation'],
      [{ ...base, canPush: false }, 'push-unavailable'],
    ] as const

    for (const [state, kind] of cases) {
      assert.throws(
        () => assertAutomaticCommitPushBatchSafety(2, state),
        (error: unknown) =>
          error instanceof CommitPushBatchError && error.kind === kind
      )
    }

    // A normal single commit retains existing amend/offline behavior.
    assert.doesNotThrow(() =>
      assertAutomaticCommitPushBatchSafety(1, {
        amend: true,
        hasConflict: true,
        hasMultiCommitOperation: true,
        canPush: false,
      })
    )
  })

  it('measures files with a fixed bound and treats deletions as zero bytes', async () => {
    let active = 0
    let maximumActive = 0
    const measured = await measureWorkingTreeBatchFiles(
      'C:/fixture',
      [
        { item: 'a', path: 'a.bin', deleted: false },
        {
          item: 'b',
          path: 'b.bin',
          deleted: false,
          proofPaths: ['b.bin', 'old-b.bin'],
        },
        { item: 'gone', path: 'gone.bin', deleted: true },
        { item: 'c', path: 'c.bin', deleted: false },
      ],
      async path => {
        active++
        maximumActive = Math.max(maximumActive, active)
        await new Promise(resolve => setTimeout(resolve, 1))
        active--
        return { size: path.endsWith('a.bin') ? 1 : 2 }
      },
      2
    )
    assert.ok(maximumActive <= 2)
    assert.deepEqual(
      measured.map(file => [file.path, file.sizeInBytes]),
      [
        ['a.bin', 1],
        ['b.bin', 2],
        ['gone.bin', 0],
        ['c.bin', 2],
      ]
    )
    assert.deepEqual(measured[1].proofPaths, ['b.bin', 'old-b.bin'])
  })

  it('fails closed when a non-deleted file size is unreadable', async () => {
    await assert.rejects(
      measureWorkingTreeBatchFiles(
        'C:/fixture',
        [{ item: 'missing', path: 'missing.bin', deleted: false }],
        async () => {
          throw new Error('missing')
        }
      ),
      (error: unknown) =>
        error instanceof CommitPushBatchError &&
        error.kind === 'unreadable-size' &&
        error.path === 'missing.bin'
    )
  })

  it('rejects parent traversal before invoking stat', async () => {
    let statCalls = 0
    await assert.rejects(
      measureWorkingTreeBatchFiles(
        'C:/fixture',
        [{ item: 'unsafe', path: '../outside.bin', deleted: false }],
        async () => {
          statCalls++
          return { size: 1 }
        }
      ),
      (error: unknown) =>
        error instanceof CommitPushBatchError && error.kind === 'unsafe-path'
    )
    assert.equal(statCalls, 0)
  })

  it('requires each push to finish before the next commit starts', async () => {
    const batches = splitCommitPushBatches(
      [
        { item: 'a', path: 'a', sizeInBytes: 6 },
        { item: 'b', path: 'b', sizeInBytes: 6 },
        { item: 'c', path: 'c', sizeInBytes: 6 },
      ],
      10
    )
    const events = new Array<string>()
    await executeCommitPushBatches(batches, {
      commit: async (_batch, index) => {
        events.push(`commit:${index}`)
        return true
      },
      push: async (_batch, index) => {
        events.push(`push:${index}`)
        return true
      },
    })
    assert.deepEqual(events, [
      'commit:0',
      'push:0',
      'commit:1',
      'push:1',
      'commit:2',
      'push:2',
    ])
  })

  it('stops before another commit when a push fails', async () => {
    const batches = splitCommitPushBatches(
      [
        { item: 'a', path: 'a', sizeInBytes: 6 },
        { item: 'b', path: 'b', sizeInBytes: 6 },
      ],
      10
    )
    const events = new Array<string>()
    await assert.rejects(
      executeCommitPushBatches(batches, {
        commit: async (_batch, index) => {
          events.push(`commit:${index}`)
          return true
        },
        push: async (_batch, index) => {
          events.push(`push:${index}`)
          return false
        },
      }),
      (error: unknown) =>
        error instanceof CommitPushBatchError &&
        error.kind === 'push-failed' &&
        error.batchIndex === 0
    )
    assert.deepEqual(events, ['commit:0', 'push:0'])
  })

  it('carries process-local config that disables auto-gc and auto-maintenance', () => {
    assert.deepStrictEqual(AutomaticCommitPushBatchGitMaintenanceArgs, [
      '-c',
      'gc.auto=0',
      '-c',
      'maintenance.auto=false',
    ])
  })

  it('defaults the local-commit file-count cap to the per-batch path bound', () => {
    assert.equal(
      AutomaticLocalCommitBatchFileCountLimit,
      AutomaticCommitPushBatchMaximumPaths
    )
    assert.equal(AutomaticLocalCommitBatchFileCountLimit, 10_000)
  })

  it('reports cumulative batch, file, and byte progress for each stage', () => {
    const batches = splitCommitPushBatches(
      [
        { item: 'a', path: 'a', sizeInBytes: 4 },
        { item: 'b', path: 'b', sizeInBytes: 6 },
        { item: 'c', path: 'c', sizeInBytes: 3 },
      ],
      10
    )
    // Two batches: [a, b] (10 bytes) and [c] (3 bytes).
    assert.equal(batches.length, 2)

    // While committing the first batch nothing is committed yet.
    assert.deepStrictEqual(
      computeCommitBatchProgress(batches, 'committing', 0),
      {
        phase: 'committing',
        batchNumber: 1,
        batchCount: 2,
        filesCommitted: 0,
        filesTotal: 3,
        bytesCommitted: 0,
        bytesTotal: 13,
      }
    )
    // While pushing the first batch its two files/10 bytes are committed.
    assert.deepStrictEqual(computeCommitBatchProgress(batches, 'pushing', 0), {
      phase: 'pushing',
      batchNumber: 1,
      batchCount: 2,
      filesCommitted: 2,
      filesTotal: 3,
      bytesCommitted: 10,
      bytesTotal: 13,
    })
    // Committing the final batch: the first batch is done, this one is not.
    assert.deepStrictEqual(
      computeCommitBatchProgress(batches, 'committing', 1),
      {
        phase: 'committing',
        batchNumber: 2,
        batchCount: 2,
        filesCommitted: 2,
        filesTotal: 3,
        bytesCommitted: 10,
        bytesTotal: 13,
      }
    )
    // Pushing the final batch: everything is committed.
    assert.deepStrictEqual(computeCommitBatchProgress(batches, 'pushing', 1), {
      phase: 'pushing',
      batchNumber: 2,
      batchCount: 2,
      filesCommitted: 3,
      filesTotal: 3,
      bytesCommitted: 13,
      bytesTotal: 13,
    })
  })

  it('rejects an out-of-range batch progress index', () => {
    const batches = splitCommitPushBatches(
      [{ item: 'a', path: 'a', sizeInBytes: 4 }],
      10
    )
    assert.throws(
      () => computeCommitBatchProgress(batches, 'committing', 1),
      (error: unknown) =>
        error instanceof CommitPushBatchError &&
        error.kind === 'invalid-limit' &&
        error.batchIndex === 1
    )
  })
})
