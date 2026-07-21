import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Account, getAccountKey } from '../../src/models/account'
import { Repository } from '../../src/models/repository'
import { getDotComAPIEndpoint } from '../../src/lib/api'
import {
  getAccountForRepository,
  getRepositoryCredentialAccountKey,
  getRepositoryOwnerAccountToPromote,
} from '../../src/lib/get-account-for-repository'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'

const endpoint = getDotComAPIEndpoint()
const firstAccount = new Account(
  'first',
  endpoint,
  'first-token',
  [],
  '',
  1,
  'First User',
  'free'
)
const secondAccount = new Account(
  'second',
  endpoint,
  'second-token',
  [],
  '',
  2,
  'Second User',
  'free'
)
const gitHubRepository = gitHubRepoFixture({
  owner: 'desktop',
  name: 'desktop',
})

describe('getAccountForRepository', () => {
  it('uses the bound account when multiple users share an endpoint', () => {
    const repository = new Repository(
      '/desktop',
      1,
      gitHubRepository,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(secondAccount)
    )

    assert.equal(
      getAccountForRepository([firstAccount, secondAccount], repository),
      secondAccount
    )
  })

  it('does not silently switch identity when the bound account is signed out', () => {
    const repository = new Repository(
      '/desktop',
      1,
      gitHubRepository,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(secondAccount)
    )

    assert.equal(getAccountForRepository([firstAccount], repository), null)
  })

  it('keeps endpoint fallback for repositories created before bindings', () => {
    const repository = new Repository('/desktop', 1, gitHubRepository, false)

    assert.equal(
      getAccountForRepository([firstAccount, secondAccount], repository),
      firstAccount
    )
  })
})

describe('getRepositoryCredentialAccountKey', () => {
  it('preserves an explicit binding when that account is signed out', () => {
    const missingAccountKey = getAccountKey(secondAccount)
    const repository = new Repository(
      '/desktop',
      1,
      gitHubRepository,
      false,
      null,
      {},
      false,
      undefined,
      missingAccountKey
    )

    assert.equal(
      getRepositoryCredentialAccountKey([firstAccount], repository),
      missingAccountKey
    )
  })

  it('uses endpoint fallback only for an unbound repository', () => {
    const repository = new Repository('/desktop', 1, gitHubRepository, false)

    assert.equal(
      getRepositoryCredentialAccountKey(
        [firstAccount, secondAccount],
        repository
      ),
      getAccountKey(firstAccount)
    )
  })

  it('does not force credentials for a local-only repository', () => {
    const repository = new Repository('/local', 2, null, false)

    assert.equal(
      getRepositoryCredentialAccountKey([firstAccount], repository),
      undefined
    )
  })
})

describe('getRepositoryOwnerAccountToPromote', () => {
  const boundTo = (account: Account) =>
    new Repository(
      '/desktop',
      1,
      gitHubRepository,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(account)
    )

  it('promotes the owning account when it is not already active', () => {
    // firstAccount is active (accounts[0]) but the repo is owned by secondAccount.
    assert.equal(
      getRepositoryOwnerAccountToPromote(
        [firstAccount, secondAccount],
        boundTo(secondAccount),
        true
      ),
      secondAccount
    )
  })

  it('does nothing when the owner is already the active account', () => {
    assert.equal(
      getRepositoryOwnerAccountToPromote(
        [firstAccount, secondAccount],
        boundTo(firstAccount),
        true
      ),
      null
    )
  })

  it('does nothing when the bound owner is signed out', () => {
    assert.equal(
      getRepositoryOwnerAccountToPromote(
        [firstAccount],
        boundTo(secondAccount),
        true
      ),
      null
    )
  })

  it('does nothing when auto-switching is disabled', () => {
    assert.equal(
      getRepositoryOwnerAccountToPromote(
        [firstAccount, secondAccount],
        boundTo(secondAccount),
        false
      ),
      null
    )
  })

  it('does nothing with a single account', () => {
    const repository = new Repository('/desktop', 1, gitHubRepository, false)

    assert.equal(
      getRepositoryOwnerAccountToPromote([firstAccount], repository, true),
      null
    )
  })

  it('does nothing for a repository without a GitHub repository', () => {
    const repository = new Repository('/local', 2, null, false)

    assert.equal(
      getRepositoryOwnerAccountToPromote(
        [firstAccount, secondAccount],
        repository,
        true
      ),
      null
    )
  })
})
