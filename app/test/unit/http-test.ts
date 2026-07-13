import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  createRequestHeaders,
  getAbsoluteUrl,
  request,
} from '../../src/lib/http'
import { getDotComAPIEndpoint } from '../../src/lib/api'

describe('getAbsoluteUrl', () => {
  describe('dotcom endpoint', () => {
    const dotcomEndpoint = getDotComAPIEndpoint()

    it('handles leading slashes', () => {
      const result = getAbsoluteUrl(dotcomEndpoint, '/user/repos')
      assert.equal(result, 'https://api.github.com/user/repos')
    })

    it('handles missing leading slash', () => {
      const result = getAbsoluteUrl(dotcomEndpoint, 'user/repos')
      assert.equal(result, 'https://api.github.com/user/repos')
    })

    it("doesn't mangle encoded query parameters", () => {
      const result = getAbsoluteUrl(
        getDotComAPIEndpoint(),
        '/issues?since=2019-05-10T16%3A00%3A00Z'
      )
      assert.equal(
        result,
        'https://api.github.com/issues?since=2019-05-10T16%3A00%3A00Z'
      )
    })
  })

  describe('enterprise endpoint', () => {
    const enterpriseEndpoint = 'https://my-cool-company.com/api/v3'

    it('handles leading slash', () => {
      const result = getAbsoluteUrl(enterpriseEndpoint, '/user/repos')
      assert.equal(result, `${enterpriseEndpoint}/user/repos`)
    })

    it('handles missing leading slash', () => {
      const result = getAbsoluteUrl(enterpriseEndpoint, 'user/repos')
      assert.equal(result, `${enterpriseEndpoint}/user/repos`)
    })

    it('handles next page resource which already contains prefix', () => {
      const result = getAbsoluteUrl(
        enterpriseEndpoint,
        '/api/v3/user/repos?page=2'
      )
      assert.equal(result, `${enterpriseEndpoint}/user/repos?page=2`)
    })

    it("doesn't mangle encoded query parameters", () => {
      const result = getAbsoluteUrl(
        enterpriseEndpoint,
        '/issues?since=2019-05-10T16%3A00%3A00Z'
      )
      assert.equal(
        result,
        `${enterpriseEndpoint}/issues?since=2019-05-10T16%3A00%3A00Z`
      )
    })
  })
})

describe('createRequestHeaders', () => {
  it('keeps an account bearer credential authoritative', () => {
    const headers = createRequestHeaders('account-token', {
      authorization: 'Basic untrusted-override',
      Accept: 'application/vnd.github.raw+json',
    })

    assert.equal(headers.get('Authorization'), 'Bearer account-token')
    assert.equal(headers.get('Accept'), 'application/vnd.github.raw+json')
  })

  it('preserves trusted explicit authorization without an account token', () => {
    const headers = createRequestHeaders(null, {
      Authorization: 'Basic trusted-credential',
    })

    assert.equal(headers.get('Authorization'), 'Basic trusted-credential')
  })
})

describe('request cancellation', () => {
  it('forwards an AbortSignal for PATCH requests', async () => {
    const originalFetch = globalThis.fetch
    const controller = new AbortController()
    let received: RequestInit | undefined
    globalThis.fetch = async (_url, options) => {
      received = options
      return new Response(null, { status: 205 })
    }

    try {
      await request(
        'https://api.github.com',
        'account-token',
        'PATCH',
        'notifications/threads/1',
        undefined,
        undefined,
        false,
        undefined,
        controller.signal
      )
      assert.equal(received?.signal, controller.signal)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
