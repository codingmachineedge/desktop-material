import assert from 'node:assert'
import { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'

import { CLIWorkbenchCatalogService } from '../../../../src/main-process/cli-workbench/catalog'

class FakeCatalogChild extends EventEmitter {
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

function asChild(child: FakeCatalogChild): ChildProcessWithoutNullStreams {
  return child as unknown as ChildProcessWithoutNullStreams
}

function nextTurn(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

describe('CLI workbench catalog shutdown', () => {
  it('closes the discovery gate and awaits every active probe', async () => {
    const children = [new FakeCatalogChild(5101), new FakeCatalogChild(5102)]
    let spawnIndex = 0
    let kills = 0
    const service = new CLIWorkbenchCatalogService({
      spawn: () => asChild(children[spawnIndex++]),
      resolveTool: tool => ({ executable: `${tool}.exe`, env: {} }),
      killTree: async (_pid, isStillOwned) => {
        assert.equal(isStillOwned(), true)
        kills++
        return true
      },
    })
    const discovery = service.getCatalog()
    assert.equal(spawnIndex, 2)

    let settled = false
    const shutdown = service.killAll().then(() => {
      settled = true
    })
    await nextTurn()
    assert.equal(kills, 2)
    assert.equal(settled, false)

    children[0].close(null, 'SIGTERM')
    await nextTurn()
    assert.equal(settled, false)
    children[1].close(null, 'SIGTERM')
    await shutdown
    assert.equal(settled, true)

    await discovery
    assert.equal(spawnIndex, 2)
  })

  it('contains kill rejection and directly stops each exact probe', async () => {
    const children = [
      new FakeCatalogChild(5201, true),
      new FakeCatalogChild(5202, true),
    ]
    let spawnIndex = 0
    const service = new CLIWorkbenchCatalogService({
      spawn: () => asChild(children[spawnIndex++]),
      resolveTool: tool => ({ executable: `${tool}.exe`, env: {} }),
      killTree: async () => {
        throw new Error('taskkill unavailable')
      },
    })
    const discovery = service.getCatalog()

    await service.killAll()
    assert.deepEqual(
      children.map(child => child.killSignals),
      [['SIGKILL'], ['SIGKILL']]
    )
    await discovery
  })

  it('returns after a bounded close wait when a broken child never closes', async () => {
    const children = [new FakeCatalogChild(5301), new FakeCatalogChild(5302)]
    let spawnIndex = 0
    const service = new CLIWorkbenchCatalogService({
      spawn: () => asChild(children[spawnIndex++]),
      resolveTool: tool => ({ executable: `${tool}.exe`, env: {} }),
      killTree: async () => false,
      terminationDeadlineMilliseconds: 5,
    })
    const discovery = service.getCatalog()

    await service.killAll()
    await discovery
    assert.deepEqual(
      children.map(child => child.killSignals),
      [['SIGKILL'], ['SIGKILL']]
    )
    assert.equal(spawnIndex, 2)
  })
})
