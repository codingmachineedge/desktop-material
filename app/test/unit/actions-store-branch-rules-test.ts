import assert from 'node:assert'
import { describe, it, mock } from 'node:test'
import { API } from '../../src/lib/api'
import { IActionsBranchRuleList } from '../../src/lib/actions-branch-rules'
import {
  actionsBranchRulesError,
  ActionsBranchRulesError,
  ActionsStore,
} from '../../src/lib/stores/actions-store'
import { AccountsStore } from '../../src/lib/stores/accounts-store'
import { APIError } from '../../src/lib/http'
import { Account, getAccountKey } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { Repository } from '../../src/models/repository'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => (resolve = resolvePromise))
  return { promise, resolve }
}

class MutableAccountsStore {
  private callback: ((accounts: ReadonlyArray<Account>) => void) | null = null

  public constructor(private accounts: ReadonlyArray<Account>) {}

  public async getAll() {
    return this.accounts
  }

  public onDidUpdate(callback: (accounts: ReadonlyArray<Account>) => void) {
    this.callback = callback
  }

  public update(accounts: ReadonlyArray<Account>) {
    this.accounts = accounts
    this.callback?.(accounts)
  }
}

function repository(account: Account, id: number): Repository {
  return new Repository(
    'C:/project',
    id,
    new GitHubRepository(
      'project',
      new Owner('example', account.endpoint, 1),
      1
    ),
    false,
    null,
    {},
    false,
    undefined,
    getAccountKey(account)
  )
}

const emptyResult = (branch: string): IActionsBranchRuleList => ({
  branch,
  rules: [],
  capped: false,
})

describe('ActionsStore branch rule account generation', () => {
  it('actively aborts account-bound metadata when the account changes', async () => {
    const endpoint = 'https://api.github.com'
    const first = new Account('first', endpoint, 'one', [], '', 1, 'First')
    const accounts = new MutableAccountsStore([first])
    const requestSignals = new Array<AbortSignal>()
    const fromAccount = mock.method(API, 'fromAccount', () => {
      return {
        fetchArtifactAttestationPresence: async (
          _owner: string,
          _name: string,
          _digest: string,
          signal?: AbortSignal
        ) => {
          if (signal !== undefined) {
            requestSignals.push(signal)
          }
          return await new Promise<boolean>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                const error = new Error('account changed')
                error.name = 'AbortError'
                reject(error)
              },
              { once: true }
            )
          })
        },
      } as unknown as API
    })

    try {
      const store = new ActionsStore(accounts as unknown as AccountsStore)
      await Promise.resolve()
      const pending = store.fetchArtifactAttestationPresence(
        repository(first, 1),
        `sha256:${'a'.repeat(64)}`
      )
      assert.equal(requestSignals.length, 1)

      accounts.update([first.withToken('rotated-token')])
      await assert.rejects(
        pending,
        error => (error as Error).name === 'AbortError'
      )
      assert.equal(requestSignals[0].aborted, true)
    } finally {
      fromAccount.mock.restore()
    }
  })

  it('rejects an old account response and routes the retry to the new account', async () => {
    const endpoint = 'https://api.github.com'
    const first = new Account('first', endpoint, 'one', [], '', 1, 'First')
    const second = new Account('second', endpoint, 'two', [], '', 2, 'Second')
    const pending = deferred<IActionsBranchRuleList>()
    const selected = new Array<Account>()
    const fromAccount = mock.method(API, 'fromAccount', (account: Account) => {
      selected.push(account)
      return {
        fetchEffectiveBranchRules: async (
          _owner: string,
          _name: string,
          branch: string
        ) =>
          account === first
            ? pending.promise
            : Promise.resolve(emptyResult(branch)),
      } as unknown as API
    })
    const accounts = new MutableAccountsStore([first])

    try {
      const store = new ActionsStore(accounts as unknown as AccountsStore)
      await Promise.resolve()
      const stale = store.fetchBranchRules(repository(first, 1), 'main')
      await Promise.resolve()
      accounts.update([second])
      pending.resolve(emptyResult('main'))
      await assert.rejects(
        stale,
        error => (error as Error).name === 'AbortError'
      )

      const current = await store.fetchBranchRules(
        repository(second, 2),
        'release/next'
      )
      assert.equal(current.branch, 'release/next')
      assert.deepEqual(selected, [first, second])
    } finally {
      fromAccount.mock.restore()
    }
  })

  it('maps permission, unsupported, and provider errors to distinct states', () => {
    const permission = actionsBranchRulesError(
      new APIError(new Response('', { status: 403 }), {
        message: 'Resource not accessible',
      })
    ) as ActionsBranchRulesError
    const unsupported = actionsBranchRulesError(
      new APIError(new Response('', { status: 403 }), {
        message: 'Upgrade to enable this feature.',
      })
    ) as ActionsBranchRulesError
    const service = actionsBranchRulesError(
      new APIError(new Response('', { status: 503 }), null)
    ) as ActionsBranchRulesError

    assert.equal(permission.kind, 'permission')
    assert.equal(unsupported.kind, 'unsupported')
    assert.equal(service.kind, 'service')
    assert.equal(permission.message.includes('selected account'), true)
  })
})
