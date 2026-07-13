import { describe, it, mock } from 'node:test'
import assert from 'node:assert'
import { Account, getAccountKey } from '../../src/models/account'
import { getDotComAPIEndpoint } from '../../src/lib/api'
import { ErrorWithMetadata } from '../../src/lib/error-with-metadata'
import { RetryActionType } from '../../src/models/retry-actions'

const cloneFailure = new Error('clone failed after account selection')
const attemptedAccountKeys: Array<string | undefined> = []

mock.module('../../src/lib/git', {
  namedExports: {
    clone: async (
      _url: string,
      _path: string,
      _options: unknown,
      _progress: unknown,
      credentialAccountKey?: string
    ) => {
      attemptedAccountKeys.push(credentialAccountKey)
      throw cloneFailure
    },
  },
})

describe('CloningRepositoriesStore account binding', () => {
  it('keeps the selected identity in retry metadata without exposing its token', async () => {
    const selected = new Account(
      'selected-login',
      getDotComAPIEndpoint(),
      'selected-secret-token',
      [],
      '',
      42,
      '',
      'free'
    )
    const selectedAccountKey = getAccountKey(selected)
    const { CloningRepositoriesStore } = await import(
      '../../src/lib/stores/cloning-repositories-store'
    )
    const store = new CloningRepositoriesStore(async () => [selected])
    let emittedError: Error | undefined
    store.onDidError(error => {
      emittedError = error
    })

    attemptedAccountKeys.length = 0
    const success = await store.clone(
      'https://github.com/owner/private-repository.git',
      'C:\\clones\\private-repository',
      {
        branch: 'feature',
        defaultBranch: 'main',
        accountKey: selectedAccountKey,
      }
    )

    assert.equal(success, false)
    assert.deepStrictEqual(attemptedAccountKeys, [selectedAccountKey])
    assert(emittedError instanceof ErrorWithMetadata)
    const retryAction = emittedError.metadata.retryAction
    assert.equal(retryAction?.type, RetryActionType.Clone)
    assert.equal(
      retryAction?.type === RetryActionType.Clone
        ? retryAction.options.accountKey
        : undefined,
      selectedAccountKey
    )
    assert.equal(
      retryAction?.type === RetryActionType.Clone
        ? retryAction.options.branch
        : undefined,
      'feature'
    )
    assert.equal(
      retryAction?.type === RetryActionType.Clone
        ? retryAction.options.defaultBranch
        : undefined,
      'main'
    )
    assert.doesNotMatch(emittedError.message, /selected-secret-token/)
    assert.equal(store.repositories.length, 0)
  })
})
