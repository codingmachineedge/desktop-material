import assert from 'node:assert'
import { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'

import type { WebContents } from 'electron'
import { IResolvedCLICommandRequest } from '../../../../src/main-process/cli-workbench/runner-helpers'
import { CLIWorkbenchRunner } from '../../../../src/main-process/cli-workbench/runner'

class FakeChild extends EventEmitter {
  public readonly stdin = new PassThrough()
  public readonly stdout = new PassThrough()
  public readonly stderr = new PassThrough()
  public readonly pid: number
  public exitCode: number | null = null
  public signalCode: NodeJS.Signals | null = null
  public readonly killSignals = new Array<NodeJS.Signals | number | undefined>()

  public constructor(pid: number, private readonly closeOnKill = false) {
    super()
    this.pid = pid
  }

  public kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal)
    if (this.closeOnKill) {
      setImmediate(() => this.close(null, 'SIGKILL'))
    }
    return true
  }

  public close(
    code: number | null = 0,
    signal: NodeJS.Signals | null = null
  ): void {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
    this.emit('close', code, signal)
  }
}

function asChild(child: FakeChild): ChildProcessWithoutNullStreams {
  return child as unknown as ChildProcessWithoutNullStreams
}

function sender(): WebContents {
  const result = new EventEmitter() as EventEmitter & {
    isDestroyed(): boolean
  }
  result.isDestroyed = () => true
  return result as unknown as WebContents
}

function request(id: string): IResolvedCLICommandRequest {
  return {
    id,
    operation: { id: 'status-summary' },
    repositoryPath: 'C:\\fixture',
    tool: 'git',
    args: ['status', '--short'],
    confirmed: false,
  }
}

function nextTurn(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

describe('CLI workbench runner shutdown', () => {
  it('single-flights cancellation and awaits both tree kill and child close', async () => {
    const child = new FakeChild(4101)
    let releaseKill: (value: boolean) => void = () => undefined
    const killResult = new Promise<boolean>(resolve => {
      releaseKill = resolve
    })
    let kills = 0
    const runner = new CLIWorkbenchRunner({
      spawn: () => asChild(child),
      resolveTool: () => ({ executable: 'git.exe', env: {} }),
      validateRequest: async value => request(String(value)),
      killTree: async (_pid, isStillOwned) => {
        assert.equal(isStillOwned(), true)
        kills++
        return await killResult
      },
    })
    await runner.start('run-one', sender())

    let firstSettled = false
    const first = runner.cancel('run-one').then(value => {
      firstSettled = true
      return value
    })
    const second = runner.cancel('run-one')
    await nextTurn()
    assert.equal(kills, 1)
    assert.equal(firstSettled, false)

    releaseKill(true)
    await nextTurn()
    assert.equal(firstSettled, false)

    child.close(null, 'SIGTERM')
    assert.equal(await first, true)
    assert.equal(await second, true)
    assert.equal(firstSettled, true)
  })

  it('awaits every captured child during application shutdown', async () => {
    const first = new FakeChild(4201)
    const second = new FakeChild(4202)
    const spawned = [first, second]
    let spawnIndex = 0
    const isolatedRunner = new CLIWorkbenchRunner({
      spawn: () => asChild(spawned[spawnIndex++]),
      resolveTool: () => ({ executable: 'git.exe', env: {} }),
      validateRequest: async value => request(String(value)),
      killTree: async () => true,
    })
    await isolatedRunner.start('run-one', sender())
    await isolatedRunner.start('run-two', sender())

    let settled = false
    const shutdown = isolatedRunner.killAll().then(() => {
      settled = true
    })
    await nextTurn()
    assert.equal(settled, false)
    first.close(null, 'SIGTERM')
    await nextTurn()
    assert.equal(settled, false)
    second.close(null, 'SIGTERM')
    await shutdown
    assert.equal(settled, true)
  })

  it('contains tree-kill rejection and directly stops the exact child', async () => {
    const child = new FakeChild(4301, true)
    const runner = new CLIWorkbenchRunner({
      spawn: () => asChild(child),
      resolveTool: () => ({ executable: 'git.exe', env: {} }),
      validateRequest: async value => request(String(value)),
      killTree: async () => {
        throw new Error('taskkill unavailable')
      },
    })
    await runner.start('run-one', sender())

    assert.equal(await runner.cancel('run-one'), true)
    assert.deepEqual(child.killSignals, ['SIGKILL'])
  })

  it('returns after a bounded close wait when a broken child never closes', async () => {
    const child = new FakeChild(4401)
    const runner = new CLIWorkbenchRunner({
      spawn: () => asChild(child),
      resolveTool: () => ({ executable: 'git.exe', env: {} }),
      validateRequest: async value => request(String(value)),
      killTree: async () => false,
      terminationDeadlineMilliseconds: 5,
    })
    await runner.start('run-one', sender())

    assert.equal(await runner.cancel('run-one'), true)
    assert.deepEqual(child.killSignals, ['SIGKILL'])
  })
})
