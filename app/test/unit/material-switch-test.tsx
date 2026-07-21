import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { MaterialSwitch } from '../../src/ui/lib/material-switch'
import { fireEvent, render } from '../helpers/ui/render'

describe('MaterialSwitch', () => {
  it('exposes a role=switch button whose aria-checked reflects the state', () => {
    const view = render(
      <MaterialSwitch
        checked={true}
        onChange={() => undefined}
        ariaLabel="Enable notifications"
      />
    )
    const button = view.getByRole('switch', { name: 'Enable notifications' })
    assert.equal(button.tagName, 'BUTTON')
    assert.equal(button.getAttribute('aria-checked'), 'true')

    view.rerender(
      <MaterialSwitch
        checked={false}
        onChange={() => undefined}
        ariaLabel="Enable notifications"
      />
    )
    assert.equal(button.getAttribute('aria-checked'), 'false')
  })

  it('requests the toggled value on activation', () => {
    const calls: boolean[] = []
    const view = render(
      <MaterialSwitch
        checked={false}
        onChange={value => calls.push(value)}
        ariaLabel="Automatically pull"
      />
    )
    fireEvent.click(view.getByRole('switch'))
    assert.deepEqual(calls, [true])

    view.rerender(
      <MaterialSwitch
        checked={true}
        onChange={value => calls.push(value)}
        ariaLabel="Automatically pull"
      />
    )
    fireEvent.click(view.getByRole('switch'))
    assert.deepEqual(calls, [true, false])
  })

  it('carries an embedded, hidden check glyph inside the sliding thumb', () => {
    const view = render(
      <MaterialSwitch checked={true} onChange={() => undefined} ariaLabel="x" />
    )
    const check = view.container.querySelector<HTMLElement>(
      '.material-switch-thumb .material-switch-check'
    )
    assert.ok(check !== null)
    assert.equal(check.textContent, 'check')
    assert.equal(check.getAttribute('aria-hidden'), 'true')
  })

  it('does not toggle while disabled', () => {
    const calls: boolean[] = []
    const view = render(
      <MaterialSwitch
        checked={false}
        disabled={true}
        onChange={value => calls.push(value)}
        ariaLabel="x"
      />
    )
    const button = view.getByRole('switch') as HTMLButtonElement
    assert.equal(button.disabled, true)
    fireEvent.click(button)
    assert.deepEqual(calls, [])
  })

  it('derives its accessible name from an associated label element', () => {
    const view = render(
      <div>
        <span id="switch-title">Automatically commit and push</span>
        <MaterialSwitch
          checked={false}
          onChange={() => undefined}
          ariaLabelledBy="switch-title"
        />
      </div>
    )
    assert.ok(
      view.getByRole('switch', { name: 'Automatically commit and push' })
    )
  })
})
