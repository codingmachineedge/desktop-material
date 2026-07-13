import assert from 'node:assert'
import { describe, it } from 'node:test'
import { API } from '../../src/lib/api'
import {
  ActionsArtifactJSONError,
  ActionsArtifactJSONMaximumBytes,
} from '../../src/lib/actions-artifact-json'
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

  it('preserves bounded permission failures as API errors', async () => {
    const api = new API('https://api.github.com', 'secret-token')
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

  it('rejects oversized successful metadata before parsing it', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response('{}', {
          headers: {
            'Content-Length': String(ActionsArtifactJSONMaximumBytes + 1),
          },
        })
    )

    await assert.rejects(
      api.fetchWorkflowRunArtifacts('owner', 'repo', 7),
      error =>
        error instanceof ActionsArtifactJSONError && error.kind === 'too-large'
    )
  })

  it('bounds oversized API error bodies without copying provider text', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response(
          new Uint8Array(ActionsArtifactJSONMaximumBytes + 1).fill(65),
          { status: 403 }
        )
    )

    await assert.rejects(
      api.fetchWorkflowRunArtifacts('owner', 'repo', 7),
      error =>
        error instanceof APIError &&
        error.responseStatus === 403 &&
        !error.message.includes('AAAA')
    )
  })

  it('rejects invalid run identifiers before any artifact request', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    let requests = 0
    Reflect.set(api, 'ghRequest', async () => {
      requests++
      return new Response('{}')
    })

    await assert.rejects(() =>
      api.fetchWorkflowRunArtifacts('owner', 'repo', 0)
    )
    assert.equal(requests, 0)
  })
})
