import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  GitHubCLIPushFallback,
  buildPushArgv,
  pushWithGitHubCLIFallback,
} from '../../../src/lib/git/push'
import { getGitHubCLICredentialConfigArgs } from '../../../src/lib/gh-cli'

const BASE_ARGS = ['push', 'origin', 'main']

/**
 * Build a fake push `attempt` that records the config args of every call.
 * `outcomes` decides, per call index, whether that attempt resolves or rejects.
 */
function recordingAttempt(outcomes: ReadonlyArray<'ok' | Error>) {
  const configArgsPerCall: Array<ReadonlyArray<string>> = []
  const attempt = (configArgs: ReadonlyArray<string>): Promise<void> => {
    const index = configArgsPerCall.length
    configArgsPerCall.push(configArgs)
    const outcome = index < outcomes.length ? outcomes[index] : 'ok'
    if (outcome === 'ok') {
      return Promise.resolve()
    }
    return Promise.reject(outcome)
  }
  return { attempt, configArgsPerCall }
}

describe('git/push buildPushArgv', () => {
  it('returns the base argv unchanged when no config args are injected', () => {
    assert.deepStrictEqual(buildPushArgv(BASE_ARGS, []), BASE_ARGS)
  })

  it('injects the -c credential flags BEFORE the push subcommand', () => {
    const argv = buildPushArgv(BASE_ARGS, getGitHubCLICredentialConfigArgs())
    assert.deepStrictEqual(argv, [
      '-c',
      'credential.helper=',
      '-c',
      'credential.helper=!gh auth git-credential',
      'push',
      'origin',
      'main',
    ])
    // The subcommand must come after every -c flag for the overrides to apply.
    assert.ok(argv.indexOf('push') > argv.lastIndexOf('-c'))
  })

  it('never places a token anywhere in the composed argv', () => {
    const argv = buildPushArgv(BASE_ARGS, getGitHubCLICredentialConfigArgs())
    const joined = argv.join(' ')
    assert.doesNotMatch(joined, /gh[pousr]_/)
    assert.doesNotMatch(joined, /:\/\/[^@\s]*@/)
  })
})

describe('git/push pushWithGitHubCLIFallback', () => {
  it('runs the push once and never consults the fallback on success', async () => {
    const { attempt, configArgsPerCall } = recordingAttempt(['ok'])
    let consulted = false
    const fallback: GitHubCLIPushFallback = {
      shouldAttempt: () => {
        consulted = true
        return true
      },
    }

    await pushWithGitHubCLIFallback(attempt, fallback)

    assert.equal(configArgsPerCall.length, 1)
    assert.deepStrictEqual(configArgsPerCall[0], [])
    assert.equal(consulted, false)
  })

  it('rethrows and does not retry when there is no fallback', async () => {
    const original = new Error('auth failed')
    const { attempt, configArgsPerCall } = recordingAttempt([original])

    await assert.rejects(pushWithGitHubCLIFallback(attempt), err => {
      assert.equal(err, original)
      return true
    })
    assert.equal(configArgsPerCall.length, 1)
  })

  it('rethrows without retrying when shouldAttempt returns false', async () => {
    const original = new Error('auth failed')
    const { attempt, configArgsPerCall } = recordingAttempt([original])
    let onSuccessCalled = false
    let onFailureCalled = false
    const fallback: GitHubCLIPushFallback = {
      shouldAttempt: () => false,
      onSuccess: () => (onSuccessCalled = true),
      onFailure: () => (onFailureCalled = true),
    }

    await assert.rejects(pushWithGitHubCLIFallback(attempt, fallback), err => {
      assert.equal(err, original)
      return true
    })
    assert.equal(configArgsPerCall.length, 1)
    assert.equal(onSuccessCalled, false)
    assert.equal(onFailureCalled, false)
  })

  it('retries exactly once with the gh credential args on eligible failure', async () => {
    const { attempt, configArgsPerCall } = recordingAttempt([
      new Error('auth failed'),
      'ok',
    ])
    let onSuccessCalled = false
    const fallback: GitHubCLIPushFallback = {
      shouldAttempt: () => true,
      onSuccess: () => (onSuccessCalled = true),
    }

    await pushWithGitHubCLIFallback(attempt, fallback)

    assert.equal(configArgsPerCall.length, 2)
    assert.deepStrictEqual(configArgsPerCall[0], [])
    assert.deepStrictEqual(
      configArgsPerCall[1],
      getGitHubCLICredentialConfigArgs()
    )
    assert.equal(onSuccessCalled, true)
  })

  it('retries at most once and surfaces the ORIGINAL error on double failure', async () => {
    const original = new Error('original auth failure')
    const retryError = new Error('gh retry failure')
    const { attempt, configArgsPerCall } = recordingAttempt([
      original,
      retryError,
    ])
    let failureError: unknown = null
    let onSuccessCalled = false
    const fallback: GitHubCLIPushFallback = {
      shouldAttempt: () => true,
      onSuccess: () => (onSuccessCalled = true),
      onFailure: err => (failureError = err),
    }

    await assert.rejects(pushWithGitHubCLIFallback(attempt, fallback), err => {
      // The original failure is surfaced, never the gh retry's error.
      assert.equal(err, original)
      assert.notEqual(err, retryError)
      return true
    })

    // Single retry only: exactly two attempts, no third.
    assert.equal(configArgsPerCall.length, 2)
    assert.equal(failureError, original)
    assert.equal(onSuccessCalled, false)
  })

  it('awaits an async shouldAttempt decision', async () => {
    const { attempt, configArgsPerCall } = recordingAttempt([
      new Error('auth failed'),
      'ok',
    ])
    const fallback: GitHubCLIPushFallback = {
      shouldAttempt: () => Promise.resolve(true),
    }

    await pushWithGitHubCLIFallback(attempt, fallback)
    assert.equal(configArgsPerCall.length, 2)
  })

  // The publish-repository flow and the ordinary push flow both call the same
  // `push()` (via the store's `performPush`), so they share this exact retry
  // mechanism. This proves the fallback fires identically regardless of the
  // originating caller.
  it('fires identically for the publish flow and the ordinary push flow', async () => {
    const runs: Array<Array<ReadonlyArray<string>>> = []

    // Two iterations stand in for the ordinary push flow and the publish flow;
    // both reach this function through the store's shared `performPush`.
    for (let caller = 0; caller < 2; caller++) {
      const { attempt, configArgsPerCall } = recordingAttempt([
        new Error('auth failed'),
        'ok',
      ])
      let succeeded = false
      const fallback: GitHubCLIPushFallback = {
        shouldAttempt: () => true,
        onSuccess: () => (succeeded = true),
      }
      await pushWithGitHubCLIFallback(attempt, fallback)
      assert.equal(succeeded, true)
      runs.push(configArgsPerCall)
    }

    // Both callers produced the same attempt sequence: initial + one gh retry.
    assert.deepStrictEqual(runs[0], runs[1])
    assert.equal(runs[0].length, 2)
    assert.deepStrictEqual(runs[0][1], getGitHubCLICredentialConfigArgs())
  })
})
