import { describe, it } from 'node:test'
import assert from 'node:assert'
import { GitError as DugiteError } from 'dugite'
import { Account, getAccountKey } from '../../src/models/account'
import { getDotComAPIEndpoint } from '../../src/lib/api'
import { GitError, IGitResult } from '../../src/lib/git/core'
import {
  cloneWithAccountFallback,
  getCloneAccountKeys,
  getPreferredGenericCloneAccountKey,
} from '../../src/lib/automation/clone-account-fallback'

const account = (
  id: number,
  endpoint = getDotComAPIEndpoint(),
  token = `token-${id}`
) => new Account(`user-${id}`, endpoint, token, [], '', id, '', 'free')

const gitError = (kind: DugiteError, message = `${kind}`) =>
  new GitError(
    {
      exitCode: 128,
      stdout: '',
      stderr: message,
      gitError: kind,
      gitErrorDescription: message,
      path: 'C:\\repository',
    } as IGitResult,
    ['clone'],
    message
  )

describe('clone account fallback', () => {
  it('filters account keys to token-bearing identities on the exact HTTPS origin', () => {
    const first = account(1)
    const second = account(2)

    assert.deepStrictEqual(
      getCloneAccountKeys('https://github.com/owner/repository.git', [
        first,
        second,
        second,
        account(3, getDotComAPIEndpoint(), ''),
        account(4, 'https://api.example.com'),
      ]),
      [getAccountKey(first), getAccountKey(second)]
    )
    assert.deepStrictEqual(
      getCloneAccountKeys('git@github.com:owner/repository.git', [
        first,
        second,
      ]),
      []
    )
    for (const remoteUrl of [
      'http://github.com/owner/repository.git',
      'https://github.com:8443/owner/repository.git',
      'https://github.com.evil.example/owner/repository.git',
    ]) {
      assert.deepStrictEqual(
        getCloneAccountKeys(remoteUrl, [first, second]),
        []
      )
    }
  })

  it('prefers the API-matched identity for a generic exact-origin clone', () => {
    const first = account(1, 'https://127.0.0.1:38443/api/v3')
    const matched = account(2, 'https://127.0.0.1:38443/api/v3')

    assert.equal(
      getPreferredGenericCloneAccountKey(
        'https://127.0.0.1:38443/owner/private-repository.git',
        [first, matched],
        matched
      ),
      getAccountKey(matched)
    )
  })

  it('keeps generic clone selection non-interactive when lookup is inconclusive', () => {
    const first = account(1, 'https://127.0.0.1:38443/api/v3')
    const second = account(2, 'https://127.0.0.1:38443/api/v3')

    assert.equal(
      getPreferredGenericCloneAccountKey(
        'https://127.0.0.1:38443/owner/private-repository.git',
        [first, second],
        null
      ),
      getAccountKey(first)
    )
  })

  it('never selects a generic clone identity outside the exact HTTPS origin', () => {
    const signedIn = account(1)

    for (const remoteUrl of [
      'http://github.com/owner/repository.git',
      'https://github.com:8443/owner/repository.git',
      'https://github.com.evil.example/owner/repository.git',
      'git@github.com:owner/repository.git',
    ]) {
      assert.equal(
        getPreferredGenericCloneAccountKey(remoteUrl, [signedIn], signedIn),
        undefined
      )
    }
  })

  it('keeps a successful first attempt unforced and does not load accounts', async () => {
    const attempts: Array<string | undefined> = []
    let accountLoads = 0

    const result = await cloneWithAccountFallback(
      'https://github.com/owner/repository.git',
      async () => {
        accountLoads++
        return [account(1), account(2)]
      },
      null,
      async key => {
        attempts.push(key)
      }
    )

    assert.deepStrictEqual(attempts, [undefined])
    assert.equal(accountLoads, 0)
    assert.deepStrictEqual(result, { accountKey: null })
  })

  it('tries the selected identity first, then all remaining accounts in stable order', async () => {
    const first = account(1)
    const second = account(2)
    const selected = account(3)
    const empty = account(4, getDotComAPIEndpoint(), '')
    const otherOrigin = account(5, 'https://api.example.com')
    const attempts: Array<string | undefined> = []

    const result = await cloneWithAccountFallback(
      'https://github.com/owner/private-repository.git',
      async () => [first, second, second, selected, empty, otherOrigin],
      getAccountKey(selected),
      async key => {
        attempts.push(key)
        if (key !== getAccountKey(second)) {
          throw gitError(DugiteError.HTTPSRepositoryNotFound)
        }
      }
    )

    assert.deepStrictEqual(attempts, [
      getAccountKey(selected),
      getAccountKey(first),
      getAccountKey(second),
    ])
    assert.deepStrictEqual(result, { accountKey: getAccountKey(second) })
  })

  it('does not retry SSH or an initial non-authentication failure', async () => {
    const signedIn = [account(1), account(2)]
    const sshAttempts: Array<string | undefined> = []
    const sshFailure = gitError(DugiteError.SSHAuthenticationFailed)

    await assert.rejects(
      cloneWithAccountFallback(
        'git@github.com:owner/private-repository.git',
        async () => signedIn,
        null,
        async key => {
          sshAttempts.push(key)
          throw sshFailure
        }
      ),
      error => error === sshFailure
    )
    assert.deepStrictEqual(sshAttempts, [undefined])

    const networkAttempts: Array<string | undefined> = []
    const networkFailure = new Error('network unavailable')
    await assert.rejects(
      cloneWithAccountFallback(
        'https://github.com/owner/private-repository.git',
        async () => signedIn,
        null,
        async key => {
          networkAttempts.push(key)
          throw networkFailure
        }
      ),
      error => error === networkFailure
    )
    assert.deepStrictEqual(networkAttempts, [undefined])
  })

  it('stops fallback immediately when a retry returns a non-auth error', async () => {
    const second = account(2)
    const attempts: Array<string | undefined> = []
    const networkFailure = new Error('network unavailable')

    await assert.rejects(
      cloneWithAccountFallback(
        'https://github.com/owner/private-repository.git',
        async () => [account(1), second, account(3)],
        null,
        async key => {
          attempts.push(key)
          if (key === undefined) {
            throw gitError(DugiteError.HTTPSAuthenticationFailed)
          }
          throw networkFailure
        }
      ),
      error => error === networkFailure
    )

    assert.deepStrictEqual(attempts, [undefined, getAccountKey(second)])
  })

  it('returns the final authentication ambiguity after exhausting accounts', async () => {
    const first = account(1)
    const second = account(2)
    const finalFailure = gitError(
      DugiteError.HTTPSRepositoryNotFound,
      'final repository-not-found ambiguity'
    )

    await assert.rejects(
      cloneWithAccountFallback(
        'https://github.com/owner/private-repository.git',
        async () => [first, second],
        null,
        async key => {
          if (key === getAccountKey(second)) {
            throw finalFailure
          }
          throw gitError(DugiteError.HTTPSAuthenticationFailed)
        }
      ),
      error => error === finalFailure
    )
  })
})
