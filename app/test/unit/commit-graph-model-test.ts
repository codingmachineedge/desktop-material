import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Commit } from '../../src/models/commit'
import { CommitIdentity } from '../../src/models/commit-identity'
import { buildCommitGraphRows } from '../../src/ui/history/commit-graph-model'

const identity = new CommitIdentity('Test', 'test@example.com', new Date(0))

function makeCommit(sha: string, parentSHAs: ReadonlyArray<string>) {
  return new Commit(sha, sha, sha, '', identity, identity, parentSHAs, [], [])
}

describe('commit graph model', () => {
  it('keeps a linear first-parent history in one lane', () => {
    const rows = buildCommitGraphRows([
      makeCommit('c', ['b']),
      makeCommit('b', ['a']),
      makeCommit('a', []),
    ])

    assert.deepEqual(
      rows.map(row => row.column),
      [0, 0, 0]
    )
    assert.equal(rows[0].hasTopLine, false)
    assert.equal(rows[1].hasTopLine, true)
  })

  it('opens and rejoins a lane for a merge parent', () => {
    const rows = buildCommitGraphRows([
      makeCommit('merge', ['main', 'topic']),
      makeCommit('main', ['base']),
      makeCommit('topic', ['base']),
      makeCommit('base', []),
    ])

    assert.equal(rows[0].connections.length, 2)
    assert.deepEqual(
      rows[0].connections.map(path => path.toColumn),
      [0, 1]
    )
    assert.equal(rows[2].column, 1)
    assert.equal(rows[3].column, 0)
    assert.equal(rows[3].hasTopLine, true)
  })
})
