import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  parseBitbucketTriagePullRequests,
  parseGitHubTriageIssues,
  parseGitHubTriagePullRequests,
  parseGitLabTriageIssues,
  parseGitLabTriagePullRequests,
  ProviderTriageJSONError,
  ProviderTriageJSONMaximumBytes,
  readBoundedProviderTriageJSON,
} from '../../src/lib/provider-triage-json'

const githubIdentity = { login: 'fixture-bot' }
const gitlabIdentity = { username: 'fixture-bot' }
const bitbucketIdentity = { nickname: 'fixture-bot' }

describe('provider triage bounded JSON', () => {
  it('rejects oversized declared and streamed bodies before projection', async () => {
    assert.equal(ProviderTriageJSONMaximumBytes, 4 * 1024 * 1024)
    const declared = new Response('{}', {
      headers: {
        'content-length': String(ProviderTriageJSONMaximumBytes + 1),
      },
    })
    await assert.rejects(
      readBoundedProviderTriageJSON(declared),
      (error: ProviderTriageJSONError) => error.kind === 'too-large'
    )

    const streamed = new Response(
      'x'.repeat(ProviderTriageJSONMaximumBytes + 1)
    )
    await assert.rejects(
      readBoundedProviderTriageJSON(streamed),
      (error: ProviderTriageJSONError) => error.kind === 'too-large'
    )
  })

  it('rejects invalid lengths and promptly cancels an aborted reader', async () => {
    let invalidLengthCanceled = false
    const invalidLength = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          invalidLengthCanceled = true
        },
      }),
      { headers: { 'content-length': '1e3' } }
    )
    await assert.rejects(
      readBoundedProviderTriageJSON(invalidLength),
      (error: ProviderTriageJSONError) => error.kind === 'invalid-length'
    )
    assert.equal(invalidLengthCanceled, true)

    const controller = new AbortController()
    let abortCanceled = false
    const pending = readBoundedProviderTriageJSON(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            abortCanceled = true
          },
        })
      ),
      controller.signal
    )
    controller.abort()
    await assert.rejects(pending, { name: 'AbortError' })
    assert.equal(abortCanceled, true)
  })

  it('accepts 50 ordinary long-form provider items beneath the hard cap', async () => {
    const values = Array.from({ length: 50 }, (_, index) => ({
      number: index + 1,
      title: `Issue ${index + 1}`,
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-02T00:00:00Z',
      user: githubIdentity,
      body: 'x'.repeat(60 * 1024),
    }))
    const bounded = await readBoundedProviderTriageJSON(
      new Response(JSON.stringify(values))
    )
    const projected = parseGitHubTriageIssues(bounded, 50)
    assert.equal(projected.length, 50)
    assert.doesNotMatch(JSON.stringify(projected), /x{100}/)
  })

  it('strictly projects GitHub issues and omits pull requests from that channel', () => {
    const items = parseGitHubTriageIssues(
      [
        {
          number: 1,
          title: 'Issue',
          created_at: '2026-07-01T00:00:00Z',
          updated_at: '2026-07-02T00:00:00Z',
          user: githubIdentity,
          assignees: [githubIdentity],
          body: 'must not be retained',
          html_url: 'javascript:alert(1)',
        },
        { pull_request: {}, body: 'raw pull request payload' },
      ],
      2
    )
    assert.equal(items.length, 1)
    assert.deepEqual(Object.keys(items[0]).sort(), [
      'assigneeLogins',
      'authorLogin',
      'createdAt',
      'draft',
      'number',
      'reviewRequestedLogins',
      'title',
      'updatedAt',
    ])
    assert.doesNotMatch(JSON.stringify(items), /javascript|must not|raw pull/)
  })

  it('rejects malformed optional draft flags and unbounded nested arrays', () => {
    const githubPullRequest = {
      number: 2,
      title: 'Pull request',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-02T00:00:00Z',
      user: githubIdentity,
      draft: 'false',
    }
    assert.throws(
      () => parseGitHubTriagePullRequests([githubPullRequest], 1),
      ProviderTriageJSONError
    )
    assert.equal(
      parseGitHubTriagePullRequests(
        [{ ...githubPullRequest, draft: undefined }],
        1
      )[0].draft,
      false
    )
    assert.throws(
      () =>
        parseGitHubTriagePullRequests(
          [
            {
              ...githubPullRequest,
              draft: false,
              assignees: Array.from({ length: 51 }, () => githubIdentity),
            },
          ],
          1
        ),
      ProviderTriageJSONError
    )
  })

  it('strictly projects GitLab issues and merge requests', () => {
    const issue = parseGitLabTriageIssues(
      [
        {
          iid: 3,
          title: 'GitLab issue',
          created_at: '2026-07-01T00:00:00Z',
          updated_at: '2026-07-02T00:00:00Z',
          author: gitlabIdentity,
          assignees: [],
        },
      ],
      1
    )[0]
    const mergeRequest = parseGitLabTriagePullRequests(
      [
        {
          iid: 4,
          title: 'GitLab merge request',
          created_at: '2026-07-01T00:00:00Z',
          updated_at: '2026-07-02T00:00:00Z',
          author: gitlabIdentity,
          reviewers: [gitlabIdentity],
          draft: true,
        },
      ],
      1
    )[0]
    assert.equal(issue.number, 3)
    assert.equal(mergeRequest.reviewRequestedLogins[0], 'fixture-bot')
    assert.equal(mergeRequest.draft, true)
  })

  it('strictly projects Bitbucket pages and validates optional pagination', () => {
    const value = {
      values: [
        {
          id: 5,
          title: 'Bitbucket pull request',
          created_on: '2026-07-01T00:00:00Z',
          updated_on: '2026-07-02T00:00:00Z',
          author: bitbucketIdentity,
          reviewers: [bitbucketIdentity],
          participants: [
            { role: 'REVIEWER', user: { nickname: 'pending-reviewer' } },
          ],
          draft: false,
        },
      ],
      next: '',
    }
    const parsed = parseBitbucketTriagePullRequests(value, 1)
    assert.equal(parsed.items[0].number, 5)
    assert.deepEqual(parsed.items[0].reviewRequestedLogins, [
      'fixture-bot',
      'pending-reviewer',
    ])
    assert.equal(parsed.hasNextPage, false)
    assert.throws(
      () => parseBitbucketTriagePullRequests({ ...value, next: {} }, 1),
      ProviderTriageJSONError
    )
  })
})
