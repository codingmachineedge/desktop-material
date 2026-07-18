import { describe, it } from 'node:test'
import assert from 'node:assert'

// `window` is provided globally by global-jsdom (see app/test/globals.mts);
// importing the module installs its capture-phase listeners on that window.
import { getLastPointerPosition } from '../../src/lib/context-menu-pointer'

describe('context-menu pointer tracking', () => {
  it('records the pointer position from a capture-phase contextmenu event', () => {
    window.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: 314, clientY: 271 })
    )
    assert.deepEqual(getLastPointerPosition(), { x: 314, y: 271 })
  })

  it('updates from a subsequent mousedown so the first menu is already tracked', () => {
    window.dispatchEvent(
      new MouseEvent('mousedown', { clientX: 42, clientY: 99 })
    )
    assert.deepEqual(getLastPointerPosition(), { x: 42, y: 99 })
  })
})
