import assert from 'node:assert'
import { describe, it } from 'node:test'
import { Account, getAccountKey } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { Repository } from '../../src/models/repository'
import {
  IProviderTriageAPI,
  ProviderTriageStore,
} from '../../src/lib/stores/provider-triage-store'
import {
  IAPIProviderTriageItem,
  IAPIProviderTriagePage,
} from '../../src/lib/provider-triage'
import { APIError } from '../../src/lib/http'
import { RepositoriesStore } from '../../src/lib/stores/repositories-store'
import { TestRepositoriesDatabase } from '../helpers/databases'
import { IAPIFullRepository } from '../../src/lib/api'

const endpoint = 'https://gitlab.example/api/v4'
const selected = new Account(
  'selected',
  endpoint,
  'selected-secret-token',
  [],
  '',
  1,
  'Selected',
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  'gitlab'
)
const other = new Account(
  'other',
  endpoint,
  'other-secret-token',
  [],
  '',
  2,
  'Other',
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  'gitlab'
)

const apiItem: IAPIProviderTriageItem = {
  number: 12,
  title: 'Provider-safe work item',
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-12T00:00:00Z',
  authorLogin: 'selected',
  assigneeLogins: ['selected'],
  reviewRequestedLogins: ['selected'],
  draft: false,
}
const readyPage: IAPIProviderTriagePage = {
  supported: true,
  capped: false,
  items: [apiItem],
}
const unsupportedPage: IAPIProviderTriagePage = {
  supported: false,
  capped: false,
  items: [],
}

function repository(
  id: number,
  name: string,
  accountKey: string | null = getAccountKey(selected)
) {
  const remote = new GitHubRepository(
    name,
    new Owner('group', endpoint, 10),
    id,
    true,
    `https://gitlab.example/group/${name}`,
    `https://credential-value@gitlab.example/group/${name}.git`
  )
  return new Repository(
    `C:\\private-user\\${name}`,
    id,
    remote,
    false,
    null,
    {},
    false,
    undefined,
    accountKey
  )
}

function dependencies(apiFor: (account: Account) => IProviderTriageAPI) {
  return {
    apiFor,
    htmlURLForEndpoint: () => 'https://gitlab.example',
    now: () => new Date('2026-07-13T00:00:00Z'),
  }
}

function api(overrides: Partial<IProviderTriageAPI> = {}): IProviderTriageAPI {
  return {
    fetchProviderTriageIssues: async () => readyPage,
    fetchProviderTriagePullRequests: async () => readyPage,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function nextRepositoryUpdate(
  store: RepositoriesStore,
  predicate: (repository: Repository) => boolean
): Promise<Repository> {
  return new Promise(resolve => {
    let dispose = () => {}
    const subscription = store.onDidUpdate(repositories => {
      const updated = repositories.find(predicate)
      if (updated !== undefined) {
        dispose()
        resolve(updated)
      }
    })
    dispose = () => subscription.dispose()
  })
}

function apiError(status: number, message: string): APIError {
  return new APIError(new Response(null, { status }), { message })
}

describe('provider triage store', () => {
  it('routes through only the exact repository-bound account', async () => {
    const routed = new Array<Account>()
    const store = new ProviderTriageStore(
      dependencies(account => {
        routed.push(account)
        return api()
      })
    )
    await store.load(repository(1, 'material'), [other, selected])
    assert.deepEqual(routed, [selected])
    assert.equal(store.getState().status, 'ready')
    assert.equal(store.getState().accountKey, getAccountKey(selected))
    assert.equal(store.getState().items.length, 2)
  })

  it('requires an exact selection when multiple users share a legacy endpoint', async () => {
    let calls = 0
    const store = new ProviderTriageStore(
      dependencies(() => {
        calls++
        return api()
      })
    )
    await store.load(repository(1, 'material', null), [other, selected])
    assert.equal(calls, 0)
    assert.equal(store.getState().status, 'unavailable')
    assert.match(
      store.getState().message ?? '',
      /You're signed in.*isn't assigned.*Choose an exact account/
    )
    assert.equal(store.getState().accountStatus, 'selection-required')
    assert.deepEqual(
      store.getState().accountOptions.map(option => option.accountKey),
      [getAccountKey(other), getAccountKey(selected)]
    )
  })

  it('normalizes a persisted exact account key without replacing the explicit binding', async () => {
    const routed = new Array<Account>()
    const store = new ProviderTriageStore(
      dependencies(account => {
        routed.push(account)
        return api()
      })
    )
    const persistedKey = 'https://GITLAB.example/api/v4/#0001'

    await store.load(repository(1, 'material', persistedKey), [selected])

    assert.deepEqual(routed, [selected])
    assert.equal(store.getState().status, 'ready')
    assert.equal(store.getState().accountKey, getAccountKey(selected))
  })

  it('loads and refreshes the exact account key persisted by repository settings', async () => {
    const database = new TestRepositoriesDatabase()
    await database.reset()
    try {
      const repositories = new RepositoriesStore(database)
      const addedUpdate = nextRepositoryUpdate(
        repositories,
        repository => repository.path === 'C:\\fixture\\persisted-material'
      )
      const local = await repositories.addRepository(
        'C:\\fixture\\persisted-material',
        'C:\\fixture\\persisted-material\\.git'
      )
      await addedUpdate
      const apiRepository: IAPIFullRepository = {
        clone_url: 'https://gitlab.example/group/material.git',
        ssh_url: 'git@gitlab.example:group/material.git',
        html_url: 'https://gitlab.example/group/material',
        name: 'material',
        owner: {
          id: 10,
          html_url: 'https://gitlab.example/group',
          login: 'group',
          avatar_url: '',
          type: 'Organization',
        },
        private: true,
        fork: false,
        default_branch: 'main',
        pushed_at: '2026-07-15T00:00:00Z',
        has_issues: true,
        archived: false,
        permissions: { pull: true, push: true, admin: false },
        parent: undefined,
      }
      const hostedUpdate = nextRepositoryUpdate(
        repositories,
        repository => repository.gitHubRepository?.name === 'material'
      )
      const hosted = await repositories.setGitHubRepository(
        local,
        await repositories.upsertGitHubRepository(endpoint, apiRepository)
      )
      await hostedUpdate
      const accountUpdate = nextRepositoryUpdate(
        repositories,
        repository => repository.accountKey === getAccountKey(selected)
      )
      const saved = await repositories.updateRepositoryAccount(
        hosted,
        getAccountKey(selected)
      )
      const subscribed = await accountUpdate
      const [persisted] = await repositories.getAll()
      const routed = new Array<string>()
      const triage = new ProviderTriageStore(
        dependencies(account => {
          routed.push(getAccountKey(account))
          return api()
        })
      )

      await triage.load(persisted, [selected])
      await triage.load(persisted, [selected])

      assert.notEqual(saved.hash, hosted.hash)
      assert.equal(subscribed.hash, saved.hash)
      assert.equal(persisted.accountKey, getAccountKey(selected))
      assert.deepEqual(routed, [
        getAccountKey(selected),
        getAccountKey(selected),
      ])
      assert.equal(triage.getState().status, 'ready')
    } finally {
      database.close()
    }
  })

  it('auto-binds the only valid provider account before loading', async () => {
    const persisted = new Array<string>()
    const routed = new Array<Account>()
    const store = new ProviderTriageStore(
      dependencies(account => {
        routed.push(account)
        return api()
      })
    )
    const unbound = repository(1, 'material', null)

    await store.load(
      unbound,
      [selected],
      undefined,
      async (repo, accountKey) => {
        persisted.push(accountKey)
        return repository(repo.id, 'material', accountKey)
      }
    )

    assert.deepEqual(persisted, [getAccountKey(selected)])
    assert.deepEqual(routed, [selected])
    assert.equal(store.getState().status, 'ready')
    assert.equal(store.getState().accountStatus, 'ready')
  })

  it('persists a labelled multiple-account choice before routing', async () => {
    const persisted = new Array<string>()
    const routed = new Array<Account>()
    const store = new ProviderTriageStore(
      dependencies(account => {
        routed.push(account)
        return api()
      })
    )
    const unbound = repository(1, 'material', null)

    await store.load(
      unbound,
      [other, selected],
      undefined,
      async (repo, accountKey) => {
        persisted.push(accountKey)
        return repository(repo.id, 'material', accountKey)
      },
      getAccountKey(other)
    )

    assert.deepEqual(persisted, [getAccountKey(other)])
    assert.deepEqual(routed, [other])
    assert.equal(store.getState().accountKey, getAccountKey(other))
  })

  it('distinguishes no provider account from a stale explicit binding', async () => {
    const store = new ProviderTriageStore(dependencies(() => api()))

    await store.load(repository(1, 'material', null), [])
    assert.equal(store.getState().accountStatus, 'signed-out')
    assert.match(store.getState().message ?? '', /Sign in.*manage accounts/i)

    await store.load(repository(1, 'material', getAccountKey(selected)), [])
    assert.equal(store.getState().accountStatus, 'authentication')
    assert.equal(store.getState().accountKey, getAccountKey(selected))
    assert.match(store.getState().message ?? '', /saved repository binding/)
  })

  it('drops a stale account-association generation before provider load', async () => {
    const association = deferred<Repository>()
    const routed = new Array<string>()
    const store = new ProviderTriageStore(
      dependencies(account => {
        routed.push(account.login)
        return api()
      })
    )
    const firstLoad = store.load(
      repository(1, 'first', null),
      [selected],
      undefined,
      async () => association.promise
    )

    await store.load(repository(2, 'second'), [selected])
    association.resolve(repository(1, 'first'))
    await firstLoad

    assert.deepEqual(routed, ['selected'])
    assert.equal(store.getState().repositoryName, 'group/second')
  })

  it('classifies permission and SSO failures without provider payload text', async () => {
    const store = new ProviderTriageStore(
      dependencies(() =>
        api({
          fetchProviderTriageIssues: async () => {
            throw apiError(403, 'resource protected by SAML SSO secret-body')
          },
          fetchProviderTriagePullRequests: async () => {
            throw apiError(403, 'forbidden secret-body')
          },
        })
      )
    )

    await store.load(repository(1, 'material'), [selected])

    assert.equal(store.getState().accountStatus, 'sso')
    assert.match(store.getState().message ?? '', /SSO authorization/)
    assert.doesNotMatch(JSON.stringify(store.getState()), /secret-body/)
  })

  it('keeps successful results when one provider channel fails', async () => {
    const store = new ProviderTriageStore(
      dependencies(() =>
        api({
          fetchProviderTriageIssues: async () => {
            throw new Error(
              'token=provider-secret C:\\private-user\\must-not-render'
            )
          },
        })
      )
    )
    await store.load(repository(1, 'material'), [selected])
    const state = store.getState()
    assert.equal(state.status, 'partial')
    assert.equal(state.issues.status, 'error')
    assert.equal(state.pullRequests.status, 'ready')
    assert.equal(state.items.length, 1)
    assert.doesNotMatch(JSON.stringify(state), /provider-secret|private-user/)
  })

  it('preserves an explicit unsupported issue channel', async () => {
    const bitbucket = new Account(
      'selected',
      'https://api.bitbucket.org/2.0',
      'bitbucket-secret',
      [],
      '',
      3,
      'Selected',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'bitbucket'
    )
    const remote = new GitHubRepository(
      'material',
      new Owner('workspace', bitbucket.endpoint, 11),
      3
    )
    const repo = new Repository(
      'C:\\fixture\\material',
      3,
      remote,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(bitbucket)
    )
    const store = new ProviderTriageStore({
      ...dependencies(() =>
        api({ fetchProviderTriageIssues: async () => unsupportedPage })
      ),
      htmlURLForEndpoint: () => 'https://bitbucket.org',
    })
    await store.load(repo, [bitbucket])
    assert.equal(store.getState().status, 'ready')
    assert.equal(store.getState().issues.status, 'unsupported')
    assert.match(
      store.getState().issues.message ?? '',
      /does not expose issues/
    )
  })

  it('cancels stale repository generations and never lets them overwrite', async () => {
    const firstIssues = deferred<IAPIProviderTriagePage>()
    const firstPullRequests = deferred<IAPIProviderTriagePage>()
    const signals = new Array<AbortSignal>()
    const store = new ProviderTriageStore(
      dependencies(() => ({
        fetchProviderTriageIssues: async (owner, name, limit, signal) => {
          if (name === 'first') {
            signals.push(signal!)
            return firstIssues.promise
          }
          return { ...readyPage, items: [{ ...apiItem, number: 22 }] }
        },
        fetchProviderTriagePullRequests: async (owner, name, limit, signal) => {
          if (name === 'first') {
            signals.push(signal!)
            return firstPullRequests.promise
          }
          return { ...readyPage, items: [{ ...apiItem, number: 23 }] }
        },
      }))
    )
    const firstLoad = store.load(repository(1, 'first'), [selected])
    await store.load(repository(2, 'second'), [selected])
    assert.equal(
      signals.every(signal => signal.aborted),
      true
    )
    firstIssues.resolve(readyPage)
    firstPullRequests.resolve(readyPage)
    await firstLoad
    assert.equal(store.getState().repositoryName, 'group/second')
    assert.deepEqual(
      store
        .getState()
        .items.map(item => item.number)
        .sort(),
      [22, 23]
    )
  })

  it('invalidates an in-flight generation when its account is removed', async () => {
    const pending = deferred<IAPIProviderTriagePage>()
    let signal: AbortSignal | undefined
    const store = new ProviderTriageStore(
      dependencies(() =>
        api({
          fetchProviderTriageIssues: async (owner, name, limit, value) => {
            signal = value
            return pending.promise
          },
          fetchProviderTriagePullRequests: async () => pending.promise,
        })
      )
    )
    const load = store.load(repository(1, 'material'), [selected])
    store.updateAccounts([])
    assert.equal(signal?.aborted, true)
    assert.equal(store.getState().status, 'unavailable')
    pending.resolve(readyPage)
    await load
    assert.equal(store.getState().status, 'unavailable')
  })

  it('aborts a same-key old-token generation before publishing a rotated session', async () => {
    const oldPage = deferred<IAPIProviderTriagePage>()
    const oldSignals = new Array<AbortSignal>()
    const rotated = selected.withToken('rotated-secret-token')
    const store = new ProviderTriageStore(
      dependencies(account =>
        account.token === selected.token
          ? {
              fetchProviderTriageIssues: async (owner, name, limit, signal) => {
                oldSignals.push(signal!)
                return oldPage.promise
              },
              fetchProviderTriagePullRequests: async (
                owner,
                name,
                limit,
                signal
              ) => {
                oldSignals.push(signal!)
                return oldPage.promise
              },
            }
          : api({
              fetchProviderTriageIssues: async () => ({
                ...readyPage,
                items: [{ ...apiItem, number: 88 }],
              }),
              fetchProviderTriagePullRequests: async () => ({
                supported: true,
                capped: false,
                items: [],
              }),
            })
      )
    )

    const oldLoad = store.load(repository(1, 'material'), [selected])
    store.updateAccounts([rotated])
    assert.equal(oldSignals.length, 2)
    assert.equal(
      oldSignals.every(signal => signal.aborted),
      true
    )
    await store.load(repository(1, 'material'), [rotated])
    assert.deepEqual(
      store.getState().items.map(item => item.number),
      [88]
    )
    oldPage.resolve(readyPage)
    await oldLoad
    assert.deepEqual(
      store.getState().items.map(item => item.number),
      [88]
    )
    assert.doesNotMatch(
      JSON.stringify(store.getState()),
      /rotated-secret-token/
    )
  })

  it('retains no token, clone URL, local path, or raw provider body', async () => {
    const store = new ProviderTriageStore(dependencies(() => api()))
    await store.load(repository(1, 'material'), [selected])
    const serialized = JSON.stringify(store.getState())
    assert.doesNotMatch(serialized, /selected-secret-token/)
    assert.doesNotMatch(serialized, /credential-value/)
    assert.doesNotMatch(serialized, /private-user/)
    assert.doesNotMatch(serialized, /body|payload/)
    assert.match(store.getState().repositoryKey ?? '', /^triage-repository-/)
  })
})
