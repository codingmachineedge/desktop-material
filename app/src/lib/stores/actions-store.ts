import { Disposable } from 'event-kit'
import { Account, getAccountKey } from '../../models/account'
import { GitHubRepository } from '../../models/github-repository'
import { API, IAPIWorkflow, IAPIWorkflowJob, IAPIWorkflowRun } from '../api'
import { supportsActions } from '../endpoint-capabilities'
import { APIError } from '../http'
import { IActionsArtifact, IActionsArtifactList } from '../actions-artifacts'
import {
  IActionsArtifactDownloadProgress,
  IActionsArtifactDownloadResult,
} from '../actions-artifact-download'
import {
  downloadActionsArtifactThroughMainProcess,
  fetchActionsJobLogThroughMainProcess,
} from '../actions-transfer-client'
import { ActionsTransferError } from '../actions-transfer'
import { AccountsStore } from './accounts-store'
import { Repository } from '../../models/repository'
import { getAccountForRepository } from '../get-account-for-repository'

export type ActionsMutation =
  | 'rerun-job'
  | 'cancel-run'
  | 'force-cancel-run'
  | 'enable-workflow'
  | 'disable-workflow'

export type ActionsArtifactOperation = 'list' | 'attestations' | 'download'

const mutationLabels: Readonly<Record<ActionsMutation, string>> = {
  'rerun-job': 're-run this job',
  'cancel-run': 'cancel this workflow run',
  'force-cancel-run': 'force-cancel this workflow run',
  'enable-workflow': 'enable this workflow',
  'disable-workflow': 'disable this workflow',
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
  if (error.responseStatus === 403) {
    if (error.rateLimitReset !== null) {
      return new Error(
        `GitHub cannot ${action} until the API rate limit resets at ${error.rateLimitReset.toLocaleTimeString()}.`
      )
    }
    return new Error(
      `GitHub denied permission to ${action}. Check that the selected account has Actions write access to this repository.`
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
  return error
}

const artifactOperationLabels: Readonly<
  Record<ActionsArtifactOperation, string>
> = {
  list: 'load artifacts for this workflow run',
  attestations: 'check artifact attestation records',
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
  readonly loading: boolean
  readonly error: Error | null
  readonly rateLimitReset: Date | null
  readonly lastUpdated: Date | null
  readonly supported: boolean
}

export type ActionsStateCallback = (state: IActionsState) => void

interface IActionsSubscription {
  readonly repository: Repository
  readonly callbacks: Set<ActionsStateCallback>
}

const RefreshInterval = 60 * 1000

const emptyState = (supported: boolean): IActionsState => ({
  workflows: [],
  runs: [],
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

/**
 * Repository Actions cache with focus/visibility-gated polling and in-flight
 * request suppression. UI components subscribe only while the Actions tab is
 * mounted, so background traffic stops as soon as it is hidden.
 */
export class ActionsStore {
  private accounts: ReadonlyArray<Account> = []
  private accountsGeneration = 0
  private readonly states = new Map<string, IActionsState>()
  private readonly subscriptions = new Map<string, IActionsSubscription>()
  private readonly inFlight = new Map<string, Promise<void>>()
  private refreshHandle: number | null = null

  public constructor(accountsStore: AccountsStore) {
    accountsStore.getAll().then(this.onAccountsUpdated)
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
    this.states.clear()
    this.inFlight.clear()

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
    const refresh = this.performRefresh(
      repository,
      existing,
      generation
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
    accountsGeneration: number
  ) {
    this.notify(repository, { ...existing, loading: true, error: null })
    try {
      const api = this.apiFor(repository)
      const gitHubRepository = this.gitHubFor(repository)
      const owner = gitHubRepository.owner.login
      const [workflows, runs] = await Promise.all([
        api.fetchWorkflows(owner, gitHubRepository.name),
        api.fetchWorkflowRuns(owner, gitHubRepository.name),
      ])
      if (accountsGeneration !== this.accountsGeneration) {
        return
      }
      const nextRuns = workflowRunsEqual(existing.runs, runs.workflow_runs)
        ? existing.runs
        : runs.workflow_runs
      this.notify(repository, {
        workflows: workflows.workflows,
        runs: nextRuns,
        loading: false,
        error: null,
        rateLimitReset: null,
        lastUpdated: new Date(),
        supported: true,
      })
    } catch (error) {
      if (accountsGeneration !== this.accountsGeneration) {
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
      const succeeded = await this.apiFor(repository).rerunJob(
        gitHubRepository.owner.login,
        gitHubRepository.name,
        jobId
      )
      if (!succeeded) {
        throw new Error('GitHub could not re-run this failed job.')
      }
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
    signal?: AbortSignal
  ): Promise<IActionsArtifactList> {
    try {
      const gitHubRepository = this.gitHubFor(repository)
      return await this.apiFor(repository).fetchWorkflowRunArtifacts(
        gitHubRepository.owner.login,
        gitHubRepository.name,
        runId,
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

  public async downloadArtifact(
    repository: Repository,
    artifact: IActionsArtifact,
    destination: string,
    signal: AbortSignal,
    onProgress?: (progress: IActionsArtifactDownloadProgress) => void
  ): Promise<IActionsArtifactDownloadResult> {
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
