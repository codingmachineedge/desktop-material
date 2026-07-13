import { describe, it } from 'node:test'
import assert from 'node:assert'
import { GitError as DugiteError } from 'dugite'
import { Account, getAccountKey } from '../../src/models/account'
import { getDotComAPIEndpoint } from '../../src/lib/api'
import { GitError, IGitResult } from '../../src/lib/git/core'
import { fetchShallowHistoryWithAccountFallback } from '../../src/lib/automation/shallow-history-account-fallback'

const account = (id: number) =>
  new Account(
    `proof-${id}`,
    getDotComAPIEndpoint(),
    `token-${id}`,
    [],
    '',
    id,
    '',
    'free'
  )

const authenticationError = (kind: DugiteError) =>
  new GitError(
    {
      exitCode: 128,
      stdout: '',
      stderr: 'Authentication failed.',
      gitError: kind,
      gitErrorDescription: 'Authentication failed.',
      path: 'C:\\repository',
    } as IGitResult,
    ['fetch', '--deepen=50', '--', 'origin'],
    'Authentication failed.'
  )

describe('shallow-history account fallback', () => {
  it('retries an authentication ambiguity with the repository-bound account', async () => {
    const first = account(1)
    const second = account(2)
    const attempts: Array<string | undefined> = []

    const result = await fetchShallowHistoryWithAccountFallback(
      'https://github.com/material/proof.git',
      [first, second],
      getAccountKey(second),
      async accountKey => {
        attempts.push(accountKey)
        if (accountKey === undefined) {
          throw authenticationError(DugiteError.HTTPSRepositoryNotFound)
        }
      }
    )

    assert.deepStrictEqual(attempts, [undefined, getAccountKey(second)])
    assert.deepStrictEqual(result, { usedFallbackAccount: true })
    assert.equal(
      attempts.some(value => value?.includes(first.token) === true),
      false
    )
    assert.equal(
      attempts.some(value => value?.includes(second.token) === true),
      false
    )
  })

  it('keeps a generic or accountless remote on the normal unforced path', async () => {
    const attempts: Array<string | undefined> = []

    const result = await fetchShallowHistoryWithAccountFallback(
      'https://git.example.test/material/proof.git',
      [],
      null,
      async accountKey => {
        attempts.push(accountKey)
      }
    )

    assert.deepStrictEqual(attempts, [undefined])
    assert.deepStrictEqual(result, { usedFallbackAccount: false })
  })

  it('does not invent an account retry when no eligible account exists', async () => {
    const error = authenticationError(DugiteError.HTTPSAuthenticationFailed)
    const attempts: Array<string | undefined> = []

    await assert.rejects(
      fetchShallowHistoryWithAccountFallback(
        'https://git.example.test/material/proof.git',
        [],
        null,
        async accountKey => {
          attempts.push(accountKey)
          throw error
        }
      ),
      candidate => candidate === error
    )
    assert.deepStrictEqual(attempts, [undefined])
  })
})
