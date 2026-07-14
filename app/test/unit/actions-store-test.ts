import { describe, it } from 'node:test'
import assert from 'node:assert'
import { IAPIWorkflow, IAPIWorkflowRun } from '../../src/lib/api'
import {
  ActionsStore,
  IActionsState,
  accountSupportsActions,
  actionsMutationError,
  workflowRunsEqual,
} from '../../src/lib/stores/actions-store'
import { Account, getAccountKey } from '../../src/models/account'
import { Owner } from '../../src/models/owner'
import { GitHubRepository } from '../../src/models/github-repository'
import { APIError } from '../../src/lib/http'

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
})
