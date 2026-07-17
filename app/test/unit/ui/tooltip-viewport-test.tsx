import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import * as React from 'react'

import { createObservableRef } from '../../../src/ui/lib/observable-ref'
import { Tooltip, TooltipDirection } from '../../../src/ui/lib/tooltip'
import { fireEvent, render, screen } from '../../helpers/ui/render'
import {
  advanceTimersBy,
  enableTestTimers,
  resetTestTimers,
} from '../../helpers/ui/timers'

interface ITooltipFixtureProps {
  readonly hosted?: boolean
}

class TooltipFixture extends React.Component<ITooltipFixtureProps> {
  private readonly target = createObservableRef<HTMLButtonElement>()

  public render() {
    const content = (
      <>
        <button ref={this.target} type="button">
          GraphQL
        </button>
        <Tooltip target={this.target} direction={TooltipDirection.SOUTH}>
          GraphQL
        </Tooltip>
      </>
    )

    return this.props.hosted ? (
      <div className="tooltip-host">{content}</div>
    ) : (
      content
    )
  }
}

describe('tooltip viewport containment', () => {
  it('dismisses stale body and host portals after the viewport changes', t => {
    enableTestTimers(['setTimeout'])
    t.after(resetTestTimers)

    for (const hosted of [false, true]) {
      const view = render(<TooltipFixture hosted={hosted} />)
      const target = screen.getByRole('button', { name: 'GraphQL' })
      target.getBoundingClientRect = () => new DOMRect(800, 80, 50, 24)

      fireEvent.mouseEnter(target, { clientX: 800, clientY: 80 })
      advanceTimersBy(400)

      const tooltip = screen.getByRole('tooltip', { hidden: true })
      assert.equal(
        tooltip.parentElement,
        hosted ? target.parentElement : document.body
      )

      fireEvent(window, new Event('resize'))

      assert.equal(screen.queryByRole('tooltip', { hidden: true }), null)
      view.unmount()
    }
  })

  it('keeps body portals fixed and every tooltip bounded by the viewport', () => {
    const styles = readFileSync(
      join(process.cwd(), 'app', 'styles', 'ui', 'window', '_tooltips.scss'),
      'utf8'
    )

    assert.match(styles, /body > \.tooltip\s*\{\s*position:\s*fixed/)
    assert.match(
      styles,
      /\.tooltip-host > \.tooltip\s*\{\s*position:\s*absolute/
    )
    assert.match(styles, /max-width:\s*min\(/)
    assert.match(styles, /calc\(100vw - var\(--spacing-double\)\)/)
    assert.match(styles, /max-height:\s*min\(/)
    assert.match(styles, /calc\(100vh - var\(--spacing-double\)\)/)
  })
})
