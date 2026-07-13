import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  GitHubIssueBodyMaximumLength,
  GitHubIssueTitleMaximumLength,
  normalizeGitHubIssueDraft,
  validateCreatedGitHubIssue,
  validateGitHubRepositoryPart,
} from '../../src/lib/github-issue'

describe('GitHub issue validation', () => {
  it('normalizes title whitespace while preserving the exact body', () => {
    assert.deepEqual(normalizeGitHubIssueDraft('  A title  ', ' body\n'), {
      title: 'A title',
      body: ' body\n',
    })
  })

  it('rejects empty and oversized fields without truncating them', () => {
    assert.throws(() => normalizeGitHubIssueDraft(' \n ', ''), /title/i)
    assert.throws(
      () =>
        normalizeGitHubIssueDraft(
          'x'.repeat(GitHubIssueTitleMaximumLength + 1),
          ''
        ),
      /256/
    )
    assert.throws(
      () =>
        normalizeGitHubIssueDraft(
          'A title',
          'x'.repeat(GitHubIssueBodyMaximumLength + 1)
        ),
      /65536/
    )
  })

  it('rejects unsafe repository path parts', () => {
    for (const value of ['', '.', '..', 'owner/repository', 'owner name']) {
      assert.throws(() => validateGitHubRepositoryPart(value, 'owner'))
    }
    assert.equal(
      validateGitHubRepositoryPart('desktop-test', 'owner'),
      'desktop-test'
    )
    assert.equal(
      validateGitHubRepositoryPart('desktop_material.js', 'repository'),
      'desktop_material.js'
    )
  })

  it('accepts only the exact GitHub.com issue URL', () => {
    assert.deepEqual(
      validateCreatedGitHubIssue(
        {
          number: 42,
          title: 'Created',
          body: null,
          html_url: 'https://github.com/desktop/desktop/issues/42',
          state: 'open',
        },
        'desktop',
        'desktop',
        'https://github.com'
      ),
      {
        number: 42,
        title: 'Created',
        url: 'https://github.com/desktop/desktop/issues/42',
      }
    )
  })

  it('supports an enterprise base path and rejects redirects or credentials', () => {
    const issue = {
      number: 7,
      title: 'Created',
      body: '',
      html_url: 'https://github.example.test/code/team/repo/issues/7',
      state: 'open',
    }
    assert.equal(
      validateCreatedGitHubIssue(
        issue,
        'team',
        'repo',
        'https://github.example.test/code'
      ).url,
      issue.html_url
    )

    for (const html_url of [
      'https://evil.example.test/team/repo/issues/7',
      'https://user:password@github.example.test/code/team/repo/issues/7',
      'https://github.example.test/code/team/repo/issues/8',
      'https://github.example.test/code/team/repo/issues/7?next=evil',
    ]) {
      assert.throws(() =>
        validateCreatedGitHubIssue(
          { ...issue, html_url },
          'team',
          'repo',
          'https://github.example.test/code'
        )
      )
    }
  })
})
