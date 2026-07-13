import assert from 'node:assert'
import { execFileSync } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it } from 'node:test'
import {
  parseRepositoryBisectHead,
  parseRepositoryBisectRefState,
  parseRepositoryBisectRemaining,
  parseRepositoryBisectResolvedRevision,
  prepareRepositoryBisectMark,
  prepareRepositoryBisectRange,
  prepareRepositoryBisectRevision,
  prepareRepositoryBisectStart,
  RepositoryBisectHeadArgs,
  RepositoryBisectRemainingArgs,
  RepositoryBisectResetArgs,
  RepositoryBisectStateArgs,
} from '../../../src/lib/repository-bisect'

function runGit(repository: string, args: ReadonlyArray<string>): string {
  return execFileSync('git', [...args], {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
  })
}

describe('guided bisect against a disposable Git repository', () => {
  it('starts, resumes, marks exact commits, isolates the first bad commit, and resets', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'desktop-bisect-session-'))
    try {
      runGit(repository, ['init', '--initial-branch=main'])
      const commits = new Array<string>()
      for (let value = 0; value < 9; value++) {
        await writeFile(join(repository, 'value.txt'), `${value}\n`)
        runGit(repository, ['add', 'value.txt'])
        runGit(repository, [
          '-c',
          'user.name=Desktop Material Tests',
          '-c',
          'user.email=tests@example.invalid',
          'commit',
          '-m',
          `value ${value}`,
        ])
        commits.push(runGit(repository, ['rev-parse', 'HEAD']).trim())
      }

      const good = parseRepositoryBisectResolvedRevision(
        runGit(repository, prepareRepositoryBisectRevision(commits[0]).args)
      )
      const bad = parseRepositoryBisectResolvedRevision(
        runGit(repository, prepareRepositoryBisectRevision('HEAD').args)
      )
      runGit(repository, prepareRepositoryBisectRange(good, bad).args)
      runGit(repository, prepareRepositoryBisectStart(good, bad).args)

      let state = parseRepositoryBisectRefState(
        runGit(repository, RepositoryBisectStateArgs)
      )
      assert.equal(state.active, true)
      assert.equal(state.badOid, bad)
      assert.ok(state.goodOids.includes(good))

      let isolated: string | null = null
      for (let step = 0; step < 8; step++) {
        const head = parseRepositoryBisectHead(
          runGit(repository, RepositoryBisectHeadArgs)
        )
        const value = Number(
          runGit(repository, ['show', 'HEAD:value.txt']).trim()
        )
        runGit(
          repository,
          prepareRepositoryBisectMark(value < 5 ? 'good' : 'bad', head.oid).args
        )
        state = parseRepositoryBisectRefState(
          runGit(repository, RepositoryBisectStateArgs)
        )
        const remaining = parseRepositoryBisectRemaining(
          runGit(repository, RepositoryBisectRemainingArgs)
        )
        const current = parseRepositoryBisectHead(
          runGit(repository, RepositoryBisectHeadArgs)
        )
        if (remaining <= 1 && current.oid === state.badOid) {
          isolated = current.oid
          break
        }
      }

      assert.equal(isolated, commits[5])
      assert.equal(runGit(repository, ['status', '--porcelain']), '')
      runGit(repository, RepositoryBisectResetArgs)
      assert.deepStrictEqual(
        parseRepositoryBisectRefState(
          runGit(repository, RepositoryBisectStateArgs)
        ),
        { active: false, badOid: null, goodOids: [], skippedOids: [] }
      )
      assert.equal(
        runGit(repository, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
        'main'
      )
      assert.equal(runGit(repository, ['rev-parse', 'HEAD']).trim(), bad)
    } finally {
      await rm(repository, { recursive: true, force: true })
    }
  })

  it('skips only the exact reviewed current commit and still restores safely', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'desktop-bisect-skip-'))
    try {
      runGit(repository, ['init', '--initial-branch=main'])
      const commits = new Array<string>()
      for (let value = 0; value < 4; value++) {
        await writeFile(join(repository, 'value.txt'), `${value}\n`)
        runGit(repository, ['add', 'value.txt'])
        runGit(repository, [
          '-c',
          'user.name=Desktop Material Tests',
          '-c',
          'user.email=tests@example.invalid',
          'commit',
          '-m',
          `step ${value}`,
        ])
        commits.push(runGit(repository, ['rev-parse', 'HEAD']).trim())
      }
      runGit(
        repository,
        prepareRepositoryBisectStart(commits[0], commits[3]).args
      )
      const current = parseRepositoryBisectHead(
        runGit(repository, RepositoryBisectHeadArgs)
      )
      runGit(repository, prepareRepositoryBisectMark('skip', current.oid).args)
      const state = parseRepositoryBisectRefState(
        runGit(repository, RepositoryBisectStateArgs)
      )
      assert.ok(state.skippedOids.includes(current.oid))
      const skipped = runGit(repository, [
        'for-each-ref',
        '--format=%(objectname)',
        'refs/bisect/skip-*',
      ])
        .split(/\r?\n/)
        .filter(Boolean)
      assert.deepStrictEqual(skipped, [current.oid])
      runGit(repository, RepositoryBisectResetArgs)
      assert.equal(runGit(repository, ['rev-parse', 'HEAD']).trim(), commits[3])
    } finally {
      await rm(repository, { recursive: true, force: true })
    }
  })
})
