import assert from 'node:assert'
import { describe, it } from 'node:test'
import { API } from '../../src/lib/api'
import { ActionsMetadataJSONMaximumBytes } from '../../src/lib/actions-response'
import { APIError } from '../../src/lib/http'

const responseJob = (id: number = 11) => ({
  id,
  run_id: 7,
  name: `job ${id}`,
  status: 'completed',
  conclusion: 'failure',
  started_at: '2026-07-13T10:00:00Z',
  completed_at: '2026-07-13T10:01:00Z',
  html_url: `https://github.example/actions/jobs/${id}`,
  steps: [],
})

const pending = {
  environment: {
    id: 101,
    name: 'production',
    html_url: 'https://github.example/environments/101',
  },
  wait_timer: 0,
  wait_timer_started_at: null,
  current_user_can_approve: true,
  reviewers: [],
}

const history = {
  state: 'approved',
  comment: 'Ship it!',
  environments: [pending.environment],
  user: {
    id: 1,
    login: 'reviewer',
    avatar_url: 'https://github.example/avatars/1',
    html_url: 'https://github.example/reviewer',
  },
}

describe('GitHub Actions run inspector API', () => {
  it('uses exact latest and historical attempt job paths with cancellation', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const controller = new AbortController()
    const requests = new Array<{
      method: string
      path: string
      signal?: AbortSignal
    }>()
    Reflect.set(
      api,
      'ghRequest',
      async (
        method: string,
        path: string,
        options?: { signal?: AbortSignal }
      ) => {
        requests.push({ method, path, signal: options?.signal })
        return new Response(
          JSON.stringify({ total_count: 51, jobs: [responseJob()] })
        )
      }
    )

    const latest = await api.fetchWorkflowRunJobPage(
      'owner',
      'repo',
      7,
      2,
      2,
      1,
      controller.signal
    )
    const historical = await api.fetchWorkflowRunJobPage(
      'owner',
      'repo',
      7,
      1,
      2,
      2,
      controller.signal
    )

    assert.equal(latest.attempt, 2)
    assert.equal(historical.attempt, 1)
    assert.deepEqual(requests, [
      {
        method: 'GET',
        path: 'repos/owner/repo/actions/runs/7/jobs?filter=latest&per_page=50&page=1',
        signal: controller.signal,
      },
      {
        method: 'GET',
        path: 'repos/owner/repo/actions/runs/7/attempts/1/jobs?per_page=50&page=2',
        signal: controller.signal,
      },
    ])
  })

  it('uses the latest endpoint without inventing an attempt on older runs', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    let path = ''
    Reflect.set(api, 'ghRequest', async (_method: string, value: string) => {
      path = value
      return new Response(
        JSON.stringify({ total_count: 1, jobs: [responseJob()] })
      )
    })

    const result = await api.fetchWorkflowRunJobPage(
      'owner',
      'repo',
      7,
      null,
      null
    )
    assert.equal(result.attempt, null)
    assert.equal(
      path,
      'repos/owner/repo/actions/runs/7/jobs?filter=latest&per_page=50&page=1'
    )
  })

  it('loads pending environments and review history through fixed paths', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const paths = new Array<string>()
    Reflect.set(api, 'ghRequest', async (_method: string, path: string) => {
      paths.push(path)
      return new Response(
        JSON.stringify(path.endsWith('/approvals') ? [history] : [pending])
      )
    })

    const environments = await api.fetchWorkflowRunPendingDeployments(
      'owner',
      'repo',
      7
    )
    const reviews = await api.fetchWorkflowRunReviewHistory('owner', 'repo', 7)
    assert.equal(environments[0].environmentId, 101)
    assert.equal(reviews[0].comment, 'Ship it!')
    assert.deepEqual(paths, [
      'repos/owner/repo/actions/runs/7/pending_deployments',
      'repos/owner/repo/actions/runs/7/approvals',
    ])
  })

  it('sends exact bounded review and bodyless fork-approval mutations', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const requests = new Array<{
      method: string
      path: string
      body?: Object
    }>()
    Reflect.set(
      api,
      'ghRequest',
      async (method: string, path: string, options?: { body?: Object }) => {
        requests.push({ method, path, body: options?.body })
        return new Response(null, {
          status: path.endsWith('/approve') ? 201 : 200,
        })
      }
    )

    await api.reviewWorkflowRunPendingDeployments(
      'owner',
      'repo',
      7,
      [101, 102],
      'approved',
      '  Ready after the smoke gate.  '
    )
    await api.approveForkWorkflowRun('owner', 'repo', 7)

    assert.deepEqual(requests, [
      {
        method: 'POST',
        path: 'repos/owner/repo/actions/runs/7/pending_deployments',
        body: {
          environment_ids: [101, 102],
          state: 'approved',
          comment: 'Ready after the smoke gate.',
        },
      },
      {
        method: 'POST',
        path: 'repos/owner/repo/actions/runs/7/approve',
        body: undefined,
      },
    ])
  })

  it('re-runs one exact page-two job without swallowing permission failures', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    let request: { method: string; path: string } | undefined
    Reflect.set(api, 'ghRequest', async (method: string, path: string) => {
      request = { method, path }
      return new Response(null, { status: 201 })
    })
    await api.rerunWorkflowJob('owner', 'repo', 51)
    assert.deepEqual(request, {
      method: 'POST',
      path: '/repos/owner/repo/actions/jobs/51/rerun',
    })

    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response(JSON.stringify({ message: 'Resource not accessible' }), {
          status: 403,
        })
    )
    await assert.rejects(
      api.rerunWorkflowJob('owner', 'repo', 51),
      error => error instanceof APIError && error.responseStatus === 403
    )
  })

  it('rejects invalid inputs before transport', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    let requests = 0
    Reflect.set(api, 'ghRequest', async () => {
      requests++
      return new Response('{}')
    })

    await assert.rejects(() =>
      api.fetchWorkflowRunJobPage('owner', 'repo', 0, 1, 1)
    )
    await assert.rejects(() =>
      api.fetchWorkflowRunJobPage('owner', 'repo', 7, 3, 2)
    )
    await assert.rejects(() =>
      api.fetchWorkflowRunJobPage('owner', 'repo', 7, null, 2)
    )
    await assert.rejects(() =>
      api.reviewWorkflowRunPendingDeployments(
        'owner',
        'repo',
        7,
        [101],
        'approved',
        '   '
      )
    )
    await assert.rejects(() => api.approveForkWorkflowRun('owner', 'repo', 0))
    assert.equal(requests, 0)
  })

  it('bounds successful job metadata and provider error bodies', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response('{}', {
          headers: {
            'Content-Length': String(ActionsMetadataJSONMaximumBytes + 1),
          },
        })
    )
    await assert.rejects(() =>
      api.fetchWorkflowRunJobPage('owner', 'repo', 7, 1, 1)
    )

    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response(
          new Uint8Array(ActionsMetadataJSONMaximumBytes + 1).fill(65),
          {
            status: 403,
          }
        )
    )
    await assert.rejects(
      api.fetchWorkflowRunPendingDeployments('owner', 'repo', 7),
      error =>
        error instanceof APIError &&
        error.responseStatus === 403 &&
        !error.message.includes('AAAA')
    )
  })
})
