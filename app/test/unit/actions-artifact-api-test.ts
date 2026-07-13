import assert from 'node:assert'
import { describe, it } from 'node:test'
import { API } from '../../src/lib/api'
import { APIError } from '../../src/lib/http'

const responseArtifact = {
  id: 19,
  name: 'Windows package',
  size_in_bytes: 1024,
  expired: false,
  created_at: '2026-07-13T10:00:00Z',
  expires_at: '2026-10-11T10:00:00Z',
  updated_at: '2026-07-13T10:01:00Z',
  digest: `sha256:${'a'.repeat(64)}`,
  workflow_run: {
    id: 7,
    head_branch: 'main',
    head_sha: 'b'.repeat(40),
  },
}

describe('GitHub Actions artifact API', () => {
  it('lists one bounded run page and propagates cancellation', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const controller = new AbortController()
    let request:
      | { method: string; path: string; signal?: AbortSignal }
      | undefined
    Reflect.set(
      api,
      'ghRequest',
      async (
        method: string,
        path: string,
        options?: { signal?: AbortSignal }
      ) => {
        request = { method, path, signal: options?.signal }
        return new Response(
          JSON.stringify({ total_count: 1, artifacts: [responseArtifact] })
        )
      }
    )

    const result = await api.fetchWorkflowRunArtifacts(
      'owner',
      'repo',
      7,
      controller.signal
    )

    assert.deepEqual(request, {
      method: 'GET',
      path: 'repos/owner/repo/actions/runs/7/artifacts?per_page=100',
      signal: controller.signal,
    })
    assert.equal(result.artifacts[0].id, 19)
    assert.equal(result.artifacts[0].workflowRun?.headBranch, 'main')
  })

  it('checks only attestation presence for the exact digest', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    let path = ''
    Reflect.set(api, 'ghRequest', async (_method: string, value: string) => {
      path = value
      return new Response(JSON.stringify({ attestations: [{ bundle: {} }] }))
    })
    const digest = `sha256:${'A'.repeat(64)}`

    assert.equal(
      await api.fetchArtifactAttestationPresence('owner', 'repo', digest),
      true
    )
    assert.equal(
      path,
      `repos/owner/repo/attestations/${encodeURIComponent(
        digest.toLowerCase()
      )}?per_page=1`
    )
    await assert.rejects(() =>
      api.fetchArtifactAttestationPresence('owner', 'repo', 'md5:bad')
    )
  })

  it('follows the short-lived archive redirect without credentials', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const controller = new AbortController()
    let requestOptions:
      | { redirect?: RequestRedirect; signal?: AbortSignal }
      | undefined
    Reflect.set(
      api,
      'ghRequest',
      async (
        _method: string,
        _path: string,
        options?: { redirect?: RequestRedirect; signal?: AbortSignal }
      ) => {
        requestOptions = options
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://blob.example.test/artifact.zip' },
        })
      }
    )

    const originalFetch = globalThis.fetch
    let signedRequest:
      | { input: string; options?: RequestInit; headers: Headers }
      | undefined
    globalThis.fetch = async (input, options) => {
      signedRequest = {
        input: String(input),
        options,
        headers: new Headers(options?.headers),
      }
      return new Response('archive')
    }

    try {
      const response = await api.fetchWorkflowArtifactArchive(
        'owner',
        'repo',
        19,
        controller.signal
      )
      assert.equal(await response.text(), 'archive')
      assert.deepEqual(requestOptions, {
        redirect: 'manual',
        signal: controller.signal,
      })
      assert.equal(
        signedRequest?.input,
        'https://blob.example.test/artifact.zip'
      )
      assert.equal(signedRequest?.options?.signal, controller.signal)
      assert.equal(signedRequest?.headers.has('Authorization'), false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('preserves expired and permission failures as API errors', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    Reflect.set(
      api,
      'ghRequest',
      async () => new Response(null, { status: 410 })
    )
    await assert.rejects(
      api.fetchWorkflowArtifactArchive('owner', 'repo', 19),
      error => error instanceof APIError && error.responseStatus === 410
    )

    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response(JSON.stringify({ message: 'Resource not accessible' }), {
          status: 403,
        })
    )
    await assert.rejects(
      api.fetchWorkflowRunArtifacts('owner', 'repo', 7),
      error => error instanceof APIError && error.responseStatus === 403
    )
  })

  it('rejects HTTPS-to-HTTP archive redirects without issuing the request', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'http://blob.example.test/artifact.zip' },
        })
    )
    const originalFetch = globalThis.fetch
    let fetches = 0
    globalThis.fetch = async () => {
      fetches++
      return new Response('unexpected')
    }
    try {
      await assert.rejects(
        api.fetchWorkflowArtifactArchive('owner', 'repo', 19),
        /insecure artifact download URL/
      )
      assert.equal(fetches, 0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('allows HTTP archives only for an explicitly HTTP custom endpoint', async () => {
    const api = new API('http://localhost:3210/api/v3', 'test-token')
    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'http://localhost:3211/artifact.zip' },
        })
    )
    const originalFetch = globalThis.fetch
    let requested = ''
    globalThis.fetch = async input => {
      requested = String(input)
      return new Response('archive')
    }
    try {
      const response = await api.fetchWorkflowArtifactArchive(
        'owner',
        'repo',
        19
      )
      assert.equal(await response.text(), 'archive')
      assert.equal(requested, 'http://localhost:3211/artifact.zip')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rejects invalid identifiers before any artifact request', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    let requests = 0
    Reflect.set(api, 'ghRequest', async () => {
      requests++
      return new Response('{}')
    })

    await assert.rejects(() =>
      api.fetchWorkflowRunArtifacts('owner', 'repo', 0)
    )
    await assert.rejects(() =>
      api.fetchWorkflowArtifactArchive('owner', 'repo', Number.NaN)
    )
    assert.equal(requests, 0)
  })
})
