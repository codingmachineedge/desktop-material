import assert from 'node:assert'
import { describe, it } from 'node:test'
import { ActionsArtifactProvenanceShutdownBarrier } from '../../../src/main-process/actions-artifact-provenance-shutdown'

describe('Actions artifact provenance shutdown barrier', () => {
  it('blocks only will-quit until one awaited teardown and then permits final quit', async () => {
    let release!: () => void
    const teardown = new Promise<void>(resolve => {
      release = resolve
    })
    let shutdowns = 0
    let quits = 0
    const barrier = new ActionsArtifactProvenanceShutdownBarrier(
      async () => {
        shutdowns++
        await teardown
      },
      () => {
        quits++
      }
    )
    let prevented = 0
    const event = {
      preventDefault: () => {
        prevented++
      },
    }

    barrier.handle(event)
    barrier.handle(event)
    assert.equal(prevented, 2)
    assert.equal(shutdowns, 1)
    assert.equal(quits, 0)
    release()
    await teardown
    await new Promise(resolveWait => setImmediate(resolveWait))
    assert.equal(quits, 1)

    barrier.handle(event)
    assert.equal(prevented, 2)
    assert.equal(shutdowns, 1)
  })
})
