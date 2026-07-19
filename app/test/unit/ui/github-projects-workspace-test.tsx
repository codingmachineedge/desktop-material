import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { IGitHubProjectsCache } from '../../../src/lib/github-projects-cache'
import { IGitHubProjectsClient } from '../../../src/lib/github-projects-loader'
import { IGitHubProjectsSnapshot } from '../../../src/lib/github-projects'
import {
  GitHubAPIWorkbenchRequest,
  IGitHubAPIWorkbenchResponse,
} from '../../../src/lib/github-api-workbench'
import { Account } from '../../../src/models/account'
import {
  ICLICommandOutputEvent,
  ICLICommandStateEvent,
  ICLIWorkbenchRuntime,
} from '../../../src/lib/cli-workbench'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import { GitHubProjectsWorkspace } from '../../../src/ui/github-projects'
import {
  IRepositoryToolsClient,
  RepositoryTools,
} from '../../../src/ui/repository-tools'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'

const endpoint = 'https://api.github.com'

function account(token: string = 'account-token') {
  return new Account('octocat', endpoint, token, [], '', 1, 'Octo Cat', 'free')
}

function repository(id: number = 1, name: string = 'material'): Repository {
  return new Repository(
    `C:\\fixtures\\${name}`,
    id,
    new GitHubRepository(
      name,
      new Owner('desktop', endpoint, 2),
      id,
      false,
      `https://github.com/desktop/${name}`,
      `https://github.com/desktop/${name}.git`,
      true
    ),
    false
  )
}

function snapshot(
  repositoryName: string = 'material'
): IGitHubProjectsSnapshot {
  return {
    version: 1,
    endpoint,
    owner: 'desktop',
    repository: repositoryName,
    source: 'projects-v2',
    fetchedAt: '2026-07-17T12:00:00.000Z',
    projects: [
      {
        id: 'project-one',
        number: 1,
        title: 'Roadmap',
        description: 'Repository planning',
        url: 'https://github.com/orgs/desktop/projects/1',
        state: 'open',
        updatedAt: '2026-07-17T11:00:00.000Z',
        views: [{ id: 'view-one', name: 'Board', layout: 'BOARD_LAYOUT' }],
        items: [
          {
            id: 'item-one',
            kind: 'issue',
            title: 'Offline cache item',
            url: null,
            state: 'OPEN',
            repository: `desktop/${repositoryName}`,
            status: 'In progress',
            updatedAt: '2026-07-17T10:00:00.000Z',
          },
        ],
        partial: false,
      },
      {
        id: 'project-two',
        number: 2,
        title: 'Next release',
        description: '',
        url: null,
        state: 'closed',
        updatedAt: null,
        views: [],
        items: [],
        partial: false,
      },
    ],
    partialReasons: ['items-capped'],
  }
}

class FixtureCache implements IGitHubProjectsCache {
  public readonly writes: Array<IGitHubProjectsSnapshot> = []

  public constructor(
    private readonly snapshots: Readonly<
      Record<string, IGitHubProjectsSnapshot>
    >
  ) {}

  public read(identity: { readonly repository: string }) {
    return this.snapshots[identity.repository] ?? null
  }

  public write(
    _identity: { readonly repository: string },
    value: IGitHubProjectsSnapshot
  ) {
    this.writes.push(value)
  }
}

function v2Response(repositoryName: string): IGitHubAPIWorkbenchResponse {
  const body = {
    data: {
      repository: {
        projectsV2: {
          nodes: [
            {
              id: `live-${repositoryName}`,
              number: 9,
              title: `Live ${repositoryName}`,
              shortDescription: '',
              url: null,
              closedAt: null,
              updatedAt: '2026-07-19T12:00:00Z',
              views: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
              items: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    },
  }
  return {
    status: 200,
    statusText: 'OK',
    headers: {},
    body,
    contentType: 'application/json',
    displayedBytes: JSON.stringify(body).length,
    truncated: false,
  }
}

class FixtureClient implements IGitHubProjectsClient {
  public readonly requests: Array<GitHubAPIWorkbenchRequest> = []

  public constructor(
    private readonly run: () => Promise<IGitHubAPIWorkbenchResponse>
  ) {}

  public executeGitHubAPIWorkbench = async (
    request: GitHubAPIWorkbenchRequest
  ) => {
    this.requests.push(request)
    return this.run()
  }
}

const repositoryToolsRuntime: ICLIWorkbenchRuntime = {
  tools: [
    {
      tool: 'git',
      available: true,
      version: 'git version 2.55.0',
      error: null,
    },
    {
      tool: 'gh',
      available: true,
      version: 'gh version 2.80.0',
      error: null,
    },
  ],
}

const repositoryToolsClient: IRepositoryToolsClient = {
  getRuntime: async () => repositoryToolsRuntime,
  start: async () => undefined,
  cancel: async () => false,
  onOutput: (_handler: (event: ICLICommandOutputEvent) => void) => () => {},
  onState: (_handler: (event: ICLICommandStateEvent) => void) => () => {},
}

describe('GitHub Projects workspace', () => {
  it('labels cached/stale/partial data and exposes status fields read-only', () => {
    const cache = new FixtureCache({ material: snapshot() })
    render(
      <GitHubProjectsWorkspace
        repository={repository()}
        accounts={[account()]}
        cache={cache}
        now={() => new Date('2026-07-19T13:00:00Z')}
        autoLoad={false}
      />
    )

    assert.ok(screen.getByText('Offline cache'))
    assert.ok(screen.getByText('Cached more than 24 hours ago'))
    assert.ok(screen.getByText(/Read-only:/))
    assert.ok(screen.getByText('Partial snapshot'))
    assert.ok(screen.getByText('In progress'))
    assert.ok(screen.getByText('Offline cache item'))
  })

  it('switches between loaded projects without exposing edit controls', () => {
    render(
      <GitHubProjectsWorkspace
        repository={repository()}
        accounts={[account()]}
        cache={new FixtureCache({ material: snapshot() })}
        autoLoad={false}
      />
    )
    const list = screen.getByRole('navigation', {
      name: 'Repository Projects',
    })
    fireEvent.click(within(list).getByText('Next release'))
    assert.ok(screen.getByRole('heading', { name: 'Next release' }))
    assert.ok(screen.getByText('Closed'))
    assert.equal(screen.queryByRole('button', { name: /edit/i }), null)
    assert.equal(screen.queryByRole('button', { name: /delete/i }), null)
  })

  it('keeps a cached snapshot visible when signed out', () => {
    render(
      <GitHubProjectsWorkspace
        repository={repository()}
        accounts={[]}
        cache={new FixtureCache({ material: snapshot() })}
        autoLoad={false}
      />
    )
    assert.ok(screen.getByText('Offline cache'))
    assert.ok(
      screen
        .getByRole('alert')
        .textContent?.includes(
          'Sign in with the GitHub account selected for this repository'
        )
    )
    assert.ok(screen.getByText('Offline cache item'))
  })

  it('promotes a successful refresh to live and writes the validated cache', async () => {
    const cache = new FixtureCache({})
    const client = new FixtureClient(async () => v2Response('material'))
    render(
      <GitHubProjectsWorkspace
        repository={repository()}
        accounts={[account()]}
        cache={cache}
        clientFactory={() => client}
        autoLoad={false}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Projects' }))
    await waitFor(() => assert.ok(screen.getByText('Live from GitHub')))
    assert.ok(screen.getByRole('heading', { name: 'Live material' }))
    assert.equal(cache.writes.length, 1)
    assert.equal(client.requests[0].mode, 'graphql')
  })

  it('discards a completed response after the repository context changes', async () => {
    let resolve: ((value: IGitHubAPIWorkbenchResponse) => void) | null = null
    const deferred = new Promise<IGitHubAPIWorkbenchResponse>(done => {
      resolve = done
    })
    const client = new FixtureClient(() => deferred)
    const cache = new FixtureCache({})
    const view = render(
      <GitHubProjectsWorkspace
        repository={repository(1, 'material')}
        accounts={[account()]}
        cache={cache}
        clientFactory={() => client}
        autoLoad={false}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Projects' }))
    view.rerender(
      <GitHubProjectsWorkspace
        repository={repository(2, 'different')}
        accounts={[account()]}
        cache={cache}
        clientFactory={() => client}
        autoLoad={false}
      />
    )
    resolve!(v2Response('material'))
    await waitFor(() => assert.equal(screen.queryByText('Live material'), null))
    assert.equal(cache.writes.length, 0)
    assert.ok(screen.getByText('No Projects returned'))
  })

  it('adds one conditional Projects entry to the repository Tools hub', async () => {
    const hosted = repository()
    render(
      <RepositoryTools
        repository={hosted}
        repositoryPath={hosted.path}
        onRefreshRepository={async () => undefined}
        client={repositoryToolsClient}
        githubProjects={{ repository: hosted, accounts: [account()] }}
      />
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: /GitHub Projects/i }))
    )
  })
})
