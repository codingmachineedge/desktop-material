import {
  GitLabDetailedMergeStatuses,
  GitLabMergeRequestDescriptionMaximumLength,
  GitLabMergeRequestError,
  GitLabMergeRequestMetadataMaximumItems,
  GitLabMergeRequestPageSize,
  GitLabMergeRequestTitleMaximumLength,
  IGitLabMergeRequest,
  IGitLabMergeRequestApprovalState,
  IGitLabMergeRequestApprovalUser,
  IGitLabMergeRequestMember,
  IGitLabMergeRequestUser,
  mergeReadiness,
  removeGitLabDraftTitlePrefix,
  validateGitLabMergeRequestBranch,
  validateGitLabMergeRequestHeadSHA,
  validateGitLabMergeRequestIID,
  validateGitLabMergeRequestTitle,
} from './gitlab-merge-request'

export const GitLabMergeRequestJSONMaximumBytes = 2 * 1024 * 1024

function abortError(): Error {
  const error = new Error('GitLab merge request request canceled.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError()
  }
}

function invalidResponse(): never {
  throw new GitLabMergeRequestError(
    'invalid-response',
    'GitLab returned invalid merge request metadata.'
  )
}

/** Read JSON through a streaming byte cap before allocating the parsed value. */
export async function readBoundedGitLabMergeRequestJSON(
  response: Response,
  signal?: AbortSignal,
  maximumBytes: number = GitLabMergeRequestJSONMaximumBytes
): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('GitLab response byte limit must be a positive integer.')
  }
  throwIfAborted(signal)
  const contentLength = response.headers.get('content-length')
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) ||
      !Number.isSafeInteger(Number(contentLength)))
  ) {
    await response.body?.cancel().catch(() => undefined)
    throw new GitLabMergeRequestError(
      'invalid-response',
      'GitLab returned invalid merge request metadata.'
    )
  }
  if (contentLength !== null && Number(contentLength) > maximumBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new GitLabMergeRequestError(
      'invalid-response',
      'GitLab returned more merge request metadata than the app can process safely.'
    )
  }

  const reader = response.body?.getReader()
  if (reader === undefined) {
    return invalidResponse()
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
        throw new GitLabMergeRequestError(
          'invalid-response',
          'GitLab returned more merge request metadata than the app can process safely.'
        )
      }
      received += next.value.byteLength
      chunks.push(next.value)
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
    return invalidResponse()
  }
}

function statusError(status: number): GitLabMergeRequestError {
  if (status === 401) {
    return new GitLabMergeRequestError(
      'authentication',
      'GitLab authentication failed. Sign in again and retry.',
      status
    )
  }
  if (status === 403) {
    return new GitLabMergeRequestError(
      'permission',
      'The selected GitLab account cannot perform this operation.',
      status
    )
  }
  if (status === 404) {
    return new GitLabMergeRequestError(
      'not-found',
      'The GitLab project or merge request was not found.',
      status
    )
  }
  if (status === 409) {
    return new GitLabMergeRequestError(
      'conflict',
      'The GitLab merge request changed. Refresh it and retry.',
      status
    )
  }
  if (status === 400 || status === 422) {
    return new GitLabMergeRequestError(
      'validation',
      'GitLab rejected the merge request operation.',
      status
    )
  }
  if (status === 429) {
    return new GitLabMergeRequestError(
      'rate-limit',
      'GitLab rate-limited the merge request operation. Retry later.',
      status
    )
  }
  return new GitLabMergeRequestError(
    'service',
    'GitLab could not complete the merge request operation.',
    status
  )
}

/** Never expose or retain provider response text on unsuccessful requests. */
export async function boundedGitLabMergeRequestResponse(
  response: Response,
  signal?: AbortSignal
): Promise<unknown> {
  if (!response.ok) {
    throwIfAborted(signal)
    await response.body?.cancel().catch(() => undefined)
    throwIfAborted(signal)
    throw statusError(response.status)
  }
  return readBoundedGitLabMergeRequestJSON(response, signal)
}

function record(
  value: unknown,
  maximumKeys: number = 128
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length > maximumKeys
  ) {
    return invalidResponse()
  }
  return value as Readonly<Record<string, unknown>>
}

function requiredString(
  value: unknown,
  maximumLength: number,
  allowEmpty: boolean = false
): string {
  return typeof value === 'string' &&
    (allowEmpty || value.length > 0) &&
    value.length <= maximumLength &&
    !value.includes('\0')
    ? value
    : invalidResponse()
}

function optionalString(value: unknown, maximumLength: number): string | null {
  return value === undefined || value === null
    ? null
    : requiredString(value, maximumLength, true)
}

function positiveInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : invalidResponse()
}

function nonNegativeInteger(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) {
    return fallback
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalidResponse()
}

function requiredBoolean(value: unknown, fallback?: boolean): boolean {
  if (value === undefined && fallback !== undefined) {
    return fallback
  }
  return typeof value === 'boolean' ? value : invalidResponse()
}

function date(value: unknown): string {
  const result = requiredString(value, 64)
  return Number.isFinite(Date.parse(result)) ? result : invalidResponse()
}

function optionalDate(value: unknown): string | null {
  return value === undefined || value === null ? null : date(value)
}

function absoluteURL(
  value: unknown,
  allowExternal: boolean,
  root?: string
): string {
  const raw = requiredString(value, 4_096)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return invalidResponse()
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    return invalidResponse()
  }
  if (!allowExternal && root !== undefined) {
    const expected = new URL(root)
    const expectedPath = expected.pathname.replace(/\/+$/, '')
    if (
      parsed.origin !== expected.origin ||
      (expectedPath.length > 0 &&
        parsed.pathname !== expectedPath &&
        !parsed.pathname.startsWith(`${expectedPath}/`))
    ) {
      return invalidResponse()
    }
  }
  return parsed.toString()
}

function optionalAbsoluteURL(value: unknown): string | null {
  return value === undefined || value === null ? null : absoluteURL(value, true)
}

function records(value: unknown, maximumItems: number): ReadonlyArray<unknown> {
  return Array.isArray(value) && value.length <= maximumItems
    ? value
    : invalidResponse()
}

function optionalRecords(
  value: unknown,
  maximumItems: number
): ReadonlyArray<unknown> {
  return value === undefined || value === null
    ? []
    : records(value, maximumItems)
}

function parseUser(value: unknown, webRoot: string): IGitLabMergeRequestUser {
  const user = record(value, 32)
  return {
    id: positiveInteger(user.id),
    username: requiredString(user.username, 256),
    name: requiredString(user.name, 512),
    avatarUrl: optionalAbsoluteURL(user.avatar_url),
    webUrl: absoluteURL(user.web_url, false, webRoot),
  }
}

function state(value: unknown): IGitLabMergeRequest['state'] {
  return value === 'opened' ||
    value === 'closed' ||
    value === 'merged' ||
    value === 'locked'
    ? value
    : invalidResponse()
}

function detailedStatus(
  value: unknown
): IGitLabMergeRequest['readiness']['status'] {
  const status = requiredString(value, 128)
  return (GitLabDetailedMergeStatuses as ReadonlyArray<string>).includes(status)
    ? (status as IGitLabMergeRequest['readiness']['status'])
    : 'unknown'
}

function draftState(
  mergeRequest: Readonly<Record<string, unknown>>,
  rawTitle: string
): boolean {
  const draft = mergeRequest.draft
  const workInProgress = mergeRequest.work_in_progress
  if (draft !== undefined && typeof draft !== 'boolean') {
    return invalidResponse()
  }
  if (workInProgress !== undefined && typeof workInProgress !== 'boolean') {
    return invalidResponse()
  }
  if (
    typeof draft === 'boolean' &&
    typeof workInProgress === 'boolean' &&
    draft !== workInProgress
  ) {
    return invalidResponse()
  }
  const prefixed = removeGitLabDraftTitlePrefix(rawTitle) !== rawTitle
  const declared =
    typeof draft === 'boolean'
      ? draft
      : typeof workInProgress === 'boolean'
      ? workInProgress
      : prefixed
  if (prefixed && !declared) {
    return invalidResponse()
  }
  return declared
}

export function parseGitLabMergeRequest(
  value: unknown,
  webRoot: string,
  expectedIID?: number
): IGitLabMergeRequest {
  const mergeRequest = record(value)
  const iid = validateGitLabMergeRequestIID(positiveInteger(mergeRequest.iid))
  if (
    expectedIID !== undefined &&
    iid !== validateGitLabMergeRequestIID(expectedIID)
  ) {
    return invalidResponse()
  }
  const mergeRequestState = state(mergeRequest.state)
  const rawTitle = validateGitLabMergeRequestTitle(
    requiredString(mergeRequest.title, GitLabMergeRequestTitleMaximumLength)
  )
  const draft = draftState(mergeRequest, rawTitle)
  const status = detailedStatus(mergeRequest.detailed_merge_status)
  const hasConflicts = requiredBoolean(mergeRequest.has_conflicts)
  const blockingDiscussionsResolved = requiredBoolean(
    mergeRequest.blocking_discussions_resolved,
    false
  )
  const description = optionalString(
    mergeRequest.description,
    GitLabMergeRequestDescriptionMaximumLength
  )
  return {
    id: positiveInteger(mergeRequest.id),
    iid,
    projectId: positiveInteger(mergeRequest.project_id),
    // Keep the title/editor field independent from the provider's legacy
    // Draft:/WIP: transport prefix. `draft` above remains authoritative.
    title: validateGitLabMergeRequestTitle(
      removeGitLabDraftTitlePrefix(rawTitle)
    ),
    description: description ?? '',
    state: mergeRequestState,
    draft,
    sourceBranch: validateGitLabMergeRequestBranch(
      requiredString(mergeRequest.source_branch, 255),
      'source branch'
    ),
    targetBranch: validateGitLabMergeRequestBranch(
      requiredString(mergeRequest.target_branch, 255),
      'target branch'
    ),
    sourceProjectId: positiveInteger(mergeRequest.source_project_id),
    targetProjectId: positiveInteger(mergeRequest.target_project_id),
    headSHA: validateGitLabMergeRequestHeadSHA(
      requiredString(mergeRequest.sha, 64)
    ),
    author: parseUser(mergeRequest.author, webRoot),
    assignees: optionalRecords(
      mergeRequest.assignees,
      GitLabMergeRequestMetadataMaximumItems
    ).map(user => parseUser(user, webRoot)),
    reviewers: optionalRecords(
      mergeRequest.reviewers,
      GitLabMergeRequestMetadataMaximumItems
    ).map(user => parseUser(user, webRoot)),
    webUrl: absoluteURL(mergeRequest.web_url, false, webRoot),
    createdAt: date(mergeRequest.created_at),
    updatedAt: date(mergeRequest.updated_at),
    mergedAt: optionalDate(mergeRequest.merged_at),
    closedAt: optionalDate(mergeRequest.closed_at),
    mergeWhenPipelineSucceeds: requiredBoolean(
      mergeRequest.merge_when_pipeline_succeeds,
      false
    ),
    readiness: mergeReadiness(
      mergeRequestState,
      draft,
      status,
      hasConflicts,
      blockingDiscussionsResolved
    ),
    approval: null,
  }
}

export function parseGitLabMergeRequestPage(
  value: unknown,
  webRoot: string,
  maximumItems: number = GitLabMergeRequestPageSize
): ReadonlyArray<IGitLabMergeRequest> {
  if (
    !Number.isSafeInteger(maximumItems) ||
    maximumItems < 1 ||
    maximumItems > GitLabMergeRequestPageSize
  ) {
    throw new Error('GitLab merge request page size is not valid.')
  }
  return records(value, maximumItems).map(item =>
    parseGitLabMergeRequest(item, webRoot)
  )
}

function parseGitLabMergeRequestApprovalResponse(
  value: unknown,
  webRoot: string,
  expectedIID?: number
): {
  readonly approval: Readonly<Record<string, unknown>>
  readonly approvalsRequired: number
  readonly approvalsLeft: number
  readonly approvedBy: ReadonlyArray<IGitLabMergeRequestApprovalUser>
} {
  const approval = record(value)
  if (
    expectedIID !== undefined &&
    validateGitLabMergeRequestIID(positiveInteger(approval.iid)) !==
      validateGitLabMergeRequestIID(expectedIID)
  ) {
    return invalidResponse()
  }
  const approvedBy = optionalRecords(
    approval.approved_by,
    GitLabMergeRequestMetadataMaximumItems
  ).map(item => {
    const approved = record(item, 16)
    const result: IGitLabMergeRequestApprovalUser = {
      user: parseUser(approved.user, webRoot),
      approvedAt: optionalDate(approved.approved_at),
    }
    return result
  })
  const approvalsRequired = nonNegativeInteger(approval.approvals_required, 0)
  const approvalsLeft = nonNegativeInteger(approval.approvals_left, 0)
  return { approval, approvalsRequired, approvalsLeft, approvedBy }
}

/** Parse the authoritative all-tier GET /approvals response. */
export function parseGitLabMergeRequestApprovalState(
  value: unknown,
  webRoot: string,
  expectedIID?: number
): IGitLabMergeRequestApprovalState {
  const { approval, approvalsRequired, approvalsLeft, approvedBy } =
    parseGitLabMergeRequestApprovalResponse(value, webRoot, expectedIID)
  return {
    approved: requiredBoolean(approval.approved),
    approvalsRequired,
    approvalsLeft,
    approvedBy,
  }
}

/**
 * Validate an approve/unapprove mutation receipt. GitLab mutation receipts can
 * omit `approved`, so callers must refresh GET /approvals before publishing a
 * state rather than deriving edition-specific semantics from counts.
 */
export function parseGitLabMergeRequestApprovalMutation(
  value: unknown,
  webRoot: string,
  expectedIID?: number
): void {
  const { approval } = parseGitLabMergeRequestApprovalResponse(
    value,
    webRoot,
    expectedIID
  )
  if (approval.approved !== undefined) {
    requiredBoolean(approval.approved)
  }
}

export function parseGitLabMergeRequestMemberPage(
  value: unknown,
  webRoot: string,
  maximumItems: number = GitLabMergeRequestPageSize
): ReadonlyArray<IGitLabMergeRequestMember> {
  if (
    !Number.isSafeInteger(maximumItems) ||
    maximumItems < 1 ||
    maximumItems > GitLabMergeRequestPageSize
  ) {
    throw new Error('GitLab member page size is not valid.')
  }
  return records(value, maximumItems).map(item => {
    const member = record(item, 64)
    return {
      ...parseUser(member, webRoot),
      accessLevel: nonNegativeInteger(member.access_level),
    }
  })
}
