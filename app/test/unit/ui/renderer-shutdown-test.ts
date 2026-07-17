import assert from 'node:assert'
import { describe, it } from 'node:test'
import { RendererShutdownCoordinator } from '../../../src/ui/lib/renderer-shutdown'

describe('RendererShutdownCoordinator', () => {
  it('shares one in-flight drain across racing quit requests and can reset', async () => {
    let releaseFirst!: () => void
    let runs = 0
    const firstDrain = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const coordinator = new RendererShutdownCoordinator()
    coordinator.configure([
      {
        name: 'profile settings',
        run: async () => {
          runs++
          await firstDrain
        },
      },
    ])

    const first = coordinator.prepare()
    const racing = coordinator.prepare()
    assert.strictEqual(racing, first)
    assert.equal(runs, 1)

    releaseFirst()
    assert.deepEqual(await first, {
      timedOut: false,
      failedTaskNames: [],
      pendingTaskNames: [],
    })

    assert.strictEqual(coordinator.prepare(), first)
    coordinator.reset()
    await coordinator.prepare()
    assert.equal(runs, 2)
  })

  it('does not run a pending terminal action after quit is cancelled', async () => {
    let release!: () => void
    const drain = new Promise<void>(resolve => {
      release = resolve
    })
    const coordinator = new RendererShutdownCoordinator()
    coordinator.configure([{ name: 'profile settings', run: () => drain }])
    let terminalActionRan = false

    const pendingQuit = coordinator.runAfterPreparation(() => {
      terminalActionRan = true
    })
    coordinator.reset()
    release()
    await pendingQuit

    assert.equal(terminalActionRan, false)
  })

  it('contains one rejection while awaiting every sibling store', async () => {
    const reports = new Array<{ message: string; error: Error }>()
    let notificationFlushed = false
    const coordinator = new RendererShutdownCoordinator(
      10_000,
      (message, error) => reports.push({ message, error })
    )
    coordinator.configure([
      {
        name: 'profile settings',
        run: async () => {
          throw new Error('disk unavailable')
        },
      },
      {
        name: 'notification centre',
        run: async () => {
          await Promise.resolve()
          notificationFlushed = true
        },
      },
    ])

    let terminalActionRan = false
    const result = await coordinator.runAfterPreparation(() => {
      terminalActionRan = true
    })
    assert.equal(notificationFlushed, true)
    assert.equal(terminalActionRan, true)
    assert.deepEqual(result, {
      timedOut: false,
      failedTaskNames: ['profile settings'],
      pendingTaskNames: [],
    })
    assert.equal(reports.length, 1)
    assert.match(reports[0].message, /profile settings/)
    assert.equal(reports[0].error.message, 'disk unavailable')
  })

  it('continues after a hard timeout and reports every pending store', async () => {
    let fireTimeout: (() => void) | null = null
    let timeoutDelay = 0
    const reports = new Array<string>()
    const coordinator = new RendererShutdownCoordinator(
      25,
      message => reports.push(message),
      {
        setTimeout: (callback, milliseconds) => {
          fireTimeout = callback
          timeoutDelay = milliseconds
          return undefined as never
        },
        clearTimeout: () => {},
      }
    )
    coordinator.configure([
      {
        name: 'clone recovery journal',
        run: () => new Promise<void>(() => {}),
      },
      {
        name: 'notification centre',
        run: async () => {},
      },
    ])

    let terminalActionRan = false
    const preparation = coordinator.runAfterPreparation(() => {
      terminalActionRan = true
    })
    await Promise.resolve()
    assert.equal(timeoutDelay, 25)
    assert.notEqual(fireTimeout, null)
    assert.equal(terminalActionRan, false)
    fireTimeout!()

    assert.deepEqual(await preparation, {
      timedOut: true,
      failedTaskNames: [],
      pendingTaskNames: ['clone recovery journal'],
    })
    assert.equal(reports.length, 1)
    assert.match(reports[0], /timed out/)
    assert.equal(terminalActionRan, true)
  })

  it('contains a broken failure reporter too', async () => {
    const coordinator = new RendererShutdownCoordinator(10_000, () => {
      throw new Error('logger unavailable')
    })
    coordinator.configure([
      {
        name: 'profile settings',
        run: async () => {
          throw new Error('write failed')
        },
      },
    ])

    assert.deepEqual(await coordinator.prepare(), {
      timedOut: false,
      failedTaskNames: ['profile settings'],
      pendingTaskNames: [],
    })
  })
})
