import { AccountProvider } from '../models/account'
import { createHash } from 'crypto'

export type ProviderTriageKind = 'issue' | 'pull-request'
export type ProviderTriageBucket =
  | 'all'
  | 'assigned'
  | 'authored'
  | 'review-requested'
  | 'stale'
  | 'recently-updated'
export type ProviderTriageSort =
  | 'updated-descending'
  | 'updated-ascending'
  | 'title'

export const ProviderTriagePageLimit = 50
export const ProviderTriageStaleDays = 30
export const ProviderTriageRecentDays = 7

/**
 * The bounded, provider-independent shape emitted by API clients. Raw provider
 * responses, bodies, tokens, avatar URLs, and local paths never cross this
 * boundary or enter triage state.
 */
export interface IAPIProviderTriageItem {
  readonly number: number
  readonly title: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly authorLogin: string
  readonly assigneeLogins: ReadonlyArray<string>
  readonly reviewRequestedLogins: ReadonlyArray<string>
  readonly draft: boolean
}

export interface IAPIProviderTriagePage {
  readonly supported: boolean
  readonly capped: boolean
  readonly items: ReadonlyArray<IAPIProviderTriageItem>
}

export interface IProviderTriageAttention {
  readonly assigned: boolean
  readonly authored: boolean
  readonly reviewRequested: boolean
  readonly stale: boolean
  readonly recentlyUpdated: boolean
}

/** A display-safe work item. It deliberately contains no provider payload. */
export interface IProviderTriageItem {
  readonly id: string
  readonly provider: AccountProvider
  readonly kind: ProviderTriageKind
  readonly number: number
  readonly title: string
  readonly repository: string
  readonly authorLogin: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly draft: boolean
  readonly url: string
  readonly attention: IProviderTriageAttention
}

export interface IProviderTriageFilters {
  readonly query: string
  readonly kind: 'all' | ProviderTriageKind
  readonly bucket: ProviderTriageBucket
  readonly sort: ProviderTriageSort
}

const MaximumWorkItemNumber = 2_147_483_647
const MaximumTitleBytes = 1_024
const MaximumLoginBytes = 256
const MaximumCoordinateBytes = 1_024
const MaximumCoordinateSegments = 20

function stripUnsafeText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()
}

function normalizeBoundedText(
  value: unknown,
  maximumBytes: number,
  field: string
): string {
  if (typeof value !== 'string') {
    throw new Error(`The provider returned an invalid ${field}.`)
  }
  const normalized = stripUnsafeText(value).replace(/\s+/g, ' ')
  if (
    normalized.length === 0 ||
    Buffer.byteLength(normalized, 'utf8') > maximumBytes
  ) {
    throw new Error(`The provider returned an invalid ${field}.`)
  }
  return normalized
}

function normalizeLogin(value: unknown): string {
  return normalizeBoundedText(value, MaximumLoginBytes, 'account name')
}

function normalizeLogins(values: ReadonlyArray<string>): ReadonlyArray<string> {
  if (!Array.isArray(values) || values.length > 50) {
    throw new Error('The provider returned too many account names.')
  }
  const result = new Map<string, string>()
  for (const value of values) {
    const login = normalizeLogin(value)
    result.set(login.toLowerCase(), login)
  }
  return [...result.values()]
}

function normalizeDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || value.length > 64) {
    throw new Error(`The provider returned an invalid ${field}.`)
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`The provider returned an invalid ${field}.`)
  }
  return date
}

function normalizeWorkItemNumber(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MaximumWorkItemNumber
  ) {
    throw new Error('The provider returned an invalid work item number.')
  }
  return value
}

function coordinateSegments(
  value: string,
  field: string
): ReadonlyArray<string> {
  if (
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MaximumCoordinateBytes ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f-\u009f?#]/.test(value)
  ) {
    throw new Error(`The repository has an invalid ${field}.`)
  }
  const segments = value.split('/')
  if (
    segments.length > MaximumCoordinateSegments ||
    segments.some(
      segment => segment.length === 0 || segment === '.' || segment === '..'
    )
  ) {
    throw new Error(`The repository has an invalid ${field}.`)
  }
  return segments
}

export function validateProviderTriageCoordinate(
  owner: string,
  name: string,
  allowNestedOwner: boolean
): { readonly owner: string; readonly name: string } {
  const ownerSegments = coordinateSegments(owner, 'owner')
  const nameSegments = coordinateSegments(name, 'name')
  if (
    (!allowNestedOwner && ownerSegments.length !== 1) ||
    nameSegments.length !== 1
  ) {
    throw new Error('The repository has an invalid provider coordinate.')
  }
  return { owner: ownerSegments.join('/'), name: nameSegments[0] }
}

export function normalizeProviderTriageLimit(limit: number): number {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > ProviderTriagePageLimit
  ) {
    throw new Error(
      `Provider triage is limited to ${ProviderTriagePageLimit} items per work-item type.`
    )
  }
  return limit
}

/**
 * Construct, rather than trust, the work-item link. This pins links to the
 * selected account's exact origin and repository coordinate.
 */
export function buildProviderTriageURL(
  provider: AccountProvider,
  htmlBaseURL: string,
  owner: string,
  name: string,
  kind: ProviderTriageKind,
  workItemNumber: number
): string {
  const safeNumber = normalizeWorkItemNumber(workItemNumber)
  const coordinate = validateProviderTriageCoordinate(
    owner,
    name,
    provider === 'gitlab'
  )
  const ownerSegments = coordinate.owner.split('/')

  let base: URL
  try {
    base = new URL(htmlBaseURL)
  } catch {
    throw new Error('The selected account has an invalid provider endpoint.')
  }
  if (
    (base.protocol !== 'https:' && base.protocol !== 'http:') ||
    base.username.length > 0 ||
    base.password.length > 0 ||
    base.search.length > 0 ||
    base.hash.length > 0
  ) {
    throw new Error('The selected account has an invalid provider endpoint.')
  }

  const prefix = base.pathname.replace(/\/+$/, '')
  const repositoryPath = [...ownerSegments, coordinate.name]
    .map(encodeURIComponent)
    .join('/')
  const suffix =
    provider === 'gitlab' && kind === 'pull-request'
      ? `-/merge_requests/${safeNumber}`
      : provider === 'gitlab' && kind === 'issue'
      ? `-/issues/${safeNumber}`
      : provider === 'bitbucket' && kind === 'pull-request'
      ? `pull-requests/${safeNumber}`
      : kind === 'pull-request'
      ? `pull/${safeNumber}`
      : `issues/${safeNumber}`
  const result = new URL(
    `${prefix}/${repositoryPath}/${suffix}`.replace(/^\/+/, '/'),
    base.origin
  )
  if (result.origin !== base.origin || result.username || result.password) {
    throw new Error('The provider returned an unsafe work-item link.')
  }
  return result.toString()
}

export function normalizeProviderTriageItem(
  provider: AccountProvider,
  htmlBaseURL: string,
  owner: string,
  name: string,
  accountIdentity: string,
  accountLogin: string,
  kind: ProviderTriageKind,
  value: IAPIProviderTriageItem,
  now: Date = new Date()
): IProviderTriageItem {
  const workItemNumber = normalizeWorkItemNumber(value.number)
  const title = normalizeBoundedText(value.title, MaximumTitleBytes, 'title')
  const authorLogin = normalizeLogin(value.authorLogin)
  const assignees = normalizeLogins(value.assigneeLogins)
  const reviewers = normalizeLogins(value.reviewRequestedLogins)
  const createdAt = normalizeDate(value.createdAt, 'created date')
  const updatedAt = normalizeDate(value.updatedAt, 'updated date')
  if (typeof value.draft !== 'boolean') {
    throw new Error('The provider returned an invalid draft state.')
  }
  if (updatedAt.getTime() < createdAt.getTime()) {
    throw new Error('The provider returned inconsistent work item dates.')
  }
  const accountKey = normalizeLogin(accountLogin).toLowerCase()
  const elapsed = Math.max(0, now.getTime() - updatedAt.getTime())
  const day = 24 * 60 * 60 * 1_000
  const identityHash = createHash('sha256')
    .update(
      JSON.stringify([
        accountIdentity,
        provider,
        htmlBaseURL,
        owner,
        name,
        kind,
        workItemNumber,
      ])
    )
    .digest('hex')
    .slice(0, 24)
  return {
    id: `triage-${identityHash}`,
    provider,
    kind,
    number: workItemNumber,
    title,
    repository: `${owner}/${name}`,
    authorLogin,
    createdAt,
    updatedAt,
    draft: value.draft,
    url: buildProviderTriageURL(
      provider,
      htmlBaseURL,
      owner,
      name,
      kind,
      workItemNumber
    ),
    attention: {
      assigned: assignees.some(x => x.toLowerCase() === accountKey),
      authored: authorLogin.toLowerCase() === accountKey,
      reviewRequested:
        kind === 'pull-request' &&
        reviewers.some(x => x.toLowerCase() === accountKey),
      stale: elapsed >= ProviderTriageStaleDays * day,
      recentlyUpdated: elapsed <= ProviderTriageRecentDays * day,
    },
  }
}

export function normalizeProviderTriagePage(
  provider: AccountProvider,
  htmlBaseURL: string,
  owner: string,
  name: string,
  accountIdentity: string,
  accountLogin: string,
  kind: ProviderTriageKind,
  page: IAPIProviderTriagePage,
  now: Date = new Date()
): ReadonlyArray<IProviderTriageItem> {
  if (typeof page.supported !== 'boolean' || typeof page.capped !== 'boolean') {
    throw new Error('The provider returned an invalid triage page state.')
  }
  if (!page.supported) {
    if (page.capped || !Array.isArray(page.items) || page.items.length !== 0) {
      throw new Error('The provider returned an invalid unsupported state.')
    }
    return []
  }
  if (
    !Array.isArray(page.items) ||
    page.items.length > ProviderTriagePageLimit
  ) {
    throw new Error('The provider returned too many triage items.')
  }
  const result = new Array<IProviderTriageItem>()
  const seen = new Set<number>()
  for (const value of page.items) {
    const item = normalizeProviderTriageItem(
      provider,
      htmlBaseURL,
      owner,
      name,
      accountIdentity,
      accountLogin,
      kind,
      value,
      now
    )
    if (seen.has(item.number)) {
      throw new Error('The provider returned a duplicate triage item.')
    }
    seen.add(item.number)
    result.push(item)
  }
  return result
}

function matchesBucket(
  item: IProviderTriageItem,
  bucket: ProviderTriageBucket
): boolean {
  switch (bucket) {
    case 'all':
      return true
    case 'assigned':
      return item.attention.assigned
    case 'authored':
      return item.attention.authored
    case 'review-requested':
      return item.attention.reviewRequested
    case 'stale':
      return item.attention.stale
    case 'recently-updated':
      return item.attention.recentlyUpdated
  }
}

export function filterProviderTriageItems(
  items: ReadonlyArray<IProviderTriageItem>,
  filters: IProviderTriageFilters
): ReadonlyArray<IProviderTriageItem> {
  const validKinds = new Set(['all', 'issue', 'pull-request'])
  const validBuckets = new Set([
    'all',
    'assigned',
    'authored',
    'review-requested',
    'stale',
    'recently-updated',
  ])
  const validSorts = new Set([
    'updated-descending',
    'updated-ascending',
    'title',
  ])
  if (
    !validKinds.has(filters.kind) ||
    !validBuckets.has(filters.bucket) ||
    !validSorts.has(filters.sort)
  ) {
    throw new Error('Choose valid triage filters.')
  }
  const query = stripUnsafeText(filters.query).slice(0, 100).toLowerCase()
  return items
    .filter(
      item =>
        (filters.kind === 'all' || item.kind === filters.kind) &&
        matchesBucket(item, filters.bucket) &&
        (query.length === 0 ||
          item.title.toLowerCase().includes(query) ||
          item.authorLogin.toLowerCase().includes(query) ||
          item.repository.toLowerCase().includes(query) ||
          String(item.number) === query.replace(/^#/, ''))
    )
    .toSorted((a, b) => {
      switch (filters.sort) {
        case 'updated-descending':
          return (
            b.updatedAt.getTime() - a.updatedAt.getTime() || b.number - a.number
          )
        case 'updated-ascending':
          return (
            a.updatedAt.getTime() - b.updatedAt.getTime() || a.number - b.number
          )
        case 'title':
          return (
            a.title.localeCompare(b.title, undefined, {
              sensitivity: 'base',
            }) || a.number - b.number
          )
      }
    })
}

export function providerTriageProviderLabel(provider: AccountProvider): string {
  switch (provider) {
    case 'github':
      return 'GitHub'
    case 'gitlab':
      return 'GitLab'
    case 'bitbucket':
      return 'Bitbucket'
  }
}
