import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'

import {
  DefaultErrorPresentationStyle,
  ErrorPresentationStyle,
  ErrorPresentationStyleKey,
  getErrorPresentationStyle,
  setErrorPresentationStyle,
} from '../../src/models/error-presentation'

describe('error presentation preference', () => {
  beforeEach(() => localStorage.removeItem(ErrorPresentationStyleKey))
  afterEach(() => localStorage.removeItem(ErrorPresentationStyleKey))

  it('defaults missing or invalid values to a bottom-right notice', () => {
    assert.equal(DefaultErrorPresentationStyle, ErrorPresentationStyle.Notice)
    assert.equal(getErrorPresentationStyle(), ErrorPresentationStyle.Notice)

    localStorage.setItem(ErrorPresentationStyleKey, 'toast-but-not-valid')
    assert.equal(getErrorPresentationStyle(), ErrorPresentationStyle.Notice)
  })

  it('persists and restores either supported presentation style', () => {
    setErrorPresentationStyle(ErrorPresentationStyle.Dialog)
    assert.equal(
      localStorage.getItem(ErrorPresentationStyleKey),
      ErrorPresentationStyle.Dialog
    )
    assert.equal(getErrorPresentationStyle(), ErrorPresentationStyle.Dialog)

    setErrorPresentationStyle(ErrorPresentationStyle.Notice)
    assert.equal(
      localStorage.getItem(ErrorPresentationStyleKey),
      ErrorPresentationStyle.Notice
    )
    assert.equal(getErrorPresentationStyle(), ErrorPresentationStyle.Notice)
  })
})
