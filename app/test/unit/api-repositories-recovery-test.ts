import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Account } from '../../src/models/account'
import { API } from '../../src/lib/api'
import { ApiRepositoriesStore } from '../../src/lib/stores/api-repositories-store'
import { createTestAccountsStore } from '../helpers/app-store-test-harness'

describe('ApiRepositoriesStore recovery', () => {
  it('always clears loading and exposes a retryable account error', async () => {
    const account = new Account(
      'octocat',
      'https://api.github.com',
      'token',
      [],
      '',
      1,
      'Octocat',
      'free'
    )
    let attempts = 0
    const api = {
      streamUserRepositories: async () => {
        attempts += 1
        throw new Error(`network failure ${attempts}`)
      },
    } as unknown as API
    const store = new ApiRepositoriesStore(createTestAccountsStore(), () => api)

    await store.loadRepositories(account)
    const failed = store.getState().get(account)
    assert.equal(failed?.loading, false)
    assert.equal(failed?.error?.message, 'network failure 1')

    await store.loadRepositories(account)
    const retried = store.getState().get(account)
    assert.equal(attempts, 2)
    assert.equal(retried?.loading, false)
    assert.equal(retried?.error?.message, 'network failure 2')
  })
})
