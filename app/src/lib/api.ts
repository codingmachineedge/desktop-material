import * as URL from 'url'
import { Account, AccountProvider } from '../models/account'
import {
  ICopilotCommitMessage,
  parseCopilotCommitMessage,
} from './copilot-commit-message'

import {
  request,
  parsedResponse,
  HTTPMethod,
  APIError,
  urlWithQueryString,
  getUserAgent,
} from './http'
import { GitProtocol } from './remote-parsing'
import {
  getEndpointVersion,
  isDotCom,
  isGHE,
  isGHES,
  updateEndpointVersion,
} from './endpoint-capabilities'
import {
  clearCertificateErrorSuppressionFor,
  suppressCertificateErrorFor,
} from './suppress-certificate-error'
import { HttpStatusCode } from './http-status-code'
import { CopilotError, parseCopilotPaymentRequiredError } from './copilot-error'
import { BypassReasonType } from '../ui/secret-scanning/bypass-push-protection-dialog'
import {
  IAPICreatedGitHubIssue,
  ICreatedGitHubIssue,
  normalizeGitHubIssueDraft,
  validateCreatedGitHubIssue,
  validateGitHubRepositoryPart,
} from './github-issue'
import { boundedGitHubIssueResponse } from './github-issue-json'
import {
  GitHubIssueCommentMaximumPages,
  GitHubIssueCommentPageSize,
  GitHubIssueMetadataMaximumPages,
  GitHubIssueMetadataPageSize,
  GitHubIssuePageSize,
  GitHubIssueState,
  IGitHubIssue,
  IGitHubIssueComment,
  IGitHubIssueCommentList,
  IGitHubIssueList,
  IGitHubIssueMetadata,
  IGitHubIssueQuery,
  IGitHubIssueUpdate,
  normalizeGitHubIssueComment,
  normalizeGitHubIssueQuery,
  normalizeGitHubIssueUpdate,
  parseGitHubIssue,
  parseGitHubIssueAssigneePage,
  parseGitHubIssueComment,
  parseGitHubIssueCommentList,
  parseGitHubIssueLabelPage,
  parseGitHubIssueList,
  parseGitHubIssueMilestonePage,
  validateGitHubIssueNumber,
  validateGitHubIssueRepositoryPart,
} from './github-issues'
import {
  IAPICreatedGitHubPullRequest,
  ICreatedGitHubPullRequest,
  EmptyGitHubPullRequestMetadata,
  GitHubPullRequestContextChangedError,
  IAPIGitHubPullRequestLifecycle,
  IGitHubPullRequestLifecycle,
  IGitHubPullRequestMergeReceipt,
  IGitHubPullRequestMetadata,
  IGitHubPullRequestMutationReceipt,
  IGitHubPullRequestReview,
  IGitHubPullRequestReviewReceipt,
  IGitHubPullRequestUpdate,
  IGitHubPullRequestHeadRepository,
  GitHubPullRequestMergeMethod,
  normalizeGitHubPullRequestDraft,
  normalizeGitHubPullRequestMetadata,
  normalizeGitHubPullRequestReview,
  normalizeGitHubPullRequestUpdate,
  validateCreatedGitHubPullRequest,
  validateGitHubPullRequestHeadSHA,
  validateGitHubPullRequestLifecycle,
  validateGitHubPullRequestMergeReceipt,
  validateGitHubPullRequestNumber,
  validateGitHubPullRequestReviewReceipt,
} from './github-pull-request'
import { boundedGitHubPullRequestResponse } from './github-pull-request-json'
import {
  ActionsArtifactPageSize,
  IActionsArtifactList,
  isSupportedActionsArtifactDigest,
  parseActionsArtifactAttestationPresence,
  parseActionsArtifactList,
  validateActionsArtifactIdentifier,
  validateActionsArtifactPage,
} from './actions-artifacts'
import {
  fetchActionsArtifactRedirect,
  IActionsArtifactRedirectDependencies,
} from './actions-artifact-redirect'
import {
  ActionsArtifactJSONError,
  parseBoundedActionsArtifactAPIError,
  readBoundedActionsArtifactJSON,
} from './actions-artifact-json'
import {
  ActionsArtifactAttestationMaximumBytes,
  ActionsArtifactAttestationProbePageSize,
  ActionsArtifactProvenancePredicate,
  IActionsArtifactAttestationBundleSet,
  normalizeActionsArtifactGitObjectId,
  parseActionsArtifactAttestationBundles,
} from './actions-artifact-provenance'
import {
  ActionsArtifactProvenanceRefNamespace,
  IActionsArtifactProvenanceAnnotatedTag,
  IActionsArtifactProvenanceGitRef,
  IActionsArtifactProvenanceRepositoryMetadata,
  IActionsArtifactProvenanceRunAttemptMetadata,
  normalizeActionsArtifactSourceRefName,
  parseActionsArtifactProvenanceAnnotatedTag,
  parseActionsArtifactProvenanceGitRef,
  parseActionsArtifactProvenanceRepositoryMetadata,
  parseActionsArtifactProvenanceRunAttemptMetadata,
  resolveActionsArtifactProvenanceSourceRef,
} from './actions-artifact-provenance-metadata'
import {
  ActionsBranchRuleMaximumPages,
  ActionsBranchRulePageSize,
  IActionsBranchRuleList,
  parseActionsBranchRulePage,
  validateActionsBranchName,
} from './actions-branch-rules'
import {
  ActionsCachePageSize,
  IActionsCacheList,
  IActionsCacheUsage,
  parseActionsCacheList,
  parseActionsCacheUsage,
} from './actions-caches'
import { boundedGitHubReleaseResponse } from './github-release-json'
import {
  IAPIProviderTriagePage,
  normalizeProviderTriageLimit,
  validateProviderTriageCoordinate,
} from './provider-triage'
import {
  boundedProviderTriageResponse,
  parseBitbucketTriagePullRequests,
  parseGitHubTriageIssues,
  parseGitHubTriagePullRequests,
  parseGitLabTriageIssues,
  parseGitLabTriagePullRequests,
} from './provider-triage-json'
import {
  GitHubReleaseAssetMaximumPages,
  GitHubReleaseAssetPageSize,
  GitHubReleaseMaximumPages,
  GitHubReleasePageSize,
  IGitHubRelease,
  IGitHubReleaseAsset,
  IGitHubReleaseAssetList,
  IGitHubReleaseDraft,
  IGitHubReleaseList,
  IGitHubReleaseUpdate,
  normalizeGitHubReleaseDraft,
  normalizeGitHubReleaseUpdate,
  parseGitHubRelease,
  parseGitHubReleaseAsset,
  parseGitHubReleaseAssetList,
  parseGitHubReleaseList,
  validateGitHubReleaseIdentifier,
  validateGitHubReleaseRepositoryPart,
  validateGitHubReleaseTag,
} from './github-releases'
import {
  ActionsJobPageSize,
  IActionsJobList,
  parseActionsJobList,
  validateActionsJobAttempt,
  validateActionsJobIdentifier,
  validateActionsJobPage,
} from './actions-jobs'
import {
  ActionsWorkflowRunConclusion,
  ActionsWorkflowRunStatus,
  IActionsWorkflowRunCancellationState,
  parseActionsWorkflowRunCancellationState,
} from './actions-workflow-runs'
import {
  ActionsRunReviewState,
  createActionsRunReviewRequest,
  IActionsPendingDeployment,
  IActionsRunReviewHistory,
  parseActionsPendingDeployments,
  parseActionsRunReviewHistory,
} from './actions-run-reviews'
import {
  ActionsMetadataJSONError,
  parseBoundedActionsAPIError,
  readBoundedActionsJSON,
} from './actions-response'
import { createGitHubAPIRequestHeaders } from './github-rest-api-version'
import { GitHubOAuthScopes } from './github-oauth-scopes'
import {
  GitHubAPIWorkbenchRequest,
  IGitHubAPIWorkbenchResponse,
  prepareGitHubAPIWorkbenchExecution,
  readGitHubAPIWorkbenchResponse,
} from './github-api-workbench'
export {
  createGitHubAPIRequestHeaders,
  getGitHubRESTAPIVersion,
  GitHubDotComRESTAPIVersion,
  GitHubRESTAPIVersionHeader,
} from './github-rest-api-version'

const envEndpoint = process.env['DESKTOP_GITHUB_DOTCOM_API_ENDPOINT']
const envHTMLURL = process.env['DESKTOP_GITHUB_DOTCOM_HTML_URL']
const envAdditionalCookies =
  process.env['DESKTOP_GITHUB_DOTCOM_ADDITIONAL_COOKIES']

if (envAdditionalCookies !== undefined) {
  document.cookie += '; ' + envAdditionalCookies
}

type AffiliationFilter =
  | 'owner'
  | 'collaborator'
  | 'organization_member'
  | 'owner,collabor'
  | 'owner,organization_member'
  | 'collaborator,organization_member'
  | 'owner,collaborator,organization_member'

/** Response type of GraphQL query of Copilot-related info */
type ViewerCopilotResponse = {
  readonly data: {
    readonly viewer: {
      readonly copilotEndpoints: {
        readonly api: string
      }
      readonly copilotLicenseType: string
      readonly isCopilotDesktopEnabled: boolean
    }
  }
}

/** Copilot-related info relevant to Desktop */
type UserCopilotInfo = {
  readonly isCopilotDesktopEnabled: boolean
  readonly copilotEndpoint: string
  readonly copilotLicenseType: string
}

/** Response type Copilot chat completions response API */
type CopilotChatCompletionResponse = {
  readonly choices: ReadonlyArray<{
    readonly index: number
    readonly message: {
      readonly content: string
    }
  }>
}

/**
 * Optional set of configurable settings for the fetchAll method
 */
interface IFetchAllOptions<T> {
  /**
   * The number of results to ask for on each page when making
   * requests to paged API endpoints.
   */
  perPage?: number

  /**
   * An optional predicate which determines whether or not to
   * continue loading results from the API. This can be used
   * to put a limit on the number of results to return from
   * a paged API resource.
   *
   * As an example, to stop loading results after 500 results:
   *
   * `(results) => results.length < 500`
   *
   * @param results  All results retrieved thus far
   */
  continue?: (results: ReadonlyArray<T>) => boolean | Promise<boolean>

  /**
   * An optional callback which is invoked after each page of results is loaded
   * from the API. This can be used to enable streaming of results.
   *
   * @param page The last fetched page of results
   */
  onPage?: (page: ReadonlyArray<T>) => void

  /** Invoked for every HTTP response, before its payload is interpreted. */
  onResponse?: (response: Response) => void

  /**
   * Calculate the next page path given the response.
   *
   * Optional, see `getNextPagePathFromLink` for the default
   * implementation.
   */
  getNextPagePath?: (response: Response) => string | null

  /**
   * Whether or not to silently suppress request errors and
   * return the results retrieved thus far. If this field is
   * `true` the fetchAll method will suppress errors (this is
   * also the default behavior if no value is provided for
   * this field). Setting this field to false will cause the
   * fetchAll method to throw if it encounters an API error
   * on any page.
   */
  suppressErrors?: boolean

  /** Reject a successful response unless its JSON payload is an array. */
  requireArrayPage?: boolean

  /** Cancels every page request in this pagination sequence. */
  signal?: AbortSignal

  /** Bypass the HTTP cache for every page in this pagination sequence. */
  reloadCache?: boolean
}

const ClientID = process.env.TEST_ENV ? '' : __OAUTH_CLIENT_ID__
const ClientSecret = process.env.TEST_ENV ? '' : __OAUTH_SECRET__

if (!ClientID || !ClientID.length || !ClientSecret || !ClientSecret.length) {
  log.warn(
    `DESKTOP_OAUTH_CLIENT_ID and/or DESKTOP_OAUTH_CLIENT_SECRET is undefined. You won't be able to authenticate new users.`
  )
}

export type GitHubAccountType = 'User' | 'Organization'

/**
 * Bound the effective-rules response even if a server supplies an unending
 * pagination chain. Reaching this limit is reported as incomplete rather than
 * silently treating the partial result as authoritative.
 */
const MaximumEffectiveBranchRules = 1000
const MaximumEffectiveBranchRulePages = 20

/**
 * Information about a repository as returned by the GitHub API.
 */
export interface IAPIRepository {
  readonly clone_url: string
  readonly ssh_url: string
  readonly html_url: string
  readonly name: string
  readonly owner: IAPIIdentity
  readonly private: boolean
  readonly fork: boolean
  readonly default_branch: string
  readonly pushed_at: string
  readonly has_issues: boolean
  readonly archived: boolean
}

/** Information needed to clone a repository. */
export interface IAPIRepositoryCloneInfo {
  /** Canonical clone URL of the repository. */
  readonly url: string

  /** Stable signed-in account identity that resolved this repository. */
  readonly accountKey?: string

  /**
   * Default branch of the repository, if any. This is usually either retrieved
   * from the API for GitHub repositories, or undefined for other repositories.
   */
  readonly defaultBranch?: string
}

export interface IAPIFullRepository extends IAPIRepository {
  /**
   * The parent repository of a fork.
   *
   * HACK: BEWARE: This is defined as `parent: IAPIRepository | undefined`
   * rather than `parent?: ...` even though the parent property is actually
   * optional in the API response. So we're lying a bit to the type system
   * here saying that this will be present but the only time the difference
   * between omission and explicit undefined matters is when using constructs
   * like `x in y` or `y.hasOwnProperty('x')` which we do very rarely.
   *
   * Without at least one non-optional type in this interface TypeScript will
   * happily let us pass an IAPIRepository in place of an IAPIFullRepository.
   */
  readonly parent: IAPIRepository | undefined

  /**
   * The high-level permissions that the currently authenticated
   * user enjoys for the repository. Undefined if the API call
   * was made without an authenticated user or if the repository
   * isn't the primarily requested one (i.e. if this is the parent
   * repository of the requested repository)
   *
   * The permissions hash will also be omitted when the repository
   * information is embedded within another object such as a pull
   * request (base.repo or head.repo).
   *
   * In other words, the only time when the permissions property
   * will be present is when explicitly fetching the repository
   * through the `/repos/user/name` endpoint or similar.
   */
  readonly permissions?: IAPIRepositoryPermissions
}

/*
 * Information about how the user is permitted to interact with a repository.
 */
export interface IAPIRepositoryPermissions {
  readonly admin: boolean
  /* aka 'write' */
  readonly push: boolean
  /* aka 'read' */
  readonly pull: boolean
}

/**
 * Information about a commit as returned by the GitHub API.
 */
export interface IAPICommit {
  readonly sha: string
  readonly author: IAPIIdentity | {} | null
}

/**
 * Entity returned by the `/user/orgs` endpoint.
 *
 * Because this is specific to one endpoint it omits the `type` member from
 * `IAPIIdentity` that callers might expect.
 */
export interface IAPIOrganization {
  readonly id: number
  readonly url: string
  readonly login: string
  readonly avatar_url: string
}

/**
 * Minimum subset of an identity returned by the GitHub API
 */
export interface IAPIIdentity {
  readonly id: number
  readonly login: string
  readonly avatar_url: string
  readonly html_url: string
  readonly type: GitHubAccountType
}

/**
 * Complete identity details returned in some situations by the GitHub API.
 *
 * If you are not sure what is returned as part of an API response, you should
 * use `IAPIIdentity` as that contains the known subset of an identity and does
 * not cover scenarios where privacy settings of a user control what information
 * is returned.
 */
export interface IAPIFullIdentity {
  readonly id: number
  readonly html_url: string
  readonly login: string
  readonly avatar_url: string

  /**
   * The user's real name or null if the user hasn't provided
   * a real name for their public profile.
   */
  readonly name: string | null

  /**
   * The email address for this user or null if the user has not
   * specified a public email address in their profile.
   */
  readonly email: string | null
  readonly type: GitHubAccountType
  readonly plan?: {
    readonly name: string
  }
}

/** The users we get from the mentionables endpoint. */
export interface IAPIMentionableUser {
  /**
   * A url to an avatar image chosen by the user
   */
  readonly avatar_url: string

  /**
   * The user's attributable email address or null if the
   * user doesn't have an email address that they can be
   * attributed by
   */
  readonly email: string | null

  /**
   * The username or "handle" of the user
   */
  readonly login: string

  /**
   * The user's real name (or at least the name that the user
   * has configured to be shown) or null if the user hasn't provided
   * a real name for their public profile.
   */
  readonly name: string | null
}

/** The response we get from the desktop_internal/features endpoint. */
interface IUserFeaturesResponse {
  readonly features: ReadonlyArray<string>
}

/**
 * Error thrown by `fetchUpdatedPullRequests` when receiving more results than
 * what the `maxResults` parameter allows for.
 */
export class MaxResultsError extends Error {}

/**
 * `null` can be returned by the API for legacy reasons. A non-null value is
 * set for the primary email address currently, but in the future visibility
 * may be defined for each email address.
 */
export type EmailVisibility = 'public' | 'private' | null

/**
 * Information about a user's email as returned by the GitHub API.
 */
export interface IAPIEmail {
  readonly email: string
  readonly verified: boolean
  readonly primary: boolean
  readonly visibility: EmailVisibility
}

/** A notification subject returned by the authenticated-user inbox API. */
export interface IAPINotificationSubject {
  readonly title: string
  readonly url: string | null
  readonly latest_comment_url: string | null
  readonly type: string
}

/** Repository metadata embedded in a GitHub notification thread. */
export interface IAPINotificationRepository {
  readonly id: number
  readonly name: string
  readonly full_name: string
  readonly private: boolean
  readonly owner: IAPIIdentity
  readonly html_url: string
}

/** A thread returned by `GET /notifications`. */
export interface IAPINotificationThread {
  readonly id: string
  readonly repository: IAPINotificationRepository
  readonly subject: IAPINotificationSubject
  readonly reason: string
  readonly unread: boolean
  readonly updated_at: string
  readonly last_read_at: string | null
  readonly url: string
  readonly subscription_url: string
}

export interface IAPINotificationsOptions {
  readonly includeRead: boolean
  readonly participating: boolean
  readonly page: number
  readonly perPage?: number
  readonly lastModified?: string | null
  readonly signal?: AbortSignal
}

/** One bounded page of authenticated-user notification threads. */
export interface IAPINotificationsPage {
  readonly notifications: ReadonlyArray<IAPINotificationThread>
  readonly hasNextPage: boolean
  readonly notModified: boolean
  readonly lastModified: string | null
  readonly pollIntervalSeconds: number | null
}

/** Information about an issue as returned by the GitHub API. */
export interface IAPIIssue {
  readonly number: number
  readonly title: string
  readonly state: 'open' | 'closed'
  readonly updated_at: string
}

/** The combined state of a ref. */
export type APIRefState = 'failure' | 'pending' | 'success' | 'error'

/** The overall status of a check run */
export enum APICheckStatus {
  Queued = 'queued',
  InProgress = 'in_progress',
  Completed = 'completed',
}

/** The conclusion of a completed check run */
export enum APICheckConclusion {
  ActionRequired = 'action_required',
  Canceled = 'cancelled',
  TimedOut = 'timed_out',
  Failure = 'failure',
  Neutral = 'neutral',
  Success = 'success',
  Skipped = 'skipped',
  Stale = 'stale',
}

/**
 * The API response for a combined view of a commit
 * status for a given ref
 */
export interface IAPIRefStatusItem {
  readonly state: APIRefState
  readonly target_url: string | null
  readonly description: string
  readonly context: string
  readonly id: number
}

/** The API response to a ref status request. */
export interface IAPIRefStatus {
  readonly state: APIRefState
  readonly total_count: number
  readonly statuses: ReadonlyArray<IAPIRefStatusItem>
}

export interface IAPIRefCheckRun {
  readonly id: number
  readonly url: string
  readonly status: APICheckStatus
  readonly conclusion: APICheckConclusion | null
  readonly name: string
  readonly check_suite: IAPIRefCheckRunCheckSuite
  readonly app: IAPIRefCheckRunApp
  readonly completed_at: string
  readonly started_at: string
  readonly html_url: string
  readonly pull_requests: ReadonlyArray<IAPIPullRequest>
}

// NB. Only partially mapped
export interface IAPIRefCheckRunApp {
  readonly name: string
}

// NB. Only partially mapped
export interface IAPIRefCheckRunOutput {
  readonly title: string | null
  readonly summary: string | null
  readonly text: string | null
}

export interface IAPIRefCheckRunCheckSuite {
  readonly id: number
}

export interface IAPICheckSuite {
  readonly id: number
  readonly rerequestable: boolean
  readonly runs_rerequestable: boolean
  readonly status: APICheckStatus
  readonly created_at: string
}

export interface IAPIRefCheckRuns {
  readonly total_count: number
  readonly check_runs: IAPIRefCheckRun[]
}

export interface IAPIWorkflowRuns {
  readonly total_count: number
  readonly workflow_runs: ReadonlyArray<IAPIWorkflowRun>
}

export interface IAPIWorkflow {
  readonly id: number
  readonly name: string
  readonly path: string
  readonly state:
    | 'active'
    | 'deleted'
    | 'disabled_fork'
    | 'disabled_inactivity'
    | 'disabled_manually'
  readonly html_url: string
  readonly created_at: string
  readonly updated_at: string
}

export interface IAPIWorkflows {
  readonly total_count: number
  readonly workflows: ReadonlyArray<IAPIWorkflow>
}

export interface IAPIWorkflowRunsFilter {
  readonly workflowId?: number
  readonly branch?: string
  readonly event?: string
  readonly status?: string
  readonly perPage?: number
  readonly page?: number
}

/** GitHub's bounded page size used by the interactive Actions run browser. */
export const ActionsWorkflowRunPageSize = 50

// NB. Only partially mapped
export interface IAPIWorkflowRun {
  readonly id: number
  /**
   * The workflow_id is the id of the workflow not the individual run.
   **/
  readonly workflow_id: number
  readonly cancel_url: string
  readonly created_at: string
  readonly logs_url: string
  readonly name: string
  readonly rerun_url: string
  readonly check_suite_id: number
  readonly event: string
  readonly display_title?: string
  readonly run_number?: number
  readonly run_attempt?: number
  readonly head_branch?: string | null
  readonly head_sha?: string
  readonly status?: ActionsWorkflowRunStatus
  readonly conclusion?: ActionsWorkflowRunConclusion | null
  readonly updated_at?: string
  readonly html_url?: string
  readonly actor?: IAPIIdentity
  /** Workflow file reported by the Actions run API. */
  readonly path?: string
  /** Exact reusable-workflow metadata reported by the Actions run API. */
  readonly referenced_workflows?: ReadonlyArray<IAPIReferencedWorkflow>
}

export interface IAPIReferencedWorkflow {
  readonly path?: string | null
  /** Optional in provider payloads; never synthesize it from `head_branch`. */
  readonly ref?: string | null
  readonly sha?: string | null
}

export interface IAPIWorkflowJobs {
  readonly total_count: number
  readonly jobs: IAPIWorkflowJob[]
}

// NB. Only partially mapped
export interface IAPIWorkflowJob {
  readonly id: number
  readonly name: string
  readonly status: APICheckStatus
  readonly conclusion: APICheckConclusion | null
  readonly completed_at: string
  readonly started_at: string
  readonly steps: ReadonlyArray<IAPIWorkflowJobStep>
  readonly html_url: string
}

export interface IAPIWorkflowJobStep {
  readonly name: string
  readonly number: number
  readonly status: APICheckStatus
  readonly conclusion: APICheckConclusion | null
  readonly completed_at: string
  readonly started_at: string
  readonly log: string
}

/** Protected branch information returned by the GitHub API */
export interface IAPIPushControl {
  /**
   * What status checks are required before merging?
   *
   * Empty array if user is admin and branch is not admin-enforced
   */
  required_status_checks: Array<string>

  /**
   * How many reviews are required before merging?
   *
   * 0 if user is admin and branch is not admin-enforced
   */
  required_approving_review_count: number

  /**
   * Is user permitted?
   *
   * Always `true` for admins.
   * `true` if `Restrict who can push` is not enabled.
   * `true` if `Restrict who can push` is enabled and user is in list.
   * `false` if `Restrict who can push` is enabled and user is not in list.
   */
  allow_actor: boolean

  /**
   * Currently unused properties
   */
  pattern: string | null
  required_signatures: boolean
  required_linear_history: boolean
  allow_deletions: boolean
  allow_force_pushes: boolean
}

export interface IBranchRulesAPIRequestOptions {
  readonly signal?: AbortSignal
  /** Reject instead of returning the legacy permissive fallback. */
  readonly strict?: boolean
  /** Bypass the HTTP cache for an explicit user refresh. */
  readonly reloadCache?: boolean
}

export interface IStrictBranchRulesAPIRequestOptions
  extends IBranchRulesAPIRequestOptions {
  readonly strict: true
}

/** Detailed classic branch-protection payload, validated by its consumer. */
export interface IAPIBranchProtection {
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
  readonly required_signatures?: { readonly enabled?: unknown } | null
  readonly required_linear_history?: { readonly enabled?: unknown } | null
  readonly allow_force_pushes?: { readonly enabled?: unknown } | null
  readonly allow_deletions?: { readonly enabled?: unknown } | null
  readonly required_conversation_resolution?: {
    readonly enabled?: unknown
  } | null
  readonly lock_branch?: { readonly enabled?: unknown } | null
  readonly allow_fork_syncing?: { readonly enabled?: unknown } | null
  readonly enforce_admins?: { readonly enabled?: unknown } | null
}

/** Branch information returned by the GitHub API */
export interface IAPIBranch {
  /**
   * The name of the branch stored on the remote.
   *
   * NOTE: this is NOT a fully-qualified ref (i.e. `refs/heads/main`)
   */
  readonly name: string
  /**
   * Branch protection settings:
   *
   *  - `true` indicates that the branch is protected in some way
   *  - `false` indicates no branch protection set
   */
  readonly protected: boolean
}

/** Repository rule information returned by the GitHub API */
export interface IAPIRepoRule {
  /**
   * The ID of the ruleset this rule is configured in.
   */
  readonly ruleset_id: number

  /**
   * The type of the rule.
   */
  readonly type: APIRepoRuleType

  readonly ruleset_source_type?: string
  readonly ruleset_source?: string

  /**
   * Rule-specific parameters. Consumers must narrow and validate the shape
   * appropriate for `type` before reading it.
   */
  readonly parameters?: Readonly<Record<string, unknown>>
}

/**
 * A non-exhaustive list of rules that can be configured. Only the rule
 * types used by this app are included.
 */
export enum APIRepoRuleType {
  Creation = 'creation',
  Update = 'update',
  Deletion = 'deletion',
  RequiredDeployments = 'required_deployments',
  RequiredLinearHistory = 'required_linear_history',
  RequiredSignatures = 'required_signatures',
  RequiredStatusChecks = 'required_status_checks',
  PullRequest = 'pull_request',
  MergeQueue = 'merge_queue',
  NonFastForward = 'non_fast_forward',
  CommitMessagePattern = 'commit_message_pattern',
  CommitAuthorEmailPattern = 'commit_author_email_pattern',
  CommitterEmailPattern = 'committer_email_pattern',
  BranchNamePattern = 'branch_name_pattern',
}

/**
 * A ruleset returned from the GitHub API's "get all rulesets for a repo" endpoint.
 * This endpoint returns a slimmed-down version of the full ruleset object, though
 * only the ID is used.
 */
export interface IAPISlimRepoRuleset {
  readonly id: number
}

/**
 * A ruleset returned from the GitHub API's "get a ruleset for a repo" endpoint.
 */
export interface IAPIRepoRuleset extends IAPISlimRepoRuleset {
  /**
   * Whether the user making the API request can bypass the ruleset.
   */
  readonly current_user_can_bypass?:
    | 'always'
    | 'exempt'
    | 'pull_requests_only'
    | 'pull_request'
    | 'never'
  readonly name?: string
  readonly source_type?: string
  readonly source?: string
  readonly _links?: {
    readonly html?: { readonly href?: string }
  }
}

export interface IAPIRepoRulesForBranchResult {
  readonly rules: ReadonlyArray<IAPIRepoRule>
  /** False when a safety cap or malformed pagination boundary was reached. */
  readonly complete: boolean
}

/**
 * Metadata parameters for a repo rule metadata rule.
 */
export interface IAPIRepoRuleMetadataParameters {
  /**
   * User-supplied name/description of the rule
   */
  name: string

  /**
   * Whether the operator is negated. For example, if `true`
   * and `operator` is `starts_with`, then the rule
   * will be negated to 'does not start with'.
   */
  negate: boolean

  /**
   * The pattern to match against. If the operator is 'regex', then
   * this is a regex string match. Otherwise, it is a raw string match
   * of the type specified by `operator` with no additional parsing.
   */
  pattern: string

  /**
   * The type of match to use for the pattern. For example, `starts_with`
   * means `pattern` must be at the start of the string.
   */
  operator: APIRepoRuleMetadataOperator
}

export enum APIRepoRuleMetadataOperator {
  StartsWith = 'starts_with',
  EndsWith = 'ends_with',
  Contains = 'contains',
  RegexMatch = 'regex',
}

interface IAPIPullRequestRef {
  readonly ref: string
  readonly sha: string

  /**
   * The repository in which this ref lives. It could be null if the repository
   * has been deleted since the PR was opened.
   */
  readonly repo: IAPIRepository | null
}

/** Information about a pull request as returned by the GitHub API. */
export interface IAPIPullRequest {
  readonly number: number
  readonly title: string
  readonly created_at: string
  readonly updated_at: string
  readonly user: IAPIIdentity
  readonly head: IAPIPullRequestRef
  readonly base: IAPIPullRequestRef
  readonly body: string
  readonly state: 'open' | 'closed'
  readonly draft?: boolean
}

/** Information about a pull request review as returned by the GitHub API. */
export interface IAPIPullRequestReview {
  readonly id: number
  readonly user: IAPIIdentity
  readonly body: string
  readonly html_url: string
  readonly submitted_at: string
  readonly state:
    | 'APPROVED'
    | 'DISMISSED'
    | 'PENDING'
    | 'COMMENTED'
    | 'CHANGES_REQUESTED'
}

/** Represents both issue comments and PR review comments */
export interface IAPIComment {
  readonly id: number
  readonly body: string
  readonly html_url: string
  readonly user: IAPIIdentity
  readonly created_at: string
}

/** The server response when handling the OAuth callback (with code) to obtain an access token */
interface IAPIAccessToken {
  readonly access_token: string
  readonly scope: string
  readonly token_type: string
}

/** The response we receive from fetching mentionables. */
interface IAPIMentionablesResponse {
  readonly etag: string | undefined
  readonly users: ReadonlyArray<IAPIMentionableUser>
}

/**
 * Parses the Link header from GitHub and returns the 'next' path
 * if one is present.
 *
 * If no link rel next header is found this method returns null.
 */
interface ISplitLinkHeaderValues {
  readonly values: ReadonlyArray<string>
  readonly structurallyValid: boolean
}

function splitLinkHeaderValues(linkHeader: string): ISplitLinkHeaderValues {
  const values = new Array<string>()
  let start = 0
  let inTarget = false
  let inQuote = false
  let escaped = false
  let targetsInValue = 0
  let structurallyValid = true

  const finishValue = (end: number) => {
    const value = linkHeader.slice(start, end)
    if (value.trim().length === 0 || targetsInValue !== 1) {
      structurallyValid = false
    }
    values.push(value)
    targetsInValue = 0
  }

  for (let index = 0; index < linkHeader.length; index++) {
    const character = linkHeader[index]
    if (inQuote) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inQuote = false
      }
      continue
    }
    if (character === '<') {
      if (
        inTarget ||
        targetsInValue > 0 ||
        linkHeader.slice(start, index).trim().length > 0
      ) {
        structurallyValid = false
      }
      inTarget = true
      targetsInValue++
    } else if (character === '>' && inTarget) {
      inTarget = false
    } else if (character === '>') {
      structurallyValid = false
    } else if (character === '"' && !inTarget) {
      inQuote = true
    } else if (character === '"') {
      structurallyValid = false
    } else if (character === ',' && !inTarget) {
      finishValue(index)
      start = index + 1
    }
  }
  finishValue(linkHeader.length)
  return {
    values,
    structurallyValid: structurallyValid && !inTarget && !inQuote && !escaped,
  }
}

function splitLinkParameters(part: string): ReadonlyArray<string> {
  const targetEnd = part.indexOf('>')
  if (targetEnd < 0) {
    return []
  }

  const suffix = part.slice(targetEnd + 1)
  const segments = new Array<string>()
  let start = 0
  let inQuote = false
  let escaped = false
  for (let index = 0; index < suffix.length; index++) {
    const character = suffix[index]
    if (inQuote) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inQuote = false
      }
    } else if (character === '"') {
      inQuote = true
    } else if (character === ';') {
      segments.push(suffix.slice(start, index))
      start = index + 1
    }
  }
  segments.push(suffix.slice(start))
  return segments.slice(1)
}

function getNextPagePathFromLink(
  response: Response,
  expectedEndpoint?: string
): string | null {
  const linkHeader = response.headers.get('Link')

  if (!linkHeader) {
    return null
  }

  const parsedHeader = splitLinkHeaderValues(linkHeader)
  if (!parsedHeader.structurallyValid) {
    return null
  }

  for (const part of parsedHeader.values) {
    const target = part.match(/^\s*<([^>]+)>/)
    if (target !== null && linkPartHasRelation(part, 'next')) {
      const candidate = target[1]
      if (candidate.startsWith('//') || /[\u0000-\u0020\\]/.test(candidate)) {
        return null
      }
      try {
        const nextURL = candidate.startsWith('/')
          ? expectedEndpoint === undefined
            ? null
            : new globalThis.URL(candidate, expectedEndpoint)
          : new globalThis.URL(candidate)
        if (nextURL === null) {
          return candidate
        }
        if (
          !['http:', 'https:'].includes(nextURL.protocol) ||
          (expectedEndpoint !== undefined &&
            nextURL.origin !== new globalThis.URL(expectedEndpoint).origin)
        ) {
          return null
        }
        return `${nextURL.pathname}${nextURL.search}` || null
      } catch {
        return null
      }
    }
  }

  return null
}

function linkPartHasRelation(part: string, relation: string): boolean {
  const parsed = parseLinkPartRelation(part)
  return (
    parsed.kind === 'valid' &&
    parsed.tokens.some(token => token.toLowerCase() === relation.toLowerCase())
  )
}

function linkPartHasMalformedRelation(part: string): boolean {
  return parseLinkPartRelation(part).kind !== 'valid'
}

type ParsedLinkRelation =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'valid'; readonly tokens: ReadonlyArray<string> }

/** Parse only the first rel parameter, as required for duplicate parameters. */
function parseLinkPartRelation(part: string): ParsedLinkRelation {
  const relationParameter = splitLinkParameters(part).find(parameter =>
    /^\s*rel(?:\s*=|\s*$)/i.test(parameter)
  )
  if (relationParameter === undefined) {
    return { kind: 'absent' }
  }
  const parameter = relationParameter.trimStart()
  const assignment = /^rel\s*=\s*/i.exec(parameter)
  if (assignment === null) {
    return { kind: 'invalid' }
  }

  const remainder = parameter.slice(assignment[0].length)
  if (remainder.startsWith('"')) {
    const closingQuote = remainder.indexOf('"', 1)
    if (closingQuote < 0) {
      return { kind: 'invalid' }
    }
    const trailing = remainder.slice(closingQuote + 1).trim()
    const value = remainder.slice(1, closingQuote)
    const tokens = /^[^ \t\r\n]+(?: +[^ \t\r\n]+)*$/.test(value)
      ? value.split(/ +/)
      : []
    return tokens.length > 0 &&
      tokens.every(isValidLinkRelationToken) &&
      trailing.length === 0
      ? { kind: 'valid', tokens }
      : { kind: 'invalid' }
  }

  const value = /^([^\s;,"=]+)/.exec(remainder)?.[1]
  if (value === undefined) {
    return { kind: 'invalid' }
  }
  const trailing = remainder.slice(value.length).trim()
  return isValidLinkRelationToken(value) && trailing.length === 0
    ? { kind: 'valid', tokens: [value] }
    : { kind: 'invalid' }
}

function isValidLinkRelationToken(value: string): boolean {
  if (/^[a-z][a-z0-9.-]*$/.test(value)) {
    return true
  }
  try {
    return new globalThis.URL(value).protocol.length > 1
  } catch {
    return false
  }
}

/**
 * Parses the 'next' Link header from GitHub using
 * `getNextPagePathFromLink`. Unlike `getNextPagePathFromLink`
 * this method will attempt to double the page size when
 * the current page index and the page size allows for it
 * leading to a ramp up in page size.
 *
 * This might sound confusing, and it is, but the primary use
 * case for this is when retrieving updated PRs. By specifying
 * an initial page size of, for example, 10 this method will
 * increase the page size to 20 once the second page has been
 * loaded. See the table below for an example. The ramp-up
 * will stop at a page size of 100 since that's the maximum
 * that the GitHub API supports.
 *
 * ```
 * |-----------|------|-----------|-----------------|
 * | Request # | Page | Page size | Retrieved items |
 * |-----------|------|-----------|-----------------|
 * | 1         | 1    | 10        | 10              |
 * | 2         | 2    | 10        | 20              |
 * | 3         | 2    | 20        | 40              |
 * | 4         | 2    | 40        | 80              |
 * | 5         | 2    | 80        | 160             |
 * | 6         | 3    | 80        | 240             |
 * | 7         | 4    | 80        | 320             |
 * | 8         | 5    | 80        | 400             |
 * | 9         | 5    | 100       | 500             |
 * |-----------|------|-----------|-----------------|
 * ```
 * This algorithm means we can have the best of both worlds.
 * If there's a small number of changed pull requests since
 * our last update we'll do small requests that use minimal
 * bandwidth but if we encounter a repository where a lot
 * of PRs have changed since our last fetch (like a very
 * active repository or one we haven't fetched in a long time)
 * we'll spool up our page size in just a few requests and load
 * in bulk.
 *
 * As an example I used a very active internal repository and
 * asked for all PRs updated in the last 24 hours which was 320.
 * With the previous regime of fetching with a page size of 10
 * that obviously took 32 requests. With this new regime it
 * would take 7.
 */
export function getNextPagePathWithIncreasingPageSize(response: Response) {
  const nextPath = getNextPagePathFromLink(response)

  if (!nextPath) {
    return null
  }

  const { pathname, query } = URL.parse(nextPath, true)
  const { per_page, page } = query

  const pageSize = typeof per_page === 'string' ? parseInt(per_page, 10) : NaN
  const pageNumber = typeof page === 'string' ? parseInt(page, 10) : NaN

  if (!pageSize || !pageNumber) {
    return nextPath
  }

  // Confusing, but we're looking at the _next_ page path here
  // so the current is whatever came before it.
  const currentPage = pageNumber - 1

  // Number of received items thus far
  const received = currentPage * pageSize

  // Can't go above 100, that's the max the API will allow.
  const nextPageSize = Math.min(100, pageSize * 2)

  // Have we received exactly the amount of items
  // such that doubling the page size and loading the
  // second page would seamlessly fit? No sense going
  // above 100 since that's the max the API supports
  if (pageSize !== nextPageSize && received % nextPageSize === 0) {
    query.per_page = `${nextPageSize}`
    query.page = `${received / nextPageSize + 1}`
    return URL.format({ pathname, query })
  }

  return nextPath
}

/**
 * Returns an ISO 8601 time string with second resolution instead of
 * the standard javascript toISOString which returns millisecond
 * resolution. The GitHub API doesn't return dates with milliseconds
 * so we won't send any back either.
 */
function toGitHubIsoDateString(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

interface IAPIAliveSignedChannel {
  readonly channel_name: string
  readonly signed_channel: string
}

interface IAPIAliveWebSocket {
  readonly url: string
}

type TokenInvalidatedCallback = (endpoint: string, token: string) => void

export interface IAPICreatePushProtectionBypassResponse {
  reason: BypassReasonType
  expire_at: string
  token_type: string
}

async function boundedActionsArtifactResponse(
  response: Response,
  signal?: AbortSignal,
  maximumBytes?: number
): Promise<unknown> {
  let value: unknown
  try {
    value = await readBoundedActionsArtifactJSON(
      response,
      signal,
      response.ok ? maximumBytes : undefined
    )
  } catch (error) {
    if (!response.ok && error instanceof ActionsArtifactJSONError) {
      throw new APIError(response, null)
    }
    throw error
  }
  if (!response.ok) {
    throw new APIError(response, parseBoundedActionsArtifactAPIError(value))
  }
  return value
}

async function boundedActionsMetadataResponse(
  response: Response,
  signal?: AbortSignal
): Promise<unknown> {
  let value: unknown
  try {
    value = await readBoundedActionsJSON(response, signal)
  } catch (error) {
    if (!response.ok && error instanceof ActionsMetadataJSONError) {
      throw new APIError(response, null)
    }
    throw error
  }
  if (!response.ok) {
    throw new APIError(response, parseBoundedActionsAPIError(value))
  }
  return value
}

async function requireSuccessfulActionsMutation(
  response: Response,
  signal?: AbortSignal
): Promise<void> {
  if (response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return
  }
  let value: unknown = null
  try {
    value = await readBoundedActionsJSON(response, signal)
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      throw error
    }
  }
  throw new APIError(response, parseBoundedActionsAPIError(value))
}

/**
 * An object for making authenticated requests to the GitHub API
 */
export class API {
  private static readonly tokenInvalidatedListeners =
    new Set<TokenInvalidatedCallback>()

  public static onTokenInvalidated(callback: TokenInvalidatedCallback) {
    this.tokenInvalidatedListeners.add(callback)
  }

  private static emitTokenInvalidated(endpoint: string, token: string) {
    this.tokenInvalidatedListeners.forEach(callback =>
      callback(endpoint, token)
    )
  }

  /** Create a new API client from the given account. */
  public static fromAccount(account: Account): API {
    if (account.provider === 'gitlab') {
      // Provider implementations live below the shared base class in this module.
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      return new GitLabAPI(account.endpoint, account.token)
    }
    if (account.provider === 'bitbucket') {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      return new BitbucketAPI(account.endpoint, account.token, account.login)
    }
    return new API(account.endpoint, account.token, account.copilotEndpoint)
  }

  protected endpoint: string
  protected token: string
  private copilotEndpoint?: string

  /** Create a new API client for the endpoint, authenticated with the token. */
  public constructor(
    endpoint: string,
    token: string,
    copilotEndpoint?: string
  ) {
    this.endpoint = endpoint
    this.token = token
    this.copilotEndpoint = copilotEndpoint
  }

  /** Execute one reviewed, repository-bound GitHub API Explorer request. */
  public async executeGitHubAPIWorkbench(
    request: GitHubAPIWorkbenchRequest,
    confirmed: boolean = false,
    signal?: AbortSignal
  ): Promise<IGitHubAPIWorkbenchResponse> {
    const execution = prepareGitHubAPIWorkbenchExecution(request, confirmed)
    const response = await this.ghRequest(execution.method, execution.path, {
      body:
        execution.body === undefined ? undefined : (execution.body as Object),
      signal,
    })
    return readGitHubAPIWorkbenchResponse(response)
  }

  /**
   * Retrieves the name of the Alive channel used by Desktop to receive
   * high-signal notifications.
   */
  public async getAliveDesktopChannel(): Promise<IAPIAliveSignedChannel | null> {
    try {
      const res = await this.ghRequest('GET', '/desktop_internal/alive-channel')
      const signedChannel = await parsedResponse<IAPIAliveSignedChannel>(res)
      return signedChannel
    } catch (e) {
      log.warn(`Alive channel request failed: ${e}`)
      return null
    }
  }

  /**
   * Retrieves the URL for the Alive websocket.
   *
   * @returns The websocket URL if the request succeeded, null if the request
   * failed with 404, otherwise it will throw an error.
   *
   * This behavior is expected by the AliveSession class constructor, to prevent
   * it from hitting the endpoint many times if it's disabled.
   */
  public async getAliveWebSocketURL(): Promise<string | null> {
    try {
      const res = await this.ghRequest('GET', '/alive_internal/websocket-url')
      if (res.status === HttpStatusCode.NotFound) {
        return null
      }
      const websocket = await parsedResponse<IAPIAliveWebSocket>(res)
      return websocket.url
    } catch (e) {
      log.warn(`Alive web socket request failed: ${e}`)
      throw e
    }
  }

  /**
   * Fetch an issue comment (i.e. a comment on an issue or pull request).
   *
   * @param owner The owner of the repository
   * @param name The name of the repository
   * @param commentId The ID of the comment
   *
   * @returns The comment if it was found, null if it wasn't, or an error
   * occurred.
   */
  public async fetchIssueComment(
    owner: string,
    name: string,
    commentId: string
  ): Promise<IAPIComment | null> {
    try {
      const response = await this.ghRequest(
        'GET',
        `repos/${owner}/${name}/issues/comments/${commentId}`
      )
      if (response.status === HttpStatusCode.NotFound) {
        log.warn(
          `fetchIssueComment: '${owner}/${name}/issues/comments/${commentId}' returned a 404`
        )
        return null
      }
      return await parsedResponse<IAPIComment>(response)
    } catch (e) {
      log.warn(
        `fetchIssueComment: an error occurred for '${owner}/${name}/issues/comments/${commentId}'`,
        e
      )
      return null
    }
  }

  /**
   * Fetch a pull request review comment (i.e. a comment that was posted as part
   * of a review of a pull request).
   *
   * @param owner The owner of the repository
   * @param name The name of the repository
   * @param commentId The ID of the comment
   *
   * @returns The comment if it was found, null if it wasn't, or an error
   * occurred.
   */
  public async fetchPullRequestReviewComment(
    owner: string,
    name: string,
    commentId: string
  ): Promise<IAPIComment | null> {
    try {
      const response = await this.ghRequest(
        'GET',
        `repos/${owner}/${name}/pulls/comments/${commentId}`
      )
      if (response.status === HttpStatusCode.NotFound) {
        log.warn(
          `fetchPullRequestReviewComment: '${owner}/${name}/pulls/comments/${commentId}' returned a 404`
        )
        return null
      }
      return await parsedResponse<IAPIComment>(response)
    } catch (e) {
      log.warn(
        `fetchPullRequestReviewComment: an error occurred for '${owner}/${name}/pulls/comments/${commentId}'`,
        e
      )
      return null
    }
  }

  /** Fetch a repo by its owner and name. */
  public async fetchRepository(
    owner: string,
    name: string
  ): Promise<IAPIFullRepository | null> {
    try {
      const response = await this.ghRequest('GET', `repos/${owner}/${name}`)
      if (response.status === HttpStatusCode.NotFound) {
        log.warn(`fetchRepository: '${owner}/${name}' returned a 404`)
        return null
      }
      return await parsedResponse<IAPIFullRepository>(response)
    } catch (e) {
      log.warn(`fetchRepository: an error occurred for '${owner}/${name}'`, e)
      return null
    }
  }

  /**
   * Fetch info needed to clone a repository. That includes:
   *  - The canonical clone URL for a repository, respecting the protocol
   *    preference if provided.
   *  - The default branch of the repository, in case the repository is empty.
   *    Only available for GitHub repositories.
   *
   * Returns null if the request returned a 404 (NotFound). NotFound doesn't
   * necessarily mean that the repository doesn't exist, it could exist and
   * the current user just doesn't have the permissions to see it. GitHub.com
   * doesn't differentiate between not found and permission denied for private
   * repositories as that would leak the existence of a private repository.
   *
   * Note that unlike `fetchRepository` this method will throw for all errors
   * except 404 NotFound responses.
   *
   * @param owner    The repository owner (nodejs in https://github.com/nodejs/node)
   * @param name     The repository name (node in https://github.com/nodejs/node)
   * @param protocol The preferred Git protocol (https or ssh)
   */
  public async fetchRepositoryCloneInfo(
    owner: string,
    name: string,
    protocol: GitProtocol | undefined
  ): Promise<IAPIRepositoryCloneInfo | null> {
    const response = await this.ghRequest('GET', `repos/${owner}/${name}`, {
      // Make sure we don't run into cache issues when fetching the repositories,
      // specially after repositories have been renamed.
      reloadCache: true,
    })

    if (response.status === HttpStatusCode.NotFound) {
      return null
    }

    const repo = await parsedResponse<IAPIRepository>(response)
    return {
      url: protocol === 'ssh' ? repo.ssh_url : repo.clone_url,
      defaultBranch: repo.default_branch,
    }
  }

  /**
   * Fetch all repos a user has access to in a streaming fashion. The callback
   * will be called for each new page fetched from the API.
   */
  public async streamUserRepositories(
    callback: (repos: ReadonlyArray<IAPIRepository>) => void,
    affiliation?: AffiliationFilter,
    options?: IFetchAllOptions<IAPIRepository>
  ) {
    try {
      const base = 'user/repos'
      const path = affiliation ? `${base}?affiliation=${affiliation}` : base

      await this.fetchAll<IAPIRepository>(path, {
        ...options,
        // "But wait, repositories can't have a null owner" you say.
        // Ordinarily you'd be correct but turns out there's super
        // rare circumstances where a user has been deleted but the
        // repository hasn't. Such cases are usually addressed swiftly
        // but in some cases like GitHub Enterprise instances
        // they can linger for longer than we'd like so we'll make
        // sure to exclude any such dangling repository, chances are
        // they won't be cloneable anyway.
        onPage: page => {
          callback(page.filter(x => x.owner !== null))
          options?.onPage?.(page)
        },
      })
    } catch (error) {
      log.warn(
        `streamUserRepositories: failed with endpoint ${this.endpoint}`,
        error
      )
    }
  }

  /** Fetch the logged in account. */
  public async fetchAccount(): Promise<IAPIFullIdentity> {
    try {
      const response = await this.ghRequest('GET', 'user')
      const result = await parsedResponse<IAPIFullIdentity>(response)
      return result
    } catch (e) {
      log.warn(`fetchAccount: failed with endpoint ${this.endpoint}`, e)
      throw e
    }
  }

  /** Fetch the current user's emails. */
  public async fetchEmails(): Promise<ReadonlyArray<IAPIEmail>> {
    try {
      const response = await this.ghRequest('GET', 'user/emails')
      const result = await parsedResponse<ReadonlyArray<IAPIEmail>>(response)

      return Array.isArray(result) ? result : []
    } catch (e) {
      log.warn(`fetchEmails: failed with endpoint ${this.endpoint}`, e)
      return []
    }
  }

  /** Fetch one bounded page from the authenticated user's GitHub inbox. */
  public async fetchNotifications(
    options: IAPINotificationsOptions
  ): Promise<IAPINotificationsPage> {
    const page = Math.max(1, Math.trunc(options.page))
    const perPage = Math.max(1, Math.min(50, options.perPage ?? 50))
    const path = urlWithQueryString('notifications', {
      all: String(options.includeRead),
      participating: String(options.participating),
      per_page: String(perPage),
      page: String(page),
    })
    const customHeaders = new Headers({
      Accept: 'application/vnd.github+json',
    })
    if (options.lastModified) {
      customHeaders.set('If-Modified-Since', options.lastModified)
    }

    const response = await this.ghRequest('GET', path, {
      customHeaders,
      signal: options.signal,
    })
    const lastModified = response.headers.get('Last-Modified')
    const rawPollInterval = response.headers.get('X-Poll-Interval')
    const parsedPollInterval =
      rawPollInterval === null ? NaN : Number.parseInt(rawPollInterval, 10)
    const pollIntervalSeconds = Number.isFinite(parsedPollInterval)
      ? parsedPollInterval
      : null

    if (response.status === HttpStatusCode.NotModified) {
      return {
        notifications: [],
        hasNextPage: false,
        notModified: true,
        lastModified: lastModified ?? options.lastModified ?? null,
        pollIntervalSeconds,
      }
    }

    const notifications = await parsedResponse<
      ReadonlyArray<IAPINotificationThread>
    >(response)
    return {
      notifications,
      hasNextPage: getNextPagePathFromLink(response) !== null,
      notModified: false,
      lastModified,
      pollIntervalSeconds,
    }
  }

  /** Mark exactly one GitHub notification thread as read. */
  public async markNotificationThreadRead(
    threadId: string,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await this.ghRequest(
      'PATCH',
      `notifications/threads/${encodeURIComponent(threadId)}`,
      { signal }
    )
    if (!response.ok && response.status !== HttpStatusCode.NotModified) {
      await parsedResponse<unknown>(response)
    }
  }

  /** Mark exactly one GitHub notification thread as done. */
  public async markNotificationThreadDone(
    threadId: string,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await this.ghRequest(
      'DELETE',
      `notifications/threads/${encodeURIComponent(threadId)}`,
      { signal }
    )
    if (!response.ok) {
      await parsedResponse<unknown>(response)
    }
  }

  /** Fetch all the orgs to which the user belongs. */
  public async fetchOrgs(): Promise<ReadonlyArray<IAPIOrganization>> {
    try {
      return await this.fetchAll<IAPIOrganization>('user/orgs')
    } catch (e) {
      log.warn(`fetchOrgs: failed with endpoint ${this.endpoint}`, e)
      return []
    }
  }

  /**
   * Fetch every repository visible to the authenticated user in an
   * organization. Unlike the user repository stream this endpoint also
   * includes organization repositories which aren't returned through one of
   * the user's explicit affiliation buckets.
   */
  public async fetchOrgRepositories(
    org: string
  ): Promise<ReadonlyArray<IAPIRepository>> {
    try {
      return await this.fetchAll<IAPIRepository>(
        `orgs/${encodeURIComponent(org)}/repos`
      )
    } catch (e) {
      log.warn(
        `fetchOrgRepositories: failed for ${org} with endpoint ${this.endpoint}`,
        e
      )
      throw e
    }
  }

  /** Create a new GitHub repository with the given properties. */
  public async createRepository(
    org: IAPIOrganization | null,
    name: string,
    description: string,
    private_: boolean
  ): Promise<IAPIFullRepository> {
    try {
      const apiPath = org ? `orgs/${org.login}/repos` : 'user/repos'
      const response = await this.ghRequest('POST', apiPath, {
        body: {
          name,
          description,
          private: private_,
        },
      })

      return await parsedResponse<IAPIFullRepository>(response)
    } catch (e) {
      if (e instanceof APIError) {
        if (org !== null) {
          throw new Error(
            `Unable to create repository for organization '${org.login}'. Verify that the repository does not already exist and that you have permission to create a repository there.`
          )
        }
        throw e
      }

      log.error(`createRepository: failed with endpoint ${this.endpoint}`, e)
      throw new Error(
        `Unable to publish repository. Please check if you have an internet connection and try again.`
      )
    }
  }

  /** Create a new GitHub fork of this repository (owner and name) */
  public async forkRepository(
    owner: string,
    name: string
  ): Promise<IAPIFullRepository> {
    try {
      const apiPath = `/repos/${owner}/${name}/forks`
      const response = await this.ghRequest('POST', apiPath)
      return await parsedResponse<IAPIFullRepository>(response)
    } catch (e) {
      log.error(
        `forkRepository: failed to fork ${owner}/${name} at endpoint: ${this.endpoint}`,
        e
      )
      throw e
    }
  }

  /**
   * Fetch the issues with the given state that have been created or updated
   * since the given date.
   */
  public async fetchIssues(
    owner: string,
    name: string,
    state: 'open' | 'closed' | 'all',
    since: Date | null
  ): Promise<ReadonlyArray<IAPIIssue>> {
    const params: { [key: string]: string } = {
      state,
    }
    if (since && !isNaN(since.getTime())) {
      params.since = toGitHubIsoDateString(since)
    }

    const url = urlWithQueryString(`repos/${owner}/${name}/issues`, params)
    try {
      const issues = await this.fetchAll<IAPIIssue>(url)

      // PRs are issues! But we only want Really Seriously Issues.
      return issues.filter(
        (i: any) => i.pull_request === undefined && i.pullRequest === undefined
      )
    } catch (e) {
      log.warn(`fetchIssues: failed for repository ${owner}/${name}`, e)
      throw e
    }
  }

  /**
   * Create one issue using the bounded fields exposed by the guided Desktop
   * flow. The response URL is validated against this client's provider before
   * it is returned to a caller that may offer to open it.
   */
  public async fetchProviderTriageIssues(
    owner: string,
    name: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<IAPIProviderTriagePage> {
    signal?.throwIfAborted()
    const safeLimit = normalizeProviderTriageLimit(limit)
    const safeOwner = validateGitHubRepositoryPart(owner, 'owner')
    const safeName = validateGitHubRepositoryPart(name, 'repository')
    const path = urlWithQueryString(
      `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
        safeName
      )}/issues`,
      {
        state: 'open',
        sort: 'updated',
        direction: 'desc',
        page: '1',
        per_page: String(safeLimit),
      }
    )
    const response = await this.ghRequest('GET', path, { signal })
    const issues = parseGitHubTriageIssues(
      await boundedProviderTriageResponse(response, signal),
      safeLimit
    )
    return {
      supported: true,
      capped:
        getNextPagePathFromLink(response) !== null ||
        issues.length === safeLimit,
      items: issues,
    }
  }

  /** Fetch one bounded, cancellable page of open pull requests for triage. */
  public async fetchProviderTriagePullRequests(
    owner: string,
    name: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<IAPIProviderTriagePage> {
    signal?.throwIfAborted()
    const safeLimit = normalizeProviderTriageLimit(limit)
    const safeOwner = validateGitHubRepositoryPart(owner, 'owner')
    const safeName = validateGitHubRepositoryPart(name, 'repository')
    const path = urlWithQueryString(
      `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
        safeName
      )}/pulls`,
      {
        state: 'open',
        sort: 'updated',
        direction: 'desc',
        page: '1',
        per_page: String(safeLimit),
      }
    )
    const response = await this.ghRequest('GET', path, { signal })
    const values = parseGitHubTriagePullRequests(
      await boundedProviderTriageResponse(response, signal),
      safeLimit
    )
    return {
      supported: true,
      capped:
        getNextPagePathFromLink(response) !== null ||
        values.length === safeLimit,
      items: values,
    }
  }

  /**
   * Create one issue using the bounded fields exposed by the guided Desktop
   * flow. The response URL is validated against this client's provider before
   * it is returned to a caller that may offer to open it.
   */
  public async createIssue(
    owner: string,
    name: string,
    title: string,
    body: string,
    signal?: AbortSignal
  ): Promise<ICreatedGitHubIssue> {
    signal?.throwIfAborted()

    const safeOwner = validateGitHubRepositoryPart(owner, 'owner')
    const safeName = validateGitHubRepositoryPart(name, 'repository')
    const draft = normalizeGitHubIssueDraft(title, body)
    const path = `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
      safeName
    )}/issues`
    const response = await this.ghRequest('POST', path, {
      body: draft,
      customHeaders: { Accept: 'application/vnd.github+json' },
      signal,
    })
    const issue = await parsedResponse<IAPICreatedGitHubIssue>(response)

    return validateCreatedGitHubIssue(
      issue,
      safeOwner,
      safeName,
      getHTMLURL(this.endpoint)
    )
  }

  /**
   * Create one pull request using only the reviewed fields exposed by the
   * guided Desktop flow. The returned browser URL is constrained to this
   * client's provider and the exact target repository and PR number.
   */
  public async fetchIssuePage(
    owner: string,
    name: string,
    query: IGitHubIssueQuery,
    signal?: AbortSignal
  ): Promise<IGitHubIssueList> {
    const safeOwner = validateGitHubIssueRepositoryPart(owner, 'owner')
    const safeName = validateGitHubIssueRepositoryPart(name, 'repository')
    const safeQuery = normalizeGitHubIssueQuery(query)
    const parameters = new URL.URLSearchParams()
    parameters.set('per_page', `${GitHubIssuePageSize}`)
    parameters.set('page', `${safeQuery.page}`)
    parameters.set('sort', safeQuery.sort)
    parameters.set('direction', safeQuery.direction)

    let path: string
    if (safeQuery.search.length > 0) {
      const quote = (value: string) => `"${value.replace(/["\\]/g, '\\$&')}"`
      const qualifiers = [
        `repo:${safeOwner}/${safeName}`,
        'is:issue',
        safeQuery.state === 'all' ? null : `is:${safeQuery.state}`,
        ...safeQuery.labels.map(label => `label:${quote(label)}`),
        safeQuery.assignee === null
          ? null
          : `assignee:${quote(safeQuery.assignee)}`,
        safeQuery.milestone === null
          ? null
          : `milestone:${safeQuery.milestone}`,
        `in:title,body ${quote(safeQuery.search)}`,
      ].filter((item): item is string => item !== null)
      parameters.set('q', qualifiers.join(' '))
      parameters.set('order', safeQuery.direction)
      parameters.delete('direction')
      path = `search/issues?${parameters.toString()}`
    } else {
      parameters.set('state', safeQuery.state)
      if (safeQuery.labels.length > 0) {
        parameters.set('labels', safeQuery.labels.join(','))
      }
      if (safeQuery.assignee !== null) {
        parameters.set('assignee', safeQuery.assignee)
      }
      if (safeQuery.milestone !== null) {
        parameters.set('milestone', `${safeQuery.milestone}`)
      }
      path = `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
        safeName
      )}/issues?${parameters.toString()}`
    }

    const response = await this.ghRequest('GET', path, { signal })
    return parseGitHubIssueList(
      await boundedGitHubIssueResponse(response, signal),
      safeQuery,
      safeOwner,
      safeName,
      getHTMLURL(this.endpoint)
    )
  }

  /** Re-fetch one exact issue through the bounded parser before mutation. */
  public async fetchIssue(
    owner: string,
    name: string,
    issueNumber: number,
    signal?: AbortSignal
  ): Promise<IGitHubIssue> {
    const safeOwner = validateGitHubIssueRepositoryPart(owner, 'owner')
    const safeName = validateGitHubIssueRepositoryPart(name, 'repository')
    const safeNumber = validateGitHubIssueNumber(issueNumber)
    const response = await this.ghRequest(
      'GET',
      `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
        safeName
      )}/issues/${safeNumber}`,
      { signal }
    )
    return parseGitHubIssue(
      await boundedGitHubIssueResponse(response, signal),
      safeNumber,
      safeOwner,
      safeName,
      getHTMLURL(this.endpoint)
    )
  }

  /** Browse one bounded page of comments for an exact issue. */
  public async fetchIssueCommentPage(
    owner: string,
    name: string,
    issueNumber: number,
    page: number = 1,
    signal?: AbortSignal
  ): Promise<IGitHubIssueCommentList> {
    const safeOwner = validateGitHubIssueRepositoryPart(owner, 'owner')
    const safeName = validateGitHubIssueRepositoryPart(name, 'repository')
    const safeNumber = validateGitHubIssueNumber(issueNumber)
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > GitHubIssueCommentMaximumPages
    ) {
      throw new Error(
        'The requested issue comment page exceeds the app safety limit.'
      )
    }
    const response = await this.ghRequest(
      'GET',
      `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
        safeName
      )}/issues/${safeNumber}/comments?per_page=${GitHubIssueCommentPageSize}&page=${page}`,
      { signal }
    )
    return parseGitHubIssueCommentList(
      await boundedGitHubIssueResponse(response, signal),
      page,
      safeOwner,
      safeName,
      safeNumber,
      getHTMLURL(this.endpoint)
    )
  }

  /**
   * Load repository metadata through locally generated pages. Older GHES
   * versions may omit one endpoint; only explicit 404/410 responses are
   * reported neutrally as unavailable because it may indicate provider version
   * or repository access changes.
   */
  public async fetchIssueMetadata(
    owner: string,
    name: string,
    signal?: AbortSignal
  ): Promise<IGitHubIssueMetadata> {
    const safeOwner = validateGitHubIssueRepositoryPart(owner, 'owner')
    const safeName = validateGitHubIssueRepositoryPart(name, 'repository')
    const root = `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
      safeName
    )}`
    const unavailable = new Array<'labels' | 'assignees' | 'milestones'>()

    const fetchPages = async <T>(
      kind: 'labels' | 'assignees' | 'milestones',
      parser: (value: unknown) => ReadonlyArray<T>
    ): Promise<{
      readonly items: ReadonlyArray<T>
      readonly capped: boolean
    }> => {
      const items = new Array<T>()
      try {
        for (let page = 1; page <= GitHubIssueMetadataMaximumPages; page++) {
          const state = kind === 'milestones' ? 'state=all&' : ''
          const response = await this.ghRequest(
            'GET',
            `${root}/${kind}?${state}per_page=${GitHubIssueMetadataPageSize}&page=${page}`,
            { signal }
          )
          const parsed = parser(
            await boundedGitHubIssueResponse(response, signal)
          )
          items.push(...parsed)
          if (parsed.length < GitHubIssueMetadataPageSize) {
            return { items, capped: false }
          }
          if (page === GitHubIssueMetadataMaximumPages) {
            return { items, capped: true }
          }
        }
      } catch (error) {
        if (
          error instanceof APIError &&
          (error.responseStatus === 404 || error.responseStatus === 410)
        ) {
          unavailable.push(kind)
          return { items: [], capped: false }
        }
        throw error
      }
      return { items, capped: false }
    }

    const labels = await fetchPages('labels', parseGitHubIssueLabelPage)
    const assignees = await fetchPages(
      'assignees',
      parseGitHubIssueAssigneePage
    )
    const milestones = await fetchPages(
      'milestones',
      parseGitHubIssueMilestonePage
    )
    if (
      new Set(labels.items.map(label => label.id)).size !==
        labels.items.length ||
      new Set(assignees.items).size !== assignees.items.length ||
      new Set(milestones.items.map(milestone => milestone.number)).size !==
        milestones.items.length
    ) {
      throw new Error('GitHub returned duplicate issue metadata pages.')
    }
    return {
      labels: labels.items,
      assignees: assignees.items,
      milestones: milestones.items,
      labelsCapped: labels.capped,
      assigneesCapped: assignees.capped,
      milestonesCapped: milestones.capped,
      unavailable,
    }
  }

  /** Update the reviewed issue's title, body, and supported metadata. */
  public async updateIssue(
    owner: string,
    name: string,
    issueNumber: number,
    update: IGitHubIssueUpdate,
    signal?: AbortSignal
  ): Promise<IGitHubIssue> {
    const safeOwner = validateGitHubIssueRepositoryPart(owner, 'owner')
    const safeName = validateGitHubIssueRepositoryPart(name, 'repository')
    const safeNumber = validateGitHubIssueNumber(issueNumber)
    const safeUpdate = normalizeGitHubIssueUpdate(update)
    const response = await this.ghRequest(
      'PATCH',
      `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
        safeName
      )}/issues/${safeNumber}`,
      {
        body: {
          title: safeUpdate.title,
          body: safeUpdate.body,
          labels: safeUpdate.labels,
          assignees: safeUpdate.assignees,
          milestone: safeUpdate.milestone,
        },
        customHeaders: { Accept: 'application/vnd.github+json' },
        signal,
      }
    )
    return parseGitHubIssue(
      await boundedGitHubIssueResponse(response, signal),
      safeNumber,
      safeOwner,
      safeName,
      getHTMLURL(this.endpoint)
    )
  }

  /** Close or reopen one reviewed issue. */
  public async setIssueState(
    owner: string,
    name: string,
    issueNumber: number,
    state: GitHubIssueState,
    signal?: AbortSignal
  ): Promise<IGitHubIssue> {
    const safeOwner = validateGitHubIssueRepositoryPart(owner, 'owner')
    const safeName = validateGitHubIssueRepositoryPart(name, 'repository')
    const safeNumber = validateGitHubIssueNumber(issueNumber)
    if (state !== 'open' && state !== 'closed') {
      throw new Error('Choose a supported issue state.')
    }
    const response = await this.ghRequest(
      'PATCH',
      `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
        safeName
      )}/issues/${safeNumber}`,
      {
        body: { state },
        customHeaders: { Accept: 'application/vnd.github+json' },
        signal,
      }
    )
    const issue = parseGitHubIssue(
      await boundedGitHubIssueResponse(response, signal),
      safeNumber,
      safeOwner,
      safeName,
      getHTMLURL(this.endpoint)
    )
    if (issue.state !== state) {
      throw new Error('GitHub did not apply the reviewed issue state.')
    }
    return issue
  }

  /** Append one reviewed comment and validate its provider link. */
  public async addIssueComment(
    owner: string,
    name: string,
    issueNumber: number,
    body: string,
    signal?: AbortSignal
  ): Promise<IGitHubIssueComment> {
    const safeOwner = validateGitHubIssueRepositoryPart(owner, 'owner')
    const safeName = validateGitHubIssueRepositoryPart(name, 'repository')
    const safeNumber = validateGitHubIssueNumber(issueNumber)
    const safeBody = normalizeGitHubIssueComment(body)
    const response = await this.ghRequest(
      'POST',
      `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
        safeName
      )}/issues/${safeNumber}/comments`,
      {
        body: { body: safeBody },
        customHeaders: { Accept: 'application/vnd.github+json' },
        signal,
      }
    )
    return parseGitHubIssueComment(
      await boundedGitHubIssueResponse(response, signal),
      safeOwner,
      safeName,
      safeNumber,
      getHTMLURL(this.endpoint)
    )
  }

  /**
   * Create one pull request using only the reviewed fields exposed by the
   * guided Desktop flow. The returned browser URL is constrained to this
   * client's provider and the exact target repository and PR number.
   */
  public async createPullRequest(
    owner: string,
    name: string,
    title: string,
    body: string,
    head: string,
    base: string,
    draft: boolean,
    headRepository?: IGitHubPullRequestHeadRepository | AbortSignal,
    signal?: AbortSignal,
    metadata: IGitHubPullRequestMetadata = EmptyGitHubPullRequestMetadata
  ): Promise<ICreatedGitHubPullRequest> {
    if (headRepository !== undefined && 'aborted' in headRepository) {
      signal = headRepository
    }
    const resolvedHeadRepository: IGitHubPullRequestHeadRepository | undefined =
      headRepository === undefined || 'aborted' in headRepository
        ? undefined
        : headRepository
    signal?.throwIfAborted()

    const safeOwner = validateGitHubRepositoryPart(owner, 'owner')
    const safeName = validateGitHubRepositoryPart(name, 'repository')
    const pullRequest = normalizeGitHubPullRequestDraft(
      title,
      body,
      head,
      base,
      draft,
      resolvedHeadRepository
    )
    const safeMetadata = normalizeGitHubPullRequestMetadata(
      metadata.reviewers,
      metadata.assignees,
      metadata.labels
    )
    const requestBody = {
      title: pullRequest.title,
      body: pullRequest.body,
      head: pullRequest.head,
      ...(pullRequest.headRepository?.name === null ||
      pullRequest.headRepository === undefined
        ? {}
        : { head_repo: pullRequest.headRepository.name }),
      base: pullRequest.base,
      draft: pullRequest.draft,
    }
    const path = `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
      safeName
    )}/pulls`
    const response = await this.ghRequest('POST', path, {
      body: requestBody,
      customHeaders: { Accept: 'application/vnd.github+json' },
      signal,
    })
    const created = (await boundedGitHubPullRequestResponse(
      response,
      signal
    )) as IAPICreatedGitHubPullRequest
    const validated = validateCreatedGitHubPullRequest(
      created,
      safeOwner,
      safeName,
      getHTMLURL(this.endpoint),
      pullRequest
    )
    const metadataWarnings = await this.applyCreatedPullRequestMetadata(
      safeOwner,
      safeName,
      validated.number,
      safeMetadata,
      signal
    )
    return metadataWarnings.length === 0
      ? validated
      : { ...validated, metadataWarnings }
  }

  private async applyCreatedPullRequestMetadata(
    owner: string,
    name: string,
    pullRequestNumber: number,
    metadata: IGitHubPullRequestMetadata,
    signal?: AbortSignal
  ): Promise<ReadonlyArray<string>> {
    const warnings = new Array<string>()
    const root = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      name
    )}`

    if (metadata.reviewers.length > 0) {
      try {
        const response = await this.ghRequest(
          'POST',
          `${root}/pulls/${pullRequestNumber}/requested_reviewers`,
          {
            body: { reviewers: metadata.reviewers },
            customHeaders: { Accept: 'application/vnd.github+json' },
            signal,
          }
        )
        await boundedGitHubPullRequestResponse(response, signal)
      } catch {
        warnings.push(
          'The pull request was created, but reviewers were not requested.'
        )
      }
    }

    if (metadata.assignees.length > 0 || metadata.labels.length > 0) {
      try {
        const response = await this.ghRequest(
          'PATCH',
          `${root}/issues/${pullRequestNumber}`,
          {
            body: {
              assignees: metadata.assignees,
              labels: metadata.labels,
            },
            customHeaders: { Accept: 'application/vnd.github+json' },
            signal,
          }
        )
        await boundedGitHubPullRequestResponse(response, signal)
      } catch {
        warnings.push(
          'The pull request was created, but assignees or labels were not applied.'
        )
      }
    }
    return warnings
  }

  /** Load one exact pull request for the native lifecycle workbench. */
  public async inspectPullRequest(
    owner: string,
    name: string,
    pullRequestNumber: number,
    signal?: AbortSignal
  ): Promise<IGitHubPullRequestLifecycle> {
    signal?.throwIfAborted()
    const safeOwner = validateGitHubRepositoryPart(owner, 'owner')
    const safeName = validateGitHubRepositoryPart(name, 'repository')
    const safeNumber = validateGitHubPullRequestNumber(pullRequestNumber)
    const response = await this.ghRequest(
      'GET',
      `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
        safeName
      )}/pulls/${safeNumber}`,
      {
        customHeaders: { Accept: 'application/vnd.github+json' },
        signal,
      }
    )
    const value = (await boundedGitHubPullRequestResponse(
      response,
      signal
    )) as IAPIGitHubPullRequestLifecycle
    return validateGitHubPullRequestLifecycle(
      value,
      safeOwner,
      safeName,
      safeNumber,
      getHTMLURL(this.endpoint)
    )
  }

  /** Update reviewed PR fields and exact metadata lists for one head snapshot. */
  public async updatePullRequestLifecycle(
    owner: string,
    name: string,
    pullRequestNumber: number,
    expectedHeadSHA: string,
    update: IGitHubPullRequestUpdate,
    signal?: AbortSignal
  ): Promise<IGitHubPullRequestMutationReceipt> {
    signal?.throwIfAborted()
    const safeOwner = validateGitHubRepositoryPart(owner, 'owner')
    const safeName = validateGitHubRepositoryPart(name, 'repository')
    const safeNumber = validateGitHubPullRequestNumber(pullRequestNumber)
    const safeHeadSHA = validateGitHubPullRequestHeadSHA(expectedHeadSHA)
    const safeUpdate = normalizeGitHubPullRequestUpdate(
      update.title,
      update.body,
      update.base,
      update.metadata
    )
    const current = await this.inspectPullRequest(
      safeOwner,
      safeName,
      safeNumber,
      signal
    )
    if (current.headSHA !== safeHeadSHA) {
      throw new GitHubPullRequestContextChangedError()
    }
    if (current.state !== 'open' || current.merged) {
      throw new Error('Only an open pull request can be updated.')
    }

    const root = `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
      safeName
    )}`
    const response = await this.ghRequest(
      'PATCH',
      `${root}/pulls/${safeNumber}`,
      {
        body: {
          title: safeUpdate.title,
          body: safeUpdate.body,
          base: safeUpdate.base,
        },
        customHeaders: { Accept: 'application/vnd.github+json' },
        signal,
      }
    )
    const updatedValue = (await boundedGitHubPullRequestResponse(
      response,
      signal
    )) as IAPIGitHubPullRequestLifecycle
    validateGitHubPullRequestLifecycle(
      updatedValue,
      safeOwner,
      safeName,
      safeNumber,
      getHTMLURL(this.endpoint)
    )

    const warnings = new Array<string>()
    const currentReviewerKeys = new Set(
      current.metadata.reviewers.map(login => login.toLowerCase())
    )
    const requestedReviewerKeys = new Set(
      safeUpdate.metadata.reviewers.map(login => login.toLowerCase())
    )
    const reviewersToAdd = safeUpdate.metadata.reviewers.filter(
      login => !currentReviewerKeys.has(login.toLowerCase())
    )
    const reviewersToRemove = current.metadata.reviewers.filter(
      login => !requestedReviewerKeys.has(login.toLowerCase())
    )
    try {
      if (reviewersToAdd.length > 0) {
        const addResponse = await this.ghRequest(
          'POST',
          `${root}/pulls/${safeNumber}/requested_reviewers`,
          {
            body: { reviewers: reviewersToAdd },
            customHeaders: { Accept: 'application/vnd.github+json' },
            signal,
          }
        )
        await boundedGitHubPullRequestResponse(addResponse, signal)
      }
      if (reviewersToRemove.length > 0) {
        const removeResponse = await this.ghRequest(
          'DELETE',
          `${root}/pulls/${safeNumber}/requested_reviewers`,
          {
            body: { reviewers: reviewersToRemove },
            customHeaders: { Accept: 'application/vnd.github+json' },
            signal,
          }
        )
        await boundedGitHubPullRequestResponse(removeResponse, signal)
      }
    } catch {
      warnings.push('Reviewer requests were not fully updated.')
    }

    try {
      const issueResponse = await this.ghRequest(
        'PATCH',
        `${root}/issues/${safeNumber}`,
        {
          body: {
            assignees: safeUpdate.metadata.assignees,
            labels: safeUpdate.metadata.labels,
          },
          customHeaders: { Accept: 'application/vnd.github+json' },
          signal,
        }
      )
      await boundedGitHubPullRequestResponse(issueResponse, signal)
    } catch {
      warnings.push('Assignees or labels were not fully updated.')
    }

    const pullRequest = await this.inspectPullRequest(
      safeOwner,
      safeName,
      safeNumber,
      signal
    )
    if (pullRequest.headSHA !== safeHeadSHA) {
      throw new GitHubPullRequestContextChangedError()
    }
    return { pullRequest, warnings }
  }

  /** Submit one bounded top-level review against an unchanged head. */
  public async submitPullRequestReview(
    owner: string,
    name: string,
    pullRequestNumber: number,
    expectedHeadSHA: string,
    review: IGitHubPullRequestReview,
    signal?: AbortSignal
  ): Promise<IGitHubPullRequestReviewReceipt> {
    signal?.throwIfAborted()
    const safeOwner = validateGitHubRepositoryPart(owner, 'owner')
    const safeName = validateGitHubRepositoryPart(name, 'repository')
    const safeNumber = validateGitHubPullRequestNumber(pullRequestNumber)
    const safeHeadSHA = validateGitHubPullRequestHeadSHA(expectedHeadSHA)
    const safeReview = normalizeGitHubPullRequestReview(
      review.event,
      review.body
    )
    const current = await this.inspectPullRequest(
      safeOwner,
      safeName,
      safeNumber,
      signal
    )
    if (current.headSHA !== safeHeadSHA) {
      throw new GitHubPullRequestContextChangedError()
    }
    if (current.state !== 'open' || current.merged) {
      throw new Error('Only an open pull request can be reviewed.')
    }
    const response = await this.ghRequest(
      'POST',
      `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
        safeName
      )}/pulls/${safeNumber}/reviews`,
      {
        body: safeReview,
        customHeaders: { Accept: 'application/vnd.github+json' },
        signal,
      }
    )
    const value = await boundedGitHubPullRequestResponse(response, signal)
    return validateGitHubPullRequestReviewReceipt(
      value,
      safeOwner,
      safeName,
      safeNumber,
      getHTMLURL(this.endpoint)
    )
  }

  /** Merge one unchanged, ready pull request with an allowlisted method. */
  public async mergePullRequest(
    owner: string,
    name: string,
    pullRequestNumber: number,
    expectedHeadSHA: string,
    method: GitHubPullRequestMergeMethod,
    signal?: AbortSignal
  ): Promise<IGitHubPullRequestMergeReceipt> {
    signal?.throwIfAborted()
    const safeOwner = validateGitHubRepositoryPart(owner, 'owner')
    const safeName = validateGitHubRepositoryPart(name, 'repository')
    const safeNumber = validateGitHubPullRequestNumber(pullRequestNumber)
    const safeHeadSHA = validateGitHubPullRequestHeadSHA(expectedHeadSHA)
    if (!['merge', 'squash', 'rebase'].includes(method)) {
      throw new Error('Choose a supported pull request merge method.')
    }
    const current = await this.inspectPullRequest(
      safeOwner,
      safeName,
      safeNumber,
      signal
    )
    if (current.headSHA !== safeHeadSHA) {
      throw new GitHubPullRequestContextChangedError()
    }
    if (
      current.state !== 'open' ||
      current.merged ||
      current.draft ||
      current.mergeable === false
    ) {
      throw new Error('This pull request is not ready to merge.')
    }
    const response = await this.ghRequest(
      'PUT',
      `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
        safeName
      )}/pulls/${safeNumber}/merge`,
      {
        body: { sha: safeHeadSHA, merge_method: method },
        customHeaders: { Accept: 'application/vnd.github+json' },
        signal,
      }
    )
    return validateGitHubPullRequestMergeReceipt(
      await boundedGitHubPullRequestResponse(response, signal)
    )
  }

  /** Fetch all open pull requests in the given repository. */
  /** Fetch all open pull requests in the given repository. */
  public async fetchAllOpenPullRequests(owner: string, name: string) {
    const url = urlWithQueryString(`repos/${owner}/${name}/pulls`, {
      state: 'open',
    })
    try {
      return await this.fetchAll<IAPIPullRequest>(url)
    } catch (e) {
      log.warn(`failed fetching open PRs for repository ${owner}/${name}`, e)
      throw e
    }
  }

  /**
   * Fetch all pull requests in the given repository that have been
   * updated on or after the provided date.
   *
   * Note: The GitHub API doesn't support providing a last-updated
   * limitation for PRs like it does for issues so we're emulating
   * the issues API by sorting PRs descending by last updated and
   * only grab as many pages as we need to until we no longer receive
   * PRs that have been update more recently than the `since`
   * parameter.
   *
   * If there's more than `maxResults` updated PRs since the last time
   * we fetched this method will throw an error such that we can abort
   * this strategy and commence loading all open PRs instead.
   */
  public async fetchUpdatedPullRequests(
    owner: string,
    name: string,
    since: Date,
    // 320 is chosen because with a ramp-up page size starting with
    // a page size of 10 we'll reach 320 in exactly 7 pages. See
    // getNextPagePathWithIncreasingPageSize
    maxResults = 320
  ) {
    const sinceTime = since.getTime()
    const url = urlWithQueryString(`repos/${owner}/${name}/pulls`, {
      state: 'all',
      sort: 'updated',
      direction: 'desc',
    })

    try {
      const prs = await this.fetchAll<IAPIPullRequest>(url, {
        // We use a page size smaller than our default 100 here because we
        // expect that the majority use case will return much less than
        // 100 results. Given that as long as _any_ PR has changed we'll
        // get the full list back (PRs doesn't support ?since=) we want
        // to keep this number fairly conservative in order to not use
        // up bandwidth needlessly while balancing it such that we don't
        // have to use a lot of requests to update our database. We then
        // ramp up the page size (see getNextPagePathWithIncreasingPageSize)
        // if it turns out there's a lot of updated PRs.
        perPage: 10,
        getNextPagePath: getNextPagePathWithIncreasingPageSize,
        continue(results) {
          if (results.length >= maxResults) {
            throw new MaxResultsError('got max pull requests, aborting')
          }

          // Given that we sort the results in descending order by their
          // updated_at field we can safely say that if the last item
          // is modified after our sinceTime then haven't reached the
          // end of updated PRs.
          const last = results.at(-1)
          return last !== undefined && Date.parse(last.updated_at) > sinceTime
        },
        // We can't ignore errors here as that might mean that we haven't
        // retrieved enough pages to fully capture the changes since the
        // last time we updated. Ignoring errors here would mean that we'd
        // store an incorrect lastUpdated field in the database.
        suppressErrors: false,
      })
      return prs.filter(pr => Date.parse(pr.updated_at) >= sinceTime)
    } catch (e) {
      log.warn(`failed fetching updated PRs for repository ${owner}/${name}`, e)
      throw e
    }
  }

  /**
   * Fetch a single pull request in the given repository
   */
  public async fetchPullRequest(owner: string, name: string, prNumber: string) {
    try {
      const path = `/repos/${owner}/${name}/pulls/${prNumber}`
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIPullRequest>(response)
    } catch (e) {
      log.warn(`failed fetching PR for ${owner}/${name}/pulls/${prNumber}`, e)
      throw e
    }
  }

  /**
   * Fetch a single pull request review in the given repository
   */
  public async fetchPullRequestReview(
    owner: string,
    name: string,
    prNumber: string,
    reviewId: string
  ) {
    try {
      const path = `/repos/${owner}/${name}/pulls/${prNumber}/reviews/${reviewId}`
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIPullRequestReview>(response)
    } catch (e) {
      log.debug(
        `failed fetching PR review ${reviewId} for ${owner}/${name}/pulls/${prNumber}`,
        e
      )
      return null
    }
  }

  /** Fetches all reviews from a given pull request. */
  public async fetchPullRequestReviews(
    owner: string,
    name: string,
    prNumber: string
  ) {
    try {
      const path = `/repos/${owner}/${name}/pulls/${prNumber}/reviews`
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIPullRequestReview[]>(response)
    } catch (e) {
      log.debug(
        `failed fetching PR reviews for ${owner}/${name}/pulls/${prNumber}`,
        e
      )
      return []
    }
  }

  /** Fetches all review comments from a given pull request. */
  public async fetchPullRequestReviewComments(
    owner: string,
    name: string,
    prNumber: string,
    reviewId: string
  ) {
    try {
      const path = `/repos/${owner}/${name}/pulls/${prNumber}/reviews/${reviewId}/comments`
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIComment[]>(response)
    } catch (e) {
      log.debug(
        `failed fetching PR review comments for ${owner}/${name}/pulls/${prNumber}`,
        e
      )
      return []
    }
  }

  /** Fetches all review comments from a given pull request. */
  public async fetchPullRequestComments(
    owner: string,
    name: string,
    prNumber: string
  ) {
    try {
      const path = `/repos/${owner}/${name}/pulls/${prNumber}/comments`
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIComment[]>(response)
    } catch (e) {
      log.debug(
        `failed fetching PR comments for ${owner}/${name}/pulls/${prNumber}`,
        e
      )
      return []
    }
  }

  /** Fetches all comments from a given issue. */
  public async fetchIssueComments(
    owner: string,
    name: string,
    issueNumber: string
  ) {
    try {
      const path = `/repos/${owner}/${name}/issues/${issueNumber}/comments`
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIComment[]>(response)
    } catch (e) {
      log.debug(
        `failed fetching issue comments for ${owner}/${name}/issues/${issueNumber}`,
        e
      )
      return []
    }
  }

  /**
   * Get the combined status for the given ref.
   */
  public async fetchCombinedRefStatus(
    owner: string,
    name: string,
    ref: string,
    reloadCache: boolean = false
  ): Promise<IAPIRefStatus | null> {
    const safeRef = encodeURIComponent(ref)
    const path = `repos/${owner}/${name}/commits/${safeRef}/status?per_page=100`
    const response = await this.ghRequest('GET', path, {
      reloadCache,
    })

    try {
      return await parsedResponse<IAPIRefStatus>(response)
    } catch (err) {
      log.debug(
        `Failed fetching check runs for ref ${ref} (${owner}/${name})`,
        err
      )
      return null
    }
  }

  /**
   * Get any check run results for the given ref.
   */
  public async fetchRefCheckRuns(
    owner: string,
    name: string,
    ref: string,
    reloadCache: boolean = false
  ): Promise<IAPIRefCheckRuns | null> {
    const safeRef = encodeURIComponent(ref)
    const path = `repos/${owner}/${name}/commits/${safeRef}/check-runs?per_page=100`
    const headers = {
      Accept: 'application/vnd.github.antiope-preview+json',
    }

    const response = await this.ghRequest('GET', path, {
      customHeaders: headers,
      reloadCache,
    })

    try {
      return await parsedResponse<IAPIRefCheckRuns>(response)
    } catch (err) {
      log.debug(
        `Failed fetching check runs for ref ${ref} (${owner}/${name})`,
        err
      )
      return null
    }
  }

  /**
   * List workflow runs for a repository filtered by branch and event type of
   * pull_request
   */
  public async fetchPRWorkflowRunsByBranchName(
    owner: string,
    name: string,
    branchName: string
  ): Promise<IAPIWorkflowRuns | null> {
    const path = `repos/${owner}/${name}/actions/runs?event=pull_request&branch=${encodeURIComponent(
      branchName
    )}`
    const customHeaders = {
      Accept: 'application/vnd.github.antiope-preview+json',
    }
    const response = await this.ghRequest('GET', path, { customHeaders })
    try {
      return await parsedResponse<IAPIWorkflowRuns>(response)
    } catch (err) {
      log.debug(
        `Failed fetching workflow runs for ${branchName} (${owner}/${name})`
      )
    }
    return null
  }

  /**
   * Return the workflow run for a given check_suite_id.
   *
   * A check suite is a reference for a set check runs.
   * A workflow run is a reference for set a of workflows for the GitHub Actions
   * check runner.
   *
   * If a check suite is comprised of check runs ran by actions, there will be
   * one workflow run that represents that check suite. Thus, if this api should
   * either return an empty array indicating there are no actions runs for that
   * check_suite_id (so check suite was not ran by actions) or an array with a
   * single element.
   */
  public async fetchPRActionWorkflowRunByCheckSuiteId(
    owner: string,
    name: string,
    checkSuiteId: number
  ): Promise<IAPIWorkflowRun | null> {
    const path = `repos/${owner}/${name}/actions/runs?event=pull_request&check_suite_id=${checkSuiteId}`
    const customHeaders = {
      Accept: 'application/vnd.github.antiope-preview+json',
    }
    const response = await this.ghRequest('GET', path, { customHeaders })
    try {
      const apiWorkflowRuns = await parsedResponse<IAPIWorkflowRuns>(response)

      if (apiWorkflowRuns.workflow_runs.length > 0) {
        return apiWorkflowRuns.workflow_runs[0]
      }
    } catch (err) {
      log.debug(
        `Failed fetching workflow runs for ${checkSuiteId} (${owner}/${name})`
      )
    }
    return null
  }

  /**
   * List workflow run jobs for a given workflow run
   */
  public async fetchWorkflowRunJobs(
    owner: string,
    name: string,
    workflowRunId: number,
    signal?: AbortSignal
  ): Promise<IAPIWorkflowJobs | null> {
    const path = `repos/${owner}/${name}/actions/runs/${workflowRunId}/jobs`
    const customHeaders = {
      Accept: 'application/vnd.github.antiope-preview+json',
    }
    const response = await this.ghRequest('GET', path, {
      customHeaders,
      signal,
    })
    try {
      return await parsedResponse<IAPIWorkflowJobs>(response)
    } catch (err) {
      log.debug(
        `Failed fetching workflow jobs (${owner}/${name}) workflow run: ${workflowRunId}`
      )
    }
    return null
  }

  /** List one bounded page of jobs for the current or an earlier run attempt. */
  public async fetchWorkflowRunJobPage(
    owner: string,
    name: string,
    workflowRunId: number,
    attempt: number | null,
    latestAttempt: number | null,
    page: number = 1,
    signal?: AbortSignal
  ): Promise<IActionsJobList> {
    const runId = validateActionsJobIdentifier(workflowRunId, 'workflow run id')
    const requestedPage = validateActionsJobPage(page)
    if ((attempt === null) !== (latestAttempt === null)) {
      throw new Error('Workflow run attempt context is invalid.')
    }
    if (attempt !== null && latestAttempt !== null) {
      validateActionsJobAttempt(attempt)
      validateActionsJobAttempt(latestAttempt)
      if (attempt > latestAttempt) {
        throw new Error('Workflow run attempt is newer than this run.')
      }
    }

    const path =
      attempt === null || attempt === latestAttempt
        ? `repos/${owner}/${name}/actions/runs/${runId}/jobs?filter=latest&per_page=${ActionsJobPageSize}&page=${requestedPage}`
        : `repos/${owner}/${name}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=${ActionsJobPageSize}&page=${requestedPage}`
    const response = await this.ghRequest('GET', path, { signal })
    return parseActionsJobList(
      await boundedActionsMetadataResponse(response, signal),
      runId,
      attempt,
      requestedPage
    )
  }

  /** Inspect environments awaiting a human deployment review for one run. */
  public async fetchWorkflowRunPendingDeployments(
    owner: string,
    name: string,
    workflowRunId: number,
    signal?: AbortSignal
  ): Promise<ReadonlyArray<IActionsPendingDeployment>> {
    const runId = validateActionsJobIdentifier(workflowRunId, 'workflow run id')
    const response = await this.ghRequest(
      'GET',
      `repos/${owner}/${name}/actions/runs/${runId}/pending_deployments`,
      { signal }
    )
    return parseActionsPendingDeployments(
      await boundedActionsMetadataResponse(response, signal)
    )
  }

  /** Inspect the bounded human-review history for one workflow run. */
  public async fetchWorkflowRunReviewHistory(
    owner: string,
    name: string,
    workflowRunId: number,
    signal?: AbortSignal
  ): Promise<ReadonlyArray<IActionsRunReviewHistory>> {
    const runId = validateActionsJobIdentifier(workflowRunId, 'workflow run id')
    const response = await this.ghRequest(
      'GET',
      `repos/${owner}/${name}/actions/runs/${runId}/approvals`,
      { signal }
    )
    return parseActionsRunReviewHistory(
      await boundedActionsMetadataResponse(response, signal)
    )
  }

  /** Approve or reject exactly the selected pending deployment environments. */
  public async reviewWorkflowRunPendingDeployments(
    owner: string,
    name: string,
    workflowRunId: number,
    environmentIds: ReadonlyArray<number>,
    state: ActionsRunReviewState,
    comment: string
  ): Promise<void> {
    const runId = validateActionsJobIdentifier(workflowRunId, 'workflow run id')
    const body = createActionsRunReviewRequest(environmentIds, state, comment)
    const response = await this.ghRequest(
      'POST',
      `repos/${owner}/${name}/actions/runs/${runId}/pending_deployments`,
      { body }
    )
    await requireSuccessfulActionsMutation(response)
  }

  /** Approve one eligible first-time-contributor fork workflow run. */
  public async approveForkWorkflowRun(
    owner: string,
    name: string,
    workflowRunId: number
  ): Promise<void> {
    const runId = validateActionsJobIdentifier(workflowRunId, 'workflow run id')
    const response = await this.ghRequest(
      'POST',
      `repos/${owner}/${name}/actions/runs/${runId}/approve`
    )
    await requireSuccessfulActionsMutation(response)
  }

  /** List workflows configured for a repository. */
  public async fetchWorkflows(
    owner: string,
    name: string
  ): Promise<IAPIWorkflows> {
    const path = `repos/${owner}/${name}/actions/workflows?per_page=100`
    const response = await this.ghRequest('GET', path)
    return await parsedResponse<IAPIWorkflows>(response)
  }

  /** List recent workflow runs, optionally scoped by workflow/branch/status. */
  public async fetchWorkflowRuns(
    owner: string,
    name: string,
    filter: IAPIWorkflowRunsFilter = {},
    signal?: AbortSignal
  ): Promise<IAPIWorkflowRuns> {
    const path = filter.workflowId
      ? `repos/${owner}/${name}/actions/workflows/${filter.workflowId}/runs`
      : `repos/${owner}/${name}/actions/runs`
    const perPage = filter.perPage ?? ActionsWorkflowRunPageSize
    const page = filter.page ?? 1
    if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) {
      throw new Error('Workflow run page size is invalid.')
    }
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) {
      throw new Error('Workflow run page is invalid.')
    }

    const query = new URLSearchParams()
    query.set('per_page', String(perPage))
    query.set('page', String(page))
    if (filter.branch) {
      query.set('branch', filter.branch)
    }
    if (filter.event) {
      query.set('event', filter.event)
    }
    if (filter.status) {
      query.set('status', filter.status)
    }

    const response = await this.ghRequest('GET', `${path}?${query}`, {
      signal,
    })
    return await parsedResponse<IAPIWorkflowRuns>(response)
  }

  /** Revalidate one exact workflow run before or after a mutation. */
  public async fetchWorkflowRunCancellationState(
    owner: string,
    name: string,
    workflowRunId: number,
    signal?: AbortSignal
  ): Promise<IActionsWorkflowRunCancellationState> {
    const runId = validateActionsJobIdentifier(workflowRunId, 'workflow run id')
    const response = await this.ghRequest(
      'GET',
      `repos/${owner}/${name}/actions/runs/${runId}`,
      { signal }
    )
    return parseActionsWorkflowRunCancellationState(
      await boundedActionsMetadataResponse(response, signal),
      runId
    )
  }

  /** List one bounded page of artifacts produced by one workflow run. */
  public async fetchWorkflowRunArtifacts(
    owner: string,
    name: string,
    workflowRunId: number,
    page: number = 1,
    signal?: AbortSignal
  ): Promise<IActionsArtifactList> {
    const runId = validateActionsArtifactIdentifier(
      workflowRunId,
      'workflow run id'
    )
    const requestedPage = validateActionsArtifactPage(page)
    const path = `repos/${owner}/${name}/actions/runs/${runId}/artifacts?per_page=${ActionsArtifactPageSize}&page=${requestedPage}`
    const response = await this.ghRequest('GET', path, { signal })
    return parseActionsArtifactList(
      await boundedActionsArtifactResponse(response, signal),
      runId,
      requestedPage
    )
  }

  /** List one bounded page of caches for a repository. */
  public async fetchActionsCaches(
    owner: string,
    name: string,
    page: number = 1,
    query?: { readonly key?: string; readonly ref?: string },
    signal?: AbortSignal
  ): Promise<IActionsCacheList> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) {
      throw new Error('Actions cache page is invalid.')
    }
    const params = new URLSearchParams()
    params.set('per_page', String(ActionsCachePageSize))
    params.set('page', String(page))
    if (query?.key) {
      params.set('key', query.key)
    }
    if (query?.ref) {
      params.set('ref', query.ref)
    }
    const path = `repos/${owner}/${name}/actions/caches?${params}`
    const response = await this.ghRequest('GET', path, { signal })
    return parseActionsCacheList(
      await readBoundedActionsJSON(response, signal),
      page
    )
  }

  /** Delete one exact cache by its provider id. */
  public async deleteActionsCache(
    owner: string,
    name: string,
    cacheId: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (!Number.isSafeInteger(cacheId) || cacheId < 1) {
      throw new Error('Actions cache id is invalid.')
    }
    const path = `repos/${owner}/${name}/actions/caches/${cacheId}`
    const response = await this.ghRequest('DELETE', path, { signal })
    if (!response.ok) {
      await parsedResponse<unknown>(response)
    }
  }

  /** Delete all caches matching one exact key, optionally scoped to a ref. */
  public async deleteActionsCachesByKey(
    owner: string,
    name: string,
    key: string,
    ref?: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (typeof key !== 'string' || key.length === 0 || key.length > 512) {
      throw new Error('Actions cache key is invalid.')
    }
    const params = new URLSearchParams()
    params.set('key', key)
    if (ref !== undefined) {
      params.set('ref', ref)
    }
    const path = `repos/${owner}/${name}/actions/caches?${params}`
    const response = await this.ghRequest('DELETE', path, { signal })
    if (!response.ok) {
      await parsedResponse<unknown>(response)
    }
  }

  /** Read bounded repository cache-usage totals. */
  public async fetchActionsCacheUsage(
    owner: string,
    name: string,
    signal?: AbortSignal
  ): Promise<IActionsCacheUsage> {
    const path = `repos/${owner}/${name}/actions/cache/usage`
    const response = await this.ghRequest('GET', path, { signal })
    return parseActionsCacheUsage(
      await readBoundedActionsJSON(response, signal)
    )
  }

  /** Check for a matching attestation record without claiming verification. */
  public async fetchReleases(
    owner: string,
    name: string,
    page: number = 1,
    signal?: AbortSignal
  ): Promise<IGitHubReleaseList> {
    const safeOwner = validateGitHubReleaseRepositoryPart(owner, 'owner')
    const safeName = validateGitHubReleaseRepositoryPart(name, 'repository')
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > GitHubReleaseMaximumPages
    ) {
      throw new Error(
        'The requested release page exceeds the app safety limit.'
      )
    }
    const path = `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
      safeName
    )}/releases?per_page=${GitHubReleasePageSize}&page=${page}`
    const response = await this.ghRequest('GET', path, { signal })
    return parseGitHubReleaseList(
      await boundedGitHubReleaseResponse(response, signal),
      page
    )
  }

  /** Re-fetch one exact release through the bounded JSON parser before mutation. */
  public async fetchRelease(
    owner: string,
    name: string,
    releaseId: number,
    signal?: AbortSignal
  ): Promise<IGitHubRelease> {
    const safeOwner = validateGitHubReleaseRepositoryPart(owner, 'owner')
    const safeName = validateGitHubReleaseRepositoryPart(name, 'repository')
    const safeReleaseId = validateGitHubReleaseIdentifier(releaseId)
    const path = `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
      safeName
    )}/releases/${safeReleaseId}`
    const response = await this.ghRequest('GET', path, { signal })
    return parseGitHubRelease(
      await boundedGitHubReleaseResponse(response, signal),
      safeReleaseId
    )
  }

  /**
   * Look up one release by its exact tag. Resolves to `null` when GitHub
   * reports the tag has no release (404) so callers can treat "find or create"
   * uniformly; every other status still surfaces the typed repository error.
   */
  public async fetchReleaseByTag(
    owner: string,
    name: string,
    tag: string,
    signal?: AbortSignal
  ): Promise<IGitHubRelease | null> {
    const safeOwner = validateGitHubReleaseRepositoryPart(owner, 'owner')
    const safeName = validateGitHubReleaseRepositoryPart(name, 'repository')
    const safeTag = validateGitHubReleaseTag(tag)
    const path = `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
      safeName
    )}/releases/tags/${encodeURIComponent(safeTag)}`
    const response = await this.ghRequest('GET', path, { signal })
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined)
      return null
    }
    return parseGitHubRelease(
      await boundedGitHubReleaseResponse(response, signal)
    )
  }

  /** List one bounded, locally generated page of assets for one release. */
  public async fetchReleaseAssets(
    owner: string,
    name: string,
    releaseId: number,
    page: number = 1,
    signal?: AbortSignal
  ): Promise<IGitHubReleaseAssetList> {
    const safeOwner = validateGitHubReleaseRepositoryPart(owner, 'owner')
    const safeName = validateGitHubReleaseRepositoryPart(name, 'repository')
    const safeReleaseId = validateGitHubReleaseIdentifier(releaseId)
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > GitHubReleaseAssetMaximumPages
    ) {
      throw new Error(
        'The requested release asset page exceeds the app safety limit.'
      )
    }
    const path = `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
      safeName
    )}/releases/${safeReleaseId}/assets?per_page=${GitHubReleaseAssetPageSize}&page=${page}`
    const response = await this.ghRequest('GET', path, { signal })
    return parseGitHubReleaseAssetList(
      await boundedGitHubReleaseResponse(response, signal),
      page
    )
  }

  /** Re-fetch one exact release asset through the bounded parser before deletion. */
  public async fetchReleaseAsset(
    owner: string,
    name: string,
    assetId: number,
    signal?: AbortSignal
  ): Promise<IGitHubReleaseAsset> {
    const safeOwner = validateGitHubReleaseRepositoryPart(owner, 'owner')
    const safeName = validateGitHubReleaseRepositoryPart(name, 'repository')
    const safeAssetId = validateGitHubReleaseIdentifier(assetId, 'asset id')
    const path = `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
      safeName
    )}/releases/assets/${safeAssetId}`
    const response = await this.ghRequest('GET', path, { signal })
    return parseGitHubReleaseAsset(
      await boundedGitHubReleaseResponse(response, signal),
      safeAssetId
    )
  }

  /** Create a reviewed release, either public immediately or as a draft. */
  public async createRelease(
    owner: string,
    name: string,
    draft: IGitHubReleaseDraft,
    publishImmediately: boolean,
    signal?: AbortSignal
  ): Promise<IGitHubRelease> {
    const safeOwner = validateGitHubReleaseRepositoryPart(owner, 'owner')
    const safeName = validateGitHubReleaseRepositoryPart(name, 'repository')
    const safeDraft = normalizeGitHubReleaseDraft(draft)
    const path = `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
      safeName
    )}/releases`
    const response = await this.ghRequest('POST', path, {
      body: {
        tag_name: safeDraft.tagName,
        target_commitish: safeDraft.targetCommitish,
        name: safeDraft.name,
        body: safeDraft.body,
        draft: !publishImmediately,
        prerelease: safeDraft.prerelease,
      },
      customHeaders: { Accept: 'application/vnd.github+json' },
      signal,
    })
    const release = parseGitHubRelease(
      await boundedGitHubReleaseResponse(response, signal)
    )
    if (release.draft === publishImmediately) {
      throw new Error(
        publishImmediately
          ? 'GitHub did not create the release as published.'
          : 'GitHub did not create the release as an unpublished draft.'
      )
    }
    return release
  }

  public createReleaseDraft(
    owner: string,
    name: string,
    draft: IGitHubReleaseDraft,
    signal?: AbortSignal
  ): Promise<IGitHubRelease> {
    return this.createRelease(owner, name, draft, false, signal)
  }

  /** Update reviewed metadata without changing draft publication state. */
  public async updateRelease(
    owner: string,
    name: string,
    update: IGitHubReleaseUpdate,
    signal?: AbortSignal
  ): Promise<IGitHubRelease> {
    const safeOwner = validateGitHubReleaseRepositoryPart(owner, 'owner')
    const safeName = validateGitHubReleaseRepositoryPart(name, 'repository')
    const safeUpdate = normalizeGitHubReleaseUpdate(update)
    const path = `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
      safeName
    )}/releases/${safeUpdate.releaseId}`
    const response = await this.ghRequest('PATCH', path, {
      body: {
        tag_name: safeUpdate.tagName,
        target_commitish: safeUpdate.targetCommitish,
        name: safeUpdate.name,
        body: safeUpdate.body,
        prerelease: safeUpdate.prerelease,
      },
      customHeaders: { Accept: 'application/vnd.github+json' },
      signal,
    })
    return parseGitHubRelease(
      await boundedGitHubReleaseResponse(response, signal),
      safeUpdate.releaseId
    )
  }

  /** Publish one exact draft after the renderer's explicit review step. */
  public async publishRelease(
    owner: string,
    name: string,
    releaseId: number,
    signal?: AbortSignal
  ): Promise<IGitHubRelease> {
    const safeOwner = validateGitHubReleaseRepositoryPart(owner, 'owner')
    const safeName = validateGitHubReleaseRepositoryPart(name, 'repository')
    const safeReleaseId = validateGitHubReleaseIdentifier(releaseId)
    const path = `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
      safeName
    )}/releases/${safeReleaseId}`
    const response = await this.ghRequest('PATCH', path, {
      body: { draft: false },
      customHeaders: { Accept: 'application/vnd.github+json' },
      signal,
    })
    const release = parseGitHubRelease(
      await boundedGitHubReleaseResponse(response, signal),
      safeReleaseId
    )
    if (release.draft) {
      throw new Error('GitHub did not publish the reviewed release draft.')
    }
    return release
  }

  /** Delete one exact release. Callers must provide the reviewed identifier. */
  public async deleteRelease(
    owner: string,
    name: string,
    releaseId: number,
    signal?: AbortSignal
  ): Promise<void> {
    const safeOwner = validateGitHubReleaseRepositoryPart(owner, 'owner')
    const safeName = validateGitHubReleaseRepositoryPart(name, 'repository')
    const safeReleaseId = validateGitHubReleaseIdentifier(releaseId)
    const response = await this.ghRequest(
      'DELETE',
      `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
        safeName
      )}/releases/${safeReleaseId}`,
      { customHeaders: { Accept: 'application/vnd.github+json' }, signal }
    )
    if (!response.ok) {
      await parsedResponse<unknown>(response)
    }
  }

  /** Delete one exact release asset. */
  public async deleteReleaseAsset(
    owner: string,
    name: string,
    assetId: number,
    signal?: AbortSignal
  ): Promise<void> {
    const safeOwner = validateGitHubReleaseRepositoryPart(owner, 'owner')
    const safeName = validateGitHubReleaseRepositoryPart(name, 'repository')
    const safeAssetId = validateGitHubReleaseIdentifier(assetId, 'asset id')
    const response = await this.ghRequest(
      'DELETE',
      `repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(
        safeName
      )}/releases/assets/${safeAssetId}`,
      { customHeaders: { Accept: 'application/vnd.github+json' }, signal }
    )
    if (!response.ok) {
      await parsedResponse<unknown>(response)
    }
  }

  /**
   * Inspect active rules that GitHub evaluates for one exact branch. Pages are
   * generated locally from the account-bound provider path and never followed
   * from a provider-supplied pagination URL.
   */
  public async fetchEffectiveBranchRules(
    owner: string,
    name: string,
    branch: string,
    signal?: AbortSignal
  ): Promise<IActionsBranchRuleList> {
    const safeOwner = validateGitHubRepositoryPart(owner, 'owner')
    const safeName = validateGitHubRepositoryPart(name, 'repository')
    const safeBranch = validateActionsBranchName(branch)
    const rules = new Array<IActionsBranchRuleList['rules'][number]>()

    for (let page = 1; page <= ActionsBranchRuleMaximumPages; page++) {
      const path = `repos/${safeOwner}/${safeName}/rules/branches/${encodeURIComponent(
        safeBranch
      )}?per_page=${ActionsBranchRulePageSize}&page=${page}`
      const response = await this.ghRequest('GET', path, { signal })
      const hasNextPage = getNextPagePathFromLink(response) !== null
      rules.push(
        ...parseActionsBranchRulePage(
          await boundedActionsArtifactResponse(response, signal)
        )
      )

      if (!hasNextPage) {
        return { branch: safeBranch, rules, capped: false }
      }
      if (page === ActionsBranchRuleMaximumPages) {
        return { branch: safeBranch, rules, capped: true }
      }
    }

    return { branch: safeBranch, rules, capped: false }
  }

  /**
   * Fetch an artifact archive without forwarding the account token to the
   * short-lived storage redirect.
   */
  public async fetchWorkflowArtifactArchive(
    owner: string,
    name: string,
    artifactId: number,
    signal?: AbortSignal,
    redirectDependencies?: IActionsArtifactRedirectDependencies
  ): Promise<Response> {
    const safeOwner = validateGitHubRepositoryPart(owner, 'owner')
    const safeName = validateGitHubRepositoryPart(name, 'repository')
    const id = validateActionsArtifactIdentifier(artifactId, 'artifact id')
    const response = await this.ghRequest(
      'GET',
      `repos/${safeOwner}/${safeName}/actions/artifacts/${id}/zip`,
      { redirect: 'manual', signal }
    )

    if (response.status < 300 || response.status >= 400) {
      if (response.status === 410) {
        await response.body?.cancel().catch(() => undefined)
        throw new APIError(response, {
          message: 'This artifact has expired and can no longer be downloaded.',
        })
      }
      if (!response.ok) {
        await parsedResponse<unknown>(response)
      }
      return response
    }

    const location = response.headers.get('Location')
    await response.body?.cancel().catch(() => undefined)
    if (location === null) {
      throw new Error('GitHub did not provide an artifact download URL.')
    }
    const accountEndpoint = new URL.URL(this.endpoint)
    const archive = await fetchActionsArtifactRedirect({
      location,
      githubDotCom: accountEndpoint.hostname === 'api.github.com',
      signal,
      dependencies: redirectDependencies,
    })
    if (!archive.ok) {
      await archive.body?.cancel().catch(() => undefined)
      throw new APIError(archive, null)
    }
    return archive
  }

  /** Check for a matching attestation record without claiming verification. */
  public async fetchArtifactAttestationPresence(
    owner: string,
    name: string,
    digest: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (!isSupportedActionsArtifactDigest(digest)) {
      throw new Error('Artifact attestation lookup requires a SHA-256 digest.')
    }
    const subject = encodeURIComponent(digest.toLowerCase())
    const response = await this.ghRequest(
      'GET',
      `repos/${owner}/${name}/attestations/${subject}?per_page=1`,
      { signal }
    )
    return parseActionsArtifactAttestationPresence(
      await boundedActionsArtifactResponse(response, signal)
    )
  }

  /**
   * Fetch only bounded canonical Sigstore bundles for internal verification.
   * Provider wrapper metadata is discarded before this method returns.
   */
  public async fetchArtifactAttestationBundles(
    owner: string,
    name: string,
    digest: string,
    signal?: AbortSignal
  ): Promise<IActionsArtifactAttestationBundleSet> {
    if (!isSupportedActionsArtifactDigest(digest)) {
      throw new Error('Artifact attestation lookup requires a SHA-256 digest.')
    }
    const subject = encodeURIComponent(digest.toLowerCase())
    const predicate = encodeURIComponent(ActionsArtifactProvenancePredicate)
    const response = await this.ghRequest(
      'GET',
      `repos/${owner}/${name}/attestations/${subject}?per_page=${ActionsArtifactAttestationProbePageSize}&predicate_type=${predicate}`,
      { signal }
    )
    return parseActionsArtifactAttestationBundles(
      await boundedActionsArtifactResponse(
        response,
        signal,
        ActionsArtifactAttestationMaximumBytes
      )
    )
  }

  /** Fetch the authoritative repository identity and visibility. */
  public async fetchArtifactProvenanceRepositoryMetadata(
    rawOwner: string,
    rawName: string,
    signal?: AbortSignal
  ): Promise<IActionsArtifactProvenanceRepositoryMetadata> {
    const owner = validateGitHubRepositoryPart(rawOwner, 'owner')
    const name = validateGitHubRepositoryPart(rawName, 'repository')
    if (owner.length > 100 || name.length > 100) {
      throw new Error('The artifact provenance repository is invalid.')
    }
    const response = await this.ghRequest('GET', `repos/${owner}/${name}`, {
      signal,
    })
    const repository = parseActionsArtifactProvenanceRepositoryMetadata(
      await boundedActionsMetadataResponse(response, signal)
    )
    if (repository.full_name !== `${owner}/${name}`) {
      throw new Error('GitHub returned a different artifact repository.')
    }
    return repository
  }

  /** Fetch one exact workflow-run attempt without falling back to latest. */
  public async fetchArtifactProvenanceRunAttemptMetadata(
    rawOwner: string,
    rawName: string,
    rawRunId: number,
    rawRunAttempt: number,
    signal?: AbortSignal
  ): Promise<IActionsArtifactProvenanceRunAttemptMetadata> {
    const owner = validateGitHubRepositoryPart(rawOwner, 'owner')
    const name = validateGitHubRepositoryPart(rawName, 'repository')
    if (owner.length > 100 || name.length > 100) {
      throw new Error('The artifact provenance repository is invalid.')
    }
    const runId = validateActionsArtifactIdentifier(rawRunId, 'workflow run id')
    const runAttempt = validateActionsArtifactIdentifier(
      rawRunAttempt,
      'workflow run attempt'
    )
    const response = await this.ghRequest(
      'GET',
      `repos/${owner}/${name}/actions/runs/${runId}/attempts/${runAttempt}?exclude_pull_requests=true`,
      { signal }
    )
    const attempt = parseActionsArtifactProvenanceRunAttemptMetadata(
      await boundedActionsMetadataResponse(response, signal)
    )
    if (attempt.id !== runId || attempt.run_attempt !== runAttempt) {
      throw new Error('GitHub returned a different workflow run attempt.')
    }
    return attempt
  }

  /** Fetch one exact branch or tag ref; only this endpoint maps 404 to null. */
  public async fetchArtifactProvenanceGitRef(
    rawOwner: string,
    rawName: string,
    namespace: ActionsArtifactProvenanceRefNamespace,
    rawRefName: string,
    signal?: AbortSignal
  ): Promise<IActionsArtifactProvenanceGitRef | null> {
    const owner = validateGitHubRepositoryPart(rawOwner, 'owner')
    const name = validateGitHubRepositoryPart(rawName, 'repository')
    if (owner.length > 100 || name.length > 100) {
      throw new Error('The artifact provenance repository is invalid.')
    }
    if (namespace !== 'heads' && namespace !== 'tags') {
      throw new Error('The artifact provenance ref namespace is invalid.')
    }
    const refName = normalizeActionsArtifactSourceRefName(rawRefName)
    const expectedRef = `refs/${namespace}/${refName}`
    const encodedRef = encodeURIComponent(`${namespace}/${refName}`)
    const response = await this.ghRequest(
      'GET',
      `repos/${owner}/${name}/git/ref/${encodedRef}`,
      { signal }
    )
    let value: unknown
    try {
      value = await boundedActionsMetadataResponse(response, signal)
    } catch (error) {
      if (error instanceof APIError && error.responseStatus === 404) {
        return null
      }
      throw error
    }
    const gitRef = parseActionsArtifactProvenanceGitRef(value)
    if (gitRef.ref !== expectedRef) {
      throw new Error('GitHub returned a different artifact provenance ref.')
    }
    return gitRef
  }

  /** Fetch one exact annotated-tag object in a validated tag chain. */
  public async fetchArtifactProvenanceAnnotatedTag(
    rawOwner: string,
    rawName: string,
    rawSHA: string,
    signal?: AbortSignal
  ): Promise<IActionsArtifactProvenanceAnnotatedTag> {
    const owner = validateGitHubRepositoryPart(rawOwner, 'owner')
    const name = validateGitHubRepositoryPart(rawName, 'repository')
    if (owner.length > 100 || name.length > 100) {
      throw new Error('The artifact provenance repository is invalid.')
    }
    const sha = normalizeActionsArtifactGitObjectId(rawSHA)
    const response = await this.ghRequest(
      'GET',
      `repos/${owner}/${name}/git/tags/${sha}`,
      { signal }
    )
    const tag = parseActionsArtifactProvenanceAnnotatedTag(
      await boundedActionsMetadataResponse(response, signal)
    )
    if (tag.sha !== sha) {
      throw new Error('GitHub returned a different annotated tag object.')
    }
    return tag
  }

  /** Resolve one unambiguous full source ref through this exact API instance. */
  public async resolveArtifactProvenanceSourceRef(
    owner: string,
    name: string,
    attempt: IActionsArtifactProvenanceRunAttemptMetadata,
    signal?: AbortSignal
  ): Promise<string | null> {
    return resolveActionsArtifactProvenanceSourceRef(
      attempt,
      {
        getRef: (namespace, refName, refSignal) =>
          this.fetchArtifactProvenanceGitRef(
            owner,
            name,
            namespace,
            refName,
            refSignal
          ),
        getAnnotatedTag: (sha, tagSignal) =>
          this.fetchArtifactProvenanceAnnotatedTag(owner, name, sha, tagSignal),
      },
      signal
    )
  }

  /** Re-run every job in a workflow run. */
  public async rerunWorkflowRun(
    owner: string,
    name: string,
    workflowRunId: number
  ): Promise<void> {
    const path = `repos/${owner}/${name}/actions/runs/${workflowRunId}/rerun`
    const response = await this.ghRequest('POST', path)
    if (!response.ok) {
      await parsedResponse<unknown>(response)
    }
  }

  /** Cancel a workflow run, optionally bypassing normal cancellation hooks. */
  public async cancelWorkflowRun(
    owner: string,
    name: string,
    workflowRunId: number,
    force: boolean = false,
    signal?: AbortSignal
  ): Promise<boolean> {
    const runId = validateActionsJobIdentifier(workflowRunId, 'workflow run id')
    const action = force ? 'force-cancel' : 'cancel'
    const path = `repos/${owner}/${name}/actions/runs/${runId}/${action}`
    const response = await this.ghRequest('POST', path, { signal })
    await requireSuccessfulActionsMutation(response, signal)
    return response.status === 202
  }

  /** Enable or disable a repository workflow. */
  public async setWorkflowEnabled(
    owner: string,
    name: string,
    workflowId: number,
    enabled: boolean
  ): Promise<void> {
    const action = enabled ? 'enable' : 'disable'
    const path = `repos/${owner}/${name}/actions/workflows/${workflowId}/${action}`
    const response = await this.ghRequest('PUT', path)
    if (!response.ok) {
      await parsedResponse<unknown>(response)
    }
  }

  /** Dispatch a workflow supporting the workflow_dispatch event. */
  public async dispatchWorkflow(
    owner: string,
    name: string,
    workflowId: number,
    ref: string,
    inputs: Readonly<Record<string, string>> = {}
  ): Promise<void> {
    const path = `repos/${owner}/${name}/actions/workflows/${workflowId}/dispatches`
    const response = await this.ghRequest('POST', path, {
      body: { ref, inputs },
    })
    if (!response.ok) {
      await parsedResponse<unknown>(response)
    }
  }

  /**
   * The classic OAuth scopes GitHub reports as granted for this token, from
   * the X-OAuth-Scopes response header. Null when the endpoint does not
   * report scopes (e.g. fine-grained tokens or non-GitHub providers).
   */
  public async fetchGrantedOAuthScopes(): Promise<string | null> {
    const response = await this.ghRequest('GET', 'user')
    if (!response.ok) {
      await parsedResponse<unknown>(response)
    }
    return response.headers.get('x-oauth-scopes')
  }

  /** Fetch a workflow YAML file as raw text. */
  public async fetchWorkflowFileContent(
    owner: string,
    name: string,
    path: string,
    ref?: string,
    signal?: AbortSignal
  ): Promise<string> {
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''
    const response = await this.ghRequest(
      'GET',
      `repos/${owner}/${name}/contents/${path}${query}`,
      {
        customHeaders: { Accept: 'application/vnd.github.raw+json' },
        signal,
      }
    )
    if (!response.ok) {
      await parsedResponse<unknown>(response)
    }
    return await response.text()
  }

  /**
   * Triggers GitHub to rerequest an existing check suite, without pushing new
   * code to a repository.
   */
  public async rerequestCheckSuite(
    owner: string,
    name: string,
    checkSuiteId: number
  ): Promise<boolean> {
    const path = `/repos/${owner}/${name}/check-suites/${checkSuiteId}/rerequest`

    return this.ghRequest('POST', path)
      .then(x => x.ok)
      .catch(err => {
        log.debug(
          `Failed retry check suite id ${checkSuiteId} (${owner}/${name})`,
          err
        )
        return false
      })
  }

  /**
   * Re-run all of the failed jobs and their dependent jobs in a workflow run
   * using the id of the workflow run.
   */
  public async rerunFailedJobs(
    owner: string,
    name: string,
    workflowRunId: number
  ): Promise<boolean> {
    const path = `/repos/${owner}/${name}/actions/runs/${workflowRunId}/rerun-failed-jobs`

    return this.ghRequest('POST', path)
      .then(x => x.ok)
      .catch(err => {
        log.debug(
          `Failed to rerun failed workflow jobs for (${owner}/${name}): ${workflowRunId}`,
          err
        )
        return false
      })
  }

  /**
   * Re-run a job and its dependent jobs in a workflow run.
   */
  public async rerunJob(
    owner: string,
    name: string,
    jobId: number
  ): Promise<boolean> {
    const path = `/repos/${owner}/${name}/actions/jobs/${jobId}/rerun`

    return this.ghRequest('POST', path)
      .then(x => x.ok)
      .catch(err => {
        log.debug(
          `Failed to rerun workflow job (${owner}/${name}): ${jobId}`,
          err
        )
        return false
      })
  }

  /** Re-run one exact job while preserving permission-aware API failures. */
  public async rerunWorkflowJob(
    owner: string,
    name: string,
    jobId: number
  ): Promise<void> {
    const id = validateActionsJobIdentifier(jobId, 'workflow job id')
    const response = await this.ghRequest(
      'POST',
      `/repos/${owner}/${name}/actions/jobs/${id}/rerun`
    )
    await requireSuccessfulActionsMutation(response)
  }

  public async getAvatarToken() {
    return this.ghRequest('GET', `/desktop/avatar-token`)
      .then(x => x.json())
      .then((x: unknown) =>
        x &&
        typeof x === 'object' &&
        'avatar_token' in x &&
        typeof x.avatar_token === 'string'
          ? x.avatar_token
          : null
      )
      .catch(err => {
        log.debug(`Failed to load avatar token`, err)
        return null
      })
  }

  /**
   * Gets a single check suite using its id
   */
  public async fetchCheckSuite(
    owner: string,
    name: string,
    checkSuiteId: number
  ): Promise<IAPICheckSuite | null> {
    const path = `/repos/${owner}/${name}/check-suites/${checkSuiteId}`
    const response = await this.ghRequest('GET', path)

    try {
      return await parsedResponse<IAPICheckSuite>(response)
    } catch (_) {
      log.debug(
        `[fetchCheckSuite] Failed fetch check suite id ${checkSuiteId} (${owner}/${name})`
      )
    }

    return null
  }

  /** Fetch live metadata for one exact repository without legacy fallbacks. */
  public async fetchBranchRulesRepository(
    owner: string,
    name: string,
    options: IStrictBranchRulesAPIRequestOptions
  ): Promise<IAPIFullRepository> {
    const response = await this.ghRequest('GET', `repos/${owner}/${name}`, {
      signal: options.signal,
      reloadCache: options.reloadCache,
    })
    return await parsedResponse<IAPIFullRepository>(response)
  }

  /** Fetch the repository's summary for one exact branch. */
  public async fetchBranch(
    owner: string,
    name: string,
    branch: string,
    options: IBranchRulesAPIRequestOptions = {}
  ): Promise<IAPIBranch> {
    const path = `repos/${owner}/${name}/branches/${encodeURIComponent(branch)}`
    const response = await this.ghRequest('GET', path, {
      signal: options.signal,
      reloadCache: options.reloadCache,
    })
    return await parsedResponse<IAPIBranch>(response)
  }

  /** Fetch the detailed classic protection configured for an exact branch. */
  public async fetchBranchProtection(
    owner: string,
    name: string,
    branch: string,
    options: IBranchRulesAPIRequestOptions = {}
  ): Promise<IAPIBranchProtection> {
    const path = `repos/${owner}/${name}/branches/${encodeURIComponent(
      branch
    )}/protection`
    const response = await this.ghRequest('GET', path, {
      signal: options.signal,
      reloadCache: options.reloadCache,
    })
    return await parsedResponse<IAPIBranchProtection>(response)
  }

  /**
   * Get branch protection info to determine if a user can push to a given branch.
   *
   * Note: if request fails, the default returned value assumes full access for the user
   */
  public async fetchPushControl(
    owner: string,
    name: string,
    branch: string,
    options: IBranchRulesAPIRequestOptions = {}
  ): Promise<IAPIPushControl> {
    const path = `repos/${owner}/${name}/branches/${encodeURIComponent(
      branch
    )}/push_control`

    const headers: any = {
      Accept: 'application/vnd.github.phandalin-preview',
    }

    try {
      const response = await this.ghRequest('GET', path, {
        customHeaders: headers,
        signal: options.signal,
        reloadCache: options.reloadCache,
      })
      return await parsedResponse<IAPIPushControl>(response)
    } catch (err) {
      if (options.strict) {
        throw err
      }

      log.info(
        `[fetchPushControl] unable to check if branch is potentially pushable`,
        err
      )
      return {
        pattern: null,
        required_signatures: false,
        required_status_checks: [],
        required_approving_review_count: 0,
        required_linear_history: false,
        allow_actor: true,
        allow_deletions: true,
        allow_force_pushes: true,
      }
    }
  }

  public async fetchProtectedBranches(
    owner: string,
    name: string
  ): Promise<ReadonlyArray<IAPIBranch>> {
    const path = `repos/${owner}/${name}/branches?protected=true`
    try {
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<IAPIBranch[]>(response)
    } catch (err) {
      log.info(
        `[fetchProtectedBranches] unable to list protected branches`,
        err
      )
      return new Array<IAPIBranch>()
    }
  }

  /**
   * Fetches all repository rules that apply to the provided branch.
   */
  public async fetchRepoRulesForBranch(
    owner: string,
    name: string,
    branch: string,
    options: IStrictBranchRulesAPIRequestOptions
  ): Promise<IAPIRepoRulesForBranchResult>
  public async fetchRepoRulesForBranch(
    owner: string,
    name: string,
    branch: string,
    options: IBranchRulesAPIRequestOptions & { readonly strict?: false }
  ): Promise<ReadonlyArray<IAPIRepoRule>>
  public async fetchRepoRulesForBranch(
    owner: string,
    name: string,
    branch: string
  ): Promise<ReadonlyArray<IAPIRepoRule>>
  public async fetchRepoRulesForBranch(
    owner: string,
    name: string,
    branch: string,
    options?: IBranchRulesAPIRequestOptions
  ): Promise<ReadonlyArray<IAPIRepoRule> | IAPIRepoRulesForBranchResult> {
    const path = `repos/${owner}/${name}/rules/branches/${encodeURIComponent(
      branch
    )}`

    if (options?.strict) {
      let lastResponseHadNextPage = false
      let ambiguousPagination = false
      let pagesFetched = 0
      const fetchedRules = await this.fetchAll<IAPIRepoRule>(path, {
        perPage: 100,
        suppressErrors: false,
        requireArrayPage: true,
        signal: options.signal,
        reloadCache: options.reloadCache,
        continue: results =>
          results.length < MaximumEffectiveBranchRules &&
          pagesFetched < MaximumEffectiveBranchRulePages,
        onResponse: () => pagesFetched++,
        getNextPagePath: response => {
          const nextPath = getNextPagePathFromLink(response, this.endpoint)
          const link = response.headers.get('Link')
          const parsedLink = link === null ? null : splitLinkHeaderValues(link)
          const claimsNextPage =
            parsedLink !== null &&
            parsedLink.values.some(part => linkPartHasRelation(part, 'next'))
          const malformedRelations =
            parsedLink !== null &&
            (!parsedLink.structurallyValid ||
              parsedLink.values.some(linkPartHasMalformedRelation))

          lastResponseHadNextPage = nextPath !== null
          if (malformedRelations || (claimsNextPage && nextPath === null)) {
            ambiguousPagination = true
          }

          return nextPath
        },
      })
      const exceededSafetyCap =
        fetchedRules.length > MaximumEffectiveBranchRules

      return {
        rules: fetchedRules.slice(0, MaximumEffectiveBranchRules),
        complete:
          !exceededSafetyCap &&
          !lastResponseHadNextPage &&
          !ambiguousPagination,
      }
    }

    try {
      const response = await this.ghRequest('GET', path, {
        signal: options?.signal,
        reloadCache: options?.reloadCache,
      })
      return await parsedResponse<IAPIRepoRule[]>(response)
    } catch (err) {
      // If the repository isn't owned by the current user there's no way for us
      // to preemptively check whether rulesets are enabled so we give it a shot
      // but there's no need to log if it fails. Same with 404s, i.e the user
      // doesn't have access to the repo any more or it's been deleted.
      if (!isRulesetsNotEnabledError(err) && !isNotFoundApiError(err)) {
        log.info(
          `[fetchRepoRulesForBranch] unable to fetch repo rules for branch: ${branch} | ${path}`,
          err
        )
      }
      return new Array<IAPIRepoRule>()
    }
  }

  /**
   * Fetches slim versions of all repo rulesets for the given repository. Utilize the cache
   * in IAppState instead of querying this if possible.
   */
  public async fetchAllRepoRulesets(
    owner: string,
    name: string
  ): Promise<ReadonlyArray<IAPISlimRepoRuleset> | null> {
    const path = `repos/${owner}/${name}/rulesets`
    try {
      const response = await this.ghRequest('GET', path)
      return await parsedResponse<ReadonlyArray<IAPISlimRepoRuleset>>(response)
    } catch (err) {
      // If the repository isn't owned by the current user there's no way for us
      // to preemptively check whether rulesets are enabled so we give it a shot
      // but there's no need to log if it fails. Same with 404s, i.e the user
      // doesn't have access to the repo any more or it's been deleted.
      if (!isRulesetsNotEnabledError(err) && !isNotFoundApiError(err)) {
        log.info(
          `[fetchAllRepoRulesets] unable to fetch all repo rulesets | ${path}`,
          err
        )
      }
      return null
    }
  }

  /**
   * Fetches the repo ruleset with the given ID. Utilize the cache in IAppState
   * instead of querying this if possible.
   */
  public async fetchRepoRuleset(
    owner: string,
    name: string,
    id: number,
    options: IBranchRulesAPIRequestOptions = {}
  ): Promise<IAPIRepoRuleset | null> {
    const path = `repos/${owner}/${name}/rulesets/${id}`
    try {
      const response = await this.ghRequest('GET', path, {
        signal: options.signal,
        reloadCache: options.reloadCache,
      })
      return await parsedResponse<IAPIRepoRuleset>(response)
    } catch (err) {
      if (options.strict) {
        throw err
      }

      log.info(
        `[fetchRepoRuleset] unable to fetch repo ruleset for ID: ${id} | ${path}`,
        err
      )
      return null
    }
  }

  /**
   * Authenticated requests to a paginating resource such as issues.
   *
   * Follows the GitHub API hypermedia links to get the subsequent
   * pages when available, buffers all items and returns them in
   * one array when done.
   */
  private async fetchAll<T>(path: string, options?: IFetchAllOptions<T>) {
    const buf = new Array<T>()
    const opts: IFetchAllOptions<T> = { perPage: 100, ...options }
    const params = { per_page: `${opts.perPage}` }

    let nextPath: string | null = urlWithQueryString(path, params)
    let page: ReadonlyArray<T> = []
    do {
      const response: Response = await this.ghRequest('GET', nextPath, {
        signal: opts.signal,
        reloadCache: opts.reloadCache,
      })
      opts.onResponse?.(response)
      if (opts.suppressErrors !== false && !response.ok) {
        log.warn(`fetchAll: '${path}' returned a ${response.status}`)
        return buf
      }

      const parsedPage: unknown = await parsedResponse<unknown>(response)
      if (opts.requireArrayPage && !Array.isArray(parsedPage)) {
        throw new Error('Expected a paginated API response to be an array.')
      }
      page = parsedPage as ReadonlyArray<T>
      if (page) {
        buf.push(...page)
        opts.onPage?.(page)
      }

      nextPath = opts.getNextPagePath
        ? opts.getNextPagePath(response)
        : getNextPagePathFromLink(response)
    } while (nextPath && (!opts.continue || (await opts.continue(buf))))

    return buf
  }

  /** Make an authenticated request to the client's endpoint with its token. */
  private async request(
    endpoint: string,
    method: HTTPMethod,
    path: string,
    options: {
      body?: Object
      customHeaders?: HeadersInit
      reloadCache?: boolean
      redirect?: RequestRedirect
      signal?: AbortSignal
    } = {}
  ): Promise<Response> {
    return await request(
      endpoint,
      this.token,
      method,
      path,
      options.body,
      options.customHeaders,
      options.reloadCache,
      options.redirect,
      options.signal
    )
  }

  /**
   * Make an authenticated request to the client's endpoint with its token.
   * Used for GitHub API requests.
   */
  private async ghRequest(
    method: HTTPMethod,
    path: string,
    options: {
      body?: Object
      customHeaders?: HeadersInit
      reloadCache?: boolean
      redirect?: RequestRedirect
      signal?: AbortSignal
    } = {}
  ): Promise<Response> {
    const response = await this.request(this.endpoint, method, path, {
      ...options,
      customHeaders: createGitHubAPIRequestHeaders(
        this.endpoint,
        path,
        options.customHeaders
      ),
    })

    // Only consider invalid token when the status is 401 and the response has
    // the X-GitHub-Request-Id header, meaning it comes from GH(E) and not from
    // any kind of proxy/gateway. For more info see #12943
    // We're also not considering a token has been invalidated when the reason
    // behind a 401 is the fact that any kind of 2 factor auth is required.
    if (
      response.status === HttpStatusCode.Unauthorized &&
      response.headers.has('X-GitHub-Request-Id') &&
      !response.headers.has('X-GitHub-OTP')
    ) {
      API.emitTokenInvalidated(this.endpoint, this.token)
    }

    tryUpdateEndpointVersionFromResponse(this.endpoint, response)

    return response
  }

  /**
   * Make an authenticated request to the client's Copilot endpoint with its
   * token. Used for Copilot API requests.
   */
  private async copilotRequest(
    path: string,
    message: string
  ): Promise<CopilotChatCompletionResponse> {
    if (!this.copilotEndpoint) {
      throw new Error('No Copilot endpoint available')
    }

    const response = await this.request(this.copilotEndpoint, 'POST', path, {
      body: {
        messages: [
          {
            role: 'user',
            content: message,
          },
        ],
        stream: false,
        response_format: {
          type: 'json_object',
        },
      },
      customHeaders: {
        'X-Initiator': 'user',
        'X-Interaction-ID': crypto.randomUUID(),
        'X-Interaction-Type': 'generateCommitMessage',
      },
    })

    if (response.status === HttpStatusCode.TooManyRequests) {
      const retryAfter = response.headers.get('Retry-After')
      if (retryAfter) {
        throw new CopilotError(
          `Rate limited, retry after ${retryAfter} seconds.`,
          response.status
        )
      } else {
        throw new CopilotError(
          'Rate limited, try again in a few minutes.',
          response.status
        )
      }
    } else if (response.status === HttpStatusCode.PaymentRequired) {
      throw parseCopilotPaymentRequiredError(
        await response.text(),
        response.headers.get('Retry-After')
      )
    } else if (response.status === HttpStatusCode.Unauthorized) {
      throw new CopilotError(
        'Unauthorized: error with authentication.',
        response.status
      )
    } else if (response.status === HttpStatusCode.Forbidden) {
      const body = await response.text()
      if (body.includes('unauthorized: not licensed to use Copilot')) {
        throw new CopilotError(
          'Unauthorized: not licensed to use Copilot.',
          response.status
        )
      } else if (
        body.includes(
          'unauthorized: not authorized to use this Copilot feature'
        )
      ) {
        throw new CopilotError(
          'Unauthorized: not authorized to use this Copilot feature.',
          response.status
        )
      } else if (
        body.includes('integration does not have GitHub chat enabled')
      ) {
        throw new CopilotError(
          'Integration does not have GitHub chat enabled.',
          response.status
        )
      } else {
        throw new CopilotError('Unauthorized: unknown.', response.status)
      }
    } else if (response.status === 466) {
      throw new CopilotError(
        'Client issue: unsupported API version.',
        response.status
      )
    } else if (response.status >= HttpStatusCode.BadRequest) {
      const internalError = `Internal server error, code: ${
        response.status
      }, request ID: ${response.headers.get('X-Github-Request-Id')}.`
      console.error(
        `Copilot request failed with status ${response.status}: ${internalError}`
      )
      throw new CopilotError(
        'Something went wrong. Please, try again later.',
        response.status
      )
    }

    const text = await response.text()

    // Responses include multiple lines starting with "data: " followed by
    // a JSON object. We're only interested in the JSON object of the first line.
    const lines = text.split('\n')
    const DataLinePrefix = 'data: '

    for (const line of lines) {
      if (line.startsWith(DataLinePrefix)) {
        const json = JSON.parse(line.substring(DataLinePrefix.length))
        return json as CopilotChatCompletionResponse
      }
    }

    throw new Error('No data line found in response')
  }

  /**
   * Leverages Copilot to generate the commit details (title and description)
   * for a given diff.
   *
   * @param diff Diff of changes to be committed, in git format
   * @returns Commit details (title and description) generated by Copilot
   */
  public async getDiffChangesCommitMessage(
    diff: string
  ): Promise<ICopilotCommitMessage> {
    try {
      const response = await this.copilotRequest(
        '/agents/github-desktop-commit-message-generation',
        diff
      )

      const choice = response.choices.at(0)

      if (!choice) {
        throw new Error('No choice found in response')
      }

      const message = choice.message.content
      if (!message) {
        throw new Error('No message found in response')
      }

      return parseCopilotCommitMessage(message)
    } catch (e) {
      log.warn(
        `getDiffChangesCommitMessage: failed with endpoint ${this.endpoint}`,
        e
      )
      throw e
    }
  }

  /**
   * Get the allowed poll interval for fetching. If an error occurs it will
   * return null.
   */
  public async getFetchPollInterval(
    owner: string,
    name: string
  ): Promise<number | null> {
    const path = `repos/${owner}/${name}/git`
    try {
      const response = await this.ghRequest('HEAD', path)
      const interval = response.headers.get('x-poll-interval')
      if (interval) {
        const parsed = parseInt(interval, 10)
        return isNaN(parsed) ? null : parsed
      }
      return null
    } catch (e) {
      log.warn(`getFetchPollInterval: failed for ${owner}/${name}`, e)
      return null
    }
  }

  /** Fetch the mentionable users for the repository. */
  public async fetchMentionables(
    owner: string,
    name: string,
    etag: string | undefined
  ): Promise<IAPIMentionablesResponse | null> {
    // NB: this custom `Accept` is required for the `mentionables` endpoint.
    const headers: any = {
      Accept: 'application/vnd.github.jerry-maguire-preview',
    }

    if (etag !== undefined) {
      headers['If-None-Match'] = etag
    }

    try {
      const path = `repos/${owner}/${name}/mentionables/users`
      const response = await this.ghRequest('GET', path, {
        customHeaders: headers,
      })

      if (response.status === HttpStatusCode.NotFound) {
        log.warn(`fetchMentionables: '${path}' returned a 404`)
        return null
      }

      if (response.status === HttpStatusCode.NotModified) {
        return null
      }
      const users = await parsedResponse<ReadonlyArray<IAPIMentionableUser>>(
        response
      )
      const etag = response.headers.get('etag') || undefined
      return { users, etag }
    } catch (e) {
      log.warn(`fetchMentionables: failed for ${owner}/${name}`, e)
      return null
    }
  }

  /**
   * Retrieve the public profile information of a user with
   * a given username.
   */
  public async fetchUser(login: string): Promise<IAPIFullIdentity | null> {
    try {
      const response = await this.ghRequest(
        'GET',
        `users/${encodeURIComponent(login)}`
      )

      if (response.status === HttpStatusCode.NotFound) {
        return null
      }

      return await parsedResponse<IAPIFullIdentity>(response)
    } catch (e) {
      log.warn(`fetchUser: failed with endpoint ${this.endpoint}`, e)
      throw e
    }
  }

  /**
   * Fetches the Desktop-specific features that are enabled for the user.
   *
   * @returns An array of strings with the feature flags enabled for the user.
   */
  public async fetchFeatureFlags(): Promise<ReadonlyArray<string> | undefined> {
    try {
      const response = await this.ghRequest('GET', '/desktop_internal/features')
      const featuresResponse = await parsedResponse<IUserFeaturesResponse>(
        response
      )
      return featuresResponse.features
    } catch (e) {
      log.warn(`fetchFeatureFlags: failed with endpoint ${this.endpoint}`, e)
      return undefined
    }
  }

  /**
   * Fetches the Copilot info related to the user (license and API endpoint).
   *
   * @returns Copilot license and API endpoint.
   */
  public async fetchUserCopilotInfo(): Promise<UserCopilotInfo | undefined> {
    // Copilot is not available on GHES
    if (isGHES(this.endpoint)) {
      return undefined
    }

    const graphql = `
    {
      viewer {
        copilotEndpoints {
          api
        }

        copilotLicenseType
        isCopilotDesktopEnabled
      }
    }
    `

    try {
      const response = await this.ghRequest('POST', '/graphql', {
        body: { query: graphql },
        customHeaders: {
          'GraphQL-Features': 'copilot_iap_max_sku',
        },
      })
      if (response === null) {
        return undefined
      }

      const json: ViewerCopilotResponse =
        (await response.json()) as ViewerCopilotResponse
      const { viewer } = json.data
      return {
        copilotEndpoint: viewer.copilotEndpoints.api,
        isCopilotDesktopEnabled: viewer.isCopilotDesktopEnabled,
        copilotLicenseType: viewer.copilotLicenseType,
      }
    } catch (e) {
      log.warn(`fetchUserCopilotInfo: failed with endpoint ${this.endpoint}`, e)
      return undefined
    }
  }

  /**
   * Creates a push protection bypass for a repository.
   *
   * This method sends a POST request to the GitHub API to create a bypass
   * for push protection in a specified repository. The bypass is associated
   * with a reason and a placeholder ID.
   *
   * @param owner - The owner of the repository.
   * @param name - The name of the repository.
   * @param reason - The reason for creating the bypass - false_positive, used_in_tests, will_fix_later.
   * @param placeholderId - The placeholder ID associated with the bypass.
   * @param bypassURL - The URL to retry the bypass creation on Github.com in case of failure.
   * @returns A promise that resolves to the response of the bypass creation.
   * @throws An error if the bypass creation fails, including a warning log.
   */
  public async createPushProtectionBypass(
    owner: string,
    name: string,
    reason: BypassReasonType,
    placeholderId: string,
    bypassURL: string
  ): Promise<IAPICreatePushProtectionBypassResponse> {
    const path = `repos/${owner}/${name}/secret-scanning/push-protection-bypasses`
    const body = {
      reason,
      placeholder_id: placeholderId,
    }

    try {
      const response = await this.ghRequest('POST', path, { body })
      return await parsedResponse<IAPICreatePushProtectionBypassResponse>(
        response
      )
    } catch (e) {
      const msg = `Unable to create push protection bypass.

    Repository: ${owner}/${name}
    Reason: ${reason}
    Placeholder Id: ${placeholderId}.

    Try again at: ${bypassURL}`

      log.error(msg, e)
      throw new Error(msg)
    }
  }
}

export async function deleteToken(account: Account) {
  if (account.provider !== 'github') {
    return true
  }
  try {
    const creds = Buffer.from(`${ClientID}:${ClientSecret}`).toString('base64')
    const path = `applications/${ClientID}/token`
    const response = await request(
      account.endpoint,
      null,
      'DELETE',
      path,
      { access_token: account.token },
      createGitHubAPIRequestHeaders(account.endpoint, path, {
        Authorization: `Basic ${creds}`,
      })
    )

    return response.status === 204
  } catch (e) {
    log.error(`deleteToken: failed with endpoint ${account.endpoint}`, e)
    return false
  }
}

/** Fetch the user authenticated by the token. */
export async function fetchUser(
  endpoint: string,
  token: string,
  provider: AccountProvider = 'github'
): Promise<Account> {
  const api =
    provider === 'gitlab'
      ? // eslint-disable-next-line @typescript-eslint/no-use-before-define
        new GitLabAPI(endpoint, token)
      : provider === 'bitbucket'
      ? // eslint-disable-next-line @typescript-eslint/no-use-before-define
        new BitbucketAPI(endpoint, token, '')
      : new API(endpoint, token)
  try {
    const [user, emails, copilotInfo, features] = await Promise.all([
      api.fetchAccount(),
      api.fetchEmails(),
      api.fetchUserCopilotInfo(),
      api.fetchFeatureFlags(),
    ])

    return new Account(
      user.login,
      endpoint,
      token,
      emails,
      user.avatar_url,
      user.id,
      user.name || user.login,
      user.plan?.name,
      copilotInfo?.copilotEndpoint,
      copilotInfo?.isCopilotDesktopEnabled,
      features,
      copilotInfo?.copilotLicenseType,
      provider
    )
  } catch (e) {
    log.warn(`fetchUser: failed with endpoint ${endpoint}`, e)
    throw e
  }
}

export function getGitLabAPIEndpoint(endpoint = 'https://gitlab.com'): string {
  const url = new window.URL(
    /^[a-z][a-z\d+.-]*:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`
  )
  const path = url.pathname.replace(/\/+$/, '')
  if (!path.endsWith('/api/v4')) {
    url.pathname = `${path}/api/v4`
  } else {
    url.pathname = path
  }
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function getBitbucketAPIEndpoint(): string {
  return 'https://api.bitbucket.org/2.0'
}

/**
 * Map a repository's URL to the endpoint associated with it. For example:
 *
 * https://github.com/desktop/desktop -> https://api.github.com
 * http://github.mycompany.com/my-team/my-project -> http://github.mycompany.com/api
 */
export function getEndpointForRepository(url: string): string {
  const parsed = URL.parse(url)
  if (parsed.hostname === 'github.com') {
    return getDotComAPIEndpoint()
  } else if (parsed.hostname === 'gitlab.com') {
    return getGitLabAPIEndpoint()
  } else if (parsed.hostname === 'bitbucket.org') {
    return getBitbucketAPIEndpoint()
  } else {
    return `${parsed.protocol}//${parsed.hostname}/api`
  }
}

/**
 * Get the URL for the HTML site. For example:
 *
 * https://api.github.com -> https://github.com
 * http://github.mycompany.com/api -> http://github.mycompany.com/
 */
export function getHTMLURL(endpoint: string): string {
  if (envHTMLURL !== undefined) {
    return envHTMLURL
  }

  if (
    endpoint.replace(/\/+$/, '') ===
    getBitbucketAPIEndpoint().replace(/\/+$/, '')
  ) {
    return 'https://bitbucket.org'
  }

  const providerURL = new globalThis.URL(endpoint)
  const providerPath = providerURL.pathname.replace(/\/+$/, '')
  if (providerPath.endsWith('/api/v4')) {
    providerURL.pathname = providerPath.slice(0, -'/api/v4'.length) || '/'
    providerURL.search = ''
    providerURL.hash = ''
    return providerURL.toString().replace(/\/$/, '')
  }

  // In the case of GitHub.com, the HTML site lives on the parent domain.
  //  E.g., https://api.github.com -> https://github.com
  //
  // Whereas with Enterprise, it lives on the same domain but without the
  // API path:
  //  E.g., https://github.mycompany.com/api/v3 -> https://github.mycompany.com
  //
  // We need to normalize them.
  if (endpoint === getDotComAPIEndpoint() && !envEndpoint) {
    return 'https://github.com'
  } else {
    if (isGHE(endpoint)) {
      // This helper is also used by Electron's main process, where there is
      // no renderer `window` object. `globalThis.URL` is available in both
      // the renderer and Node/Electron main runtimes.
      const url = new globalThis.URL(endpoint)

      url.pathname = '/'

      if (url.hostname.startsWith('api.')) {
        url.hostname = url.hostname.replace(/^api\./, '')
      }

      return url.toString()
    }

    const parsed = URL.parse(endpoint)
    // `host` includes a non-default port while `hostname` does not. GHES can
    // legitimately run on a custom port, and dropping it would make the HTML
    // origin differ from the signed-in account's API origin.
    return `${parsed.protocol}//${parsed.host}`
  }
}

/**
 * Get the API URL for an HTML URL. For example:
 *
 * http://github.mycompany.com -> https://github.mycompany.com/api/v3
 */
export function getEnterpriseAPIURL(endpoint: string): string {
  const { host } = new window.URL(endpoint)

  return isGHE(endpoint) ? `https://api.${host}/` : `https://${host}/api/v3`
}

export const getAPIEndpoint = (endpoint: string) =>
  isDotCom(endpoint) ? getDotComAPIEndpoint() : getEnterpriseAPIURL(endpoint)

/** Get github.com's API endpoint. */
export function getDotComAPIEndpoint(): string {
  // NOTE:
  // `DESKTOP_GITHUB_DOTCOM_API_ENDPOINT` only needs to be set if you are
  // developing against a local version of GitHub the Website, and need to debug
  // the server-side interaction. For all other cases you should leave this
  // unset.
  if (envEndpoint && envEndpoint.length > 0) {
    return envEndpoint
  }

  return 'https://api.github.com'
}

/** Get the account for the endpoint. */
export function getAccountForEndpoint(
  accounts: ReadonlyArray<Account>,
  endpoint: string
): Account | null {
  return accounts.find(a => a.endpoint === endpoint) || null
}

export function getOAuthAuthorizationURL(
  endpoint: string,
  state: string
): string {
  const urlBase = getHTMLURL(endpoint)
  const scope = encodeURIComponent(GitHubOAuthScopes.join(' '))

  return new window.URL(
    `/login/oauth/authorize?client_id=${ClientID}&scope=${scope}&state=${state}`,
    urlBase
  ).toString()
}

export async function requestOAuthToken(
  endpoint: string,
  code: string
): Promise<string | null> {
  try {
    const urlBase = getHTMLURL(endpoint)
    const response = await request(
      urlBase,
      null,
      'POST',
      'login/oauth/access_token',
      {
        client_id: ClientID,
        client_secret: ClientSecret,
        code: code,
      }
    )
    tryUpdateEndpointVersionFromResponse(endpoint, response)

    const result = await parsedResponse<IAPIAccessToken>(response)
    return result.access_token
  } catch (e) {
    log.warn(`requestOAuthToken: failed with endpoint ${endpoint}`, e)
    return null
  }
}

function tryUpdateEndpointVersionFromResponse(
  endpoint: string,
  response: Response
) {
  const gheVersion = response.headers.get('x-github-enterprise-version')
  if (gheVersion !== null) {
    updateEndpointVersion(endpoint, gheVersion)
  }
}

const knownThirdPartyHosts = new Set([
  'dev.azure.com',
  'gitlab.com',
  'bitbucket.org',
  'amazonaws.com',
  'visualstudio.com',
])

const isKnownThirdPartyHost = (hostname: string) => {
  if (knownThirdPartyHosts.has(hostname)) {
    return true
  }

  for (const knownHost of knownThirdPartyHosts) {
    if (hostname.endsWith(`.${knownHost}`)) {
      return true
    }
  }

  return false
}

/**
 * Attempts to determine whether or not the url belongs to a GitHub host.
 *
 * This is a best-effort attempt and may return `undefined` if encountering
 * an error making the discovery request
 */
export async function isGitHubHost(url: string) {
  const { hostname } = new window.URL(url)

  const endpoint =
    hostname === 'github.com' || hostname === 'api.github.com'
      ? getDotComAPIEndpoint()
      : getEnterpriseAPIURL(url)

  if (isDotCom(endpoint) || isGHE(endpoint)) {
    return true
  }

  if (isKnownThirdPartyHost(hostname)) {
    return false
  }

  // github.example.com,
  if (/(^|\.)(github)\./.test(hostname)) {
    return true
  }

  // bitbucket.example.com, etc
  if (/(^|\.)(bitbucket|gitlab)\./.test(hostname)) {
    return false
  }

  if (getEndpointVersion(endpoint) !== null) {
    return true
  }

  // Add a unique identifier to the URL to make sure our certificate error
  // supression only catches this request
  const metaUrl = `${endpoint}/meta?ghd=${crypto.randomUUID()}`

  const ac = new AbortController()
  const timeoutId = setTimeout(() => ac.abort(), 2000)
  suppressCertificateErrorFor(metaUrl)
  try {
    const response = await fetch(metaUrl, {
      headers: { 'user-agent': getUserAgent() },
      signal: ac.signal,
      credentials: 'omit',
      method: 'HEAD',
      redirect: 'error',
    })

    tryUpdateEndpointVersionFromResponse(endpoint, response)

    return response.headers.has('x-github-request-id')
  } catch (e) {
    log.debug(`isGitHubHost: failed with endpoint ${endpoint}`, e)
    return undefined
  } finally {
    clearTimeout(timeoutId)
    clearCertificateErrorSuppressionFor(metaUrl)
  }
}

const isRulesetsNotEnabledError = (error: any) =>
  error instanceof APIError &&
  error.responseStatus === 403 &&
  /upgrade.*to enable this feature.*/i.test(error.apiError?.message ?? '')

const isNotFoundApiError = (error: any) =>
  error instanceof APIError && error.responseStatus === 404

interface IGitLabIdentity {
  readonly id: number
  readonly username: string
  readonly name: string
  readonly avatar_url: string | null
  readonly web_url: string
  readonly public_email?: string | null
  readonly email?: string | null
}

interface IGitLabEmail {
  readonly email: string
  readonly confirmed_at: string | null
}

interface IGitLabNamespace {
  readonly id: number
  readonly name: string
  readonly path: string
  readonly full_path: string
  readonly avatar_url: string | null
  readonly kind: string
}

interface IGitLabProject {
  readonly id: number
  readonly name: string
  readonly path: string
  readonly path_with_namespace: string
  readonly web_url: string
  readonly http_url_to_repo: string
  readonly ssh_url_to_repo: string
  readonly visibility: string
  readonly default_branch: string | null
  readonly last_activity_at: string
  readonly archived: boolean
  readonly namespace: IGitLabNamespace
  readonly forked_from_project?: IGitLabProject
  readonly permissions?: {
    readonly project_access?: { readonly access_level: number } | null
    readonly group_access?: { readonly access_level: number } | null
  }
}

interface IGitLabMergeRequest {
  readonly iid: number
  readonly title: string
  readonly description: string | null
  readonly state: 'opened' | 'closed' | 'merged' | 'locked'
  readonly created_at: string
  readonly updated_at: string
  readonly source_branch: string
  readonly target_branch: string
  readonly source_project_id: number
  readonly target_project_id: number
  readonly sha: string
  readonly draft?: boolean
  readonly author: IGitLabIdentity
  readonly assignees?: ReadonlyArray<IGitLabIdentity>
  readonly reviewers?: ReadonlyArray<IGitLabIdentity>
}

interface IGitLabIssue {
  readonly iid: number
  readonly title: string
  readonly state: 'opened' | 'closed'
  readonly created_at: string
  readonly updated_at: string
  readonly author: IGitLabIdentity
  readonly assignees?: ReadonlyArray<IGitLabIdentity>
}

interface IGitLabPipeline {
  readonly id: number
  readonly name?: string
  readonly status:
    | 'created'
    | 'waiting_for_resource'
    | 'preparing'
    | 'pending'
    | 'running'
    | 'success'
    | 'failed'
    | 'canceled'
    | 'skipped'
    | 'manual'
    | 'scheduled'
  readonly web_url: string
  readonly created_at: string
  readonly updated_at: string
}

interface IBitbucketLink {
  readonly href: string
}

interface IBitbucketIdentity {
  readonly uuid: string
  readonly username?: string
  readonly nickname?: string
  readonly display_name: string
  readonly links: {
    readonly avatar: IBitbucketLink
    readonly html: IBitbucketLink
  }
}

interface IBitbucketEmail {
  readonly email: string
  readonly is_confirmed: boolean
  readonly is_primary: boolean
}

interface IBitbucketRepository {
  readonly uuid: string
  readonly name: string
  readonly slug: string
  readonly full_name: string
  readonly is_private: boolean
  readonly has_issues: boolean
  readonly updated_on: string
  readonly mainbranch?: { readonly name: string } | null
  readonly owner: IBitbucketIdentity
  readonly parent?: IBitbucketRepository
  readonly links: {
    readonly html: IBitbucketLink
    readonly clone: ReadonlyArray<{
      readonly name: 'https' | 'ssh'
      readonly href: string
    }>
  }
}

interface IBitbucketPullRequestRef {
  readonly branch: { readonly name: string }
  readonly commit: { readonly hash: string }
  readonly repository: IBitbucketRepository | null
}

interface IBitbucketPullRequest {
  readonly id: number
  readonly title: string
  readonly description: string
  readonly state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED'
  readonly created_on: string
  readonly updated_on: string
  readonly author: IBitbucketIdentity
  readonly reviewers?: ReadonlyArray<IBitbucketIdentity>
  readonly participants?: ReadonlyArray<{
    readonly user: IBitbucketIdentity
    readonly role?: string
    readonly approved?: boolean
  }>
  readonly source: IBitbucketPullRequestRef
  readonly destination: IBitbucketPullRequestRef
  readonly draft?: boolean
}

interface IBitbucketCommitStatus {
  readonly key: string
  readonly name: string
  readonly description: string
  readonly state: 'SUCCESSFUL' | 'FAILED' | 'INPROGRESS' | 'STOPPED'
  readonly url: string
  readonly created_on: string
  readonly updated_on: string
}

interface IBitbucketPage<T> {
  readonly values: ReadonlyArray<T>
  readonly next?: string
}

function stableProviderId(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash) || 1
}

function gitLabIdentity(identity: IGitLabIdentity): IAPIIdentity {
  return {
    id: identity.id,
    login: identity.username,
    avatar_url: identity.avatar_url ?? '',
    html_url: identity.web_url,
    type: 'User',
  }
}

function gitLabRepository(project: IGitLabProject): IAPIRepository {
  return {
    clone_url: project.http_url_to_repo,
    ssh_url: project.ssh_url_to_repo,
    html_url: project.web_url,
    name: project.path,
    owner: {
      id: project.namespace.id,
      login: project.namespace.full_path,
      avatar_url: project.namespace.avatar_url ?? '',
      html_url: new window.URL(
        project.namespace.full_path,
        `${getHTMLURL(project.web_url)}/`
      ).toString(),
      type: project.namespace.kind === 'group' ? 'Organization' : 'User',
    },
    private: project.visibility !== 'public',
    fork: project.forked_from_project !== undefined,
    default_branch: project.default_branch ?? 'main',
    pushed_at: project.last_activity_at,
    has_issues: true,
    archived: project.archived,
  }
}

function gitLabFullRepository(project: IGitLabProject): IAPIFullRepository {
  const accessLevel = Math.max(
    project.permissions?.project_access?.access_level ?? 0,
    project.permissions?.group_access?.access_level ?? 0
  )
  return {
    ...gitLabRepository(project),
    parent: project.forked_from_project
      ? gitLabRepository(project.forked_from_project)
      : undefined,
    permissions: {
      admin: accessLevel >= 40,
      push: accessLevel >= 30,
      pull: accessLevel >= 10,
    },
  }
}

function bitbucketIdentity(identity: IBitbucketIdentity): IAPIIdentity {
  return {
    id: stableProviderId(identity.uuid),
    login: identity.username ?? identity.nickname ?? identity.display_name,
    avatar_url: identity.links.avatar.href,
    html_url: identity.links.html.href,
    type: 'User',
  }
}

function bitbucketRepository(repo: IBitbucketRepository): IAPIRepository {
  const clone = (kind: 'https' | 'ssh') =>
    repo.links.clone.find(x => x.name === kind)?.href ?? ''
  return {
    clone_url: clone('https'),
    ssh_url: clone('ssh'),
    html_url: repo.links.html.href,
    name: repo.slug,
    owner: bitbucketIdentity(repo.owner),
    private: repo.is_private,
    fork: repo.parent !== undefined,
    default_branch: repo.mainbranch?.name ?? 'main',
    pushed_at: repo.updated_on,
    has_issues: repo.has_issues,
    archived: false,
  }
}

function bitbucketFullRepository(
  repo: IBitbucketRepository
): IAPIFullRepository {
  return {
    ...bitbucketRepository(repo),
    parent: repo.parent ? bitbucketRepository(repo.parent) : undefined,
    permissions: { admin: false, push: true, pull: true },
  }
}

function bitbucketPullRequest(pr: IBitbucketPullRequest): IAPIPullRequest {
  const ref = (value: IBitbucketPullRequestRef): IAPIPullRequestRef => ({
    ref: value.branch.name,
    sha: value.commit.hash,
    repo: value.repository ? bitbucketRepository(value.repository) : null,
  })
  return {
    number: pr.id,
    title: pr.title,
    created_at: pr.created_on,
    updated_at: pr.updated_on,
    user: bitbucketIdentity(pr.author),
    head: ref(pr.source),
    base: ref(pr.destination),
    body: pr.description,
    state: pr.state === 'OPEN' ? 'open' : 'closed',
    draft: pr.draft,
  }
}

abstract class ThirdPartyAPI extends API {
  protected async providerRequest(
    method: HTTPMethod,
    path: string,
    headers: HeadersInit,
    reloadCache = false,
    signal?: AbortSignal
  ): Promise<Response> {
    return request(
      this.endpoint,
      null,
      method,
      path,
      undefined,
      headers,
      reloadCache,
      undefined,
      signal
    )
  }

  public override async fetchUserCopilotInfo(): Promise<undefined> {
    return undefined
  }

  public override async fetchFeatureFlags(): Promise<undefined> {
    return undefined
  }

  public override async fetchOrgs(): Promise<ReadonlyArray<IAPIOrganization>> {
    return []
  }

  public override async fetchRefCheckRuns(
    _owner: string,
    _name: string,
    _ref: string,
    _reloadCache = false
  ): Promise<IAPIRefCheckRuns | null> {
    return null
  }

  public override async getFetchPollInterval(): Promise<null> {
    return null
  }

  public override async fetchProtectedBranches(): Promise<
    ReadonlyArray<IAPIBranch>
  > {
    return []
  }

  public override async fetchPushControl(): Promise<IAPIPushControl> {
    return {
      pattern: null,
      required_signatures: false,
      required_status_checks: [],
      required_approving_review_count: 0,
      required_linear_history: false,
      allow_actor: true,
      allow_deletions: true,
      allow_force_pushes: true,
    }
  }

  public override async fetchMentionables(): Promise<null> {
    return null
  }
}

/** GitLab REST client supporting gitlab.com and arbitrary self-hosted v4 endpoints. */
export class GitLabAPI extends ThirdPartyAPI {
  public constructor(endpoint: string, token: string) {
    super(getGitLabAPIEndpoint(endpoint), token)
  }

  private requestGitLab(
    method: HTTPMethod,
    path: string,
    reloadCache = false,
    signal?: AbortSignal
  ) {
    return this.providerRequest(
      method,
      path,
      { 'PRIVATE-TOKEN': this.token },
      reloadCache,
      signal
    )
  }

  private async fetchGitLabPages<T>(
    path: string,
    onPage?: (items: ReadonlyArray<T>) => void
  ): Promise<T[]> {
    const result: T[] = []
    let next: string | null = path
    while (next !== null) {
      const response = await this.requestGitLab('GET', next)
      const page = await parsedResponse<ReadonlyArray<T>>(response)
      result.push(...page)
      onPage?.(page)
      const nextPage = response.headers.get('x-next-page')
      if (!nextPage) {
        next = null
      } else {
        const separator = path.includes('?') ? '&' : '?'
        next = `${path}${separator}page=${encodeURIComponent(
          nextPage
        )}&per_page=100`
      }
    }
    return result
  }

  public override async fetchAccount(): Promise<IAPIFullIdentity> {
    const response = await this.requestGitLab('GET', 'user')
    const identity = await parsedResponse<IGitLabIdentity>(response)
    return {
      ...gitLabIdentity(identity),
      name: identity.name,
      email: identity.public_email ?? identity.email ?? null,
    }
  }

  public override async fetchEmails(): Promise<ReadonlyArray<IAPIEmail>> {
    try {
      const emails = await this.fetchGitLabPages<IGitLabEmail>('user/emails')
      return emails.map((email, index) => ({
        email: email.email,
        verified: email.confirmed_at !== null,
        primary: index === 0,
        visibility: null,
      }))
    } catch (error) {
      log.warn(
        `fetchEmails: failed with GitLab endpoint ${this.endpoint}`,
        error
      )
      return []
    }
  }

  public override async streamUserRepositories(
    callback: (repos: ReadonlyArray<IAPIRepository>) => void
  ) {
    await this.fetchGitLabPages<IGitLabProject>(
      'projects?membership=true&simple=false&order_by=last_activity_at&sort=desc&per_page=100',
      page => callback(page.map(gitLabRepository))
    )
  }

  private async fetchProjectById(id: number): Promise<IGitLabProject | null> {
    const response = await this.requestGitLab('GET', `projects/${id}`)
    return response.status === HttpStatusCode.NotFound
      ? null
      : parsedResponse<IGitLabProject>(response)
  }

  private async fetchProject(owner: string, name: string) {
    const project = encodeURIComponent(`${owner}/${name}`)
    const response = await this.requestGitLab('GET', `projects/${project}`)
    return response.status === HttpStatusCode.NotFound
      ? null
      : parsedResponse<IGitLabProject>(response)
  }

  public override async fetchRepository(owner: string, name: string) {
    const project = await this.fetchProject(owner, name)
    return project === null ? null : gitLabFullRepository(project)
  }

  public override async fetchRepositoryCloneInfo(
    owner: string,
    name: string,
    protocol: GitProtocol | undefined
  ) {
    const project = await this.fetchProject(owner, name)
    if (project === null) {
      return null
    }
    return {
      url:
        protocol === 'ssh' ? project.ssh_url_to_repo : project.http_url_to_repo,
      defaultBranch: project.default_branch ?? undefined,
    }
  }

  private async mapMergeRequests(
    mergeRequests: ReadonlyArray<IGitLabMergeRequest>
  ): Promise<IAPIPullRequest[]> {
    const ids = new Set<number>()
    mergeRequests.forEach(mr => {
      ids.add(mr.source_project_id)
      ids.add(mr.target_project_id)
    })
    const projects = await Promise.all(
      [...ids].map(id => this.fetchProjectById(id))
    )
    const byId = new Map(
      projects
        .filter((p): p is IGitLabProject => p !== null)
        .map(p => [p.id, p])
    )
    return mergeRequests.map(mr => ({
      number: mr.iid,
      title: mr.title,
      created_at: mr.created_at,
      updated_at: mr.updated_at,
      user: gitLabIdentity(mr.author),
      head: {
        ref: mr.source_branch,
        sha: mr.sha,
        repo: byId.has(mr.source_project_id)
          ? gitLabRepository(byId.get(mr.source_project_id)!)
          : null,
      },
      base: {
        ref: mr.target_branch,
        sha: '',
        repo: byId.has(mr.target_project_id)
          ? gitLabRepository(byId.get(mr.target_project_id)!)
          : null,
      },
      body: mr.description ?? '',
      state: mr.state === 'opened' ? 'open' : 'closed',
      draft: mr.draft ?? mr.title.startsWith('Draft:'),
    }))
  }

  public override async fetchAllOpenPullRequests(owner: string, name: string) {
    const project = encodeURIComponent(`${owner}/${name}`)
    const mrs = await this.fetchGitLabPages<IGitLabMergeRequest>(
      `projects/${project}/merge_requests?state=opened&per_page=100`
    )
    return this.mapMergeRequests(mrs)
  }

  public override async fetchPullRequest(
    owner: string,
    name: string,
    prNumber: string
  ) {
    const project = encodeURIComponent(`${owner}/${name}`)
    const response = await this.requestGitLab(
      'GET',
      `projects/${project}/merge_requests/${encodeURIComponent(prNumber)}`
    )
    const mr = await parsedResponse<IGitLabMergeRequest>(response)
    return (await this.mapMergeRequests([mr]))[0]
  }

  public override async fetchUpdatedPullRequests(
    owner: string,
    name: string,
    since: Date,
    maxResults = 320
  ) {
    const project = encodeURIComponent(`${owner}/${name}`)
    const mrs = await this.fetchGitLabPages<IGitLabMergeRequest>(
      `projects/${project}/merge_requests?updated_after=${encodeURIComponent(
        since.toISOString()
      )}&order_by=updated_at&sort=desc&per_page=100`
    )
    if (mrs.length > maxResults) {
      throw new MaxResultsError('got max merge requests, aborting')
    }
    return this.mapMergeRequests(
      mrs.filter(mr => Date.parse(mr.updated_at) >= since.getTime())
    )
  }

  public override async fetchProviderTriagePullRequests(
    owner: string,
    name: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<IAPIProviderTriagePage> {
    signal?.throwIfAborted()
    const safeLimit = normalizeProviderTriageLimit(limit)
    const coordinate = validateProviderTriageCoordinate(owner, name, true)
    const project = encodeURIComponent(`${coordinate.owner}/${coordinate.name}`)
    const response = await this.requestGitLab(
      'GET',
      `projects/${project}/merge_requests?state=opened&order_by=updated_at&sort=desc&page=1&per_page=${safeLimit}`,
      false,
      signal
    )
    const values = parseGitLabTriagePullRequests(
      await boundedProviderTriageResponse(response, signal),
      safeLimit
    )
    return {
      supported: true,
      capped:
        (response.headers.get('x-next-page') ?? '').length > 0 ||
        values.length === safeLimit,
      items: values,
    }
  }

  public override async fetchProviderTriageIssues(
    owner: string,
    name: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<IAPIProviderTriagePage> {
    signal?.throwIfAborted()
    const safeLimit = normalizeProviderTriageLimit(limit)
    const coordinate = validateProviderTriageCoordinate(owner, name, true)
    const project = encodeURIComponent(`${coordinate.owner}/${coordinate.name}`)
    const response = await this.requestGitLab(
      'GET',
      `projects/${project}/issues?scope=all&state=opened&order_by=updated_at&sort=desc&page=1&per_page=${safeLimit}`,
      false,
      signal
    )
    const values = parseGitLabTriageIssues(
      await boundedProviderTriageResponse(response, signal),
      safeLimit
    )
    return {
      supported: true,
      capped:
        (response.headers.get('x-next-page') ?? '').length > 0 ||
        values.length === safeLimit,
      items: values,
    }
  }

  public override async fetchIssues(
    owner: string,
    name: string,
    state: 'open' | 'closed' | 'all'
  ): Promise<ReadonlyArray<IAPIIssue>> {
    const project = encodeURIComponent(`${owner}/${name}`)
    const stateQuery =
      state === 'all' ? '' : `&state=${state === 'open' ? 'opened' : 'closed'}`
    const issues = await this.fetchGitLabPages<IGitLabIssue>(
      `projects/${project}/issues?scope=all${stateQuery}&per_page=100`
    )
    return issues.map(issue => ({
      number: issue.iid,
      title: issue.title,
      state: issue.state === 'opened' ? 'open' : 'closed',
      updated_at: issue.updated_at,
    }))
  }

  private async fetchPipelines(owner: string, name: string, ref: string) {
    const project = encodeURIComponent(`${owner}/${name}`)
    return this.fetchGitLabPages<IGitLabPipeline>(
      `projects/${project}/pipelines?ref=${encodeURIComponent(
        ref
      )}&per_page=100`
    )
  }

  public override async fetchCombinedRefStatus(
    owner: string,
    name: string,
    ref: string
  ): Promise<IAPIRefStatus | null> {
    try {
      const pipelines = await this.fetchPipelines(owner, name, ref)
      const statuses: IAPIRefStatusItem[] = pipelines.map(pipeline => ({
        id: pipeline.id,
        context: pipeline.name ?? `Pipeline ${pipeline.id}`,
        description: pipeline.status,
        target_url: pipeline.web_url,
        state:
          pipeline.status === 'success'
            ? 'success'
            : pipeline.status === 'failed' || pipeline.status === 'canceled'
            ? 'failure'
            : 'pending',
      }))
      return {
        state: statuses.some(x => x.state === 'failure')
          ? 'failure'
          : statuses.some(x => x.state === 'pending')
          ? 'pending'
          : 'success',
        total_count: statuses.length,
        statuses,
      }
    } catch (error) {
      log.warn(`Failed fetching GitLab pipelines for ${owner}/${name}`, error)
      return null
    }
  }

  public override async fetchRefCheckRuns(
    owner: string,
    name: string,
    ref: string
  ): Promise<IAPIRefCheckRuns | null> {
    const match = ref.match(/refs\/pull\/(\d+)\/head/)
    if (match === null) {
      return null
    }

    try {
      const project = encodeURIComponent(`${owner}/${name}`)
      const pipelines = await this.fetchGitLabPages<IGitLabPipeline>(
        `projects/${project}/merge_requests/${match[1]}/pipelines?per_page=100`
      )
      return {
        total_count: pipelines.length,
        check_runs: pipelines.map(pipeline => {
          const completed = [
            'success',
            'failed',
            'canceled',
            'skipped',
            'manual',
          ].includes(pipeline.status)
          return {
            id: pipeline.id,
            url: pipeline.web_url,
            status: completed
              ? APICheckStatus.Completed
              : pipeline.status === 'running'
              ? APICheckStatus.InProgress
              : APICheckStatus.Queued,
            conclusion:
              pipeline.status === 'success'
                ? APICheckConclusion.Success
                : pipeline.status === 'failed'
                ? APICheckConclusion.Failure
                : pipeline.status === 'canceled'
                ? APICheckConclusion.Canceled
                : pipeline.status === 'skipped'
                ? APICheckConclusion.Skipped
                : null,
            name: pipeline.name ?? `Pipeline ${pipeline.id}`,
            check_suite: { id: pipeline.id },
            app: { name: 'GitLab CI' },
            completed_at: completed ? pipeline.updated_at : '',
            started_at: pipeline.created_at,
            html_url: pipeline.web_url,
            pull_requests: [],
          }
        }),
      }
    } catch (error) {
      log.warn(
        `Failed fetching GitLab MR pipelines for ${owner}/${name}`,
        error
      )
      return null
    }
  }
}

/** Bitbucket Cloud REST client using a username and app password. */
export class BitbucketAPI extends ThirdPartyAPI {
  private readonly username: string
  private readonly appPassword: string

  public constructor(endpoint: string, token: string, login: string) {
    super(endpoint || getBitbucketAPIEndpoint(), token)
    const separator = token.indexOf(':')
    this.username = separator === -1 ? login : token.substring(0, separator)
    this.appPassword = separator === -1 ? token : token.substring(separator + 1)
  }

  private requestBitbucket(
    method: HTTPMethod,
    path: string,
    reloadCache = false,
    signal?: AbortSignal
  ) {
    const credentials = Buffer.from(
      `${this.username}:${this.appPassword}`
    ).toString('base64')
    return this.providerRequest(
      method,
      path,
      { Authorization: `Basic ${credentials}` },
      reloadCache,
      signal
    )
  }

  private async fetchBitbucketPages<T>(
    path: string,
    onPage?: (items: ReadonlyArray<T>) => void
  ): Promise<T[]> {
    const result: T[] = []
    let next: string | null = path
    while (next !== null) {
      const response = await this.requestBitbucket('GET', next)
      const page = await parsedResponse<IBitbucketPage<T>>(response)
      result.push(...page.values)
      onPage?.(page.values)
      next = page.next ?? null
    }
    return result
  }

  public override async fetchAccount(): Promise<IAPIFullIdentity> {
    const response = await this.requestBitbucket('GET', 'user')
    const identity = await parsedResponse<IBitbucketIdentity>(response)
    return {
      ...bitbucketIdentity(identity),
      name: identity.display_name,
      email: null,
    }
  }

  public override async fetchEmails(): Promise<ReadonlyArray<IAPIEmail>> {
    try {
      const emails = await this.fetchBitbucketPages<IBitbucketEmail>(
        'user/emails?pagelen=100'
      )
      return emails.map(email => ({
        email: email.email,
        verified: email.is_confirmed,
        primary: email.is_primary,
        visibility: null,
      }))
    } catch (error) {
      log.warn('Unable to fetch Bitbucket account emails', error)
      return []
    }
  }

  public override async streamUserRepositories(
    callback: (repos: ReadonlyArray<IAPIRepository>) => void
  ) {
    await this.fetchBitbucketPages<IBitbucketRepository>(
      'repositories?role=member&sort=-updated_on&pagelen=100',
      page => callback(page.map(bitbucketRepository))
    )
  }

  private async fetchBitbucketRepository(owner: string, name: string) {
    const response = await this.requestBitbucket(
      'GET',
      `repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    )
    return response.status === HttpStatusCode.NotFound
      ? null
      : parsedResponse<IBitbucketRepository>(response)
  }

  public override async fetchRepository(owner: string, name: string) {
    const repo = await this.fetchBitbucketRepository(owner, name)
    return repo === null ? null : bitbucketFullRepository(repo)
  }

  public override async fetchRepositoryCloneInfo(
    owner: string,
    name: string,
    protocol: GitProtocol | undefined
  ) {
    const repo = await this.fetchBitbucketRepository(owner, name)
    if (repo === null) {
      return null
    }
    const clone = repo.links.clone.find(x =>
      protocol === 'ssh' ? x.name === 'ssh' : x.name === 'https'
    )
    return { url: clone?.href ?? '', defaultBranch: repo.mainbranch?.name }
  }

  public override async fetchAllOpenPullRequests(owner: string, name: string) {
    const prs = await this.fetchBitbucketPages<IBitbucketPullRequest>(
      `repositories/${encodeURIComponent(owner)}/${encodeURIComponent(
        name
      )}/pullrequests?state=OPEN&pagelen=50`
    )
    return prs.map(bitbucketPullRequest)
  }

  public override async fetchPullRequest(
    owner: string,
    name: string,
    prNumber: string
  ) {
    const response = await this.requestBitbucket(
      'GET',
      `repositories/${encodeURIComponent(owner)}/${encodeURIComponent(
        name
      )}/pullrequests/${encodeURIComponent(prNumber)}`
    )
    return bitbucketPullRequest(
      await parsedResponse<IBitbucketPullRequest>(response)
    )
  }

  public override async fetchUpdatedPullRequests(
    owner: string,
    name: string,
    since: Date,
    maxResults = 320
  ) {
    const prs = await this.fetchBitbucketPages<IBitbucketPullRequest>(
      `repositories/${encodeURIComponent(owner)}/${encodeURIComponent(
        name
      )}/pullrequests?state=OPEN&state=MERGED&state=DECLINED&sort=-updated_on&pagelen=50`
    )
    if (prs.length > maxResults) {
      throw new MaxResultsError('got max pull requests, aborting')
    }
    return prs
      .filter(pr => Date.parse(pr.updated_on) >= since.getTime())
      .map(bitbucketPullRequest)
  }

  public override async fetchProviderTriagePullRequests(
    owner: string,
    name: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<IAPIProviderTriagePage> {
    signal?.throwIfAborted()
    const safeLimit = normalizeProviderTriageLimit(limit)
    const coordinate = validateProviderTriageCoordinate(owner, name, false)
    const response = await this.requestBitbucket(
      'GET',
      `repositories/${encodeURIComponent(
        coordinate.owner
      )}/${encodeURIComponent(
        coordinate.name
      )}/pullrequests?state=OPEN&sort=-updated_on&page=1&pagelen=${safeLimit}`,
      false,
      signal
    )
    const page = parseBitbucketTriagePullRequests(
      await boundedProviderTriageResponse(response, signal),
      safeLimit
    )
    return {
      supported: true,
      capped: page.hasNextPage || page.items.length === safeLimit,
      items: page.items,
    }
  }

  public override async fetchProviderTriageIssues(
    owner: string,
    name: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<IAPIProviderTriagePage> {
    signal?.throwIfAborted()
    normalizeProviderTriageLimit(limit)
    validateProviderTriageCoordinate(owner, name, false)
    return { supported: false, capped: false, items: [] }
  }

  public override async fetchIssues(): Promise<ReadonlyArray<IAPIIssue>> {
    return []
  }

  public override async fetchCombinedRefStatus(
    owner: string,
    name: string,
    ref: string
  ): Promise<IAPIRefStatus | null> {
    try {
      const match = ref.match(/refs\/pull\/(\d+)\/head/)
      const path = match
        ? `repositories/${owner}/${name}/pullrequests/${match[1]}/statuses`
        : `repositories/${owner}/${name}/commit/${encodeURIComponent(
            ref
          )}/statuses`
      const items = await this.fetchBitbucketPages<IBitbucketCommitStatus>(path)
      const statuses: IAPIRefStatusItem[] = items.map((item, index) => ({
        id: index + 1,
        context: item.name || item.key,
        description: item.description,
        target_url: item.url,
        state:
          item.state === 'SUCCESSFUL'
            ? 'success'
            : item.state === 'FAILED' || item.state === 'STOPPED'
            ? 'failure'
            : 'pending',
      }))
      return {
        state: statuses.some(x => x.state === 'failure')
          ? 'failure'
          : statuses.some(x => x.state === 'pending')
          ? 'pending'
          : 'success',
        total_count: statuses.length,
        statuses,
      }
    } catch (error) {
      log.warn(`Failed fetching Bitbucket statuses for ${owner}/${name}`, error)
      return null
    }
  }
}
