import assert from 'node:assert'
import { describe, it } from 'node:test'

import { API } from '../../src/lib/api'

describe('GitHub issue API', () => {
  it('posts the bounded draft and propagates the exact abort signal', async () => {
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
            title: 'Created issue',
            body: 'Description',
            html_url: 'https://github.com/desktop/desktop/issues/42',
            state: 'open',
          }),
          { status: 201 }
        )
      }
    )

    const result = await api.createIssue(
      'desktop',
      'desktop',
      '  Created issue  ',
      'Description',
      controller.signal
    )

    assert.deepEqual(request, {
      method: 'POST',
      path: 'repos/desktop/desktop/issues',
      body: { title: 'Created issue', body: 'Description' },
      headers: new Headers({ Accept: 'application/vnd.github+json' }),
      signal: controller.signal,
    })
    assert.deepEqual(result, {
      number: 42,
      title: 'Created issue',
      url: 'https://github.com/desktop/desktop/issues/42',
    })
  })

  it('rejects invalid input before a request and honors pre-cancellation', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    let requestCount = 0
    Reflect.set(api, 'ghRequest', async () => {
      requestCount++
      return new Response('{}')
    })

    await assert.rejects(() =>
      api.createIssue('desktop', 'repo/name', 'Title', '')
    )
    await assert.rejects(() => api.createIssue('desktop', 'repo', '   ', ''))

    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      () => api.createIssue('desktop', 'repo', 'Title', '', controller.signal),
      error => error instanceof DOMException && error.name === 'AbortError'
    )
    assert.equal(requestCount, 0)
  })

  it('rejects a successful response whose provider URL is not exact', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response(
          JSON.stringify({
            number: 42,
            title: 'Created issue',
            body: '',
            html_url: 'https://evil.example.test/desktop/desktop/issues/42',
            state: 'open',
          }),
          { status: 201 }
        )
    )

    await assert.rejects(
      () => api.createIssue('desktop', 'desktop', 'Created issue', ''),
      /unexpected issue URL/i
    )
  })
})
