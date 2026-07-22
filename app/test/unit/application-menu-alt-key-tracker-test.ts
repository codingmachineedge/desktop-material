import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  ApplicationMenuAltKeyTracker,
  IApplicationMenuAltKeyEvent,
} from '../../src/ui/lib/application-menu-alt-key-tracker'

const keyEvent = (
  key: string,
  overrides: Partial<IApplicationMenuAltKeyEvent> = {}
): IApplicationMenuAltKeyEvent => ({
  key,
  repeat: false,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  defaultPrevented: false,
  ...overrides,
})

describe('application menu Alt key tracker', () => {
  it('toggles once for an uninterrupted bare Alt press', () => {
    const tracker = new ApplicationMenuAltKeyTracker()

    assert.equal(tracker.onKeyDown(keyEvent('Alt'), false), true)
    assert.equal(tracker.onKeyUp(keyEvent('Alt'), false), true)
    assert.equal(tracker.onKeyUp(keyEvent('Alt'), false), false)
  })

  it('keeps a valid Alt press pending through auto-repeat', () => {
    const tracker = new ApplicationMenuAltKeyTracker()

    tracker.onKeyDown(keyEvent('Alt'), false)
    assert.equal(
      tracker.onKeyDown(keyEvent('Alt', { repeat: true }), false),
      true
    )
    assert.equal(tracker.onKeyUp(keyEvent('Alt'), false), true)
  })

  it('does not let an orphaned repeat create an Alt press', () => {
    const tracker = new ApplicationMenuAltKeyTracker()

    assert.equal(
      tracker.onKeyDown(keyEvent('Alt', { repeat: true }), false),
      false
    )
    assert.equal(tracker.onKeyUp(keyEvent('Alt'), false), false)
  })

  it('disqualifies Alt plus another key and recovers on the next press', () => {
    const tracker = new ApplicationMenuAltKeyTracker()

    tracker.onKeyDown(keyEvent('Alt'), false)
    tracker.onKeyDown(keyEvent('f'), false)
    assert.equal(tracker.onKeyUp(keyEvent('Alt'), false), false)

    tracker.onKeyDown(keyEvent('Alt'), false)
    assert.equal(tracker.onKeyUp(keyEvent('Alt'), false), true)
  })

  it('never arms modified Alt key-down events', () => {
    for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey'] as const) {
      const tracker = new ApplicationMenuAltKeyTracker()

      assert.equal(
        tracker.onKeyDown(keyEvent('Alt', { [modifier]: true }), false),
        false
      )
      assert.equal(tracker.onKeyUp(keyEvent('Alt'), false), false)
    }
  })

  it('blocks handled and modal key-down sequences', () => {
    const handled = new ApplicationMenuAltKeyTracker()
    handled.onKeyDown(keyEvent('Alt', { defaultPrevented: true }), false)
    assert.equal(handled.onKeyUp(keyEvent('Alt'), false), false)

    const modal = new ApplicationMenuAltKeyTracker()
    modal.onKeyDown(keyEvent('Alt'), true)
    assert.equal(modal.onKeyUp(keyEvent('Alt'), false), false)
  })

  it('clears a pending press even when the intervening key is blocked', () => {
    const handled = new ApplicationMenuAltKeyTracker()
    handled.onKeyDown(keyEvent('Alt'), false)
    handled.onKeyDown(keyEvent('f', { defaultPrevented: true }), false)
    assert.equal(handled.onKeyUp(keyEvent('Alt'), false), false)

    const modal = new ApplicationMenuAltKeyTracker()
    modal.onKeyDown(keyEvent('Alt'), false)
    modal.onKeyDown(keyEvent('f'), true)
    assert.equal(modal.onKeyUp(keyEvent('Alt'), false), false)
  })

  it('clears a stale press when another key-up arrives first', () => {
    const tracker = new ApplicationMenuAltKeyTracker()

    tracker.onKeyDown(keyEvent('Alt'), false)
    tracker.onKeyUp(keyEvent('f'), false)
    assert.equal(tracker.onKeyUp(keyEvent('Alt'), false), false)
  })

  it('consumes handled and modal key-up sequences without leaving stale state', () => {
    const handled = new ApplicationMenuAltKeyTracker()
    handled.onKeyDown(keyEvent('Alt'), false)
    assert.equal(
      handled.onKeyUp(keyEvent('Alt', { defaultPrevented: true }), false),
      false
    )
    assert.equal(handled.onKeyUp(keyEvent('Alt'), false), false)

    const modal = new ApplicationMenuAltKeyTracker()
    modal.onKeyDown(keyEvent('Alt'), false)
    assert.equal(modal.onKeyUp(keyEvent('Alt'), true), false)
    assert.equal(modal.onKeyUp(keyEvent('Alt'), false), false)
  })
})
