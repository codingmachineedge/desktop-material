import {
  IApplicableBranchRule,
  IApplicableBranchRuleset,
  IClassicBranchProtectionEvidence,
} from './effective-branch-rules'
import { IApplicableBranchRulesResult } from './effective-branch-rules-loader'

export interface IRawClassicBranchProtection {
  readonly required_status_checks?: {
    readonly strict?: unknown
    readonly contexts?: unknown
    readonly checks?: unknown
  } | null
  readonly required_pull_request_reviews?: {
    readonly dismiss_stale_reviews?: unknown
    readonly require_code_owner_reviews?: unknown
    readonly required_approving_review_count?: unknown
    readonly require_last_push_approval?: unknown
    readonly dismissal_restrictions?: unknown
    readonly bypass_pull_request_allowances?: unknown
  } | null
  readonly required_linear_history?: { readonly enabled?: unknown } | null
  readonly required_signatures?: { readonly enabled?: unknown } | null
  readonly allow_force_pushes?: { readonly enabled?: unknown } | null
  readonly allow_deletions?: { readonly enabled?: unknown } | null
  readonly required_conversation_resolution?: {
    readonly enabled?: unknown
  } | null
  readonly lock_branch?: { readonly enabled?: unknown } | null
  readonly allow_fork_syncing?: { readonly enabled?: unknown } | null
  readonly enforce_admins?: unknown
}

export interface IRawClassicPushControl {
  readonly pattern?: unknown
  readonly required_status_checks?: unknown
  readonly required_approving_review_count?: unknown
  readonly allow_actor?: unknown
  readonly required_signatures?: unknown
  readonly required_linear_history?: unknown
  readonly allow_deletions?: unknown
  readonly allow_force_pushes?: unknown
}

export interface IRawApplicableBranchRule {
  readonly type?: unknown
  readonly ruleset_id?: unknown
  readonly ruleset_source_type?: unknown
  readonly ruleset_source?: unknown
  readonly parameters?: unknown
}

export interface IRawApplicableBranchRuleset {
  readonly id?: unknown
  readonly name?: unknown
  readonly source_type?: unknown
  readonly source?: unknown
  readonly current_user_can_bypass?: unknown
  readonly _links?: unknown
}

function finiteCount(value: unknown, maximum: number): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
    ? value
    : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface IActorCollectionSummary {
  readonly configured: boolean | undefined
  readonly selectedUserIncluded: boolean | undefined
}

function actorCollectionSummary(
  value: unknown,
  accountLogin: string | undefined
): IActorCollectionSummary {
  if (value === undefined) {
    return { configured: false, selectedUserIncluded: false }
  }
  if (!isObject(value)) {
    return { configured: undefined, selectedUserIncluded: undefined }
  }

  const users = value.users ?? []
  const teams = value.teams ?? []
  const apps = value.apps ?? []
  if (![users, teams, apps].every(Array.isArray)) {
    return { configured: undefined, selectedUserIncluded: undefined }
  }
  if (
    !(users as ReadonlyArray<unknown>).every(
      user => isObject(user) && typeof user.login === 'string'
    ) ||
    !(teams as ReadonlyArray<unknown>).every(isObject) ||
    !(apps as ReadonlyArray<unknown>).every(isObject)
  ) {
    return { configured: undefined, selectedUserIncluded: undefined }
  }

  const configured =
    (users as ReadonlyArray<unknown>).length > 0 ||
    (teams as ReadonlyArray<unknown>).length > 0 ||
    (apps as ReadonlyArray<unknown>).length > 0
  if (!configured) {
    return { configured: false, selectedUserIncluded: false }
  }

  const normalizedLogin = accountLogin?.trim().toLowerCase()
  if (
    normalizedLogin !== undefined &&
    normalizedLogin.length > 0 &&
    (users as ReadonlyArray<Readonly<Record<string, unknown>>>).some(
      user => user.login?.toString().toLowerCase() === normalizedLogin
    )
  ) {
    return { configured: true, selectedUserIncluded: true }
  }
  if (
    (teams as ReadonlyArray<unknown>).length > 0 ||
    ((users as ReadonlyArray<unknown>).length > 0 &&
      normalizedLogin === undefined)
  ) {
    return { configured: true, selectedUserIncluded: undefined }
  }
  return { configured: true, selectedUserIncluded: false }
}

function enforceAdminsEnabled(value: unknown): boolean | undefined {
  return isObject(value) ? optionalBoolean(value.enabled) : undefined
}

function settingEnabled(
  setting: { readonly enabled?: unknown } | null | undefined
): boolean | undefined {
  return setting === null
    ? false
    : setting === undefined
    ? undefined
    : optionalBoolean(setting.enabled)
}

function statusCheckNames(
  status: IRawClassicBranchProtection['required_status_checks']
): ReadonlyArray<string> | undefined {
  if (status === null) {
    return []
  }
  if (status === undefined) {
    return undefined
  }

  const contexts = status.contexts
  const checks = status.checks
  if (contexts === undefined && checks === undefined) {
    return undefined
  }
  if (
    (contexts !== undefined &&
      (!Array.isArray(contexts) ||
        contexts.some(
          context => typeof context !== 'string' || context.trim().length === 0
        ))) ||
    (checks !== undefined &&
      (!Array.isArray(checks) ||
        checks.some(
          check =>
            typeof check !== 'object' ||
            check === null ||
            !('context' in check) ||
            typeof check.context !== 'string' ||
            check.context.trim().length === 0
        )))
  ) {
    return undefined
  }

  const checkNames = (checks ?? []).map(check =>
    'context' in check ? (check.context as string) : ''
  )
  return [
    ...((contexts as ReadonlyArray<string> | undefined) ?? []),
    ...checkNames,
  ]
}

export function normalizeClassicBranchProtection(
  protection: IRawClassicBranchProtection,
  accountLogin?: string
): IClassicBranchProtectionEvidence {
  const pullRequest = protection.required_pull_request_reviews
  const pullRequestConfigured =
    pullRequest === null ? false : pullRequest === undefined ? undefined : true
  const statusChecks = protection.required_status_checks
  const checksConfigured =
    statusChecks === null
      ? false
      : statusChecks === undefined
      ? undefined
      : true
  const dismissalRestrictions =
    pullRequest === null
      ? { configured: false, selectedUserIncluded: false }
      : pullRequest === undefined
      ? { configured: undefined, selectedUserIncluded: undefined }
      : actorCollectionSummary(pullRequest.dismissal_restrictions, accountLogin)
  const bypassAllowances =
    pullRequest === null
      ? { configured: false, selectedUserIncluded: false }
      : pullRequest === undefined
      ? { configured: undefined, selectedUserIncluded: undefined }
      : actorCollectionSummary(
          pullRequest.bypass_pull_request_allowances,
          accountLogin
        )

  return {
    protectionConfigured: true,
    pullRequestRequired: pullRequestConfigured,
    requiredReviewCount:
      pullRequest === null
        ? 0
        : pullRequest === undefined
        ? undefined
        : finiteCount(pullRequest.required_approving_review_count, 6),
    dismissStaleReviews:
      pullRequest === null
        ? false
        : pullRequest === undefined
        ? undefined
        : optionalBoolean(pullRequest.dismiss_stale_reviews),
    codeOwnerReviews:
      pullRequest === null
        ? false
        : pullRequest === undefined
        ? undefined
        : optionalBoolean(pullRequest.require_code_owner_reviews),
    lastPushApproval:
      pullRequest === null
        ? false
        : pullRequest === undefined
        ? undefined
        : optionalBoolean(pullRequest.require_last_push_approval),
    dismissalRestrictionsConfigured: dismissalRestrictions.configured,
    pullRequestBypassAllowancesConfigured: bypassAllowances.configured,
    pullRequestBypass: bypassAllowances.selectedUserIncluded,
    enforceAdmins: enforceAdminsEnabled(protection.enforce_admins),
    requiredChecksConfigured: checksConfigured,
    requiredChecks: statusCheckNames(statusChecks),
    strictChecks:
      statusChecks === null
        ? false
        : statusChecks === undefined
        ? undefined
        : optionalBoolean(statusChecks.strict),
    requiredSignatures: settingEnabled(protection.required_signatures),
    requiredLinearHistory: settingEnabled(protection.required_linear_history),
    deletionsAllowed: settingEnabled(protection.allow_deletions),
    forcePushesAllowed: settingEnabled(protection.allow_force_pushes),
    conversationResolution: settingEnabled(
      protection.required_conversation_resolution
    ),
    locked: settingEnabled(protection.lock_branch),
    forkSyncingAllowed: settingEnabled(protection.allow_fork_syncing),
  }
}

export function normalizeClassicPushControl(
  pushControl: IRawClassicPushControl
): IClassicBranchProtectionEvidence {
  const rawChecks = pushControl.required_status_checks
  const checks = Array.isArray(rawChecks)
    ? rawChecks.every(
        value => typeof value === 'string' && value.trim().length > 0
      )
      ? (rawChecks as ReadonlyArray<string>)
      : undefined
    : undefined

  return {
    pushAllowed: optionalBoolean(pushControl.allow_actor),
    requiredReviewCount: finiteCount(
      pushControl.required_approving_review_count,
      6
    ),
    requiredChecksConfigured:
      checks === undefined ? undefined : checks.length > 0,
    requiredChecks: checks,
  }
}

function normalizeApplicableRule(
  rule: IRawApplicableBranchRule
): IApplicableBranchRule | null {
  if (
    typeof rule.type !== 'string' ||
    rule.type.trim().length === 0 ||
    typeof rule.ruleset_id !== 'number' ||
    !Number.isSafeInteger(rule.ruleset_id) ||
    rule.ruleset_id <= 0
  ) {
    return null
  }
  const parameters = rule.parameters
  const hasParameters = Object.prototype.hasOwnProperty.call(rule, 'parameters')
  const parametersComplete = !hasParameters || isObject(parameters)
  return {
    type: rule.type,
    ruleset_id: rule.ruleset_id,
    ruleset_source_type:
      typeof rule.ruleset_source_type === 'string'
        ? rule.ruleset_source_type
        : undefined,
    ruleset_source:
      typeof rule.ruleset_source === 'string' ? rule.ruleset_source : undefined,
    parameters: isObject(parameters)
      ? (parameters as Readonly<Record<string, unknown>>)
      : undefined,
    parametersComplete,
  }
}

export function normalizeApplicableRules(
  rawRules: ReadonlyArray<IRawApplicableBranchRule>,
  complete = true
): IApplicableBranchRulesResult {
  const rules = rawRules.map(normalizeApplicableRule)
  return {
    rules: rules.filter((rule): rule is IApplicableBranchRule => rule !== null),
    complete: complete && rules.every(rule => rule !== null),
  }
}

export function normalizeApplicableRuleset(
  ruleset: IRawApplicableBranchRuleset,
  expectedId: number
): IApplicableBranchRuleset | null {
  if (
    typeof ruleset.id !== 'number' ||
    !Number.isSafeInteger(ruleset.id) ||
    ruleset.id <= 0 ||
    ruleset.id !== expectedId
  ) {
    return null
  }
  const bypass = ruleset.current_user_can_bypass
  const links = ruleset._links
  const html =
    typeof links === 'object' && links !== null && 'html' in links
      ? links.html
      : undefined
  const href =
    typeof html === 'object' && html !== null && 'href' in html
      ? html.href
      : undefined

  return {
    id: ruleset.id,
    name: typeof ruleset.name === 'string' ? ruleset.name : undefined,
    source_type:
      typeof ruleset.source_type === 'string' ? ruleset.source_type : undefined,
    source: typeof ruleset.source === 'string' ? ruleset.source : undefined,
    current_user_can_bypass:
      bypass === 'always' ||
      bypass === 'exempt' ||
      bypass === 'pull_requests_only' ||
      bypass === 'pull_request' ||
      bypass === 'never'
        ? bypass
        : undefined,
    _links: typeof href === 'string' ? { html: { href: href } } : undefined,
  }
}
