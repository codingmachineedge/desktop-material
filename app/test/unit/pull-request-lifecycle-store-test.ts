import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  IGitHubPullRequestLifecycle,
  IGitHubPullRequestMergeReceipt,
  IGitHubPullRequestMutationReceipt,
  IGitHubPullRequestReviewReceipt,
} from '../../src/lib/github-pull-request'
import { PullRequestLifecycleStore } from '../../src/lib/stores/pull-request-lifecycle-store'
import { Account } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'

const endpoint = 'https://api.github.com'

function createAccount(
  login: string = 'octocat',
  accountEndpoint: string = endpoint
) {
  return new Account(
    login,
    accountEndpoint,
    'token',
    [],
    '',
    login.length,
    login,
    'free'
  )
}

function createRepository() {
  return new GitHubRepository(
    'material',
    new Owner('desktop', endpoint, 1),
    2,
    false,
    'https://github.com/desktop/material',
    'https://github.com/desktop/material.git',
    true,
    false,
    'write',
    null
  )
}

function snapshot(
  headSHA: string = 'a'.repeat(40)
): IGitHubPullRequestLifecycle {
  return {
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
    headSHA,
    headRepository: 'octocat/material',
    base: 'main',
    metadata: { reviewers: [], assignees: [], labels: [] },
  }
}

class FakeAPI {
  public inspectResult = Promise.resolve(snapshot())
  public updateCalls = 0
  public reviewCalls = 0
  public mergeCalls = 0

  public inspectPullRequest() {
    return this.inspectResult
  }

  public async updatePullRequestLifecycle(): Promise<IGitHubPullRequestMutationReceipt> {
    this.updateCalls++
    return { pullRequest: { ...snapshot(), title: 'Updated' }, warnings: [] }
  }

  public async submitPullRequestReview(): Promise<IGitHubPullRequestReviewReceipt> {
    this.reviewCalls++
    return {
      id: 1,
      state: 'APPROVED',
      url: 'https://github.com/desktop/material/pull/42',
    }
  }

  public async mergePullRequest(): Promise<IGitHubPullRequestMergeReceipt> {
    this.mergeCalls++
    return {
      merged: true,
      sha: 'b'.repeat(40),
      message: 'Pull request merged.',
    }
  }
}

describe('PullRequestLifecycleStore', () => {
  it('caches an account-scoped inspect and requires its exact head for mutation', async () => {
    const api = new FakeAPI()
    const store = new PullRequestLifecycleStore(() => api)
    const target = createRepository()
    const account = createAccount()

    const inspected = await store.inspect(target, account, 42)
    assert.equal(store.get(target, account, 42), inspected)
    const updated = await store.update(target, account, 42, inspected.headSHA, {
      title: 'Updated',
      body: '',
      base: 'main',
      metadata: { reviewers: [], assignees: [], labels: [] },
    })
    assert.equal(updated.pullRequest.title, 'Updated')
    assert.equal(api.updateCalls, 1)

    await assert.rejects(() =>
      store.review(target, account, 42, 'c'.repeat(40), {
        event: 'APPROVE',
        body: '',
      })
    )
    assert.equal(api.reviewCalls, 0)
  })

  it('rejects a non-GitHub or cross-endpoint account before transport', async () => {
    const api = new FakeAPI()
    const store = new PullRequestLifecycleStore(() => api)
    const target = createRepository()
    await assert.rejects(() =>
      store.inspect(target, createAccount('other', 'https://ghe.invalid'), 42)
    )
    assert.equal(store.get(target, createAccount(), 42), null)
  })

  it('invalidates a merged snapshot and blocks stale responses', async () => {
    const api = new FakeAPI()
    const store = new PullRequestLifecycleStore(() => api)
    const target = createRepository()
    const account = createAccount()
    const inspected = await store.inspect(target, account, 42)
    await store.merge(target, account, 42, inspected.headSHA, 'squash')
    assert.equal(api.mergeCalls, 1)
    assert.equal(store.get(target, account, 42), null)

    let resolveFirst!: (value: IGitHubPullRequestLifecycle) => void
    api.inspectResult = new Promise(resolve => {
      resolveFirst = resolve
    })
    const stale = store.inspect(target, account, 42)
    api.inspectResult = Promise.resolve(snapshot('d'.repeat(40)))
    const fresh = await store.inspect(target, account, 42)
    resolveFirst(snapshot())
    await assert.rejects(stale)
    assert.equal(store.get(target, account, 42), fresh)
  })
})
