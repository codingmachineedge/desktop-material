import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Account, getAccountKey } from '../../src/models/account'
import { getDotComAPIEndpoint } from '../../src/lib/api'
import { AccountsStore } from '../../src/lib/stores'
import { findGitHubTrampolineAccount } from '../../src/lib/trampoline/find-account'
import { createCredentialHelperTrampolineHandler } from '../../src/lib/trampoline/trampoline-credential-helper'
import { TrampolineCommandIdentifier } from '../../src/lib/trampoline/trampoline-command'
import {
  getForcedAccountKey,
  withTrampolineEnv,
} from '../../src/lib/trampoline/trampoline-environment'

const first = new Account(
  'first-login',
  getDotComAPIEndpoint(),
  'first-token',
  [],
  '',
  1,
  '',
  'free'
)
const second = new Account(
  'second-login',
  getDotComAPIEndpoint(),
  'second-token',
  [],
  '',
  2,
  '',
  'free'
)
const otherOrigin = new Account(
  'other-login',
  'https://api.example.com',
  'other-token',
  [],
  '',
  3,
  '',
  'free'
)

const store = {
  getAll: async () => [first, second, otherOrigin],
} as unknown as AccountsStore

describe('trampoline forced account', () => {
  it('selects the forced account and rejects a wrong-origin selector', async () => {
    assert.equal(
      await findGitHubTrampolineAccount(
        store,
        'https://github.com/owner/repository.git',
        getAccountKey(second)
      ),
      second
    )
    assert.equal(
      await findGitHubTrampolineAccount(
        store,
        'https://github.com/owner/repository.git',
        getAccountKey(otherOrigin)
      ),
      undefined
    )
  })

  it('routes the stable selector without putting a token in the environment', async () => {
    const handler = createCredentialHelperTrampolineHandler(store)

    await withTrampolineEnv(
      async trampolineEnv => {
        const token = (trampolineEnv as Record<string, string>)[
          'DESKTOP_TRAMPOLINE_TOKEN'
        ]
        assert.equal(
          Object.values(trampolineEnv as Record<string, string>).includes(
            second.token
          ),
          false
        )
        assert.equal(
          Object.values(trampolineEnv as Record<string, string>).includes(
            getAccountKey(second)
          ),
          false
        )
        const response = await handler({
          identifier: TrampolineCommandIdentifier.CredentialHelper,
          trampolineToken: token,
          parameters: ['get'],
          environmentVariables: new Map(),
          stdin: 'protocol=https\nhost=github.com\n',
        })

        assert.match(response ?? '', /^username=second-login$/m)
        assert.match(response ?? '', /^password=second-token$/m)
      },
      process.cwd(),
      false,
      undefined,
      getAccountKey(second)
    )
  })

  it('isolates concurrent token selectors and cleans them in finally', async () => {
    const observedTokens: string[] = []
    const run = (key: string) =>
      withTrampolineEnv(
        async trampolineEnv => {
          const token = (trampolineEnv as Record<string, string>)[
            'DESKTOP_TRAMPOLINE_TOKEN'
          ]
          observedTokens.push(token)
          await Promise.resolve()
          assert.equal(getForcedAccountKey(token), key)
        },
        process.cwd(),
        false,
        undefined,
        key
      )

    await Promise.all([run(getAccountKey(first)), run(getAccountKey(second))])

    assert.equal(new Set(observedTokens).size, 2)
    for (const token of observedTokens) {
      assert.equal(getForcedAccountKey(token), undefined)
    }
  })

  it('cleans the selector when the Git operation throws', async () => {
    let observedToken = ''
    const failure = new Error('pull failed')

    await assert.rejects(
      withTrampolineEnv(
        async trampolineEnv => {
          observedToken = (trampolineEnv as Record<string, string>)[
            'DESKTOP_TRAMPOLINE_TOKEN'
          ]
          throw failure
        },
        process.cwd(),
        false,
        undefined,
        getAccountKey(second)
      ),
      error => error === failure
    )

    assert.notEqual(observedToken, '')
    assert.equal(getForcedAccountKey(observedToken), undefined)
  })
})
