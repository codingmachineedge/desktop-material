import { describe, it, mock } from 'node:test'
import assert from 'node:assert'
import { Repository } from '../../src/models/repository'

interface IInvocation {
  readonly args: ReadonlyArray<string>
  readonly options: Record<string, unknown>
}

const invocations: IInvocation[] = []

mock.module('../../src/lib/git/environment', {
  namedExports: {
    envForRemoteOperation: async () => ({ HTTPS_PROXY: 'proxy-safe' }),
  },
})

mock.module('../../src/lib/git/config', {
  namedExports: {
    getConfigValue: async () => 'ff',
  },
})

mock.module('../../src/lib/git/core', {
  namedExports: {
    gitRebaseArguments: () => [],
    git: async (
      args: ReadonlyArray<string>,
      _path: string,
      _name: string,
      options: Record<string, unknown>
    ) => {
      invocations.push({ args, options })
    },
  },
})

describe('authenticated pull Git execution', () => {
  it('routes credentials through the selected repository account', async () => {
    const { pull } = await import('../../src/lib/git/pull')
    const repository = new Repository('C:\\proof', -1, null, false)
    const accountKey = 'https://api.github.com#account-2'
    invocations.length = 0

    await pull(
      repository,
      { name: 'origin', url: 'https://github.com/owner/private.git' },
      { accountKey }
    )

    assert.equal(invocations.length, 1)
    assert.deepStrictEqual(invocations[0].args, [
      'pull',
      '--recurse-submodules',
      'origin',
    ])
    assert.equal(invocations[0].options.credentialAccountKey, accountKey)
    assert.deepStrictEqual(invocations[0].options.env, {
      HTTPS_PROXY: 'proxy-safe',
    })
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        invocations[0].options.env,
        'credentialAccountKey'
      ),
      false
    )
  })
})
