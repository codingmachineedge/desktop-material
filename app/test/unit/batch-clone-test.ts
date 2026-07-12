import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import {
  BatchCloneMode,
  IBatchCloneItem,
  IBatchCloneItemStatus,
  buildBatchCloneItems,
  computeBatchCloneProgress,
  deriveBatchCloneName,
  isBatchCloneDone,
  summarizeBatchClone,
  uniquifyName,
} from '../../src/models/batch-clone'

function statuses(
  entries: ReadonlyArray<[string, IBatchCloneItemStatus]>
): Map<string, IBatchCloneItemStatus> {
  return new Map(entries)
}

describe('batch-clone model', () => {
  describe('deriveBatchCloneName', () => {
    it('derives the repo name from a github clone url', () => {
      assert.equal(
        deriveBatchCloneName('https://github.com/octocat/Hello-World.git'),
        'Hello-World'
      )
    })

    it('derives from an ssh url', () => {
      assert.equal(
        deriveBatchCloneName('git@github.com:octocat/Spoon.git'),
        'Spoon'
      )
    })

    it('falls back to the last path segment for an unusual url', () => {
      assert.equal(
        deriveBatchCloneName('https://example.com/a/b/c/thing.git'),
        'thing'
      )
    })

    it('returns a safe default when nothing usable is present', () => {
      assert.equal(deriveBatchCloneName(''), 'repository')
    })
  })

  describe('uniquifyName', () => {
    it('returns the candidate when not taken', () => {
      const taken = new Set<string>()
      assert.equal(uniquifyName('repo', taken), 'repo')
      assert.ok(taken.has('repo'))
    })

    it('suffixes -2, -3 on collision', () => {
      const taken = new Set<string>(['repo'])
      assert.equal(uniquifyName('repo', taken), 'repo-2')
      assert.equal(uniquifyName('repo', taken), 'repo-3')
    })
  })

  describe('buildBatchCloneItems', () => {
    it('builds items with derived names and joined paths', () => {
      const items = buildBatchCloneItems(
        [
          { url: 'https://github.com/o/a.git', defaultBranch: 'main' },
          { url: 'https://github.com/o/b.git' },
        ],
        '/base'
      )
      assert.equal(items.length, 2)
      assert.equal(items[0].name, 'a')
      assert.equal(items[0].path, Path.join('/base', 'a'))
      assert.equal(items[0].defaultBranch, 'main')
      assert.equal(items[1].name, 'b')
      assert.equal(items[1].defaultBranch, undefined)
    })

    it('de-duplicates colliding folder names', () => {
      const items = buildBatchCloneItems(
        [
          { url: 'https://github.com/o1/dup.git' },
          { url: 'https://github.com/o2/dup.git' },
        ],
        '/base'
      )
      assert.equal(items[0].name, 'dup')
      assert.equal(items[1].name, 'dup-2')
      assert.notEqual(items[0].path, items[1].path)
    })

    it('honours an explicit preferred name', () => {
      const items = buildBatchCloneItems(
        [{ url: 'https://github.com/o/a.git', name: 'custom' }],
        '/base'
      )
      assert.equal(items[0].name, 'custom')
    })
  })

  describe('summarizeBatchClone', () => {
    const items: ReadonlyArray<IBatchCloneItem> = [
      { url: 'u1', name: 'a', path: 'p1' },
      { url: 'u2', name: 'b', path: 'p2' },
      { url: 'u3', name: 'c', path: 'p3' },
      { url: 'u4', name: 'd', path: 'p4' },
    ]

    it('counts each terminal and active state, defaulting missing to pending', () => {
      const s = summarizeBatchClone(
        items,
        statuses([
          ['p1', { kind: 'done' }],
          ['p2', { kind: 'failed' }],
          ['p3', { kind: 'cloning', progress: 0.5 }],
          // p4 absent -> pending
        ])
      )
      assert.deepEqual(s, {
        total: 4,
        pending: 1,
        cloning: 1,
        done: 1,
        failed: 1,
        skipped: 0,
      })
    })
  })

  describe('computeBatchCloneProgress', () => {
    const items: ReadonlyArray<IBatchCloneItem> = [
      { url: 'u1', name: 'a', path: 'p1' },
      { url: 'u2', name: 'b', path: 'p2' },
    ]

    it('is 1 for an empty batch', () => {
      assert.equal(computeBatchCloneProgress([], new Map()), 1)
    })

    it('counts terminal items as fully complete', () => {
      const p = computeBatchCloneProgress(
        items,
        statuses([
          ['p1', { kind: 'done' }],
          ['p2', { kind: 'failed' }],
        ])
      )
      assert.equal(p, 1)
    })

    it('adds in-flight fractions for cloning items', () => {
      const p = computeBatchCloneProgress(
        items,
        statuses([
          ['p1', { kind: 'done' }],
          ['p2', { kind: 'cloning', progress: 0.5 }],
        ])
      )
      assert.equal(p, 0.75)
    })

    it('treats pending/missing as zero', () => {
      const p = computeBatchCloneProgress(
        items,
        statuses([['p1', { kind: 'done' }]])
      )
      assert.equal(p, 0.5)
    })
  })

  describe('isBatchCloneDone', () => {
    const items: ReadonlyArray<IBatchCloneItem> = [
      { url: 'u1', name: 'a', path: 'p1' },
      { url: 'u2', name: 'b', path: 'p2' },
    ]

    it('is true when all items are terminal', () => {
      assert.equal(
        isBatchCloneDone(
          items,
          statuses([
            ['p1', { kind: 'done' }],
            ['p2', { kind: 'skipped' }],
          ])
        ),
        true
      )
    })

    it('is false while an item is still cloning', () => {
      assert.equal(
        isBatchCloneDone(
          items,
          statuses([
            ['p1', { kind: 'done' }],
            ['p2', { kind: 'cloning', progress: 0.2 }],
          ])
        ),
        false
      )
    })

    it('is false when an item has no status yet', () => {
      assert.equal(
        isBatchCloneDone(items, statuses([['p1', { kind: 'done' }]])),
        false
      )
    })

    it('mode enum has the expected values', () => {
      assert.equal(BatchCloneMode.Parallel, 'parallel')
      assert.equal(BatchCloneMode.Sequential, 'sequential')
    })
  })
})
