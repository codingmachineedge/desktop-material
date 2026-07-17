import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  createChildProcessFailureError,
  createRendererFailureError,
  isFatalRendererLoadFailure,
  normalizeUnhandledRejection,
} from '../../../src/main-process/renderer-failure'

describe('renderer failure containment', () => {
  it('ignores intentional and subframe navigation failures', () => {
    assert.equal(isFatalRendererLoadFailure(-3, true), false)
    assert.equal(isFatalRendererLoadFailure(-105, false), false)
    assert.equal(isFatalRendererLoadFailure(-105, true), true)
  })

  it('produces bounded process-gone diagnostics', () => {
    const error = createRendererFailureError('primary', {
      kind: 'process-gone',
      reason: 'oom',
      exitCode: 137,
    })
    assert.match(error.message, /primary/)
    assert.match(error.message, /oom/)
    assert.match(error.message, /137/)
  })

  it('describes a sustained renderer hang without claiming a process exit', () => {
    const error = createRendererFailureError('primary', {
      kind: 'unresponsive',
      unresponsiveForMilliseconds: 15_000,
    })
    assert.match(error.message, /remained unresponsive/)
    assert.match(error.message, /15000ms/)
  })

  it('bounds application page and zoom setup failures', () => {
    assert.match(
      createRendererFailureError('primary', {
        kind: 'setup-failed',
        stage: 'load-url',
      }).message,
      /failed to load its application page/
    )
    assert.match(
      createRendererFailureError('secondary-1', {
        kind: 'setup-failed',
        stage: 'zoom-limits',
      }).message,
      /failed to lock zoom/
    )
  })

  it('does not copy malformed load URLs into crash diagnostics', () => {
    const secret = 'github_pat_secret-value-that-must-not-be-logged'
    const error = createRendererFailureError('secondary-1', {
      kind: 'load-failed',
      errorCode: -105,
      errorDescription: `unsafe ${secret}`,
      validatedURL: `not a url ${secret}`,
    })
    assert.doesNotMatch(error.message, new RegExp(secret))
    assert.match(error.message, /ERR_LOAD_FAILED/)
  })

  it('retains a bounded native network error name', () => {
    const error = createRendererFailureError('primary', {
      kind: 'load-failed',
      errorCode: -105,
      errorDescription: 'ERR_NAME_NOT_RESOLVED',
      validatedURL: 'file:///app/index.html',
    })
    assert.match(error.message, /ERR_NAME_NOT_RESOLVED/)
  })

  it('normalizes non-Error promise rejections without serializing objects', () => {
    const existing = new Error('existing')
    assert.equal(normalizeUnhandledRejection(existing), existing)
    assert.doesNotMatch(
      normalizeUnhandledRejection('secret string').message,
      /secret/
    )
    assert.match(
      normalizeUnhandledRejection({ token: 'secret' }).message,
      /without an Error/
    )
  })

  it('keeps child-process diagnostics bounded to native process metadata', () => {
    const error = createChildProcessFailureError({
      type: 'GPU',
      reason: 'crashed',
      exitCode: 9,
    })
    assert.match(error.message, /GPU/)
    assert.match(error.message, /crashed/)
    assert.match(error.message, /9/)
  })
})
