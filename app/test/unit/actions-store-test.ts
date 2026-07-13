import { describe, it } from 'node:test'
import assert from 'node:assert'
import { IAPIWorkflow, IAPIWorkflowRun } from '../../src/lib/api'
import {
  ActionsStore,
  IActionsState,
  accountSupportsActions,
  actionsArtifactError,
  actionsMutationError,
  getActionsAccount,
  getActionsRepositoryKey,
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
