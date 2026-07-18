import type {
  INotificationEntry,
  NotificationCentreKind,
} from '../../../models/notification-centre'

/**
 * Pure model, template engine and validators for notification automations.
 *
 * This module has no runtime imports (the two `import type`s above are erased at
 * compile time): it is a self-contained, deterministic core shared by the
 * renderer store, the pure evaluator and the main-process runners. Every value
 * it consumes — a rules file loaded from disk, a template supplied by the user —
 * is treated as untrusted and coerced defensively.
 */

/** A webhook fires an HTTP(S) POST with a templated JSON/text body. */
export interface INotificationAutomationWebhookAction {
  readonly type: 'webhook'
  readonly url: string
  readonly bodyTemplate: string
}

/** A command spawns a local executable (never a shell) with templated argv. */
export interface INotificationAutomationCommandAction {
  readonly type: 'command'
  readonly exe: string
  readonly argTemplates: ReadonlyArray<string>
}

export type NotificationAutomationAction =
  | INotificationAutomationWebhookAction
  | INotificationAutomationCommandAction

/** A single user-defined automation rule. */
export interface INotificationAutomationRule {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  /** `'all'` fires for every kind; otherwise the entry kind must be listed. */
  readonly kinds: ReadonlyArray<NotificationCentreKind> | 'all'
  /** When set, only notifications from this repository match. */
  readonly repositoryId?: number
  /** When set, the entry title must match this pattern (regex, then substring). */
  readonly titlePattern?: string
  readonly action: NotificationAutomationAction
}

/** The on-disk automations file format. */
export interface INotificationAutomationConfig {
  readonly version: 1
  readonly rules: ReadonlyArray<INotificationAutomationRule>
}

/** IPC payload asking the main process to run a single rule against an entry. */
export interface INotificationAutomationRunRequest {
  readonly rule: INotificationAutomationRule
  readonly entry: NotificationAutomationEntry
}

/** Outcome of a webhook run reported back over IPC. */
export interface INotificationWebhookResult {
  readonly ok: boolean
  readonly status?: number
  /** A short, bounded snippet of the response body (for the receipt). */
  readonly body?: string
  /** Set when the run was refused or failed before/without an HTTP status. */
  readonly reason?: string
}

/** Outcome of a command run reported back over IPC. */
export interface INotificationCommandResult {
  readonly ok: boolean
  readonly code?: number
  /** A short, bounded snippet of the combined output (for the receipt). */
  readonly output?: string
  /** Set when the run was refused (e.g. an unsafe arg) or failed to spawn. */
  readonly reason?: string
}

/** The current version of the on-disk automations file format. */
export const NotificationAutomationConfigVersion = 1

/**
 * Notifications posted by the automation runner itself are tagged with this
 * title prefix (kind `'info'`) so the trigger can skip them and never fire an
 * automation on the receipt of a previous automation — the loop guard.
 */
export const NotificationAutomationReceiptPrefix = 'Automation: '

/** Upper bound on a filled template, so a runaway body can never be unbounded. */
export const NotificationTemplateMaxLength = 16 * 1024

/**
 * Arguments that may safely reach a spawned process / cmd.exe command line.
 * Anything else (quotes, `%`, `^`, `&`, `|`, redirects, spaces, `{`/`}`, …)
 * could be reinterpreted by a shell, so a templated arg that fails this test is
 * refused rather than escaped. Mirrors `SAFE_BATCH_ARG` in build-run/runner.ts;
 * the two must stay in lockstep.
 */
export const SAFE_NOTIFICATION_ARG = /^[A-Za-z0-9._+=:,@/\\-]+$/

/**
 * The notification-entry fields a template or a match may read. A structural
 * subset of {@link INotificationEntry} so callers (and tests) can pass a plain
 * object without constructing a full entry.
 */
export type NotificationAutomationEntry = Pick<
  INotificationEntry,
  'id' | 'kind' | 'title' | 'body' | 'createdAt' | 'repositoryId'
>

/**
 * The known kinds, duplicated from notification-centre.ts to keep this module
 * import-free. Kept in sync with `NotificationCentreKind` (source of truth).
 */
const notificationKinds: ReadonlySet<NotificationCentreKind> =
  new Set<NotificationCentreKind>([
    'pr-review-submit',
    'pr-comment',
    'pr-checks-failed',
    'app-error',
    'clone-batch',
    'auto-commit',
    'merge-all',
    'auto-pull',
    'cheap-lfs',
    'info',
  ])

/** The placeholders a template may reference. `{repo}`/`{owner}` are left as-is. */
const templateTokenPattern = /\{(id|kind|title|body|repositoryId|createdAt)\}/g

/**
 * Substitute the supported placeholders into a template. Unknown tokens (e.g.
 * `{repo}` / `{owner}`, which the store cannot resolve) are left verbatim. The
 * result is truncated to {@link NotificationTemplateMaxLength}.
 */
export function fillNotificationTemplate(
  template: string,
  entry: NotificationAutomationEntry
): string {
  const filled = template.replace(templateTokenPattern, (match, token) => {
    switch (token) {
      case 'id':
        return entry.id
      case 'kind':
        return entry.kind
      case 'title':
        return entry.title
      case 'body':
        return entry.body
      case 'repositoryId':
        return entry.repositoryId === undefined
          ? ''
          : String(entry.repositoryId)
      case 'createdAt':
        return entry.createdAt
      default:
        return match
    }
  })

  return filled.length > NotificationTemplateMaxLength
    ? filled.slice(0, NotificationTemplateMaxLength)
    : filled
}

/**
 * True when a rule matches an entry: kind (`'all'` or listed), repositoryId
 * (undefined = any) and titlePattern (compiled as a RegExp — a plain substring
 * is itself a valid RegExp; an invalid pattern never matches).
 */
export function matchNotificationRule(
  rule: INotificationAutomationRule,
  entry: NotificationAutomationEntry
): boolean {
  if (rule.kinds !== 'all' && !rule.kinds.includes(entry.kind)) {
    return false
  }

  if (
    rule.repositoryId !== undefined &&
    rule.repositoryId !== entry.repositoryId
  ) {
    return false
  }

  if (
    rule.titlePattern !== undefined &&
    rule.titlePattern.length > 0 &&
    !matchesTitlePattern(rule.titlePattern, entry.title)
  ) {
    return false
  }

  return true
}

function matchesTitlePattern(pattern: string, title: string): boolean {
  // The pattern is compiled as a RegExp — a plain substring is itself a valid
  // RegExp, so ordinary text still matches. A syntactically invalid pattern (or
  // an absurdly long one, a ReDoS guard for synced/restored files) never
  // matches, so a malformed rule silently does nothing rather than throwing.
  if (pattern.length > 1024) {
    return false
  }
  try {
    return new RegExp(pattern).test(title)
  } catch {
    return false
  }
}

/** True when an entry is a receipt this feature posted for a prior automation. */
export function isNotificationAutomationReceipt(
  entry: Pick<NotificationAutomationEntry, 'kind' | 'title'>
): boolean {
  return (
    entry.kind === 'info' &&
    entry.title.startsWith(NotificationAutomationReceiptPrefix)
  )
}

/**
 * Parse an automations file. Defensive by construction: anything unknown, of the
 * wrong version, or structurally invalid yields an empty config, and each rule
 * is coerced independently (malformed rules are dropped).
 *
 * SAFETY (untrusted-on-load): the automations file lives in a Git repository
 * that can be restored, synced or imported, so a rule arriving from disk must
 * never be able to fire. Every parsed rule therefore has `enabled` clamped to
 * `false` here. Arming is a deliberate, per-session `setRuleEnabled(true)` call
 * whose `true` is persisted but re-clamped to `false` on the next load.
 */
export function parseNotificationAutomationConfig(
  text: string
): INotificationAutomationConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return emptyConfig()
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { version?: unknown }).version !==
      NotificationAutomationConfigVersion
  ) {
    return emptyConfig()
  }

  const rawRules = (parsed as { rules?: unknown }).rules
  if (!Array.isArray(rawRules)) {
    return emptyConfig()
  }

  const rules: Array<INotificationAutomationRule> = []
  for (const candidate of rawRules) {
    const rule = coerceRule(candidate)
    if (rule !== null) {
      rules.push(rule)
    }
  }

  return { version: NotificationAutomationConfigVersion, rules }
}

/** Serialize a config to the pretty-printed on-disk format. */
export function serializeNotificationAutomationConfig(
  config: INotificationAutomationConfig
): string {
  const normalized: INotificationAutomationConfig = {
    version: NotificationAutomationConfigVersion,
    rules: config.rules,
  }
  return JSON.stringify(normalized, null, 2) + '\n'
}

/**
 * Validate a webhook URL, mirroring the release-transfer endpoint guard: http/s
 * only, no embedded credentials, and no query string or fragment (notification
 * content is templated only into the request body, never the URL). Returns an
 * error message for the UI, or `null` when the URL is acceptable.
 */
export function validateWebhookUrl(url: string): string | null {
  if (typeof url !== 'string' || url.length === 0) {
    return 'Enter a webhook URL.'
  }
  if (url.length > 2048) {
    return 'The webhook URL is too long.'
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'The webhook URL is not a valid URL.'
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'The webhook URL must use http or https.'
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return 'The webhook URL must not contain a username or password.'
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    return 'The webhook URL must not contain a query string or fragment; notification content is sent only in the request body.'
  }

  return null
}

/**
 * Validate a command template, mirroring the batch-spawn allow-list applied to
 * the STATIC parts of each arg template. The `{placeholder}` tokens are stripped
 * before the check because their substituted values are validated again at run
 * time (a defence that refuses metacharacters rather than escaping them).
 * Returns an error message for the UI, or `null` when acceptable.
 */
export function validateCommandTemplate(
  exe: string,
  argTemplates: ReadonlyArray<string>
): string | null {
  if (typeof exe !== 'string' || exe.length === 0) {
    return 'Enter a command to run.'
  }
  if (/["%^&|<>!]/.test(exe)) {
    return 'The command path contains characters a shell could reinterpret.'
  }
  if (!Array.isArray(argTemplates)) {
    return 'The command arguments are invalid.'
  }

  for (const template of argTemplates) {
    if (typeof template !== 'string') {
      return 'The command arguments are invalid.'
    }
    const staticParts = template.replace(templateTokenPattern, '')
    if (staticParts.length > 0 && !SAFE_NOTIFICATION_ARG.test(staticParts)) {
      return `The argument "${template}" contains characters that are not allowed (letters, numbers and ._+=:,@/\\- plus {placeholders}).`
    }
  }

  return null
}

function emptyConfig(): INotificationAutomationConfig {
  return { version: NotificationAutomationConfigVersion, rules: [] }
}

function coerceRule(value: unknown): INotificationAutomationRule | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    return null
  }
  if (typeof raw.name !== 'string') {
    return null
  }

  const kinds = coerceKinds(raw.kinds)
  if (kinds === null) {
    return null
  }

  const action = coerceAction(raw.action)
  if (action === null) {
    return null
  }

  const rule: INotificationAutomationRule = {
    id: raw.id,
    name: raw.name,
    // SAFETY (untrusted-on-load): always false on load — see the doc comment on
    // parseNotificationAutomationConfig. Arming is a deliberate per-session call.
    enabled: false,
    kinds,
    action,
    ...(typeof raw.repositoryId === 'number' &&
    Number.isSafeInteger(raw.repositoryId)
      ? { repositoryId: raw.repositoryId }
      : {}),
    ...(typeof raw.titlePattern === 'string'
      ? { titlePattern: raw.titlePattern }
      : {}),
  }

  return rule
}

function coerceKinds(
  value: unknown
): ReadonlyArray<NotificationCentreKind> | 'all' | null {
  if (value === 'all') {
    return 'all'
  }
  if (!Array.isArray(value)) {
    return null
  }

  const kinds: Array<NotificationCentreKind> = []
  for (const candidate of value) {
    if (
      typeof candidate === 'string' &&
      notificationKinds.has(candidate as NotificationCentreKind)
    ) {
      kinds.push(candidate as NotificationCentreKind)
    }
  }
  return kinds
}

function coerceAction(value: unknown): NotificationAutomationAction | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const raw = value as Record<string, unknown>
  if (raw.type === 'webhook') {
    if (typeof raw.url !== 'string' || typeof raw.bodyTemplate !== 'string') {
      return null
    }
    return { type: 'webhook', url: raw.url, bodyTemplate: raw.bodyTemplate }
  }

  if (raw.type === 'command') {
    if (typeof raw.exe !== 'string' || !Array.isArray(raw.argTemplates)) {
      return null
    }
    const argTemplates: Array<string> = []
    for (const candidate of raw.argTemplates) {
      if (typeof candidate !== 'string') {
        return null
      }
      argTemplates.push(candidate)
    }
    return { type: 'command', exe: raw.exe, argTemplates }
  }

  return null
}
