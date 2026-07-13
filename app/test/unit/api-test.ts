import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  API,
  createGitHubAPIRequestHeaders,
  getBitbucketAPIEndpoint,
  getEndpointForRepository,
  getGitLabAPIEndpoint,
  getNextPagePathWithIncreasingPageSize,
  GitHubDotComRESTAPIVersion,
  GitHubRESTAPIVersionHeader,
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
  describe('third-party provider endpoints', () => {
    it('normalizes GitLab.com and self-hosted subpath endpoints', () => {
      assert.equal(getGitLabAPIEndpoint(), 'https://gitlab.com/api/v4')
      assert.equal(
        getGitLabAPIEndpoint('gitlab.example.com/gitlab/'),
        'https://gitlab.example.com/gitlab/api/v4'
      )
      assert.equal(
        getGitLabAPIEndpoint('https://gitlab.example.com/api/v4'),
        'https://gitlab.example.com/api/v4'
      )
    })

    it('maps GitLab.com and Bitbucket remotes to their API endpoints', () => {
      assert.equal(
        getEndpointForRepository('https://gitlab.com/group/project.git'),
        getGitLabAPIEndpoint()
      )
      assert.equal(
        getEndpointForRepository('https://bitbucket.org/team/project.git'),
        getBitbucketAPIEndpoint()
      )
    })
  })

  describe('GitHub REST API versioning', () => {
    it('pins GitHub.com REST requests to the current stable version', () => {
      const headers = createGitHubAPIRequestHeaders(
        'https://api.github.com',
        '/user',
        { 'x-github-api-version': '2022-11-28' }
      )

      assert.equal(
        headers.get(GitHubRESTAPIVersionHeader),
        GitHubDotComRESTAPIVersion
      )
    })

    it('applies versioning in the GitHub request layer only for REST', async () => {
      const api = new API('https://api.github.com', 'account-token')
      const receivedHeaders = new Array<Headers>()
      Reflect.set(
        api,
        'request',
        async (
          _endpoint: string,
          _method: string,
          _path: string,
          options?: { customHeaders?: HeadersInit }
        ) => {
          receivedHeaders.push(new Headers(options?.customHeaders))
          return new Response('{}')
        }
      )

      await api.fetchAccount()
      const ghRequest = Reflect.get(api, 'ghRequest') as (
        method: 'POST',
        path: string
      ) => Promise<Response>
      await ghRequest.call(api, 'POST', '/graphql')

      assert.equal(
        receivedHeaders[0].get(GitHubRESTAPIVersionHeader),
        GitHubDotComRESTAPIVersion
      )
      assert.equal(receivedHeaders[1].get(GitHubRESTAPIVersionHeader), null)
    })

    it('does not version GraphQL, GHES, GitLab, or Bitbucket requests', () => {
      for (const [endpoint, path] of [
        ['https://api.github.com', '/graphql'],
        ['https://github.example.test/api/v3', '/user'],
        ['https://gitlab.com/api/v4', '/user'],
        ['https://api.bitbucket.org/2.0', '/user'],
      ]) {
        const headers = createGitHubAPIRequestHeaders(endpoint, path)
        assert.equal(headers.get(GitHubRESTAPIVersionHeader), null)
      }
    })
  })

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

  describe('GitHub Notifications endpoints', () => {
    it('builds the bounded authenticated-user notification query', async () => {
      const api = new API('https://api.github.com', 'account-token')
      let method = ''
      let path = ''
      let requestHeaders = new Headers()
      const controller = new AbortController()
      const thread = {
        id: '41',
        repository: {
          id: 1,
          name: 'repo',
          full_name: 'owner/repo',
          private: false,
          owner: { login: 'owner', id: 1 },
          html_url: 'https://github.com/owner/repo',
        },
        subject: {
          title: 'A notification',
          url: 'https://api.github.com/repos/owner/repo/issues/5',
          latest_comment_url: null,
          type: 'Issue',
        },
        reason: 'mention',
        unread: true,
        updated_at: '2026-07-12T12:00:00Z',
        last_read_at: null,
        url: 'https://api.github.com/notifications/threads/41',
        subscription_url:
          'https://api.github.com/notifications/threads/41/subscription',
      }
      Reflect.set(
        api,
        'ghRequest',
        async (
          valueMethod: string,
          valuePath: string,
          options?: { customHeaders?: HeadersInit; signal?: AbortSignal }
        ) => {
          method = valueMethod
          path = valuePath
          requestHeaders = new Headers(options?.customHeaders)
          assert.equal(options?.signal, controller.signal)
          return new Response(JSON.stringify([thread]), {
            headers: {
              Link: '<https://api.github.com/notifications?page=3>; rel="next"',
              'Last-Modified': 'Sun, 12 Jul 2026 12:00:00 GMT',
              'X-Poll-Interval': '60',
            },
          })
        }
      )

      const page = await api.fetchNotifications({
        includeRead: true,
        participating: true,
        page: 2,
        perPage: 500,
        lastModified: 'Sun, 12 Jul 2026 11:00:00 GMT',
        signal: controller.signal,
      })

      assert.equal(method, 'GET')
      assert.equal(
        path,
        'notifications?all=true&participating=true&per_page=50&page=2'
      )
      assert.equal(requestHeaders.get('Accept'), 'application/vnd.github+json')
      assert.equal(
        requestHeaders.get('If-Modified-Since'),
        'Sun, 12 Jul 2026 11:00:00 GMT'
      )
      assert.deepEqual(page.notifications, [thread])
      assert.equal(page.hasNextPage, true)
      assert.equal(page.notModified, false)
      assert.equal(page.lastModified, 'Sun, 12 Jul 2026 12:00:00 GMT')
      assert.equal(page.pollIntervalSeconds, 60)
    })

    it('preserves the current page on a conditional 304 response', async () => {
      const api = new API('https://api.github.com', 'account-token')
      Reflect.set(
        api,
        'ghRequest',
        async () =>
          new Response(null, {
            status: 304,
            headers: { 'X-Poll-Interval': '90' },
          })
      )

      const page = await api.fetchNotifications({
        includeRead: false,
        participating: false,
        page: 1,
        lastModified: 'Sun, 12 Jul 2026 12:00:00 GMT',
      })

      assert.equal(page.notModified, true)
      assert.deepEqual(page.notifications, [])
      assert.equal(page.lastModified, 'Sun, 12 Jul 2026 12:00:00 GMT')
      assert.equal(page.pollIntervalSeconds, 90)
    })

    it('uses the exact thread read and done mutation contracts', async () => {
      const api = new API('https://api.github.com', 'account-token')
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
          return new Response(null, {
            status: method === 'PATCH' ? 205 : 204,
          })
        }
      )

      await api.markNotificationThreadRead('41/escape', controller.signal)
      await api.markNotificationThreadDone('42', controller.signal)

      assert.deepEqual(requests, [
        {
          method: 'PATCH',
          path: 'notifications/threads/41%2Fescape',
          signal: controller.signal,
        },
        {
          method: 'DELETE',
          path: 'notifications/threads/42',
          signal: controller.signal,
        },
      ])
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

    it('uses the exact Actions mutation methods and paths', async () => {
      const api = new API('https://api.github.com', 'token')
      const requests = new Array<{ method: string; path: string }>()
      Reflect.set(api, 'ghRequest', async (method: string, path: string) => {
        requests.push({ method, path })
        return new Response(null, { status: 204 })
      })

      assert.equal(await api.rerunJob('owner', 'repo', 17), true)
      await api.cancelWorkflowRun('owner', 'repo', 23)
      await api.cancelWorkflowRun('owner', 'repo', 24, true)
      await api.setWorkflowEnabled('owner', 'repo', 31, true)
      await api.setWorkflowEnabled('owner', 'repo', 32, false)

      assert.deepEqual(requests, [
        {
          method: 'POST',
          path: '/repos/owner/repo/actions/jobs/17/rerun',
        },
        {
          method: 'POST',
          path: 'repos/owner/repo/actions/runs/23/cancel',
        },
        {
          method: 'POST',
          path: 'repos/owner/repo/actions/runs/24/force-cancel',
        },
        {
          method: 'PUT',
          path: 'repos/owner/repo/actions/workflows/31/enable',
        },
        {
          method: 'PUT',
          path: 'repos/owner/repo/actions/workflows/32/disable',
        },
      ])
    })

    it('preserves structured errors for workflow state changes', async () => {
      const api = new API('https://api.github.com', 'token')
      Reflect.set(
        api,
        'ghRequest',
        async () =>
          new Response(JSON.stringify({ message: 'Resource not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
      )

      await assert.rejects(
        api.setWorkflowEnabled('owner', 'repo', 31, true),
        error =>
          error instanceof APIError &&
          error.responseStatus === 404 &&
          error.message === 'Resource not found'
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
