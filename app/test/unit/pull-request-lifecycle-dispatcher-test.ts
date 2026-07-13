import assert from 'node:assert'
import { describe, it } from 'node:test'

import { IGitHubPullRequestLifecycle } from '../../src/lib/github-pull-request'
import { Account } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { PullRequest, PullRequestRef } from '../../src/models/pull-request'
import {
  Repository,
  RepositoryWithGitHubRepository,
} from '../../src/models/repository'
import { Dispatcher } from '../../src/ui/dispatcher'

const endpoint = 'https://api.github.com'

function createRepository(owner: string, name: string, id: number) {
  return new GitHubRepository(
    name,
    new Owner(owner, endpoint, id),
    id,
    false,
    `https://github.com/${owner}/${name}`,
    `https://github.com/${owner}/${name}.git`,
    true,
    false,
    'write',
    null
  )
}

function createPullRequest(target: GitHubRepository) {
  return new PullRequest(
    new Date('2026-01-01T00:00:00Z'),
    'Lifecycle PR',
    42,
    new PullRequestRef('feature', 'a'.repeat(40), target),
    new PullRequestRef('main', 'b'.repeat(40), target),
    'octocat',
    false,
    ''
  )
}

function createAccount(accountEndpoint: string = endpoint) {
  return new Account(
    'octocat',
    accountEndpoint,
    'token',
    [],
    '',
    1,
    'octocat',
    'free'
  )
}

const lifecycle: IGitHubPullRequestLifecycle = {
  number: 42,
  title: 'Lifecycle PR',
  body: '',
  url: 'https://github.com/desktop/material/pull/42',
  state: 'open',
  draft: false,
  merged: false,
  mergeable: true,
  mergeableState: 'clean',
  headRef: 'feature',
  headSHA: 'a'.repeat(40),
  headRepository: 'octocat/material',
  base: 'main',
  metadata: { reviewers: [], assignees: [], labels: [] },
}

function createDispatcher() {
  const dispatcher = new Dispatcher(
    {
      _refreshPullRequests: async () => {},
    } as never,
    {} as never,
    { increment: () => {} } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  )
  const inspectCalls = new Array<{
    target: GitHubRepository
    account: Account
    pullRequestNumber: number
  }>()
  Reflect.set(dispatcher, 'pullRequestLifecycleStore', {
    async inspect(
      target: GitHubRepository,
      account: Account,
      pullRequestNumber: number
    ) {
      inspectCalls.push({ target, account, pullRequestNumber })
      return lifecycle
    },
  })
  return { dispatcher, inspectCalls }
}

describe('pull request lifecycle dispatcher routing', () => {
  it('binds inspection to the exact non-fork target and account endpoint', async () => {
    const target = createRepository('desktop', 'material', 1)
    const repository = new Repository(
      'C:\\fixtures\\material',
      1,
      target,
      false
    ) as RepositoryWithGitHubRepository
    const pullRequest = createPullRequest(target)
    const account = createAccount()
    const { dispatcher, inspectCalls } = createDispatcher()

    assert.equal(
      await dispatcher.inspectGitHubPullRequest(
        repository,
        pullRequest,
        account
      ),
      lifecycle
    )
    assert.deepEqual(inspectCalls, [{ target, account, pullRequestNumber: 42 }])
  })

  it('rejects cross-target and cross-endpoint routing before the store', () => {
    const target = createRepository('desktop', 'material', 1)
    const other = createRepository('attacker', 'material', 2)
    const repository = new Repository(
      'C:\\fixtures\\material',
      1,
      target,
      false
    ) as RepositoryWithGitHubRepository
    const { dispatcher, inspectCalls } = createDispatcher()

    assert.throws(() =>
      dispatcher.inspectGitHubPullRequest(
        repository,
        createPullRequest(other),
        createAccount()
      )
    )
    assert.throws(() =>
      dispatcher.inspectGitHubPullRequest(
        repository,
        createPullRequest(target),
        createAccount('https://ghe.invalid/api/v3')
      )
    )
    assert.deepEqual(inspectCalls, [])
  })
})
