import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  GitHubPullRequestPendingCommentMaximumItems,
  parseGitHubPullRequestFiles,
  parseGitHubPullRequestReviewComments,
  normalizeGitHubPullRequestPendingComments,
} from '../../src/lib/github-pull-request-workspace'

describe('GitHub pull request review workspace', () => {
  it('parses bounded files and rejects unsafe repository-relative paths', () => {
    assert.deepEqual(
      parseGitHubPullRequestFiles([
        {
          sha: 'a'.repeat(40),
          filename: 'src/review.ts',
          status: 'modified',
          additions: 2,
          deletions: 1,
          changes: 3,
          patch: '@@ -1 +1 @@',
        },
      ])[0].path,
      'src/review.ts'
    )
    assert.throws(() =>
      parseGitHubPullRequestFiles([
        {
          sha: 'a'.repeat(40),
          filename: '../secret.txt',
          status: 'modified',
          additions: 1,
          deletions: 0,
          changes: 1,
        },
      ])
    )
  })

  it('retains outdated inline comments without inventing a current line', () => {
    const comments = parseGitHubPullRequestReviewComments([
      {
        id: 7,
        pull_request_review_id: 5,
        body: 'Outdated context',
        user: { login: 'reviewer' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        path: 'README.md',
        line: null,
        original_line: null,
        side: null,
        in_reply_to_id: null,
        commit_id: 'a'.repeat(40),
        diff_hunk: '@@ -1 +1 @@',
      },
    ])
    assert.equal(comments[0].line, null)
    assert.equal(comments[0].side, null)
  })

  it('bounds and normalizes one combined pending review queue', () => {
    const normalized = normalizeGitHubPullRequestPendingComments(
      [
        {
          path: 'README.md',
          line: 1,
          side: 'RIGHT',
          body: 'Inline',
        },
      ],
      [{ inReplyToId: 7, body: 'Reply' }]
    )
    assert.equal(normalized.comments.length, 1)
    assert.equal(normalized.replies.length, 1)

    assert.throws(() =>
      normalizeGitHubPullRequestPendingComments(
        Array.from(
          { length: GitHubPullRequestPendingCommentMaximumItems },
          (_, index) => ({
            path: `src/file-${index}.ts`,
            line: 1,
            side: 'RIGHT' as const,
            body: 'Inline',
          })
        ),
        [{ inReplyToId: 7, body: 'One too many' }]
      )
    )
  })
})
