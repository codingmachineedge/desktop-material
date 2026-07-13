import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFile, writeFile } from 'fs/promises'
import * as Path from 'path'
import { exec } from 'dugite'

import {
  abortStructuredCommitRewrite,
  createStructuredCommitRewritePlan,
  executeStructuredCommitRewrite,
  getCommits,
  getRebaseInternalState,
  inspectStructuredCommitRewrite,
  RebaseResult,
  StructuredCommitRewriteError,
} from '../../../src/lib/git'
import { Repository } from '../../../src/models/repository'
import { setupEmptyRepositoryDefaultMain } from '../../helpers/repositories'
import { makeCommit, switchTo } from '../../helpers/repository-scaffolding'

async function revParse(repository: Repository, revision = 'HEAD') {
  const result = await exec(['rev-parse', revision], repository.path)
  assert.equal(result.exitCode, 0)
  return result.stdout.trim()
}

async function configureSyntheticUpstream(repository: Repository, sha: string) {
  const commands = [
    ['update-ref', 'refs/remotes/origin/main', sha],
    ['config', 'remote.origin.url', 'https://example.invalid/repository.git'],
    ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'],
    ['config', 'branch.main.remote', 'origin'],
    ['config', 'branch.main.merge', 'refs/heads/main'],
  ]
  for (const args of commands) {
    const result = await exec(args, repository.path)
    assert.equal(result.exitCode, 0, result.stderr)
  }
}

async function commitFile(
  repository: Repository,
  name: string,
  contents = name
) {
  await makeCommit(repository, {
    entries: [{ path: `${name}.txt`, contents }],
    commitMessage: name,
  })
  return revParse(repository)
}

async function setupLinearLocalRange(repository: Repository) {
  await commitFile(repository, 'base')
  const baseSha = await revParse(repository)
  await configureSyntheticUpstream(repository, baseSha)
  const first = await commitFile(repository, 'first')
  const second = await commitFile(repository, 'second')
  const third = await commitFile(repository, 'third')
  return { baseSha, first, second, third }
}

function assertRewriteError(error: unknown, code: string) {
  assert(error instanceof StructuredCommitRewriteError)
  assert.equal(error.code, code)
  return true
}

describe('git/structured-commit-rewrite', () => {
  it('inspects only bounded display metadata and rewrites reorder/fold/drop', async t => {
    const repository = await setupEmptyRepositoryDefaultMain(t)
    const { baseSha, first, second, third } = await setupLinearLocalRange(
      repository
    )
    const inspection = await inspectStructuredCommitRewrite(repository)

    assert.equal(inspection.baseSha, baseSha)
    assert.equal(inspection.headSha, third)
    assert.deepStrictEqual(
      inspection.commits.map(commit => [commit.sha, commit.summary]),
      [
        [first, 'first'],
        [second, 'second'],
        [third, 'third'],
      ]
    )
    assert.deepStrictEqual(Object.keys(inspection.commits[0]).sort(), [
      'sha',
      'summary',
    ])

    const result = await executeStructuredCommitRewrite(
      repository,
      inspection,
      [
        { sha: second, action: 'pick' },
        { sha: first, action: 'fixup' },
        { sha: third, action: 'drop' },
      ]
    )
    assert.equal(result, RebaseResult.CompletedWithoutError)

    const log = await getCommits(repository, `${baseSha}..HEAD`, 5)
    assert.equal(log.length, 1)
    assert.equal(log[0].summary, 'second')
    assert.equal(
      await readFile(Path.join(repository.path, 'first.txt'), 'utf8'),
      'first'
    )
    assert.equal(
      await readFile(Path.join(repository.path, 'second.txt'), 'utf8'),
      'second'
    )
    await assert.rejects(readFile(Path.join(repository.path, 'third.txt')))
  })

  it('revalidates the exact branch tip immediately before mutation', async t => {
    const repository = await setupEmptyRepositoryDefaultMain(t)
    await setupLinearLocalRange(repository)
    const inspection = await inspectStructuredCommitRewrite(repository)
    const originalPlan = createStructuredCommitRewritePlan(inspection)
    const changedPlan = [
      originalPlan[1],
      originalPlan[0],
      ...originalPlan.slice(2),
    ]

    await commitFile(repository, 'raced')
    const racedHead = await revParse(repository)
    await assert.rejects(
      executeStructuredCommitRewrite(repository, inspection, changedPlan),
      error => assertRewriteError(error, 'stale-review')
    )
    assert.equal(await revParse(repository), racedHead)
    assert.equal(await getRebaseInternalState(repository), null)
  })

  it('rejects dirty, detached, no-upstream, and non-linear ranges', async t => {
    const noUpstream = await setupEmptyRepositoryDefaultMain(t)
    await commitFile(noUpstream, 'initial')
    await assert.rejects(inspectStructuredCommitRewrite(noUpstream), error =>
      assertRewriteError(error, 'no-upstream')
    )

    const dirty = await setupEmptyRepositoryDefaultMain(t)
    await setupLinearLocalRange(dirty)
    await writeFile(Path.join(dirty.path, 'untracked.txt'), 'dirty')
    await assert.rejects(inspectStructuredCommitRewrite(dirty), error =>
      assertRewriteError(error, 'dirty')
    )

    const detached = await setupEmptyRepositoryDefaultMain(t)
    await setupLinearLocalRange(detached)
    await exec(['checkout', '--detach'], detached.path)
    await assert.rejects(inspectStructuredCommitRewrite(detached), error =>
      assertRewriteError(error, 'detached')
    )

    const nonLinear = await setupEmptyRepositoryDefaultMain(t)
    await commitFile(nonLinear, 'merge-base')
    const baseSha = await revParse(nonLinear)
    await configureSyntheticUpstream(nonLinear, baseSha)
    await exec(['branch', 'topic', baseSha], nonLinear.path)
    await commitFile(nonLinear, 'main-change')
    await switchTo(nonLinear, 'topic')
    await commitFile(nonLinear, 'topic-change')
    await switchTo(nonLinear, 'main')
    const merge = await exec(
      ['merge', '--no-ff', '--no-edit', 'topic'],
      nonLinear.path
    )
    assert.equal(merge.exitCode, 0, merge.stderr)
    await assert.rejects(inspectStructuredCommitRewrite(nonLinear), error =>
      assertRewriteError(error, 'non-linear')
    )
  })

  it('leaves conflicts recoverable and abort restores the reviewed tip', async t => {
    const repository = await setupEmptyRepositoryDefaultMain(t)
    await makeCommit(repository, {
      entries: [{ path: 'shared.txt', contents: 'base\n' }],
      commitMessage: 'base',
    })
    const baseSha = await revParse(repository)
    await configureSyntheticUpstream(repository, baseSha)
    await makeCommit(repository, {
      entries: [{ path: 'shared.txt', contents: 'first\n' }],
      commitMessage: 'first',
    })
    await makeCommit(repository, {
      entries: [{ path: 'shared.txt', contents: 'second\n' }],
      commitMessage: 'second',
    })
    const originalHead = await revParse(repository)
    const inspection = await inspectStructuredCommitRewrite(repository)

    const result = await executeStructuredCommitRewrite(
      repository,
      inspection,
      [...createStructuredCommitRewritePlan(inspection)].reverse()
    )
    assert.equal(result, RebaseResult.ConflictsEncountered)
    assert.notEqual(await getRebaseInternalState(repository), null)

    await abortStructuredCommitRewrite(repository)
    assert.equal(await revParse(repository), originalHead)
    assert.equal(await getRebaseInternalState(repository), null)
    assert.equal(
      (
        await readFile(Path.join(repository.path, 'shared.txt'), 'utf8')
      ).replace(/\r\n/g, '\n'),
      'second\n'
    )
  })
})
