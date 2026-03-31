import assert from 'node:assert'
import { describe, it } from 'node:test'

import { parseCopilotPaymentRequiredError } from '../../src/lib/copilot-error'

describe('parseCopilotPaymentRequiredError', () => {
  it('parses quota_exceeded responses', () => {
    const error = parseCopilotPaymentRequiredError(
      JSON.stringify({
        error: {
          code: 'quota_exceeded',
          message: 'You have used all available Copilot premium requests.',
        },
      }),
      '120'
    )

    assert.equal(
      error.message,
      'You have used all available Copilot premium requests.'
    )
    assert.equal(error.code, 'quota_exceeded')
    assert.equal(error.retryAfter, '120')
  })

  it('parses session_quota_exceeded responses', () => {
    const error = parseCopilotPaymentRequiredError(
      JSON.stringify({
        error: {
          code: 'session_quota_exceeded',
          message: 'You have reached the session limit for Copilot requests.',
        },
      }),
      null
    )

    assert.equal(
      error.message,
      'You have reached the session limit for Copilot requests.'
    )
    assert.equal(error.code, 'session_quota_exceeded')
    assert.equal(error.retryAfter, undefined)
  })

  it('parses billing_not_configured responses', () => {
    const error = parseCopilotPaymentRequiredError(
      JSON.stringify({
        error: {
          code: 'billing_not_configured',
          message: 'Configure billing in GitHub Settings to continue.',
        },
      }),
      null
    )

    assert.equal(
      error.message,
      'Configure billing in GitHub Settings to continue.'
    )
    assert.equal(error.code, 'billing_not_configured')
  })

  it('falls back to the raw response body when the server returns plain text', () => {
    const error = parseCopilotPaymentRequiredError(
      'You have reached your quota limit.',
      null
    )

    assert.equal(error.message, 'You have reached your quota limit.')
    assert.equal(error.code, undefined)
  })
})