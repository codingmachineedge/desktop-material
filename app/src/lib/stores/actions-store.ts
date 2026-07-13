import { Disposable } from 'event-kit'
import { Account } from '../../models/account'
import { GitHubRepository } from '../../models/github-repository'
import {
  API,
  IAPIWorkflow,
  IAPIWorkflowJob,
  IAPIWorkflowRun,
  getAccountForEndpoint,
} from '../api'
import { supportsActions } from '../endpoint-capabilities'
import { APIError } from '../http'
import { IActionsArtifact, IActionsArtifactList } from '../actions-artifacts'
import {
  downloadActionsArtifactArchive,
  IActionsArtifactDownloadProgress,
  IActionsArtifactDownloadResult,
} from '../actions-artifact-download'
import { AccountsStore } from './accounts-store'

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
  if (!(error instanceof APIError)) {
    return error instanceof Error ? error : new Error(String(error))
  }

  const action = artifactOperationLabels[operation]
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
      `GitHub denied permission to ${action}. Check that the selected account has Actions read access to this repository.`
    )
  }
  if (error.responseStatus === 404) {
    return new Error(
      `GitHub could not ${action}. The artifact may no longer exist, the account may not have access, or this GitHub Enterprise version may not support the operation.`
    )
  }
  if (error.responseStatus === 410) {
    return new Error(
      'This artifact has expired and can no longer be downloaded.'
    )
  }
  if (error.responseStatus >= 500) {
    return new Error(
      `GitHub could not ${action} because the service returned an error (${error.responseStatus}). Retry in a moment.`
    )
  }
  return new Error(
    `GitHub could not ${action} (HTTP ${error.responseStatus}). Refresh and retry.`
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
  readonly repository: GitHubRepository
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

export function getActionsRepositoryKey(repository: GitHubRepository): string {
  return `${repository.endpoint}/${repository.owner.login}/${repository.name}`
}

/** GitHub Actions is available only for GitHub-backed authenticated accounts. */
export function accountSupportsActions(
  repository: GitHubRepository,
  accounts: ReadonlyArray<Account>
): boolean {
  const account = getAccountForEndpoint(accounts, repository.endpoint)
  return account?.provider === 'github' && supportsActions(repository.endpoint)
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
    this.accounts = accounts
  }

  public subscribe(
    repository: GitHubRepository,
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

  private notify(repository: GitHubRepository, state: IActionsState) {
    const key = getActionsRepositoryKey(repository)
    this.states.set(key, state)
    this.subscriptions.get(key)?.callbacks.forEach(callback => callback(state))
  }

  private apiFor(repository: GitHubRepository): API {
    const account = getAccountForEndpoint(this.accounts, repository.endpoint)
    if (account === null || account.provider !== 'github') {
      throw new Error(`Sign in to ${repository.endpoint} to use Actions.`)
    }
    if (!supportsActions(repository.endpoint)) {
      throw new Error(
        'GitHub Actions is not available on this GitHub Enterprise version.'
      )
    }
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
    repository: GitHubRepository,
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

    const refresh = this.performRefresh(repository, existing).finally(() =>
      this.inFlight.delete(key)
    )
    this.inFlight.set(key, refresh)
    return refresh
  }

  private async performRefresh(
    repository: GitHubRepository,
    existing: IActionsState
  ) {
    this.notify(repository, { ...existing, loading: true, error: null })
    try {
      const api = this.apiFor(repository)
      const owner = repository.owner.login
      const [workflows, runs] = await Promise.all([
        api.fetchWorkflows(owner, repository.name),
        api.fetchWorkflowRuns(owner, repository.name),
      ])
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
      const failure = error instanceof Error ? error : new Error(String(error))
      this.notify(repository, {
        ...existing,
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

  public async rerun(repository: GitHubRepository, runId: number) {
    await this.apiFor(repository).rerunWorkflowRun(
      repository.owner.login,
      repository.name,
      runId
    )
    await this.refresh(repository, true)
  }

  public async rerunFailed(repository: GitHubRepository, runId: number) {
    const succeeded = await this.apiFor(repository).rerunFailedJobs(
      repository.owner.login,
      repository.name,
      runId
    )
    if (!succeeded) {
      throw new Error('GitHub could not re-run the failed jobs.')
    }
    await this.refresh(repository, true)
  }

  public async rerunJob(repository: GitHubRepository, jobId: number) {
    await this.mutate('rerun-job', async () => {
      const succeeded = await this.apiFor(repository).rerunJob(
        repository.owner.login,
        repository.name,
        jobId
      )
      if (!succeeded) {
        throw new Error('GitHub could not re-run this failed job.')
      }
    })
    await this.refresh(repository, true)
  }

  public async cancelRun(
    repository: GitHubRepository,
    runId: number,
    force: boolean
  ) {
    await this.mutate(force ? 'force-cancel-run' : 'cancel-run', () =>
      this.apiFor(repository).cancelWorkflowRun(
        repository.owner.login,
        repository.name,
        runId,
        force
      )
    )
    await this.refresh(repository, true)
  }

  public async setWorkflowEnabled(
    repository: GitHubRepository,
    workflowId: number,
    enabled: boolean
  ) {
    await this.mutate(enabled ? 'enable-workflow' : 'disable-workflow', () =>
      this.apiFor(repository).setWorkflowEnabled(
        repository.owner.login,
        repository.name,
        workflowId,
        enabled
      )
    )
    await this.refresh(repository, true)
  }

  public async fetchJobs(
    repository: GitHubRepository,
    runId: number
  ): Promise<ReadonlyArray<IAPIWorkflowJob>> {
    const result = await this.apiFor(repository).fetchWorkflowRunJobs(
      repository.owner.login,
      repository.name,
      runId
    )
    return result?.jobs ?? []
  }

  public fetchJobLogs(repository: GitHubRepository, jobId: number) {
    return this.apiFor(repository).fetchWorkflowJobLogs(
      repository.owner.login,
      repository.name,
      jobId
    )
  }

  public async fetchArtifacts(
    repository: GitHubRepository,
    runId: number,
    signal?: AbortSignal
  ): Promise<IActionsArtifactList> {
    try {
      return await this.apiFor(repository).fetchWorkflowRunArtifacts(
        repository.owner.login,
        repository.name,
        runId,
        signal
      )
    } catch (error) {
      throw actionsArtifactError(error, 'list')
    }
  }

  public async fetchArtifactAttestationPresence(
    repository: GitHubRepository,
    digest: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    try {
      return await this.apiFor(repository).fetchArtifactAttestationPresence(
        repository.owner.login,
        repository.name,
        digest,
        signal
      )
    } catch (error) {
      throw actionsArtifactError(error, 'attestations')
    }
  }

  public async downloadArtifact(
    repository: GitHubRepository,
    artifact: IActionsArtifact,
    destination: string,
    signal: AbortSignal,
    onProgress?: (progress: IActionsArtifactDownloadProgress) => void
  ): Promise<IActionsArtifactDownloadResult> {
    try {
      const response = await this.apiFor(
        repository
      ).fetchWorkflowArtifactArchive(
        repository.owner.login,
        repository.name,
        artifact.id,
        signal
      )
      return await downloadActionsArtifactArchive({
        artifact,
        response,
        destination,
        signal,
        onProgress,
      })
    } catch (error) {
      throw actionsArtifactError(error, 'download')
    }
  }

  public fetchWorkflowSource(
    repository: GitHubRepository,
    workflow: IAPIWorkflow,
    ref?: string
  ) {
    return this.apiFor(repository).fetchWorkflowFileContent(
      repository.owner.login,
      repository.name,
      workflow.path,
      ref
    )
  }

  public async dispatch(
    repository: GitHubRepository,
    workflowId: number,
    ref: string,
    inputs: Readonly<Record<string, string>>
  ) {
    await this.apiFor(repository).dispatchWorkflow(
      repository.owner.login,
      repository.name,
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
