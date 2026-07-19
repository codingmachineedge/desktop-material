import assert from 'node:assert'
import { describe, it } from 'node:test'

import { normalizeGitHubPullRequestDraft } from '../../src/lib/github-pull-request'
import { emptyGitHubPullRequestCreationContext } from '../../src/lib/github-pull-request-creation'
import { Account } from '../../src/models/account'
import { Branch, BranchType } from '../../src/models/branch'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { RepositoryWithGitHubRepository } from '../../src/models/repository'
import { Repository } from '../../src/models/repository'
import { Dispatcher } from '../../src/ui/dispatcher'

const endpoint = 'https://api.github.com'

function githubRepository(
  owner: string,
  parent: GitHubRepository | null = null,
  id: number = 1
) {
  return new GitHubRepository(
    'material',
    new Owner(owner, endpoint, id),
    id,
    false,
    `https://github.com/${owner}/material`,
    `https://github.com/${owner}/material.git`,
    true,
    false,
    'write',
    parent
  )
}

function account() {
  return new Account('octocat', endpoint, 'token', [], '', 1, 'octocat', 'free')
}

function fixture() {
  const target = githubRepository('desktop', null, 1)
  const source = githubRepository('octocat', target, 2)
  const repository = new Repository(
    'C:\\fixtures\\material',
    1,
    source,
    false
  ) as RepositoryWithGitHubRepository
  const branch = new Branch(
    'feature/local',
    'origin/published',
    { sha: 'a'.repeat(40) },
    BranchType.Local,
    'refs/heads/feature/local'
  )
  return {
    target,
    source,
    repository,
    branch,
    remote: {
      name: 'origin',
      url: 'https://github.com/octocat/material.git',
    },
  }
}

describe('pull request creation dispatcher routing', () => {
  it('loads and creates through the exact account-bound target and head', async () => {
    const value = fixture()
    const selectedAccount = account()
    const calls = new Array<{
      readonly kind: string
      readonly value: unknown
    }>()
    const dispatcher = new Dispatcher(
      { _isGitHubPullRequestContextCurrent: () => true } as never,
      {} as never,
      { increment: () => {} } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    )
    Reflect.set(dispatcher, 'pullRequestCreationStore', {
      async inspect(
        target: GitHubRepository,
        selected: Account,
        base: string,
        head: string
      ) {
        calls.push({ kind: 'inspect', value: { target, selected, base, head } })
        return emptyGitHubPullRequestCreationContext()
      },
      async create(
        target: GitHubRepository,
        selected: Account,
        draft: unknown,
        headRepository: unknown,
        metadata: unknown
      ) {
        calls.push({
          kind: 'create',
          value: { target, selected, draft, headRepository, metadata },
        })
        return {
          number: 9,
          title: 'Native creation',
          url: 'https://github.com/desktop/material/pull/9',
          draft: false,
        }
      },
    })

    const context = await dispatcher.inspectGitHubPullRequestCreation(
      value.repository,
      value.target,
      selectedAccount,
      value.branch,
      value.remote,
      'https://github.com',
      'context-1',
      'main'
    )
    assert.deepEqual(context, emptyGitHubPullRequestCreationContext())

    const draft = normalizeGitHubPullRequestDraft(
      'Native creation',
      '',
      'octocat:published',
      'main',
      false
    )
    const metadata = {
      reviewers: ['reviewer'],
      assignees: [],
      labels: ['ready'],
      milestone: 3,
    }
    const created = await dispatcher.createGitHubPullRequest(
      value.repository,
      value.target,
      selectedAccount,
      value.branch,
      value.remote,
      'https://github.com',
      'context-1',
      draft,
      metadata,
      new AbortController().signal
    )
    assert.equal(created.number, 9)
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[0].value, {
      target: value.target,
      selected: selectedAccount,
      base: 'main',
      head: 'octocat:published',
    })
    assert.deepEqual(calls[1].value, {
      target: value.target,
      selected: selectedAccount,
      draft,
      headRepository: { name: null, fullName: 'octocat/material' },
      metadata,
    })
  })

  it('fails closed before optional discovery when the local context is stale', async () => {
    const value = fixture()
    const dispatcher = new Dispatcher(
      { _isGitHubPullRequestContextCurrent: () => false } as never,
      {} as never,
      { increment: () => {} } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    )
    let inspected = false
    Reflect.set(dispatcher, 'pullRequestCreationStore', {
      async inspect() {
        inspected = true
        return emptyGitHubPullRequestCreationContext()
      },
    })

    await assert.rejects(() =>
      dispatcher.inspectGitHubPullRequestCreation(
        value.repository,
        value.target,
        account(),
        value.branch,
        value.remote,
        'https://github.com',
        'stale',
        'main'
      )
    )
    assert.equal(inspected, false)
  })
})
