import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import '../../helpers/ui/setup'
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { AgentAccess } from '../../../src/ui/preferences/agent-access'

describe('Agent access preferences', () => {
  it('exposes status and read-only connection fields accessibly', () => {
    const markup = renderToStaticMarkup(<AgentAccess />)

    assert.match(markup, /role="status"/)
    assert.match(markup, /aria-live="polite"/)
    assert.match(markup, /role="textbox"/)
    assert.match(markup, /aria-readonly="true"/)
    assert.match(markup, /aria-pressed="false"/)
  })
})
