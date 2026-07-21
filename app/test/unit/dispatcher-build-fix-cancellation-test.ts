import assert from 'node:assert'
import { describe, it } from 'node:test'
import { defaultBuildRunPreferences } from '../../src/models/build-run-preferences'
import { Repository } from '../../src/models/repository'
import { Dispatcher } from '../../src/ui/dispatcher'

describe('Dispatcher detached build-fix cancellation', () => {
  it('does not start the verification rerun after the build panel stops Codex', async () => {
    const repository = new Repository(
      'C:\\cancelled-codex-repository',
      7,
      null,
      false,
      null,
      {},
      false,
      undefined,
      null,
      { ...defaultBuildRunPreferences, buildFixProvider: 'codex' }
    )
    let state = {
      phase: 'failed' as const,
      activeRunId: null as string | null,
      opencodeOperationId: null as string | null,
      buildFixProvider: null as 'codex' | 'opencode' | null,
    }
    const buildRunStore = {
      getStateForRepository: () => state,
      setOpencodeRunning: (
        _repositoryId: number,
        running: boolean,
        operationId: string | null = null,
        provider: 'codex' | 'opencode' = 'opencode'
      ) => {
        state = {
          ...state,
          opencodeOperationId: running ? operationId : null,
          buildFixProvider: running ? provider : null,
        }
      },
    }

    let resolveInvocation!: (result: { readonly ok: boolean }) => void
    const invocation = new Promise<{ readonly ok: boolean }>(resolve => {
      resolveInvocation = resolve
    })
    let cancelCalls = 0
    let verificationRuns = 0
    const dispatcher = Object.create(Dispatcher.prototype) as Dispatcher
    Reflect.set(dispatcher, 'buildRunStore', buildRunStore)
    Reflect.set(dispatcher, 'buildFixOperationControllers', new Map())
    Reflect.set(dispatcher, 'pipeBuildFixLog', () => () => {})
    Reflect.set(dispatcher, 'invokeBuildFixProvider', () => invocation)
    Reflect.set(dispatcher, 'cancelBuildFixProvider', async () => {
      cancelCalls++
      resolveInvocation({ ok: true })
    })
    Reflect.set(dispatcher, 'startBuildRun', async () => {
      verificationRuns++
    })

    const running = dispatcher.runBuildFixProvider(
      'codex',
      repository,
      {
        stageKind: 'build',
        exitCode: 1,
        tailText: 'failed',
        cwd: repository.path,
        autoApprove: false,
      },
      () => {}
    )
    assert.notEqual(state.opencodeOperationId, null)

    await dispatcher.cancelBuildRun(repository)
    const result = await running

    assert.equal(result.run.ok, true)
    assert.ok(cancelCalls >= 1)
    assert.equal(verificationRuns, 0)
    assert.equal(state.opencodeOperationId, null)
  })
})
