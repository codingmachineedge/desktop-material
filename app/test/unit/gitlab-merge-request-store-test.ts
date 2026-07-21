import assert from 'node:assert'
import { Disposable } from 'event-kit'
import { describe, it } from 'node:test'
import { Account, getAccountKey } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { Repository } from '../../src/models/repository'
import {
  GitLabMergeRequestContextChangedError,
  IGitLabMergeRequest,
} from '../../src/lib/gitlab-merge-request'
import { AccountsStore } from '../../src/lib/stores/accounts-store'
import {
  getGitLabMergeRequestAvailability,
  GitLabMergeRequestStore,
  IGitLabMergeRequestAPI,
  IGitLabMergeRequestStoreDependencies,
} from '../../src/lib/stores/gitlab-merge-request-store'

const endpoint = 'https://gitlab.example.test/subpath/api/v4'
const headSHA = 'a'.repeat(40)

function account(
  id: number,
  token: string,
  provider: Account['provider'] = 'gitlab'
) {
  return new Account(
    `user-${id}`,
    endpoint,
    token,
    [],
    '',
    id,
    `User ${id}`,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    provider
  )
}

const first = account(1, 'first-token')
const selected = account(2, 'selected-token')

function repository(
  selectedAccount: Account = selected,
  name = 'material',
  owner = 'group/subgroup',
  remoteEndpoint = endpoint
) {
  const remote = new GitHubRepository(
    name,
    new Owner(owner, remoteEndpoint, 42),
    42
  )
  return new Repository(
    `C:\\work\\${name}`,
    42,
    remote,
    false,
    null,
    {},
    false,
    undefined,
    getAccountKey(selectedAccount)
  )
}

const mergeRequest: IGitLabMergeRequest = {
  id: 1007,
  iid: 7,
  projectId: 42,
  title: 'Lifecycle',
  description: 'Body',
  state: 'opened',
  draft: false,
  sourceBranch: 'topic',
  targetBranch: 'main',
  sourceProjectId: 42,
  targetProjectId: 42,
  headSHA,
  author: {
    id: 1,
    username: 'author',
    name: 'Author',
    avatarUrl: null,
    webUrl: 'https://gitlab.example.test/subpath/author',
  },
  assignees: [],
  reviewers: [],
  webUrl:
    'https://gitlab.example.test/subpath/group/subgroup/material/-/merge_requests/7',
  createdAt: '2026-07-19T10:00:00Z',
  updatedAt: '2026-07-20T10:00:00Z',
  mergedAt: null,
  closedAt: null,
  mergeWhenPipelineSucceeds: false,
  readiness: {
    kind: 'ready',
    status: 'mergeable',
    hasConflicts: false,
    blockingDiscussionsResolved: true,
  },
  approval: {
    approved: false,
    approvalsRequired: 1,
    approvalsLeft: 1,
    approvedBy: [],
  },
}

class FakeAccountsStore {
  private readonly callbacks = new Set<
    (accounts: ReadonlyArray<Account>) => void
  >()

  public constructor(private accounts: ReadonlyArray<Account>) {}

  public async getAll() {
    return this.accounts
  }

  public onDidUpdate(callback: (accounts: ReadonlyArray<Account>) => void) {
    this.callbacks.add(callback)
    return new Disposable(() => this.callbacks.delete(callback))
  }

  public update(accounts: ReadonlyArray<Account>) {
    this.accounts = accounts
    for (const callback of this.callbacks) {
      callback(accounts)
    }
  }
}

function fakeAPI(
  overrides: Partial<IGitLabMergeRequestAPI> = {}
): IGitLabMergeRequestAPI {
  return {
    listGitLabMergeRequests: async () => ({
      items: [mergeRequest],
      capped: false,
    }),
    getGitLabMergeRequest: async () => mergeRequest,
    createGitLabMergeRequest: async () => mergeRequest,
    updateGitLabMergeRequest: async () => mergeRequest,
    setGitLabMergeRequestState: async () => mergeRequest,
    listGitLabProjectMembers: async () => ({ items: [], capped: false }),
    approveGitLabMergeRequest: async () => mergeRequest.approval!,
    unapproveGitLabMergeRequest: async () => ({
      approved: false,
      approvalsRequired: 1,
      approvalsLeft: 1,
      approvedBy: [],
    }),
    ...overrides,
  }
}

async function storeWith(
  accountsStore: FakeAccountsStore,
  apiFor: IGitLabMergeRequestStoreDependencies['apiFor']
) {
  const store = new GitLabMergeRequestStore(
    accountsStore as unknown as AccountsStore,
    { apiFor }
  )
  await Promise.resolve()
  return store
}

describe('GitLab merge request store', () => {
  it('routes through the exact repository accountKey on a shared endpoint', async () => {
    const accountsStore = new FakeAccountsStore([first, selected])
    const selectedAccounts = new Array<Account>()
    let requested:
      | {
          readonly project: string
          readonly signal: AbortSignal | undefined
        }
      | undefined
    const store = await storeWith(accountsStore, selectedAccount => {
      selectedAccounts.push(selectedAccount)
      return fakeAPI({
        listGitLabMergeRequests: async (project, _query, signal) => {
          requested = { project, signal }
          return { items: [mergeRequest], capped: false }
        },
      })
    })
    const controller = new AbortController()
    const result = await store.list(repository(), {}, controller.signal)
    accountsStore.update([selected, first])
    await store.list(repository())

    assert.equal(result.items[0].iid, 7)
    assert.deepEqual(
      selectedAccounts.map(x => [x.id, x.token]),
      [
        [selected.id, 'selected-token'],
        [selected.id, 'selected-token'],
      ]
    )
    assert.equal(requested?.project, 'group/subgroup/material')
    assert.ok(requested?.signal instanceof AbortSignal)
    assert.notEqual(requested?.signal, controller.signal)
    assert.equal(store.availability(repository()), 'available')
  })

  it('does not let delayed hydration overwrite a newer account update', async () => {
    let resolveHydration!: (accounts: ReadonlyArray<Account>) => void
    let onUpdate!: (accounts: ReadonlyArray<Account>) => void
    const delayedAccountsStore = {
      getAll: () =>
        new Promise<ReadonlyArray<Account>>(resolve => {
          resolveHydration = resolve
        }),
      onDidUpdate: (callback: (accounts: ReadonlyArray<Account>) => void) => {
        onUpdate = callback
        return new Disposable(() => undefined)
      },
    }
    const selectedAccounts = new Array<Account>()
    const store = new GitLabMergeRequestStore(
      delayedAccountsStore as unknown as AccountsStore,
      {
        apiFor: selectedAccount => {
          selectedAccounts.push(selectedAccount)
          return fakeAPI()
        },
      }
    )

    onUpdate([selected])
    resolveHydration([first])
    await Promise.resolve()
    await store.list(repository())

    assert.equal(store.availability(repository()), 'available')
    assert.deepEqual(
      selectedAccounts.map(x => [x.id, x.token]),
      [[selected.id, 'selected-token']]
    )
  })

  it('does not fall back across bound provider, token, or endpoint mismatches', () => {
    const repo = repository()
    assert.equal(getGitLabMergeRequestAvailability(repo, [first]), 'signed-out')
    assert.equal(
      getGitLabMergeRequestAvailability(repo, [account(2, '', 'gitlab')]),
      'signed-out'
    )
    assert.equal(
      getGitLabMergeRequestAvailability(repo, [account(2, 'token', 'github')]),
      'not-gitlab'
    )
    const mismatched = new Account(
      'user-2',
      'https://other-gitlab.example.test/api/v4',
      'token',
      [],
      '',
      2,
      'User 2',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'gitlab'
    )
    assert.equal(
      getGitLabMergeRequestAvailability(repository(mismatched), [mismatched]),
      'endpoint-mismatch'
    )
  })

  it('aborts and rejects a superseded repository response', async () => {
    const accountsStore = new FakeAccountsStore([selected])
    let finishFirst:
      | ((value: { items: IGitLabMergeRequest[]; capped: false }) => void)
      | undefined
    let firstSignal: AbortSignal | undefined
    const store = await storeWith(accountsStore, () =>
      fakeAPI({
        listGitLabMergeRequests: async (project, _query, signal) => {
          if (project.endsWith('/first')) {
            firstSignal = signal
            return new Promise(resolve => {
              finishFirst = resolve
            })
          }
          return { items: [mergeRequest], capped: false }
        },
      })
    )

    const stale = store.list(repository(selected, 'first'))
    const current = store.list(repository(selected, 'second'))
    assert.equal((await current).items[0].iid, 7)
    assert.equal(firstSignal?.aborted, true)
    finishFirst?.({ items: [mergeRequest], capped: false })
    await assert.rejects(
      stale,
      (error: unknown) =>
        (error as Error)?.name === 'AbortError' ||
        error instanceof GitLabMergeRequestContextChangedError
    )
  })

  it('carries the reviewed account, project, IID, and HEAD into mutations', async () => {
    const accountsStore = new FakeAccountsStore([selected])
    const calls = new Array<ReadonlyArray<unknown>>()
    const store = await storeWith(accountsStore, () =>
      fakeAPI({
        updateGitLabMergeRequest: async (...args) => {
          calls.push(args)
          return mergeRequest
        },
        setGitLabMergeRequestState: async (...args) => {
          calls.push(args)
          return { ...mergeRequest, state: 'closed' }
        },
        approveGitLabMergeRequest: async (...args) => {
          calls.push(args)
          return mergeRequest.approval!
        },
        unapproveGitLabMergeRequest: async (...args) => {
          calls.push(args)
          return mergeRequest.approval!
        },
      })
    )
    const repo = repository()
    const reviewedMergeRequest = await store.get(repo, 7)
    const review = store.createMutationReview(repo, reviewedMergeRequest)

    const updated = await store.update(repo, review, { title: 'Updated' })
    const stateChanged = await store.setState(repo, review, 'close')
    await store.approve(repo, review)
    await store.unapprove(repo, review)

    for (const call of calls) {
      assert.equal(call[0], 'group/subgroup/material')
      assert.equal(call[1], 7)
      assert.equal(call[2], headSHA)
      assert.ok(call.at(-1) instanceof AbortSignal)
    }
    assert.equal(calls[0][3], mergeRequest.updatedAt)
    assert.equal(calls[1][3], mergeRequest.updatedAt)
    assert.doesNotThrow(() => store.createMutationReview(repo, updated))
    assert.doesNotThrow(() => store.createMutationReview(repo, stateChanged))

    accountsStore.update([selected.withToken('rotated-token')])
    await assert.rejects(
      store.update(repo, review, { title: 'Stale' }),
      GitLabMergeRequestContextChangedError
    )
    assert.equal(calls.length, 4)
  })

  it('rejects arbitrary and cross-repository snapshots with colliding IDs and HEADs', async () => {
    const accountsStore = new FakeAccountsStore([selected])
    const snapshot = { ...mergeRequest }
    const store = await storeWith(accountsStore, () =>
      fakeAPI({
        listGitLabMergeRequests: async () => ({
          items: [snapshot],
          capped: false,
        }),
      })
    )
    const firstRepository = repository(selected, 'first')
    const collidingRepository = repository(selected, 'second')
    const issued = (await store.list(firstRepository)).items[0]
    const issuedReview = store.createMutationReview(firstRepository, issued)

    assert.throws(
      () => store.createMutationReview(collidingRepository, issued),
      GitLabMergeRequestContextChangedError
    )
    assert.throws(
      () =>
        store.createMutationReview(firstRepository, {
          ...issued,
          projectId: issued.projectId,
          iid: issued.iid,
          headSHA: issued.headSHA,
        }),
      GitLabMergeRequestContextChangedError
    )
    Object.assign(issued, { iid: 8 })
    assert.throws(
      () => store.createMutationReview(firstRepository, issued),
      GitLabMergeRequestContextChangedError
    )
    await assert.rejects(
      store.approve(firstRepository, { ...issuedReview }),
      GitLabMergeRequestContextChangedError
    )
  })
})
