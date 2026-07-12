/**
 * The kind of an in-app notification. Drives the icon, colour and grouping of
 * each entry in the notification centre (see design-spec-overlays §9).
 */
export type NotificationCentreKind =
  | 'pr-review-submit'
  | 'pr-comment'
  | 'pr-checks-failed'
  | 'app-error'
  | 'clone-batch'
  | 'auto-commit'
  | 'merge-all'
  | 'auto-pull'
  | 'info'

/** An optional action performed when a notification row is clicked. */
export type NotificationCentreAction =
  | { readonly kind: 'open-repository'; readonly repositoryId: number }
  | { readonly kind: 'open-pull-request'; readonly url: string }
  | { readonly kind: 'open-url'; readonly url: string }

/** A single persisted notification entry. */
export interface INotificationEntry {
  /** A stable, unique identifier (uuid). */
  readonly id: string
  readonly kind: NotificationCentreKind
  readonly title: string
  readonly body: string
  /** ISO-8601 timestamp of when the entry was created (or last coalesced). */
  readonly createdAt: string
  readonly read: boolean
  /** The account this notification relates to, for future filtering. */
  readonly accountKey?: string
  /** The repository this notification relates to, when applicable. */
  readonly repositoryId?: number
  readonly action?: NotificationCentreAction
}

/** The shape a caller supplies to create a notification. */
export interface INotificationInput {
  readonly kind: NotificationCentreKind
  readonly title: string
  readonly body: string
  readonly accountKey?: string
  readonly repositoryId?: number
  readonly action?: NotificationCentreAction
}

/** The on-disk notifications file format. */
export interface INotificationLog {
  readonly version: 1
  readonly entries: ReadonlyArray<INotificationEntry>
}

/** The current version of the on-disk notifications file format. */
export const NotificationLogVersion = 1

/** Maximum number of notifications retained. Oldest are pruned beyond this. */
export const NotificationCentreCap = 500

/**
 * When an identical notification (same kind + title + body) arrives within this
 * window of the previous one, the existing entry is coalesced (moved to the top
 * and re-timestamped) instead of appending a duplicate — a storm guard.
 */
export const NotificationDedupeWindowMs = 60_000

/** The result of inserting a notification into an ordered (newest-first) list. */
export interface INotificationInsertResult {
  readonly entries: ReadonlyArray<INotificationEntry>
  /** The entry that was created or coalesced. */
  readonly entry: INotificationEntry
  /** True when an existing recent entry was coalesced rather than appended. */
  readonly deduped: boolean
  /** How many oldest entries were pruned to honour {@link NotificationCentreCap}. */
  readonly pruned: number
}

/** Shape a {@link INotificationInput} into a full, unread entry. */
export function shapeNotificationEntry(
  input: INotificationInput,
  id: string,
  createdAt: Date
): INotificationEntry {
  const entry: INotificationEntry = {
    id,
    kind: input.kind,
    title: input.title,
    body: input.body,
    createdAt: createdAt.toISOString(),
    read: false,
  }

  return {
    ...entry,
    ...(input.accountKey !== undefined ? { accountKey: input.accountKey } : {}),
    ...(input.repositoryId !== undefined
      ? { repositoryId: input.repositoryId }
      : {}),
    ...(input.action !== undefined ? { action: input.action } : {}),
  }
}

/**
 * Insert a notification into a newest-first list, applying storm dedupe and the
 * retention cap. Pure — the store passes in the id and clock so the behaviour is
 * fully deterministic for testing.
 */
export function insertNotification(
  entries: ReadonlyArray<INotificationEntry>,
  input: INotificationInput,
  id: string,
  now: Date,
  dedupeWindowMs: number = NotificationDedupeWindowMs,
  cap: number = NotificationCentreCap
): INotificationInsertResult {
  const nowMs = now.getTime()

  const duplicateIndex = entries.findIndex(
    entry =>
      entry.kind === input.kind &&
      entry.title === input.title &&
      entry.body === input.body &&
      nowMs - new Date(entry.createdAt).getTime() < dedupeWindowMs
  )

  if (duplicateIndex !== -1) {
    const existing = entries[duplicateIndex]
    const coalesced: INotificationEntry = {
      ...existing,
      ...shapeNotificationEntry(input, existing.id, now),
    }
    const remaining = entries.filter((_, index) => index !== duplicateIndex)
    return {
      entries: [coalesced, ...remaining],
      entry: coalesced,
      deduped: true,
      pruned: 0,
    }
  }

  const entry = shapeNotificationEntry(input, id, now)
  const withNew = [entry, ...entries]
  const pruned = Math.max(0, withNew.length - cap)
  const capped = pruned > 0 ? withNew.slice(0, cap) : withNew

  return { entries: capped, entry, deduped: false, pruned }
}

/** Number of unread entries in a list. */
export function countUnread(
  entries: ReadonlyArray<INotificationEntry>
): number {
  return entries.reduce((total, entry) => (entry.read ? total : total + 1), 0)
}

/** Serialize an entry list to the pretty-printed on-disk format. */
export function serializeNotificationLog(
  entries: ReadonlyArray<INotificationEntry>
): string {
  const log: INotificationLog = { version: NotificationLogVersion, entries }
  return JSON.stringify(log, null, 2) + '\n'
}

/**
 * Parse a notifications file, returning null when the payload is missing, is not
 * valid JSON, has an unsupported version, or is otherwise structurally corrupt.
 */
export function parseNotificationLog(raw: string): INotificationLog | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== NotificationLogVersion
  ) {
    return null
  }

  const entries = (parsed as { entries?: unknown }).entries
  if (!Array.isArray(entries)) {
    return null
  }

  const valid: Array<INotificationEntry> = []
  for (const candidate of entries) {
    const entry = coerceEntry(candidate)
    if (entry === null) {
      return null
    }
    valid.push(entry)
  }

  return { version: NotificationLogVersion, entries: valid }
}

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
    'info',
  ])

function coerceEntry(value: unknown): INotificationEntry | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as Record<string, unknown>
  const { id, kind, title, body, createdAt, read } = candidate

  if (
    typeof id !== 'string' ||
    typeof kind !== 'string' ||
    !notificationKinds.has(kind as NotificationCentreKind) ||
    typeof title !== 'string' ||
    typeof body !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof read !== 'boolean'
  ) {
    return null
  }

  const entry: INotificationEntry = {
    id,
    kind: kind as NotificationCentreKind,
    title,
    body,
    createdAt,
    read,
  }

  return {
    ...entry,
    ...(typeof candidate.accountKey === 'string'
      ? { accountKey: candidate.accountKey }
      : {}),
    ...(typeof candidate.repositoryId === 'number'
      ? { repositoryId: candidate.repositoryId }
      : {}),
    ...(isNotificationAction(candidate.action)
      ? { action: candidate.action }
      : {}),
  }
}

function isNotificationAction(
  value: unknown
): value is NotificationCentreAction {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>
  switch (candidate.kind) {
    case 'open-repository':
      return typeof candidate.repositoryId === 'number'
    case 'open-pull-request':
    case 'open-url':
      return typeof candidate.url === 'string'
    default:
      return false
  }
}
