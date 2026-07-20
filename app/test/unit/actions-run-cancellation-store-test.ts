import assert from 'node:assert'
import { describe, it, mock } from 'node:test'

import { API } from '../../src/lib/api'
import { APIError } from '../../src/lib/http'
import { ActionsStore } from '../../src/lib/stores/actions-store'
import { AccountsStore } from '../../src/lib/stores/accounts-store'
import { Account, getAccountKey } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { Repository } from '../../src/models/repository'
import { IActionsWorkflowRunCancellationState } from '../../src/lib/actions-workflow-runs'

class TestAccountsStore {
  private listener: ((accounts: ReadonlyArray<Account>) => void) | null = null

  public constructor(private accounts: ReadonlyArray<Account>) {}

  public async getAll() {
    return this.accounts
  }

  public onDidUpdate(listener: (accounts: ReadonlyArray<Account>) => void) {
    this.listener = listener
  }

  public update(accounts: ReadonlyArray<Account>) {
    this.accounts = accounts
    this.listener?.(accounts)
  }
}

const endpoint = 'https://api.github.com'

const account = new Account(
  'selected-user',
  endpoint,
  'selected-token',
  [],
  '',
  7,
  'Selected User'
)

const repository = new Repository(
  'C:/actions-cancellation',
  71,
  new GitHubRepository('repository', new Owner('owner', endpoint, 19), 23),
  false,
  null,
  {},
  false,
  undefined,
  getAccountKey(account)
)

const state = (
  status: IActionsWorkflowRunCancellationState['status'],
  conclusion: IActionsWorkflowRunCancellationState['conclusion'] = null
): IActionsWorkflowRunCancellationState => ({
  id: 42,
  status,
  conclusion,
  updatedAt: '2026-07-16T12:30:00Z',
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function createStore(accounts: TestAccountsStore) {
  const store = new ActionsStore(accounts as unknown as AccountsStore)
  await Promise.resolve()
  Reflect.set(store, 'refresh', async () => undefined)
  Reflect.set(store, 'waitForRunCancellationPoll', async () => undefined)
  return store
}

describe('ActionsStore workflow-run cancellation', () => {
  it('deduplicates normal cancellation and polls accepted runs to terminal state', async () => {
    const accounts = new TestAccountsStore([account])
    const store = await createStore(accounts)
    const reads = [
      state('waiting'),
      state('in_progress'),
      state('completed', 'cancelled'),
    ]
    const requests = new Array<string>()
    const selectedAccounts = new Array<Account>()
    const fakeAPI = {
      fetchWorkflowRunCancellationState: async () => {
        requests.push('GET')
        const next = reads.shift()
        assert(next !== undefined)
        return next
      },
      cancelWorkflowRun: async (
        _owner: string,
        _name: string,
        _runId: number,
        force: boolean
      ) => {
        requests.push(`POST:${force}`)
        return true
      },
    }
    const fromAccount = mock.method(API, 'fromAccount', (selected: Account) => {
      selectedAccounts.push(selected)
      return fakeAPI as unknown as API
    })

    try {
      const progress = new Array<string>()
      const first = store.cancelRun(repository, 42, undefined, value =>
        progress.push(value.phase)
      )
      const second = store.cancelRun(repository, 42)
      const [firstResult, secondResult] = await Promise.all([first, second])

      assert.deepEqual(requests, ['GET', 'POST:false', 'GET', 'GET'])
      assert.equal(firstResult, secondResult)
      assert.equal(firstResult.accepted, true)
      assert.equal(firstResult.conclusion, 'cancelled')
      assert.deepEqual(progress, [
        'revalidating',
        'requesting',
        'accepted',
        'waiting',
        'waiting',
        'terminal',
      ])
      assert.deepEqual(selectedAccounts, [account])
    } finally {
      fromAccount.mock.restore()
    }
  })

  it('returns prompt bulk requests after POST while terminal monitoring continues', async () => {
    const accounts = new TestAccountsStore([account])
    const store = await createStore(accounts)
    const terminalState = deferred<IActionsWorkflowRunCancellationState>()
    const monitorStarted = deferred<void>()
    const requests = new Array<string>()
    let reads = 0
    const fakeAPI = {
      fetchWorkflowRunCancellationState: async () => {
        reads++
        requests.push('GET')
        if (reads === 1) {
          return state('in_progress')
        }
        monitorStarted.resolve()
        return terminalState.promise
      },
      cancelWorkflowRun: async () => {
        requests.push('POST:false')
        return true
      },
    }
    const fromAccount = mock.method(
      API,
      'fromAccount',
      () => fakeAPI as unknown as API
    )

    try {
      const result = await store.requestRunCancellation(repository, 42)
      assert.equal(result.accepted, true)
      assert.equal(result.alreadyTerminal, false)
      assert.equal(result.status, 'in_progress')
      await monitorStarted.promise
      assert.deepEqual(requests, ['GET', 'POST:false', 'GET'])

      terminalState.resolve(state('completed', 'cancelled'))
      await Promise.resolve()
      await Promise.resolve()
    } finally {
      fromAccount.mock.restore()
    }
  })

  it('does not POST for a terminal or non-cancellable revalidated state', async () => {
    const accounts = new TestAccountsStore([account])
    const store = await createStore(accounts)
    let current = state('completed', 'success')
    let posts = 0
    const fakeAPI = {
      fetchWorkflowRunCancellationState: async () => current,
      cancelWorkflowRun: async () => {
        posts++
        return true
      },
    }
    const fromAccount = mock.method(
      API,
      'fromAccount',
      () => fakeAPI as unknown as API
    )

    try {
      const terminal = await store.cancelRun(repository, 42)
      assert.equal(terminal.alreadyTerminal, true)
      assert.equal(terminal.conclusion, 'success')
      assert.equal(posts, 0)

      current = state('requested')
      await assert.rejects(
        store.cancelRun(repository, 42),
        /no longer queued, running, waiting, or pending/
      )
      assert.equal(posts, 0)
    } finally {
      fromAccount.mock.restore()
    }
  })

  it('aborts before POST when the selected account generation changes', async () => {
    const accounts = new TestAccountsStore([account])
    const store = await createStore(accounts)
    const revalidation = deferred<IActionsWorkflowRunCancellationState>()
    const revalidationStarted = deferred<void>()
    let posts = 0
    const fakeAPI = {
      fetchWorkflowRunCancellationState: async () => {
        revalidationStarted.resolve()
        return revalidation.promise
      },
      cancelWorkflowRun: async () => {
        posts++
        return true
      },
    }
    const fromAccount = mock.method(
      API,
      'fromAccount',
      () => fakeAPI as unknown as API
    )

    try {
      const request = store.cancelRun(repository, 42)
      await revalidationStarted.promise
      accounts.update([account.withToken('replacement-token')])
      revalidation.resolve(state('pending'))

      await assert.rejects(
        request,
        error => (error as Error).name === 'AbortError'
      )
      assert.equal(posts, 0)
    } finally {
      fromAccount.mock.restore()
    }
  })

  it('treats a terminal 409 race idempotently and guides an active conflict', async () => {
    const accounts = new TestAccountsStore([account])
    const store = await createStore(accounts)
    const reads = [state('in_progress'), state('completed', 'success')]
    let conflictStatus = 409
    const fakeAPI = {
      fetchWorkflowRunCancellationState: async () => {
        const next = reads.shift()
        assert(next !== undefined)
        return next
      },
      cancelWorkflowRun: async () => {
        throw new APIError(new Response(null, { status: conflictStatus }), null)
      },
    }
    const fromAccount = mock.method(
      API,
      'fromAccount',
      () => fakeAPI as unknown as API
    )

    try {
      const raced = await store.cancelRun(repository, 42)
      assert.equal(raced.alreadyTerminal, true)
      assert.equal(raced.conclusion, 'success')

      reads.push(state('pending'), state('pending'))
      conflictStatus = 422
      await assert.rejects(
        store.cancelRun(repository, 42),
        /changed state.*Refresh Actions/
      )
    } finally {
      fromAccount.mock.restore()
    }
  })
})
