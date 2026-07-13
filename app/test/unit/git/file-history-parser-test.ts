import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  FileBlameLineLimit,
  FileHistoryUnavailableError,
  normalizeFileHistoryPath,
  normalizeFileHistoryCommitSHA,
  parseFileBlamePorcelain,
} from '../../../src/lib/git/file-history-parser'

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
	const engine = true
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
	console.log(engine)
`

describe('git/file-history-parser', () => {
  it('accepts only complete SHA-1 and SHA-256 restore sources', () => {
    assert.equal(
      normalizeFileHistoryCommitSHA('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
    assert.equal(normalizeFileHistoryCommitSHA('b'.repeat(64)), 'b'.repeat(64))
    for (const revision of ['HEAD', 'abc123', 'a'.repeat(39), 'g'.repeat(40)]) {
      assert.throws(
        () => normalizeFileHistoryCommitSHA(revision),
        (error: unknown) =>
          error instanceof FileHistoryUnavailableError &&
          error.kind === 'invalid-revision'
      )
    }
  })
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

  it('rejects blame output that would mount too many interactive rows', () => {
    const output = Array.from(
      { length: FileBlameLineLimit + 1 },
      (_, index) =>
        `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ${index + 1} ${
          index + 1
        }\nauthor Ada\nauthor-time 1700000000\nfilename file.ts\n\tline ${
          index + 1
        }`
    ).join('\n')

    assert.throws(
      () => parseFileBlamePorcelain(output, 'file.ts'),
      (error: unknown) =>
        error instanceof FileHistoryUnavailableError &&
        error.kind === 'too-large'
    )
  })
})
