import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it } from 'node:test'
import assert from 'node:assert'

import { NotificationAutomationStore } from '../../src/lib/stores/notification-automation-store'
import {
  INotificationAutomationRule,
  serializeNotificationAutomationConfig,
} from '../../src/lib/notifications/automation/notification-automation'
import { ensureProfileRepository } from '../../src/lib/profiles/profile-git'
import { writeCrashSafeText } from '../../src/lib/crash-safe-file'
import { Repository } from '../../src/models/repository'

interface IStoreHarness {
  enabled: boolean
  rules: ReadonlyArray<INotificationAutomationRule>
  repository: Repository | null
  initialize: () => Promise<void>
  persist: (description: string) => Promise<void>
  reload: () => Promise<void>
}

const rule = (
  overrides: Partial<INotificationAutomationRule> = {}
): INotificationAutomationRule => ({
  id: 'r1',
  name: 'Ping ops',
  enabled: false,
  kinds: 'all',
  action: {
    type: 'webhook',
    url: 'https://example.com/hook',
    bodyTemplate: '{}',
  },
  ...overrides,
})

const createHarness = (rules: ReadonlyArray<INotificationAutomationRule>) => {
  const store = new NotificationAutomationStore()
  const harness = store as unknown as IStoreHarness
  const descriptions = new Array<string>()

  harness.enabled = true
  harness.rules = rules
  harness.initialize = async () => {}
  harness.persist = async description => {
    descriptions.push(description)
  }

  return { store, harness, descriptions }
}

describe('NotificationAutomationStore mutations', () => {
  it('adds, updates and removes a rule, persisting each action once', async () => {
    const { store, harness, descriptions } = createHarness([])

    await store.saveRule(rule({ id: 'a', name: 'A' }))
    await store.saveRule(rule({ id: 'a', name: 'A renamed' }))
    await store.removeRule('a')

    assert.deepEqual(descriptions, [
      'Add automation: A',
      'Update automation: A renamed',
      'Remove automation: A renamed',
    ])
    assert.equal(harness.rules.length, 0)
  })

  it('arms a rule (persisting enabled: true) and disarms it', async () => {
    const { store, harness, descriptions } = createHarness([
      rule({ id: 'a', enabled: false }),
    ])

    await store.setRuleEnabled('a', true)
    assert.equal(harness.rules[0].enabled, true)

    await store.setRuleEnabled('a', false)
    assert.equal(harness.rules[0].enabled, false)

    assert.deepEqual(descriptions, [
      'Arm automation: Ping ops',
      'Disarm automation: Ping ops',
    ])
  })

  it('ignores a no-op enable toggle', async () => {
    const { store, descriptions } = createHarness([
      rule({ id: 'a', enabled: false }),
    ])
    await store.setRuleEnabled('a', false)
    assert.deepEqual(descriptions, [])
  })
})

describe('NotificationAutomationStore untrusted-on-load', () => {
  it('re-clamps a rule armed on disk back to disabled on reload', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'automation-store-'))
    t.after(() => rm(directory, { recursive: true, force: true }))

    const repository = await ensureProfileRepository(directory)
    const path = join(directory, 'automations.json')

    // Simulate a synced/restored file that arrived armed.
    await writeCrashSafeText(
      path,
      serializeNotificationAutomationConfig({
        version: 1,
        rules: [rule({ id: 'armed', enabled: true })],
      }),
      { validatePrevious: () => true }
    )

    const store = new NotificationAutomationStore()
    const harness = store as unknown as IStoreHarness
    harness.enabled = true
    harness.repository = repository

    await store.reload()

    assert.equal(harness.rules.length, 1)
    assert.equal(
      harness.rules[0].enabled,
      false,
      'a rule that arrived armed on disk must load disarmed'
    )
  })
})
