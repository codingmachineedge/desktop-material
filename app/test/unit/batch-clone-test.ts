import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import {
  BatchCloneMode,
  IBatchCloneState,
  IBatchCloneItem,
  IBatchCloneItemStatus,
  MaxBatchCloneFolderNameLength,
  MaxBatchCloneRawFolderNameLength,
  assertSafeBatchCloneItems,
  batchCloneURLContainsEmbeddedCredentials,
  batchCloneNeedsAttention,
  buildBatchCloneItems,
  computeBatchCloneProgress,
  deriveBatchCloneName,
  isBatchCloneDone,
  summarizeBatchClone,
  sanitizeBatchCloneFolderName,
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
      const accountKey = 'https://api.github.com#2'
      const items = buildBatchCloneItems(
        [
          {
            url: 'https://github.com/o/a.git',
            defaultBranch: 'main',
            accountKey,
          },
          { url: 'https://github.com/o/b.git' },
        ],
        '/base'
      )
      assert.equal(items.length, 2)
      assert.equal(items[0].name, 'a')
      assert.equal(items[0].path, Path.resolve('/base', 'a'))
      assert.equal(items[0].defaultBranch, 'main')
      assert.equal(items[0].accountKey, accountKey)
      assert.equal(items[1].name, 'b')
      assert.equal(items[1].defaultBranch, undefined)
      assert.equal(items[1].accountKey, undefined)
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

    it('sanitizes API names, Windows aliases, and case-insensitive collisions', () => {
      const base = Path.resolve('/base')
      const items = buildBatchCloneItems(
        [
          { url: 'https://example.test/1.git', name: '../escape' },
          { url: 'https://example.test/2.git', name: 'CON .txt' },
          { url: 'https://example.test/3.git', name: 'COM¹' },
          { url: 'https://example.test/4.git', name: 'Repo' },
          { url: 'https://example.test/5.git', name: 'repo' },
          { url: 'https://example.test/6.git', name: 'REPO' },
        ],
        base
      )

      assert.equal(items[1].name, '_CON .txt')
      assert.equal(items[2].name, '_COM¹')
      assert.deepEqual(
        items.slice(3).map(item => item.name),
        ['Repo', 'repo-2', 'REPO-3']
      )
      for (const item of items) {
        const relative = Path.relative(base, item.path)
        assert.equal(Path.dirname(relative), '.')
        assert.ok(relative !== '..' && !relative.startsWith(`..${Path.sep}`))
        assert.equal(relative, item.name)
      }
    })

    it('bounds raw and resolved names and requires an absolute base', () => {
      assert.throws(
        () =>
          buildBatchCloneItems(
            [
              {
                url: 'https://example.test/long.git',
                name: 'x'.repeat(MaxBatchCloneRawFolderNameLength + 1),
              },
            ],
            Path.resolve('/base')
          ),
        /folder name exceeds/i
      )
      assert.throws(
        () =>
          buildBatchCloneItems(
            [{ url: 'https://example.test/a.git' }],
            'relative-clone-directory'
          ),
        /absolute/i
      )

      const taken = new Set<string>(['x'.repeat(MaxBatchCloneFolderNameLength)])
      const suffixed = uniquifyName(
        'x'.repeat(MaxBatchCloneFolderNameLength),
        taken
      )
      assert.ok(Array.from(suffixed).length <= MaxBatchCloneFolderNameLength)
      assert.match(suffixed, /-2$/)
    })

    it('rejects duplicate destinations and queues spanning multiple parents', () => {
      const base = Path.resolve('/base')
      const safe = buildBatchCloneItems(
        [{ url: 'https://example.test/a.git', name: 'a' }],
        base
      )[0]
      assert.throws(
        () =>
          assertSafeBatchCloneItems([
            safe,
            { ...safe, name: 'A', path: Path.join(base, 'A') },
          ]),
        /unsafe or oversized/i
      )
      assert.throws(
        () =>
          assertSafeBatchCloneItems([
            safe,
            {
              url: 'https://example.test/b.git',
              name: 'b',
              path: Path.resolve('/other-base/b'),
            },
          ]),
        /unsafe or oversized/i
      )
    })

    it('normalizes traversal-only and trailing-dot names', () => {
      assert.equal(sanitizeBatchCloneFolderName('..'), 'repository')
      assert.equal(sanitizeBatchCloneFolderName('folder.  '), 'folder')
      assert.equal(sanitizeBatchCloneFolderName('a/b\\c'), 'a-b-c')
    })

    it('rejects credentialed web URLs without echoing their secret', () => {
      const secret = 'super-secret-batch-token'
      const credentialedURLs = [
        `https://x-access-token:${secret}@github.com/owner/repo.git`,
        `https://${secret}@github.com/owner/repo.git`,
        `ftp://user:${secret}@example.test/owner/repo.git`,
        `https:\\\\${secret}@github.com\\owner\\repo.git`,
      ]

      for (const url of credentialedURLs) {
        assert.equal(batchCloneURLContainsEmbeddedCredentials(url), true)
        assert.throws(
          () => buildBatchCloneItems([{ url }], Path.resolve('/base')),
          error =>
            error instanceof Error &&
            /embedded credentials/i.test(error.message) &&
            !error.message.includes(secret)
        )
      }

      assert.equal(
        batchCloneURLContainsEmbeddedCredentials(
          'ssh://git@github.com/owner/repo.git'
        ),
        false
      )
      assert.equal(
        batchCloneURLContainsEmbeddedCredentials(
          'git@github.com:owner/repo.git'
        ),
        false
      )
      assert.equal(
        batchCloneURLContainsEmbeddedCredentials(
          `ssh://git:${secret}@github.com/owner/repo.git`
        ),
        true
      )
    })
  })

  describe('batchCloneNeedsAttention', () => {
    const item: IBatchCloneItem = {
      url: 'https://example.test/a.git',
      name: 'a',
      path: Path.resolve('/base/a'),
    }
    const state = (
      status: IBatchCloneItemStatus,
      overrides: Partial<IBatchCloneState> = {}
    ): IBatchCloneState => ({
      items: [item],
      statuses: new Map([[item.path, status]]),
      mode: BatchCloneMode.Sequential,
      source: 'manual',
      isRunning: false,
      isPaused: false,
      overallProgress: 1,
      isDone: true,
      recoveryUnavailable: false,
      ...overrides,
    })

    it('retains unfinished, failed, reviewed, and unfinalized successful queues', () => {
      assert.equal(batchCloneNeedsAttention(null), false)
      assert.equal(
        batchCloneNeedsAttention(state({ kind: 'pending' }, { isDone: false })),
        true
      )
      assert.equal(batchCloneNeedsAttention(state({ kind: 'failed' })), true)
      assert.equal(batchCloneNeedsAttention(state({ kind: 'review' })), true)
      assert.equal(batchCloneNeedsAttention(state({ kind: 'done' })), true)
      assert.equal(
        batchCloneNeedsAttention(state({ kind: 'done', finalized: true })),
        false
      )
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
        interrupted: 0,
        review: 0,
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
