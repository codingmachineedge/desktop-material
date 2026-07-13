import assert from 'node:assert'
import { describe, it } from 'node:test'
import { API } from '../../src/lib/api'
import { ActionsBranchRuleMaximumPages } from '../../src/lib/actions-branch-rules'
import { ActionsArtifactJSONMaximumBytes } from '../../src/lib/actions-artifact-json'
import { APIError } from '../../src/lib/http'

const rule = (rulesetId: number) => ({
  ruleset_id: rulesetId,
  type: 'required_signatures',
  ruleset_source_type: 'Organization',
  ruleset_source: 'example',
})

const nextLink = (page: number) =>
  `<https://api.github.com/repos/example/project/rules/branches/main?per_page=100&page=${page}>; rel="next"`

describe('effective Actions branch rules API', () => {
  it('loads account-origin pages using only locally generated bounded paths', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const requests = new Array<{
      path: string
      signal: AbortSignal | undefined
    }>()
    const controller = new AbortController()
    Reflect.set(
      api,
      'ghRequest',
      async (
        _method: string,
        path: string,
        options?: { signal?: AbortSignal }
      ) => {
        requests.push({ path, signal: options?.signal })
        const page = requests.length
        return new Response(
          JSON.stringify(
            page === 1
              ? Array.from({ length: 100 }, (_, index) => rule(index + 1))
              : [rule(101)]
          ),
          page === 1 ? { headers: { Link: nextLink(2) } } : undefined
        )
      }
    )

    const result = await api.fetchEffectiveBranchRules(
      'example',
      'project',
      'feature/release',
      controller.signal
    )

    assert.equal(result.rules.length, 101)
    assert.equal(result.branch, 'feature/release')
    assert.equal(result.capped, false)
    assert.deepEqual(
      requests.map(request => request.path),
      [
        'repos/example/project/rules/branches/feature%2Frelease?per_page=100&page=1',
        'repos/example/project/rules/branches/feature%2Frelease?per_page=100&page=2',
      ]
    )
    assert.ok(requests.every(request => request.signal === controller.signal))
  })

  it('stops at the application page cap even when GitHub advertises more', async () => {
    const api = new API('https://github.enterprise.test/api/v3', 'token')
    let requests = 0
    Reflect.set(api, 'ghRequest', async () => {
      requests++
      return new Response(
        JSON.stringify(
          Array.from({ length: 100 }, (_, index) =>
            rule((requests - 1) * 100 + index + 1)
          )
        ),
        { headers: { Link: nextLink(requests + 1) } }
      )
    })

    const result = await api.fetchEffectiveBranchRules(
      'example',
      'project',
      'main'
    )
    assert.equal(requests, ActionsBranchRuleMaximumPages)
    assert.equal(result.rules.length, 500)
    assert.equal(result.capped, true)
  })

  it('propagates cancellation before retaining a delayed response', async () => {
    const api = new API('https://api.github.com', 'token')
    let release!: (response: Response) => void
    Reflect.set(
      api,
      'ghRequest',
      async () => await new Promise<Response>(resolve => (release = resolve))
    )
    const controller = new AbortController()
    const pending = api.fetchEffectiveBranchRules(
      'example',
      'project',
      'main',
      controller.signal
    )
    await Promise.resolve()
    controller.abort()
    release(new Response('[]'))
    await assert.rejects(
      pending,
      error => (error as Error).name === 'AbortError'
    )
  })

  it('keeps permission failures typed and bounds provider error bodies', async () => {
    const api = new API('https://api.github.com', 'token')
    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response(JSON.stringify({ message: 'Resource not accessible' }), {
          status: 403,
        })
    )
    await assert.rejects(
      api.fetchEffectiveBranchRules('example', 'project', 'main'),
      error => error instanceof APIError && error.responseStatus === 403
    )

    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response(new Uint8Array(ActionsArtifactJSONMaximumBytes + 1), {
          status: 403,
        })
    )
    await assert.rejects(
      api.fetchEffectiveBranchRules('example', 'project', 'main'),
      error => error instanceof APIError && error.responseStatus === 403
    )
  })

  it('rejects invalid repository and branch path segments before a request', async () => {
    const api = new API('https://api.github.com', 'token')
    let requests = 0
    Reflect.set(api, 'ghRequest', async () => {
      requests++
      return new Response('[]')
    })

    await assert.rejects(() =>
      api.fetchEffectiveBranchRules('bad/owner', 'project', 'main')
    )
    await assert.rejects(() =>
      api.fetchEffectiveBranchRules('example', 'project', 'release/*')
    )
    assert.equal(requests, 0)
  })
})
