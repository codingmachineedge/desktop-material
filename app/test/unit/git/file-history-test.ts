import { describe, it } from 'node:test'
import assert from 'node:assert'
import { writeFile } from 'fs/promises'
import { join } from 'path'

import { Repository } from '../../../src/models/repository'
import {
  FileHistoryUnavailableError,
  getFileBlame,
  getFileHistory,
  normalizeFileHistoryPath,
  parseFileBlamePorcelain,
} from '../../../src/lib/git/file-history'
import { setupFixtureRepository } from '../../helpers/repositories'

const porcelain = `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1
author Ada Lovelace
author-mail <ada@example.com>
author-time 1700000000
author-tz +0000
committer Ada Lovelace
committer-mail <ada@example.com>
committer-time 1700000000
committer-tz +0000
summary Explain the engine
boundary
filename src/engine.ts
\tconst engine = true
0000000000000000000000000000000000000000 2 2 1
author Not Committed Yet
author-mail <not.committed.yet>
author-time 1700000100
author-tz +0000
committer Not Committed Yet
committer-mail <not.committed.yet>
committer-time 1700000100
committer-tz +0000
summary Version of src/engine.ts from src/engine.ts
filename src/engine.ts
\tconsole.log(engine)
`

describe('git/file-history', () => {
  it('contains repository-relative paths before invoking Git', () => {
    assert.equal(
      normalizeFileHistoryPath('C:\\repo', 'src\\feature/file.ts'),
      'src/feature/file.ts'
    )

    for (const path of ['', '..\\secret', 'C:\\secret.txt', 'src/../../x']) {
      assert.throws(
        () => normalizeFileHistoryPath('C:\\repo', path),
        (error: unknown) =>
          error instanceof FileHistoryUnavailableError &&
          error.kind === 'invalid-path'
      )
    }
  })

  it('parses complete per-line blame metadata and working-tree lines', () => {
    const lines = parseFileBlamePorcelain(porcelain, 'fallback.ts')
    assert.equal(lines.length, 2)
    assert.deepEqual(
      {
        shortSha: lines[0].shortSha,
        author: lines[0].authorName,
        email: lines[0].authorEmail,
        path: lines[0].originalPath,
        content: lines[0].content,
        boundary: lines[0].boundary,
      },
      {
        shortSha: 'aaaaaaaa',
        author: 'Ada Lovelace',
        email: 'ada@example.com',
        path: 'src/engine.ts',
        content: 'const engine = true',
        boundary: true,
      }
    )
    assert.equal(lines[1].uncommitted, true)
    assert.equal(lines[1].shortSha, 'Working tree')
  })

  it('rejects incomplete blame records', () => {
    assert.throws(
      () =>
        parseFileBlamePorcelain(
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1\nauthor Ada\n',
          'file.ts'
        ),
      (error: unknown) =>
        error instanceof FileHistoryUnavailableError &&
        error.kind === 'malformed-output'
    )
  })

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
