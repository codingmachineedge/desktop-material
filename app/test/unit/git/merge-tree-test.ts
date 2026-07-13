import { exec } from 'dugite'
import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  determineMergeability,
  parseMergeTreeOutput,
} from '../../../src/lib/git/merge-tree'
import { Branch, BranchType } from '../../../src/models/branch'
import { ComputedAction } from '../../../src/models/computed-action'
import { setupEmptyRepository } from '../../helpers/repositories'
import { makeCommit } from '../../helpers/repository-scaffolding'

describe('merge-tree preview', () => {
  it('parses bounded conflict paths and escapes display controls', () => {
    const tree = 'a'.repeat(40)
    assert.deepEqual(parseMergeTreeOutput(`${tree}\0`), {
      kind: ComputedAction.Clean,
    })
    assert.deepEqual(
      parseMergeTreeOutput(`${tree}\0src/line\nname.ts\0docs/readme.md\0`),
      {
        kind: ComputedAction.Conflicts,
        conflictedFiles: 2,
        conflictedFilePaths: ['src/line\\x0aname.ts', 'docs/readme.md'],
      }
    )
    assert.deepEqual(parseMergeTreeOutput(`${'b'.repeat(64)}\0`), {
      kind: ComputedAction.Clean,
    })
  })

  it('rejects malformed, duplicated, traversing, and unbounded output', () => {
    const tree = 'a'.repeat(40)
    assert.throws(() => parseMergeTreeOutput('not-a-tree\0'), /invalid/)
    assert.throws(() => parseMergeTreeOutput(tree), /invalid/)
    assert.throws(
      () => parseMergeTreeOutput(`${tree}\0../outside\0`),
      /invalid.*path/
    )
    assert.throws(
      () => parseMergeTreeOutput(`${tree}\0src//file.ts\0`),
      /invalid.*path/
    )
    assert.throws(
      () => parseMergeTreeOutput(`${tree}\0same.txt\0same.txt\0`),
      /path list.*invalid/
    )
    assert.throws(
      () =>
        parseMergeTreeOutput(
          `${tree}\0${Array.from(
            { length: 1_001 },
            (_, index) => `conflict-${index}.txt\0`
          ).join('')}`
        ),
      /too many/
    )
  })

  it('returns exact predicted paths without changing the worktree', async t => {
    const repository = await setupEmptyRepository(t, 'main')
    await makeCommit(repository, {
      entries: [{ path: 'conflict.txt', contents: 'base\n' }],
    })
    await exec(['checkout', '-b', 'feature'], repository.path)
    await makeCommit(repository, {
      entries: [{ path: 'conflict.txt', contents: 'feature\n' }],
    })
    const featureSHA = (
      await exec(['rev-parse', 'HEAD'], repository.path)
    ).stdout.trim()
    await exec(['checkout', 'main'], repository.path)
    await makeCommit(repository, {
      entries: [{ path: 'conflict.txt', contents: 'main\n' }],
    })
    const mainSHA = (
      await exec(['rev-parse', 'HEAD'], repository.path)
    ).stdout.trim()

    const result = await determineMergeability(
      repository,
      new Branch(
        'main',
        null,
        { sha: mainSHA },
        BranchType.Local,
        'refs/heads/main'
      ),
      new Branch(
        'feature',
        null,
        { sha: featureSHA },
        BranchType.Local,
        'refs/heads/feature'
      )
    )
    assert.deepEqual(result, {
      kind: ComputedAction.Conflicts,
      conflictedFiles: 1,
      conflictedFilePaths: ['conflict.txt'],
    })
    assert.equal(
      (await exec(['status', '--porcelain'], repository.path)).stdout,
      ''
    )
  })
})
