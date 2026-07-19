import assert from 'node:assert'
import { describe, it } from 'node:test'

import { GitHubPullRequestContextChangedError } from '../../src/lib/github-pull-request'
import {
  emptyGitHubPullRequestCreationContext,
  IGitHubPullRequestCreationMetadata,
} from '../../src/lib/github-pull-request-creation'
import {
  IPullRequestCreationAPI,
  PullRequestCreationStore,
} from '../../src/lib/stores/pull-request-creation-store'
import { Account } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'

const endpoint = 'https://api.github.com'

function repository() {
  return new GitHubRepository(
    'material',
    new Owner('desktop', endpoint, 1),
    1,
    false,
    'https://github.com/desktop/material',
    'https://github.com/desktop/material.git',
    true,
    false,
    'write',
    null
  )
}

function account() {
  return new Account('octocat', endpoint, 'token', [], '', 1, 'octocat', 'free')
}

describe('PullRequestCreationStore', () => {
  it('binds discovery and creation to the exact account, base, and head', async () => {
    const target = repository()
    const selectedAccount = account()
    const calls = new Array<{
      readonly kind: string
      readonly value: unknown
    }>()
    const api: IPullRequestCreationAPI = {
      async inspectPullRequestCreation(owner, name, base) {
        calls.push({ kind: 'inspect', value: { owner, name, base } })
        return emptyGitHubPullRequestCreationContext()
      },
      async createPullRequest(
        owner,
        name,
        title,
        body,
        head,
        base,
        draft,
        headRepository,
        _signal,
        metadata
      ) {
        calls.push({
          kind: 'create',
          value: {
            owner,
            name,
            title,
            body,
            head,
            base,
            draft,
            headRepository,
            metadata,
          },
        })
        return {
          number: 9,
          title,
          url: 'https://github.com/desktop/material/pull/9',
          draft,
        }
      },
    }
    const store = new PullRequestCreationStore(() => api)
    await store.inspect(target, selectedAccount, 'main', 'octocat:feature')
    const metadata: IGitHubPullRequestCreationMetadata = {
      reviewers: ['reviewer'],
      assignees: ['octocat'],
      labels: ['ready'],
      milestone: 4,
    }
    const created = await store.create(
      target,
      selectedAccount,
      {
        title: 'Reviewed creation',
        body: '',
        head: 'octocat:feature',
        headRepository: { name: null, fullName: 'octocat/material' },
        base: 'main',
        draft: true,
      },
      { name: null, fullName: 'octocat/material' },
      metadata
    )

    assert.equal(created.number, 9)
    assert.deepEqual(calls, [
      {
        kind: 'inspect',
        value: { owner: 'desktop', name: 'material', base: 'main' },
      },
      {
        kind: 'create',
        value: {
          owner: 'desktop',
          name: 'material',
          title: 'Reviewed creation',
          body: '',
          head: 'octocat:feature',
          base: 'main',
          draft: true,
          headRepository: { name: null, fullName: 'octocat/material' },
          metadata,
        },
      },
    ])
  })

  it('rejects creation when the reviewed route was never inspected', async () => {
    const store = new PullRequestCreationStore(() => {
      throw new Error('API must not be requested')
    })
    await assert.rejects(
      () =>
        store.create(
          repository(),
          account(),
          {
            title: 'Unreviewed',
            body: '',
            head: 'octocat:feature',
            headRepository: { name: null, fullName: 'octocat/material' },
            base: 'main',
            draft: false,
          },
          { name: null, fullName: 'octocat/material' },
          { reviewers: [], assignees: [], labels: [] }
        ),
      GitHubPullRequestContextChangedError
    )
  })

  it('prevents an older discovery response from replacing a newer context', async () => {
    const resolvers = new Array<
      (value: ReturnType<typeof emptyGitHubPullRequestCreationContext>) => void
    >()
    const store = new PullRequestCreationStore(() => ({
      inspectPullRequestCreation: () =>
        new Promise(resolve => {
          resolvers.push(resolve)
        }),
      createPullRequest: async () => {
        throw new Error('not used')
      },
    }))
    const target = repository()
    const selectedAccount = account()
    const first = store.inspect(
      target,
      selectedAccount,
      'main',
      'octocat:feature'
    )
    const second = store.inspect(
      target,
      selectedAccount,
      'main',
      'octocat:feature'
    )
    const newest = emptyGitHubPullRequestCreationContext(['templates'])
    resolvers[1](newest)
    assert.equal(await second, newest)
    resolvers[0](emptyGitHubPullRequestCreationContext())
    await assert.rejects(first, GitHubPullRequestContextChangedError)
    assert.equal(
      store.get(target, selectedAccount, 'main', 'octocat:feature'),
      newest
    )
  })
})
