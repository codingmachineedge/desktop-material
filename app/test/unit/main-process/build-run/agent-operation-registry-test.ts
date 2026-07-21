import assert from 'node:assert'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import type { WebContents } from 'electron'
import { AgentOperationRegistry } from '../../../../src/main-process/build-run/agent-operation-registry'

class FakeWebContents extends EventEmitter {
  private destroyed = false

  public isDestroyed(): boolean {
    return this.destroyed
  }

  public navigate(): void {
    this.emit('did-start-navigation')
  }

  public destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

function asWebContents(sender: FakeWebContents): WebContents {
  return sender as unknown as WebContents
}

function deferred(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

describe('AgentOperationRegistry', () => {
  it('rejects a duplicate id for the same owner without replacing the first operation', async () => {
    const registry = new AgentOperationRegistry()
    const sender = asWebContents(new FakeWebContents())
    const first = registry.run(sender, 'same-id', async controller => {
      await new Promise<void>(resolve =>
        controller.signal.addEventListener('abort', () => resolve(), {
          once: true,
        })
      )
      return 'first'
    })

    await assert.rejects(
      registry.run(sender, 'same-id', async () => 'replacement'),
      /already running/
    )
    assert.equal(await registry.cancel(sender, 'same-id'), true)
    assert.equal(await first, 'first')
  })

  it('scopes cancellation to the exact WebContents owner', async () => {
    const registry = new AgentOperationRegistry()
    const owner = asWebContents(new FakeWebContents())
    const foreign = asWebContents(new FakeWebContents())
    let aborted = false
    const running = registry.run(owner, 'owned-id', async controller => {
      await new Promise<void>(resolve =>
        controller.signal.addEventListener(
          'abort',
          () => {
            aborted = true
            resolve()
          },
          { once: true }
        )
      )
    })

    assert.equal(await registry.cancel(foreign, 'owned-id'), false)
    assert.equal(aborted, false)
    assert.equal(await registry.cancel(owner, 'owned-id'), true)
    await running
    assert.equal(aborted, true)
  })

  for (const ownerEvent of ['navigation', 'destruction'] as const) {
    it(`aborts on owner ${ownerEvent} and retains ownership until close`, async () => {
      const registry = new AgentOperationRegistry()
      const rawSender = new FakeWebContents()
      const sender = asWebContents(rawSender)
      const closeGate = deferred()
      let aborted = false
      const running = registry.run(sender, 'lifecycle-id', async controller => {
        await new Promise<void>(resolve =>
          controller.signal.addEventListener(
            'abort',
            () => {
              aborted = true
              resolve()
            },
            { once: true }
          )
        )
        await closeGate.promise
      })

      if (ownerEvent === 'navigation') {
        rawSender.navigate()
      } else {
        rawSender.destroy()
      }
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.equal(aborted, true)

      let cancellationSettled = false
      const cancellation = registry.cancel(sender, 'lifecycle-id').then(() => {
        cancellationSettled = true
      })
      await new Promise<void>(resolve => setImmediate(resolve))
      assert.equal(cancellationSettled, false)

      closeGate.resolve()
      await Promise.all([running, cancellation])
      assert.equal(cancellationSettled, true)
    })
  }
})
