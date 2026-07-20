/**
 * Provider-neutral merge-request editor limits. The description cap is
 * intentionally far below GitLab's 1,048,576-character API limit so renderer
 * state, persistence, and review surfaces stay bounded.
 */
export const MergeRequestTitleMaximumLength = 255
export const MergeRequestBodyMaximumLength = 128 * 1024
export const MergeRequestBranchMaximumLength = 255
export const MergeRequestMaximumReviewers = 20
export const MergeRequestMaximumAssignees = 20
export const MergeRequestMaximumBranchChoices = 500
export const MergeRequestMaximumIdentityChoices = 200
export const MergeRequestIdentityMaximumLength = 255

export type MergeRequestEditorMode = 'create' | 'edit'

/** Exact repository/account route resolved outside the editor. */
export interface IMergeRequestRouteIdentity {
  readonly repositoryId: string
  readonly accountKey: string
  readonly accountDisplayName: string
  readonly friendlyEndpoint: string
  readonly projectPath: string
}

export interface IMergeRequestBranchOption {
  readonly name: string
}

export interface IMergeRequestIdentityOption {
  /** Provider identity serialized without assuming numeric or string IDs. */
  readonly id: string
  readonly displayName: string
  readonly username?: string
}

export interface IMergeRequestEditorContext {
  /** Changes whenever any request-scoping input changes. */
  readonly version: string
  readonly route: IMergeRequestRouteIdentity
  readonly sourceBranches: ReadonlyArray<IMergeRequestBranchOption>
  readonly targetBranches: ReadonlyArray<IMergeRequestBranchOption>
  readonly reviewers: ReadonlyArray<IMergeRequestIdentityOption>
  readonly assignees: ReadonlyArray<IMergeRequestIdentityOption>
  /** GitLab `detailed_merge_status`, if editing an existing merge request. */
  readonly detailedMergeStatus?: string
  /** Current merge-request HEAD SHA used by approval guards. */
  readonly headSha?: string
}

export type MergeRequestOptionalField = 'reviewers' | 'assignees'
export type MergeRequestCappedCollection =
  | 'sourceBranches'
  | 'targetBranches'
  | 'reviewers'
  | 'assignees'

export type MergeRequestEmptyReason =
  | 'no-branches'
  | 'no-source-branches'
  | 'no-target-branches'

export type MergeRequestLoadError =
  | 'authentication'
  | 'permission'
  | 'network'
  | 'unsupported'
  | 'invalid-response'
  | 'unknown'

export type MergeRequestEditorAvailability =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty'; readonly reason: MergeRequestEmptyReason }
  | { readonly kind: 'error'; readonly reason: MergeRequestLoadError }
  | {
      readonly kind: 'ready'
      readonly context: IMergeRequestEditorContext
    }
  | {
      readonly kind: 'partial'
      readonly context: IMergeRequestEditorContext
      readonly unavailable: ReadonlyArray<MergeRequestOptionalField>
      readonly capped: ReadonlyArray<MergeRequestCappedCollection>
    }
  | {
      readonly kind: 'stale'
      readonly context: IMergeRequestEditorContext
    }

export interface IMergeRequestEditorInitialValue {
  readonly sourceBranch?: string
  readonly targetBranch?: string
  readonly title?: string
  readonly body?: string
  /** Explicit on newer servers; absent on older servers. */
  readonly draft?: boolean
  readonly reviewerIds?: ReadonlyArray<string>
  readonly assigneeIds?: ReadonlyArray<string>
}

export interface IMergeRequestEditorSubmission {
  readonly route: IMergeRequestRouteIdentity
  readonly contextVersion: string
  readonly headSha?: string
  readonly sourceBranch: string
  readonly targetBranch: string
  readonly title: string
  readonly body: string
  readonly draft: boolean
  readonly reviewerIds: ReadonlyArray<string>
  readonly assigneeIds: ReadonlyArray<string>
}

export type MergeRequestSubmissionError =
  | 'rejected'
  | 'network'
  | 'stale'
  | 'invalid-response'
  | 'unknown'

export type MergeRequestEditorOperation =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'success' }
  | { readonly kind: 'canceled' }
  | {
      readonly kind: 'error'
      readonly reason: MergeRequestSubmissionError
    }

export type MergeRequestValidationError =
  | 'source-required'
  | 'target-required'
  | 'branches-must-differ'
  | 'title-required'
  | 'title-too-long'
  | 'title-invalid'
  | 'body-too-long'
  | 'body-invalid'
  | 'too-many-reviewers'
  | 'too-many-assignees'
  | 'duplicate-reviewers'
  | 'duplicate-assignees'
  | 'invalid-reviewer'
  | 'invalid-assignee'

export interface IMergeRequestDraftFields {
  readonly sourceBranch: string
  readonly targetBranch: string
  readonly title: string
  readonly body: string
  readonly draft: boolean
  readonly reviewerIds: ReadonlyArray<string>
  readonly assigneeIds: ReadonlyArray<string>
}

interface IBoundedOptions<T> {
  readonly values: ReadonlyArray<T>
  readonly changed: boolean
}

export interface IBoundedMergeRequestContext {
  readonly context: IMergeRequestEditorContext
  readonly capped: ReadonlyArray<MergeRequestCappedCollection>
}

const LegacyDraftPrefix = /^(?:(?:draft|wip):\s*)+/i
const ShaPattern = /^[0-9a-f]{40,64}$/i

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value)
}

function boundedUnique<T>(
  values: ReadonlyArray<T>,
  maximum: number,
  key: (value: T) => string,
  valid: (value: T) => boolean
): IBoundedOptions<T> {
  const result: T[] = []
  const seen = new Set<string>()
  let changed = values.length > maximum

  for (const value of values) {
    if (result.length >= maximum) {
      changed = true
      break
    }
    const identity = key(value)
    if (!valid(value) || seen.has(identity)) {
      changed = true
      continue
    }
    seen.add(identity)
    result.push(value)
  }

  return { values: result, changed }
}

function validBranch(branch: IMergeRequestBranchOption): boolean {
  return (
    branch.name.trim() === branch.name &&
    branch.name !== '' &&
    branch.name.length <= MergeRequestBranchMaximumLength &&
    !branch.name.startsWith('/') &&
    !branch.name.endsWith('/') &&
    !branch.name.endsWith('.') &&
    !branch.name.includes('..') &&
    !branch.name.includes('//') &&
    !branch.name.includes('@{') &&
    !/[\u0000-\u0020\u007f~^:?*\\[]/.test(branch.name)
  )
}

function validIdentity(identity: IMergeRequestIdentityOption): boolean {
  return (
    identity.id.trim() !== '' &&
    identity.id.length <= MergeRequestIdentityMaximumLength &&
    identity.displayName.trim() !== '' &&
    identity.displayName.length <= MergeRequestIdentityMaximumLength &&
    (identity.username === undefined ||
      (identity.username.length <= MergeRequestIdentityMaximumLength &&
        !hasControlCharacters(identity.username))) &&
    !hasControlCharacters(identity.id) &&
    !hasControlCharacters(identity.displayName)
  )
}

/** Bound, validate, and de-duplicate every server-provided choice list. */
export function boundMergeRequestEditorContext(
  input: IMergeRequestEditorContext
): IBoundedMergeRequestContext {
  const sourceBranches = boundedUnique(
    input.sourceBranches,
    MergeRequestMaximumBranchChoices,
    branch => branch.name,
    validBranch
  )
  const targetBranches = boundedUnique(
    input.targetBranches,
    MergeRequestMaximumBranchChoices,
    branch => branch.name,
    validBranch
  )
  const reviewers = boundedUnique(
    input.reviewers,
    MergeRequestMaximumIdentityChoices,
    identity => identity.id,
    validIdentity
  )
  const assignees = boundedUnique(
    input.assignees,
    MergeRequestMaximumIdentityChoices,
    identity => identity.id,
    validIdentity
  )
  const capped: MergeRequestCappedCollection[] = []
  if (sourceBranches.changed) {
    capped.push('sourceBranches')
  }
  if (targetBranches.changed) {
    capped.push('targetBranches')
  }
  if (reviewers.changed) {
    capped.push('reviewers')
  }
  if (assignees.changed) {
    capped.push('assignees')
  }

  return {
    context: {
      ...input,
      sourceBranches: sourceBranches.values,
      targetBranches: targetBranches.values,
      reviewers: reviewers.values,
      assignees: assignees.values,
    },
    capped,
  }
}

/**
 * Prefer the explicit draft flag. Older GitLab servers are supported by
 * recognizing and removing the legacy `Draft:` or `WIP:` title prefix.
 */
export function normalizeMergeRequestInitialValue(
  input: IMergeRequestEditorInitialValue = {}
): Required<IMergeRequestEditorInitialValue> {
  const originalTitle = input.title ?? ''
  const inferredDraft = LegacyDraftPrefix.test(originalTitle)
  const draft = input.draft ?? inferredDraft
  const title = draft
    ? originalTitle.replace(LegacyDraftPrefix, '').trimStart()
    : originalTitle

  return {
    sourceBranch: input.sourceBranch ?? '',
    targetBranch: input.targetBranch ?? '',
    title,
    body: input.body ?? '',
    draft,
    reviewerIds: [...(input.reviewerIds ?? [])],
    assigneeIds: [...(input.assigneeIds ?? [])],
  }
}

function duplicates(values: ReadonlyArray<string>): boolean {
  return new Set(values).size !== values.length
}

/** Validate an exact, already-bounded editor submission. */
export function validateMergeRequestDraft(
  draft: IMergeRequestDraftFields,
  context: IMergeRequestEditorContext
): ReadonlyArray<MergeRequestValidationError> {
  const errors: MergeRequestValidationError[] = []
  const source = draft.sourceBranch.trim()
  const target = draft.targetBranch.trim()
  const title = draft.title.trim()
  const sourceNames = new Set(context.sourceBranches.map(branch => branch.name))
  const targetNames = new Set(context.targetBranches.map(branch => branch.name))
  const reviewerIds = new Set(context.reviewers.map(identity => identity.id))
  const assigneeIds = new Set(context.assignees.map(identity => identity.id))

  if (source === '' || !sourceNames.has(source)) {
    errors.push('source-required')
  }
  if (target === '' || !targetNames.has(target)) {
    errors.push('target-required')
  }
  if (source !== '' && source === target) {
    errors.push('branches-must-differ')
  }
  if (title === '') {
    errors.push('title-required')
  } else if (draft.title.length > MergeRequestTitleMaximumLength) {
    errors.push('title-too-long')
  } else if (draft.title.trim() !== draft.title || draft.title.includes('\0')) {
    errors.push('title-invalid')
  }
  if (draft.body.length > MergeRequestBodyMaximumLength) {
    errors.push('body-too-long')
  } else if (draft.body.includes('\0')) {
    errors.push('body-invalid')
  }
  if (draft.reviewerIds.length > MergeRequestMaximumReviewers) {
    errors.push('too-many-reviewers')
  }
  if (draft.assigneeIds.length > MergeRequestMaximumAssignees) {
    errors.push('too-many-assignees')
  }
  if (duplicates(draft.reviewerIds)) {
    errors.push('duplicate-reviewers')
  }
  if (duplicates(draft.assigneeIds)) {
    errors.push('duplicate-assignees')
  }
  if (draft.reviewerIds.some(id => !reviewerIds.has(id))) {
    errors.push('invalid-reviewer')
  }
  if (draft.assigneeIds.some(id => !assigneeIds.has(id))) {
    errors.push('invalid-assignee')
  }

  return errors
}

export type MergeRequestReadiness =
  | { readonly kind: 'transient' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'blocked'; readonly status: string }
  | { readonly kind: 'unknown' }

const TransientDetailedMergeStatuses = new Set([
  'approvals_syncing',
  'checking',
  'preparing',
  'unchecked',
])

const BlockedDetailedMergeStatuses = new Set([
  'ci_must_pass',
  'ci_still_running',
  'commits_status',
  'conflict',
  'discussions_not_resolved',
  'draft_status',
  'jira_association_missing',
  'merge_request_blocked',
  'merge_time',
  'need_rebase',
  'not_approved',
  'not_open',
  'requested_changes',
  'security_policy_pipeline_check',
  'security_policy_violations',
  'status_checks_must_pass',
  'locked_paths',
  'locked_lfs_files',
  'title_regex',
])

/** Turn GitLab detailed merge status into a conservative UI state. */
export function classifyDetailedMergeStatus(
  value: string | undefined
): MergeRequestReadiness {
  const status = value?.trim().toLowerCase()
  if (status !== undefined && TransientDetailedMergeStatuses.has(status)) {
    return { kind: 'transient' }
  }
  if (status === 'mergeable') {
    return { kind: 'ready' }
  }
  if (status !== undefined && BlockedDetailedMergeStatuses.has(status)) {
    return { kind: 'blocked', status }
  }
  return { kind: 'unknown' }
}

/** Stable identity comparison without exposing account keys in visible UI. */
export function getMergeRequestRouteKey(
  route: IMergeRequestRouteIdentity
): string {
  return JSON.stringify([
    route.repositoryId,
    route.accountKey,
    route.friendlyEndpoint,
    route.projectPath,
  ])
}

export interface IMergeRequestApprovalContext {
  readonly route: IMergeRequestRouteIdentity
  readonly mergeRequestIid: number
  readonly headSha: string
}

export interface IMergeRequestApprovalIntent
  extends IMergeRequestApprovalContext {
  readonly approve: boolean
}

/**
 * Create an approval intent only while route, IID, and exact reviewed HEAD SHA
 * still match. The transport adapter must send `headSha` as GitLab's `sha`
 * guard and revalidate again immediately before its request.
 */
export function createHeadShaGuardedApprovalIntent(
  reviewed: IMergeRequestApprovalContext,
  current: IMergeRequestApprovalContext,
  approve: boolean
): IMergeRequestApprovalIntent | null {
  if (
    !Number.isSafeInteger(reviewed.mergeRequestIid) ||
    reviewed.mergeRequestIid <= 0 ||
    reviewed.mergeRequestIid !== current.mergeRequestIid ||
    getMergeRequestRouteKey(reviewed.route) !==
      getMergeRequestRouteKey(current.route) ||
    !ShaPattern.test(reviewed.headSha) ||
    !ShaPattern.test(current.headSha) ||
    reviewed.headSha.toLowerCase() !== current.headSha.toLowerCase()
  ) {
    return null
  }

  return { ...current, approve }
}
