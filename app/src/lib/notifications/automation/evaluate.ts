import {
  INotificationAutomationRule,
  isNotificationAutomationReceipt,
  matchNotificationRule,
  NotificationAutomationEntry,
} from './notification-automation'

/**
 * Select the enabled rules that match an entry, in declaration order.
 *
 * Pure and side-effect free — the caller dispatches the returned rules to the
 * main-process runners. Two guards are baked in here so no call site can forget
 * them:
 *  - a disabled rule never fires (arming is deliberate and per-session), and
 *  - a receipt this feature posted for a prior automation is skipped entirely,
 *    so an automation can never trigger on its own follow-up notification (the
 *    loop guard).
 */
export function evaluateNotificationAutomations(
  rules: ReadonlyArray<INotificationAutomationRule>,
  entry: NotificationAutomationEntry
): ReadonlyArray<INotificationAutomationRule> {
  if (isNotificationAutomationReceipt(entry)) {
    return []
  }

  return rules.filter(
    rule => rule.enabled && matchNotificationRule(rule, entry)
  )
}
