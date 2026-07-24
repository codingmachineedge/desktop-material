import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  DefaultLockRetryState,
  DefaultMinimumStaleIndexLockAgeMs,
  IIndexLockObservation,
  advanceLockRetry,
  canRetryAfterLockContention,
  decideStaleIndexLockRemoval,
  shouldRemoveStaleIndexLock,
} from '../../../src/lib/large-repository/stale-index-lock'

function lock(
  overrides: Partial<IIndexLockObservation> = {}
): IIndexLockObservation {
  return {
    exists: true,
    isRegularFile: true,
    isSymbolicLink: false,
    ageMs: DefaultMinimumStaleIndexLockAgeMs + 1,
    ownerActive: false,
    ...overrides,
  }
}

describe('decideStaleIndexLockRemoval', () => {
  it('reports absent when there is no lock', () => {
    assert.strictEqual(
      decideStaleIndexLockRemoval(lock({ exists: false })),
      'absent'
    )
  })

  it('refuses a symbolic link (fail closed)', () => {
    assert.strictEqual(
      decideStaleIndexLockRemoval(lock({ isSymbolicLink: true })),
      'not-regular'
    )
  })

  it('refuses a non-regular file', () => {
    assert.strictEqual(
      decideStaleIndexLockRemoval(lock({ isRegularFile: false })),
      'not-regular'
    )
  })

  it('keeps a lock younger than the staleness age', () => {
    assert.strictEqual(
      decideStaleIndexLockRemoval(lock({ ageMs: 1_000 })),
      'too-fresh'
    )
  })

  it('keeps a lock a live process still owns', () => {
    assert.strictEqual(
      decideStaleIndexLockRemoval(lock({ ownerActive: true })),
      'owner-active'
    )
  })

  it('fails closed when ownership is indeterminate', () => {
    assert.strictEqual(
      decideStaleIndexLockRemoval(lock({ ownerActive: null })),
      'owner-unknown'
    )
  })

  it('removes an old, regular, provably-unowned lock', () => {
    const decision = decideStaleIndexLockRemoval(lock())
    assert.strictEqual(decision, 'remove')
    assert.strictEqual(shouldRemoveStaleIndexLock(decision), true)
  })

  it('marks every non-remove verdict as not removable', () => {
    for (const observation of [
      lock({ exists: false }),
      lock({ isSymbolicLink: true }),
      lock({ ageMs: 1 }),
      lock({ ownerActive: true }),
      lock({ ownerActive: null }),
    ]) {
      assert.strictEqual(
        shouldRemoveStaleIndexLock(decideStaleIndexLockRemoval(observation)),
        false
      )
    }
  })
})

describe('bounded lock retry', () => {
  it('permits exactly one removal-and-retry by default', () => {
    let state = DefaultLockRetryState
    assert.strictEqual(canRetryAfterLockContention(state), true)
    state = advanceLockRetry(state)
    assert.strictEqual(state.attempts, 1)
    assert.strictEqual(canRetryAfterLockContention(state), false)
  })

  it('throws rather than exceed the retry budget', () => {
    const exhausted = advanceLockRetry(DefaultLockRetryState)
    assert.throws(() => advanceLockRetry(exhausted), /retry budget exhausted/)
  })
})
