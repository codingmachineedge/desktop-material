import { createHash, randomUUID } from 'crypto'

/** The default number of transient errors retained for display. */
export const ErrorNoticeQueueLimit = 4

/** A hard ceiling prevents a caller from accidentally creating an unbounded UI. */
export const MaximumErrorNoticeQueueLimit = 8

export const MaximumErrorNoticeTitleLength = 120
export const MaximumErrorNoticeMessageLength = 600
export const MaximumErrorNoticeDetailsLength = 4_000
export const MaximumErrorNoticeDedupeKeyLength = 512
export const MaximumErrorNoticeIdLength = 128
export const MaximumErrorNoticeOccurrences = 999

const DefaultErrorNoticeTitle = 'Something went wrong'
const DefaultErrorNoticeMessage = 'An unexpected error occurred.'

/** A bounded transient error suitable for the non-modal notice stack. */
export interface IErrorNotice {
  /** Stable runtime identity used for dismissal and React keys. */
  readonly id: string

  readonly title: string
  readonly message: string

  /** Optional longer content opened through the notice's Details action. */
  readonly details: string | null

  /** Stable bounded fingerprint used to collapse repeated errors. */
  readonly dedupeKey: string

  /** Number of equal errors represented by this notice. */
  readonly occurrences: number

  readonly createdAt: number
  readonly updatedAt: number

  /** Optional narrowly-scoped recovery offered by this notice. */
  readonly action?: IErrorNoticeAction
}

export type IErrorNoticeAction = {
  readonly kind: 'remove-repository-lock'
  readonly repositoryId: number
}

/** Caller-owned error data before normalization and queue insertion. */
export interface IErrorNoticeInput {
  readonly id?: string
  readonly title?: string
  readonly message: string
  readonly details?: string | null

  /**
   * Use when several differently-worded failures represent one operation.
   * When omitted, the bounded title/message/details tuple is the fingerprint.
   */
  readonly dedupeKey?: string
  readonly action?: IErrorNoticeAction
}

export interface IEnqueueErrorNoticeOptions {
  readonly limit?: number
  readonly now?: () => number
  readonly createId?: () => string
}

export interface IEnqueueErrorNoticeResult {
  readonly notices: ReadonlyArray<IErrorNotice>
  readonly notice: IErrorNotice
  readonly deduplicated: boolean
  readonly droppedIds: ReadonlyArray<string>
}

function truncateText(value: string, maximumLength: number): string {
  const characters = Array.from(value)
  if (characters.length <= maximumLength) {
    return value
  }

  return `${characters.slice(0, maximumLength - 1).join('')}…`
}

function normalizeText(
  value: string | null | undefined,
  maximumLength: number,
  fallback: string
): string {
  const normalized = (value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\0/g, '')
    .trim()

  return truncateText(
    normalized.length > 0 ? normalized : fallback,
    maximumLength
  )
}

function normalizeOptionalText(
  value: string | null | undefined,
  maximumLength: number
): string | null {
  const normalized = normalizeText(value, maximumLength, '')
  return normalized.length > 0 ? normalized : null
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return ErrorNoticeQueueLimit
  }

  return Math.min(MaximumErrorNoticeQueueLimit, Math.max(1, Math.trunc(value)))
}

function normalizeTimestamp(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function normalizeId(
  value: string | undefined,
  createId: () => string
): string {
  const requested = normalizeOptionalText(value, MaximumErrorNoticeIdLength)
  if (requested !== null) {
    return requested
  }

  return (
    normalizeOptionalText(createId(), MaximumErrorNoticeIdLength) ??
    randomUUID()
  )
}

function uniqueId(
  requestedId: string,
  notices: ReadonlyArray<IErrorNotice>
): string {
  const existing = new Set(notices.map(notice => notice.id))
  if (!existing.has(requestedId)) {
    return requestedId
  }

  for (let suffix = 2; suffix <= MaximumErrorNoticeQueueLimit + 1; suffix++) {
    const suffixText = `-${suffix}`
    const prefixLength = MaximumErrorNoticeIdLength - suffixText.length
    const candidate = `${Array.from(requestedId)
      .slice(0, prefixLength)
      .join('')}${suffixText}`
    if (!existing.has(candidate)) {
      return candidate
    }
  }

  return randomUUID()
}

function normalizeInput(
  input: IErrorNoticeInput,
  now: number,
  createId: () => string,
  notices: ReadonlyArray<IErrorNotice>
): IErrorNotice {
  const title = normalizeText(
    input.title,
    MaximumErrorNoticeTitleLength,
    DefaultErrorNoticeTitle
  )
  const message = normalizeText(
    input.message,
    MaximumErrorNoticeMessageLength,
    DefaultErrorNoticeMessage
  )
  const details = normalizeOptionalText(
    input.details,
    MaximumErrorNoticeDetailsLength
  )
  const generatedDedupeKey = createHash('sha256')
    .update(`${title}\u0000${message}\u0000${details ?? ''}`)
    .digest('hex')
  const dedupeKey = normalizeText(
    input.dedupeKey,
    MaximumErrorNoticeDedupeKeyLength,
    generatedDedupeKey
  )
  const id = uniqueId(normalizeId(input.id, createId), notices)

  return {
    id,
    title,
    message,
    details,
    dedupeKey,
    occurrences: 1,
    createdAt: now,
    updatedAt: now,
    ...(input.action === undefined ? {} : { action: input.action }),
  }
}

/**
 * Insert a transient error, collapse an equal error, and retain only the newest
 * bounded set. A deduplicated notice keeps its identity and original timestamp
 * so an already-rendered card updates instead of being replaced.
 */
export function enqueueErrorNotice(
  notices: ReadonlyArray<IErrorNotice>,
  input: IErrorNoticeInput,
  options: IEnqueueErrorNoticeOptions = {}
): IEnqueueErrorNoticeResult {
  const now = normalizeTimestamp((options.now ?? Date.now)())
  const normalized = normalizeInput(
    input,
    now,
    options.createId ?? randomUUID,
    notices
  )

  let duplicateIndex = -1
  for (let index = notices.length - 1; index >= 0; index--) {
    if (notices[index].dedupeKey === normalized.dedupeKey) {
      duplicateIndex = index
      break
    }
  }

  const deduplicated = duplicateIndex >= 0
  const duplicate = deduplicated ? notices[duplicateIndex] : null
  const notice =
    duplicate === null
      ? normalized
      : {
          ...normalized,
          id: duplicate.id,
          createdAt: duplicate.createdAt,
          updatedAt: Math.max(duplicate.updatedAt, now),
          occurrences: Math.min(
            MaximumErrorNoticeOccurrences,
            Math.max(1, duplicate.occurrences) + 1
          ),
        }

  const withoutDuplicate = deduplicated
    ? notices.filter((_, index) => index !== duplicateIndex)
    : [...notices]
  const unbounded = [...withoutDuplicate, notice]
  const limit = normalizeLimit(options.limit)
  const dropped = unbounded.slice(0, Math.max(0, unbounded.length - limit))
  const bounded = unbounded.slice(-limit)

  return {
    notices: bounded,
    notice,
    deduplicated,
    droppedIds: dropped.map(item => item.id),
  }
}

/** Remove one transient error without disturbing the remaining order. */
export function dismissErrorNotice(
  notices: ReadonlyArray<IErrorNotice>,
  id: string
): ReadonlyArray<IErrorNotice> {
  const index = notices.findIndex(notice => notice.id === id)
  if (index === -1) {
    return notices
  }

  return [...notices.slice(0, index), ...notices.slice(index + 1)]
}
