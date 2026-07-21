import { describe, it, mock } from 'node:test'
import assert from 'node:assert'
import { Repository } from '../../src/models/repository'

interface IInvocation {
  readonly name: string
  readonly args: ReadonlyArray<string>
  readonly options: Record<string, unknown>
}

const invocations: IInvocation[] = []
const remoteOperationURLs: string[] = []

let symbolicRefExitCode = 1
let symbolicRefStdout = ''
let remoteHEADTargetExitCode = 0
let remoteHEADDiscoveryNeverResolves = false

mock.module('../../src/lib/git/environment', {
  namedExports: {
    envForRemoteOperation: async (url: string) => {
      remoteOperationURLs.push(url)
      return { HTTPS_PROXY: 'proxy-safe' }
    },
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

      if (name === 'getSymbolicRef') {
        return {
          exitCode: symbolicRefExitCode,
          stdout: symbolicRefStdout,
          stderr: '',
          gitError: null,
        }
      }

      if (name === 'getRemoteHEADTarget') {
        return {
          exitCode: remoteHEADTargetExitCode,
          stdout: '',
          stderr: '',
          gitError: null,
        }
      }

      if (name === 'updateRemoteHEAD' && remoteHEADDiscoveryNeverResolves) {
        return await new Promise<never>((_resolve, reject) => {
          const signal = options.signal as AbortSignal | undefined
          signal?.addEventListener(
            'abort',
            () => reject(new Error('remote HEAD discovery aborted')),
            { once: true }
          )
        })
      }

      return { exitCode: 0, stdout: '', stderr: '', gitError: null }
    },
  },
})

const resetGitMocks = () => {
  invocations.length = 0
  remoteOperationURLs.length = 0
  symbolicRefExitCode = 1
  symbolicRefStdout = ''
  remoteHEADTargetExitCode = 0
  remoteHEADDiscoveryNeverResolves = false
}

const settlesWithin = async <T>(promise: Promise<T>, timeoutMs: number) => {
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error(`Promise did not settle within ${timeoutMs}ms`)),
          timeoutMs
        )
      }),
    ])
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout)
    }
  }
}

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
    resetGitMocks()

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
    resetGitMocks()

    await fetchRefspec(repository, remote, 'refs/pull/1/head', accountKey)

    assert.equal(invocations.length, 1)
    assert.deepStrictEqual(invocations[0].args, [
      'fetch',
      'origin',
      'refs/pull/1/head',
    ])
    assertCredentialScope(invocations[0])
  })

  it('skips remote HEAD discovery for a valid background symref', async () => {
    const { updateRemoteHEAD } = await import('../../src/lib/git/remote')
    resetGitMocks()
    symbolicRefExitCode = 0
    symbolicRefStdout = 'refs/remotes/origin/main\n'
    remoteHEADDiscoveryNeverResolves = true

    await settlesWithin(
      updateRemoteHEAD(repository, remote, true, accountKey),
      100
    )

    assert.equal(invocations.length, 2)
    assert.equal(invocations[0].name, 'getSymbolicRef')
    assert.deepStrictEqual(invocations[0].args, [
      'symbolic-ref',
      '-q',
      'refs/remotes/origin/HEAD',
    ])
    assert.equal(invocations[1].name, 'getRemoteHEADTarget')
    assert.deepStrictEqual(invocations[1].args, [
      'show-ref',
      '--verify',
      '--quiet',
      '--',
      'refs/remotes/origin/main',
    ])
    assert.equal(remoteOperationURLs.length, 0)
  })

  it('refreshes a valid remote HEAD after a user-initiated fetch', async () => {
    const { updateRemoteHEAD } = await import('../../src/lib/git/remote')
    resetGitMocks()
    symbolicRefExitCode = 0
    symbolicRefStdout = 'refs/remotes/origin/main\n'

    await updateRemoteHEAD(repository, remote, false, accountKey)

    assert.equal(invocations.length, 1)
    assert.equal(invocations[0].name, 'updateRemoteHEAD')
    assertCredentialScope(invocations[0])
    assert.deepStrictEqual(remoteOperationURLs, [remote.url])
  })

  it('bounds a hanging user-initiated remote HEAD refresh', async () => {
    const { updateRemoteHEAD } = await import('../../src/lib/git/remote')
    resetGitMocks()
    symbolicRefExitCode = 0
    symbolicRefStdout = 'refs/remotes/origin/main\n'
    remoteHEADDiscoveryNeverResolves = true

    await settlesWithin(
      updateRemoteHEAD(repository, remote, false, accountKey, 10),
      100
    )

    assert.equal(invocations.length, 1)
    assert.equal(invocations[0].name, 'updateRemoteHEAD')
    assert.equal((invocations[0].options.signal as AbortSignal).aborted, true)
  })

  it('repairs a namespace-valid remote HEAD whose target is missing', async () => {
    const { updateRemoteHEAD } = await import('../../src/lib/git/remote')
    resetGitMocks()
    symbolicRefExitCode = 0
    symbolicRefStdout = 'refs/remotes/origin/retired\n'
    remoteHEADTargetExitCode = 1

    await updateRemoteHEAD(repository, remote, true, accountKey)

    assert.equal(invocations.length, 3)
    assert.equal(invocations[0].name, 'getSymbolicRef')
    assert.equal(invocations[1].name, 'getRemoteHEADTarget')
    assert.equal(invocations[2].name, 'updateRemoteHEAD')
    assertCredentialScope(invocations[2])
    assert.deepStrictEqual(remoteOperationURLs, [remote.url])
  })

  it('uses the selected account and background mode for missing remote HEAD', async () => {
    const { updateRemoteHEAD } = await import('../../src/lib/git/remote')
    resetGitMocks()

    await updateRemoteHEAD(repository, remote, true, accountKey)

    assert.equal(invocations.length, 2)
    assert.equal(invocations[0].name, 'getSymbolicRef')
    assert.equal(invocations[1].name, 'updateRemoteHEAD')
    assert.deepStrictEqual(invocations[1].args, [
      'remote',
      'set-head',
      '-a',
      'origin',
    ])
    assertCredentialScope(invocations[1])
    assert.equal(invocations[1].options.isBackgroundTask, true)
    assert.deepStrictEqual(remoteOperationURLs, [remote.url])
  })

  for (const [description, symbolicRef] of [
    ['malformed', ''],
    ['outside the remote namespace', 'refs/remotes/upstream/main'],
  ] as const) {
    it(`discovers remote HEAD exactly once when the local symref is ${description}`, async () => {
      const { updateRemoteHEAD } = await import('../../src/lib/git/remote')
      resetGitMocks()
      symbolicRefExitCode = 0
      symbolicRefStdout = symbolicRef

      await updateRemoteHEAD(repository, remote, true, accountKey)

      assert.equal(
        invocations.filter(invocation => invocation.name === 'updateRemoteHEAD')
          .length,
        1
      )
      assertCredentialScope(invocations[1])
      assert.equal(invocations[1].options.isBackgroundTask, true)
      assert.deepStrictEqual(remoteOperationURLs, [remote.url])
    })
  }
})
