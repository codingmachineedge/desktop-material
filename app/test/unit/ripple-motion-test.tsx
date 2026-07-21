import assert from 'node:assert'
import { afterEach, describe, it } from 'node:test'
import * as React from 'react'

import { Button } from '../../src/ui/lib/button'
import {
  attachRipple,
  prefersReducedMotion,
  RippleClassName,
} from '../../src/ui/lib/ripple'
import { AppTheme } from '../../src/ui/app-theme'
import { ApplicationTheme } from '../../src/ui/lib/application-theme'
import {
  DefaultAppearanceCustomization,
  IAppearanceCustomization,
} from '../../src/models/appearance-customization'
import { fireEvent, render } from '../helpers/ui/render'

const rippleSelector = `.${RippleClassName}`
const revealSelector = '.theme-reveal-overlay'

/**
 * jsdom performs no layout, so every `getBoundingClientRect` is zero. Stub a
 * real box on the host so the ripple placement maths is observable.
 */
function stubRect(element: HTMLElement, rect: Partial<DOMRect>): void {
  const full = {
    width: 0,
    height: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect
  element.getBoundingClientRect = () => full
}

afterEach(() => {
  document.body.className = ''
  document.body.removeAttribute('data-dm-motion')
  for (const overlay of document.querySelectorAll(revealSelector)) {
    overlay.remove()
  }
})

describe('Material ripple state layer', () => {
  it('spawns a ripple at the press point on mousedown and removes it on animationend', () => {
    const view = render(<Button>Commit</Button>)
    const button =
      view.container.querySelector<HTMLButtonElement>('.button-component')
    assert.ok(button !== null)
    stubRect(button, { width: 40, height: 32, left: 10, top: 20 })

    fireEvent.mouseDown(button, { clientX: 30, clientY: 36 })

    const ripple = button.querySelector<HTMLSpanElement>(rippleSelector)
    assert.ok(ripple !== null)
    // size = max(40, 32) = 40
    assert.equal(ripple.style.width, '40px')
    assert.equal(ripple.style.height, '40px')
    // x = 30 - 10 - 20 = 0, y = 36 - 20 - 20 = -4
    assert.equal(ripple.style.left, '0px')
    assert.equal(ripple.style.top, '-4px')
    assert.equal(ripple.getAttribute('aria-hidden'), 'true')

    ripple.dispatchEvent(new Event('animationend'))
    assert.equal(button.querySelector(rippleSelector), null)
  })

  it('does not ripple a disabled button', () => {
    const view = render(<Button disabled={true}>Commit</Button>)
    const button =
      view.container.querySelector<HTMLButtonElement>('.button-component')
    assert.ok(button !== null)
    stubRect(button, { width: 40, height: 32 })

    fireEvent.mouseDown(button, { clientX: 4, clientY: 4 })

    assert.equal(button.querySelector(rippleSelector), null)
  })

  it('centres the span on the pointer and cleans it up on animationend', () => {
    const host = document.createElement('div')
    stubRect(host, { width: 100, height: 60, left: 5, top: 5 })
    document.body.appendChild(host)

    try {
      const span = attachRipple(host, { clientX: 55, clientY: 35 })

      assert.ok(span !== null)
      assert.equal(host.querySelector(rippleSelector), span)
      // size = max(100, 60) = 100; x = 55 - 5 - 50 = 0; y = 35 - 5 - 50 = -20
      assert.equal(span.style.width, '100px')
      assert.equal(span.style.left, '0px')
      assert.equal(span.style.top, '-20px')

      span.dispatchEvent(new Event('animationend'))
      assert.equal(host.querySelector(rippleSelector), null)
    } finally {
      host.remove()
    }
  })

  it('falls back to the host centre when the event carries no coordinates', () => {
    const host = document.createElement('div')
    stubRect(host, { width: 80, height: 80, left: 10, top: 10 })

    const span = attachRipple(host, {})

    assert.ok(span !== null)
    // origin defaults to centre (50, 50); x = 50 - 10 - 40 = 0; y = 50 - 10 - 40 = 0
    assert.equal(span.style.left, '0px')
    assert.equal(span.style.top, '0px')

    span.dispatchEvent(new Event('animationend'))
  })

  it('returns null for a disabled native button host', () => {
    const host = document.createElement('button')
    host.disabled = true
    stubRect(host, { width: 40, height: 40 })

    assert.equal(attachRipple(host, {}), null)
    assert.equal(host.querySelector(rippleSelector), null)
  })

  it('suppresses the ripple under the reduced-motion appearance preference', () => {
    document.body.setAttribute('data-dm-motion', 'reduced')
    assert.equal(prefersReducedMotion(), true)

    const host = document.createElement('div')
    stubRect(host, { width: 40, height: 40 })

    assert.equal(attachRipple(host, { clientX: 4, clientY: 4 }), null)
    assert.equal(host.querySelector(rippleSelector), null)
  })

  it('suppresses the ripple under the system prefers-reduced-motion query', () => {
    const original = window.matchMedia
    ;(window as unknown as { matchMedia: unknown }).matchMedia = (
      query: string
    ) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })

    try {
      assert.equal(prefersReducedMotion(), true)

      const host = document.createElement('div')
      stubRect(host, { width: 40, height: 40 })
      assert.equal(attachRipple(host, {}), null)
    } finally {
      ;(window as unknown as { matchMedia: unknown }).matchMedia = original
    }
  })
})

describe('Theme reveal pulse', () => {
  it('mounts the reveal overlay only when the applied theme flips, then removes it on animationend', () => {
    const view = render(
      <AppTheme
        theme={ApplicationTheme.Light}
        appearance={DefaultAppearanceCustomization}
      />
    )

    // The first application (mount) must not pulse.
    assert.equal(document.querySelector(revealSelector), null)

    view.rerender(
      <AppTheme
        theme={ApplicationTheme.Dark}
        appearance={DefaultAppearanceCustomization}
      />
    )

    const overlay = document.querySelector<HTMLDivElement>(revealSelector)
    assert.ok(overlay !== null)
    assert.equal(overlay.getAttribute('aria-hidden'), 'true')

    overlay.dispatchEvent(new Event('animationend'))
    assert.equal(document.querySelector(revealSelector), null)
  })

  it('does not mount the reveal overlay under the reduced-motion preference', () => {
    const reduced: IAppearanceCustomization = {
      ...DefaultAppearanceCustomization,
      motion: 'reduced',
    }

    const view = render(
      <AppTheme theme={ApplicationTheme.Light} appearance={reduced} />
    )
    assert.equal(document.body.getAttribute('data-dm-motion'), 'reduced')

    view.rerender(
      <AppTheme theme={ApplicationTheme.Dark} appearance={reduced} />
    )

    // The theme flipped, but reduced motion suppresses the pulse entirely.
    assert.equal(document.querySelector(revealSelector), null)
  })

  it('removes any lingering overlay when the AppTheme unmounts', () => {
    const view = render(
      <AppTheme
        theme={ApplicationTheme.Light}
        appearance={DefaultAppearanceCustomization}
      />
    )
    view.rerender(
      <AppTheme
        theme={ApplicationTheme.Dark}
        appearance={DefaultAppearanceCustomization}
      />
    )
    assert.ok(document.querySelector(revealSelector) !== null)

    view.unmount()
    assert.equal(document.querySelector(revealSelector), null)
  })
})
