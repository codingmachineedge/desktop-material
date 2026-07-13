import { describe, it } from 'node:test'
import assert from 'node:assert'
import { GitError as DugiteError } from 'dugite'
import { Account, getAccountKey } from '../../src/models/account'
import { getDotComAPIEndpoint } from '../../src/lib/api'
import { GitError, IGitResult } from '../../src/lib/git/core'
import {
  getPullAllFallbackAccountKeys,
  isPullAllHTTPSAuthenticationFailure,
  PullAllFallbackSuccessDetail,
  pullWithAccountFallback,
} from '../../src/lib/automation/pull-all-account-fallback'

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
    ['pull'],
    message
  )

describe('Pull All account fallback', () => {
  it('uses identity-neutral success copy', () => {
    assert.equal(
      PullAllFallbackSuccessDetail,
      'Pull completed using another signed-in account.'
    )
    assert.doesNotMatch(PullAllFallbackSuccessDetail, /user-\d|login|@/i)
  })

  it('orders, deduplicates, and filters fallback accounts', () => {
    const first = account(1)
    const second = account(2)
    const bound = account(3)
    const empty = account(4, getDotComAPIEndpoint(), '')
    const otherHost = account(5, 'https://api.example.com')

    assert.deepStrictEqual(
      getPullAllFallbackAccountKeys(
        'https://github.com/owner/repository.git',
        [first, second, bound, second, empty, otherHost],
        getAccountKey(bound)
      ),
      [getAccountKey(bound), getAccountKey(second)]
    )
  })

  it('excludes the first token-bearing identity rather than a tokenless entry', () => {
    const tokenless = account(1, getDotComAPIEndpoint(), '')
    const firstUsable = account(2)
    const nextUsable = account(3)

    assert.deepStrictEqual(
      getPullAllFallbackAccountKeys(
        'https://github.com/owner/repository.git',
        [tokenless, firstUsable, nextUsable],
        null
      ),
      [getAccountKey(nextUsable)]
    )
  })

  it('does not offer OAuth accounts to SSH or another origin', () => {
    const first = account(1)
    const second = account(2)

    assert.deepStrictEqual(
      getPullAllFallbackAccountKeys(
        'git@github.com:owner/repository.git',
        [first, second],
        getAccountKey(second)
      ),
      []
    )
    assert.deepStrictEqual(
      getPullAllFallbackAccountKeys(
        'https://example.com/owner/repository.git',
        [first, second],
        getAccountKey(second)
      ),
      []
    )
  })

  it('recognizes only HTTPS authentication ambiguity', () => {
    const authentication = gitError(DugiteError.HTTPSAuthenticationFailed)
    const notFound = gitError(DugiteError.HTTPSRepositoryNotFound)
    const ssh = gitError(DugiteError.SSHAuthenticationFailed)

    assert.equal(
      isPullAllHTTPSAuthenticationFailure(
        authentication,
        'https://github.com/owner/repository.git'
      ),
      true
    )
    assert.equal(
      isPullAllHTTPSAuthenticationFailure(
        notFound,
        'https://github.com/owner/repository.git'
      ),
      true
    )
    assert.equal(
      isPullAllHTTPSAuthenticationFailure(
        ssh,
        'https://github.com/owner/repository.git'
      ),
      false
    )
    assert.equal(
      isPullAllHTTPSAuthenticationFailure(
        authentication,
        'git@github.com:owner/repository.git'
      ),
      false
    )
    assert.equal(
      isPullAllHTTPSAuthenticationFailure(
        new Error('network unavailable'),
        'https://github.com/owner/repository.git'
      ),
      false
    )
  })

  it('preserves the unforced first attempt and reports first-attempt success', async () => {
    const attempts: Array<string | undefined> = []
    const result = await pullWithAccountFallback(
      'https://github.com/owner/repository.git',
      [account(1), account(2)],
      null,
      async key => {
        attempts.push(key)
      }
    )

    assert.deepStrictEqual(attempts, [undefined])
    assert.deepStrictEqual(result, { usedFallbackAccount: false })
  })

  it('prefers the bound fallback and succeeds without exposing a login', async () => {
    const first = account(1)
    const second = account(2)
    const bound = account(3)
    const attempts: Array<string | undefined> = []

    const result = await pullWithAccountFallback(
      'https://github.com/owner/repository.git',
      [first, second, bound],
      getAccountKey(bound),
      async key => {
        attempts.push(key)
        if (key === undefined) {
          throw gitError(DugiteError.HTTPSRepositoryNotFound)
        }
      }
    )

    assert.deepStrictEqual(attempts, [undefined, getAccountKey(bound)])
    assert.deepStrictEqual(result, { usedFallbackAccount: true })
  })

  it('exhausts authentication failures in stable order', async () => {
    const first = account(1)
    const second = account(2)
    const third = account(3)
    const attempts: Array<string | undefined> = []
    const finalError = gitError(
      DugiteError.HTTPSAuthenticationFailed,
      'final authentication failure'
    )

    await assert.rejects(
      pullWithAccountFallback(
        'https://github.com/owner/repository.git',
        [first, second, third],
        null,
        async key => {
          attempts.push(key)
          if (key === getAccountKey(third)) {
            throw finalError
          }
          throw gitError(DugiteError.HTTPSAuthenticationFailed)
        }
      ),
      error => error === finalError
    )

    assert.deepStrictEqual(attempts, [
      undefined,
      getAccountKey(second),
      getAccountKey(third),
    ])
  })

  it('stops immediately on a non-authentication failure', async () => {
    const first = account(1)
    const second = account(2)
    const third = account(3)
    const attempts: Array<string | undefined> = []
    const networkError = new Error('network unavailable')

    await assert.rejects(
      pullWithAccountFallback(
        'https://github.com/owner/repository.git',
        [first, second, third],
        null,
        async key => {
          attempts.push(key)
          if (key === undefined) {
            throw gitError(DugiteError.HTTPSAuthenticationFailed)
          }
          throw networkError
        }
      ),
      error => error === networkError
    )

    assert.deepStrictEqual(attempts, [undefined, getAccountKey(second)])
  })

  it('does not unlock fallback accounts for an initial non-auth failure', async () => {
    const attempts: Array<string | undefined> = []
    const networkError = new Error('network unavailable')

    await assert.rejects(
      pullWithAccountFallback(
        'https://github.com/owner/repository.git',
        [account(1), account(2)],
        null,
        async key => {
          attempts.push(key)
          throw networkError
        }
      ),
      error => error === networkError
    )

    assert.deepStrictEqual(attempts, [undefined])
  })

  it('keeps concurrent repository fallback attempts isolated', async () => {
    const first = account(1)
    const second = account(2)
    const third = account(3)
    const attempts = new Map<string, Array<string | undefined>>()

    const run = (name: string, bound: Account) =>
      pullWithAccountFallback(
        'https://github.com/owner/repository.git',
        [first, second, third],
        getAccountKey(bound),
        async key => {
          const current = attempts.get(name) ?? []
          current.push(key)
          attempts.set(name, current)
          await Promise.resolve()
          if (key === undefined) {
            throw gitError(DugiteError.HTTPSAuthenticationFailed)
          }
        }
      )

    await Promise.all([run('second', second), run('third', third)])
    assert.deepStrictEqual(attempts.get('second'), [
      undefined,
      getAccountKey(second),
    ])
    assert.deepStrictEqual(attempts.get('third'), [
      undefined,
      getAccountKey(third),
    ])
  })
})
