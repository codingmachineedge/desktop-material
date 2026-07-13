import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  getGitHubIssueFingerprint,
  getGitHubIssueMutationFingerprint,
  GitHubIssueMaximumPages,
  GitHubIssuePageSize,
  normalizeGitHubIssueComment,
  normalizeGitHubIssueQuery,
  normalizeGitHubIssueUpdate,
  parseGitHubIssue,
  parseGitHubIssueCommentList,
  parseGitHubIssueList,
} from '../../src/lib/github-issues'

const label = (id: number = 1, name: string = 'bug') => ({
  id,
  name,
  color: 'd73a4a',
  description: 'Something is not working',
})

const issue = (issueNumber: number = 7) => ({
  id: 1000 + issueNumber,
  number: issueNumber,
  title: `Issue ${issueNumber}`,
  body: 'A bounded issue body.',
  state: 'open',
  state_reason: null,
  user: { login: 'fixture-author' },
  created_at: '2026-07-13T10:00:00Z',
  updated_at: '2026-07-13T11:00:00Z',
  closed_at: null,
  html_url: `https://github.com/desktop/material/issues/${issueNumber}`,
  labels: [label()],
  assignees: [{ login: 'fixture-maintainer' }],
  milestone: {
    number: 3,
    title: 'Next milestone',
    state: 'open',
    due_on: null,
  },
  comments: 2,
  locked: false,
})

const query = {
  state: 'all' as const,
  search: '',
  labels: [] as ReadonlyArray<string>,
  assignee: null,
  milestone: null,
  sort: 'updated' as const,
  direction: 'desc' as const,
  page: 1,
}

describe('GitHub Issues model', () => {
  it('validates full issue detail and exact provider links', () => {
    const parsed = parseGitHubIssue(
      issue(),
      7,
      'desktop',
      'material',
      'https://github.com'
    )
    assert.equal(parsed.number, 7)
    assert.equal(parsed.authorLogin, 'fixture-author')
    assert.deepEqual(
      parsed.labels.map(x => x.name),
      ['bug']
    )
    assert.deepEqual(parsed.assignees, ['fixture-maintainer'])
    assert.equal(parsed.milestone?.title, 'Next milestone')
    assert.equal(parsed.url, 'https://github.com/desktop/material/issues/7')

    assert.throws(() =>
      parseGitHubIssue(
        { ...issue(), html_url: 'https://attacker.invalid/token' },
        7,
        'desktop',
        'material',
        'https://github.com'
      )
    )
    assert.throws(() =>
      parseGitHubIssue(
        {
          ...issue(),
          html_url: 'https://github.com/desktop/material/issues/8',
        },
        7,
        'desktop',
        'material',
        'https://github.com'
      )
    )
  })

  it('filters PR-shaped results while deriving pagination from the raw page', () => {
    const page = Array.from({ length: GitHubIssuePageSize }, (_, index) =>
      index === 0
        ? { ...issue(index + 1), pull_request: { url: 'not-rendered' } }
        : issue(index + 1)
    )
    const parsed = parseGitHubIssueList(
      page,
      query,
      'desktop',
      'material',
      'https://github.com'
    )
    assert.equal(parsed.issues.length, GitHubIssuePageSize - 1)
    assert.equal(parsed.nextPage, 2)

    const capped = parseGitHubIssueList(
      page,
      { ...query, page: GitHubIssueMaximumPages },
      'desktop',
      'material',
      'https://github.com'
    )
    assert.equal(capped.nextPage, null)
    assert.equal(capped.capped, true)
  })

  it('validates bounded search results and rejects raw payload hazards', () => {
    const parsed = parseGitHubIssueList(
      {
        total_count: 1,
        incomplete_results: false,
        items: [issue()],
      },
      { ...query, search: 'render problem' },
      'desktop',
      'material',
      'https://github.com'
    )
    assert.equal(parsed.issues[0].title, 'Issue 7')
    assert.equal(parsed.incomplete, false)

    assert.throws(() =>
      parseGitHubIssueList(
        Array.from({ length: GitHubIssuePageSize + 1 }, (_, index) =>
          issue(index + 1)
        ),
        query,
        'desktop',
        'material',
        'https://github.com'
      )
    )
    assert.throws(() =>
      parseGitHubIssue(
        { ...issue(), body: 'x'.repeat(65_537) },
        7,
        'desktop',
        'material',
        'https://github.com'
      )
    )
    assert.throws(() =>
      parseGitHubIssue(
        { ...issue(), title: 'unsafe\u0000title' },
        7,
        'desktop',
        'material',
        'https://github.com'
      )
    )

    const richlyAssigned = parseGitHubIssue(
      {
        ...issue(),
        labels: Array.from({ length: 25 }, (_, index) =>
          label(index + 1, `label-${index + 1}`)
        ),
        assignees: Array.from({ length: 25 }, (_, index) => ({
          login: `fixture-${index + 1}`,
        })),
      },
      7,
      'desktop',
      'material',
      'https://github.com'
    )
    assert.equal(richlyAssigned.labels.length, 25)
    assert.equal(richlyAssigned.assignees.length, 25)
  })

  it('validates comment pages and exact comment anchors', () => {
    const comments = parseGitHubIssueCommentList(
      [
        {
          id: 55,
          body: 'Reviewed comment',
          user: { login: 'fixture-reviewer' },
          created_at: '2026-07-13T12:00:00Z',
          updated_at: '2026-07-13T12:00:00Z',
          html_url:
            'https://github.com/desktop/material/issues/7#issuecomment-55',
        },
      ],
      1,
      'desktop',
      'material',
      7,
      'https://github.com'
    )
    assert.equal(comments.comments[0].authorLogin, 'fixture-reviewer')
    assert.throws(() =>
      parseGitHubIssueCommentList(
        [
          {
            id: 55,
            body: 'Comment',
            user: { login: 'fixture-reviewer' },
            created_at: '2026-07-13T12:00:00Z',
            updated_at: '2026-07-13T12:00:00Z',
            html_url:
              'https://github.com/desktop/material/issues/7#issuecomment-56',
          },
        ],
        1,
        'desktop',
        'material',
        7,
        'https://github.com'
      )
    )
  })

  it('normalizes reviewed filters, metadata updates, and comments', () => {
    assert.deepEqual(
      normalizeGitHubIssueQuery({
        ...query,
        search: '  crash is:pr  ',
        labels: ['bug'],
        assignee: 'fixture-maintainer',
        milestone: null,
      }),
      {
        ...query,
        search: 'crash is:pr',
        labels: ['bug'],
        assignee: 'fixture-maintainer',
        milestone: null,
      }
    )
    assert.deepEqual(
      normalizeGitHubIssueUpdate({
        title: '  Updated title  ',
        body: 'Preserve body whitespace.\n',
        labels: ['bug'],
        assignees: ['fixture-maintainer'],
        milestone: 3,
      }),
      {
        title: 'Updated title',
        body: 'Preserve body whitespace.\n',
        labels: ['bug'],
        assignees: ['fixture-maintainer'],
        milestone: 3,
      }
    )
    assert.equal(
      normalizeGitHubIssueComment('A reviewed comment.'),
      'A reviewed comment.'
    )
    assert.throws(() => normalizeGitHubIssueComment('   '))
    assert.throws(() =>
      normalizeGitHubIssueQuery({ ...query, labels: ['bug', 'bug'] })
    )
    assert.throws(() =>
      normalizeGitHubIssueQuery({
        ...query,
        search: 'crash',
        milestone: 3,
      })
    )
  })

  it('fingerprints every remotely mutable and concurrency-relevant field', () => {
    const parsed = parseGitHubIssue(
      issue(),
      7,
      'desktop',
      'material',
      'https://github.com'
    )
    const fingerprint = getGitHubIssueFingerprint(parsed)
    assert.match(fingerprint, /^sha256:[a-f0-9]{64}$/)
    assert.doesNotMatch(fingerprint, /Issue 7|bounded issue|github\.com/)
    assert.notEqual(
      fingerprint,
      getGitHubIssueFingerprint({ ...parsed, body: 'Changed remotely' })
    )
    assert.notEqual(
      getGitHubIssueFingerprint(parsed),
      getGitHubIssueFingerprint({
        ...parsed,
        commentCount: parsed.commentCount + 1,
      })
    )
    const update = {
      title: parsed.title,
      body: parsed.body,
      labels: parsed.labels.map(x => x.name),
      assignees: parsed.assignees,
      milestone: parsed.milestone?.number ?? null,
    }
    assert.match(
      getGitHubIssueMutationFingerprint('update', update),
      /^sha256:[a-f0-9]{64}$/
    )
    assert.notEqual(
      getGitHubIssueMutationFingerprint('comment', 'First comment'),
      getGitHubIssueMutationFingerprint('comment', 'Second comment')
    )
    assert.throws(() =>
      getGitHubIssueMutationFingerprint('close', 'unexpected')
    )
  })
})
