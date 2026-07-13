import assert from 'node:assert'
import { Disposable } from 'event-kit'
import { describe, it } from 'node:test'
import { Account, getAccountKey } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { Repository } from '../../src/models/repository'
import { AccountsStore } from '../../src/lib/stores/accounts-store'
import {
  getGitHubIssuesAvailability,
  GitHubIssuesError,
  GitHubIssuesStore,
  githubIssuesError,
  IGitHubIssuesAPI,
} from '../../src/lib/stores/github-issues-store'
import { IGitHubIssue } from '../../src/lib/github-issues'
import { APIError } from '../../src/lib/http'

const selected = new Account(
  'selected',
  'https://api.github.com',
  'selected-token',
  [],
  '',
  2,
  'Selected'
)
const other = new Account(
  'other',
  'https://api.github.com',
  'other-token',
  [],
  '',
  3,
  'Other'
)
const gitHubRepository = new GitHubRepository(
  'material',
  new Owner('desktop', 'https://api.github.com', 1),
  1,
  false,
  null,
  null,
  true
)
const repository = new Repository(
  'C:\\work\\material',
  1,
  gitHubRepository,
  false,
  null,
  {},
  false,
  undefined,
  getAccountKey(selected)
)

const issue: IGitHubIssue = {
  id: 1007,
  number: 7,
  title: 'Issue 7',
  body: 'A bounded issue body.',
  state: 'open',
  stateReason: null,
  authorLogin: 'fixture-author',
  createdAt: new Date('2026-07-13T10:00:00Z'),
  updatedAt: new Date('2026-07-13T11:00:00Z'),
  closedAt: null,
  url: 'https://github.com/desktop/material/issues/7',
  labels: [],
  assignees: [],
  milestone: null,
  commentCount: 0,
  locked: false,
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

function fakeAPI(overrides: Partial<IGitHubIssuesAPI> = {}): IGitHubIssuesAPI {
  return {
    fetchIssuePage: async (_owner, _name, query) => ({
      issues: [issue],
      page: query.page,
      nextPage: null,
      capped: false,
      incomplete: false,
    }),
    fetchIssue: async () => issue,
    fetchIssueCommentPage: async () => ({
      comments: [],
      page: 1,
      nextPage: null,
      capped: false,
    }),
    fetchIssueMetadata: async () => ({
      labels: [],
      assignees: [],
      milestones: [],
      labelsCapped: false,
      assigneesCapped: false,
      milestonesCapped: false,
      unavailable: [],
    }),
    updateIssue: async () => issue,
    setIssueState: async (_owner, _name, _number, state) => ({
      ...issue,
      state,
    }),
    addIssueComment: async () => ({
      id: 55,
      body: 'Reviewed comment',
      authorLogin: 'fixture-reviewer',
      createdAt: new Date(),
      updatedAt: new Date(),
      url: 'https://github.com/desktop/material/issues/7#issuecomment-55',
    }),
    ...overrides,
  }
}

async function storeWith(
  accountsStore: FakeAccountsStore,
  apiFor: (account: Account) => IGitHubIssuesAPI
) {
  const store = new GitHubIssuesStore(
    accountsStore as unknown as AccountsStore,
    { apiFor }
  )
  await Promise.resolve()
  return store
}

const query = {
  state: 'open' as const,
  search: '',
  labels: [] as ReadonlyArray<string>,
  assignee: null,
  milestone: null,
  sort: 'updated' as const,
  direction: 'desc' as const,
  page: 1,
}

describe('GitHub Issues store', () => {
  it('routes browsing through only the repository-selected account', async () => {
    const accountsStore = new FakeAccountsStore([other, selected])
    const keys = new Array<string>()
    let requested:
      | { owner: string; name: string; signal: AbortSignal | undefined }
      | undefined
    const store = await storeWith(accountsStore, account => {
      keys.push(getAccountKey(account))
      return fakeAPI({
        fetchIssuePage: async (owner, name, request, signal) => {
          requested = { owner, name, signal }
          return {
            issues: [issue],
            page: request.page,
            nextPage: 2,
            capped: false,
            incomplete: false,
          }
        },
      })
    })

    const result = await store.list(repository, query)
    assert.equal(result.nextPage, 2)
    assert.deepEqual(keys, [getAccountKey(selected)])
    assert.equal(requested?.owner, 'desktop')
    assert.equal(requested?.name, 'material')
    assert.ok(requested?.signal instanceof AbortSignal)
  })

  it('passes through neutral metadata availability without inferring access cause', async () => {
    const store = await storeWith(new FakeAccountsStore([selected]), () =>
      fakeAPI({
        fetchIssueMetadata: async () => ({
          labels: [],
          assignees: [],
          milestones: [],
          labelsCapped: false,
          assigneesCapped: false,
          milestonesCapped: false,
          unavailable: ['assignees'],
        }),
      })
    )
    const metadata = await store.metadata(repository)
    assert.deepEqual(metadata.unavailable, ['assignees'])
  })

  it('freezes a repository/account-generation/issue fingerprint review', async () => {
    const store = await storeWith(new FakeAccountsStore([selected]), () =>
      fakeAPI()
    )
    const review = store.createMutationReview(
      repository,
      issue,
      'comment',
      'Reviewed comment'
    )
    assert.equal(Object.isFrozen(review), true)
    assert.match(review.accountFingerprint, /^sha256:[a-f0-9]{64}$/)
    assert.equal(review.issueNumber, 7)
    assert.match(review.repositoryFingerprint, /^sha256:[a-f0-9]{64}$/)
    assert.match(review.issueFingerprint, /^sha256:[a-f0-9]{64}$/)
    assert.match(review.mutationFingerprint, /^sha256:[a-f0-9]{64}$/)
    assert.doesNotMatch(
      JSON.stringify(review),
      /desktop|material|Issue 7|Reviewed comment|github\.com/
    )
  })

  it('re-fetches exact state and fails closed before update when it changed', async () => {
    let updateCalled = false
    const store = await storeWith(new FakeAccountsStore([selected]), () =>
      fakeAPI({
        fetchIssue: async () => ({ ...issue, body: 'Changed remotely' }),
        updateIssue: async () => {
          updateCalled = true
          return issue
        },
      })
    )
    const update = {
      title: issue.title,
      body: 'Reviewed body',
      labels: [] as ReadonlyArray<string>,
      assignees: [] as ReadonlyArray<string>,
      milestone: null,
    }
    const review = store.createMutationReview(
      repository,
      issue,
      'update',
      update
    )
    await assert.rejects(
      () => store.update(repository, review, update),
      error => error instanceof GitHubIssuesError && error.kind === 'conflict'
    )
    assert.equal(updateCalled, false)
  })

  it('revalidates before every mutation and sends the exact reviewed issue', async () => {
    let fetchCount = 0
    let updateNumber = 0
    let commentNumber = 0
    let stateNumber = 0
    const store = await storeWith(new FakeAccountsStore([selected]), () =>
      fakeAPI({
        fetchIssue: async () => {
          fetchCount++
          return issue
        },
        updateIssue: async (_owner, _name, issueNumber) => {
          updateNumber = issueNumber
          return { ...issue, title: 'Updated' }
        },
        addIssueComment: async (_owner, _name, issueNumber) => {
          commentNumber = issueNumber
          return {
            id: 55,
            body: 'Reviewed comment',
            authorLogin: 'fixture-reviewer',
            createdAt: new Date(),
            updatedAt: new Date(),
            url: 'https://github.com/desktop/material/issues/7#issuecomment-55',
          }
        },
        setIssueState: async (_owner, _name, issueNumber) => {
          stateNumber = issueNumber
          return { ...issue, state: 'closed' }
        },
      })
    )
    const update = {
      title: 'Updated',
      body: issue.body,
      labels: [] as ReadonlyArray<string>,
      assignees: [] as ReadonlyArray<string>,
      milestone: null,
    }
    const updateReview = store.createMutationReview(
      repository,
      issue,
      'update',
      update
    )
    const commentReview = store.createMutationReview(
      repository,
      issue,
      'comment',
      'Reviewed comment'
    )
    const stateReview = store.createMutationReview(
      repository,
      issue,
      'close',
      null
    )
    await store.update(repository, updateReview, update)
    await store.addComment(repository, commentReview, 'Reviewed comment')
    await store.setState(repository, stateReview, 'closed')
    assert.equal(fetchCount, 3)
    assert.equal(updateNumber, 7)
    assert.equal(commentNumber, 7)
    assert.equal(stateNumber, 7)
  })

  it('keeps pre-boundary account cancellation abortable without claiming a write', async () => {
    const accountsStore = new FakeAccountsStore([selected])
    let requestSignal: AbortSignal | undefined
    let resolveFetch: ((value: IGitHubIssue) => void) | undefined
    const store = await storeWith(accountsStore, () =>
      fakeAPI({
        fetchIssue: async (_owner, _name, _number, signal) => {
          requestSignal = signal
          return await new Promise(resolve => {
            resolveFetch = resolve
          })
        },
      })
    )
    const review = store.createMutationReview(
      repository,
      issue,
      'comment',
      'Reviewed comment'
    )
    const pending = store.addComment(repository, review, 'Reviewed comment')
    await Promise.resolve()
    accountsStore.update([selected.withToken('rotated-token')])
    assert.equal(requestSignal?.aborted, true)
    resolveFetch?.(issue)
    await assert.rejects(
      pending,
      error => error instanceof Error && error.name === 'AbortError'
    )
  })

  it('reports post-boundary cancellation as uncertain to prevent duplicate comments', async () => {
    const accountsStore = new FakeAccountsStore([selected])
    let mutationStarted: (() => void) | undefined
    let rejectMutation: ((error: Error) => void) | undefined
    const started = new Promise<void>(resolve => {
      mutationStarted = resolve
    })
    const store = await storeWith(accountsStore, () =>
      fakeAPI({
        addIssueComment: async () => {
          mutationStarted?.()
          return await new Promise((_resolve, reject) => {
            rejectMutation = reject
          })
        },
      })
    )
    const review = store.createMutationReview(
      repository,
      issue,
      'comment',
      'Reviewed comment'
    )
    const pending = store.addComment(repository, review, 'Reviewed comment')
    await started
    accountsStore.update([selected.withToken('rotated-token')])
    const canceled = new Error('request canceled')
    canceled.name = 'AbortError'
    rejectMutation?.(canceled)
    await assert.rejects(
      pending,
      error => error instanceof GitHubIssuesError && error.kind === 'uncertain'
    )
  })

  it('keeps definite provider validation rejection distinct from uncertainty', async () => {
    const store = await storeWith(new FakeAccountsStore([selected]), () =>
      fakeAPI({
        updateIssue: async () => {
          throw new APIError(new Response(null, { status: 422 }), null)
        },
      })
    )
    const update = {
      title: issue.title,
      body: issue.body,
      labels: [] as ReadonlyArray<string>,
      assignees: [] as ReadonlyArray<string>,
      milestone: null,
    }
    const review = store.createMutationReview(
      repository,
      issue,
      'update',
      update
    )
    await assert.rejects(
      () => store.update(repository, review, update),
      error => error instanceof GitHubIssuesError && error.kind === 'conflict'
    )
  })

  it('rejects review reuse across operations or changed payloads before re-fetch', async () => {
    let fetchCalled = false
    const store = await storeWith(new FakeAccountsStore([selected]), () =>
      fakeAPI({
        fetchIssue: async () => {
          fetchCalled = true
          return issue
        },
      })
    )
    const review = store.createMutationReview(
      repository,
      issue,
      'comment',
      'First reviewed comment'
    )
    await assert.rejects(
      () => store.addComment(repository, review, 'Different comment'),
      error => error instanceof GitHubIssuesError && error.kind === 'conflict'
    )
    await assert.rejects(
      () => store.setState(repository, review, 'closed'),
      error => error instanceof GitHubIssuesError && error.kind === 'conflict'
    )
    assert.equal(fetchCalled, false)
  })

  it('treats HTTP 408 after the write boundary as uncertain', async () => {
    const update = {
      title: issue.title,
      body: 'Reviewed body',
      labels: [] as ReadonlyArray<string>,
      assignees: [] as ReadonlyArray<string>,
      milestone: null,
    }
    const store = await storeWith(new FakeAccountsStore([selected]), () =>
      fakeAPI({
        updateIssue: async () => {
          throw new APIError(new Response(null, { status: 408 }), null)
        },
      })
    )
    const review = store.createMutationReview(
      repository,
      issue,
      'update',
      update
    )
    await assert.rejects(
      () => store.update(repository, review, update),
      error => error instanceof GitHubIssuesError && error.kind === 'uncertain'
    )
  })

  it('reports signed-out, disabled, and non-GitHub availability safely', () => {
    assert.equal(getGitHubIssuesAvailability(repository, []), 'signed-out')
    const disabled = new Repository(
      'C:\\work\\disabled',
      2,
      new GitHubRepository(
        'disabled',
        new Owner('desktop', 'https://api.github.com', 2),
        2,
        false,
        null,
        null,
        false
      ),
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(selected)
    )
    assert.equal(getGitHubIssuesAvailability(disabled, [selected]), 'disabled')
    const local = new Repository('C:\\work\\local', 3, null, false)
    assert.equal(getGitHubIssuesAvailability(local, [selected]), 'not-github')
  })

  it('normalizes provider error text without exposing response payloads', () => {
    const response = new Response(
      JSON.stringify({ message: 'token=synthetic-secret /private/path' }),
      { status: 403 }
    )
    const error = githubIssuesError(new APIError(response, null), 'update')
    assert.ok(error instanceof GitHubIssuesError)
    assert.equal((error as GitHubIssuesError).kind, 'permission')
    assert.doesNotMatch(error.message, /synthetic-secret|private\/path/)
  })
})
