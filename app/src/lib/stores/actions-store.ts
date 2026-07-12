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
import { AccountsStore } from './accounts-store'

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
      this.states.get(key) ?? emptyState(supportsActions(repository.endpoint))
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
    if (account === null) {
      throw new Error(`Sign in to ${repository.endpoint} to use Actions.`)
    }
    return API.fromAccount(account)
  }

  public async refresh(
    repository: GitHubRepository,
    force: boolean = false
  ): Promise<void> {
    const key = getActionsRepositoryKey(repository)
    const existing =
      this.states.get(key) ?? emptyState(supportsActions(repository.endpoint))
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
