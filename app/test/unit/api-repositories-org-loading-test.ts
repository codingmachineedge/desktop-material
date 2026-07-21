import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Account } from '../../src/models/account'
import { API, IAPIOrganization, IAPIRepository } from '../../src/lib/api'
import { ApiRepositoriesStore } from '../../src/lib/stores/api-repositories-store'
import { createTestAccountsStore } from '../helpers/app-store-test-harness'

function testAccount(): Account {
  return new Account(
    'octocat',
    'https://api.github.com',
    'token',
    [],
    '',
    1,
    'Octocat',
    'free'
  )
}

function org(login: string, id: number): IAPIOrganization {
  return { id, url: '', login, avatar_url: '' }
}

function repo(cloneUrl: string, owner: string): IAPIRepository {
  return {
    clone_url: cloneUrl,
    name: cloneUrl,
    owner: { login: owner },
  } as unknown as IAPIRepository
}

describe('ApiRepositoriesStore organization loading', () => {
  it('loadAll populates organizations for an account with orgs', async () => {
    const account = testAccount()
    const api = {
      streamUserRepositories: async (
        addPage: (page: ReadonlyArray<IAPIRepository>) => void
      ) => {
        addPage([repo('https://github.com/octocat/repo.git', 'octocat')])
      },
      // The store asks fetchOrgs to reject on failure; a healthy response
      // resolves regardless of the argument.
      fetchOrgs: async () => [org('zebra', 2), org('alpha', 1)],
    } as unknown as API
    const store = new ApiRepositoriesStore(createTestAccountsStore(), () => api)

    await store.loadAll(account)

    const state = store.getState().get(account)
    // Both the repository list and the organization list are populated — the
    // concurrent loadRepositories/loadOrganizations updates must not clobber
    // one another.
    assert.equal(state?.repositories.length, 1)
    assert.deepEqual(
      state?.organizations.map(o => o.login),
      ['alpha', 'zebra'],
      'organizations should be alphabetically sorted'
    )
    assert.equal(state?.organizationsLoading, false)
    assert.equal(state?.organizationsError ?? null, null)
    assert.equal(state?.loading, false)
  })

  it('surfaces a retryable organizations error instead of an empty list', async () => {
    const account = testAccount()
    let attempts = 0
    const api = {
      streamUserRepositories: async () => {},
      fetchOrgs: async (throwOnError?: boolean) => {
        attempts += 1
        if (attempts === 1) {
          if (throwOnError) {
            throw new Error('org boom')
          }
          return []
        }
        return [org('octo-org', 3)]
      },
    } as unknown as API
    const store = new ApiRepositoriesStore(createTestAccountsStore(), () => api)

    // The failed fetch must resolve loadOrganizations (not reject) and record a
    // retryable error rather than silently leaving an ambiguous empty list.
    await store.loadOrganizations(account)
    const failed = store.getState().get(account)
    assert.equal(attempts, 1)
    assert.equal(failed?.organizations.length, 0)
    assert.equal(failed?.organizationsLoading, false)
    assert.equal(failed?.organizationsError?.message, 'org boom')

    // Retrying clears the error and populates the organization list.
    await store.loadOrganizations(account)
    const retried = store.getState().get(account)
    assert.equal(attempts, 2)
    assert.equal(retried?.organizationsError ?? null, null)
    assert.deepEqual(
      retried?.organizations.map(o => o.login),
      ['octo-org']
    )
  })

  it('requests the throwing form of fetchOrgs so failures are not swallowed', async () => {
    const account = testAccount()
    let sawThrowOnError: boolean | undefined
    const api = {
      streamUserRepositories: async () => {},
      fetchOrgs: async (throwOnError?: boolean) => {
        sawThrowOnError = throwOnError
        return []
      },
    } as unknown as API
    const store = new ApiRepositoriesStore(createTestAccountsStore(), () => api)

    await store.loadOrganizations(account)

    assert.equal(
      sawThrowOnError,
      true,
      'loadOrganizations should call fetchOrgs(true) to surface failures'
    )
  })
})
