import assert from 'node:assert'
import { describe, it } from 'node:test'
import { API } from '../../src/lib/api'
import { GitHubIssueJSONError } from '../../src/lib/github-issue-json'

const apiIssue = {
  id: 1007,
  number: 7,
  title: 'Issue 7',
  body: 'A bounded issue body.',
  state: 'open',
  state_reason: null,
  user: { login: 'fixture-author' },
  created_at: '2026-07-13T10:00:00Z',
  updated_at: '2026-07-13T11:00:00Z',
  closed_at: null,
  html_url: 'https://github.com/desktop/material/issues/7',
  labels: [
    {
      id: 1,
      name: 'bug',
      color: 'd73a4a',
      description: 'Something is not working',
    },
  ],
  assignees: [{ login: 'fixture-maintainer' }],
  milestone: null,
  comments: 0,
  locked: false,
}

const apiComment = {
  id: 55,
  body: 'Reviewed comment',
  user: { login: 'fixture-reviewer' },
  created_at: '2026-07-13T12:00:00Z',
  updated_at: '2026-07-13T12:00:00Z',
  html_url: 'https://github.com/desktop/material/issues/7#issuecomment-55',
}

const query = {
  state: 'open' as const,
  search: '',
  labels: ['bug'],
  assignee: 'fixture-maintainer',
  milestone: 3,
  sort: 'updated' as const,
  direction: 'desc' as const,
  page: 2,
}

describe('GitHub Issues API', () => {
  it('uses locally generated browse, detail, and comment paths', async () => {
    const api = new API('https://api.github.com', 'synthetic-token')
    const requests = new Array<{ method: string; path: string }>()
    Reflect.set(api, 'ghRequest', async (method: string, path: string) => {
      requests.push({ method, path })
      return new Response(
        JSON.stringify(
          path.includes('/comments?')
            ? [apiComment]
            : path.endsWith('/7')
            ? apiIssue
            : [apiIssue]
        )
      )
    })

    const page = await api.fetchIssuePage('desktop', 'material', query)
    const detail = await api.fetchIssue('desktop', 'material', 7)
    const comments = await api.fetchIssueCommentPage(
      'desktop',
      'material',
      7,
      2
    )

    assert.equal(page.issues[0].number, 7)
    assert.equal(detail.title, 'Issue 7')
    assert.equal(comments.comments[0].id, 55)
    assert.deepEqual(requests, [
      {
        method: 'GET',
        path: 'repos/desktop/material/issues?per_page=30&page=2&sort=updated&direction=desc&state=open&labels=bug&assignee=fixture-maintainer&milestone=3',
      },
      { method: 'GET', path: 'repos/desktop/material/issues/7' },
      {
        method: 'GET',
        path: 'repos/desktop/material/issues/7/comments?per_page=30&page=2',
      },
    ])
  })

  it('quotes user search so it cannot introduce repository qualifiers', async () => {
    const api = new API('https://api.github.com', 'synthetic-token')
    let requestPath = ''
    Reflect.set(api, 'ghRequest', async (_method: string, path: string) => {
      requestPath = path
      return new Response(
        JSON.stringify({
          total_count: 1,
          incomplete_results: false,
          items: [apiIssue],
        })
      )
    })

    await api.fetchIssuePage('desktop', 'material', {
      ...query,
      page: 1,
      search: 'crash repo:attacker/private is:pr',
      milestone: null,
    })
    const decoded = decodeURIComponent(requestPath).replace(/\+/g, ' ')
    assert.match(decoded, /^search\/issues\?/)
    assert.match(decoded, /repo:desktop\/material is:issue is:open/)
    assert.match(decoded, /in:title,body "crash repo:attacker\/private is:pr"/)
    assert.equal((decoded.match(/repo:/g) ?? []).length, 2)
    assert.equal((decoded.match(/is:pr/g) ?? []).length, 1)
  })

  it('fetches metadata through bounded local pages and marks ambiguous 404 endpoints unavailable', async () => {
    const api = new API('https://api.github.example/api/v3', 'synthetic-token')
    const requests = new Array<string>()
    Reflect.set(api, 'ghRequest', async (_method: string, path: string) => {
      requests.push(path)
      if (path.includes('/assignees?')) {
        return new Response(JSON.stringify({ message: 'not available' }), {
          status: 404,
        })
      }
      if (path.includes('/labels?')) {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              name: 'bug',
              color: 'd73a4a',
              description: null,
            },
          ])
        )
      }
      return new Response(
        JSON.stringify([
          { number: 3, title: 'Next', state: 'open', due_on: null },
        ])
      )
    })

    const metadata = await api.fetchIssueMetadata('desktop', 'material')
    assert.deepEqual(
      metadata.labels.map(x => x.name),
      ['bug']
    )
    assert.deepEqual(metadata.assignees, [])
    assert.deepEqual(
      metadata.milestones.map(x => x.number),
      [3]
    )
    assert.deepEqual(metadata.unavailable, ['assignees'])
    assert.equal(requests.length, 3)
    assert.match(requests[0], /per_page=100&page=1$/)
  })

  it('sends only normalized reviewed mutation fields and validates responses', async () => {
    const api = new API('https://api.github.com', 'synthetic-token')
    const requests = new Array<{
      method: string
      path: string
      body: unknown
    }>()
    Reflect.set(
      api,
      'ghRequest',
      async (
        method: string,
        path: string,
        options?: { readonly body?: unknown }
      ) => {
        requests.push({ method, path, body: options?.body })
        if (path.endsWith('/comments')) {
          return new Response(JSON.stringify(apiComment))
        }
        const body = options?.body as { readonly state?: string } | undefined
        return new Response(
          JSON.stringify(
            body?.state === 'closed'
              ? {
                  ...apiIssue,
                  state: 'closed',
                  state_reason: 'completed',
                  closed_at: '2026-07-13T13:00:00Z',
                }
              : { ...apiIssue, title: 'Updated issue' }
          )
        )
      }
    )

    await api.updateIssue('desktop', 'material', 7, {
      title: '  Updated issue  ',
      body: 'Updated body',
      labels: ['bug'],
      assignees: ['fixture-maintainer'],
      milestone: 3,
    })
    await api.setIssueState('desktop', 'material', 7, 'closed')
    await api.addIssueComment('desktop', 'material', 7, 'Reviewed comment')

    assert.deepEqual(requests[0], {
      method: 'PATCH',
      path: 'repos/desktop/material/issues/7',
      body: {
        title: 'Updated issue',
        body: 'Updated body',
        labels: ['bug'],
        assignees: ['fixture-maintainer'],
        milestone: 3,
      },
    })
    assert.deepEqual(requests[1].body, { state: 'closed' })
    assert.deepEqual(requests[2].body, { body: 'Reviewed comment' })
  })

  it('rejects unsafe path parts, out-of-range pages, and oversized JSON before parsing', async () => {
    const api = new API('https://api.github.com', 'synthetic-token')
    await assert.rejects(() =>
      api.fetchIssuePage('../owner', 'material', query)
    )
    for (const owner of [
      'desktop" is:pr',
      'desktop:repo',
      'desktop@host',
      'desktop owner',
    ]) {
      await assert.rejects(() => api.fetchIssuePage(owner, 'material', query))
    }
    for (const repository of [
      'material" is:pr',
      'material:repo',
      'material@host',
      'material repo',
    ]) {
      await assert.rejects(() =>
        api.fetchIssuePage('desktop', repository, query)
      )
    }
    await assert.rejects(() =>
      api.fetchIssuePage('desktop', 'material', {
        ...query,
        search: 'crash',
        milestone: 3,
      })
    )
    await assert.rejects(() =>
      api.fetchIssueCommentPage('desktop', 'material', 7, 11)
    )

    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response('[]', {
          headers: { 'content-length': `${2 * 1024 * 1024 + 1}` },
        })
    )
    await assert.rejects(
      () => api.fetchIssuePage('desktop', 'material', query),
      error =>
        error instanceof GitHubIssueJSONError && error.kind === 'too-large'
    )
  })
})
