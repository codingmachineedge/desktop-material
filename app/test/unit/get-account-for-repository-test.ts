import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Account, getAccountKey } from '../../src/models/account'
import { Repository } from '../../src/models/repository'
import { getDotComAPIEndpoint } from '../../src/lib/api'
import { getAccountForRepository } from '../../src/lib/get-account-for-repository'
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
