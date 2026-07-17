import assert from 'node:assert'
import { describe, it } from 'node:test'

import { createCrashRecovery } from '../../../src/main-process/crash-recovery'

describe('crash recovery coordinator', () => {
  it('quits after fallback rejection and relaunch failure', async () => {
    const failures: unknown[] = []
    let relaunches = 0
    let quits = 0
    const recover = createCrashRecovery({
      showFallback: async () => {
        throw new Error('dialog unavailable')
      },
      relaunch: () => {
        relaunches++
        throw new Error('relaunch unavailable')
      },
      quit: () => {
        quits++
      },
      reportFailure: error => failures.push(error),
      shouldRelaunch: true,
    })

    await recover(true)

    assert.equal(relaunches, 1)
    assert.equal(quits, 1)
    assert.equal(failures.length, 2)
  })

  it('runs only one recovery when close races renderer failure', async () => {
    let releaseFallback: (() => void) | undefined
    const fallback = new Promise<void>(resolve => {
      releaseFallback = resolve
    })
    let fallbacks = 0
    let relaunches = 0
    let quits = 0
    const recover = createCrashRecovery({
      showFallback: () => {
        fallbacks++
        return fallback
      },
      relaunch: () => relaunches++,
      quit: () => quits++,
      reportFailure: () => {},
      shouldRelaunch: true,
    })

    const failedRenderer = recover(true)
    await recover(false)
    releaseFallback?.()
    await failedRenderer

    assert.equal(fallbacks, 1)
    assert.equal(relaunches, 1)
    assert.equal(quits, 1)
  })

  it('does not relaunch development builds', async () => {
    let relaunches = 0
    let quits = 0
    const recover = createCrashRecovery({
      showFallback: async () => {},
      relaunch: () => relaunches++,
      quit: () => quits++,
      reportFailure: () => {},
      shouldRelaunch: false,
    })

    await recover(false)
    assert.equal(relaunches, 0)
    assert.equal(quits, 1)
  })
})
