import { describe, it } from 'node:test'
import assert from 'node:assert'
import { exec } from 'dugite'
import { mkdir, readFile, rm, symlink, writeFile } from 'fs/promises'
import { join } from 'path'

import { Repository } from '../../../src/models/repository'
import {
  FileHistoryUnavailableError,
  getFileBlame,
  getFileHistory,
  restoreFileFromCommit,
} from '../../../src/lib/git/file-history'
import { setupFixtureRepository } from '../../helpers/repositories'
import { createTempDirectory } from '../../helpers/temp'

async function setupRestoreRepository(t: import('node:test').TestContext) {
  const base = await createTempDirectory(t)
  const path = join(base, 'repository')
  const outside = join(base, 'outside')
  await mkdir(join(path, 'nested'), { recursive: true })
  await mkdir(outside)
  assert.equal((await exec(['init'], path)).exitCode, 0)
  await exec(['config', 'user.name', 'History Fixture'], path)
  await exec(['config', 'user.email', 'history@example.invalid'], path)
  await writeFile(join(path, 'nested', 'item.txt'), 'committed content')
  await exec(['add', '--', 'nested/item.txt'], path)
  assert.equal(
    (await exec(['commit', '-m', 'history fixture'], path)).exitCode,
    0
  )
  const sha = (await exec(['rev-parse', 'HEAD'], path)).stdout.trim()
  return { path, outside, sha }
}

describe('git/file-history', () => {
  it('follows renames and loads bounded blame from a fixture repository', async t => {
    const path = await setupFixtureRepository(t, 'rename-history-detection')
    const repository = new Repository(path, -1, null, false)

    const history = await getFileHistory(repository, 'NEWER.md')
    assert.equal(history.path, 'NEWER.md')
    assert.equal(history.entries.length, 3)
    assert.equal(history.truncated, false)
    assert.equal(history.entries.at(-1)?.summary, 'added a file')

    const blame = await getFileBlame(repository, 'NEWER.md')
    assert.equal(blame.lines.length, 15)
    assert.equal(blame.lines[0].originalPath, 'OLD.md')
    assert.equal(blame.lines[0].authorName, 'Brendan Forster')
  })

  it('guards untracked, missing, and binary working-tree targets', async t => {
    const path = await setupFixtureRepository(t, 'test-repo-with-tags')
    const repository = new Repository(path, -1, null, false)

    await writeFile(join(path, 'untracked.txt'), 'new')
    await assert.rejects(
      getFileBlame(repository, 'untracked.txt'),
      (error: unknown) =>
        error instanceof FileHistoryUnavailableError &&
        error.kind === 'untracked'
    )
    await assert.rejects(
      getFileBlame(repository, 'missing.txt'),
      (error: unknown) =>
        error instanceof FileHistoryUnavailableError && error.kind === 'missing'
    )

    await writeFile(join(path, 'README.md'), Buffer.from([0, 1, 2, 3]))
    await assert.rejects(
      getFileBlame(repository, 'README.md'),
      (error: unknown) =>
        error instanceof FileHistoryUnavailableError && error.kind === 'binary'
    )
  })

  it('does not start work for a pre-aborted request', async t => {
    const path = await setupFixtureRepository(t, 'test-repo-with-tags')
    const repository = new Repository(path, -1, null, false)
    const controller = new AbortController()
    controller.abort()

    await assert.rejects(
      getFileHistory(repository, 'README.md', controller.signal),
      (error: unknown) =>
        error instanceof FileHistoryUnavailableError && error.kind === 'aborted'
    )
  })

  it('restores a normal nested or missing tracked file inside the worktree', async t => {
    const { path, sha } = await setupRestoreRepository(t)
    const repository = new Repository(path, -1, null, false)

    await writeFile(join(path, 'nested', 'item.txt'), 'working change')
    await restoreFileFromCommit(repository, 'nested/item.txt', sha)
    assert.equal(
      await readFile(join(path, 'nested', 'item.txt'), 'utf8'),
      'committed content'
    )

    await rm(join(path, 'nested', 'item.txt'))
    await restoreFileFromCommit(repository, 'nested/item.txt', sha)
    assert.equal(
      await readFile(join(path, 'nested', 'item.txt'), 'utf8'),
      'committed content'
    )
  })

  it('blocks blame and restore through a directory junction without touching the outside sentinel', async t => {
    const { path, outside, sha } = await setupRestoreRepository(t)
    const repository = new Repository(path, -1, null, false)
    const sentinel = join(outside, 'item.txt')

    await rm(join(path, 'nested'), { recursive: true })
    await writeFile(sentinel, 'outside sentinel')
    await symlink(outside, join(path, 'nested'), 'junction')

    await assert.rejects(
      getFileBlame(repository, 'nested/item.txt'),
      (error: unknown) =>
        error instanceof FileHistoryUnavailableError &&
        error.kind === 'symbolic-link'
    )
    assert.equal(await readFile(sentinel, 'utf8'), 'outside sentinel')

    await assert.rejects(
      restoreFileFromCommit(repository, 'nested/item.txt', sha),
      (error: unknown) =>
        error instanceof FileHistoryUnavailableError &&
        error.kind === 'symbolic-link'
    )
    assert.equal(await readFile(sentinel, 'utf8'), 'outside sentinel')
  })
})
