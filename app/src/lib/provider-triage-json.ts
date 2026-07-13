import { APIError } from './http'
import {
  IAPIProviderTriageItem,
  normalizeProviderTriageLimit,
} from './provider-triage'

// Provider list responses include full issue/PR bodies even though triage drops
// them. Four MiB accommodates 50 ordinary long-form items while remaining a
// hard streaming cap before JSON allocation.
export const ProviderTriageJSONMaximumBytes = 4 * 1024 * 1024

export class ProviderTriageJSONError extends Error {
  public constructor(
    message: string,
    public readonly kind:
      | 'too-large'
      | 'invalid-length'
      | 'invalid-json'
      | 'invalid-shape'
  ) {
    super(message)
    this.name = 'ProviderTriageJSONError'
  }
}

function abortError(): Error {
  const error = new Error('Provider triage request canceled.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError()
  }
}

/** Read provider JSON without ever retaining more than the explicit cap. */
export async function readBoundedProviderTriageJSON(
  response: Response,
  signal?: AbortSignal,
  maximumBytes: number = ProviderTriageJSONMaximumBytes
): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('Provider triage JSON byte limit must be positive.')
  }
  throwIfAborted(signal)
  const length = response.headers.get('content-length')
  if (length !== null) {
    if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) {
      await response.body?.cancel().catch(() => undefined)
      throw new ProviderTriageJSONError(
        'The provider returned an invalid triage metadata size.',
        'invalid-length'
      )
    }
    if (Number(length) > maximumBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new ProviderTriageJSONError(
        'The provider returned too much triage metadata.',
        'too-large'
      )
    }
  }

  const reader = response.body?.getReader()
  if (reader === undefined) {
    throw new ProviderTriageJSONError(
      'The provider returned an empty triage response.',
      'invalid-json'
    )
  }
  const chunks = new Array<Uint8Array>()
  let received = 0
  const cancel = () => reader.cancel(abortError()).catch(() => undefined)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      throwIfAborted(signal)
      const next = await reader.read()
      throwIfAborted(signal)
      if (next.done) {
        break
      }
      if (received + next.value.byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throwIfAborted(signal)
        throw new ProviderTriageJSONError(
          'The provider returned too much triage metadata.',
          'too-large'
        )
      }
      chunks.push(next.value)
      received += next.value.byteLength
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
  }

  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    ) as unknown
  } catch {
    throw new ProviderTriageJSONError(
      'The provider returned invalid triage metadata.',
      'invalid-json'
    )
  }
}

function boundedAPIError(value: unknown): { readonly message?: string } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const message = (value as Record<string, unknown>).message
  return typeof message === 'string' && message.length <= 512
    ? { message }
    : null
}

export async function boundedProviderTriageResponse(
  response: Response,
  signal?: AbortSignal
): Promise<unknown> {
  let value: unknown
  try {
    value = await readBoundedProviderTriageJSON(response, signal)
  } catch (error) {
    if (!response.ok && error instanceof ProviderTriageJSONError) {
      throw new APIError(response, null)
    }
    throw error
  }
  if (!response.ok) {
    throw new APIError(response, boundedAPIError(value))
  }
  return value
}

function invalidShape(): never {
  throw new ProviderTriageJSONError(
    'The provider returned invalid triage metadata.',
    'invalid-shape'
  )
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : invalidShape()
}

function requiredString(value: unknown, maximum = 4_096): string {
  return typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= maximum
    ? value
    : invalidShape()
}

function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    ? value
    : invalidShape()
}

function requiredBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalidShape()
}

function optionalBoolean(value: unknown, fallback = false): boolean {
  return value === undefined ? fallback : requiredBoolean(value)
}

function records(
  value: unknown,
  maximum: number
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  if (!Array.isArray(value) || value.length > maximum) {
    return invalidShape()
  }
  return value.map(record)
}

function optionalRecords(
  value: unknown,
  maximum: number
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  return value === undefined || value === null ? [] : records(value, maximum)
}

function githubLogin(value: unknown): string {
  return requiredString(record(value).login, 256)
}

function gitLabLogin(value: unknown): string {
  return requiredString(record(value).username, 256)
}

function bitbucketLogin(value: unknown): string {
  const identity = record(value)
  for (const field of ['username', 'nickname', 'display_name'] as const) {
    if (typeof identity[field] === 'string' && identity[field].length > 0) {
      return requiredString(identity[field], 256)
    }
  }
  return invalidShape()
}

function arrayPage(value: unknown, limit: number) {
  return records(value, normalizeProviderTriageLimit(limit))
}

export function parseGitHubTriageIssues(
  value: unknown,
  limit: number
): ReadonlyArray<IAPIProviderTriageItem> {
  const result = new Array<IAPIProviderTriageItem>()
  for (const issue of arrayPage(value, limit)) {
    if (issue.pull_request !== undefined) {
      record(issue.pull_request)
      continue
    }
    result.push({
      number: integer(issue.number),
      title: requiredString(issue.title),
      createdAt: requiredString(issue.created_at, 64),
      updatedAt: requiredString(issue.updated_at, 64),
      authorLogin: githubLogin(issue.user),
      assigneeLogins: optionalRecords(issue.assignees, 50).map(githubLogin),
      reviewRequestedLogins: [],
      draft: false,
    })
  }
  return result
}

export function parseGitHubTriagePullRequests(
  value: unknown,
  limit: number
): ReadonlyArray<IAPIProviderTriageItem> {
  return arrayPage(value, limit).map(pullRequest => ({
    number: integer(pullRequest.number),
    title: requiredString(pullRequest.title),
    createdAt: requiredString(pullRequest.created_at, 64),
    updatedAt: requiredString(pullRequest.updated_at, 64),
    authorLogin: githubLogin(pullRequest.user),
    assigneeLogins: optionalRecords(pullRequest.assignees, 50).map(githubLogin),
    reviewRequestedLogins: optionalRecords(
      pullRequest.requested_reviewers,
      50
    ).map(githubLogin),
    draft: optionalBoolean(pullRequest.draft),
  }))
}

export function parseGitLabTriageIssues(
  value: unknown,
  limit: number
): ReadonlyArray<IAPIProviderTriageItem> {
  return arrayPage(value, limit).map(issue => ({
    number: integer(issue.iid),
    title: requiredString(issue.title),
    createdAt: requiredString(issue.created_at, 64),
    updatedAt: requiredString(issue.updated_at, 64),
    authorLogin: gitLabLogin(issue.author),
    assigneeLogins: optionalRecords(issue.assignees, 50).map(gitLabLogin),
    reviewRequestedLogins: [],
    draft: false,
  }))
}

export function parseGitLabTriagePullRequests(
  value: unknown,
  limit: number
): ReadonlyArray<IAPIProviderTriageItem> {
  return arrayPage(value, limit).map(mergeRequest => ({
    number: integer(mergeRequest.iid),
    title: requiredString(mergeRequest.title),
    createdAt: requiredString(mergeRequest.created_at, 64),
    updatedAt: requiredString(mergeRequest.updated_at, 64),
    authorLogin: gitLabLogin(mergeRequest.author),
    assigneeLogins: optionalRecords(mergeRequest.assignees, 50).map(
      gitLabLogin
    ),
    reviewRequestedLogins: optionalRecords(mergeRequest.reviewers, 50).map(
      gitLabLogin
    ),
    draft: optionalBoolean(mergeRequest.draft),
  }))
}

export interface IParsedBitbucketTriagePage {
  readonly items: ReadonlyArray<IAPIProviderTriageItem>
  readonly hasNextPage: boolean
}

export function parseBitbucketTriagePullRequests(
  value: unknown,
  limit: number
): IParsedBitbucketTriagePage {
  const page = record(value)
  if (
    page.next !== undefined &&
    (typeof page.next !== 'string' || page.next.length > 4_096)
  ) {
    invalidShape()
  }
  const items = arrayPage(page.values, limit).map(pullRequest => {
    const author = record(pullRequest.author)
    const requested = optionalRecords(pullRequest.reviewers, 50).map(
      bitbucketLogin
    )
    for (const participant of optionalRecords(pullRequest.participants, 50)) {
      if (
        participant.role !== undefined &&
        typeof participant.role !== 'string'
      ) {
        invalidShape()
      }
      if (
        participant.approved !== undefined &&
        typeof participant.approved !== 'boolean'
      ) {
        invalidShape()
      }
      if (participant.role === 'REVIEWER' && participant.approved !== true) {
        requested.push(bitbucketLogin(participant.user))
      }
    }
    return {
      number: integer(pullRequest.id),
      title: requiredString(pullRequest.title),
      createdAt: requiredString(pullRequest.created_on, 64),
      updatedAt: requiredString(pullRequest.updated_on, 64),
      authorLogin: bitbucketLogin(author),
      assigneeLogins: [],
      reviewRequestedLogins: requested,
      draft: optionalBoolean(pullRequest.draft),
    }
  })
  return {
    items,
    hasNextPage: typeof page.next === 'string' && page.next.length > 0,
  }
}
