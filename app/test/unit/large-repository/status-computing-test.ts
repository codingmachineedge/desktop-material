import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  decideStatusEmptyState,
  shouldShowStatusComputing,
} from '../../../src/lib/large-repository/status-computing'

describe('decideStatusEmptyState', () => {
  it('shows the computing state for an empty, never-loaded status', () => {
    assert.strictEqual(
      decideStatusEmptyState({ fileCount: 0, hasLoadedStatus: false }),
      'computing'
    )
    assert.strictEqual(
      shouldShowStatusComputing({ fileCount: 0, hasLoadedStatus: false }),
      true
    )
  })

  it('shows "no changes" only once a status has been applied', () => {
    assert.strictEqual(
      decideStatusEmptyState({ fileCount: 0, hasLoadedStatus: true }),
      'no-changes'
    )
    assert.strictEqual(
      shouldShowStatusComputing({ fileCount: 0, hasLoadedStatus: true }),
      false
    )
  })

  it('reports changes present whenever files exist, regardless of load flag', () => {
    assert.strictEqual(
      decideStatusEmptyState({ fileCount: 3, hasLoadedStatus: false }),
      'has-changes'
    )
    assert.strictEqual(
      decideStatusEmptyState({ fileCount: 3, hasLoadedStatus: true }),
      'has-changes'
    )
  })
})
