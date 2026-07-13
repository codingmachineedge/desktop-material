import assert from 'node:assert'
import { describe, it } from 'node:test'

import { API } from '../../src/lib/api'
import {
  GitHubPullRequestJSONError,
  GitHubPullRequestJSONMaximumBytes,
} from '../../src/lib/github-pull-request-json'

const desktopHeadRepository = {
  name: null,
  fullName: 'desktop/material',
} as const

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
            head: {
              ref: 'feature/native',
              label: 'octocat:feature/native',
              repo: { full_name: 'octocat/material' },
            },
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
      { name: null, fullName: 'octocat/material' },
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

  it('posts head_repo only for the reviewed same-owner source repository', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    let body: Object | undefined
    Reflect.set(
      api,
      'ghRequest',
      async (_method: string, _path: string, options?: { body?: Object }) => {
        body = options?.body
        return new Response(
          JSON.stringify({
            number: 7,
            title: 'Same-owner fork',
            body: '',
            html_url: 'https://github.com/acme/upstream/pull/7',
            state: 'open',
            draft: false,
            head: {
              ref: 'feature',
              label: 'acme:feature',
              repo: { full_name: 'acme/product-fork' },
            },
            base: { ref: 'main' },
          }),
          { status: 201 }
        )
      }
    )

    await api.createPullRequest(
      'acme',
      'upstream',
      'Same-owner fork',
      '',
      'acme:feature',
      'main',
      false,
      { name: 'product-fork', fullName: 'acme/product-fork' }
    )

    assert.deepEqual(body, {
      title: 'Same-owner fork',
      body: '',
      head: 'acme:feature',
      head_repo: 'product-fork',
      base: 'main',
      draft: false,
    })
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
        false,
        desktopHeadRepository
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
        false,
        desktopHeadRepository
      )
    )
    await assert.rejects(() =>
      api.createPullRequest(
        'desktop',
        'material',
        'Title',
        '',
        'feature',
        'main',
        false,
        desktopHeadRepository,
        undefined,
        { reviewers: ['bad login'], assignees: [], labels: [] }
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
          desktopHeadRepository,
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
            head: {
              ref: 'feature',
              label: 'desktop:feature',
              repo: { full_name: 'desktop/material' },
            },
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
          false,
          desktopHeadRepository
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
            head: {
              ref: 'feature',
              label: 'desktop:feature',
              repo: { full_name: 'desktop/material' },
            },
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
          false,
          desktopHeadRepository
        ),
      /do not match the reviewed request/i
    )
  })
})

function lifecycleResponse(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    number: 42,
    title: 'Lifecycle PR',
    body: 'Body',
    html_url: 'https://github.com/desktop/material/pull/42',
    state: 'open',
    draft: false,
    merged: false,
    mergeable: true,
    mergeable_state: 'clean',
    head: {
      ref: 'feature',
      sha: 'a'.repeat(40),
      repo: { full_name: 'octocat/material' },
    },
    base: { ref: 'main' },
    requested_reviewers: [{ login: 'old-reviewer' }],
    assignees: [{ login: 'old-assignee' }],
    labels: [{ name: 'old-label' }],
    ...overrides,
  }
}

describe('GitHub pull request lifecycle API', () => {
  it('inspects one exact provider-bound pull request with cancellation', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const controller = new AbortController()
    let request: unknown
    Reflect.set(
      api,
      'ghRequest',
      async (method: string, path: string, options: unknown) => {
        request = { method, path, options }
        return new Response(JSON.stringify(lifecycleResponse()))
      }
    )

    const result = await api.inspectPullRequest(
      'desktop',
      'material',
      42,
      controller.signal
    )
    assert.deepEqual(request, {
      method: 'GET',
      path: 'repos/desktop/material/pulls/42',
      options: {
        customHeaders: { Accept: 'application/vnd.github+json' },
        signal: controller.signal,
      },
    })
    assert.equal(result.headSHA, 'a'.repeat(40))
    assert.equal(result.url, 'https://github.com/desktop/material/pull/42')
  })

  it('rejects oversized lifecycle responses before validation', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    let canceled = false
    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new Uint8Array(GitHubPullRequestJSONMaximumBytes)
              )
              controller.enqueue(new Uint8Array(1))
            },
            cancel() {
              canceled = true
            },
          })
        )
    )

    await assert.rejects(
      api.inspectPullRequest('desktop', 'material', 42),
      (error: GitHubPullRequestJSONError) => error.kind === 'too-large'
    )
    assert.equal(canceled, true)
  })

  it('updates reviewed fields and replaces exact metadata lists', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const requests = new Array<{
      method: string
      path: string
      body: unknown
    }>()
    let inspectCount = 0
    Reflect.set(
      api,
      'ghRequest',
      async (
        method: string,
        path: string,
        options?: { readonly body?: unknown }
      ) => {
        requests.push({ method, path, body: options?.body })
        if (method === 'GET') {
          inspectCount++
          return new Response(
            JSON.stringify(
              inspectCount === 1
                ? lifecycleResponse()
                : lifecycleResponse({
                    title: 'Updated PR',
                    body: 'Updated body',
                    base: { ref: 'release' },
                    requested_reviewers: [{ login: 'new-reviewer' }],
                    assignees: [{ login: 'new-assignee' }],
                    labels: [{ name: 'ready' }],
                  })
            )
          )
        }
        return new Response(
          JSON.stringify(
            lifecycleResponse({
              title: 'Updated PR',
              body: 'Updated body',
              base: { ref: 'release' },
            })
          )
        )
      }
    )

    const receipt = await api.updatePullRequestLifecycle(
      'desktop',
      'material',
      42,
      'a'.repeat(40),
      {
        title: ' Updated PR ',
        body: 'Updated body',
        base: 'release',
        metadata: {
          reviewers: ['new-reviewer'],
          assignees: ['new-assignee'],
          labels: ['ready'],
        },
      }
    )
    assert.deepEqual(receipt.warnings, [])
    assert.equal(receipt.pullRequest.title, 'Updated PR')
    assert.equal(receipt.pullRequest.base, 'release')
    assert.deepEqual(
      requests.map(request => [request.method, request.path, request.body]),
      [
        ['GET', 'repos/desktop/material/pulls/42', undefined],
        [
          'PATCH',
          'repos/desktop/material/pulls/42',
          { title: 'Updated PR', body: 'Updated body', base: 'release' },
        ],
        [
          'POST',
          'repos/desktop/material/pulls/42/requested_reviewers',
          { reviewers: ['new-reviewer'] },
        ],
        [
          'DELETE',
          'repos/desktop/material/pulls/42/requested_reviewers',
          { reviewers: ['old-reviewer'] },
        ],
        [
          'PATCH',
          'repos/desktop/material/issues/42',
          { assignees: ['new-assignee'], labels: ['ready'] },
        ],
        ['GET', 'repos/desktop/material/pulls/42', undefined],
      ]
    )
  })

  it('submits a review and merges only the exact inspected head', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const requests = new Array<{
      method: string
      path: string
      body: unknown
    }>()
    Reflect.set(
      api,
      'ghRequest',
      async (
        method: string,
        path: string,
        options?: { readonly body?: unknown }
      ) => {
        requests.push({ method, path, body: options?.body })
        if (method === 'GET') {
          return new Response(JSON.stringify(lifecycleResponse()))
        }
        if (path.endsWith('/reviews')) {
          return new Response(JSON.stringify({ id: 9, state: 'APPROVED' }))
        }
        return new Response(
          JSON.stringify({ merged: true, sha: 'b'.repeat(40) })
        )
      }
    )

    const review = await api.submitPullRequestReview(
      'desktop',
      'material',
      42,
      'a'.repeat(40),
      { event: 'APPROVE', body: 'Looks good' }
    )
    const merge = await api.mergePullRequest(
      'desktop',
      'material',
      42,
      'a'.repeat(40),
      'squash'
    )
    assert.equal(review.state, 'APPROVED')
    assert.equal(merge.sha, 'b'.repeat(40))
    assert.deepEqual(requests.at(-1), {
      method: 'PUT',
      path: 'repos/desktop/material/pulls/42/merge',
      body: { sha: 'a'.repeat(40), merge_method: 'squash' },
    })

    await assert.rejects(() =>
      api.mergePullRequest('desktop', 'material', 42, 'c'.repeat(40), 'merge')
    )
    assert.notEqual(requests.at(-1)?.method, 'PUT')
  })

  it('returns bounded metadata warnings after creation without echoing errors', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    Reflect.set(api, 'ghRequest', async (method: string, path: string) => {
      if (path === 'repos/desktop/material/pulls') {
        return new Response(
          JSON.stringify({
            number: 42,
            title: 'Native PR',
            body: '',
            html_url: 'https://github.com/desktop/material/pull/42',
            state: 'open',
            draft: false,
            head: {
              ref: 'feature',
              label: 'desktop:feature',
              repo: { full_name: 'desktop/material' },
            },
            base: { ref: 'main' },
          }),
          { status: 201 }
        )
      }
      throw new Error(`provider secret from ${method}`)
    })
    const result = await api.createPullRequest(
      'desktop',
      'material',
      'Native PR',
      '',
      'feature',
      'main',
      false,
      desktopHeadRepository,
      undefined,
      {
        reviewers: ['reviewer'],
        assignees: ['assignee'],
        labels: ['ready'],
      }
    )
    const warnings = result.metadataWarnings ?? []
    assert.deepEqual(warnings, [
      'The pull request was created, but reviewers were not requested.',
      'The pull request was created, but assignees or labels were not applied.',
    ])
    assert.doesNotMatch(warnings.join(' '), /provider secret/i)
  })
})
