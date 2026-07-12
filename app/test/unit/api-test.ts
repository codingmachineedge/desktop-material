import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  API,
  ActionsLogMaximumBytes,
  ActionsLogTruncationMarker,
  getNextPagePathWithIncreasingPageSize,
} from '../../src/lib/api'
import { APIError } from '../../src/lib/http'
import { CopilotError } from '../../src/lib/copilot-error'
import * as URL from 'url'

interface IPageInfo {
  per_page: number
  page: number
}

function createHeadersWithNextLink(url: string) {
  return new Headers({
    Link: `<${url}>; rel="next"`,
  })
}

function assertNext(current: IPageInfo, expected: IPageInfo) {
  const headers = createHeadersWithNextLink(
    `/items?per_page=${current.per_page}&page=${current.page}`
  )

  const nextPath = getNextPagePathWithIncreasingPageSize(
    new Response(null, { headers })
  )

  assert(nextPath !== null)
  const { pathname, query } = URL.parse(nextPath, true)

  assert.equal(pathname, '/items')

  const per_page = parseInt(
    typeof query.per_page === 'string' ? query.per_page : '',
    10
  )
  const page = parseInt(typeof query.page === 'string' ? query.page : '', 10)

  assert.equal(per_page, expected.per_page)
  assert.equal(page, expected.page)

  // If getNextPagePathWithIncreasingPageSize has fiddled with the
  // page size or page number we want to ensure that the next page will
  // get us more items than what we've gotten thus far.
  if (current.per_page !== per_page || current.page !== page) {
    const receivedCurrent = current.per_page * current.page
    const receivedNext = per_page * page

    assert(receivedNext > receivedCurrent)
  }
}

describe('API', () => {
  describe('fetchOrgRepositories', () => {
    it('requests the encoded organization repository endpoint', async () => {
      const api = new API('https://api.github.com', 'token')
      let path = ''
      Reflect.set(api, 'fetchAll', async (value: string) => {
        path = value
        return []
      })

      await api.fetchOrgRepositories('desktop material')
      assert.equal(path, 'orgs/desktop%20material/repos')
    })
  })

  describe('Actions endpoints', () => {
    it('builds workflow run filters and dispatch bodies', async () => {
      const api = new API('https://api.github.com', 'token')
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
          return path.endsWith('/dispatches')
            ? new Response(null, { status: 204 })
            : new Response(
                JSON.stringify({ total_count: 0, workflow_runs: [] }),
                {
                  status: 200,
                }
              )
        }
      )

      await api.fetchWorkflowRuns('owner', 'repo', {
        workflowId: 42,
        branch: 'feature/a',
        event: 'push',
        status: 'success',
      })
      await api.dispatchWorkflow('owner', 'repo', 42, 'main', {
        target: 'prod',
      })

      assert.equal(
        requests[0].path,
        'repos/owner/repo/actions/workflows/42/runs?per_page=50&branch=feature%2Fa&event=push&status=success'
      )
      assert.deepEqual(requests[1].body, {
        ref: 'main',
        inputs: { target: 'prod' },
      })
    })

    it('follows job log redirects without forwarding request options', async () => {
      const api = new API('https://api.github.com', 'secret')
      Reflect.set(
        api,
        'ghRequest',
        async () =>
          new Response(null, {
            status: 302,
            headers: { Location: 'https://blob.example.test/job.txt' },
          })
      )
      const originalFetch = globalThis.fetch
      let receivedOptions: RequestInit | undefined
      globalThis.fetch = async (_input, options) => {
        receivedOptions = options
        return new Response('hello from the job')
      }

      try {
        assert.equal(
          await api.fetchWorkflowJobLogs('owner', 'repo', 7),
          'hello from the job'
        )
        assert.equal(receivedOptions, undefined)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('caps oversized job logs and identifies expired logs', async () => {
      const api = new API('https://api.github.com', 'secret')
      Reflect.set(
        api,
        'ghRequest',
        async () =>
          new Response(new Uint8Array(ActionsLogMaximumBytes + 10).fill(65))
      )
      const log = await api.fetchWorkflowJobLogs('owner', 'repo', 7)
      assert(log.endsWith(ActionsLogTruncationMarker))

      Reflect.set(
        api,
        'ghRequest',
        async () => new Response(null, { status: 410 })
      )
      await assert.rejects(
        api.fetchWorkflowJobLogs('owner', 'repo', 7),
        error => error instanceof APIError && error.responseStatus === 410
      )
    })
  })

  describe('getNextPagePathWithIncreasingPageSize', () => {
    it("returns null when there's no link header", () => {
      assert(getNextPagePathWithIncreasingPageSize(new Response()) === null)
    })

    it('returns raw link when missing page size', () => {
      const nextPath = getNextPagePathWithIncreasingPageSize(
        new Response(null, {
          headers: createHeadersWithNextLink('/items?page=2'),
        })
      )

      assert.equal(nextPath, '/items?page=2')
    })

    it('returns raw link when missing page number', () => {
      const nextPath = getNextPagePathWithIncreasingPageSize(
        new Response(null, {
          headers: createHeadersWithNextLink('/items?per_page=10'),
        })
      )

      assert.equal(nextPath, '/items?per_page=10')
    })

    it('does not increase page size when not aligned', () => {
      const nextPath = getNextPagePathWithIncreasingPageSize(
        new Response(null, {
          headers: createHeadersWithNextLink('/items?per_page=10&page=2'),
        })
      )

      assert.equal(nextPath, '/items?per_page=10&page=2')
    })

    it('increases page size on alignment with an initial page size of 10', () => {
      assertNext({ per_page: 10, page: 2 }, { per_page: 10, page: 2 })
      assertNext({ per_page: 10, page: 3 }, { per_page: 20, page: 2 })
      assertNext({ per_page: 20, page: 2 }, { per_page: 20, page: 2 })
      assertNext({ per_page: 20, page: 3 }, { per_page: 40, page: 2 })
      assertNext({ per_page: 40, page: 2 }, { per_page: 40, page: 2 })
      assertNext({ per_page: 40, page: 3 }, { per_page: 80, page: 2 })
      assertNext({ per_page: 80, page: 3 }, { per_page: 80, page: 3 })
      assertNext({ per_page: 80, page: 4 }, { per_page: 80, page: 4 })
      assertNext({ per_page: 80, page: 5 }, { per_page: 80, page: 5 })
      assertNext({ per_page: 80, page: 6 }, { per_page: 100, page: 5 })
    })

    it('increases page size on alignment with an initial page size of 5', () => {
      assertNext({ per_page: 5, page: 2 }, { per_page: 5, page: 2 })
      assertNext({ per_page: 5, page: 3 }, { per_page: 10, page: 2 })
    })

    it('increases page size on alignment with an initial page size of 1', () => {
      assertNext({ per_page: 1, page: 2 }, { per_page: 1, page: 2 })
      assertNext({ per_page: 1, page: 3 }, { per_page: 2, page: 2 })
      assertNext({ per_page: 2, page: 3 }, { per_page: 4, page: 2 })
      assertNext({ per_page: 4, page: 2 }, { per_page: 4, page: 2 })
      assertNext({ per_page: 4, page: 3 }, { per_page: 8, page: 2 })
      assertNext({ per_page: 8, page: 2 }, { per_page: 8, page: 2 })
      assertNext({ per_page: 8, page: 3 }, { per_page: 16, page: 2 })
      assertNext({ per_page: 16, page: 2 }, { per_page: 16, page: 2 })
      assertNext({ per_page: 16, page: 3 }, { per_page: 32, page: 2 })
      assertNext({ per_page: 32, page: 2 }, { per_page: 32, page: 2 })
      assertNext({ per_page: 32, page: 3 }, { per_page: 64, page: 2 })
    })

    it("doesn't increase page size when page size is 100", () => {
      assertNext({ per_page: 100, page: 2 }, { per_page: 100, page: 2 })
      assertNext({ per_page: 100, page: 3 }, { per_page: 100, page: 3 })
      assertNext({ per_page: 100, page: 4 }, { per_page: 100, page: 4 })
      assertNext({ per_page: 100, page: 5 }, { per_page: 100, page: 5 })
      assertNext({ per_page: 100, page: 6 }, { per_page: 100, page: 6 })
      assertNext({ per_page: 100, page: 7 }, { per_page: 100, page: 7 })
      assertNext({ per_page: 100, page: 8 }, { per_page: 100, page: 8 })
      assertNext({ per_page: 100, page: 9 }, { per_page: 100, page: 9 })
      assertNext({ per_page: 100, page: 10 }, { per_page: 100, page: 10 })
    })
  })

  describe('getDiffChangesCommitMessage', () => {
    it('preserves structured payment required errors for the legacy Copilot API path', async () => {
      const api = new API(
        'https://api.github.com',
        'token',
        'https://copilot.example.com'
      )

      Reflect.set(
        api,
        'request',
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'quota_exceeded',
                message:
                  'You have used all available Copilot premium requests.',
              },
            }),
            {
              status: 402,
              headers: {
                'Retry-After': '300',
              },
            }
          )
      )

      await assert.rejects(
        () => api.getDiffChangesCommitMessage('diff --git a/file b/file'),
        error => {
          assert(error instanceof CopilotError)
          assert.equal(error.code, 'quota_exceeded')
          assert.equal(
            error.message,
            'You have used all available Copilot premium requests.'
          )
          assert.equal(error.retryAfter, '300')
          return true
        }
      )
    })
  })
})
