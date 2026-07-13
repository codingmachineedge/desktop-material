import assert from 'node:assert'
import { describe, it } from 'node:test'
import { API } from '../../src/lib/api'
import {
  ActionsArtifactJSONError,
  ActionsArtifactJSONMaximumBytes,
} from '../../src/lib/actions-artifact-json'
import { APIError } from '../../src/lib/http'
import {
  ActionsArtifactAttestationMaximumBytes,
  ActionsArtifactAttestationProbePageSize,
  ActionsArtifactProvenancePredicate,
} from '../../src/lib/actions-artifact-provenance'

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
      1,
      controller.signal
    )

    assert.deepEqual(request, {
      method: 'GET',
      path: 'repos/owner/repo/actions/runs/7/artifacts?per_page=30&page=1',
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

  it('fetches only bounded canonical bundles for the exact subject and policy', async () => {
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
          JSON.stringify({
            attestations: [
              {
                bundle: {
                  mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
                  verificationMaterial: {},
                  dsseEnvelope: {},
                },
                bundle_url: 'not returned',
              },
            ],
          })
        )
      }
    )
    const digest = `sha256:${'A'.repeat(64)}`
    const result = await api.fetchArtifactAttestationBundles(
      'owner',
      'repo',
      digest,
      controller.signal
    )

    assert.deepEqual(request, {
      method: 'GET',
      path: `repos/owner/repo/attestations/${encodeURIComponent(
        digest.toLowerCase()
      )}?per_page=${ActionsArtifactAttestationProbePageSize}&predicate_type=${encodeURIComponent(
        ActionsArtifactProvenancePredicate
      )}`,
      signal: controller.signal,
    })
    assert.equal(result.bundles.length, 1)
    assert.equal(result.bundles[0].includes('bundle_url'), false)
  })

  it('uses the larger success cap only for bounded attestation bundles', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const valid = JSON.stringify({ attestations: [] })
    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response(valid, {
          headers: {
            'Content-Length': String(ActionsArtifactJSONMaximumBytes + 1),
          },
        })
    )
    assert.deepEqual(
      await api.fetchArtifactAttestationBundles(
        'owner',
        'repo',
        `sha256:${'a'.repeat(64)}`
      ),
      { bundles: [], serializedBytes: 0 }
    )

    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response(valid, {
          headers: {
            'Content-Length': String(
              ActionsArtifactAttestationMaximumBytes + 1
            ),
          },
        })
    )
    await assert.rejects(() =>
      api.fetchArtifactAttestationBundles(
        'owner',
        'repo',
        `sha256:${'a'.repeat(64)}`
      )
    )

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
      api.fetchArtifactAttestationBundles(
        'owner',
        'repo',
        `sha256:${'a'.repeat(64)}`
      ),
      error => error instanceof APIError && error.responseStatus === 403
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

  it('requests exact later pages and rejects invalid pages before transport', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const paths: string[] = []
    Reflect.set(api, 'ghRequest', async (_method: string, path: string) => {
      paths.push(path)
      return new Response(JSON.stringify({ total_count: 31, artifacts: [] }))
    })

    const result = await api.fetchWorkflowRunArtifacts('owner', 'repo', 7, 2)
    assert.equal(result.page, 2)
    assert.deepEqual(paths, [
      'repos/owner/repo/actions/runs/7/artifacts?per_page=30&page=2',
    ])

    await assert.rejects(() =>
      api.fetchWorkflowRunArtifacts('owner', 'repo', 7, 0)
    )
    await assert.rejects(() =>
      api.fetchWorkflowRunArtifacts('owner', 'repo', 7, 1_000_001)
    )
    assert.equal(paths.length, 1)
  })
})
