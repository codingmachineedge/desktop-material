import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  estimateRepositoryBisectSteps,
  normalizeRepositoryBisectObjectId,
  normalizeRepositoryBisectRevision,
  parseRepositoryBisectHead,
  parseRepositoryBisectRefState,
  parseRepositoryBisectRemaining,
  parseRepositoryBisectResolvedRevision,
  parseRepositoryBisectWorktreeClean,
  prepareRepositoryBisectMark,
  prepareRepositoryBisectRange,
  prepareRepositoryBisectRevision,
  prepareRepositoryBisectStart,
  RepositoryBisectHeadArgs,
  RepositoryBisectRemainingArgs,
  RepositoryBisectResetArgs,
  RepositoryBisectStateArgs,
  RepositoryBisectWorktreeArgs,
} from '../../src/lib/repository-bisect'

describe('guided repository bisect contracts', () => {
  it('accepts only named revisions and commit IDs, never revision expressions', () => {
    for (const revision of [
      'HEAD',
      'main',
      'feature/fix',
      'origin/main',
      'refs/heads/main',
      'refs/tags/v1.0',
      'refs/remotes/origin/main',
      'a'.repeat(40),
      'ABCDEF1',
    ]) {
      assert.equal(normalizeRepositoryBisectRevision(revision), revision)
    }
    for (const revision of [
      '',
      '--help',
      'HEAD~2',
      'HEAD^',
      'main..feature',
      'main @{1}',
      'refs/notes/private',
      'refs/heads/../private',
      'main:path',
      'main\0hidden',
    ]) {
      assert.throws(() => normalizeRepositoryBisectRevision(revision))
    }
  })

  it('builds only fixed resolution, ancestry, start, mark, and reset argv', () => {
    const good = 'a'.repeat(40)
    const bad = 'b'.repeat(40)
    assert.deepStrictEqual(prepareRepositoryBisectRevision('main'), {
      revision: 'main',
      args: ['rev-parse', '--verify', '--end-of-options', 'main^{commit}'],
    })
    assert.deepStrictEqual(prepareRepositoryBisectRange(good, bad), {
      goodOid: good,
      badOid: bad,
      args: ['merge-base', '--is-ancestor', good, bad],
    })
    assert.deepStrictEqual(prepareRepositoryBisectStart(good, bad), {
      goodOid: good,
      badOid: bad,
      args: ['bisect', 'start', bad, good],
    })
    assert.deepStrictEqual(prepareRepositoryBisectMark('skip', bad), {
      verdict: 'skip',
      expectedHead: bad,
      args: ['bisect', 'skip', bad],
    })
    assert.deepStrictEqual(RepositoryBisectResetArgs, ['bisect', 'reset'])
    assert.throws(() => prepareRepositoryBisectRange(good, good))
    assert.throws(() => prepareRepositoryBisectMark('run' as 'good', bad))
  })

  it('keeps every inspection bounded and free of editable command input', () => {
    assert.deepStrictEqual(RepositoryBisectStateArgs, [
      'for-each-ref',
      '--format=%(refname)%00%(objectname)',
      'refs/bisect',
    ])
    assert.deepStrictEqual(RepositoryBisectHeadArgs, [
      'show',
      '--no-patch',
      '--format=%H%x00%h%x00%s',
      'HEAD',
    ])
    assert.deepStrictEqual(RepositoryBisectRemainingArgs, [
      'rev-list',
      '--count',
      'refs/bisect/bad',
      '--not',
      '--glob=refs/bisect/good-*',
    ])
    assert.deepStrictEqual(RepositoryBisectWorktreeArgs, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ])
  })

  it('parses inactive and active bisect refs without accepting private surprises', () => {
    const good = 'a'.repeat(40)
    const otherGood = 'b'.repeat(40)
    const bad = 'c'.repeat(40)
    assert.deepStrictEqual(parseRepositoryBisectRefState(''), {
      active: false,
      badOid: null,
      goodOids: [],
      skippedOids: [],
    })
    assert.deepStrictEqual(
      parseRepositoryBisectRefState(
        `refs/bisect/bad\0${bad}\nrefs/bisect/good-${good}\0${good}\nrefs/bisect/good-${otherGood}\0${otherGood}\nrefs/bisect/skip-${bad}\0${bad}\n`
      ),
      {
        active: true,
        badOid: bad,
        goodOids: [good, otherGood],
        skippedOids: [bad],
      }
    )
    for (const output of [
      `refs/bisect/bad\0${bad}\n`,
      `refs/bisect/good-${good}\0${good}\n`,
      `refs/bisect/run\0${bad}\nrefs/bisect/good-${good}\0${good}\n`,
      `refs/bisect/bad\0${bad}\nrefs/bisect/bad\0${bad}\nrefs/bisect/good-${good}\0${good}\n`,
      `refs/bisect/bad\0not-an-object\nrefs/bisect/good-${good}\0${good}\n`,
      `refs/bisect/bad\0${bad}\nrefs/bisect/good-${otherGood}\0${good}\n`,
    ]) {
      assert.throws(() => parseRepositoryBisectRefState(output))
    }
  })

  it('strictly parses the current commit, resolved revision, worktree, and progress', () => {
    const oid = 'd'.repeat(40)
    assert.equal(parseRepositoryBisectResolvedRevision(`${oid}\r\n`), oid)
    assert.equal(normalizeRepositoryBisectObjectId(oid.toUpperCase()), oid)
    assert.deepStrictEqual(
      parseRepositoryBisectHead(`${oid}\0${oid.slice(0, 8)}\0Fix regression\n`),
      {
        oid,
        abbreviatedOid: oid.slice(0, 8),
        subject: 'Fix regression',
      }
    )
    assert.equal(parseRepositoryBisectWorktreeClean(''), true)
    assert.equal(parseRepositoryBisectWorktreeClean('?? fixture.txt\0'), false)
    assert.equal(parseRepositoryBisectRemaining('17\n'), 17)
    assert.equal(estimateRepositoryBisectSteps(17), 5)
    assert.equal(estimateRepositoryBisectSteps(1), 0)
    for (const output of ['', '-1', '1.5', '1000000001', 'secret\n']) {
      assert.throws(() => parseRepositoryBisectRemaining(output))
    }
    assert.throws(() => parseRepositoryBisectHead(`${oid}\0short\0bad\0field`))
    assert.throws(() =>
      parseRepositoryBisectHead(`${oid}\0${oid.slice(0, 8)}\0unsafe\nsubject\n`)
    )
    assert.throws(() => parseRepositoryBisectWorktreeClean('not-nul-ended'))
  })
})
