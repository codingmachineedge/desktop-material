import assert from 'node:assert'
import { describe, it } from 'node:test'

import { Branch, BranchType } from '../../src/models/branch'
import { Repository } from '../../src/models/repository'
import { PushBranchCommits } from '../../src/ui/branches/push-branch-commits'
import { Dispatcher } from '../../src/ui/dispatcher'

interface ITestPushBranchCommits {
  onSubmit: () => Promise<void>
  onCreateWithoutPushButtonClick: (event: {
    preventDefault: () => void
  }) => Promise<void>
  setState: (state: { isPushingOrPublishing: boolean }) => void
}

function deferred(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
} {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>(accept => {
    resolve = accept
  })
  return { promise, resolve }
}

const repository = new Repository('C:\\work\\material', 7, null, false)
const branch = new Branch(
  'feature-safe',
  'origin/feature-safe',
  { sha: '0123456789abcdef' },
  BranchType.Local,
  'refs/heads/feature-safe'
)
const baseBranch = new Branch(
  'main',
  'origin/main',
  { sha: 'fedcba9876543210' },
  BranchType.Local,
  'refs/heads/main'
)

describe('push branch review-request continuation', () => {
  it('awaits push, provider continuation, and only then dismisses', async () => {
    const push = deferred()
    const continuation = deferred()
    const calls = new Array<string>()
    const dispatcher = {
      push: async () => {
        calls.push('push')
        await push.promise
      },
      postError: async () => {
        calls.push('error')
      },
    } as unknown as Dispatcher
    const component = new PushBranchCommits({
      dispatcher,
      repository,
      branch,
      baseBranch,
      onConfirm: async (
        confirmedRepository,
        confirmedBranch,
        confirmedBase
      ) => {
        assert.equal(confirmedRepository, repository)
        assert.equal(confirmedBranch, branch)
        assert.equal(confirmedBase, baseBranch)
        calls.push('continue')
        await continuation.promise
      },
      onDismissed: () => calls.push('dismiss'),
    }) as unknown as ITestPushBranchCommits
    component.setState = state =>
      calls.push(state.isPushingOrPublishing ? 'loading' : 'idle')

    const submission = component.onSubmit()
    await Promise.resolve()
    assert.deepEqual(calls, ['loading', 'push'])

    push.resolve()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls, ['loading', 'push', 'continue'])

    continuation.resolve()
    await submission
    assert.deepEqual(calls, ['loading', 'push', 'continue', 'dismiss'])
  })

  it('keeps the dialog open and reports a rejected no-push continuation', async () => {
    const failure = new Error('provider continuation failed')
    const calls = new Array<string>()
    const errors = new Array<Error>()
    const dispatcher = {
      push: async () => undefined,
      postError: async (error: Error) => {
        errors.push(error)
        calls.push('error')
      },
    } as unknown as Dispatcher
    const component = new PushBranchCommits({
      dispatcher,
      repository,
      branch,
      baseBranch,
      unPushedCommits: 1,
      onConfirm: async () => {
        calls.push('continue')
        throw failure
      },
      onDismissed: () => calls.push('dismiss'),
    }) as unknown as ITestPushBranchCommits
    component.setState = state =>
      calls.push(state.isPushingOrPublishing ? 'loading' : 'idle')

    let prevented = false
    await component.onCreateWithoutPushButtonClick({
      preventDefault: () => {
        prevented = true
      },
    })

    assert.equal(prevented, true)
    assert.deepEqual(calls, ['loading', 'continue', 'error', 'idle'])
    assert.deepEqual(errors, [failure])
  })
})
