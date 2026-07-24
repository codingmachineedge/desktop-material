import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  buildMissingRepositoryNotification,
  initialMissingRepositoryPollingState,
  reduceMissingRepositoryPolling,
  shouldPollMissingRepository,
} from '../../../src/lib/large-repository/missing-repository-polling'

describe('reduceMissingRepositoryPolling', () => {
  it('suspends and notifies exactly once on the first miss (default config)', () => {
    const first = reduceMissingRepositoryPolling(
      initialMissingRepositoryPollingState,
      'missing'
    )
    assert.strictEqual(first.state.status, 'suspended')
    assert.strictEqual(first.state.notified, true)
    assert.strictEqual(first.effect, 'suspend-and-notify')
    assert.strictEqual(shouldPollMissingRepository(first.state), false)
  })

  it('absorbs further misses without re-notifying', () => {
    const suspended = reduceMissingRepositoryPolling(
      initialMissingRepositoryPollingState,
      'missing'
    ).state
    const again = reduceMissingRepositoryPolling(suspended, 'missing')
    assert.strictEqual(again.effect, 'none')
    assert.strictEqual(again.state.status, 'suspended')
  })

  it('tolerates transient misses below a higher suspendAfter threshold', () => {
    const config = { suspendAfter: 3 }
    let state = initialMissingRepositoryPollingState
    let transition = reduceMissingRepositoryPolling(state, 'missing', config)
    assert.strictEqual(transition.effect, 'none')
    assert.strictEqual(transition.state.status, 'active')
    state = transition.state

    transition = reduceMissingRepositoryPolling(state, 'missing', config)
    assert.strictEqual(transition.effect, 'none')
    state = transition.state

    transition = reduceMissingRepositoryPolling(state, 'missing', config)
    assert.strictEqual(transition.effect, 'suspend-and-notify')
    assert.strictEqual(transition.state.status, 'suspended')
  })

  it('resumes and clears when the directory reappears', () => {
    const suspended = reduceMissingRepositoryPolling(
      initialMissingRepositoryPollingState,
      'missing'
    ).state
    const present = reduceMissingRepositoryPolling(suspended, 'present')
    assert.strictEqual(present.effect, 'resume')
    assert.deepStrictEqual(present.state, initialMissingRepositoryPollingState)
    assert.strictEqual(shouldPollMissingRepository(present.state), true)
  })

  it('treats a present observation while active as a no-op', () => {
    const present = reduceMissingRepositoryPolling(
      initialMissingRepositoryPollingState,
      'present'
    )
    assert.strictEqual(present.effect, 'none')
    assert.deepStrictEqual(present.state, initialMissingRepositoryPollingState)
  })

  it('resumes on a manual resume request from a suspended state', () => {
    const suspended = reduceMissingRepositoryPolling(
      initialMissingRepositoryPollingState,
      'missing'
    ).state
    const resumed = reduceMissingRepositoryPolling(suspended, 'resume')
    assert.strictEqual(resumed.effect, 'resume')
    assert.strictEqual(resumed.state.status, 'active')
  })
})

describe('buildMissingRepositoryNotification', () => {
  it('builds an info notification with an open-repository action', () => {
    const notification = buildMissingRepositoryNotification(
      42,
      'Repository missing on disk',
      'my-repo could not be found on disk.'
    )
    assert.strictEqual(notification.kind, 'info')
    assert.strictEqual(notification.repositoryId, 42)
    assert.deepStrictEqual(notification.action, {
      kind: 'open-repository',
      repositoryId: 42,
    })
  })
})
