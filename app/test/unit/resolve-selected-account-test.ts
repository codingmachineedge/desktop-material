import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Account } from '../../src/models/account'
import { getDotComAPIEndpoint } from '../../src/lib/api'
import { resolveSelectedAccount } from '../../src/lib/resolve-selected-account'

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

// A second GitHub.com account. It shares the same endpoint as firstAccount,
// which is exactly the case that an endpoint-only match would get wrong.
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

describe('resolveSelectedAccount', () => {
  it('switches to a second account that shares an endpoint', () => {
    assert.equal(
      resolveSelectedAccount([firstAccount, secondAccount], secondAccount),
      secondAccount
    )
  })

  it('keeps the first account when it is the selected one', () => {
    assert.equal(
      resolveSelectedAccount([firstAccount, secondAccount], firstAccount),
      firstAccount
    )
  })

  it('matches on identity even when a refreshed instance is provided', () => {
    // The accounts store can emit a new Account instance for the same identity
    // (endpoint + id) after refreshing details from the API. Reference equality
    // no longer holds, but the selection should still resolve.
    const refreshedSecond = secondAccount.withToken('refreshed-token')

    assert.equal(
      resolveSelectedAccount([firstAccount, secondAccount], refreshedSecond),
      secondAccount
    )
  })

  it('falls back to the first account when there is no selection', () => {
    assert.equal(
      resolveSelectedAccount([firstAccount, secondAccount], null),
      firstAccount
    )
  })

  it('falls back to the first account when the selection is signed out', () => {
    assert.equal(
      resolveSelectedAccount([firstAccount], secondAccount),
      firstAccount
    )
  })

  it('returns null when there are no accounts', () => {
    assert.equal(resolveSelectedAccount([], secondAccount), null)
    assert.equal(resolveSelectedAccount([], null), null)
  })
})
