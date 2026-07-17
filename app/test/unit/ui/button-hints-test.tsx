import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { Button, getButtonHint } from '../../../src/ui/lib/button'
import {
  ButtonHints,
  getNativeButtonHint,
} from '../../../src/ui/lib/button-hints'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

describe('button hints', () => {
  it('prefers an explicit hint, then the accessible label, then visible text', () => {
    assert.equal(getButtonHint('Explicit', 'Accessible', 'Visible'), 'Explicit')
    assert.equal(
      getButtonHint(undefined, 'Accessible', 'Visible'),
      'Accessible'
    )
    assert.equal(
      getButtonHint(
        undefined,
        undefined,
        <span>
          Nested <strong>visible text</strong>
        </span>
      ),
      'Nested visible text'
    )
  })

  it('installs inferred shared-button hints without native title text', () => {
    render(<Button ariaLabel="Refresh repositories" />)

    const button = screen.getByRole('button', { name: 'Refresh repositories' })
    assert.equal(button.getAttribute('title'), null)
    assert.equal(button.getAttribute('data-tooltip-target'), 'true')
  })

  it('infers native-button hints from accessible names and visible text', () => {
    const labelled = document.createElement('button')
    labelled.setAttribute('aria-label', 'Close panel')
    assert.equal(getNativeButtonHint(labelled), 'Close panel')

    const visible = document.createElement('button')
    visible.textContent = '  Load   more  '
    assert.equal(getNativeButtonHint(visible), 'Load more')
  })

  it('delegates the existing Tooltip to native buttons added to the app', async () => {
    render(
      <>
        <ButtonHints />
        <button type="button" aria-label="Dismiss notification">
          ×
        </button>
      </>
    )

    const button = screen.getByRole('button', { name: 'Dismiss notification' })
    fireEvent.mouseOver(button)

    await waitFor(() =>
      assert.equal(button.getAttribute('data-tooltip-target'), 'true')
    )
    assert.equal(button.getAttribute('title'), null)
  })

  it('lets a hovered native button override a different focused button', async () => {
    render(
      <>
        <ButtonHints />
        <Button ariaLabel="Focused shared action" />
        <button type="button" aria-label="Hovered native action" />
      </>
    )

    screen.getByRole('button', { name: 'Focused shared action' }).focus()
    const hovered = screen.getByRole('button', {
      name: 'Hovered native action',
    })
    fireEvent.mouseOver(hovered)

    await waitFor(() =>
      assert.equal(hovered.getAttribute('data-tooltip-target'), 'true')
    )
  })
})
