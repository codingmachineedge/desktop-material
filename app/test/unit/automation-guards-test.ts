import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  IAutomationGuardState,
  canAutoCommitPush,
  canAutoPull,
} from '../../src/lib/automation/automation-guards'
import { buildFallbackCommitMessage } from '../../src/lib/automation/fallback-commit-message'

const safe: IAutomationGuardState = {
  tipIsValid: true,
  hasChanges: true,
  hasConflict: false,
  hasMultiCommitOperation: false,
  isCommitting: false,
  isGeneratingCommitMessage: false,
  isPushPullFetchInProgress: false,
  isCheckingOut: false,
  hasDraftCommitMessage: false,
  hasUpstream: true,
  mergeHeadSet: false,
}

describe('automation guards', () => {
  it('protects draft messages and dirty pulls', () => {
    assert.equal(
      canAutoCommitPush({ ...safe, hasDraftCommitMessage: true }).safe,
      false
    )
    assert.equal(canAutoPull(safe).safe, false)
    assert.equal(canAutoPull({ ...safe, hasChanges: false }).safe, true)
  })

  it('blocks concurrent and conflicted operations', () => {
    assert.equal(canAutoCommitPush({ ...safe, isCommitting: true }).safe, false)
    assert.equal(canAutoCommitPush({ ...safe, hasConflict: true }).safe, false)
  })

  it('builds a deterministic capped fallback message', () => {
    const files = Array.from({ length: 12 }, (_, i) => ({ path: `file-${i}` }))
    const message = buildFallbackCommitMessage(
      files as never,
      new Date('2026-07-12T10:11:12.000Z')
    )
    assert.equal(message.summary, 'Auto commit 2026-07-12 10:11:12Z')
    assert.match(message.description ?? '', /12 files changed/)
    assert.match(message.description ?? '', /…and 2 more/)
    assert.doesNotMatch(message.description ?? '', /file-10/)
  })
})
