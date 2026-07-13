import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Commit } from '../../src/models/commit'
import { CommitIdentity } from '../../src/models/commit-identity'
import { getCommitSearchKeys } from '../../src/lib/commit-search'
import { FilterMode, matchWithMode } from '../../src/lib/fuzzy-find'

const identity = new CommitIdentity(
  'Ada Lovelace',
  'ada@example.com',
  new Date(0)
)

const commit = new Commit(
  '0123456789abcdef',
  '0123456',
  'Ship history tools',
  'Adds the Material commit graph and guarded deletion.',
  identity,
  identity,
  [],
  [],
  ['release-2.0']
)

describe('commit search', () => {
  it('matches title, message, tag, and hashes through the shared pipeline', () => {
    for (const query of [
      'history tools',
      'guarded deletion',
      'release-2.0',
      '0123456',
      '0123456789abcdef',
    ]) {
      const result = matchWithMode(query, [commit], getCommitSearchKeys, {
        mode: FilterMode.Substring,
        caseSensitive: false,
      })
      assert.equal(result.results.length, 1, query)
    }
  })

  it('keeps regex and fuzzy modes available for commit metadata', () => {
    assert.equal(
      matchWithMode('^Ship', [commit], getCommitSearchKeys, {
        mode: FilterMode.Regex,
        caseSensitive: true,
      }).results.length,
      1
    )
    assert.equal(
      matchWithMode('release20', [commit], getCommitSearchKeys, {
        mode: FilterMode.Fuzzy,
        caseSensitive: false,
      }).results.length,
      1
    )
  })
})
