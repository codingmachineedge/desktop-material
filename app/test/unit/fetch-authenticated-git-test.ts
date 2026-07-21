import { describe, it, mock } from 'node:test'
import assert from 'node:assert'
import { Repository } from '../../src/models/repository'

interface IInvocation {
  readonly name: string
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
      name: string,
      options: Record<string, unknown>
    ) => {
      invocations.push({ name, args, options })
      return { exitCode: 0, stdout: '', stderr: '', gitError: null }
    },
  },
})

describe('authenticated fetch Git execution', () => {
  const repository = new Repository('C:\\proof', -1, null, false)
  const remote = {
    name: 'origin',
    url: 'https://github.com/owner/private.git',
  }
  const accountKey = 'https://api.github.com#account-2'

  const assertCredentialScope = (invocation: IInvocation) => {
    assert.equal(invocation.options.credentialAccountKey, accountKey)
    assert.deepStrictEqual(invocation.options.env, {
      HTTPS_PROXY: 'proxy-safe',
    })
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        invocation.options.env,
        'credentialAccountKey'
      ),
      false
    )
  }

  it('forces the selected account for a normal fetch', async () => {
    const { fetch } = await import('../../src/lib/git/fetch')
    invocations.length = 0

    await fetch(repository, remote, undefined, false, accountKey)

    assert.equal(invocations.length, 1)
    assert.deepStrictEqual(invocations[0].args, [
      'fetch',
      '--prune',
      '--recurse-submodules=on-demand',
      'origin',
    ])
    assertCredentialScope(invocations[0])
  })

  it('forces the selected account for a refspec fetch', async () => {
    const { fetchRefspec } = await import('../../src/lib/git/fetch')
    invocations.length = 0

    await fetchRefspec(repository, remote, 'refs/pull/1/head', accountKey)

    assert.equal(invocations.length, 1)
    assert.deepStrictEqual(invocations[0].args, [
      'fetch',
      'origin',
      'refs/pull/1/head',
    ])
    assertCredentialScope(invocations[0])
  })

  it('forces the selected account while discovering remote HEAD', async () => {
    const { updateRemoteHEAD } = await import('../../src/lib/git/remote')
    invocations.length = 0

    await updateRemoteHEAD(repository, remote, false, accountKey)

    assert.equal(invocations.length, 1)
    assert.deepStrictEqual(invocations[0].args, [
      'remote',
      'set-head',
      '-a',
      'origin',
    ])
    assertCredentialScope(invocations[0])
  })
})
