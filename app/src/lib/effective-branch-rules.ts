/**
 * Normalized, error-aware evidence used by the effective branch-rules
 * inspector. API responses are converted to these shapes at the boundary so
 * the UI never has to interpret a missing field as `false`.
 */

export type BranchRulesFailureKind =
  | 'authentication'
  | 'permission'
  | 'not-found'
  | 'rate-limit'
  | 'network'
  | 'unavailable'
  | 'unknown'

/** Expected, user-actionable failure from the strict inspector loader. */
export class EffectiveBranchRulesError extends Error {
  public constructor(
    public readonly kind: BranchRulesFailureKind,
    message: string
  ) {
    super(message)
    this.name = 'EffectiveBranchRulesError'
  }
}

export function isEffectiveBranchRulesAbort(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}

export type BranchRulesEvidence<T> =
  | {
      readonly kind: 'available'
      readonly value: T
      /** Non-fatal gaps which must remain visible alongside partial results. */
      readonly warnings?: ReadonlyArray<string>
    }
  | { readonly kind: 'unsupported'; readonly message: string }
  | {
      readonly kind: 'unavailable'
      readonly failure: BranchRulesFailureKind
      readonly message: string
    }

export interface IClassicBranchProtectionEvidence {
  /** Whether a classic branch-protection rule matched this branch. */
  readonly protectionConfigured?: boolean
  /** Whether the selected account is admitted by classic push restrictions. */
  readonly pushAllowed?: boolean
  readonly pullRequestRequired?: boolean
  readonly requiredReviewCount?: number
  readonly requiredChecksConfigured?: boolean
  readonly requiredChecks?: ReadonlyArray<string>
  readonly requiredSignatures?: boolean
  readonly requiredLinearHistory?: boolean
  readonly deletionsAllowed?: boolean
  readonly forcePushesAllowed?: boolean
  readonly strictChecks?: boolean
  readonly dismissStaleReviews?: boolean
  readonly codeOwnerReviews?: boolean
  readonly lastPushApproval?: boolean
  readonly dismissalRestrictionsConfigured?: boolean
  readonly pullRequestBypassAllowancesConfigured?: boolean
  /** Whether the selected account has a directly provable PR-review bypass. */
  readonly pullRequestBypass?: boolean
  /** Whether classic requirements are enforced for repository administrators. */
  readonly enforceAdmins?: boolean
  readonly conversationResolution?: boolean
  readonly locked?: boolean
  readonly forkSyncingAllowed?: boolean
}

/** The subset of an active rules-for-branch response used by the inspector. */
export interface IApplicableBranchRule {
  readonly type: string
  readonly ruleset_id: number
  readonly ruleset_source_type?: string
  readonly ruleset_source?: string
  readonly parameters?: Readonly<Record<string, unknown>>
  /** False when a present parameters field had a malformed non-object shape. */
  readonly parametersComplete?: boolean
}

/** The subset of a full ruleset response used for source and bypass details. */
export interface IApplicableBranchRuleset {
  readonly id: number
  readonly name?: string
  readonly source_type?: string
  readonly source?: string
  readonly current_user_can_bypass?:
    | 'always'
    | 'exempt'
    | 'pull_requests_only'
    | 'pull_request'
    | 'never'
  readonly _links?: {
    readonly html?: { readonly href?: string }
  }
}

export interface IActiveRulesetEvidence {
  readonly rules: ReadonlyArray<IApplicableBranchRule>
  readonly rulesets: ReadonlyMap<number, IApplicableBranchRuleset>
  /** False when a safety bound stopped pagination before the final page. */
  readonly complete?: boolean
}

export type EffectiveRequirementState =
  | 'required'
  | 'not-required'
  | 'unknown'
  | 'unsupported'

export interface IEffectiveRequirement {
  readonly state: EffectiveRequirementState
  readonly sourceIds: ReadonlyArray<string>
}

export interface IEffectiveCountRequirement extends IEffectiveRequirement {
  readonly count?: number
  /** Whether no stricter count can exist in a partial response. */
  readonly countComplete: boolean
}

export interface IEffectiveListRequirement extends IEffectiveRequirement {
  readonly values: ReadonlyArray<string>
  readonly truncated: boolean
  /** Whether the displayed values are the complete effective set. */
  readonly valuesComplete: boolean
}

export type BranchOperationState =
  | 'allowed'
  | 'constrained'
  | 'blocked'
  | 'bypass'
  | 'unknown'

export type BranchMergeMethod = 'merge' | 'squash' | 'rebase'

export type BranchRulesBypassState =
  | 'always'
  | 'pull-request-only'
  | 'never'
  | 'unknown'

export interface IEffectiveBranchRuleSource {
  readonly id: string
  readonly kind: 'classic' | 'ruleset'
  readonly name: string
  readonly owner?: string
  readonly rulesetId?: number
  readonly url?: string
  readonly bypass: BranchRulesBypassState
  readonly ruleTypes: ReadonlyArray<string>
}

export interface IEffectiveBranchRules {
  readonly branch: string
  readonly fetchedAt: number
  readonly pullRequest: IEffectiveRequirement
  readonly reviews: IEffectiveCountRequirement
  readonly reviewDetails: ReadonlyArray<string>
  readonly reviewDetailsComplete: boolean
  readonly checks: IEffectiveListRequirement
  readonly checksMustUseLatestBranch: boolean | undefined
  readonly signatures: IEffectiveRequirement
  readonly linearHistory: IEffectiveRequirement
  readonly deployments: IEffectiveListRequirement
  readonly mergeQueue: IEffectiveRequirement
  readonly mergeQueueMethod: BranchMergeMethod | null
  readonly mergeQueueMethodComplete: boolean
  readonly conversationResolution: IEffectiveRequirement
  readonly allowedMergeMethods: ReadonlyArray<string>
  readonly push: BranchOperationState
  readonly update: BranchOperationState
  readonly updateDetails: ReadonlyArray<string>
  /** Deterministic repository-context reasons affecting operation states. */
  readonly operationDetails: ReadonlyArray<string>
  readonly deletion: BranchOperationState
  readonly forcePush: BranchOperationState
  readonly sources: ReadonlyArray<IEffectiveBranchRuleSource>
  readonly unknownRuleTypes: ReadonlyArray<string>
  readonly warnings: ReadonlyArray<string>
  readonly empty: boolean
}

export interface ISynthesizeEffectiveBranchRulesInput {
  readonly branch: string
  readonly repositoryURL: string
  /** Exact provider permission; null means GitHub did not return it. */
  readonly repositoryPermission: 'read' | 'write' | 'admin' | null
  /** Exact provider archive state; null means GitHub did not return it. */
  readonly repositoryArchived: boolean | null
  /** Exact provider disabled state; null means GitHub did not return it. */
  readonly repositoryDisabled: boolean | null
  /** Live provider fork identity; null means it could not be verified. */
  readonly repositoryIsFork: boolean | null
  /** Live provider pull-request feature availability. */
  readonly repositoryHasPullRequests: boolean | null
  /** Live provider policy controlling who may create pull requests. */
  readonly repositoryPullRequestCreationPolicy:
    | 'all'
    | 'collaborators_only'
    | null
  /** Merge methods enabled by the live repository response. */
  readonly repositoryMergeMethods: ReadonlyArray<BranchMergeMethod> | null
  /** Exact provider default branch; null means it could not be verified. */
  readonly defaultBranch: string | null
  readonly contextWarnings?: ReadonlyArray<string>
  readonly classic: BranchRulesEvidence<IClassicBranchProtectionEvidence>
  readonly rulesets: BranchRulesEvidence<IActiveRulesetEvidence>
  readonly fetchedAt?: number
}

const MaximumDisplayedValues = 100

const RuleType = {
  Creation: 'creation',
  Update: 'update',
  Deletion: 'deletion',
  LinearHistory: 'required_linear_history',
  Deployments: 'required_deployments',
  Signatures: 'required_signatures',
  StatusChecks: 'required_status_checks',
  PullRequest: 'pull_request',
  MergeQueue: 'merge_queue',
  NonFastForward: 'non_fast_forward',
  CopilotCodeReview: 'copilot_code_review',
} as const

const knownRuleTypes = new Set<string>([
  RuleType.Update,
  RuleType.Deletion,
  RuleType.LinearHistory,
  RuleType.Deployments,
  RuleType.Signatures,
  RuleType.StatusChecks,
  RuleType.PullRequest,
  RuleType.MergeQueue,
  RuleType.NonFastForward,
])

/**
 * Rules whose effect is known even when this inspector does not render a
 * dedicated summary row. A truly new rule type must fail closed for otherwise
 * permissive branch operations.
 */
const semanticallyKnownRuleTypes = new Set<string>([
  ...knownRuleTypes,
  RuleType.Creation,
  'commit_message_pattern',
  'commit_author_email_pattern',
  'committer_email_pattern',
  'branch_name_pattern',
  'workflows',
  'code_scanning',
  'license_compliance_scanning',
  'file_path_restriction',
  'max_file_path_length',
  'file_extension_restriction',
  'max_file_size',
  RuleType.CopilotCodeReview,
])

const nonUpdateGateRuleTypes = new Set<string>([
  RuleType.Creation,
  RuleType.Deletion,
  RuleType.NonFastForward,
  RuleType.CopilotCodeReview,
  'branch_name_pattern',
])

const handledRuleParameters = new Map<string, ReadonlySet<string>>([
  [
    RuleType.PullRequest,
    new Set([
      'required_approving_review_count',
      'dismiss_stale_reviews_on_push',
      'require_code_owner_review',
      'require_last_push_approval',
      'required_review_thread_resolution',
      'allowed_merge_methods',
      'required_reviewers',
      'dismissal_restriction',
    ]),
  ],
  [
    RuleType.StatusChecks,
    new Set([
      'required_status_checks',
      'strict_required_status_checks_policy',
      'do_not_enforce_on_create',
    ]),
  ],
  [RuleType.Deployments, new Set(['required_deployment_environments'])],
  [
    RuleType.MergeQueue,
    new Set([
      'check_response_timeout_minutes',
      'grouping_strategy',
      'max_entries_to_build',
      'max_entries_to_merge',
      'merge_method',
      'min_entries_to_merge',
      'min_entries_to_merge_wait_minutes',
    ]),
  ],
  [RuleType.Update, new Set(['update_allows_fetch_and_merge'])],
])

function uniqueSorted(values: Iterable<string>): ReadonlyArray<string> {
  return [...new Set([...values].filter(x => x.length > 0))].sort((a, b) =>
    a.localeCompare(b)
  )
}

function boundedValues(values: Iterable<string>) {
  const all = uniqueSorted(values)
  return {
    values: all.slice(0, MaximumDisplayedValues),
    truncated: all.length > MaximumDisplayedValues,
  }
}

function sourceIdForRuleset(id: number): string {
  return `ruleset-${id}`
}

function rulesOfType(
  rules: ReadonlyArray<IApplicableBranchRule>,
  type: string
): ReadonlyArray<IApplicableBranchRule> {
  return rules.filter(rule => rule.type === type)
}

function sourcesForRules(
  rules: ReadonlyArray<IApplicableBranchRule>
): ReadonlyArray<string> {
  return uniqueSorted(rules.map(rule => sourceIdForRuleset(rule.ruleset_id)))
}

function requirementState(
  required: boolean,
  complete: boolean,
  unsupported: boolean
): EffectiveRequirementState {
  if (required) {
    return 'required'
  }
  if (complete) {
    return 'not-required'
  }
  return unsupported ? 'unsupported' : 'unknown'
}

function booleanParameter(
  rule: IApplicableBranchRule,
  key: string
): boolean | undefined {
  if (rule.parametersComplete === false) {
    return undefined
  }
  const value = rule.parameters?.[key]
  return typeof value === 'boolean' ? value : undefined
}

function numberParameter(
  rule: IApplicableBranchRule,
  key: string
): number | undefined {
  if (rule.parametersComplete === false) {
    return undefined
  }
  const value = rule.parameters?.[key]
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 10
    ? value
    : undefined
}

function stringArrayParameter(
  rule: IApplicableBranchRule,
  key: string
): ReadonlyArray<string> | undefined {
  if (rule.parametersComplete === false) {
    return undefined
  }
  const value = rule.parameters?.[key]
  return Array.isArray(value) &&
    value.every(item => typeof item === 'string' && item.trim().length > 0)
    ? value
    : undefined
}

type AllowedMergeMethodsParameter =
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'available'
      readonly values: ReadonlyArray<BranchMergeMethod>
    }
  | { readonly kind: 'invalid' }

function allowedMergeMethodsParameter(
  rule: IApplicableBranchRule
): AllowedMergeMethodsParameter {
  if (rule.parametersComplete === false) {
    return { kind: 'invalid' }
  }
  const parameters = rule.parameters
  if (
    parameters === undefined ||
    !Object.prototype.hasOwnProperty.call(parameters, 'allowed_merge_methods')
  ) {
    return { kind: 'absent' }
  }

  const value = parameters.allowed_merge_methods
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      method => method === 'merge' || method === 'squash' || method === 'rebase'
    )
  ) {
    return { kind: 'invalid' }
  }
  return {
    kind: 'available',
    values: uniqueSorted(value) as ReadonlyArray<BranchMergeMethod>,
  }
}

interface IMergeQueueParametersSummary {
  readonly complete: boolean
  readonly method: BranchMergeMethod | undefined
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number
): boolean {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  )
}

function mergeQueueParametersSummary(
  rule: IApplicableBranchRule
): IMergeQueueParametersSummary {
  if (rule.parametersComplete === false) {
    return { complete: false, method: undefined }
  }
  const parameters = rule.parameters
  if (parameters === undefined) {
    return { complete: false, method: undefined }
  }

  let method: BranchMergeMethod | undefined
  switch (parameters.merge_method) {
    case 'MERGE':
      method = 'merge'
      break
    case 'SQUASH':
      method = 'squash'
      break
    case 'REBASE':
      method = 'rebase'
      break
  }

  return {
    method,
    complete:
      integerInRange(parameters.check_response_timeout_minutes, 1, 360) &&
      (parameters.grouping_strategy === 'ALLGREEN' ||
        parameters.grouping_strategy === 'HEADGREEN') &&
      integerInRange(parameters.max_entries_to_build, 0, 100) &&
      integerInRange(parameters.max_entries_to_merge, 0, 100) &&
      method !== undefined &&
      integerInRange(parameters.min_entries_to_merge, 0, 100) &&
      integerInRange(parameters.min_entries_to_merge_wait_minutes, 0, 360),
  }
}

interface IRequiredReviewerSummary {
  readonly hasMandatoryApprovals: boolean
  readonly complete: boolean
  readonly truncated: boolean
  readonly details: ReadonlyArray<string>
}

interface IReviewerPatternApplicability {
  readonly hasAffirmativePattern: boolean
  readonly hasInvalidPattern: boolean
  readonly mandatoryApprovalProven: boolean
  readonly complete: boolean
}

interface IEffectiveReviewerPattern {
  readonly value: string
  readonly valid: boolean
}

function effectiveReviewerPattern(pattern: string): IEffectiveReviewerPattern {
  for (let index = 0; index < pattern.length; index++) {
    const code = pattern.charCodeAt(index)
    if (code < 0x20 && code !== 0x09) {
      return { value: pattern, valid: false }
    }
  }

  let end = pattern.length
  while (end > 0 && pattern[end - 1] === ' ') {
    let precedingBackslashes = 0
    for (let index = end - 2; index >= 0; index--) {
      if (pattern[index] !== '\\') {
        break
      }
      precedingBackslashes++
    }
    if (precedingBackslashes % 2 === 1) {
      break
    }
    end--
  }

  const value = pattern.slice(0, end)
  let trailingBackslashes = 0
  for (let index = value.length - 1; index >= 0; index--) {
    if (value[index] !== '\\') {
      break
    }
    trailingBackslashes++
  }
  return { value, valid: trailingBackslashes % 2 === 0 }
}

function reviewerPatternApplicability(
  patterns: ReadonlyArray<string>
): IReviewerPatternApplicability {
  let lastUncertaintyIndex = -1
  let hasInvalidPattern = false
  const affirmativePatternIndexes = new Array<number>()

  for (const [index, pattern] of patterns.entries()) {
    const effectivePattern = effectiveReviewerPattern(pattern)
    if (!effectivePattern.valid) {
      hasInvalidPattern = true
      lastUncertaintyIndex = index
      continue
    }
    if (
      effectivePattern.value.length === 0 ||
      effectivePattern.value[0] === '#'
    ) {
      continue
    }
    if (effectivePattern.value[0] === '!') {
      lastUncertaintyIndex = index
      continue
    }
    affirmativePatternIndexes.push(index)
  }

  if (affirmativePatternIndexes.length === 0) {
    return {
      hasAffirmativePattern: false,
      hasInvalidPattern,
      mandatoryApprovalProven: false,
      complete: !hasInvalidPattern,
    }
  }

  const mandatoryApprovalProven = affirmativePatternIndexes.some(
    index => index > lastUncertaintyIndex
  )
  return {
    hasAffirmativePattern: true,
    hasInvalidPattern,
    mandatoryApprovalProven,
    complete: mandatoryApprovalProven && !hasInvalidPattern,
  }
}

function requiredReviewerSummary(
  rule: IApplicableBranchRule
): IRequiredReviewerSummary {
  if (rule.parametersComplete === false) {
    return {
      hasMandatoryApprovals: false,
      complete: false,
      truncated: false,
      details: [],
    }
  }
  const value = rule.parameters?.required_reviewers
  if (value === undefined) {
    return {
      hasMandatoryApprovals: false,
      complete: true,
      truncated: false,
      details: [],
    }
  }
  if (!Array.isArray(value)) {
    return {
      hasMandatoryApprovals: false,
      complete: false,
      truncated: false,
      details: [],
    }
  }

  let complete = value.length <= 15
  let hasMandatoryApprovals = false
  let detailCandidates = 0
  const details = new Array<string>()
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      complete = false
      continue
    }

    const minimum = 'minimum_approvals' in item ? item.minimum_approvals : null
    const filePatterns = 'file_patterns' in item ? item.file_patterns : null
    const reviewer = 'reviewer' in item ? item.reviewer : null
    const minimumValid =
      typeof minimum === 'number' &&
      Number.isSafeInteger(minimum) &&
      minimum >= 0 &&
      minimum <= 10
    const patternsValid =
      Array.isArray(filePatterns) &&
      filePatterns.every(pattern => typeof pattern === 'string')
    const reviewerValid =
      typeof reviewer === 'object' &&
      reviewer !== null &&
      !Array.isArray(reviewer) &&
      'id' in reviewer &&
      typeof reviewer.id === 'number' &&
      Number.isSafeInteger(reviewer.id) &&
      reviewer.id > 0 &&
      'type' in reviewer &&
      reviewer.type === 'Team'

    if (!minimumValid || !patternsValid || !reviewerValid) {
      complete = false
    }
    if (minimumValid) {
      const patternCount = patternsValid
        ? (filePatterns as ReadonlyArray<unknown>).length
        : undefined
      const patternApplicability = patternsValid
        ? reviewerPatternApplicability(filePatterns as ReadonlyArray<string>)
        : undefined
      if (
        minimum > 0 &&
        patternApplicability !== undefined &&
        !patternApplicability.complete
      ) {
        complete = false
      }
      hasMandatoryApprovals ||=
        minimum > 0 && patternApplicability?.mandatoryApprovalProven === true
      detailCandidates++
      if (details.length < MaximumDisplayedValues) {
        details.push(
          patternsValid && reviewerValid
            ? minimum > 0 &&
              patternApplicability?.hasInvalidPattern === true &&
              !patternApplicability.mandatoryApprovalProven
              ? 'A conditional reviewer file pattern could not be evaluated safely, so its mandatory applicability remains unknown.'
              : patternApplicability?.hasAffirmativePattern !== true
              ? 'A designated conditional reviewer has no affirmative configured file patterns, so no mandatory approval is claimed.'
              : minimum === 0
              ? `Matching changes request an optional review from a designated team across ${patternCount?.toLocaleString()} configured file ${
                  patternCount === 1 ? 'pattern' : 'patterns'
                }.`
              : patternApplicability.mandatoryApprovalProven === false
              ? 'A later negated file pattern prevents this conditional approval from being summarized definitively.'
              : `Matching changes require at least ${minimum.toLocaleString()} ${
                  minimum === 1 ? 'approval' : 'approvals'
                } from a designated team across ${patternCount?.toLocaleString()} configured file ${
                  patternCount === 1 ? 'pattern' : 'patterns'
                }.`
            : minimum > 0
            ? 'Matching changes require conditional approvals that could not be summarized completely.'
            : 'A conditional reviewer setting could not be summarized completely.'
        )
      }
    }
  }

  return {
    hasMandatoryApprovals,
    complete,
    truncated: detailCandidates > MaximumDisplayedValues,
    details,
  }
}

interface IDismissalRestrictionSummary {
  readonly enabled: boolean
  readonly complete: boolean
}

function dismissalRestrictionSummary(
  rule: IApplicableBranchRule
): IDismissalRestrictionSummary {
  if (rule.parametersComplete === false) {
    return { enabled: false, complete: false }
  }
  const value = rule.parameters?.dismissal_restriction
  if (value === undefined) {
    return { enabled: false, complete: true }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { enabled: false, complete: false }
  }

  const enabled = 'enabled' in value ? value.enabled : undefined
  const actors = 'allowed_actors' in value ? value.allowed_actors : undefined
  const actorsValid =
    actors === undefined ||
    (Array.isArray(actors) &&
      actors.every(
        actor =>
          typeof actor === 'object' &&
          actor !== null &&
          !Array.isArray(actor) &&
          'id' in actor &&
          typeof actor.id === 'number' &&
          Number.isSafeInteger(actor.id) &&
          actor.id > 0 &&
          'type' in actor &&
          [
            'User',
            'Team',
            'IntegrationInstallation',
            'RepositoryRole',
          ].includes(typeof actor.type === 'string' ? actor.type : '')
      ))

  return {
    enabled: enabled === true,
    complete: typeof enabled === 'boolean' && actorsValid,
  }
}

function requiredCheckNames(
  rule: IApplicableBranchRule
): ReadonlyArray<string> | undefined {
  if (rule.parametersComplete === false) {
    return undefined
  }
  const value = rule.parameters?.required_status_checks
  if (!Array.isArray(value)) {
    return undefined
  }

  const names = new Array<string>()
  for (const item of value) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('context' in item) ||
      typeof item.context !== 'string' ||
      item.context.trim().length === 0
    ) {
      return undefined
    }
    names.push(item.context)
  }
  return names
}

function safeSourceURL(
  repositoryURL: string,
  candidate: string | undefined
): string | undefined {
  if (candidate === undefined) {
    return undefined
  }
  try {
    const repository = new URL(repositoryURL)
    const target = new URL(candidate)
    if (
      !['http:', 'https:'].includes(target.protocol) ||
      target.origin !== repository.origin ||
      target.username !== '' ||
      target.password !== ''
    ) {
      return undefined
    }
    return target.toString()
  } catch {
    return undefined
  }
}

function bypassState(
  ruleset: IApplicableBranchRuleset | undefined
): BranchRulesBypassState {
  switch (ruleset?.current_user_can_bypass) {
    case 'always':
    case 'exempt':
      return 'always'
    case 'pull_request':
    case 'pull_requests_only':
      return 'pull-request-only'
    case 'never':
      return 'never'
    default:
      return 'unknown'
  }
}

function operationForRestrictedRules(
  rules: ReadonlyArray<IApplicableBranchRule>,
  rulesets: ReadonlyMap<number, IApplicableBranchRuleset>,
  complete: boolean
): BranchOperationState | null {
  if (rules.length === 0) {
    return complete ? null : 'unknown'
  }

  const bypass = rules.map(rule => bypassState(rulesets.get(rule.ruleset_id)))
  if (
    bypass.some(value => value === 'never' || value === 'pull-request-only')
  ) {
    return 'blocked'
  }
  if (bypass.some(value => value === 'unknown')) {
    return 'constrained'
  }
  return complete ? 'bypass' : 'constrained'
}

function operationForUpdateRules(
  rules: ReadonlyArray<IApplicableBranchRule>,
  rulesets: ReadonlyMap<number, IApplicableBranchRuleset>,
  complete: boolean
): BranchOperationState | null {
  if (rules.length === 0) {
    return complete ? null : 'unknown'
  }

  const bypass = rules.map(rule => bypassState(rulesets.get(rule.ruleset_id)))
  if (bypass.some(value => value === 'never')) {
    return 'blocked'
  }
  if (
    bypass.some(value => value === 'unknown' || value === 'pull-request-only')
  ) {
    return 'constrained'
  }
  return complete ? 'bypass' : 'constrained'
}

function isUpdateGatingRule(rule: IApplicableBranchRule): boolean {
  return !nonUpdateGateRuleTypes.has(rule.type)
}

function operationForUpdateGates(
  rules: ReadonlyArray<IApplicableBranchRule>,
  rulesets: ReadonlyMap<number, IApplicableBranchRuleset>,
  complete: boolean
): BranchOperationState | null {
  if (rules.length === 0) {
    return complete ? null : 'unknown'
  }

  const bypass = rules.map(rule => bypassState(rulesets.get(rule.ruleset_id)))
  return bypass.every(value => value === 'always') && complete
    ? 'bypass'
    : 'constrained'
}

function mergeOperationStates(
  states: ReadonlyArray<BranchOperationState | null>
): BranchOperationState {
  const present = states.filter(
    (state): state is BranchOperationState => state !== null
  )
  if (present.some(state => state === 'blocked')) {
    return 'blocked'
  }
  if (present.some(state => state === 'constrained')) {
    return 'constrained'
  }
  if (present.some(state => state === 'unknown')) {
    return 'unknown'
  }
  if (present.some(state => state === 'bypass')) {
    return 'bypass'
  }
  return 'allowed'
}

function classicAdminBypass(
  classic: IClassicBranchProtectionEvidence | undefined,
  input: ISynthesizeEffectiveBranchRulesInput
): boolean | undefined {
  if (classic?.protectionConfigured === false) {
    return false
  }
  if (classic?.protectionConfigured !== true) {
    return undefined
  }
  if (classic.enforceAdmins === true) {
    return false
  }
  if (classic.enforceAdmins === false) {
    return input.repositoryPermission === 'admin'
      ? true
      : input.repositoryPermission === 'read'
      ? false
      : undefined
  }
  return input.repositoryPermission === 'read' ? false : undefined
}

function classicLockOperationState(
  classic: IClassicBranchProtectionEvidence | undefined,
  input: ISynthesizeEffectiveBranchRulesInput
): BranchOperationState | null {
  if (classic === undefined || classic.locked === false) {
    return null
  }
  if (classic.locked === undefined) {
    return 'unknown'
  }

  const adminBypass = classicAdminBypass(classic, input)
  return adminBypass === true
    ? 'bypass'
    : adminBypass === undefined
    ? 'constrained'
    : 'blocked'
}

function classicUpdateGateOperationState(
  classic: IClassicBranchProtectionEvidence | undefined,
  input: ISynthesizeEffectiveBranchRulesInput
): BranchOperationState | null {
  if (classic === undefined) {
    return null
  }

  const pullRequestGate =
    classic.pullRequestRequired === true ||
    (classic.requiredReviewCount ?? 0) > 0
  const otherGate =
    classic.requiredChecksConfigured === true ||
    (classic.requiredChecks?.length ?? 0) > 0 ||
    classic.requiredSignatures === true ||
    classic.requiredLinearHistory === true ||
    classic.conversationResolution === true
  if (!pullRequestGate && !otherGate) {
    return null
  }

  if (classicAdminBypass(classic, input) === true) {
    return 'bypass'
  }
  if (otherGate) {
    return 'constrained'
  }
  return classic.pullRequestBypass === true ? 'bypass' : 'constrained'
}

function classicPullRequestRouteState(
  classic: IClassicBranchProtectionEvidence | undefined,
  input: ISynthesizeEffectiveBranchRulesInput
): BranchOperationState | null {
  const requiresPullRequest =
    classic?.pullRequestRequired === true ||
    (classic?.requiredReviewCount ?? 0) > 0 ||
    classic?.codeOwnerReviews === true ||
    classic?.lastPushApproval === true
  if (!requiresPullRequest) {
    return null
  }

  const adminBypass = classicAdminBypass(classic, input)
  if (adminBypass === true || classic?.pullRequestBypass === true) {
    return 'bypass'
  }
  if (adminBypass === undefined || classic?.pullRequestBypass === undefined) {
    return 'constrained'
  }
  return 'blocked'
}

function mergeOperationEvidence(
  classicAllowed: boolean | undefined,
  ruleState: BranchOperationState | null,
  rulesComplete: boolean
): BranchOperationState {
  if (classicAllowed === false || ruleState === 'blocked') {
    return 'blocked'
  }
  if (ruleState === 'constrained') {
    return 'constrained'
  }
  if (classicAllowed === true && ruleState === 'bypass') {
    return 'bypass'
  }
  if (classicAllowed === true && ruleState === null && rulesComplete) {
    return 'allowed'
  }
  return 'unknown'
}

function classicForcePushAllowed(
  classic: IClassicBranchProtectionEvidence | undefined,
  input: ISynthesizeEffectiveBranchRulesInput
): boolean | undefined {
  const actorAllowed =
    input.repositoryPermission === 'admin' ? true : classic?.pushAllowed
  if (
    classic?.forcePushesAllowed === false ||
    input.repositoryPermission === 'read' ||
    actorAllowed === false
  ) {
    return false
  }
  if (
    classic?.forcePushesAllowed !== true ||
    actorAllowed !== true ||
    classic.protectionConfigured !== false
  ) {
    return undefined
  }
  return true
}

function classicDeletionLockState(
  classic: IClassicBranchProtectionEvidence | undefined
): BranchOperationState | null {
  return classic?.locked === true
    ? 'blocked'
    : classic?.locked === false
    ? null
    : 'unknown'
}

function failClosedForUnknownRuleSemantics(
  state: BranchOperationState,
  unknownRuleSemantics: boolean
): BranchOperationState {
  if (!unknownRuleSemantics) {
    return state
  }
  if (state === 'allowed') {
    return 'unknown'
  }
  if (state === 'bypass') {
    return 'constrained'
  }
  return state
}

function mergeForcePushWithUpdate(
  forcePush: BranchOperationState,
  update: BranchOperationState
): BranchOperationState {
  if (forcePush === 'blocked' || update === 'blocked') {
    return 'blocked'
  }
  if (forcePush === 'constrained' || update === 'constrained') {
    return 'constrained'
  }
  if (forcePush === 'unknown' || update === 'unknown') {
    return 'unknown'
  }
  if (forcePush === 'bypass' || update === 'bypass') {
    return 'bypass'
  }
  return 'allowed'
}

function applyRepositoryWriteContext(
  state: BranchOperationState,
  input: ISynthesizeEffectiveBranchRulesInput
): BranchOperationState {
  if (
    input.repositoryArchived === true ||
    input.repositoryPermission === 'read'
  ) {
    return 'blocked'
  }
  if (
    (input.repositoryArchived === null ||
      input.repositoryPermission === null ||
      input.repositoryDisabled !== false) &&
    (state === 'allowed' || state === 'bypass')
  ) {
    return 'unknown'
  }
  return state
}

function applyDefaultBranchDeletionContext(
  state: BranchOperationState,
  input: ISynthesizeEffectiveBranchRulesInput
): BranchOperationState {
  if (input.defaultBranch === input.branch) {
    return 'blocked'
  }
  if (
    input.defaultBranch === null &&
    (state === 'allowed' || state === 'bypass')
  ) {
    return 'unknown'
  }
  return state
}

function buildSources(
  input: ISynthesizeEffectiveBranchRulesInput,
  rules: ReadonlyArray<IApplicableBranchRule>,
  rulesets: ReadonlyMap<number, IApplicableBranchRuleset>
): ReadonlyArray<IEffectiveBranchRuleSource> {
  const sources = new Array<IEffectiveBranchRuleSource>()
  if (
    input.classic.kind === 'available' &&
    input.classic.value.protectionConfigured === true
  ) {
    sources.push({
      id: 'classic',
      kind: 'classic',
      name: 'Classic branch protection',
      bypass: 'unknown',
      ruleTypes: [],
    })
  }

  const rulesById = new Map<number, IApplicableBranchRule[]>()
  for (const rule of rules) {
    const grouped = rulesById.get(rule.ruleset_id) ?? []
    grouped.push(rule)
    rulesById.set(rule.ruleset_id, grouped)
  }

  for (const [id, grouped] of rulesById) {
    const details = rulesets.get(id)
    const first = grouped[0]
    sources.push({
      id: sourceIdForRuleset(id),
      kind: 'ruleset',
      name: details?.name?.trim() || `Ruleset ${id}`,
      owner:
        details?.source?.trim() || first?.ruleset_source?.trim() || undefined,
      rulesetId: id,
      url: safeSourceURL(input.repositoryURL, details?._links?.html?.href),
      bypass: bypassState(details),
      ruleTypes: uniqueSorted(grouped.map(rule => rule.type)),
    })
  }
  return sources
}

/**
 * Synthesize the strictest applicable state. A positive rule is definitive,
 * while a negative result is reported only when every source that could add
 * that rule was queried successfully (or is unsupported by that host).
 */
export function synthesizeEffectiveBranchRules(
  input: ISynthesizeEffectiveBranchRulesInput
): IEffectiveBranchRules {
  const classic =
    input.classic.kind === 'available' ? input.classic.value : undefined
  const rulesEvidence =
    input.rulesets.kind === 'available' ? input.rulesets.value : undefined
  const rules = rulesEvidence?.rules ?? []
  const rulesets = rulesEvidence?.rulesets ?? new Map()
  const rulesAvailableComplete =
    input.rulesets.kind === 'available' &&
    input.rulesets.value.complete !== false
  const rulesComplete =
    rulesAvailableComplete || input.rulesets.kind === 'unsupported'
  const rulesUnsupported = input.rulesets.kind === 'unsupported'
  const ruleHasUnknownSemantics = (rule: IApplicableBranchRule) => {
    if (rule.parametersComplete === false) {
      return true
    }
    if (!semanticallyKnownRuleTypes.has(rule.type)) {
      return true
    }
    if (!knownRuleTypes.has(rule.type)) {
      return false
    }
    const handled = handledRuleParameters.get(rule.type) ?? new Set<string>()
    return Object.keys(rule.parameters ?? {}).some(key => !handled.has(key))
  }
  const unknownRuleSemantics = rules.some(
    rule =>
      ruleHasUnknownSemantics(rule) &&
      bypassState(rulesets.get(rule.ruleset_id)) !== 'always'
  )

  const pullRequestRules = rulesOfType(rules, RuleType.PullRequest)
  const checkRules = rulesOfType(rules, RuleType.StatusChecks)
  const signatureRules = rulesOfType(rules, RuleType.Signatures)
  const linearRules = rulesOfType(rules, RuleType.LinearHistory)
  const deploymentRules = rulesOfType(rules, RuleType.Deployments)
  const mergeQueueRules = rulesOfType(rules, RuleType.MergeQueue)
  const workflowRules = rulesOfType(rules, 'workflows')
  const updateRules = rulesOfType(rules, RuleType.Update)

  const pullRequestRequired =
    classic?.pullRequestRequired === true ||
    (classic?.requiredReviewCount ?? 0) > 0 ||
    pullRequestRules.length > 0 ||
    mergeQueueRules.length > 0 ||
    workflowRules.length > 0
  const pullRequestComplete =
    classic?.pullRequestRequired !== undefined && rulesComplete
  const pullRequest: IEffectiveRequirement = {
    state: requirementState(pullRequestRequired, pullRequestComplete, false),
    sourceIds: uniqueSorted([
      ...(classic?.pullRequestRequired === true ||
      (classic?.requiredReviewCount ?? 0) > 0
        ? ['classic']
        : []),
      ...sourcesForRules(pullRequestRules),
      ...sourcesForRules(mergeQueueRules),
      ...sourcesForRules(workflowRules),
    ]),
  }

  const ruleReviewCounts = pullRequestRules.map(rule =>
    numberParameter(rule, 'required_approving_review_count')
  )
  const requiredReviewerSummaries = pullRequestRules.map(
    requiredReviewerSummary
  )
  const mandatoryReviewerRules = pullRequestRules.filter(
    (_rule, index) =>
      requiredReviewerSummaries[index]?.hasMandatoryApprovals === true
  )
  const codeOwnerApprovalRequired =
    classic?.codeOwnerReviews === true ||
    pullRequestRules.some(
      rule => booleanParameter(rule, 'require_code_owner_review') === true
    )
  const lastPushApprovalRequired =
    classic?.lastPushApproval === true ||
    pullRequestRules.some(
      rule => booleanParameter(rule, 'require_last_push_approval') === true
    )
  const knownReviewCounts = [
    classic?.requiredReviewCount,
    ...ruleReviewCounts,
    ...(lastPushApprovalRequired ? [1] : []),
  ]
    .filter((value): value is number => value !== undefined)
    .map(value => Math.max(0, Math.floor(value)))
  const reviewCount =
    knownReviewCounts.length === 0 ? undefined : Math.max(...knownReviewCounts)
  const reviewCountComplete =
    classic?.requiredReviewCount !== undefined &&
    rulesComplete &&
    ruleReviewCounts.every(value => value !== undefined) &&
    requiredReviewerSummaries.every(summary => summary.complete) &&
    mandatoryReviewerRules.length === 0 &&
    !codeOwnerApprovalRequired &&
    !lastPushApprovalRequired
  const reviews: IEffectiveCountRequirement = {
    state: requirementState(
      (reviewCount ?? 0) > 0 ||
        mandatoryReviewerRules.length > 0 ||
        codeOwnerApprovalRequired ||
        lastPushApprovalRequired,
      reviewCountComplete,
      false
    ),
    count: reviewCount,
    countComplete: reviewCountComplete,
    sourceIds: uniqueSorted([
      ...((classic?.requiredReviewCount ?? 0) > 0 ||
      classic?.codeOwnerReviews === true ||
      classic?.lastPushApproval === true
        ? ['classic']
        : []),
      ...sourcesForRules(
        pullRequestRules.filter(
          (rule, index) =>
            (numberParameter(rule, 'required_approving_review_count') ?? 0) >
              0 ||
            requiredReviewerSummaries[index]?.hasMandatoryApprovals === true ||
            booleanParameter(rule, 'require_code_owner_review') === true ||
            booleanParameter(rule, 'require_last_push_approval') === true
        )
      ),
    ]),
  }

  const reviewDetails = new Array<string>()
  reviewDetails.push(
    ...requiredReviewerSummaries.flatMap(summary => summary.details)
  )
  if (
    classic?.dismissStaleReviews === true ||
    pullRequestRules.some(
      rule => booleanParameter(rule, 'dismiss_stale_reviews_on_push') === true
    )
  ) {
    reviewDetails.push('New reviewable pushes dismiss stale approvals.')
  }
  if (codeOwnerApprovalRequired) {
    reviewDetails.push('Code-owner approval is required for matching changes.')
  }
  if (lastPushApprovalRequired) {
    reviewDetails.push(
      'The last reviewable push needs another person’s approval.'
    )
  }
  const dismissalRestrictionSummaries = pullRequestRules.map(
    dismissalRestrictionSummary
  )
  if (
    classic?.dismissalRestrictionsConfigured === true ||
    dismissalRestrictionSummaries.some(summary => summary.enabled)
  ) {
    reviewDetails.push(
      'Approval dismissals are restricted to configured actors.'
    )
  }
  if (classic?.pullRequestBypassAllowancesConfigured === true) {
    reviewDetails.push(
      classic.pullRequestBypass === true
        ? 'This account has a classic pull-request review bypass allowance.'
        : 'Classic pull-request review bypass allowances are configured.'
    )
  }
  const reviewDetailsStructurallyComplete =
    classic?.dismissStaleReviews !== undefined &&
    classic.codeOwnerReviews !== undefined &&
    classic.lastPushApproval !== undefined &&
    classic.dismissalRestrictionsConfigured !== undefined &&
    classic.pullRequestBypassAllowancesConfigured !== undefined &&
    classic.pullRequestBypass !== undefined &&
    rulesComplete &&
    requiredReviewerSummaries.every(
      summary => summary.complete && !summary.truncated
    ) &&
    dismissalRestrictionSummaries.every(summary => summary.complete) &&
    pullRequestRules.every(
      rule =>
        booleanParameter(rule, 'dismiss_stale_reviews_on_push') !== undefined &&
        booleanParameter(rule, 'require_code_owner_review') !== undefined &&
        booleanParameter(rule, 'require_last_push_approval') !== undefined
    )
  const allReviewDetails = uniqueSorted(reviewDetails)
  const reviewDetailsTruncated =
    allReviewDetails.length > MaximumDisplayedValues ||
    requiredReviewerSummaries.some(summary => summary.truncated)
  const displayedReviewDetails = allReviewDetails.slice(
    0,
    MaximumDisplayedValues
  )
  const reviewDetailsComplete =
    reviewDetailsStructurallyComplete && !reviewDetailsTruncated

  const classicChecksConfigured =
    classic?.requiredChecksConfigured ??
    (classic?.requiredChecks === undefined
      ? undefined
      : classic.requiredChecks.length > 0)
  const checkNames = boundedValues([
    ...(classic?.requiredChecks ?? []),
    ...checkRules.flatMap(rule => requiredCheckNames(rule) ?? []),
  ])
  const checksRequired =
    classicChecksConfigured === true || checkRules.length > 0
  const checksComplete =
    classicChecksConfigured !== undefined &&
    (classicChecksConfigured === false ||
      classic?.requiredChecks !== undefined) &&
    rulesComplete &&
    checkRules.every(rule => requiredCheckNames(rule) !== undefined)
  const checks: IEffectiveListRequirement = {
    state: requirementState(checksRequired, checksComplete, false),
    sourceIds: uniqueSorted([
      ...(classicChecksConfigured === true ? ['classic'] : []),
      ...sourcesForRules(checkRules),
    ]),
    valuesComplete: checksComplete,
    ...checkNames,
  }
  const strictCheckValues = [
    classic?.strictChecks,
    ...checkRules.map(rule =>
      booleanParameter(rule, 'strict_required_status_checks_policy')
    ),
  ]
  const strictChecksComplete =
    classic?.strictChecks !== undefined &&
    rulesComplete &&
    checkRules.every(
      rule =>
        booleanParameter(rule, 'strict_required_status_checks_policy') !==
        undefined
    )
  const checksMustUseLatestBranch = strictCheckValues.some(x => x === true)
    ? true
    : strictChecksComplete
    ? false
    : undefined

  const signaturesRequired =
    classic?.requiredSignatures === true || signatureRules.length > 0
  const signatures: IEffectiveRequirement = {
    state: requirementState(
      signaturesRequired,
      classic?.requiredSignatures !== undefined && rulesComplete,
      false
    ),
    sourceIds: uniqueSorted([
      ...(classic?.requiredSignatures === true ? ['classic'] : []),
      ...sourcesForRules(signatureRules),
    ]),
  }

  const linearRequired =
    classic?.requiredLinearHistory === true || linearRules.length > 0
  const linearHistory: IEffectiveRequirement = {
    state: requirementState(
      linearRequired,
      classic?.requiredLinearHistory !== undefined && rulesComplete,
      false
    ),
    sourceIds: uniqueSorted([
      ...(classic?.requiredLinearHistory === true ? ['classic'] : []),
      ...sourcesForRules(linearRules),
    ]),
  }

  const deploymentValues = boundedValues(
    deploymentRules.flatMap(
      rule =>
        stringArrayParameter(rule, 'required_deployment_environments') ?? []
    )
  )
  const deploymentValuesComplete =
    rulesAvailableComplete &&
    classic?.protectionConfigured === false &&
    deploymentRules.every(
      rule =>
        stringArrayParameter(rule, 'required_deployment_environments') !==
        undefined
    )
  const deployments: IEffectiveListRequirement = {
    state: requirementState(
      deploymentRules.length > 0,
      rulesAvailableComplete && classic?.protectionConfigured === false,
      rulesUnsupported && classic?.protectionConfigured === false
    ),
    sourceIds: sourcesForRules(deploymentRules),
    valuesComplete: deploymentValuesComplete,
    ...deploymentValues,
  }
  const mergeQueue: IEffectiveRequirement = {
    state: requirementState(
      mergeQueueRules.length > 0,
      rulesAvailableComplete && classic?.protectionConfigured === false,
      rulesUnsupported && classic?.protectionConfigured === false
    ),
    sourceIds: sourcesForRules(mergeQueueRules),
  }

  const threadResolutionRules = pullRequestRules.filter(
    rule => booleanParameter(rule, 'required_review_thread_resolution') === true
  )
  const conversationResolution: IEffectiveRequirement = {
    state: requirementState(
      classic?.conversationResolution === true ||
        threadResolutionRules.length > 0,
      classic?.conversationResolution !== undefined &&
        rulesComplete &&
        pullRequestRules.every(
          rule =>
            booleanParameter(rule, 'required_review_thread_resolution') !==
            undefined
        ),
      false
    ),
    sourceIds: uniqueSorted([
      ...(classic?.conversationResolution === true ? ['classic'] : []),
      ...sourcesForRules(threadResolutionRules),
    ]),
  }

  const mergeMethodParameters = pullRequestRules.map(
    allowedMergeMethodsParameter
  )
  const mergeMethodsComplete =
    input.repositoryMergeMethods !== null &&
    input.repositoryHasPullRequests !== null &&
    rulesComplete &&
    (linearHistory.state === 'required' ||
      linearHistory.state === 'not-required') &&
    mergeMethodParameters.every(parameter => parameter.kind !== 'invalid')
  const allowedMergeMethods: ReadonlyArray<BranchMergeMethod> =
    !mergeMethodsComplete || input.repositoryMergeMethods === null
      ? []
      : (uniqueSorted(
          mergeMethodParameters.reduce<ReadonlyArray<BranchMergeMethod>>(
            (allowed, parameter) =>
              parameter.kind === 'available'
                ? allowed.filter(method => parameter.values.includes(method))
                : allowed,
            input.repositoryHasPullRequests === false
              ? []
              : linearHistory.state === 'required'
              ? input.repositoryMergeMethods.filter(
                  method => method !== 'merge'
                )
              : input.repositoryMergeMethods
          )
        ) as ReadonlyArray<BranchMergeMethod>)

  const mergeQueueParameterSummaries = mergeQueueRules.map(
    mergeQueueParametersSummary
  )
  const queueMethods = mergeQueueParameterSummaries.map(
    summary => summary.method
  )
  const mergeQueueSettingsComplete = mergeQueueParameterSummaries.every(
    summary => summary.complete
  )
  const knownQueueMethods = uniqueSorted(
    queueMethods.filter(
      (method): method is BranchMergeMethod => method !== undefined
    )
  ) as ReadonlyArray<BranchMergeMethod>
  const mergeQueueMethodComplete =
    mergeQueueRules.length === 0
      ? rulesComplete && classic?.protectionConfigured === false
      : rulesComplete &&
        classic?.protectionConfigured === false &&
        queueMethods.every(method => method !== undefined) &&
        knownQueueMethods.length === 1
  const mergeQueueMethod =
    mergeQueueMethodComplete && mergeQueueRules.length > 0
      ? knownQueueMethods[0] ?? null
      : null
  const mergeQueueMethodConflict =
    mergeQueueMethod !== null &&
    mergeMethodsComplete &&
    !allowedMergeMethods.includes(mergeQueueMethod)

  const pullRequestRouteRules = [
    ...pullRequestRules,
    ...mergeQueueRules,
    ...workflowRules,
  ]
  const classicPullRequestRoute = classicPullRequestRouteState(classic, input)
  const rulesetPullRequestRoute = operationForRestrictedRules(
    pullRequestRouteRules,
    rulesets,
    rulesComplete
  )
  const hasIndependentPullRequestRoutePolicy =
    classicPullRequestRoute !== null || pullRequestRouteRules.length > 0
  const independentPullRequestRoutePolicyState =
    hasIndependentPullRequestRoutePolicy
      ? mergeOperationStates([classicPullRequestRoute, rulesetPullRequestRoute])
      : null
  const updateRuleBypasses = updateRules.map(rule =>
    bypassState(rulesets.get(rule.ruleset_id))
  )
  const updatePullRequestRouteRequired =
    updateRuleBypasses.some(state => state === 'pull-request-only') &&
    !updateRuleBypasses.some(state => state === 'never')
  const pullRequestRoutePolicyState = updatePullRequestRouteRequired
    ? mergeOperationStates([independentPullRequestRoutePolicyState, 'blocked'])
    : independentPullRequestRoutePolicyState
  const directForcePushRouteState = mergeOperationStates([
    independentPullRequestRoutePolicyState,
    updateRuleBypasses.some(state => state === 'pull-request-only')
      ? 'blocked'
      : null,
  ])

  const routeBypassStates = pullRequestRouteRules.map(rule =>
    bypassState(rulesets.get(rule.ruleset_id))
  )
  const methodConstraintRules = [...pullRequestRules, ...linearRules]
  const methodConstraintBypasses = methodConstraintRules.map(rule =>
    bypassState(rulesets.get(rule.ruleset_id))
  )
  const accountMethodConstraintsComplete =
    input.repositoryHasPullRequests === true &&
    input.repositoryMergeMethods !== null &&
    rulesComplete &&
    routeBypassStates.every(state => state !== 'unknown') &&
    methodConstraintBypasses.every(state => state !== 'unknown') &&
    (classic?.requiredLinearHistory === true
      ? classicAdminBypass(classic, input) !== undefined
      : classic?.requiredLinearHistory !== undefined) &&
    pullRequestRules.every((rule, index) => {
      const bypass = routeBypassStates[index]
      return (
        bypass !== 'never' ||
        allowedMergeMethodsParameter(rule).kind !== 'invalid'
      )
    }) &&
    mergeQueueRules.every((rule, queueIndex) => {
      const bypass = routeBypassStates[pullRequestRules.length + queueIndex]
      return (
        bypass !== 'never' ||
        mergeQueueParametersSummary(rule).method !== undefined
      )
    })
  const accountEffectiveMergeMethods =
    !accountMethodConstraintsComplete || input.repositoryMergeMethods === null
      ? null
      : pullRequestRules.reduce<ReadonlyArray<BranchMergeMethod>>(
          (methods, rule, index) => {
            if (routeBypassStates[index] !== 'never') {
              return methods
            }
            const parameter = allowedMergeMethodsParameter(rule)
            return parameter.kind === 'available'
              ? methods.filter(method => parameter.values.includes(method))
              : methods
          },
          mergeQueueRules.reduce<ReadonlyArray<BranchMergeMethod>>(
            (methods, rule, queueIndex) => {
              const bypass =
                routeBypassStates[pullRequestRules.length + queueIndex]
              const method = mergeQueueParametersSummary(rule).method
              return bypass === 'never' && method !== undefined
                ? methods.filter(candidate => candidate === method)
                : methods
            },
            (classicAdminBypass(classic, input) === false &&
              classic?.requiredLinearHistory === true) ||
              linearRules.some((rule, index) => {
                const bypass =
                  methodConstraintBypasses[pullRequestRules.length + index]
                return bypass === 'never'
              })
              ? input.repositoryMergeMethods.filter(
                  method => method !== 'merge'
                )
              : input.repositoryMergeMethods
          )
        )
  const independentAccountPullRequestRouteRequired =
    classicPullRequestRoute === 'blocked' ||
    routeBypassStates.some(
      state => state === 'never' || state === 'pull-request-only'
    )
  const accountPullRequestRouteRequired =
    independentAccountPullRequestRouteRequired || updatePullRequestRouteRequired
  const accountEffectivePullRequestRouteUnavailable =
    accountPullRequestRouteRequired &&
    accountEffectiveMergeMethods !== null &&
    accountEffectiveMergeMethods.length === 0
  const independentAccountPullRequestRouteUnavailable =
    independentAccountPullRequestRouteRequired &&
    accountEffectiveMergeMethods !== null &&
    accountEffectiveMergeMethods.length === 0
  const independentPullRequestRouteContextState =
    independentPullRequestRoutePolicyState === null ||
    independentPullRequestRoutePolicyState === 'bypass'
      ? null
      : input.repositoryHasPullRequests === false
      ? independentPullRequestRoutePolicyState === 'blocked'
        ? 'blocked'
        : 'constrained'
      : independentAccountPullRequestRouteUnavailable
      ? 'blocked'
      : input.repositoryPullRequestCreationPolicy === 'collaborators_only' &&
        (input.repositoryPermission === 'read' ||
          input.repositoryPermission === null)
      ? 'constrained'
      : null
  const pullRequestRouteContextState =
    pullRequestRoutePolicyState === null ||
    pullRequestRoutePolicyState === 'bypass'
      ? null
      : input.repositoryHasPullRequests === false
      ? pullRequestRoutePolicyState === 'blocked'
        ? 'blocked'
        : 'constrained'
      : accountEffectivePullRequestRouteUnavailable
      ? 'blocked'
      : input.repositoryPullRequestCreationPolicy === 'collaborators_only' &&
        (input.repositoryPermission === 'read' ||
          input.repositoryPermission === null)
      ? 'constrained'
      : null

  const updateRuleState = operationForUpdateRules(
    updateRules,
    rulesets,
    rulesComplete
  )
  const classicActorPushAllowed =
    input.repositoryPermission === 'admin' ? true : classic?.pushAllowed
  const ruleAwarePush = mergeOperationEvidence(
    classicActorPushAllowed,
    updateRuleState,
    rulesComplete
  )

  const rulesetUpdateGateState = operationForUpdateGates(
    rules.filter(
      rule => rule.type !== RuleType.Update && isUpdateGatingRule(rule)
    ),
    rulesets,
    rulesComplete
  )
  const classicUpdateGateState = classicUpdateGateOperationState(classic, input)
  const classicLockState = classicLockOperationState(classic, input)
  const restrictedUpdateRules = updateRules.filter(rule => {
    const bypass = bypassState(rulesets.get(rule.ruleset_id))
    return bypass === 'never' || bypass === 'pull-request-only'
  })
  const rulesetForkSyncOnly =
    input.repositoryIsFork === true &&
    rulesComplete &&
    restrictedUpdateRules.length > 0 &&
    updateRules.every(rule => {
      const bypass = bypassState(rulesets.get(rule.ruleset_id))
      return bypass === 'always'
        ? true
        : (bypass === 'never' || bypass === 'pull-request-only') &&
            booleanParameter(rule, 'update_allows_fetch_and_merge') === true
    })
  const classicForkSyncOnly =
    input.repositoryIsFork === true &&
    classic?.locked === true &&
    classic.forkSyncingAllowed === true &&
    classicAdminBypass(classic, input) !== true
  const classicRequirementsUnknown =
    classic === undefined ||
    classic.protectionConfigured === undefined ||
    classic.protectionConfigured === true
  const hasUnknownUpdateGate =
    !rulesComplete ||
    (classicRequirementsUnknown && classicAdminBypass(classic, input) !== true)
  const ordinaryUpdate = failClosedForUnknownRuleSemantics(
    mergeOperationStates([
      ruleAwarePush,
      classicUpdateGateState,
      classicLockState,
      rulesetUpdateGateState,
      pullRequestRouteContextState,
      hasUnknownUpdateGate ? 'unknown' : null,
    ]),
    unknownRuleSemantics
  )
  const syncExceptionCoversRestrictedUpdate =
    (classicForkSyncOnly || rulesetForkSyncOnly) &&
    independentPullRequestRouteContextState !== 'blocked' &&
    (updateRuleState !== 'blocked' || rulesetForkSyncOnly) &&
    (classicLockState !== 'blocked' || classicForkSyncOnly)
  const syncIndependentState = mergeOperationStates([
    classicUpdateGateState,
    rulesetUpdateGateState,
    independentPullRequestRouteContextState,
    hasUnknownUpdateGate ? 'unknown' : null,
    unknownRuleSemantics ? 'unknown' : null,
  ])
  const syncExceptionCoversBlockedUpdate =
    syncExceptionCoversRestrictedUpdate && syncIndependentState !== 'blocked'
  const update =
    ordinaryUpdate === 'blocked' && syncExceptionCoversBlockedUpdate
      ? 'constrained'
      : ordinaryUpdate
  const deletionRuleState = operationForRestrictedRules(
    rulesOfType(rules, RuleType.Deletion),
    rulesets,
    rulesComplete
  )
  const mergedDeletionEvidence = mergeOperationEvidence(
    classic?.deletionsAllowed,
    deletionRuleState,
    rulesComplete
  )
  const ruleAwareDeletion = failClosedForUnknownRuleSemantics(
    mergedDeletionEvidence,
    unknownRuleSemantics
  )
  const forcePushRuleState = operationForRestrictedRules(
    rulesOfType(rules, RuleType.NonFastForward),
    rulesets,
    rulesComplete
  )
  const mergedForcePushEvidence = mergeOperationEvidence(
    classicForcePushAllowed(classic, input),
    forcePushRuleState,
    rulesComplete
  )
  const ruleAwareForcePush = mergeForcePushWithUpdate(
    failClosedForUnknownRuleSemantics(
      mergedForcePushEvidence,
      unknownRuleSemantics
    ),
    mergeOperationStates([ordinaryUpdate, directForcePushRouteState])
  )
  const pushPolicyState = failClosedForUnknownRuleSemantics(
    mergeOperationStates([ruleAwarePush, classicLockState]),
    unknownRuleSemantics
  )
  const push = applyRepositoryWriteContext(pushPolicyState, input)
  const permissionAwareUpdate = applyRepositoryWriteContext(update, input)
  const updateDetails =
    ordinaryUpdate === 'blocked' &&
    syncExceptionCoversBlockedUpdate &&
    permissionAwareUpdate === 'constrained' &&
    (syncIndependentState === 'allowed' || syncIndependentState === 'bypass')
      ? [
          'Only upstream fork sync through fetch-and-merge is explicitly allowed by these restrictions; ordinary direct updates remain restricted.',
        ]
      : []
  const operationDetails = [
    ...(input.repositoryArchived === true
      ? [
          'Pushes, direct updates, deletion, and force pushes are blocked because this repository is archived.',
        ]
      : []),
    ...(input.repositoryPermission === 'read'
      ? [
          'Pushes, direct updates, deletion, and force pushes are blocked because the selected GitHub account has read-only repository access.',
        ]
      : []),
    ...(input.defaultBranch === input.branch
      ? ["Deletion is blocked because this is GitHub's default branch."]
      : []),
  ].slice(0, MaximumDisplayedValues)
  const deletion = applyDefaultBranchDeletionContext(
    applyRepositoryWriteContext(
      mergeOperationStates([
        ruleAwareDeletion,
        classicDeletionLockState(classic),
      ]),
      input
    ),
    input
  )
  const forcePush = applyRepositoryWriteContext(ruleAwareForcePush, input)

  const allSources = buildSources(input, rules, rulesets)
  const sources = allSources.slice(0, MaximumDisplayedValues)
  const allUnknownRuleTypes = uniqueSorted(
    rules.flatMap(rule => {
      if (rule.parametersComplete === false) {
        return [`${rule.type}.parameters`]
      }
      if (!knownRuleTypes.has(rule.type)) {
        return [rule.type]
      }
      const handled = handledRuleParameters.get(rule.type) ?? new Set<string>()
      return Object.keys(rule.parameters ?? {})
        .filter(key => !handled.has(key))
        .map(key => `${rule.type}.${key}`)
    })
  )
  const unknownRuleTypes = allUnknownRuleTypes.slice(0, MaximumDisplayedValues)
  const warnings = new Array<string>(...(input.contextWarnings ?? []))
  if (input.classic.kind === 'unavailable') {
    warnings.push(`Classic protection: ${input.classic.message}`)
  } else if (input.classic.kind === 'unsupported') {
    warnings.push(input.classic.message)
  } else {
    warnings.push(...(input.classic.warnings ?? []))
  }
  if (input.rulesets.kind === 'unavailable') {
    warnings.push(`Rulesets: ${input.rulesets.message}`)
  } else if (input.rulesets.kind === 'unsupported') {
    warnings.push(input.rulesets.message)
  } else {
    warnings.push(...(input.rulesets.warnings ?? []))
  }
  if (checks.truncated) {
    warnings.push('Only the first 100 required checks are shown.')
  }
  if (deployments.truncated) {
    warnings.push(
      'Only the first 100 required deployment environments are shown.'
    )
  }
  if (!reviewDetailsComplete && pullRequest.state === 'required') {
    warnings.push('Some pull-request review options were not returned.')
  }
  if (reviewDetailsTruncated) {
    warnings.push('Only the first 100 pull-request review details are shown.')
  }
  if (reviews.state === 'required' && !reviews.countComplete) {
    warnings.push('The displayed approval count is a known minimum.')
  }
  if (checks.state === 'required' && !checks.valuesComplete) {
    warnings.push('Additional required check names may apply.')
  }
  if (deployments.state === 'required' && !deployments.valuesComplete) {
    warnings.push('Additional required deployment environments may apply.')
  }
  if (
    classic?.protectionConfigured === true &&
    (deploymentRules.length === 0 || mergeQueueRules.length === 0)
  ) {
    warnings.push(
      'Classic protection REST responses do not expose required deployments or merge-queue settings; absent ruleset answers remain unknown.'
    )
  }
  if (accountEffectivePullRequestRouteUnavailable && update === 'blocked') {
    warnings.push(
      'No standard merge method satisfies every active non-bypassed policy, so no standard pull-request update route is available.'
    )
  }
  if (pullRequest.state === 'required' && !mergeMethodsComplete) {
    warnings.push(
      'Pull-request merge methods could not be determined completely.'
    )
  }
  if (
    pullRequestRouteContextState === 'blocked' &&
    input.repositoryHasPullRequests === false &&
    update === 'blocked'
  ) {
    warnings.push(
      'Pull requests are disabled for this repository, but an active non-bypassed policy requires a pull-request route.'
    )
  }
  if (
    pullRequestRoutePolicyState !== null &&
    pullRequestRoutePolicyState !== 'bypass' &&
    input.repositoryPullRequestCreationPolicy === 'collaborators_only' &&
    (input.repositoryPermission === 'read' ||
      input.repositoryPermission === null)
  ) {
    warnings.push(
      'Pull-request creation is limited to collaborators; this account’s collaborator status could not be verified.'
    )
  }
  if (
    input.repositoryIsFork === null &&
    (classic?.forkSyncingAllowed === true ||
      updateRules.some(
        rule => booleanParameter(rule, 'update_allows_fetch_and_merge') === true
      ))
  ) {
    warnings.push(
      'Fork identity could not be verified, so upstream sync exceptions are not claimed.'
    )
  }
  if (
    pullRequest.state === 'required' &&
    mergeMethodsComplete &&
    allowedMergeMethods.length === 0 &&
    !accountEffectivePullRequestRouteUnavailable
  ) {
    warnings.push(
      'No standard pull-request merge method satisfies every active policy; this list does not account for an account-specific bypass.'
    )
  }
  if (mergeQueue.state === 'required' && !mergeQueueMethodComplete) {
    warnings.push('The required merge-queue method could not be determined.')
  }
  if (!mergeQueueSettingsComplete) {
    warnings.push('Some merge-queue settings were not returned completely.')
  }
  if (mergeQueueMethodConflict) {
    warnings.push(
      'The required merge-queue method conflicts with the effective pull-request merge methods; no standard queued merge path is satisfiable.'
    )
  }
  if (
    allSources.some(
      source => source.kind === 'ruleset' && source.bypass === 'unknown'
    )
  ) {
    warnings.push(
      'Bypass permission could not be determined for every ruleset.'
    )
  }
  if (allSources.length > MaximumDisplayedValues) {
    warnings.push('Only the first 100 active rule sources are shown.')
  }
  if (allUnknownRuleTypes.length > MaximumDisplayedValues) {
    warnings.push(
      'Only the first 100 additional active rule details are shown.'
    )
  }
  if (
    classic?.protectionConfigured === true &&
    classic.forcePushesAllowed === true &&
    input.repositoryPermission !== 'read' &&
    (input.repositoryPermission === 'admin' || classic.pushAllowed !== false)
  ) {
    warnings.push(
      'Classic protection enables force pushes, but GitHub did not return whether this account is in the allowed force-push actor scope.'
    )
  }
  if (input.repositoryDisabled === true) {
    warnings.push(
      'GitHub reports this repository as disabled; runtime write availability could not be verified.'
    )
  } else if (input.repositoryDisabled === null) {
    warnings.push('The repository disabled state could not be verified.')
  }
  if (input.repositoryPermission === null) {
    warnings.push(
      'The selected GitHub account’s repository permission could not be verified.'
    )
  }
  if (input.repositoryArchived === null) {
    warnings.push('The repository archive state could not be verified.')
  }
  if (input.defaultBranch === null) {
    warnings.push(
      'GitHub’s default branch could not be verified, so deletion availability remains unknown.'
    )
  }

  const requirements = [
    pullRequest,
    reviews,
    checks,
    signatures,
    linearHistory,
    deployments,
    mergeQueue,
    conversationResolution,
  ]
  const empty =
    rules.length === 0 &&
    classic?.protectionConfigured === false &&
    requirements.every(requirement => requirement.state === 'not-required') &&
    [push, permissionAwareUpdate, deletion, forcePush].every(
      state => state === 'allowed'
    )

  return {
    branch: input.branch,
    fetchedAt: input.fetchedAt ?? Date.now(),
    pullRequest,
    reviews,
    reviewDetails: displayedReviewDetails,
    reviewDetailsComplete,
    checks,
    checksMustUseLatestBranch,
    signatures,
    linearHistory,
    deployments,
    mergeQueue,
    mergeQueueMethod,
    mergeQueueMethodComplete,
    conversationResolution,
    allowedMergeMethods,
    push,
    update: permissionAwareUpdate,
    updateDetails,
    operationDetails,
    deletion,
    forcePush,
    sources,
    unknownRuleTypes,
    warnings: uniqueSorted(warnings),
    empty,
  }
}
