import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  AutomationScheduler,
  IAutomationSchedulerTimer,
  automationIntervalMilliseconds,
} from '../../src/lib/stores/helpers/automation-scheduler'
import { DefaultAutomationSettings } from '../../src/lib/automation/automation-settings'

describe('automation scheduler', () => {
  it('keeps independent timer chains and re-reads settings per tick', async () => {
    const scheduled: Array<{ callback: () => void; delay: number }> = []
    const timer: IAutomationSchedulerTimer = {
      setTimeout: (callback, delay) => {
        scheduled.push({ callback, delay })
        return scheduled.length
      },
      clearTimeout: () => {},
    }
    let settings = { ...DefaultAutomationSettings }
    let commits = 0
    let pulls = 0
    const scheduler = new AutomationScheduler(
      () => settings,
      async () => {
        commits++
      },
      async () => {
        pulls++
      },
      () => {},
      timer
    )

    scheduler.start()
    assert.deepEqual(
      scheduled.map(item => item.delay),
      [automationIntervalMilliseconds(30), automationIntervalMilliseconds(15)]
    )

    settings = {
      ...settings,
      autoCommitPushEnabled: true,
      autoCommitPushInterval: 5,
    }
    scheduled[0].callback()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(commits, 1)
    assert.equal(pulls, 0)
    assert.equal(scheduled[2].delay, automationIntervalMilliseconds(5))
    scheduler.stop()
  })
})
