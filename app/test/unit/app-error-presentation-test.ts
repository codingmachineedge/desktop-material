import assert from 'node:assert'
import { describe, it } from 'node:test'
import { GitError as DugiteError } from 'dugite'

import {
  getAppErrorPresentation,
  getUnderlyingAppError,
  shouldPresentErrorAsNotice,
} from '../../src/lib/app-error-presentation'
import { parseCopilotPaymentRequiredError } from '../../src/lib/copilot-error'
import { ErrorWithMetadata } from '../../src/lib/error-with-metadata'
import { GitError, IGitResult } from '../../src/lib/git/core'
import { ErrorPresentationStyle } from '../../src/models/error-presentation'
import { RetryActionType } from '../../src/models/retry-actions'

const gitError = (
  kind: DugiteError,
  description: string,
  stderr: string = description
) =>
  new GitError(
    {
      exitCode: 128,
      stdout: '',
      stderr,
      gitError: kind,
      gitErrorDescription: description,
      path: 'C:\\repository',
    } as IGitResult,
    ['push'],
    stderr
  )

describe('app error presentation', () => {
  it('routes a plain acknowledgement-only error to the default notice style', () => {
    const error = new Error('The operation could not be completed.')

    assert.deepEqual(getAppErrorPresentation(error), {
      title: 'Error',
      message: 'The operation could not be completed.',
      details: null,
      requiresInteraction: false,
    })
    assert.equal(getUnderlyingAppError(error), error)
    assert.equal(
      shouldPresentErrorAsNotice(error, ErrorPresentationStyle.Notice),
      true
    )
    assert.equal(
      shouldPresentErrorAsNotice(error, ErrorPresentationStyle.Dialog),
      false
    )
  })

  it('keeps clone retry errors interactive', () => {
    const underlying = new Error('The connection ended during clone.')
    const error = new ErrorWithMetadata(underlying, {
      retryAction: {
        type: RetryActionType.Clone,
        name: 'desktop-material',
        url: 'https://github.com/example/desktop-material.git',
        path: 'C:\\repositories\\desktop-material',
        options: {},
      },
    })

    const presentation = getAppErrorPresentation(error)
    assert.equal(getUnderlyingAppError(error), underlying)
    assert.equal(presentation.title, 'Clone failed')
    assert.equal(presentation.message, underlying.message)
    assert.equal(presentation.requiresInteraction, true)
    assert.equal(
      shouldPresentErrorAsNotice(error, ErrorPresentationStyle.Notice),
      false
    )
  })

  it('keeps authentication errors interactive', () => {
    const error = gitError(
      DugiteError.HTTPSAuthenticationFailed,
      'Authentication failed'
    )

    const presentation = getAppErrorPresentation(error)
    assert.equal(presentation.title, 'Error')
    assert.equal(presentation.message, 'Authentication failed')
    assert.equal(presentation.requiresInteraction, true)
    assert.equal(
      shouldPresentErrorAsNotice(error, ErrorPresentationStyle.Notice),
      false
    )
  })

  it('keeps large-file Git remediation in its dialog and preserves diagnostics', () => {
    const error = gitError(
      DugiteError.PushWithFileSizeExceedingLimit,
      'The push contains a file larger than GitHub allows.',
      'remote: assets/archive.bin is 140 MB and exceeds the file size limit'
    )

    const presentation = getAppErrorPresentation(error)
    assert.equal(presentation.title, 'File size limit exceeded')
    assert.equal(
      presentation.message,
      'The push contains a file larger than GitHub allows.'
    )
    assert.match(presentation.details ?? '', /assets\/archive\.bin/)
    assert.equal(presentation.requiresInteraction, true)
    assert.equal(
      shouldPresentErrorAsNotice(error, ErrorPresentationStyle.Notice),
      false
    )
  })

  it('keeps an actionable Copilot billing error interactive', () => {
    const error = parseCopilotPaymentRequiredError(
      JSON.stringify({
        error: {
          code: 'billing_not_configured',
          message: 'Configure billing in GitHub Settings to continue.',
        },
      }),
      null
    )

    const presentation = getAppErrorPresentation(error)
    assert.equal(presentation.title, 'Copilot billing not configured')
    assert.equal(
      presentation.message,
      'Configure billing in GitHub Settings to continue.'
    )
    assert.equal(presentation.requiresInteraction, true)
    assert.equal(
      shouldPresentErrorAsNotice(error, ErrorPresentationStyle.Notice),
      false
    )
  })
})
