import assert from 'node:assert'
import { describe, it } from 'node:test'

import { API } from '../../src/lib/api'

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
})
