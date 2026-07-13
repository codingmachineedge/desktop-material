import { describe, it } from 'node:test'
import assert from 'node:assert'
import { IAPIWorkflow, IAPIWorkflowRun } from '../../src/lib/api'
import {
  ActionsStore,
  IActionsState,
  accountSupportsActions,
  actionsArtifactError,
  actionsInspectorError,
  actionsMutationError,
  getActionsAccount,
  getActionsRepositoryKey,
  mergeRefreshedWorkflowRuns,
  mergeWorkflowRunPage,
  workflowRunsEqual,
} from '../../src/lib/stores/actions-store'
import { Account, getAccountKey } from '../../src/models/account'
import { Owner } from '../../src/models/owner'
import { GitHubRepository } from '../../src/models/github-repository'
import { APIError } from '../../src/lib/http'
import { Repository } from '../../src/models/repository'
import { AccountsStore } from '../../src/lib/stores/accounts-store'

const run = (id: number, updatedAt: string) =>
  ({ id, updated_at: updatedAt } as IAPIWorkflowRun)

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

const actionsRepository = (accountKey: string | null, path = 'C:/project') => {
  const endpoint = 'https://api.github.com'
  return new Repository(
    path,
    path === 'C:/project' ? 1 : 2,
    new GitHubRepository('project', new Owner('group', endpoint, 1), 1),
    false,
    null,
    {},
    false,
    undefined,
    accountKey
  )
}

const cachedActionsState = (): IActionsState => ({
  workflows: [{ id: 3, name: 'Old workflow' } as IAPIWorkflow],
  runs: [run(7, 'old-account')],
  runsTotalCount: 1,
  runsNextPage: null,
  runsLoadingMore: false,
  loading: false,
  error: null,
  rateLimitReset: null,
  lastUpdated: new Date(),
  supported: true,
})

describe('ActionsStore helpers', () => {
  it('treats run pages with the same ids and update times as equal', () => {
    assert.equal(workflowRunsEqual([run(1, 'a')], [run(1, 'a')]), true)
  })

  it('detects updated and reordered workflow runs', () => {
    assert.equal(workflowRunsEqual([run(1, 'a')], [run(1, 'b')]), false)
    assert.equal(
      workflowRunsEqual([run(1, 'a'), run(2, 'b')], [run(2, 'b'), run(1, 'a')]),
      false
    )
  })

  it('deduplicates later pages and keeps refreshed page one first', () => {
    assert.deepEqual(
      mergeWorkflowRunPage(
        [run(1, 'old'), run(2, 'old')],
        [run(2, 'new'), run(3, 'new')]
      ),
      [run(1, 'old'), run(2, 'new'), run(3, 'new')]
    )
    assert.deepEqual(
      mergeRefreshedWorkflowRuns(
        [run(4, 'fresh'), run(1, 'fresh')],
        [run(1, 'old'), run(2, 'old'), run(3, 'old')],
        4
      ),
      [run(4, 'fresh'), run(1, 'fresh'), run(2, 'old'), run(3, 'old')]
    )
  })

  it('does not route provider repositories into GitHub Actions', () => {
    const endpoint = 'https://gitlab.example.com/api/v4'
    const gitHubRepository = new GitHubRepository(
      'project',
      new Owner('group', endpoint, 1),
      1
    )
    const repository = new Repository('C:/project', 1, gitHubRepository, false)
    const account = new Account(
      'fox',
      endpoint,
      'token',
      [],
      '',
      1,
      'Fox',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'gitlab'
    )

    assert.equal(accountSupportsActions(repository, [account]), false)
  })

  it('binds state and API identity to the selected same-endpoint account', () => {
    const endpoint = 'https://api.github.com'
    const gitHubRepository = new GitHubRepository(
      'project',
      new Owner('group', endpoint, 1),
      1
    )
    const first = new Account('first', endpoint, 'one', [], '', 1, 'First')
    const second = new Account('second', endpoint, 'two', [], '', 2, 'Second')
    const firstRepository = new Repository(
      'C:/project',
      1,
      gitHubRepository,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(first)
    )
    const secondRepository = new Repository(
      'C:/project',
      1,
      gitHubRepository,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(second)
    )

    assert.equal(getActionsAccount(secondRepository, [first, second]), second)
    assert.notEqual(
      getActionsRepositoryKey(firstRepository),
      getActionsRepositoryKey(secondRepository)
    )
    assert.equal(
      getActionsAccount(secondRepository, [first]),
      null,
      'a missing selected account must not fall back to another account on the endpoint'
    )
  })

  it('clears selected-account caches and discards stale prior-account refreshes', async () => {
    const endpoint = 'https://api.github.com'
    const first = new Account('first', endpoint, 'one', [], '', 1, 'First')
    const second = new Account('second', endpoint, 'two', [], '', 2, 'Second')
    const repository = actionsRepository(getAccountKey(second))
    const accounts = new TestAccountsStore([first, second])
    const store = new ActionsStore(accounts as unknown as AccountsStore)
    await Promise.resolve()

    let refreshes = 0
    Reflect.set(store, 'refresh', async () => {
      refreshes++
    })
    const states = new Array<IActionsState>()
    const subscription = store.subscribe(repository, state =>
      states.push(state)
    )
    const notify = Reflect.get(store, 'notify') as (
      repository: Repository,
      state: IActionsState
    ) => void
    notify.call(store, repository, cachedActionsState())

    const changedSecond = new Account(
      'second',
      endpoint,
      'two-refreshed',
      [],
      '',
      2,
      'Second'
    )
    accounts.update([first, changedSecond])
    assert.equal(refreshes, 2, 'token changes force an exact-account refresh')
    assert.deepEqual(states.at(-1)?.workflows, [])
    assert.deepEqual(states.at(-1)?.runs, [])
    assert.equal(states.at(-1)?.supported, true)

    Reflect.deleteProperty(store, 'refresh')
    let resolveWorkflows!: (value: {
      workflows: ReadonlyArray<IAPIWorkflow>
    }) => void
    let resolveRuns!: (value: {
      workflow_runs: ReadonlyArray<IAPIWorkflowRun>
    }) => void
    const workflows = new Promise<{ workflows: ReadonlyArray<IAPIWorkflow> }>(
      resolve => {
        resolveWorkflows = resolve
      }
    )
    const runs = new Promise<{
      workflow_runs: ReadonlyArray<IAPIWorkflowRun>
    }>(resolve => {
      resolveRuns = resolve
    })
    Reflect.set(store, 'apiFor', () => ({
      fetchWorkflows: () => workflows,
      fetchWorkflowRuns: () => runs,
    }))

    const staleRefresh = store.refresh(repository, true)
    accounts.update([first])
    assert.equal(states.at(-1)?.supported, false)
    assert.deepEqual(states.at(-1)?.runs, [])
    resolveWorkflows({
      workflows: [{ id: 3, name: 'Stale workflow' } as IAPIWorkflow],
    })
    resolveRuns({ workflow_runs: [run(7, 'stale-prior-account')] })
    await staleRefresh
    assert.equal(states.at(-1)?.supported, false)
    assert.deepEqual(states.at(-1)?.workflows, [])
    assert.deepEqual(states.at(-1)?.runs, [])

    subscription.dispose()
  })

  it('invalidates legacy endpoint cache when same-endpoint account order changes', async () => {
    const endpoint = 'https://api.github.com'
    const first = new Account('first', endpoint, 'one', [], '', 1, 'First')
    const second = new Account('second', endpoint, 'two', [], '', 2, 'Second')
    const repository = actionsRepository(null, 'C:/legacy-project')
    const accounts = new TestAccountsStore([first, second])
    const store = new ActionsStore(accounts as unknown as AccountsStore)
    await Promise.resolve()

    let refreshes = 0
    Reflect.set(store, 'refresh', async () => {
      refreshes++
    })
    const states = new Array<IActionsState>()
    const subscription = store.subscribe(repository, state =>
      states.push(state)
    )
    const notify = Reflect.get(store, 'notify') as (
      repository: Repository,
      state: IActionsState
    ) => void
    notify.call(store, repository, cachedActionsState())

    accounts.update([second, first])
    assert.equal(refreshes, 2)
    assert.equal(getActionsAccount(repository, [second, first]), second)
    assert.deepEqual(states.at(-1)?.workflows, [])
    assert.deepEqual(states.at(-1)?.runs, [])

    subscription.dispose()
  })

  it('loads, deduplicates, and completes bounded workflow run pages', async () => {
    const endpoint = 'https://api.github.com'
    const account = new Account(
      'selected',
      endpoint,
      'token',
      [],
      '',
      1,
      'Selected'
    )
    const repository = actionsRepository(getAccountKey(account))
    const accounts = new TestAccountsStore([account])
    const store = new ActionsStore(accounts as unknown as AccountsStore)
    await new Promise(resolve => setTimeout(resolve, 0))

    Reflect.set(store, 'refresh', async () => {})
    await store.setRunFilter(repository, { status: 'success' })
    const states = new Array<IActionsState>()
    const subscription = store.subscribe(repository, state =>
      states.push(state)
    )
    const notify = Reflect.get(store, 'notify') as (
      repository: Repository,
      state: IActionsState
    ) => void
    notify.call(store, repository, {
      ...cachedActionsState(),
      runs: [run(1, 'first-page')],
      runsTotalCount: 3,
      runsNextPage: 2,
    })

    const filters = new Array<{
      readonly page: number
      readonly perPage: number
      readonly status?: string
    }>()
    Reflect.set(store, 'apiFor', () => ({
      fetchWorkflowRuns: (
        _owner: string,
        _name: string,
        filter: { page: number; perPage: number; status?: string }
      ) => {
        filters.push(filter)
        return Promise.resolve(
          filter.page === 2
            ? {
                total_count: 3,
                workflow_runs: [run(1, 'updated'), run(2, 'second-page')],
              }
            : {
                total_count: 3,
                workflow_runs: [run(3, 'third-page')],
              }
        )
      },
    }))

    await store.loadMoreRuns(repository)
    assert.deepEqual(filters, [{ page: 2, perPage: 50, status: 'success' }])
    assert.deepEqual(
      states.at(-1)?.runs.map(value => [value.id, value.updated_at]),
      [
        [1, 'updated'],
        [2, 'second-page'],
      ]
    )
    assert.equal(states.at(-1)?.runsNextPage, 3)

    await store.loadMoreRuns(repository)
    assert.deepEqual(filters, [
      { page: 2, perPage: 50, status: 'success' },
      { page: 3, perPage: 50, status: 'success' },
    ])
    assert.deepEqual(
      states.at(-1)?.runs.map(value => value.id),
      [1, 2, 3]
    )
    assert.equal(states.at(-1)?.runsNextPage, null)
    assert.equal(states.at(-1)?.runsLoadingMore, false)

    subscription.dispose()
  })

  it('cancels an in-flight run page when its last repository view leaves', async () => {
    const endpoint = 'https://api.github.com'
    const account = new Account(
      'selected',
      endpoint,
      'token',
      [],
      '',
      1,
      'Selected'
    )
    const repository = actionsRepository(getAccountKey(account))
    const accounts = new TestAccountsStore([account])
    const store = new ActionsStore(accounts as unknown as AccountsStore)
    await new Promise(resolve => setTimeout(resolve, 0))
    Reflect.set(store, 'refresh', async () => {})

    const subscription = store.subscribe(repository, () => {})
    const notify = Reflect.get(store, 'notify') as (
      repository: Repository,
      state: IActionsState
    ) => void
    notify.call(store, repository, {
      ...cachedActionsState(),
      runsTotalCount: 2,
      runsNextPage: 2,
    })

    let pageSignal: AbortSignal | undefined
    Reflect.set(store, 'apiFor', () => ({
      fetchWorkflowRuns: (
        _owner: string,
        _name: string,
        _filter: unknown,
        signal?: AbortSignal
      ) => {
        pageSignal = signal
        return new Promise((_resolve, reject) =>
          signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('canceled')
              error.name = 'AbortError'
              reject(error)
            },
            { once: true }
          )
        )
      },
    }))

    const pending = store.loadMoreRuns(repository)
    assert.equal(pageSignal?.aborted, false)
    subscription.dispose()
    await pending
    assert.equal(pageSignal?.aborted, true)
  })

  it('explains permission and Enterprise capability failures', () => {
    const denied = actionsMutationError(
      new APIError(new Response(null, { status: 403 }), {
        message: 'Forbidden',
      }),
      'disable-workflow'
    )
    assert.match(denied.message, /Actions write access/)

    const unavailable = actionsMutationError(
      new APIError(new Response(null, { status: 404 }), {
        message: 'Not Found',
      }),
      'enable-workflow'
    )
    assert.match(unavailable.message, /GitHub Enterprise version/)
  })

  it('preserves non-API operation errors', () => {
    const original = new Error('network unavailable')
    assert.equal(actionsMutationError(original, 'cancel-run'), original)
  })

  it('explains run-inspector account, permission, support, and service failures', () => {
    const unauthorized = actionsInspectorError(
      new APIError(new Response(null, { status: 401 }), null),
      'load-jobs'
    )
    assert.match(unauthorized.message, /Sign in again/)

    const denied = actionsInspectorError(
      new APIError(new Response(null, { status: 403 }), null),
      'load-pending-deployments'
    )
    assert.match(denied.message, /Actions and deployment access/)

    const unavailable = actionsInspectorError(
      new APIError(new Response(null, { status: 404 }), null),
      'load-review-history'
    )
    assert.match(unavailable.message, /Enterprise version/)

    const sensitive = 'secret-inspector-token='.padEnd(20_000, 'x')
    const serviceFailure = actionsInspectorError(
      new APIError(new Response(null, { status: 503 }), {
        message: sensitive,
      }),
      'load-jobs'
    )
    assert.match(serviceFailure.message, /service returned an error \(503\)/)
    assert.equal(
      serviceFailure.message.includes('secret-inspector-token'),
      false
    )
    assert.ok(serviceFailure.message.length < 220)

    const canceled = new Error('canceled')
    canceled.name = 'AbortError'
    assert.equal(actionsInspectorError(canceled, 'load-jobs'), canceled)
  })

  it('explains deployment and fork-run mutation failures', () => {
    const signedOut = actionsMutationError(
      new APIError(new Response(null, { status: 401 }), null),
      'review-deployments'
    )
    assert.match(signedOut.message, /Sign in again/)

    const reviewDenied = actionsMutationError(
      new APIError(new Response(null, { status: 403 }), null),
      'review-deployments'
    )
    assert.match(reviewDenied.message, /review these pending deployments/)
    assert.match(reviewDenied.message, /Deployments write access/)

    const forkConflict = actionsMutationError(
      new APIError(new Response(null, { status: 409 }), null),
      'approve-fork-run'
    )
    assert.match(forkConflict.message, /approve this fork workflow run/)
    assert.match(forkConflict.message, /current state/)

    const sensitive = 'secret-mutation-token='.padEnd(20_000, 'x')
    const serviceFailure = actionsMutationError(
      new APIError(new Response(null, { status: 502 }), {
        message: sensitive,
      }),
      'approve-fork-run'
    )
    assert.match(serviceFailure.message, /service returned an error \(502\)/)
    assert.equal(
      serviceFailure.message.includes('secret-mutation-token'),
      false
    )
  })

  it('explains artifact account, permission, expiration, and capability failures', () => {
    const unauthorized = actionsArtifactError(
      new APIError(new Response(null, { status: 401 }), null),
      'list'
    )
    assert.match(unauthorized.message, /Sign in again/)

    const denied = actionsArtifactError(
      new APIError(new Response(null, { status: 403 }), null),
      'download'
    )
    assert.match(denied.message, /Actions read access/)

    const expired = actionsArtifactError(
      new APIError(new Response(null, { status: 410 }), null),
      'download'
    )
    assert.match(expired.message, /expired/)

    const unavailable = actionsArtifactError(
      new APIError(new Response(null, { status: 404 }), null),
      'attestations'
    )
    assert.match(unavailable.message, /Enterprise version/)
  })

  it('preserves cancellation for artifact operations', () => {
    const canceled = new Error('canceled')
    canceled.name = 'AbortError'
    assert.equal(actionsArtifactError(canceled, 'download'), canceled)
  })

  it('redacts unexpected provider error bodies from artifact UI copy', () => {
    const sensitive = 'secret-token='.padEnd(20_000, 'x')
    const failure = actionsArtifactError(
      new APIError(new Response(null, { status: 502 }), { message: sensitive }),
      'list'
    )

    assert.match(failure.message, /service returned an error \(502\)/)
    assert.equal(failure.message.includes('secret-token'), false)
    assert.ok(failure.message.length < 200)
  })
})
