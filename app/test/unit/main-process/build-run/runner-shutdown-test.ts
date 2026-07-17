import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import { before, describe, it, mock } from 'node:test'

import type { WebContents } from 'electron'
import type { IBuildRunPlan } from '../../../../src/lib/build-run/types'
import type {
  IElevatedResult,
  IElevatedRun,
} from '../../../../src/main-process/build-run/elevated-runner'

interface IControllableElevatedRun {
  readonly run: IElevatedRun
  readonly release: () => void
  readonly cancellationRequested: () => boolean
}

const pendingRuns = new Array<IControllableElevatedRun>()

function createElevatedRun(): IControllableElevatedRun {
  let release!: () => void
  let cancelled = false
  const result: IElevatedResult = { code: 1223, cancelled: true }
  const whenDone = new Promise<IElevatedResult>(resolve => {
    release = () => resolve(result)
  })
  return {
    run: {
      whenDone,
      cancel: () => {
        cancelled = true
        return whenDone
      },
    },
    release,
    cancellationRequested: () => cancelled,
  }
}

mock.module('../../../../src/main-process/build-run/elevated-runner', {
  namedExports: {
    startElevatedRun: () => {
      const controlled = createElevatedRun()
      pendingRuns.push(controlled)
      return controlled.run
    },
  },
})

let BuildRunner: typeof import('../../../../src/main-process/build-run/runner').BuildRunner

before(async () => {
  BuildRunner = (
    await import('../../../../src/main-process/build-run/runner')
  ).BuildRunner
})

function plan(runId: string): IBuildRunPlan {
  return {
    runId,
    repositoryId: 1,
    cwd: 'C:\\fixture',
    ecosystem: 'node',
    elevated: true,
    autoInstall: false,
    stages: [],
    env: {},
    toolchainCheck: {
      cmd: { exe: 'node', args: ['--version'], label: 'node --version' },
      missingHint: 'Install Node.js',
    },
    probeFlags: {
      hasYarnLock: false,
      hasPnpmLock: false,
      hasVenv: false,
    },
  }
}

function sender(): WebContents {
  const events = new EventEmitter() as EventEmitter & {
    isDestroyed(): boolean
  }
  events.isDestroyed = () => true
  return events as unknown as WebContents
}

describe('BuildRunner shutdown', () => {
  it('does not resolve cancel until the elevated process reports completion', async () => {
    pendingRuns.length = 0
    const runner = new BuildRunner()
    runner.start(plan('cancel-one'), sender())
    assert.equal(pendingRuns.length, 1)

    let settled = false
    const cancellation = runner.cancel('cancel-one').then(() => {
      settled = true
    })
    await Promise.resolve()
    assert.equal(pendingRuns[0].cancellationRequested(), true)
    assert.equal(settled, false)

    pendingRuns[0].release()
    await cancellation
    assert.equal(settled, true)
  })

  it('awaits every active elevated run during killAll', async () => {
    pendingRuns.length = 0
    const runner = new BuildRunner()
    runner.start(plan('shutdown-one'), sender())
    runner.start(plan('shutdown-two'), sender())
    assert.equal(pendingRuns.length, 2)

    let settled = false
    const shutdown = runner.killAll().then(() => {
      settled = true
    })
    await Promise.resolve()
    assert.equal(
      pendingRuns.every(run => run.cancellationRequested()),
      true
    )
    assert.equal(settled, false)

    pendingRuns[0].release()
    await Promise.resolve()
    assert.equal(settled, false)
    pendingRuns[1].release()
    await shutdown
    assert.equal(settled, true)
  })
})
