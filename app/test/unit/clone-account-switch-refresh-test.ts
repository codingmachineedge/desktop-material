import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Account } from '../../src/models/account'
import { shouldRefreshCloneableRepositories } from '../../src/ui/clone-repository/cloneable-repository-filter-list'
import { resolvedCloneAccountChanged } from '../../src/ui/clone-repository/clone-repository'
import { CloneRepositoryTab } from '../../src/models/clone-repository-tab'

describe('clone account switch refresh', () => {
  it('refreshes even when both account repository props are null', () => {
    const first = new Account(
      'first',
      'https://api.github.com',
      'one',
      [],
      '',
      1,
      'First',
      'free'
    )
    const second = new Account(
      'second',
      'https://api.github.com',
      'two',
      [],
      '',
      2,
      'Second',
      'free'
    )
    assert.equal(
      shouldRefreshCloneableRepositories(first, second, null, null),
      true
    )
    assert.equal(
      shouldRefreshCloneableRepositories(first, first, null, null),
      false
    )
  })

  it('detects an implicit fallback to a different account after sign-out', () => {
    const first = new Account(
      'first',
      'https://api.github.com',
      'one',
      [],
      '',
      1,
      'First',
      'free'
    )
    const refreshedFirst = first.withToken('refreshed')
    const second = new Account(
      'second',
      'https://api.github.com',
      'two',
      [],
      '',
      2,
      'Second',
      'free'
    )

    assert.equal(
      resolvedCloneAccountChanged(
        CloneRepositoryTab.DotCom,
        first,
        [first, second],
        [refreshedFirst, second]
      ),
      false
    )
    assert.equal(
      resolvedCloneAccountChanged(
        CloneRepositoryTab.DotCom,
        first,
        [first, second],
        [second]
      ),
      true
    )
  })
})
