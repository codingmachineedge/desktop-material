import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  GitHubProjectsCache,
  GitHubProjectsCacheMaximumSnapshotBytes,
  GitHubProjectsCacheStorageKey,
  IGitHubProjectsCacheStorage,
  countGitHubProjectItems,
  fitGitHubProjectsSnapshotForCache,
  getGitHubProjectsCacheKey,
  isGitHubProjectsSnapshotStale,
} from '../../src/lib/github-projects-cache'
import {
  GitHubProjectsError,
  GitHubProjectsV2RepositoryQuery,
  IGitHubProjectsClient,
  loadGitHubProjects,
} from '../../src/lib/github-projects-loader'
import {
  GitHubProjectsMaximumItems,
  GitHubProjectsMaximumProjectPages,
  GitHubProjectsProjectPageSize,
  IGitHubProjectsSnapshot,
  parseGitHubProjectsV2Page,
  responseIndicatesProjectsV2Unsupported,
  sanitizeGitHubProjectsSnapshot,
} from '../../src/lib/github-projects'
import {
  GitHubAPIWorkbenchRequest,
  IGitHubAPIWorkbenchResponse,
} from '../../src/lib/github-api-workbench'
import { translate } from '../../src/lib/i18n'

const identity = {
  endpoint: 'https://api.github.com',
  owner: 'desktop',
  repository: 'material',
}

function response(
  body: unknown,
  status: number = 200,
  headers: Readonly<Record<string, string>> = {}
): IGitHubAPIWorkbenchResponse {
  return {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers,
    body,
    contentType: 'application/json',
    displayedBytes: JSON.stringify(body).length,
    truncated: false,
  }
}

function projectNode(
  id: string = 'PVT_one',
  items: ReadonlyArray<unknown> = [
    {
      id: 'PVTI_one',
      type: 'ISSUE',
      updatedAt: '2026-07-19T10:00:00Z',
      fieldValueByName: { name: 'In progress' },
      content: {
        title: 'Bounded Projects',
        url: 'https://github.com/desktop/material/issues/42#fragment',
        state: 'OPEN',
        repository: { nameWithOwner: 'desktop/material' },
      },
    },
  ],
  itemPageInfo: {
    readonly hasNextPage: boolean
    readonly endCursor: string | null
  } = { hasNextPage: false, endCursor: null }
) {
  return {
    id,
    number: 7,
    title: 'Desktop roadmap',
    shortDescription: 'Read-only planning context',
    url: 'https://github.com/orgs/desktop/projects/7',
    closedAt: null,
    updatedAt: '2026-07-19T11:00:00Z',
    views: {
      nodes: [{ id: 'view-1', name: 'Board', layout: 'BOARD_LAYOUT' }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    items: {
      nodes: items,
      pageInfo: itemPageInfo,
    },
  }
}

function projectsV2Body(
  projects: ReadonlyArray<unknown> = [projectNode()],
  hasNextPage: boolean = false,
  endCursor: string | null = null
) {
  return {
    data: {
      repository: {
        projectsV2: {
          nodes: projects,
          pageInfo: { hasNextPage, endCursor },
        },
      },
    },
  }
}

class QueueClient implements IGitHubProjectsClient {
  public readonly requests: Array<GitHubAPIWorkbenchRequest> = []

  public constructor(
    private readonly responses: Array<IGitHubAPIWorkbenchResponse>
  ) {}

  public executeGitHubAPIWorkbench = async (
    request: GitHubAPIWorkbenchRequest
  ): Promise<IGitHubAPIWorkbenchResponse> => {
    this.requests.push(request)
    const next = this.responses.shift()
    assert.notEqual(next, undefined, 'unexpected Projects request')
    return next!
  }
}

class MemoryStorage implements IGitHubProjectsCacheStorage {
  public readonly values = new Map<string, string>()
  public removed = false

  public getItem(key: string) {
    return this.values.get(key) ?? null
  }

  public setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  public removeItem(key: string) {
    this.removed = true
    this.values.delete(key)
  }
}

function snapshot(
  overrides: Partial<IGitHubProjectsSnapshot> = {}
): IGitHubProjectsSnapshot {
  const parsed = sanitizeGitHubProjectsSnapshot({
    version: 1,
    endpoint: identity.endpoint,
    owner: identity.owner,
    repository: identity.repository,
    source: 'projects-v2',
    fetchedAt: '2026-07-19T12:00:00.000Z',
    projects: [
      {
        id: 'project-1',
        number: 1,
        title: 'Roadmap',
        description: 'A cached roadmap',
        url: 'https://github.com/orgs/desktop/projects/1',
        state: 'open',
        updatedAt: '2026-07-19T11:00:00.000Z',
        views: [{ id: 'view-1', name: 'Board', layout: 'board' }],
        items: [
          {
            id: 'item-1',
            kind: 'issue',
            title: 'Offline item',
            url: 'https://github.com/desktop/material/issues/1',
            state: 'OPEN',
            repository: 'desktop/material',
            status: 'Todo',
            updatedAt: '2026-07-19T10:00:00.000Z',
          },
        ],
        partial: false,
      },
    ],
    partialReasons: [],
    ...overrides,
  })
  assert.notEqual(parsed, null)
  return parsed!
}

describe('GitHub Projects normalization and loader', () => {
  it('normalizes v2 views, items, Status, dates, and safe links', () => {
    const parsed = parseGitHubProjectsV2Page(projectsV2Body())
    assert.equal(parsed.projects.length, 1)
    const project = parsed.projects[0]
    assert.equal(project.title, 'Desktop roadmap')
    assert.equal(project.views[0].name, 'Board')
    assert.equal(project.items[0].kind, 'issue')
    assert.equal(project.items[0].status, 'In progress')
    assert.equal(project.items[0].repository, 'desktop/material')
    assert.equal(
      project.items[0].url,
      'https://github.com/desktop/material/issues/42'
    )
  })

  it('drops credential-bearing links and bounds project pages', () => {
    const projects = Array.from(
      { length: GitHubProjectsProjectPageSize + 3 },
      (_, index) =>
        projectNode(`project-${index}`, [
          {
            id: `item-${index}`,
            type: 'ISSUE',
            content: {
              title: 'Unsafe link',
              url: 'https://username:password@example.com/item',
            },
          },
        ])
    )
    const parsed = parseGitHubProjectsV2Page(projectsV2Body(projects))
    assert.equal(parsed.projects.length, GitHubProjectsProjectPageSize)
    assert.equal(parsed.projects[0].items[0].url, null)
  })

  it('uses only fixed read queries and returns a sanitized live snapshot', async () => {
    assert.doesNotMatch(GitHubProjectsV2RepositoryQuery, /\bmutation\b/i)
    const client = new QueueClient([response(projectsV2Body())])
    const result = await loadGitHubProjects(
      identity,
      client,
      new AbortController().signal,
      new Date('2026-07-19T12:00:00Z')
    )
    assert.equal(result.source, 'projects-v2')
    assert.equal(result.projects[0].items[0].status, 'In progress')
    assert.equal(client.requests.length, 1)
    assert.equal(client.requests[0].mode, 'graphql')
  })

  it('falls back to classic reads only for an unsupported v2 capability', async () => {
    const unsupported = response({
      errors: [
        { message: 'Cannot query field "projectsV2" on type "Repository".' },
      ],
    })
    assert.equal(responseIndicatesProjectsV2Unsupported(unsupported), true)
    const client = new QueueClient([
      unsupported,
      response([
        {
          id: 11,
          name: 'Classic board',
          body: 'Legacy context',
          state: 'open',
          updated_at: '2026-07-18T10:00:00Z',
          html_url: 'https://github.com/desktop/material/projects/11',
        },
      ]),
      response([{ id: 12, name: 'Doing' }]),
      response([
        {
          id: 13,
          note: 'Classic note',
          updated_at: '2026-07-18T11:00:00Z',
        },
      ]),
    ])
    const result = await loadGitHubProjects(
      identity,
      client,
      new AbortController().signal
    )
    assert.equal(result.source, 'classic')
    assert.ok(result.partialReasons.includes('classic-fallback'))
    assert.equal(result.projects[0].items[0].status, 'Doing')
    assert.equal(client.requests[1].mode, 'rest')
  })

  it('does not use the classic fallback for permission failures', async () => {
    const client = new QueueClient([
      response({}, 403, { 'x-ratelimit-remaining': '12' }),
    ])
    await assert.rejects(
      loadGitHubProjects(identity, client, new AbortController().signal),
      (error: unknown) =>
        error instanceof GitHubProjectsError && error.kind === 'permission'
    )
    assert.equal(client.requests.length, 1)
  })

  it('stops at the hard project-page cap and labels the snapshot partial', async () => {
    const responses = Array.from(
      { length: GitHubProjectsMaximumProjectPages },
      (_, index) =>
        response(
          projectsV2Body(
            Array.from({ length: GitHubProjectsProjectPageSize }, (_v, item) =>
              projectNode(`project-${index}-${item}`, [])
            ),
            true,
            `cursor-${index}`
          )
        )
    )
    const client = new QueueClient(responses)
    const result = await loadGitHubProjects(
      identity,
      client,
      new AbortController().signal
    )
    assert.equal(client.requests.length, GitHubProjectsMaximumProjectPages)
    assert.equal(
      result.projects.length,
      GitHubProjectsProjectPageSize * GitHubProjectsMaximumProjectPages
    )
    assert.ok(result.partialReasons.includes('projects-capped'))
  })

  it('loads at most two item pages for one project', async () => {
    const items = (prefix: string) =>
      Array.from({ length: 25 }, (_value, index) => ({
        id: `${prefix}-${index}`,
        type: 'ISSUE',
        content: { title: `${prefix} ${index}` },
      }))
    const client = new QueueClient([
      response(
        projectsV2Body([
          projectNode('paged-project', items('first'), {
            hasNextPage: true,
            endCursor: 'item-cursor-1',
          }),
        ])
      ),
      response({
        data: {
          node: {
            items: {
              nodes: items('second'),
              pageInfo: {
                hasNextPage: true,
                endCursor: 'item-cursor-2',
              },
            },
          },
        },
      }),
    ])
    const result = await loadGitHubProjects(
      identity,
      client,
      new AbortController().signal
    )
    assert.equal(client.requests.length, 2)
    assert.equal(result.projects[0].items.length, 50)
    assert.ok(result.partialReasons.includes('items-capped'))
  })

  it('normalizes no more than 200 items across all loaded projects', async () => {
    const page = (prefix: string) =>
      Array.from({ length: GitHubProjectsProjectPageSize }, (_value, project) =>
        projectNode(
          `${prefix}-project-${project}`,
          Array.from({ length: 25 }, (_itemValue, item) => ({
            id: `${prefix}-${project}-${item}`,
            type: 'ISSUE',
            content: { title: `Item ${item}` },
          }))
        )
      )
    const client = new QueueClient([
      response(projectsV2Body(page('one'), true, 'project-cursor')),
      response(projectsV2Body(page('two'))),
    ])
    const result = await loadGitHubProjects(
      identity,
      client,
      new AbortController().signal
    )
    assert.equal(countGitHubProjectItems(result), GitHubProjectsMaximumItems)
    assert.ok(result.partialReasons.includes('items-capped'))
  })
})

describe('GitHub Projects offline cache', () => {
  it('round-trips a validated snapshot without account credentials', () => {
    const storage = new MemoryStorage()
    const cache = new GitHubProjectsCache(storage)
    cache.write(identity, snapshot(), new Date('2026-07-19T12:30:00Z'))
    const serialized = storage.values.get(GitHubProjectsCacheStorageKey)
    assert.notEqual(serialized, undefined)
    assert.doesNotMatch(serialized!, /token|authorization|cookie/i)
    assert.deepEqual(cache.read(identity), snapshot())
    assert.equal(
      cache.read({ ...identity, repository: 'different-repository' }),
      null
    )
  })

  it('rejects malformed owned cache data and removes only its own key', () => {
    const storage = new MemoryStorage()
    storage.values.set(GitHubProjectsCacheStorageKey, '{not-json')
    const cache = new GitHubProjectsCache(storage)
    assert.equal(cache.read(identity), null)
    assert.equal(storage.removed, true)
  })

  it('marks snapshots stale only after 24 hours', () => {
    const value = snapshot()
    assert.equal(
      isGitHubProjectsSnapshotStale(value, new Date('2026-07-20T11:59:59Z')),
      false
    )
    assert.equal(
      isGitHubProjectsSnapshotStale(value, new Date('2026-07-20T12:00:01Z')),
      true
    )
  })

  it('trims oversized display metadata within the per-snapshot budget', () => {
    const manyItems = Array.from(
      { length: GitHubProjectsMaximumItems },
      (_, index) => ({
        id: `item-${index}`,
        kind: 'issue' as const,
        title: `Item ${index}`,
        url: `https://example.com/${'x'.repeat(1_900)}${index}`,
        state: 'OPEN',
        repository: 'desktop/material',
        status: 'Todo',
        updatedAt: '2026-07-19T10:00:00Z',
      })
    )
    const value = snapshot({
      projects: [
        {
          ...snapshot().projects[0],
          items: manyItems,
        },
      ],
    })
    const fitted = fitGitHubProjectsSnapshotForCache(value)
    assert.notEqual(fitted, null)
    assert.ok(
      new TextEncoder().encode(JSON.stringify(fitted)).byteLength <=
        GitHubProjectsCacheMaximumSnapshotBytes
    )
    assert.ok(countGitHubProjectItems(fitted!) < GitHubProjectsMaximumItems)
    assert.ok(fitted!.partialReasons.includes('items-capped'))
  })

  it('uses endpoint and repository coordinates for cache isolation', () => {
    assert.notEqual(getGitHubProjectsCacheKey(identity), null)
    assert.notEqual(
      getGitHubProjectsCacheKey(identity),
      getGitHubProjectsCacheKey({
        ...identity,
        endpoint: 'https://github.example/api/v3',
      })
    )
    assert.equal(
      getGitHubProjectsCacheKey({ ...identity, owner: '../escape' }),
      null
    )
  })
})

describe('GitHub Projects language modes', () => {
  it('ships English, playful Hong Kong Cantonese, and bilingual copy', () => {
    assert.match(translate('projects.readOnly', 'english'), /Read-only/)
    assert.match(translate('projects.readOnly', 'cantonese'), /唯讀/)
    const bilingual = translate('projects.readOnly', 'bilingual')
    assert.match(bilingual, /Read-only/)
    assert.match(bilingual, /唯讀/)
  })
})
