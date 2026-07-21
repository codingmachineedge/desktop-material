import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  isGitHubAPITabHidden,
  setGitHubAPITabHidden,
} from '../../src/lib/github-api-tab-visibility'

describe('GitHub API tab visibility', () => {
  it('persists a per-repository hide choice and can restore it', () => {
    localStorage.clear()

    assert.equal(isGitHubAPITabHidden('repo-a'), false)
    setGitHubAPITabHidden('repo-a', true)
    assert.equal(isGitHubAPITabHidden('repo-a'), true)
    assert.equal(isGitHubAPITabHidden('repo-b'), false)

    setGitHubAPITabHidden('repo-a', false)
    assert.equal(isGitHubAPITabHidden('repo-a'), false)
  })
})
