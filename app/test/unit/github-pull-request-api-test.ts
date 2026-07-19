import assert from 'node:assert'
import { describe, it } from 'node:test'

import { API } from '../../src/lib/api'

const headSHA = 'a'.repeat(40)

function lifecycleResponse(state: 'open' | 'closed' = 'open') {
  return {
    number: 42,
    title: 'Native PR',
    body: 'Description',
    html_url: 'https://github.com/desktop/material/pull/42',
    state,
    draft: false,
    merged: false,
    mergeable: true,
    mergeable_state: 'clean',
    head: {
      ref: 'feature/native',
      sha: headSHA,
      repo: { full_name: 'octocat/material' },
    },
    base: { ref: 'main' },
    requested_reviewers: [],
    assignees: [],
    labels: [],
  }
}

describe('GitHub pull request API', () => {
  it('posts only the reviewed fields and propagates the exact abort signal', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const controller = new AbortController()
    let request:
      | {
          method: string
          path: string
          body?: Object
          headers: Headers
          signal?: AbortSignal
        }
      | undefined

    Reflect.set(
      api,
      'ghRequest',
      async (
        method: string,
        path: string,
        options?: {
          body?: Object
          customHeaders?: HeadersInit
          signal?: AbortSignal
        }
      ) => {
        request = {
          method,
          path,
          body: options?.body,
          headers: new Headers(options?.customHeaders),
          signal: options?.signal,
        }
        return new Response(
          JSON.stringify({
            number: 42,
            title: 'Native PR',
            body: 'Description',
            html_url: 'https://github.com/desktop/material/pull/42',
            state: 'open',
            draft: true,
            head: { ref: 'feature/native', label: 'octocat:feature/native' },
            base: { ref: 'main' },
          }),
          { status: 201 }
        )
      }
    )

    const result = await api.createPullRequest(
      'desktop',
      'material',
      '  Native PR  ',
      'Description',
      'octocat:feature/native',
      'main',
      true,
      controller.signal
    )

    assert.deepEqual(request, {
      method: 'POST',
      path: 'repos/desktop/material/pulls',
      body: {
        title: 'Native PR',
        body: 'Description',
        head: 'octocat:feature/native',
        base: 'main',
        draft: true,
      },
      headers: new Headers({ Accept: 'application/vnd.github+json' }),
      signal: controller.signal,
    })
    assert.deepEqual(result, {
      number: 42,
      title: 'Native PR',
      url: 'https://github.com/desktop/material/pull/42',
      draft: true,
    })
  })

  it('discovers bounded templates and paginated creation metadata without following provider URLs', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const paths = new Array<string>()
    const template = [
      '---',
      'name: Secure review',
      'title: Reviewed default',
      'reviewers: octocat',
      'labels: ready',
      'milestone: 7',
      'draft: true',
      '---',
      '## Summary',
    ].join('\n')
    const contentResponse = {
      type: 'file',
      path: '.github/pull_request_template.md',
      encoding: 'base64',
      size: Buffer.byteLength(template),
      content: Buffer.from(template).toString('base64'),
      download_url: 'https://evil.example.test/template.md',
    }
    Reflect.set(api, 'ghRequest', async (_method: string, path: string) => {
      paths.push(path)
      if (path.includes('/labels?')) {
        return new Response(
          JSON.stringify([
            { id: 1, name: 'ready', color: '0969da', description: null },
          ])
        )
      }
      if (path.includes('/assignees?')) {
        return new Response(JSON.stringify([{ login: 'octocat' }]))
      }
      if (path.includes('/milestones?')) {
        return new Response(
          JSON.stringify([
            { number: 7, title: 'Ship', state: 'open', due_on: null },
          ])
        )
      }
      if (path.includes('/collaborators?')) {
        return new Response(
          JSON.stringify(
            path.endsWith('page=1')
              ? Array.from({ length: 100 }, (_, index) => ({
                  login: `reviewer-${index + 1}`,
                }))
              : [{ login: 'octocat' }]
          )
        )
      }
      if (path.includes('/contents/.github/pull_request_template.md?')) {
        return new Response(JSON.stringify(contentResponse))
      }
      return new Response(JSON.stringify({ message: 'missing' }), {
        status: 404,
      })
    })

    const context = await api.inspectPullRequestCreation(
      'desktop',
      'material',
      'main'
    )
    assert.equal(context.templates.length, 1)
    assert.equal(context.templates[0].name, 'Secure review')
    assert.equal(context.templates[0].body, '## Summary')
    assert.equal(context.templates[0].metadata.milestone, 7)
    assert.equal(context.reviewers.length, 101)
    assert.equal(context.reviewers[100], 'octocat')
    assert.equal(context.labels[0].name, 'ready')
    assert.equal(context.milestones[0].title, 'Ship')
    assert.equal(
      paths.filter(path =>
        path.includes('/contents/.github/pull_request_template.md?')
      ).length,
      2
    )
    assert.equal(
      paths.some(path => path.includes('evil.example.test')),
      false
    )
    assert.ok(
      paths.some(
        path => path.includes('/collaborators?') && path.endsWith('page=2')
      )
    )
  })

  it('keeps core creation available when optional provider capabilities are permission-gated', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    Reflect.set(api, 'ghRequest', async (_method: string, path: string) => {
      if (
        path.includes('/labels?') ||
        path.includes('/assignees?') ||
        path.includes('/milestones?')
      ) {
        return new Response('[]')
      }
      return new Response(JSON.stringify({ message: 'permission denied' }), {
        status: 403,
      })
    })

    const context = await api.inspectPullRequestCreation(
      'desktop',
      'material',
      'main'
    )
    assert.deepEqual(context.templates, [])
    assert.deepEqual(context.reviewers, [])
    assert.ok(context.unavailable.includes('templates'))
    assert.ok(context.unavailable.includes('reviewers'))
    assert.equal(context.warnings.length, 2)
  })

  it('reports metadata partial success after creating the reviewed pull request', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const requests = new Array<{
      readonly method: string
      readonly path: string
      readonly body?: Object
    }>()
    Reflect.set(
      api,
      'ghRequest',
      async (
        method: string,
        path: string,
        options?: { readonly body?: Object }
      ) => {
        requests.push({ method, path, body: options?.body })
        if (method === 'POST' && path.endsWith('/pulls')) {
          return new Response(
            JSON.stringify({
              number: 42,
              title: 'Metadata PR',
              body: '',
              html_url: 'https://github.com/desktop/material/pull/42',
              state: 'open',
              draft: false,
              head: { ref: 'feature', label: 'desktop:feature' },
              base: { ref: 'main' },
            }),
            { status: 201 }
          )
        }
        if (path.endsWith('/requested_reviewers')) {
          return new Response('{}')
        }
        if (method === 'PATCH' && path.endsWith('/issues/42')) {
          return new Response(JSON.stringify({ message: 'denied' }), {
            status: 403,
          })
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      }
    )

    const result = await api.createPullRequest(
      'desktop',
      'material',
      'Metadata PR',
      '',
      'feature',
      'main',
      false,
      undefined,
      undefined,
      {
        reviewers: ['reviewer'],
        assignees: ['octocat'],
        labels: ['ready'],
        milestone: 7,
      }
    )
    assert.equal(result.number, 42)
    assert.deepEqual(result.metadataWarnings, [
      'The pull request was created, but assignees, labels, or milestone were not applied.',
    ])
    assert.deepEqual(
      requests.find(request => request.path.endsWith('/issues/42'))?.body,
      { assignees: ['octocat'], labels: ['ready'], milestone: 7 }
    )
  })

  it('rejects invalid input and pre-cancellation before any request', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    let requestCount = 0
    Reflect.set(api, 'ghRequest', async () => {
      requestCount++
      return new Response('{}')
    })

    await assert.rejects(() =>
      api.createPullRequest(
        'desktop',
        'repo/name',
        'Title',
        '',
        'feature',
        'main',
        false
      )
    )
    await assert.rejects(() =>
      api.createPullRequest(
        'desktop',
        'material',
        'Title',
        '',
        'main',
        'main',
        false
      )
    )

    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      () =>
        api.createPullRequest(
          'desktop',
          'material',
          'Title',
          '',
          'feature',
          'main',
          false,
          controller.signal
        ),
      error => error instanceof DOMException && error.name === 'AbortError'
    )
    assert.equal(requestCount, 0)
  })

  it('rejects a success response whose provider URL is not exact', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response(
          JSON.stringify({
            number: 42,
            title: 'Native PR',
            body: '',
            html_url: 'https://evil.example.test/desktop/material/pull/42',
            state: 'open',
            draft: false,
            head: { ref: 'feature', label: 'desktop:feature' },
            base: { ref: 'main' },
          }),
          { status: 201 }
        )
    )

    await assert.rejects(
      () =>
        api.createPullRequest(
          'desktop',
          'material',
          'Native PR',
          '',
          'feature',
          'main',
          false
        ),
      /unexpected pull request URL/i
    )
  })

  it('rejects a success response that differs from the reviewed request', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response(
          JSON.stringify({
            number: 42,
            title: 'Different title',
            body: 'Reviewed body',
            html_url: 'https://github.com/desktop/material/pull/42',
            state: 'open',
            draft: false,
            head: { ref: 'feature', label: 'desktop:feature' },
            base: { ref: 'main' },
          }),
          { status: 201 }
        )
    )

    await assert.rejects(
      () =>
        api.createPullRequest(
          'desktop',
          'material',
          'Reviewed title',
          'Reviewed body',
          'feature',
          'main',
          false
        ),
      /do not match the reviewed request/i
    )
  })

  it('loads independently paginated, bounded review workspace collections', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const paths = new Array<string>()
    const file = (index: number) => ({
      sha: 'b'.repeat(40),
      filename: `src/file-${index}.ts`,
      previous_filename: null,
      status: 'modified',
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: '@@ -1 +1 @@\n-old\n+new',
    })
    Reflect.set(api, 'ghRequest', async (_method: string, path: string) => {
      paths.push(path)
      if (path === 'repos/desktop/material/pulls/42') {
        return new Response(JSON.stringify(lifecycleResponse()))
      }
      if (path.endsWith('/files?per_page=50&page=1')) {
        return new Response(
          JSON.stringify(Array.from({ length: 50 }, (_, index) => file(index))),
          {
            headers: {
              Link: '<https://api.github.com/repos/desktop/material/pulls/42/files?per_page=50&page=2>; rel="next"',
            },
          }
        )
      }
      if (path.endsWith('/files?per_page=50&page=2')) {
        return new Response(JSON.stringify([file(50)]))
      }
      if (path.endsWith('/commits?per_page=50&page=1')) {
        return new Response(
          JSON.stringify([
            {
              sha: headSHA,
              author: { login: 'octocat' },
              commit: {
                message: 'Workspace commit',
                author: {
                  name: 'Octo Cat',
                  date: '2026-01-01T00:00:00Z',
                },
              },
            },
          ])
        )
      }
      if (path.endsWith('/reviews?per_page=50&page=1')) {
        return new Response(
          JSON.stringify([
            {
              id: 5,
              user: { login: 'reviewer' },
              body: 'Review',
              state: 'COMMENTED',
              submitted_at: '2026-01-01T00:00:00Z',
              commit_id: headSHA,
            },
          ])
        )
      }
      if (path.endsWith('/issues/42/comments?per_page=50&page=1')) {
        return new Response(
          JSON.stringify([
            {
              id: 6,
              user: { login: 'commenter' },
              body: 'Conversation',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          ])
        )
      }
      if (path.endsWith('/pulls/42/comments?per_page=50&page=1')) {
        return new Response(
          JSON.stringify([
            {
              id: 7,
              pull_request_review_id: 5,
              user: { login: 'reviewer' },
              body: 'Inline',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
              path: 'src/file-0.ts',
              line: 1,
              side: 'RIGHT',
              start_line: null,
              in_reply_to_id: null,
              commit_id: headSHA,
              diff_hunk: '@@ -1 +1 @@',
            },
          ])
        )
      }
      throw new Error(`Unexpected path: ${path}`)
    })

    const workspace = await api.inspectPullRequestWorkspace(
      'desktop',
      'material',
      42,
      headSHA
    )
    assert.equal(workspace.files.length, 51)
    assert.equal(workspace.commits[0].message, 'Workspace commit')
    assert.equal(workspace.reviews[0].state, 'COMMENTED')
    assert.equal(workspace.issueComments[0].body, 'Conversation')
    assert.equal(workspace.reviewComments[0].path, 'src/file-0.ts')
    assert.equal(workspace.capped.files, false)
    assert.ok(
      paths.includes('repos/desktop/material/pulls/42/files?per_page=50&page=2')
    )
    assert.equal(
      paths.filter(path => path === 'repos/desktop/material/pulls/42').length,
      2
    )
  })

  it('fails closed on a foreign workspace pagination target', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    Reflect.set(api, 'ghRequest', async (_method: string, path: string) => {
      if (path === 'repos/desktop/material/pulls/42') {
        return new Response(JSON.stringify(lifecycleResponse()))
      }
      return new Response(JSON.stringify([]), {
        headers: path.includes('/files?')
          ? {
              Link: '<https://evil.example.test/repos/desktop/material/pulls/42/files?page=2>; rel="next"',
            }
          : undefined,
      })
    })

    await assert.rejects(
      () => api.inspectPullRequestWorkspace('desktop', 'material', 42, headSHA),
      /invalid pull request workspace pagination/i
    )
  })

  it('anchors reviews, inline comments, replies, and state changes to the exact head', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const requests = new Array<{
      readonly method: string
      readonly path: string
      readonly body: Object | undefined
    }>()
    Reflect.set(
      api,
      'ghRequest',
      async (
        method: string,
        path: string,
        options?: { readonly body?: Object }
      ) => {
        requests.push({ method, path, body: options?.body })
        if (method === 'GET' && path === 'repos/desktop/material/pulls/42') {
          return new Response(JSON.stringify(lifecycleResponse()))
        }
        if (method === 'POST' && path.endsWith('/pulls/42/reviews')) {
          return new Response(JSON.stringify({ id: 9, state: 'APPROVED' }))
        }
        if (method === 'POST' && path.endsWith('/comments/7/replies')) {
          return new Response(JSON.stringify({ id: 10 }))
        }
        if (method === 'PATCH' && path.endsWith('/pulls/42')) {
          return new Response(JSON.stringify(lifecycleResponse('closed')))
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      }
    )

    const receipt = await api.submitPullRequestReview(
      'desktop',
      'material',
      42,
      headSHA,
      {
        event: 'APPROVE',
        body: 'Ready',
        comments: [
          {
            path: 'README.md',
            line: 1,
            side: 'RIGHT',
            body: 'Inline',
          },
        ],
        replies: [{ inReplyToId: 7, body: 'Reply' }],
      }
    )
    assert.equal(receipt.state, 'APPROVED')
    assert.deepEqual(
      requests.find(request => request.path.endsWith('/pulls/42/reviews'))
        ?.body,
      {
        event: 'APPROVE',
        body: 'Ready',
        commit_id: headSHA,
        comments: [
          {
            path: 'README.md',
            line: 1,
            side: 'RIGHT',
            body: 'Inline',
          },
        ],
      }
    )
    assert.deepEqual(
      requests.find(request => request.path.endsWith('/comments/7/replies'))
        ?.body,
      { body: 'Reply' }
    )

    const stateReceipt = await api.setPullRequestState(
      'desktop',
      'material',
      42,
      headSHA,
      'closed'
    )
    assert.equal(stateReceipt.pullRequest.state, 'closed')
    assert.deepEqual(
      requests.find(
        request =>
          request.method === 'PATCH' && request.path.endsWith('/pulls/42')
      )?.body,
      { state: 'closed' }
    )
  })

  it('reports a successful review without retrying replies when revalidation fails', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    let inspectCount = 0
    let replyCount = 0
    Reflect.set(api, 'ghRequest', async (method: string, path: string) => {
      if (method === 'GET' && path === 'repos/desktop/material/pulls/42') {
        inspectCount++
        if (inspectCount === 1) {
          return new Response(JSON.stringify(lifecycleResponse()))
        }
        throw new TypeError('offline')
      }
      if (method === 'POST' && path.endsWith('/pulls/42/reviews')) {
        return new Response(JSON.stringify({ id: 9, state: 'COMMENTED' }))
      }
      if (method === 'POST' && path.endsWith('/comments/7/replies')) {
        replyCount++
        return new Response(JSON.stringify({ id: 10 }))
      }
      throw new Error(`Unexpected request: ${method} ${path}`)
    })

    const receipt = await api.submitPullRequestReview(
      'desktop',
      'material',
      42,
      headSHA,
      {
        event: 'COMMENT',
        body: 'Posted review',
        replies: [{ inReplyToId: 7, body: 'Do not post without a recheck' }],
      }
    )
    assert.equal(receipt.id, 9)
    assert.equal(receipt.warnings?.length, 1)
    assert.equal(replyCount, 0)
  })
})
