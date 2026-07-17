import { describe, it, mock } from 'node:test'
import assert from 'node:assert'
import { Account, getAccountKey } from '../../src/models/account'
import { getDotComAPIEndpoint } from '../../src/lib/api'
import { ErrorWithMetadata } from '../../src/lib/error-with-metadata'
import { RetryActionType } from '../../src/models/retry-actions'

const cloneFailure = new Error('clone failed after account selection')
const attemptedAccountKeys: Array<string | undefined> = []
const attemptedSignals: Array<AbortSignal | undefined> = []
let cloneBehavior: (signal?: AbortSignal) => Promise<void> = async () => {
  throw cloneFailure
}

mock.module('../../src/lib/git', {
  namedExports: {
    clone: async (
      _url: string,
      _path: string,
      _options: unknown,
      _progress: unknown,
      credentialAccountKey?: string,
      signal?: AbortSignal
    ) => {
      attemptedAccountKeys.push(credentialAccountKey)
      attemptedSignals.push(signal)
      await cloneBehavior(signal)
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
    attemptedSignals.length = 0
    cloneBehavior = async () => {
      throw cloneFailure
    }
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

  it('forwards abort ownership without routing an error or retry', async () => {
    const { CloningRepositoriesStore } = await import(
      '../../src/lib/stores/cloning-repositories-store'
    )
    const controller = new AbortController()
    const store = new CloningRepositoriesStore(async () => [])
    let abortCalls = 0
    let errorCalls = 0
    attemptedAccountKeys.length = 0
    attemptedSignals.length = 0
    cloneBehavior = async signal => {
      assert.equal(signal, controller.signal)
      controller.abort()
      const error = new Error('authentication-shaped abort')
      error.name = 'AbortError'
      throw error
    }

    const success = await store.clone(
      'https://github.com/owner/private-repository.git',
      'C:\\clones\\private-repository',
      {},
      {
        signal: controller.signal,
        onAbort: () => {
          abortCalls += 1
        },
        onError: () => {
          errorCalls += 1
        },
      }
    )

    assert.equal(success, false)
    assert.deepStrictEqual(attemptedSignals, [controller.signal])
    assert.deepStrictEqual(attemptedAccountKeys, [undefined])
    assert.equal(abortCalls, 1)
    assert.equal(errorCalls, 0)
    assert.equal(store.repositories.length, 0)
  })
})
