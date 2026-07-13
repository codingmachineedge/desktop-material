import { describe, it } from 'node:test'
import assert from 'node:assert'
import { writeFile } from 'fs/promises'
import { join } from 'path'

import { Repository } from '../../../src/models/repository'
import {
  FileHistoryUnavailableError,
  getFileBlame,
  getFileHistory,
} from '../../../src/lib/git/file-history'
import { setupFixtureRepository } from '../../helpers/repositories'

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
})
