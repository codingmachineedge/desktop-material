export const GitLabMergeRequestTitleMaximumLength = 1_024
export const GitLabMergeRequestDescriptionMaximumLength = 1_048_576
export const GitLabMergeRequestBranchMaximumLength = 255
export const GitLabProjectPathMaximumLength = 512
export const GitLabMergeRequestMetadataMaximumItems = 100
export const GitLabMergeRequestPageSize = 100
export const GitLabMergeRequestMaximumPages = 10
export const GitLabMergeRequestMaximumItems =
  GitLabMergeRequestPageSize * GitLabMergeRequestMaximumPages

export type GitLabProjectIdentifier = number | string

export type GitLabMergeRequestState = 'opened' | 'closed' | 'merged' | 'locked'

export type GitLabMergeRequestListState = GitLabMergeRequestState | 'all'

export type GitLabMergeRequestStateEvent = 'close' | 'reopen'

export const GitLabDetailedMergeStatuses = [
  'approvals_syncing',
  'checking',
  'ci_must_pass',
  'ci_still_running',
  'commits_status',
  'conflict',
  'discussions_not_resolved',
  'draft_status',
  'jira_association_missing',
  'mergeable',
  'merge_request_blocked',
  'merge_time',
  'need_rebase',
  'not_approved',
  'not_open',
  'preparing',
  'requested_changes',
  'security_policy_pipeline_check',
  'security_policy_violations',
  'status_checks_must_pass',
  'unchecked',
  'locked_paths',
  'locked_lfs_files',
  'title_regex',
] as const

export type GitLabDetailedMergeStatus =
  | typeof GitLabDetailedMergeStatuses[number]
  | 'unknown'

export type GitLabMergeReadinessKind =
  | 'ready'
  | 'checking'
  | 'blocked'
  | 'unknown'

export interface IGitLabMergeReadiness {
  readonly kind: GitLabMergeReadinessKind
  readonly status: GitLabDetailedMergeStatus
  readonly hasConflicts: boolean
  readonly blockingDiscussionsResolved: boolean
}

export interface IGitLabMergeRequestUser {
  readonly id: number
  readonly username: string
  readonly name: string
  readonly avatarUrl: string | null
  readonly webUrl: string
}

export interface IGitLabMergeRequestMember extends IGitLabMergeRequestUser {
  readonly accessLevel: number
}

export interface IGitLabMergeRequestApprovalUser {
  readonly user: IGitLabMergeRequestUser
  readonly approvedAt: string | null
}

export interface IGitLabMergeRequestApprovalState {
  readonly approved: boolean
  readonly approvalsRequired: number
  readonly approvalsLeft: number
  readonly approvedBy: ReadonlyArray<IGitLabMergeRequestApprovalUser>
}

export interface IGitLabMergeRequest {
  readonly id: number
  readonly iid: number
  readonly projectId: number
  readonly title: string
  readonly description: string
  readonly state: GitLabMergeRequestState
  readonly draft: boolean
  readonly sourceBranch: string
  readonly targetBranch: string
  readonly sourceProjectId: number
  readonly targetProjectId: number
  readonly headSHA: string
  readonly author: IGitLabMergeRequestUser
  readonly assignees: ReadonlyArray<IGitLabMergeRequestUser>
  readonly reviewers: ReadonlyArray<IGitLabMergeRequestUser>
  readonly webUrl: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly mergedAt: string | null
  readonly closedAt: string | null
  readonly mergeWhenPipelineSucceeds: boolean
  readonly readiness: IGitLabMergeReadiness
  readonly approval: IGitLabMergeRequestApprovalState | null
}

export interface IGitLabMergeRequestList {
  readonly items: ReadonlyArray<IGitLabMergeRequest>
  readonly capped: boolean
}

export interface IGitLabMergeRequestMemberList {
  readonly items: ReadonlyArray<IGitLabMergeRequestMember>
  readonly capped: boolean
}

export interface IGitLabMergeRequestQuery {
  readonly state?: GitLabMergeRequestListState
  readonly orderBy?: 'created_at' | 'updated_at'
  readonly sort?: 'asc' | 'desc'
}

export interface IGitLabMergeRequestDraft {
  readonly sourceBranch: string
  readonly targetBranch: string
  readonly title: string
  readonly description: string
  readonly draft: boolean
  readonly reviewerIds: ReadonlyArray<number>
  readonly assigneeIds: ReadonlyArray<number>
}

export interface IGitLabMergeRequestUpdate {
  readonly title?: string
  readonly description?: string
  readonly targetBranch?: string
  readonly draft?: boolean
  readonly reviewerIds?: ReadonlyArray<number>
  readonly assigneeIds?: ReadonlyArray<number>
  readonly stateEvent?: GitLabMergeRequestStateEvent
}

export interface INormalizedGitLabMergeRequestDraft {
  readonly source_branch: string
  readonly target_branch: string
  readonly title: string
  readonly description: string
  readonly reviewer_ids: ReadonlyArray<number>
  readonly assignee_ids: ReadonlyArray<number>
}

export interface INormalizedGitLabMergeRequestUpdate {
  readonly title?: string
  readonly description?: string
  readonly target_branch?: string
  readonly reviewer_ids?: ReadonlyArray<number>
  readonly assignee_ids?: ReadonlyArray<number>
  readonly state_event?: GitLabMergeRequestStateEvent
}

export type GitLabMergeRequestErrorKind =
  | 'authentication'
  | 'permission'
  | 'not-found'
  | 'conflict'
  | 'validation'
  | 'rate-limit'
  | 'service'
  | 'network'
  | 'invalid-response'
  | 'outcome-unknown'
  | 'unsupported'

/** A provider-safe error which never retains a response body or credential. */
export class GitLabMergeRequestError extends Error {
  public constructor(
    public readonly kind: GitLabMergeRequestErrorKind,
    message: string,
    public readonly responseStatus: number | null = null
  ) {
    super(message)
    this.name = 'GitLabMergeRequestError'
  }
}

export class GitLabMergeRequestContextChangedError extends Error {
  public constructor() {
    super('The selected GitLab account, repository, or merge request changed.')
    this.name = 'GitLabMergeRequestContextChangedError'
  }
}

/**
 * A mutation was dispatched, but its final provider state could not be
 * confirmed. Callers must refresh instead of assuming that it failed.
 */
export class GitLabMergeRequestMutationOutcomeUnknownError extends GitLabMergeRequestError {
  public constructor() {
    super(
      'outcome-unknown',
      'GitLab may have completed the merge request operation. Refresh before retrying.'
    )
    this.name = 'GitLabMergeRequestMutationOutcomeUnknownError'
  }
}

function invalid(field: string): never {
  throw new GitLabMergeRequestError(
    'validation',
    `The GitLab merge request ${field} is not valid.`
  )
}

function validateLength(
  value: string,
  maximumLength: number,
  field: string,
  allowEmpty: boolean
): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximumLength ||
    /[\u0000]/.test(value)
  ) {
    return invalid(field)
  }
  return value
}

/** Validate a numeric project ID or an exact namespace/project path. */
export function validateGitLabProjectIdentifier(
  value: GitLabProjectIdentifier
): GitLabProjectIdentifier {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : invalid('project')
  }
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > GitLabProjectPathMaximumLength ||
    value.trim() !== value ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('//') ||
    /[\u0000-\u001f\u007f?#\\]/.test(value)
  ) {
    return invalid('project')
  }
  const parts = value.split('/')
  if (
    parts.some(
      part =>
        part.length === 0 ||
        part === '.' ||
        part === '..' ||
        part.trim() !== part
    )
  ) {
    return invalid('project')
  }
  return value
}

export function encodeGitLabProjectIdentifier(
  value: GitLabProjectIdentifier
): string {
  return encodeURIComponent(String(validateGitLabProjectIdentifier(value)))
}

export function validateGitLabMergeRequestIID(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : invalid('number')
}

export function validateGitLabMergeRequestHeadSHA(value: string): string {
  return typeof value === 'string' && /^[a-f\d]{40,64}$/i.test(value)
    ? value.toLowerCase()
    : invalid('HEAD SHA')
}

export function validateGitLabMergeRequestUpdatedAt(value: string): string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
    ? value
    : invalid('updated timestamp')
}

export function validateGitLabMergeRequestBranch(
  value: string,
  field: 'source branch' | 'target branch'
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > GitLabMergeRequestBranchMaximumLength ||
    value.trim() !== value ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.includes('..') ||
    value.includes('//') ||
    value.includes('@{') ||
    /[\u0000-\u0020\u007f~^:?*\\[]/.test(value)
  ) {
    return invalid(field)
  }
  return value
}

export function validateGitLabMergeRequestTitle(value: string): string {
  const title = validateLength(
    value,
    GitLabMergeRequestTitleMaximumLength,
    'title',
    false
  )
  return title.trim() === title ? title : invalid('title')
}

export function validateGitLabMergeRequestDescription(value: string): string {
  return validateLength(
    value,
    GitLabMergeRequestDescriptionMaximumLength,
    'description',
    true
  )
}

/** GitLab draft spellings plus the legacy WIP transport prefix. */
const DraftTitlePrefix = /^(?:(?:\[draft\]|\(draft\)|draft:|wip:)\s*)+/i

export function removeGitLabDraftTitlePrefix(value: string): string {
  return value.replace(DraftTitlePrefix, '')
}

/** GitLab represents create/update draft state through a title prefix. */
export function normalizeGitLabMergeRequestTitle(
  value: string,
  draft: boolean
): string {
  const plainTitle = validateGitLabMergeRequestTitle(
    removeGitLabDraftTitlePrefix(value)
  )
  return validateGitLabMergeRequestTitle(
    draft ? `Draft: ${plainTitle}` : plainTitle
  )
}

export function validateGitLabUserIds(
  values: ReadonlyArray<number>,
  field: 'reviewers' | 'assignees'
): ReadonlyArray<number> {
  if (
    !Array.isArray(values) ||
    values.length > GitLabMergeRequestMetadataMaximumItems
  ) {
    return invalid(field)
  }
  const result = new Array<number>()
  const seen = new Set<number>()
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 1 || seen.has(value)) {
      return invalid(field)
    }
    seen.add(value)
    result.push(value)
  }
  return result
}

export function normalizeGitLabMergeRequestDraft(
  draft: IGitLabMergeRequestDraft
): INormalizedGitLabMergeRequestDraft {
  if (typeof draft !== 'object' || draft === null) {
    return invalid('draft')
  }
  if (typeof draft.draft !== 'boolean') {
    return invalid('draft state')
  }
  return {
    source_branch: validateGitLabMergeRequestBranch(
      draft.sourceBranch,
      'source branch'
    ),
    target_branch: validateGitLabMergeRequestBranch(
      draft.targetBranch,
      'target branch'
    ),
    title: normalizeGitLabMergeRequestTitle(draft.title, draft.draft),
    description: validateGitLabMergeRequestDescription(draft.description),
    reviewer_ids: validateGitLabUserIds(draft.reviewerIds, 'reviewers'),
    assignee_ids: validateGitLabUserIds(draft.assigneeIds, 'assignees'),
  }
}

export function normalizeGitLabMergeRequestUpdate(
  current: IGitLabMergeRequest,
  update: IGitLabMergeRequestUpdate
): INormalizedGitLabMergeRequestUpdate {
  if (typeof update !== 'object' || update === null) {
    return invalid('update')
  }
  if (update.draft !== undefined && typeof update.draft !== 'boolean') {
    return invalid('draft state')
  }
  if (
    update.stateEvent !== undefined &&
    update.stateEvent !== 'close' &&
    update.stateEvent !== 'reopen'
  ) {
    return invalid('state')
  }

  const result: {
    title?: string
    description?: string
    target_branch?: string
    reviewer_ids?: ReadonlyArray<number>
    assignee_ids?: ReadonlyArray<number>
    state_event?: GitLabMergeRequestStateEvent
  } = {}
  if (update.title !== undefined || update.draft !== undefined) {
    result.title = normalizeGitLabMergeRequestTitle(
      update.title ?? current.title,
      update.draft ?? current.draft
    )
  }
  if (update.description !== undefined) {
    result.description = validateGitLabMergeRequestDescription(
      update.description
    )
  }
  if (update.targetBranch !== undefined) {
    result.target_branch = validateGitLabMergeRequestBranch(
      update.targetBranch,
      'target branch'
    )
  }
  if (update.reviewerIds !== undefined) {
    result.reviewer_ids = validateGitLabUserIds(update.reviewerIds, 'reviewers')
  }
  if (update.assigneeIds !== undefined) {
    result.assignee_ids = validateGitLabUserIds(update.assigneeIds, 'assignees')
  }
  if (update.stateEvent !== undefined) {
    result.state_event = update.stateEvent
  }
  if (Object.keys(result).length === 0) {
    return invalid('update')
  }
  return result
}

export function normalizeGitLabMergeRequestQuery(
  query: IGitLabMergeRequestQuery = {}
): Required<IGitLabMergeRequestQuery> {
  const state = query.state ?? 'opened'
  const orderBy = query.orderBy ?? 'updated_at'
  const sort = query.sort ?? 'desc'
  if (!['opened', 'closed', 'merged', 'locked', 'all'].includes(state)) {
    return invalid('list state')
  }
  if (orderBy !== 'created_at' && orderBy !== 'updated_at') {
    return invalid('list order')
  }
  if (sort !== 'asc' && sort !== 'desc') {
    return invalid('list sort')
  }
  return { state, orderBy, sort }
}

export function mergeReadiness(
  state: GitLabMergeRequestState,
  draft: boolean,
  status: GitLabDetailedMergeStatus,
  hasConflicts: boolean,
  blockingDiscussionsResolved: boolean
): IGitLabMergeReadiness {
  const checking = new Set<GitLabDetailedMergeStatus>([
    'approvals_syncing',
    'checking',
    'preparing',
    'unchecked',
  ])
  const kind: GitLabMergeReadinessKind =
    state === 'opened' && !draft && status === 'mergeable' && !hasConflicts
      ? 'ready'
      : checking.has(status)
      ? 'checking'
      : status === 'unknown'
      ? 'unknown'
      : 'blocked'
  return { kind, status, hasConflicts, blockingDiscussionsResolved }
}

export function withGitLabMergeRequestApproval(
  mergeRequest: IGitLabMergeRequest,
  approval: IGitLabMergeRequestApprovalState
): IGitLabMergeRequest {
  return { ...mergeRequest, approval }
}

/**
 * Abort and supersede request generations. Even work which ignores AbortSignal
 * cannot resolve after a newer repository/account context has started.
 */
export class GitLabMergeRequestRequestGate {
  private generation = 0
  private controller: AbortController | null = null

  public async run<T>(
    work: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    this.controller?.abort()
    const controller = new AbortController()
    const generation = ++this.generation
    this.controller = controller
    const cancel = () => controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) {
      controller.abort()
    }
    try {
      const value = await work(controller.signal)
      if (
        controller.signal.aborted ||
        generation !== this.generation ||
        this.controller !== controller
      ) {
        throw new GitLabMergeRequestContextChangedError()
      }
      return value
    } finally {
      signal?.removeEventListener('abort', cancel)
      if (this.controller === controller) {
        this.controller = null
      }
    }
  }

  public invalidate(): void {
    this.generation++
    this.controller?.abort()
    this.controller = null
  }
}
