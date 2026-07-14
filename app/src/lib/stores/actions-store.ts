import { randomBytes } from 'crypto'
import { Disposable } from 'event-kit'
import { Account, getAccountKey } from '../../models/account'
import { GitHubRepository } from '../../models/github-repository'
import {
  ActionsWorkflowRunPageSize,
  API,
  IAPIWorkflow,
  IAPIWorkflowJob,
  IAPIWorkflowRun,
  IAPIWorkflowRunsFilter,
} from '../api'
import {
  supportsActions,
  supportsArtifactAttestationVerification,
} from '../endpoint-capabilities'
import { APIError } from '../http'
import {
  IActionsArtifact,
  IActionsArtifactList,
  isSupportedActionsArtifactDigest,
} from '../actions-artifacts'
import { IActionsArtifactDownloadProgress } from '../actions-artifact-download'
import {
  downloadActionsArtifactThroughMainProcess,
  fetchActionsJobLogThroughMainProcess,
} from '../actions-transfer-client'
import {
  ActionsTransferError,
  IActionsArtifactTransferSuccess,
} from '../actions-transfer'
import {
  ActionsArtifactProvenanceResult,
  ActionsArtifactRepositoryVisibility,
  buildActionsArtifactSignerCandidates,
  getActionsArtifactProvenanceWebHost,
  IActionsArtifactAttestationBundleSet,
  IActionsArtifactSignerCandidate,
  IActionsArtifactVerificationPolicy,
  normalizeActionsArtifactGitObjectId,
  normalizeActionsArtifactPositiveInteger,
  normalizeActionsArtifactSHA256,
} from '../actions-artifact-provenance'
import {
  IActionsArtifactProvenanceRepositoryMetadata,
  IActionsArtifactProvenanceRunAttemptMetadata,
} from '../actions-artifact-provenance-metadata'
import {
  registerActionsArtifactProvenanceCredentialLease,
  releaseActionsArtifactProvenanceCredentialLease,
  verifyActionsArtifactProvenanceThroughMainProcess,
  invalidateActionsArtifactProvenanceCredentialLeaseGeneration,
} from '../actions-artifact-provenance-client'
import {
  inspectActionsArtifactSubjectsThroughMainProcess,
  prepareActionsArtifactSubjectThroughMainProcess,
  releaseActionsArtifactDownloadThroughMainProcess,
} from '../actions-artifact-subject-client'
import { IActionsArtifactSubjectEntry } from '../actions-artifact-subjects'
import { IActionsJobList } from '../actions-jobs'
import {
  ActionsRunReviewState,
  IActionsPendingDeployment,
  IActionsRunReviewHistory,
} from '../actions-run-reviews'
import { AccountsStore } from './accounts-store'
import { Repository } from '../../models/repository'
import { getAccountForRepository } from '../get-account-for-repository'

export type ActionsMutation =
  | 'rerun-job'
  | 'cancel-run'
  | 'force-cancel-run'
  | 'enable-workflow'
  | 'disable-workflow'
  | 'review-deployments'
  | 'approve-fork-run'

export type ActionsInspectorOperation =
  | 'load-jobs'
  | 'load-pending-deployments'
  | 'load-review-history'

export type ActionsArtifactOperation =
  | 'list'
  | 'attestations'
  | 'verification-bundles'
  | 'provenance-metadata'
  | 'download'

/** Renderer-safe identity captured from the repository-selected account. */
export interface IActionsArtifactProvenanceSelectedAccount {
  readonly accountKey: string
  readonly endpoint: string
  readonly login: string
  readonly friendlyEndpoint: string
  readonly accountsGeneration: number
}

/** One selected artifact download, bound to an exact run and attempt. */
export interface IActionsArtifactProvenanceReviewRequest {
  readonly runId: number
  readonly runAttempt: number
  readonly artifact: IActionsArtifact
  readonly download: Pick<
    IActionsArtifactTransferSuccess,
    'downloadId' | 'bytes' | 'localDigest' | 'matchesGitHubDigest'
  >
}

/** Safe signer information presented for later explicit user selection. */
export interface IActionsArtifactProvenanceReviewSigner {
  readonly candidateId: string
  readonly identity: string
  readonly digest: string
  readonly repository: string
  readonly workflowPath: string
  readonly ref: string
  readonly kind: IActionsArtifactSignerCandidate['kind']
}

/**
 * Opaque, bounded review data. Deliberately excludes accounts, tokens, raw
 * policy, bundles, account handles, archive paths, and provider envelopes.
 */
export interface IActionsArtifactProvenanceReview {
  readonly reviewId: string
  readonly account: IActionsArtifactProvenanceSelectedAccount
  readonly source: {
    readonly repository: string
    readonly digest: string
    readonly ref: string
    readonly visibility: ActionsArtifactRepositoryVisibility
  }
  readonly run: {
    readonly id: number
    readonly attempt: number
  }
  readonly archive: {
    readonly digest: string
    readonly bytes: number
  }
  readonly inventoryId: string
  readonly entries: ReadonlyArray<IActionsArtifactSubjectEntry>
  readonly signerCandidates: ReadonlyArray<IActionsArtifactProvenanceReviewSigner>
}

export interface IActionsArtifactProvenanceVerificationSelection {
  readonly entryId: string
  readonly signerCandidateId: string
}

const mutationLabels: Readonly<Record<ActionsMutation, string>> = {
  'rerun-job': 're-run this job',
  'cancel-run': 'cancel this workflow run',
  'force-cancel-run': 'force-cancel this workflow run',
  'enable-workflow': 'enable this workflow',
  'disable-workflow': 'disable this workflow',
  'review-deployments': 'review these pending deployments',
  'approve-fork-run': 'approve this fork workflow run',
}

const inspectorOperationLabels: Readonly<
  Record<ActionsInspectorOperation, string>
> = {
  'load-jobs': 'load jobs for this workflow run attempt',
  'load-pending-deployments': 'load pending deployments for this workflow run',
  'load-review-history': 'load deployment review history for this workflow run',
}

/** Turn API failures into actionable, capability-aware Actions messages. */
export function actionsMutationError(
  error: unknown,
  mutation: ActionsMutation
): Error {
  if (!(error instanceof APIError)) {
    return error instanceof Error ? error : new Error(String(error))
  }

  const action = mutationLabels[mutation]
  if (error.responseStatus === 401) {
    return new Error(`GitHub could not ${action}. Sign in again and retry.`)
  }
  if (error.responseStatus === 403) {
    if (error.rateLimitReset !== null) {
      return new Error(
        `GitHub cannot ${action} until the API rate limit resets at ${error.rateLimitReset.toLocaleTimeString()}.`
      )
    }
    const permission =
      mutation === 'review-deployments'
        ? 'Deployments write access'
        : 'Actions write access'
    return new Error(
      `GitHub denied permission to ${action}. Check that the selected account has ${permission} to this repository.`
    )
  }
  if (error.responseStatus === 404) {
    return new Error(
      `GitHub could not ${action}. The run or workflow may no longer exist, or this GitHub Enterprise version may not support the operation.`
    )
  }
  if (error.responseStatus === 409 || error.responseStatus === 422) {
    return new Error(
      `GitHub could not ${action} in its current state. Refresh Actions and try again.`
    )
  }
  if (error.responseStatus >= 500) {
    return new Error(
      `GitHub could not ${action} because the service returned an error (${error.responseStatus}). Retry in a moment.`
    )
  }
  return error
}

/** Turn run-inspector reads into account, permission, and support guidance. */
export function actionsInspectorError(
  error: unknown,
  operation: ActionsInspectorOperation
): Error {
  if ((error as Error)?.name === 'AbortError') {
    return error as Error
  }
  if (!(error instanceof APIError)) {
    return error instanceof Error ? error : new Error(String(error))
  }

  const action = inspectorOperationLabels[operation]
  if (error.responseStatus === 401) {
    return new Error(`GitHub could not ${action}. Sign in again and retry.`)
  }
  if (error.responseStatus === 403) {
    if (error.rateLimitReset !== null) {
      return new Error(
        `GitHub cannot ${action} until the API rate limit resets at ${error.rateLimitReset.toLocaleTimeString()}.`
      )
    }
    return new Error(
      `GitHub denied permission to ${action}. Check the selected account's Actions and deployment access.`
    )
  }
  if (error.responseStatus === 404) {
    return new Error(
      `GitHub could not ${action}. The run or attempt may no longer exist, or this GitHub Enterprise version may not support the function.`
    )
  }
  if (error.responseStatus >= 500) {
    return new Error(
      `GitHub could not ${action} because the service returned an error (${error.responseStatus}). Retry in a moment.`
    )
  }
  return error
}

const artifactOperationLabels: Readonly<
  Record<ActionsArtifactOperation, string>
> = {
  list: 'load artifacts for this workflow run',
  attestations: 'check artifact attestation records',
  'verification-bundles': 'load artifact attestations for verification',
  'provenance-metadata': 'load provenance data for this artifact',
  download: 'download this artifact',
}

/** Turn artifact API failures into actionable account and permission guidance. */
export function actionsArtifactError(
  error: unknown,
  operation: ActionsArtifactOperation
): Error {
  if ((error as Error)?.name === 'AbortError') {
    return error as Error
  }
  if (
    !(error instanceof APIError) &&
    !(error instanceof ActionsTransferError)
  ) {
    return error instanceof Error ? error : new Error(String(error))
  }

  const action = artifactOperationLabels[operation]
  const responseStatus = error.responseStatus
  const rateLimitReset = error instanceof APIError ? error.rateLimitReset : null
  if (responseStatus === 401) {
    return new Error(`GitHub could not ${action}. Sign in again and retry.`)
  }
  if (responseStatus === 403) {
    if (rateLimitReset !== null) {
      return new Error(
        `GitHub cannot ${action} until the API rate limit resets at ${rateLimitReset.toLocaleTimeString()}.`
      )
    }
    return new Error(
      `GitHub denied permission to ${action}. Check that the selected account has Actions read access to this repository.`
    )
  }
  if (responseStatus === 404) {
    return new Error(
      `GitHub could not ${action}. The artifact may no longer exist, the account may not have access, or this GitHub Enterprise version may not support the operation.`
    )
  }
  if (responseStatus === 410) {
    return new Error(
      'This artifact has expired and can no longer be downloaded.'
    )
  }
  if (responseStatus !== null && responseStatus >= 500) {
    return new Error(
      `GitHub could not ${action} because the service returned an error (${responseStatus}). Retry in a moment.`
    )
  }
  if (responseStatus === null) {
    return error
  }
  return new Error(
    `GitHub could not ${action} (HTTP ${responseStatus}). Refresh and retry.`
  )
}

export interface IActionsState {
  readonly workflows: ReadonlyArray<IAPIWorkflow>
  readonly runs: ReadonlyArray<IAPIWorkflowRun>
  readonly runsTotalCount: number
  readonly runsNextPage: number | null
  readonly runsLoadingMore: boolean
  readonly loading: boolean
  readonly error: Error | null
  readonly rateLimitReset: Date | null
  readonly lastUpdated: Date | null
  readonly supported: boolean
}

export type ActionsStateCallback = (state: IActionsState) => void

export type ActionsRunFilter = Omit<IAPIWorkflowRunsFilter, 'page' | 'perPage'>

interface IActionsSubscription {
  readonly repository: Repository
  readonly callbacks: Set<ActionsStateCallback>
}

const RefreshInterval = 60 * 1000

const emptyState = (supported: boolean): IActionsState => ({
  workflows: [],
  runs: [],
  runsTotalCount: 0,
  runsNextPage: null,
  runsLoadingMore: false,
  loading: false,
  error: null,
  rateLimitReset: null,
  lastUpdated: null,
  supported,
})

export function getActionsRepositoryKey(repository: Repository): string {
  const gitHubRepository = repository.gitHubRepository
  const remote =
    gitHubRepository === null
      ? `local:${repository.path}`
      : `${gitHubRepository.endpoint}/${gitHubRepository.owner.login}/${gitHubRepository.name}`
  return `${remote}#account:${repository.accountKey ?? 'legacy-endpoint'}`
}

/** GitHub Actions is available only for GitHub-backed authenticated accounts. */
export function accountSupportsActions(
  repository: Repository,
  accounts: ReadonlyArray<Account>
): boolean {
  const gitHubRepository = repository.gitHubRepository
  if (gitHubRepository === null) {
    return false
  }
  const account = getActionsAccount(repository, accounts)
  return account !== null && supportsActions(gitHubRepository.endpoint)
}

/** Resolve the exact per-repository account without endpoint fallback drift. */
export function getActionsAccount(
  repository: Repository,
  accounts: ReadonlyArray<Account>
): Account | null {
  const gitHubRepository = repository.gitHubRepository
  const account = getAccountForRepository(accounts, repository)
  return gitHubRepository !== null &&
    account?.provider === 'github' &&
    account.endpoint === gitHubRepository.endpoint
    ? account
    : null
}

function actionsAccountsEqual(
  left: ReadonlyArray<Account>,
  right: ReadonlyArray<Account>
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (account, index) =>
        getAccountKey(account) === getAccountKey(right[index]) &&
        account.provider === right[index].provider &&
        account.login === right[index].login &&
        account.token === right[index].token
    )
  )
}

/** Compare the API fields used by the run list before notifying subscribers. */
export function workflowRunsEqual(
  left: ReadonlyArray<IAPIWorkflowRun>,
  right: ReadonlyArray<IAPIWorkflowRun>
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (run, index) =>
        run.id === right[index].id && run.updated_at === right[index].updated_at
    )
  )
}

/** Merge one later Actions page without duplicating runs shifted by refreshes. */
export function mergeWorkflowRunPage(
  existing: ReadonlyArray<IAPIWorkflowRun>,
  page: ReadonlyArray<IAPIWorkflowRun>
): ReadonlyArray<IAPIWorkflowRun> {
  const merged = [...existing]
  const indexes = new Map(merged.map((run, index) => [run.id, index]))
  for (const run of page) {
    const index = indexes.get(run.id)
    if (index === undefined) {
      indexes.set(run.id, merged.length)
      merged.push(run)
    } else {
      merged[index] = run
    }
  }
  return merged
}

/** Refresh page one while retaining already loaded older pages in order. */
export function mergeRefreshedWorkflowRuns(
  refreshed: ReadonlyArray<IAPIWorkflowRun>,
  existing: ReadonlyArray<IAPIWorkflowRun>,
  totalCount: number
): ReadonlyArray<IAPIWorkflowRun> {
  const refreshedIds = new Set(refreshed.map(run => run.id))
  const merged = [
    ...refreshed,
    ...existing.filter(run => !refreshedIds.has(run.id)),
  ]
  return merged.slice(0, Math.max(refreshed.length, totalCount))
}

const provenanceOpaqueIdPattern = /^[a-f0-9]{32}$/

interface IActionsArtifactProvenanceReviewContext {
  readonly account: IActionsArtifactProvenanceSelectedAccount
  readonly repositoryKey: string
  readonly owner: string
  readonly repository: string
  readonly runId: number
  readonly runAttempt: number
  readonly artifactId: number
  readonly artifactDigest: string
  readonly downloadId: string
  readonly downloadArchiveDigest: string
  readonly downloadBytes: number
  readonly workflowHeadSHA: string
}

interface IActionsArtifactProvenanceMaterial {
  readonly sourceRepositoryURI: string
  readonly sourceDigest: string
  readonly sourceRef: string
  readonly repositoryVisibility: ActionsArtifactRepositoryVisibility
  readonly candidates: ReadonlyArray<IActionsArtifactSignerCandidate>
}

interface IActiveActionsArtifactProvenanceVerification {
  readonly generation: number
  readonly controller: AbortController
}

interface IActionsArtifactProvenanceReviewRecord {
  readonly reviewId: string
  readonly context: IActionsArtifactProvenanceReviewContext
  readonly lifecycle: AbortController
  material: IActionsArtifactProvenanceMaterial | null
  inventoryId: string | null
  archiveDigest: string | null
  archiveBytes: number | null
  entries: Map<string, IActionsArtifactSubjectEntry>
  signerCandidates: Map<string, IActionsArtifactSignerCandidate>
  reviewGeneration: number
  verification: IActiveActionsArtifactProvenanceVerification | null
  activeAccountHandle: string | null
  downloadReleased: boolean
  closed: boolean
}

function provenanceAbortError(): Error {
  const error = new Error('Artifact provenance operation canceled.')
  error.name = 'AbortError'
  return error
}

function throwIfProvenanceAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw provenanceAbortError()
  }
}

function newProvenanceOpaqueId(): string {
  const id = randomBytes(16).toString('hex')
  if (!provenanceOpaqueIdPattern.test(id)) {
    throw new Error('Unable to create an artifact provenance review.')
  }
  return id
}

function combineProvenanceAbortSignals(
  first: AbortSignal,
  second: AbortSignal
): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController()
  const abort = () => controller.abort()
  first.addEventListener('abort', abort, { once: true })
  second.addEventListener('abort', abort, { once: true })
  if (first.aborted || second.aborted) {
    abort()
  }
  return {
    signal: controller.signal,
    dispose: () => {
      first.removeEventListener('abort', abort)
      second.removeEventListener('abort', abort)
    },
  }
}

function provenanceReviewError(message: string): Error {
  return new Error(message)
}

function subjectResultError(reason: string): Error {
  switch (reason) {
    case 'changed':
      return provenanceReviewError(
        'The downloaded artifact changed. Download it again before verifying provenance.'
      )
    case 'canceled':
      return provenanceAbortError()
    case 'not-found':
      return provenanceReviewError(
        'The downloaded artifact is no longer available for provenance verification.'
      )
    default:
      return provenanceReviewError(
        'The downloaded artifact cannot be prepared for provenance verification.'
      )
  }
}

/**
 * Repository Actions cache with focus/visibility-gated polling and in-flight
 * request suppression. UI components subscribe only while the Actions tab is
 * mounted, so background traffic stops as soon as it is hidden.
 */
export class ActionsStore {
  private accounts: ReadonlyArray<Account> = []
  private accountsGeneration = 0
  private readonly accountsReady: Promise<void>
  private resolveAccountsReady!: () => void
  private readonly states = new Map<string, IActionsState>()
  private readonly subscriptions = new Map<string, IActionsSubscription>()
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly runPageInFlight = new Map<string, Promise<void>>()
  private readonly runPageControllers = new Map<string, AbortController>()
  private readonly refreshGenerations = new Map<string, number>()
  private readonly runFilters = new Map<string, ActionsRunFilter>()
  /** One renderer may retain only one provenance review/download at a time. */
  private provenanceReview: IActionsArtifactProvenanceReviewRecord | null = null
  private refreshHandle: number | null = null

  public constructor(accountsStore: AccountsStore) {
    this.accountsReady = new Promise(resolve => {
      this.resolveAccountsReady = resolve
    })
    void accountsStore
      .getAll()
      .then(this.onAccountsUpdated)
      .catch(error => log.error('Failed loading accounts for Actions', error))
      .finally(this.resolveAccountsReady)
    accountsStore.onDidUpdate(this.onAccountsUpdated)
    window.addEventListener('focus', this.refreshSubscribedRepositories)
    document.addEventListener(
      'visibilitychange',
      this.refreshSubscribedRepositories
    )
  }

  private readonly onAccountsUpdated = (accounts: ReadonlyArray<Account>) => {
    if (actionsAccountsEqual(this.accounts, accounts)) {
      return
    }
    this.accounts = accounts
    this.accountsGeneration++
    if (this.provenanceReview !== null) {
      invalidateActionsArtifactProvenanceCredentialLeaseGeneration(
        this.accountsGeneration
      )
    }
    this.disposeArtifactProvenanceReview()
    for (const controller of this.runPageControllers.values()) {
      controller.abort()
    }
    this.states.clear()
    this.inFlight.clear()
    this.runPageInFlight.clear()
    this.runPageControllers.clear()
    this.refreshGenerations.clear()
    this.runFilters.clear()

    for (const { repository } of this.subscriptions.values()) {
      const state = emptyState(accountSupportsActions(repository, accounts))
      this.notify(repository, state)
      if (state.supported) {
        this.refresh(repository, true).catch(error =>
          log.error('Failed refreshing Actions after an account update', error)
        )
      }
    }
  }

  public subscribe(
    repository: Repository,
    callback: ActionsStateCallback
  ): Disposable {
    const key = getActionsRepositoryKey(repository)
    let subscription = this.subscriptions.get(key)
    if (subscription === undefined) {
      subscription = { repository, callbacks: new Set() }
      this.subscriptions.set(key, subscription)
    }
    subscription.callbacks.add(callback)

    const state =
      this.states.get(key) ??
      emptyState(accountSupportsActions(repository, this.accounts))
    this.states.set(key, state)
    callback(state)
    this.startPolling()
    this.refresh(repository).catch(e =>
      log.error('Failed to refresh Actions state', e)
    )

    return new Disposable(() => {
      const current = this.subscriptions.get(key)
      current?.callbacks.delete(callback)
      if (current?.callbacks.size === 0) {
        this.subscriptions.delete(key)
        this.refreshGenerations.set(
          key,
          (this.refreshGenerations.get(key) ?? 0) + 1
        )
        this.runPageControllers.get(key)?.abort()
        this.runPageControllers.delete(key)
        this.runFilters.delete(key)
        const state = this.states.get(key)
        if (state?.runsLoadingMore) {
          this.states.set(key, { ...state, runsLoadingMore: false })
        }
      }
      if (this.subscriptions.size === 0) {
        this.stopPolling()
      }
    })
  }

  private startPolling() {
    if (this.refreshHandle === null) {
      this.refreshHandle = window.setInterval(
        this.refreshSubscribedRepositories,
        RefreshInterval
      )
    }
  }

  private stopPolling() {
    if (this.refreshHandle !== null) {
      window.clearInterval(this.refreshHandle)
      this.refreshHandle = null
    }
  }

  private readonly refreshSubscribedRepositories = () => {
    if (!document.hasFocus() || document.visibilityState !== 'visible') {
      return
    }
    for (const { repository } of this.subscriptions.values()) {
      this.refresh(repository).catch(e =>
        log.error('Failed polling Actions state', e)
      )
    }
  }

  private notify(repository: Repository, state: IActionsState) {
    const key = getActionsRepositoryKey(repository)
    this.states.set(key, state)
    this.subscriptions.get(key)?.callbacks.forEach(callback => callback(state))
  }

  /** Apply one exact server-side run filter and restart at page one. */
  public setRunFilter(
    repository: Repository,
    filter: ActionsRunFilter
  ): Promise<void> {
    const key = getActionsRepositoryKey(repository)
    let normalized: ActionsRunFilter = {}
    if (filter.workflowId !== undefined) {
      if (!Number.isSafeInteger(filter.workflowId) || filter.workflowId < 1) {
        return Promise.reject(new Error('Workflow filter is invalid.'))
      }
      normalized = { ...normalized, workflowId: filter.workflowId }
    }
    for (const field of ['branch', 'event', 'status'] as const) {
      const value = filter[field]
      if (value === undefined) {
        continue
      }
      const maximumLength = field === 'branch' ? 1_024 : 64
      if (
        value.length === 0 ||
        value.length > maximumLength ||
        /[\u0000-\u001f\u007f]/.test(value)
      ) {
        return Promise.reject(
          new Error(`Workflow run ${field} filter is invalid.`)
        )
      }
      normalized = { ...normalized, [field]: value }
    }

    if (
      JSON.stringify(this.runFilters.get(key) ?? {}) ===
      JSON.stringify(normalized)
    ) {
      return Promise.resolve()
    }
    this.runFilters.set(key, normalized)
    return this.refresh(repository, true)
  }

  private gitHubFor(repository: Repository): GitHubRepository {
    const gitHubRepository = repository.gitHubRepository
    if (gitHubRepository === null) {
      throw new Error('This repository is not connected to GitHub Actions.')
    }
    return gitHubRepository
  }

  private accountFor(repository: Repository): Account {
    const gitHubRepository = this.gitHubFor(repository)
    const account = getActionsAccount(repository, this.accounts)
    if (account === null) {
      throw new Error(
        repository.accountKey === null
          ? `Sign in to ${gitHubRepository.endpoint} to use Actions.`
          : 'Sign in with the account selected for this repository to use Actions.'
      )
    }
    if (!supportsActions(gitHubRepository.endpoint)) {
      throw new Error(
        'GitHub Actions is not available on this GitHub Enterprise version.'
      )
    }
    return account
  }

  private apiFor(repository: Repository): API {
    const account = this.accountFor(repository)
    return API.fromAccount(account)
  }

  private async mutate(
    mutation: ActionsMutation,
    operation: () => Promise<void>
  ) {
    try {
      await operation()
    } catch (error) {
      throw actionsMutationError(error, mutation)
    }
  }

  public async refresh(
    repository: Repository,
    force: boolean = false
  ): Promise<void> {
    const key = getActionsRepositoryKey(repository)
    const existing =
      this.states.get(key) ??
      emptyState(accountSupportsActions(repository, this.accounts))
    if (!existing.supported) {
      this.notify(repository, existing)
      return
    }

    const age =
      existing.lastUpdated === null
        ? Infinity
        : Date.now() - existing.lastUpdated.valueOf()
    if (!force && age < RefreshInterval) {
      return
    }

    const pending = this.inFlight.get(key)
    if (pending !== undefined) {
      return pending
    }

    const generation = this.accountsGeneration
    const refreshGeneration = (this.refreshGenerations.get(key) ?? 0) + 1
    this.refreshGenerations.set(key, refreshGeneration)
    this.runPageControllers.get(key)?.abort()
    this.runPageControllers.delete(key)
    const refresh = this.performRefresh(
      repository,
      existing,
      generation,
      refreshGeneration,
      this.runFilters.get(key) ?? {}
    ).finally(() => {
      if (this.inFlight.get(key) === refresh) {
        this.inFlight.delete(key)
      }
    })
    this.inFlight.set(key, refresh)
    return refresh
  }

  private async performRefresh(
    repository: Repository,
    existing: IActionsState,
    accountsGeneration: number,
    refreshGeneration: number,
    filter: ActionsRunFilter
  ) {
    const key = getActionsRepositoryKey(repository)
    this.notify(repository, {
      ...existing,
      loading: true,
      runsLoadingMore: false,
      error: null,
    })
    try {
      const api = this.apiFor(repository)
      const gitHubRepository = this.gitHubFor(repository)
      const owner = gitHubRepository.owner.login
      const [workflows, runs] = await Promise.all([
        api.fetchWorkflows(owner, gitHubRepository.name),
        api.fetchWorkflowRuns(owner, gitHubRepository.name, {
          ...filter,
          page: 1,
          perPage: ActionsWorkflowRunPageSize,
        }),
      ])
      if (
        accountsGeneration !== this.accountsGeneration ||
        (this.refreshGenerations.get(key) ?? 0) !== refreshGeneration
      ) {
        return
      }
      const nextRuns =
        existing.runs.length <= runs.workflow_runs.length
          ? workflowRunsEqual(existing.runs, runs.workflow_runs)
            ? existing.runs
            : runs.workflow_runs
          : mergeRefreshedWorkflowRuns(
              runs.workflow_runs,
              existing.runs,
              runs.total_count
            )
      const runsTotalCount = Math.max(runs.total_count, nextRuns.length)
      this.notify(repository, {
        workflows: workflows.workflows,
        runs: nextRuns,
        runsTotalCount,
        runsNextPage:
          nextRuns.length < runsTotalCount
            ? existing.runsNextPage ??
              Math.floor(nextRuns.length / ActionsWorkflowRunPageSize) + 1
            : null,
        runsLoadingMore: false,
        loading: false,
        error: null,
        rateLimitReset: null,
        lastUpdated: new Date(),
        supported: true,
      })
    } catch (error) {
      if (
        accountsGeneration !== this.accountsGeneration ||
        (this.refreshGenerations.get(key) ?? 0) !== refreshGeneration
      ) {
        return
      }
      const failure = error instanceof Error ? error : new Error(String(error))
      const clearCachedData =
        error instanceof APIError &&
        (error.responseStatus === 401 || error.responseStatus === 403)
      const safeExisting = clearCachedData
        ? emptyState(existing.supported)
        : existing
      this.notify(repository, {
        ...safeExisting,
        runsLoadingMore: false,
        loading: false,
        error: failure,
        rateLimitReset:
          error instanceof APIError && error.responseStatus === 403
            ? error.rateLimitReset
            : null,
        lastUpdated: new Date(),
      })
    }
  }

  /** Append the next bounded run page for the currently selected account. */
  public async loadMoreRuns(repository: Repository): Promise<void> {
    const key = getActionsRepositoryKey(repository)
    const existing =
      this.states.get(key) ??
      emptyState(accountSupportsActions(repository, this.accounts))
    const page = existing.runsNextPage
    if (
      !existing.supported ||
      existing.loading ||
      existing.runsLoadingMore ||
      page === null
    ) {
      return
    }

    const pending = this.runPageInFlight.get(key)
    if (pending !== undefined) {
      return pending
    }

    const accountsGeneration = this.accountsGeneration
    const refreshGeneration = this.refreshGenerations.get(key) ?? 0
    const controller = new AbortController()
    this.runPageControllers.set(key, controller)
    const request = this.performLoadMoreRuns(
      repository,
      existing,
      page,
      accountsGeneration,
      refreshGeneration,
      controller.signal,
      this.runFilters.get(key) ?? {}
    ).finally(() => {
      if (this.runPageInFlight.get(key) === request) {
        this.runPageInFlight.delete(key)
      }
      if (this.runPageControllers.get(key) === controller) {
        this.runPageControllers.delete(key)
      }
    })
    this.runPageInFlight.set(key, request)
    return request
  }

  private async performLoadMoreRuns(
    repository: Repository,
    existing: IActionsState,
    page: number,
    accountsGeneration: number,
    refreshGeneration: number,
    signal: AbortSignal,
    filter: ActionsRunFilter
  ): Promise<void> {
    const key = getActionsRepositoryKey(repository)
    this.notify(repository, {
      ...existing,
      runsLoadingMore: true,
      error: null,
    })
    try {
      const gitHubRepository = this.gitHubFor(repository)
      const response = await this.apiFor(repository).fetchWorkflowRuns(
        gitHubRepository.owner.login,
        gitHubRepository.name,
        { ...filter, page, perPage: ActionsWorkflowRunPageSize },
        signal
      )
      if (
        accountsGeneration !== this.accountsGeneration ||
        (this.refreshGenerations.get(key) ?? 0) !== refreshGeneration
      ) {
        return
      }

      const current = this.states.get(key)
      if (current === undefined || current.runsNextPage !== page) {
        return
      }
      const runs = mergeWorkflowRunPage(current.runs, response.workflow_runs)
      const runsTotalCount = Math.max(response.total_count, runs.length)
      this.notify(repository, {
        ...current,
        runs,
        runsTotalCount,
        runsNextPage:
          response.workflow_runs.length > 0 && runs.length < runsTotalCount
            ? page + 1
            : null,
        runsLoadingMore: false,
        error: null,
      })
    } catch (error) {
      if (
        accountsGeneration !== this.accountsGeneration ||
        (this.refreshGenerations.get(key) ?? 0) !== refreshGeneration
      ) {
        return
      }
      const current = this.states.get(key) ?? existing
      if ((error as Error)?.name === 'AbortError') {
        this.notify(repository, { ...current, runsLoadingMore: false })
        return
      }
      const failure = error instanceof Error ? error : new Error(String(error))
      const clearCachedData =
        error instanceof APIError &&
        (error.responseStatus === 401 || error.responseStatus === 403)
      this.notify(repository, {
        ...(clearCachedData ? emptyState(current.supported) : current),
        runsLoadingMore: false,
        error: failure,
        rateLimitReset:
          error instanceof APIError && error.responseStatus === 403
            ? error.rateLimitReset
            : null,
      })
    }
  }

  public async rerun(repository: Repository, runId: number) {
    const gitHubRepository = this.gitHubFor(repository)
    await this.apiFor(repository).rerunWorkflowRun(
      gitHubRepository.owner.login,
      gitHubRepository.name,
      runId
    )
    await this.refresh(repository, true)
  }

  public async rerunFailed(repository: Repository, runId: number) {
    const gitHubRepository = this.gitHubFor(repository)
    const succeeded = await this.apiFor(repository).rerunFailedJobs(
      gitHubRepository.owner.login,
      gitHubRepository.name,
      runId
    )
    if (!succeeded) {
      throw new Error('GitHub could not re-run the failed jobs.')
    }
    await this.refresh(repository, true)
  }

  public async rerunJob(repository: Repository, jobId: number) {
    const gitHubRepository = this.gitHubFor(repository)
    await this.mutate('rerun-job', async () => {
      await this.apiFor(repository).rerunWorkflowJob(
        gitHubRepository.owner.login,
        gitHubRepository.name,
        jobId
      )
    })
    await this.refresh(repository, true)
  }

  public async cancelRun(
    repository: Repository,
    runId: number,
    force: boolean
  ) {
    const gitHubRepository = this.gitHubFor(repository)
    await this.mutate(force ? 'force-cancel-run' : 'cancel-run', () =>
      this.apiFor(repository).cancelWorkflowRun(
        gitHubRepository.owner.login,
        gitHubRepository.name,
        runId,
        force
      )
    )
    await this.refresh(repository, true)
  }

  public async setWorkflowEnabled(
    repository: Repository,
    workflowId: number,
    enabled: boolean
  ) {
    const gitHubRepository = this.gitHubFor(repository)
    await this.mutate(enabled ? 'enable-workflow' : 'disable-workflow', () =>
      this.apiFor(repository).setWorkflowEnabled(
        gitHubRepository.owner.login,
        gitHubRepository.name,
        workflowId,
        enabled
      )
    )
    await this.refresh(repository, true)
  }

  public async fetchJobs(
    repository: Repository,
    runId: number
  ): Promise<ReadonlyArray<IAPIWorkflowJob>> {
    const gitHubRepository = this.gitHubFor(repository)
    const result = await this.apiFor(repository).fetchWorkflowRunJobs(
      gitHubRepository.owner.login,
      gitHubRepository.name,
      runId
    )
    return result?.jobs ?? []
  }

  public async fetchJobPage(
    repository: Repository,
    runId: number,
    attempt: number | null,
    latestAttempt: number | null,
    page: number = 1,
    signal?: AbortSignal
  ): Promise<IActionsJobList> {
    try {
      const gitHubRepository = this.gitHubFor(repository)
      return await this.apiFor(repository).fetchWorkflowRunJobPage(
        gitHubRepository.owner.login,
        gitHubRepository.name,
        runId,
        attempt,
        latestAttempt,
        page,
        signal
      )
    } catch (error) {
      throw actionsInspectorError(error, 'load-jobs')
    }
  }

  public async fetchPendingDeployments(
    repository: Repository,
    runId: number,
    signal?: AbortSignal
  ): Promise<ReadonlyArray<IActionsPendingDeployment>> {
    try {
      const gitHubRepository = this.gitHubFor(repository)
      return await this.apiFor(repository).fetchWorkflowRunPendingDeployments(
        gitHubRepository.owner.login,
        gitHubRepository.name,
        runId,
        signal
      )
    } catch (error) {
      throw actionsInspectorError(error, 'load-pending-deployments')
    }
  }

  public async fetchRunReviewHistory(
    repository: Repository,
    runId: number,
    signal?: AbortSignal
  ): Promise<ReadonlyArray<IActionsRunReviewHistory>> {
    try {
      const gitHubRepository = this.gitHubFor(repository)
      return await this.apiFor(repository).fetchWorkflowRunReviewHistory(
        gitHubRepository.owner.login,
        gitHubRepository.name,
        runId,
        signal
      )
    } catch (error) {
      throw actionsInspectorError(error, 'load-review-history')
    }
  }

  public async reviewPendingDeployments(
    repository: Repository,
    runId: number,
    environmentIds: ReadonlyArray<number>,
    state: ActionsRunReviewState,
    comment: string
  ): Promise<void> {
    const gitHubRepository = this.gitHubFor(repository)
    await this.mutate('review-deployments', () =>
      this.apiFor(repository).reviewWorkflowRunPendingDeployments(
        gitHubRepository.owner.login,
        gitHubRepository.name,
        runId,
        environmentIds,
        state,
        comment
      )
    )
    await this.refresh(repository, true)
  }

  public async approveForkRun(
    repository: Repository,
    runId: number
  ): Promise<void> {
    const gitHubRepository = this.gitHubFor(repository)
    await this.mutate('approve-fork-run', () =>
      this.apiFor(repository).approveForkWorkflowRun(
        gitHubRepository.owner.login,
        gitHubRepository.name,
        runId
      )
    )
    await this.refresh(repository, true)
  }

  public fetchJobLogs(
    repository: Repository,
    jobId: number,
    signal?: AbortSignal
  ) {
    const gitHubRepository = this.gitHubFor(repository)
    return fetchActionsJobLogThroughMainProcess(
      this.accountFor(repository),
      gitHubRepository,
      jobId,
      signal
    )
  }

  public async fetchArtifacts(
    repository: Repository,
    runId: number,
    page: number = 1,
    signal?: AbortSignal
  ): Promise<IActionsArtifactList> {
    try {
      const gitHubRepository = this.gitHubFor(repository)
      return await this.apiFor(repository).fetchWorkflowRunArtifacts(
        gitHubRepository.owner.login,
        gitHubRepository.name,
        runId,
        page,
        signal
      )
    } catch (error) {
      throw actionsArtifactError(error, 'list')
    }
  }

  public async fetchArtifactAttestationPresence(
    repository: Repository,
    digest: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    try {
      const gitHubRepository = this.gitHubFor(repository)
      return await this.apiFor(repository).fetchArtifactAttestationPresence(
        gitHubRepository.owner.login,
        gitHubRepository.name,
        digest,
        signal
      )
    } catch (error) {
      throw actionsArtifactError(error, 'attestations')
    }
  }

  /** Internal verifier input; callers must never retain bundles in UI state. */
  public async fetchArtifactAttestationBundles(
    repository: Repository,
    digest: string,
    signal?: AbortSignal
  ): Promise<IActionsArtifactAttestationBundleSet> {
    try {
      const gitHubRepository = this.gitHubFor(repository)
      return await this.apiFor(repository).fetchArtifactAttestationBundles(
        gitHubRepository.owner.login,
        gitHubRepository.name,
        digest,
        signal
      )
    } catch (error) {
      throw actionsArtifactError(error, 'verification-bundles')
    }
  }

  /**
   * Start one bounded, opaque review for a completed artifact download. The
   * review captures no Account object, token, policy, bundle, handle, or path
   * for UI use; those values stay inside this store's closures.
   */
  public async startArtifactProvenanceReview(
    repository: Repository,
    request: IActionsArtifactProvenanceReviewRequest,
    signal: AbortSignal
  ): Promise<IActionsArtifactProvenanceReview> {
    throwIfProvenanceAborted(signal)
    this.disposeArtifactProvenanceReview()
    const context = await this.captureArtifactProvenanceContext(
      repository,
      request,
      signal
    )
    throwIfProvenanceAborted(signal)

    const review: IActionsArtifactProvenanceReviewRecord = {
      reviewId: newProvenanceOpaqueId(),
      context,
      lifecycle: new AbortController(),
      material: null,
      inventoryId: null,
      archiveDigest: null,
      archiveBytes: null,
      entries: new Map(),
      signerCandidates: new Map(),
      reviewGeneration: 0,
      verification: null,
      activeAccountHandle: null,
      downloadReleased: false,
      closed: false,
    }
    this.provenanceReview = review
    const operation = combineProvenanceAbortSignals(
      review.lifecycle.signal,
      signal
    )
    try {
      const [material, inventory] = await Promise.all([
        this.loadArtifactProvenanceMaterial(
          repository,
          review,
          operation.signal
        ),
        inspectActionsArtifactSubjectsThroughMainProcess(
          context.downloadId,
          operation.signal
        ),
      ])
      this.currentArtifactProvenanceAccount(
        repository,
        review,
        operation.signal
      )
      if (!inventory.ok) {
        throw subjectResultError(inventory.reason)
      }

      let archiveDigest: string
      try {
        archiveDigest = normalizeActionsArtifactSHA256(inventory.archiveDigest)
      } catch {
        throw provenanceReviewError(
          'The downloaded artifact inventory is invalid.'
        )
      }
      if (
        archiveDigest !== context.downloadArchiveDigest ||
        inventory.archiveBytes !== context.downloadBytes
      ) {
        throw provenanceReviewError(
          'The downloaded artifact changed. Download it again before verifying provenance.'
        )
      }
      if (!provenanceOpaqueIdPattern.test(inventory.inventoryId)) {
        throw provenanceReviewError('The downloaded artifact inventory is invalid.')
      }

      const entries = new Map<string, IActionsArtifactSubjectEntry>()
      for (const entry of inventory.entries) {
        if (
          !provenanceOpaqueIdPattern.test(entry.entryId) ||
          entries.has(entry.entryId)
        ) {
          throw provenanceReviewError(
            'The downloaded artifact inventory is invalid.'
          )
        }
        entries.set(entry.entryId, entry)
      }

      const candidates = new Map<string, IActionsArtifactSignerCandidate>()
      for (const candidate of material.candidates) {
        let candidateId = newProvenanceOpaqueId()
        while (candidates.has(candidateId)) {
          candidateId = newProvenanceOpaqueId()
        }
        candidates.set(candidateId, candidate)
      }
      if (candidates.size === 0) {
        throw provenanceReviewError(
          'GitHub did not report a workflow identity this artifact can verify.'
        )
      }

      this.currentArtifactProvenanceAccount(
        repository,
        review,
        operation.signal
      )
      review.material = material
      review.inventoryId = inventory.inventoryId
      review.archiveDigest = archiveDigest
      review.archiveBytes = inventory.archiveBytes
      review.entries = entries
      review.signerCandidates = candidates
      review.reviewGeneration++
      return this.toArtifactProvenanceReview(review)
    } catch (error) {
      if (this.provenanceReview === review) {
        this.disposeArtifactProvenanceReview(review.reviewId)
      }
      throw error
    } finally {
      operation.dispose()
    }
  }

  /**
   * Revalidate selected-account metadata and one selected subject, then call
   * the fixed main-process verifier. Every policy and bundle remains local to
   * this method; the caller receives only the normalized verifier result.
   */
  public async verifyArtifactProvenanceReview(
    repository: Repository,
    reviewId: string,
    selection: IActionsArtifactProvenanceVerificationSelection,
    signal: AbortSignal
  ): Promise<ActionsArtifactProvenanceResult> {
    const review = this.getArtifactProvenanceReview(reviewId)
    if (
      !provenanceOpaqueIdPattern.test(selection.entryId) ||
      !provenanceOpaqueIdPattern.test(selection.signerCandidateId)
    ) {
      throw provenanceReviewError('The artifact provenance selection is invalid.')
    }
    const selectedEntry = review.entries.get(selection.entryId)
    const selectedCandidate = review.signerCandidates.get(
      selection.signerCandidateId
    )
    if (selectedEntry === undefined || selectedCandidate === undefined) {
      throw provenanceReviewError('The artifact provenance selection is stale.')
    }
    if (
      review.inventoryId === null ||
      review.material === null ||
      review.archiveDigest === null ||
      review.archiveBytes === null
    ) {
      throw provenanceReviewError('The artifact provenance review is incomplete.')
    }

    review.verification?.controller.abort()
    const verification: IActiveActionsArtifactProvenanceVerification = {
      generation: review.reviewGeneration + 1,
      controller: new AbortController(),
    }
    review.verification = verification
    review.reviewGeneration = verification.generation
    const reviewOperation = combineProvenanceAbortSignals(
      review.lifecycle.signal,
      verification.controller.signal
    )
    const operation = combineProvenanceAbortSignals(reviewOperation.signal, signal)
    let accountHandle: string | null = null
    try {
      const account = this.currentArtifactProvenanceAccount(
        repository,
        review,
        operation.signal,
        verification.generation
      )
      const api = API.fromAccount(account)
      const [material, prepared] = await Promise.all([
        this.loadArtifactProvenanceMaterial(
          repository,
          review,
          operation.signal,
          verification.generation
        ),
        prepareActionsArtifactSubjectThroughMainProcess(
          review.context.downloadId,
          review.inventoryId,
          selectedEntry.entryId,
          operation.signal
        ),
      ])
      this.currentArtifactProvenanceAccount(
        repository,
        review,
        operation.signal,
        verification.generation
      )
      if (!prepared.ok) {
        throw subjectResultError(prepared.reason)
      }
      let subjectDigest: string
      try {
        subjectDigest = normalizeActionsArtifactSHA256(prepared.digest)
      } catch {
        throw provenanceReviewError('The selected artifact subject is invalid.')
      }
      if (
        prepared.entryId !== selectedEntry.entryId ||
        prepared.path !== selectedEntry.path ||
        prepared.bytes !== selectedEntry.bytes ||
        prepared.archiveDigest !== review.archiveDigest
      ) {
        throw provenanceReviewError('The selected artifact subject is stale.')
      }
      const reviewedMaterial = review.material
      if (
        reviewedMaterial === null ||
        material.sourceRepositoryURI !== reviewedMaterial.sourceRepositoryURI ||
        material.sourceDigest !== reviewedMaterial.sourceDigest ||
        material.sourceRef !== reviewedMaterial.sourceRef ||
        material.repositoryVisibility !== reviewedMaterial.repositoryVisibility
      ) {
        throw provenanceReviewError(
          'The artifact provenance policy changed. Review it again before verifying.'
        )
      }
      const candidate = material.candidates.find(
        item =>
          item.identity === selectedCandidate.identity &&
          item.digest === selectedCandidate.digest &&
          item.repository === selectedCandidate.repository &&
          item.workflowPath === selectedCandidate.workflowPath &&
          item.ref === selectedCandidate.ref &&
          item.kind === selectedCandidate.kind
      )
      if (candidate === undefined) {
        throw provenanceReviewError(
          'The artifact provenance policy changed. Review it again before verifying.'
        )
      }

      let bundles: IActionsArtifactAttestationBundleSet
      try {
        bundles = await api.fetchArtifactAttestationBundles(
          review.context.owner,
          review.context.repository,
          review.context.artifactDigest,
          operation.signal
        )
      } catch (error) {
        throw actionsArtifactError(error, 'verification-bundles')
      }
      this.currentArtifactProvenanceAccount(
        repository,
        review,
        operation.signal,
        verification.generation
      )

      const policy: IActionsArtifactVerificationPolicy = {
        sourceRepositoryURI: material.sourceRepositoryURI,
        sourceDigest: material.sourceDigest,
        sourceRef: material.sourceRef,
        runId: review.context.runId,
        runAttempt: review.context.runAttempt,
        signerIdentity: candidate.identity,
        signerDigest: candidate.digest,
        repositoryVisibility: material.repositoryVisibility,
      }
      const webHost = getActionsArtifactProvenanceWebHost(
        review.context.account.endpoint
      )
      if (bundles.bundles.length > 0 && webHost !== 'github.com') {
        accountHandle = await registerActionsArtifactProvenanceCredentialLease({
          accountKey: review.context.account.accountKey,
          endpoint: review.context.account.endpoint,
          login: review.context.account.login,
          accountsGeneration: review.context.account.accountsGeneration,
        })
        if (
          accountHandle === null ||
          !provenanceOpaqueIdPattern.test(accountHandle)
        ) {
          return { ok: false, reason: 'verifier-unavailable' }
        }
        review.activeAccountHandle = accountHandle
        this.currentArtifactProvenanceAccount(
          repository,
          review,
          operation.signal,
          verification.generation
        )
      }

      const result = await verifyActionsArtifactProvenanceThroughMainProcess(
        {
          accountHandle,
          downloadId: review.context.downloadId,
          inventoryId: review.inventoryId,
          entryId: selectedEntry.entryId,
          expectedSubjectDigest: subjectDigest,
          bundles: bundles.bundles,
          policy,
        },
        operation.signal
      )
      this.currentArtifactProvenanceAccount(
        repository,
        review,
        operation.signal,
        verification.generation
      )
      return result
    } finally {
      if (accountHandle !== null) {
        releaseActionsArtifactProvenanceCredentialLease(accountHandle)
        if (review.activeAccountHandle === accountHandle) {
          review.activeAccountHandle = null
        }
      }
      if (review.verification === verification) {
        review.verification = null
      }
      operation.dispose()
      reviewOperation.dispose()
    }
  }

  /**
   * Abort one review, revoke its active account lease, and release the exact
   * retained download. This is idempotent and is the required cleanup path for
   * repository/run/download replacement and component unmount.
   */
  public disposeArtifactProvenanceReview(reviewId?: string): boolean {
    const review = this.provenanceReview
    if (
      review === null ||
      (reviewId !== undefined && reviewId !== review.reviewId)
    ) {
      return false
    }
    this.provenanceReview = null
    review.closed = true
    review.reviewGeneration++
    review.verification?.controller.abort()
    review.lifecycle.abort()
    if (review.activeAccountHandle !== null) {
      releaseActionsArtifactProvenanceCredentialLease(
        review.activeAccountHandle
      )
      review.activeAccountHandle = null
    }
    if (!review.downloadReleased) {
      review.downloadReleased = true
      releaseActionsArtifactDownloadThroughMainProcess(review.context.downloadId)
    }
    return true
  }

  private async captureArtifactProvenanceContext(
    repository: Repository,
    request: IActionsArtifactProvenanceReviewRequest,
    signal: AbortSignal
  ): Promise<IActionsArtifactProvenanceReviewContext> {
    await this.accountsReady
    throwIfProvenanceAborted(signal)
    const gitHubRepository = this.gitHubFor(repository)
    const account = this.accountFor(repository)
    if (!supportsArtifactAttestationVerification(account.endpoint)) {
      throw provenanceReviewError(
        'Artifact provenance verification is not available on this GitHub host.'
      )
    }
    let runId: number
    let runAttempt: number
    let artifactId: number
    let artifactDigest: string
    let downloadArchiveDigest: string
    let workflowHeadSHA: string
    try {
      runId = normalizeActionsArtifactPositiveInteger(request.runId, 'run id')
      runAttempt = normalizeActionsArtifactPositiveInteger(
        request.runAttempt,
        'run attempt'
      )
      artifactId = normalizeActionsArtifactPositiveInteger(
        request.artifact.id,
        'artifact id'
      )
      if (
        request.artifact.digest === null ||
        !isSupportedActionsArtifactDigest(request.artifact.digest)
      ) {
        throw new Error('artifact digest')
      }
      artifactDigest = normalizeActionsArtifactSHA256(request.artifact.digest)
      downloadArchiveDigest = normalizeActionsArtifactSHA256(
        request.download.localDigest
      )
      workflowHeadSHA = normalizeActionsArtifactGitObjectId(
        request.artifact.workflowRun?.headSha
      )
    } catch {
      throw provenanceReviewError('The artifact provenance request is invalid.')
    }
    const workflowRun = request.artifact.workflowRun
    if (
      workflowRun === null ||
      workflowRun.id !== runId ||
      workflowRun.runAttempt !== runAttempt ||
      request.download.matchesGitHubDigest !== true ||
      downloadArchiveDigest !== artifactDigest ||
      !provenanceOpaqueIdPattern.test(request.download.downloadId) ||
      !Number.isSafeInteger(request.download.bytes) ||
      request.download.bytes < 0
    ) {
      throw provenanceReviewError(
        'This artifact is not bound to the selected workflow run attempt. Download it again before verifying provenance.'
      )
    }
    try {
      getActionsArtifactProvenanceWebHost(account.endpoint)
    } catch {
      throw provenanceReviewError(
        'Artifact provenance verification is not available on this GitHub host.'
      )
    }
    return {
      account: {
        accountKey: getAccountKey(account),
        endpoint: account.endpoint,
        login: account.login,
        friendlyEndpoint: account.friendlyEndpoint,
        accountsGeneration: this.accountsGeneration,
      },
      repositoryKey: getActionsRepositoryKey(repository),
      owner: gitHubRepository.owner.login,
      repository: gitHubRepository.name,
      runId,
      runAttempt,
      artifactId,
      artifactDigest,
      downloadId: request.download.downloadId,
      downloadArchiveDigest,
      downloadBytes: request.download.bytes,
      workflowHeadSHA,
    }
  }

  private currentArtifactProvenanceAccount(
    repository: Repository,
    review: IActionsArtifactProvenanceReviewRecord,
    signal: AbortSignal,
    verificationGeneration?: number
  ): Account {
    throwIfProvenanceAborted(signal)
    if (
      this.provenanceReview !== review ||
      review.closed ||
      review.context.repositoryKey !== getActionsRepositoryKey(repository) ||
      review.context.account.accountsGeneration !== this.accountsGeneration ||
      (verificationGeneration !== undefined &&
        (review.verification === null ||
          review.verification.generation !== verificationGeneration))
    ) {
      throw provenanceAbortError()
    }
    const account = getActionsAccount(repository, this.accounts)
    if (
      account === null ||
      getAccountKey(account) !== review.context.account.accountKey ||
      account.endpoint !== review.context.account.endpoint ||
      account.login !== review.context.account.login
    ) {
      throw provenanceAbortError()
    }
    return account
  }

  private async loadArtifactProvenanceMaterial(
    repository: Repository,
    review: IActionsArtifactProvenanceReviewRecord,
    signal: AbortSignal,
    verificationGeneration?: number
  ): Promise<IActionsArtifactProvenanceMaterial> {
    const account = this.currentArtifactProvenanceAccount(
      repository,
      review,
      signal,
      verificationGeneration
    )
    const api = API.fromAccount(account)
    let repositoryMetadata: IActionsArtifactProvenanceRepositoryMetadata
    let attempt: IActionsArtifactProvenanceRunAttemptMetadata
    try {
      ;[repositoryMetadata, attempt] = await Promise.all([
        api.fetchArtifactProvenanceRepositoryMetadata(
          review.context.owner,
          review.context.repository,
          signal
        ),
        api.fetchArtifactProvenanceRunAttemptMetadata(
          review.context.owner,
          review.context.repository,
          review.context.runId,
          review.context.runAttempt,
          signal
        ),
      ])
    } catch (error) {
      throw actionsArtifactError(error, 'provenance-metadata')
    }
    this.currentArtifactProvenanceAccount(
      repository,
      review,
      signal,
      verificationGeneration
    )
    if (
      repositoryMetadata.full_name !==
        `${review.context.owner}/${review.context.repository}` ||
      attempt.id !== review.context.runId ||
      attempt.run_attempt !== review.context.runAttempt ||
      attempt.head_sha !== review.context.workflowHeadSHA
    ) {
      throw provenanceReviewError(
        'GitHub returned provenance metadata for a different artifact run.'
      )
    }
    let sourceRef: string | null
    try {
      sourceRef = await api.resolveArtifactProvenanceSourceRef(
        review.context.owner,
        review.context.repository,
        attempt,
        signal
      )
    } catch (error) {
      throw actionsArtifactError(error, 'provenance-metadata')
    }
    this.currentArtifactProvenanceAccount(
      repository,
      review,
      signal,
      verificationGeneration
    )
    if (sourceRef === null) {
      throw provenanceReviewError(
        'GitHub could not resolve one authoritative source ref for this workflow run attempt.'
      )
    }
    let candidates: ReadonlyArray<IActionsArtifactSignerCandidate>
    let sourceRepositoryURI: string
    try {
      const webHost = getActionsArtifactProvenanceWebHost(account.endpoint)
      sourceRepositoryURI = `https://${webHost}/${repositoryMetadata.full_name}`
      candidates = buildActionsArtifactSignerCandidates({
        endpoint: account.endpoint,
        owner: review.context.owner,
        repository: review.context.repository,
        sourceDigest: attempt.head_sha,
        sourceRef,
        workflowPath: attempt.path,
        referencedWorkflows: attempt.referenced_workflows,
      })
    } catch {
      throw provenanceReviewError('GitHub returned invalid artifact provenance data.')
    }
    if (candidates.length === 0) {
      throw provenanceReviewError(
        'GitHub did not report a workflow identity this artifact can verify.'
      )
    }
    return {
      sourceRepositoryURI,
      sourceDigest: attempt.head_sha,
      sourceRef,
      repositoryVisibility: repositoryMetadata.visibility,
      candidates,
    }
  }

  private getArtifactProvenanceReview(
    reviewId: string
  ): IActionsArtifactProvenanceReviewRecord {
    const review = this.provenanceReview
    if (
      !provenanceOpaqueIdPattern.test(reviewId) ||
      review === null ||
      review.reviewId !== reviewId ||
      review.closed
    ) {
      throw provenanceAbortError()
    }
    return review
  }

  private toArtifactProvenanceReview(
    review: IActionsArtifactProvenanceReviewRecord
  ): IActionsArtifactProvenanceReview {
    const material = review.material
    if (
      material === null ||
      review.inventoryId === null ||
      review.archiveDigest === null ||
      review.archiveBytes === null
    ) {
      throw provenanceReviewError('The artifact provenance review is incomplete.')
    }
    return {
      reviewId: review.reviewId,
      account: review.context.account,
      source: {
        repository: material.sourceRepositoryURI,
        digest: material.sourceDigest,
        ref: material.sourceRef,
        visibility: material.repositoryVisibility,
      },
      run: { id: review.context.runId, attempt: review.context.runAttempt },
      archive: { digest: review.archiveDigest, bytes: review.archiveBytes },
      inventoryId: review.inventoryId,
      entries: [...review.entries.values()],
      signerCandidates: [...review.signerCandidates.entries()].map(
        ([candidateId, candidate]) => ({
          candidateId,
          identity: candidate.identity,
          digest: candidate.digest,
          repository: candidate.repository,
          workflowPath: candidate.workflowPath,
          ref: candidate.ref,
          kind: candidate.kind,
        })
      ),
    }
  }

  public async downloadArtifact(
    repository: Repository,
    artifact: IActionsArtifact,
    destination: string,
    signal: AbortSignal,
    onProgress?: (progress: IActionsArtifactDownloadProgress) => void
  ): Promise<IActionsArtifactTransferSuccess> {
    try {
      const gitHubRepository = this.gitHubFor(repository)
      return await downloadActionsArtifactThroughMainProcess(
        this.accountFor(repository),
        gitHubRepository,
        artifact,
        destination,
        signal,
        onProgress
      )
    } catch (error) {
      throw actionsArtifactError(error, 'download')
    }
  }

  public fetchWorkflowSource(
    repository: Repository,
    workflow: IAPIWorkflow,
    ref?: string
  ) {
    const gitHubRepository = this.gitHubFor(repository)
    return this.apiFor(repository).fetchWorkflowFileContent(
      gitHubRepository.owner.login,
      gitHubRepository.name,
      workflow.path,
      ref
    )
  }

  public async dispatch(
    repository: Repository,
    workflowId: number,
    ref: string,
    inputs: Readonly<Record<string, string>>
  ) {
    const gitHubRepository = this.gitHubFor(repository)
    await this.apiFor(repository).dispatchWorkflow(
      gitHubRepository.owner.login,
      gitHubRepository.name,
      workflowId,
      ref,
      inputs
    )
    this.refresh(repository, true).catch(error =>
      log.error('Failed refreshing after workflow dispatch', error)
    )
    window.setTimeout(() => this.refresh(repository, true), 5000)
  }
}
