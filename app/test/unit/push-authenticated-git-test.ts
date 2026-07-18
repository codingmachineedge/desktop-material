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

mock.module('../../src/lib/git/core', {
  namedExports: {
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

describe('authenticated push Git execution', () => {
  it('routes credentials through the selected repository account', async () => {
    const { push } = await import('../../src/lib/git/push')
    const repository = new Repository('C:\\proof', -1, null, false)
    const accountKey = 'https://api.github.com#account-2'
    invocations.length = 0

    await push(
      repository,
      { name: 'origin', url: 'https://github.com/owner/private.git' },
      'main',
      'main',
      null,
      { accountKey }
    )

    assert.equal(invocations.length, 1)
    assert.deepStrictEqual(invocations[0].args, ['push', 'origin', 'main:main'])
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
