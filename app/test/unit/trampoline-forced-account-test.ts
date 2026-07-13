import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Account, getAccountKey } from '../../src/models/account'
import { getDotComAPIEndpoint } from '../../src/lib/api'
import { AccountsStore } from '../../src/lib/stores'
import {
  findGitHubTrampolineAccount,
  getForcedAccountScope,
} from '../../src/lib/trampoline/find-account'
import { createCredentialHelperTrampolineHandler } from '../../src/lib/trampoline/trampoline-credential-helper'
import { TrampolineCommandIdentifier } from '../../src/lib/trampoline/trampoline-command'
import {
  getHasRejectedCredentialsForEndpoint,
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
  'https://example.com/api',
  'other-token',
  [],
  '',
  3,
  '',
  'free'
)
const tokenless = new Account(
  'tokenless-login',
  getDotComAPIEndpoint(),
  '',
  [],
  '',
  4,
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

  it('skips tokenless accounts without weakening a forced selector', async () => {
    const tokenAwareStore = {
      getAll: async () => [tokenless, second],
    } as unknown as AccountsStore

    assert.equal(
      await findGitHubTrampolineAccount(
        tokenAwareStore,
        'https://github.com/owner/repository.git'
      ),
      second
    )
    assert.equal(
      await findGitHubTrampolineAccount(
        tokenAwareStore,
        'https://github.com/owner/repository.git',
        getAccountKey(tokenless)
      ),
      undefined
    )

    const handler = createCredentialHelperTrampolineHandler(tokenAwareStore)
    await withTrampolineEnv(
      async trampolineEnv => {
        const trampolineToken = (trampolineEnv as Record<string, string>)[
          'DESKTOP_TRAMPOLINE_TOKEN'
        ]
        const response = await handler({
          identifier: TrampolineCommandIdentifier.CredentialHelper,
          trampolineToken,
          parameters: ['get'],
          environmentVariables: new Map(),
          stdin: 'protocol=https\nhost=github.com\n',
        })

        assert.equal(response, undefined)
      },
      process.cwd(),
      false,
      undefined,
      getAccountKey(tokenless)
    )
  })

  it('scopes a selector to its origin and fails closed when it disappears', async () => {
    assert.equal(
      await getForcedAccountScope(
        store,
        'https://github.com/owner/repository.git',
        getAccountKey(second)
      ),
      'matching-origin'
    )
    assert.equal(
      await getForcedAccountScope(
        store,
        'https://example.com/owner/submodule.git',
        getAccountKey(second)
      ),
      'different-origin'
    )
    assert.equal(
      await getForcedAccountScope(
        store,
        'https://github.com/owner/repository.git',
        'signed-out-account'
      ),
      'missing'
    )
  })

  it('does not extend a selector to a lookalike host, another scheme, or a non-default port', async () => {
    for (const remoteUrl of [
      'https://github.com.evil.example/owner/repository.git',
      'http://github.com/owner/repository.git',
      'https://github.com:8443/owner/repository.git',
    ]) {
      assert.equal(
        await getForcedAccountScope(store, remoteUrl, getAccountKey(second)),
        'different-origin'
      )
    }

    assert.equal(
      await getForcedAccountScope(
        store,
        'https://github.com:443/owner/repository.git',
        getAccountKey(second)
      ),
      'matching-origin'
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

  it('keeps the selected identity authoritative over a username-bearing clone URL', async () => {
    const handler = createCredentialHelperTrampolineHandler(store)

    await withTrampolineEnv(
      async trampolineEnv => {
        const token = (trampolineEnv as Record<string, string>)[
          'DESKTOP_TRAMPOLINE_TOKEN'
        ]
        const response = await handler({
          identifier: TrampolineCommandIdentifier.CredentialHelper,
          trampolineToken: token,
          parameters: ['get'],
          environmentVariables: new Map(),
          stdin:
            'protocol=https\nhost=github.com\nusername=wrong-login\npath=owner/repository.git\n',
        })

        assert.match(response ?? '', /^username=second-login$/m)
        assert.match(response ?? '', /^password=second-token$/m)
        assert.doesNotMatch(response ?? '', /wrong-login/)
      },
      process.cwd(),
      false,
      undefined,
      getAccountKey(second)
    )
  })

  it('keeps normal credentials for a cross-origin submodule', async () => {
    const handler = createCredentialHelperTrampolineHandler(store)

    await withTrampolineEnv(
      async trampolineEnv => {
        const token = (trampolineEnv as Record<string, string>)[
          'DESKTOP_TRAMPOLINE_TOKEN'
        ]
        const response = await handler({
          identifier: TrampolineCommandIdentifier.CredentialHelper,
          trampolineToken: token,
          parameters: ['get'],
          environmentVariables: new Map(),
          stdin: 'protocol=https\nhost=example.com\npath=owner/submodule.git\n',
        })

        assert.match(response ?? '', /^username=other-login$/m)
        assert.match(response ?? '', /^password=other-token$/m)
      },
      process.cwd(),
      false,
      undefined,
      getAccountKey(second)
    )
  })

  it('keeps a missing same-origin selector authoritative', async () => {
    const handler = createCredentialHelperTrampolineHandler(store)

    await withTrampolineEnv(
      async trampolineEnv => {
        const token = (trampolineEnv as Record<string, string>)[
          'DESKTOP_TRAMPOLINE_TOKEN'
        ]
        const response = await handler({
          identifier: TrampolineCommandIdentifier.CredentialHelper,
          trampolineToken: token,
          parameters: ['get'],
          environmentVariables: new Map(),
          stdin: 'protocol=https\nhost=github.com\n',
        })

        assert.equal(response, undefined)
      },
      process.cwd(),
      false,
      undefined,
      'signed-out-account'
    )
  })

  it('records rejected endpoint provenance for forced credential erasure', async () => {
    const handler = createCredentialHelperTrampolineHandler(store)

    await withTrampolineEnv(
      async trampolineEnv => {
        const trampolineToken = (trampolineEnv as Record<string, string>)[
          'DESKTOP_TRAMPOLINE_TOKEN'
        ]
        const response = await handler({
          identifier: TrampolineCommandIdentifier.CredentialHelper,
          trampolineToken,
          parameters: ['erase'],
          environmentVariables: new Map(),
          stdin:
            'protocol=https\nhost=github.com\nusername=second-login\npassword=second-token\n',
        })

        assert.equal(response, undefined)
        assert.equal(
          getHasRejectedCredentialsForEndpoint(
            trampolineToken,
            'https://second-login@github.com/'
          ),
          true
        )
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
