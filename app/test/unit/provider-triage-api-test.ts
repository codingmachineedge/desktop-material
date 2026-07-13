import assert from 'node:assert'
import { describe, it } from 'node:test'
import { API } from '../../src/lib/api'
import { ProviderTriageJSONError } from '../../src/lib/provider-triage-json'
import { Account } from '../../src/models/account'

function account(
  provider: Account['provider'],
  endpoint: string,
  token: string
) {
  return new Account(
    'fixture-bot',
    endpoint,
    token,
    [],
    '',
    1,
    'Fixture Bot',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    provider
  )
}

describe('provider triage API adapters', () => {
  it('bounds, routes, and cancels each provider without following pages', async () => {
    const originalFetch = globalThis.fetch
    const requests = new Array<{ url: string; options?: RequestInit }>()
    const responses = new Array<Response>()
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), options })
      const response = responses.shift()
      assert.ok(response, 'expected a queued provider response')
      return response
    }

    try {
      const gitlab = API.fromAccount(
        account('gitlab', 'https://gitlab.example/api/v4', 'gitlab-token')
      )
      const controller = new AbortController()
      responses.push(
        new Response(
          JSON.stringify([
            {
              iid: 1,
              title: 'GitLab issue',
              created_at: '2026-07-01T00:00:00Z',
              updated_at: '2026-07-02T00:00:00Z',
              author: { username: 'fixture-bot' },
              assignees: [],
            },
          ]),
          { headers: { 'x-next-page': '' } }
        )
      )
      const gitlabPage = await gitlab.fetchProviderTriageIssues(
        'group/subgroup',
        'material',
        10,
        controller.signal
      )
      assert.equal(gitlabPage.capped, false)
      assert.equal(gitlabPage.items[0].number, 1)
      assert.match(
        requests[0].url,
        /projects\/group%2Fsubgroup%2Fmaterial\/issues/
      )
      assert.match(requests[0].url, /page=1&per_page=10/)
      assert.equal(requests[0].options?.signal, controller.signal)
      assert.equal(
        new Headers(requests[0].options?.headers).get('PRIVATE-TOKEN'),
        'gitlab-token'
      )
      assert.equal(
        new Headers(requests[0].options?.headers).get('Authorization'),
        null
      )

      responses.push(
        new Response(
          JSON.stringify([
            {
              iid: 2,
              title: 'Bad draft',
              created_at: '2026-07-01T00:00:00Z',
              updated_at: '2026-07-02T00:00:00Z',
              author: { username: 'fixture-bot' },
              draft: 'false',
            },
          ])
        )
      )
      await assert.rejects(
        gitlab.fetchProviderTriagePullRequests('group', 'material', 10),
        ProviderTriageJSONError
      )

      const github = API.fromAccount(
        account('github', 'https://api.github.com', 'github-token')
      )
      responses.push(
        new Response(
          JSON.stringify([
            {
              number: 3,
              title: 'GitHub pull request',
              created_at: '2026-07-01T00:00:00Z',
              updated_at: '2026-07-02T00:00:00Z',
              user: { login: 'fixture-bot' },
              draft: false,
            },
          ]),
          { headers: { link: '<https://api.github.com/page=2>; rel="next"' } }
        )
      )
      const githubPage = await github.fetchProviderTriagePullRequests(
        'desktop',
        'material',
        10
      )
      assert.equal(githubPage.capped, true)
      assert.match(requests[2].url, /repos\/desktop\/material\/pulls/)
      assert.equal(
        new Headers(requests[2].options?.headers).get('Authorization'),
        'Bearer github-token'
      )
      assert.equal(
        new Headers(requests[2].options?.headers).get('PRIVATE-TOKEN'),
        null
      )

      const bitbucket = API.fromAccount(
        account(
          'bitbucket',
          'https://api.bitbucket.org/2.0',
          'fixture-bot:app-password'
        )
      )
      responses.push(
        new Response(
          JSON.stringify({
            values: [
              {
                id: 4,
                title: 'Bitbucket pull request',
                created_on: '2026-07-01T00:00:00Z',
                updated_on: '2026-07-02T00:00:00Z',
                author: { nickname: 'fixture-bot' },
                draft: false,
              },
            ],
          })
        )
      )
      const bitbucketPage = await bitbucket.fetchProviderTriagePullRequests(
        'workspace',
        'material',
        10
      )
      assert.equal(bitbucketPage.items[0].number, 4)
      assert.match(
        requests[3].url,
        /repositories\/workspace\/material\/pullrequests/
      )
      assert.equal(
        new Headers(requests[3].options?.headers).get('Authorization'),
        `Basic ${Buffer.from('fixture-bot:app-password').toString('base64')}`
      )
      assert.equal(
        new Headers(requests[3].options?.headers).get('PRIVATE-TOKEN'),
        null
      )

      const requestCount = requests.length
      const unsupported = await bitbucket.fetchProviderTriageIssues(
        'workspace',
        'material',
        10
      )
      assert.equal(unsupported.supported, false)
      assert.equal(requests.length, requestCount)
      await assert.rejects(
        bitbucket.fetchProviderTriagePullRequests('../escape', 'material', 10)
      )
      assert.equal(requests.length, requestCount)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
