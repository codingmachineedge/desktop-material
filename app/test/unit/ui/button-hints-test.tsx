import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { Button, getButtonHint } from '../../../src/ui/lib/button'
import {
  ButtonHints,
  getNativeButtonHint,
} from '../../../src/ui/lib/button-hints'
import { LinkButton } from '../../../src/ui/lib/link-button'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'
import {
  advanceTimersBy,
  enableTestTimers,
  resetTestTimers,
} from '../../helpers/ui/timers'

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
    render(
      <Button ariaLabel="Refresh repositories">
        <span>Refresh</span>
      </Button>
    )

    const button = screen.getByRole('button', { name: 'Refresh repositories' })
    assert.equal(button.getAttribute('title'), null)
    assert.equal(button.getAttribute('data-tooltip-target'), 'true')
    assert.equal(button.textContent, 'Refresh')
  })

  it('shows inferred shared-button hints on hover', t => {
    enableTestTimers(['setTimeout'])
    t.after(resetTestTimers)

    render(
      <Button ariaLabel="Refresh repositories">
        <span>Refresh</span>
      </Button>
    )

    const button = screen.getByRole('button', { name: 'Refresh repositories' })
    fireEvent.mouseEnter(button, { clientX: 20, clientY: 20 })
    advanceTimersBy(400)

    assert.equal(
      screen.getByRole('tooltip', { hidden: true }).textContent,
      'Refresh repositories'
    )
    assert.equal(button.textContent, 'Refresh')
    assert.equal(button.getAttribute('aria-label'), 'Refresh repositories')
  })

  it('gives callback-style link buttons inferred hover hints', t => {
    enableTestTimers(['setTimeout'])
    t.after(resetTestTimers)

    render(
      <>
        <LinkButton ariaLabel="Retry failed request" onClick={() => {}}>
          Retry
        </LinkButton>
        <LinkButton uri="https://example.com/docs">Documentation</LinkButton>
      </>
    )

    const button = screen.getByRole('button', {
      name: 'Retry failed request',
    })
    fireEvent.mouseEnter(button, { clientX: 20, clientY: 20 })
    advanceTimersBy(400)

    assert.equal(
      screen.getByRole('tooltip', { hidden: true }).textContent,
      'Retry failed request'
    )
    assert.equal(button.textContent, 'Retry')
    assert.equal(button.getAttribute('title'), null)
    assert.equal(
      screen
        .getByRole('link', { name: 'Documentation' })
        .getAttribute('data-tooltip-target'),
      null
    )
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

  it('shows delegated hints when native buttons receive focus', t => {
    enableTestTimers(['setTimeout'])
    t.after(resetTestTimers)

    render(
      <>
        <ButtonHints />
        <button type="button">Load more results</button>
      </>
    )

    const button = screen.getByRole('button', { name: 'Load more results' })
    fireEvent.focusIn(button)
    assert.equal(button.getAttribute('data-tooltip-target'), 'true')

    advanceTimersBy(400)

    assert.equal(
      screen.getByRole('tooltip', { hidden: true }).textContent,
      'Load more results'
    )
    assert.equal(button.textContent, 'Load more results')
  })

  it('keeps a native hint active when a hovered button receives focus', t => {
    enableTestTimers(['setTimeout'])
    t.after(resetTestTimers)

    render(
      <>
        <ButtonHints />
        <button type="button" aria-label="Dismiss notification">
          <span aria-hidden="true">×</span>
        </button>
      </>
    )

    const button = screen.getByRole('button', { name: 'Dismiss notification' })
    fireEvent.mouseOver(button)
    assert.equal(button.getAttribute('data-tooltip-target'), 'true')

    fireEvent.focusIn(button)
    assert.equal(button.getAttribute('data-tooltip-target'), 'true')

    advanceTimersBy(400)

    assert.equal(
      screen.getByRole('tooltip', { hidden: true }).textContent,
      'Dismiss notification'
    )
    assert.equal(button.getAttribute('aria-label'), 'Dismiss notification')
    assert.equal(button.getAttribute('aria-describedby'), null)
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
