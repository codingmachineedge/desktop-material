import assert from 'node:assert'
import { describe, it } from 'node:test'
import { GitError as DugiteError } from 'dugite'

import { ExternalEditorError } from '../../src/lib/editors/shared'
import { ErrorWithMetadata } from '../../src/lib/error-with-metadata'
import { GitError, IGitResult } from '../../src/lib/git/core'
import { Popup } from '../../src/models/popup'
import { Repository } from '../../src/models/repository'
import { RetryActionType } from '../../src/models/retry-actions'
import { StashedChangesLoadStates } from '../../src/models/stash-entry'
import { Dispatcher } from '../../src/ui/dispatcher'
import {
  externalEditorErrorHandler,
  localChangesOverwrittenHandler,
} from '../../src/ui/dispatcher/error-handlers'

function dispatcherRecorder() {
  const errors = new Array<Error>()
  const popups = new Array<Popup>()
  const dispatcher = {
    presentError: async (error: Error) => {
      errors.push(error)
    },
    showPopup: async (popup: Popup) => {
      popups.push(popup)
    },
    incrementMetric: () => undefined,
  } as unknown as Dispatcher

  return { dispatcher, errors, popups }
}

describe('acknowledgement-only error routing', () => {
  it('sends an external-editor failure without remediation through the configured presentation', async () => {
    const { dispatcher, errors, popups } = dispatcherRecorder()

    const result = await externalEditorErrorHandler(
      new ExternalEditorError('The editor process ended unexpectedly.'),
      dispatcher
    )

    assert.equal(result, null)
    assert.equal(errors.length, 1)
    assert.equal(errors[0].message, 'The editor process ended unexpectedly.')
    assert.deepEqual(popups, [])
  })

  it('keeps an external-editor remediation choice as a dialog', async () => {
    const { dispatcher, errors, popups } = dispatcherRecorder()

    await externalEditorErrorHandler(
      new ExternalEditorError('Choose another editor.', {
        openPreferences: true,
      }),
      dispatcher
    )

    assert.deepEqual(errors, [])
    assert.equal(popups.length, 1)
    assert.equal(popups[0].type, 'ExternalEditorFailed')
  })

  it('routes a non-actionable stash-pop overwrite through the configured presentation', async () => {
    const { dispatcher, errors, popups } = dispatcherRecorder()
    const repository = new Repository('C:\\repo', 1, null, false)
    const stderr = [
      'error: Your local changes to the following files would be overwritten:',
      '\tREADME.md',
      'Please commit your changes.',
    ].join('\n')
    const gitError = new GitError(
      {
        exitCode: 1,
        stdout: '',
        stderr,
        gitError: DugiteError.LocalChangesOverwritten,
        gitErrorDescription: 'Local changes would be overwritten.',
        path: repository.path,
      } as IGitResult,
      ['stash', 'pop'],
      stderr
    )
    const error = new ErrorWithMetadata(gitError, {
      repository,
      retryAction: {
        type: RetryActionType.PopStash,
        repository,
        stashEntry: {
          name: 'refs/stash@{0}',
          branchName: 'main',
          stashSha: 'a'.repeat(40),
          files: { kind: StashedChangesLoadStates.NotLoaded },
          tree: 'b'.repeat(40),
          parents: [],
        },
      },
    })

    const result = await localChangesOverwrittenHandler(error, dispatcher)

    assert.equal(result, null)
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /restore stashed changes/)
    assert.match(errors[0].message, /README\.md/)
    assert.deepEqual(popups, [])
  })
})
