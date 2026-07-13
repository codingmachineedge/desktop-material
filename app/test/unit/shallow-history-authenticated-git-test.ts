import { describe, it, mock } from 'node:test'
import assert from 'node:assert'
import { Repository } from '../../src/models/repository'

interface IInvocation {
  readonly args: ReadonlyArray<string>
  readonly path: string
  readonly name: string
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
      path: string,
      name: string,
      options: Record<string, unknown>
    ) => {
      invocations.push({ args, path, name, options })
    },
  },
})

describe('authenticated shallow-history Git execution', () => {
  it('keeps the account selector in process and credentials out of argv and env', async () => {
    const { fetchRepositoryShallowHistory } = await import(
      '../../src/lib/git/shallow-history'
    )
    const repository = new Repository('C:\\proof', -1, null, false)
    const credential = ['private', 'oauth', 'value'].join('-')
    const accountKey = 'https://api.github.com#account-2'
    invocations.length = 0

    await fetchRepositoryShallowHistory(
      repository,
      {
        name: 'origin',
        url: 'https://github.com/material/proof.git',
      },
      { action: 'deepen', remote: 'origin', deepenBy: 50 },
      { accountKey }
    )

    assert.equal(invocations.length, 1)
    assert.deepStrictEqual(invocations[0].args, [
      'fetch',
      '--no-auto-maintenance',
      '--no-recurse-submodules',
      '--no-write-fetch-head',
      '--deepen=50',
      '--',
      'origin',
    ])
    assert.equal(invocations[0].path, repository.path)
    assert.equal(invocations[0].name, 'fetchRepositoryShallowHistory')
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
    assert.doesNotMatch(JSON.stringify(invocations[0]), new RegExp(credential))
  })
})
