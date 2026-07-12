import { describe, it } from 'node:test'
import assert from 'node:assert'
import { AgentCommandQueue } from '../../src/lib/agent-command-executor'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => (resolve = done))
  return { promise, resolve }
}

describe('renderer agent command queue', () => {
  it('serializes commands for one repository', async () => {
    const queue = new AgentCommandQueue()
    const gate = deferred<void>()
    const order: string[] = []
    const first = queue.run('repo:1', async () => {
      order.push('first-start')
      await gate.promise
      order.push('first-end')
    })
    const second = queue.run('repo:1', async () => {
      order.push('second')
    })

    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(order, ['first-start'])
    gate.resolve()
    await Promise.all([first, second])
    assert.deepEqual(order, ['first-start', 'first-end', 'second'])
  })

  it('allows independent repositories to make progress concurrently', async () => {
    const queue = new AgentCommandQueue()
    const gate = deferred<void>()
    let secondRan = false
    const first = queue.run('repo:1', () => gate.promise)
    const second = queue.run('repo:2', async () => {
      secondRan = true
    })

    await second
    assert.equal(secondRan, true)
    gate.resolve()
    await first
  })

  it('continues a repository queue after a command failure', async () => {
    const queue = new AgentCommandQueue()
    await assert.rejects(
      queue.run('repo:1', async () => {
        throw new Error('expected')
      })
    )
    assert.equal(await queue.run('repo:1', async () => 42), 42)
  })
})
