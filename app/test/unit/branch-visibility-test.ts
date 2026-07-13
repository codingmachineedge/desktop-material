import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert'
import {
  clearBranchVisibilityState,
  DefaultBranchVisibilityState,
  loadBranchVisibilityState,
  saveBranchVisibilityState,
} from '../../src/lib/branch-visibility'

describe('branch visibility persistence', () => {
  beforeEach(() => localStorage.clear())

  it('starts with a stable empty view', () => {
    assert.deepEqual(loadBranchVisibilityState(7), DefaultBranchVisibilityState)
  })

  it('deduplicates names and prevents a pinned branch from remaining hidden', () => {
    const saved = saveBranchVisibilityState(7, {
      pinned: ['feature/a', 'feature/a'],
      hidden: ['feature/a', 'feature/b', 'feature/b'],
      solo: 'feature/b',
    })

    assert.deepEqual(saved, {
      pinned: ['feature/a'],
      hidden: ['feature/b'],
      solo: 'feature/b',
    })
    assert.deepEqual(loadBranchVisibilityState(7), saved)
  })

  it('fails closed on malformed persisted values and clears every override', () => {
    localStorage.setItem(
      'branch-visibility:7',
      JSON.stringify({
        pinned: ['valid', 'invalid\nbranch'],
        hidden: 'not-an-array',
        solo: 42,
      })
    )

    assert.deepEqual(loadBranchVisibilityState(7), {
      pinned: [],
      hidden: [],
      solo: null,
    })
    assert.deepEqual(clearBranchVisibilityState(7), {
      pinned: [],
      hidden: [],
      solo: null,
    })
  })

  it('rejects an invalid repository identity without writing storage', () => {
    assert.throws(() => loadBranchVisibilityState(-1))
    assert.equal(localStorage.length, 0)
  })
})
