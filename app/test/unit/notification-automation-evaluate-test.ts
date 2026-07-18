import { describe, it } from 'node:test'
import assert from 'node:assert'

import { evaluateNotificationAutomations } from '../../src/lib/notifications/automation/evaluate'
import {
  INotificationAutomationRule,
  NotificationAutomationEntry,
  NotificationAutomationReceiptPrefix,
} from '../../src/lib/notifications/automation/notification-automation'

const entry = (
  overrides: Partial<NotificationAutomationEntry> = {}
): NotificationAutomationEntry => ({
  id: 'e',
  kind: 'pr-checks-failed',
  title: 'Checks failed',
  body: 'red',
  createdAt: '2026-07-17T12:00:00.000Z',
  repositoryId: 1,
  ...overrides,
})

const rule = (
  overrides: Partial<INotificationAutomationRule> = {}
): INotificationAutomationRule => ({
  id: 'r',
  name: 'R',
  enabled: true,
  kinds: 'all',
  action: { type: 'command', exe: 'echo', argTemplates: [] },
  ...overrides,
})

describe('evaluateNotificationAutomations', () => {
  it('returns only enabled, matching rules in order', () => {
    const armedMatch = rule({
      id: 'a',
      enabled: true,
      kinds: ['pr-checks-failed'],
    })
    const disarmedMatch = rule({
      id: 'b',
      enabled: false,
      kinds: ['pr-checks-failed'],
    })
    const armedMiss = rule({ id: 'c', enabled: true, kinds: ['pr-comment'] })
    const armedMatch2 = rule({ id: 'd', enabled: true, kinds: 'all' })

    const fired = evaluateNotificationAutomations(
      [armedMatch, disarmedMatch, armedMiss, armedMatch2],
      entry()
    )

    assert.deepEqual(
      fired.map(r => r.id),
      ['a', 'd']
    )
  })

  it('never fires a disabled rule', () => {
    assert.deepEqual(
      evaluateNotificationAutomations([rule({ enabled: false })], entry()),
      []
    )
  })

  it('skips automation receipts entirely (loop guard)', () => {
    const receipt = entry({
      kind: 'info',
      title: `${NotificationAutomationReceiptPrefix}Ping ops`,
      body: 'Webhook responded 200',
    })
    // Even an armed 'all' rule must not fire on a receipt notification.
    assert.deepEqual(
      evaluateNotificationAutomations([rule({ kinds: 'all' })], receipt),
      []
    )
  })

  it('does fire on an ordinary info notification that is not a receipt', () => {
    const info = entry({ kind: 'info', title: 'Something informational' })
    assert.equal(
      evaluateNotificationAutomations([rule({ kinds: ['info'] })], info).length,
      1
    )
  })
})
