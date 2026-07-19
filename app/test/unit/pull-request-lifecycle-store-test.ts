import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  IGitHubPullRequestLifecycle,
  IGitHubPullRequestMergeReceipt,
  IGitHubPullRequestMutationReceipt,
  IGitHubPullRequestReview,
  IGitHubPullRequestReviewReceipt,
} from '../../src/lib/github-pull-request'
import { IGitHubPullRequestWorkspace } from '../../src/lib/github-pull-request-workspace'
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

function workspace(
  headSHA: string = 'a'.repeat(40)
): IGitHubPullRequestWorkspace {
  return {
    headSHA,
    files: [
      {
        sha: 'b'.repeat(40),
        path: 'README.md',
        previousPath: null,
        status: 'modified',
        additions: 1,
        deletions: 1,
        changes: 2,
        patch: '@@ -1 +1 @@',
      },
    ],
    commits: [],
    reviews: [],
    issueComments: [],
    reviewComments: [
      {
        id: 7,
        reviewId: 5,
        body: 'Thread',
        author: 'reviewer',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        path: 'README.md',
        line: 1,
        side: 'RIGHT',
        startLine: null,
        inReplyToId: null,
        commitSHA: headSHA,
        diffHunk: '@@ -1 +1 @@',
      },
    ],
    capped: {
      files: false,
      commits: false,
      reviews: false,
      issueComments: false,
      reviewComments: false,
    },
  }
}

class FakeAPI {
  public inspectResult = Promise.resolve(snapshot())
  public workspaceResult = Promise.resolve(workspace())
  public updateCalls = 0
  public reviewCalls = 0
  public mergeCalls = 0
  public stateCalls = 0
  public lastReview: IGitHubPullRequestReview | null = null

  public inspectPullRequest() {
    return this.inspectResult
  }

  public inspectPullRequestWorkspace() {
    return this.workspaceResult
  }

  public async updatePullRequestLifecycle(): Promise<IGitHubPullRequestMutationReceipt> {
    this.updateCalls++
    return { pullRequest: { ...snapshot(), title: 'Updated' }, warnings: [] }
  }

  public async setPullRequestState(
    _owner: string,
    _name: string,
    _number: number,
    _headSHA: string,
    state: 'open' | 'closed'
  ): Promise<IGitHubPullRequestMutationReceipt> {
    this.stateCalls++
    return {
      pullRequest: { ...snapshot(), state },
      warnings: [],
    }
  }

  public async submitPullRequestReview(
    _owner: string,
    _name: string,
    _number: number,
    _headSHA: string,
    review: IGitHubPullRequestReview
  ): Promise<IGitHubPullRequestReviewReceipt> {
    this.reviewCalls++
    this.lastReview = review
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

  it('binds inline comments and replies to a loaded workspace for the exact head', async () => {
    const api = new FakeAPI()
    const store = new PullRequestLifecycleStore(() => api)
    const target = createRepository()
    const account = createAccount()
    const inspected = await store.inspect(target, account, 42)

    await assert.rejects(() =>
      store.review(target, account, 42, inspected.headSHA, {
        event: 'COMMENT',
        body: 'Review',
        comments: [
          { path: 'README.md', line: 1, side: 'RIGHT', body: 'Inline' },
        ],
      })
    )
    assert.equal(api.reviewCalls, 0)

    await store.inspectWorkspace(target, account, 42, inspected.headSHA)
    await assert.rejects(() =>
      store.review(target, account, 42, inspected.headSHA, {
        event: 'COMMENT',
        body: 'Review',
        comments: [
          { path: 'unknown.ts', line: 1, side: 'RIGHT', body: 'Inline' },
        ],
      })
    )
    await store.review(target, account, 42, inspected.headSHA, {
      event: 'APPROVE',
      body: 'Ready',
      comments: [{ path: 'README.md', line: 1, side: 'RIGHT', body: 'Inline' }],
      replies: [{ inReplyToId: 7, body: 'Resolved' }],
    })
    assert.equal(api.reviewCalls, 1)
    assert.deepEqual(api.lastReview?.comments, [
      { path: 'README.md', line: 1, side: 'RIGHT', body: 'Inline' },
    ])
    assert.deepEqual(api.lastReview?.replies, [
      { inReplyToId: 7, body: 'Resolved' },
    ])
    assert.equal(store.getWorkspace(target, account, 42), null)
  })

  it('updates close and reopen state only from the reviewed snapshot', async () => {
    const api = new FakeAPI()
    const store = new PullRequestLifecycleStore(() => api)
    const target = createRepository()
    const account = createAccount()
    const inspected = await store.inspect(target, account, 42)
    let resolveWorkspace!: (value: IGitHubPullRequestWorkspace) => void
    api.workspaceResult = new Promise(resolve => {
      resolveWorkspace = resolve
    })
    const staleWorkspace = store.inspectWorkspace(
      target,
      account,
      42,
      inspected.headSHA
    )
    const closed = await store.setState(
      target,
      account,
      42,
      inspected.headSHA,
      'closed'
    )
    assert.equal(closed.pullRequest.state, 'closed')
    assert.equal(api.stateCalls, 1)
    resolveWorkspace(workspace())
    await assert.rejects(staleWorkspace)
    assert.equal(store.getWorkspace(target, account, 42), null)
    await assert.rejects(() =>
      store.setState(target, account, 42, 'c'.repeat(40), 'open')
    )
    assert.equal(api.stateCalls, 1)
  })
})
