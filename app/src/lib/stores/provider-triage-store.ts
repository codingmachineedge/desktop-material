import { Account, getAccountKey } from '../../models/account'
import { Repository } from '../../models/repository'
import { createHash } from 'crypto'
import { API, getHTMLURL } from '../api'
import {
  IAPIProviderTriagePage,
  IProviderTriageItem,
  normalizeProviderTriagePage,
  ProviderTriageKind,
  ProviderTriagePageLimit,
  providerTriageProviderLabel,
} from '../provider-triage'
import { BaseStore } from './base-store'

export type ProviderTriageChannelStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'unsupported'
  | 'error'

export interface IProviderTriageChannelState {
  readonly status: ProviderTriageChannelStatus
  readonly capped: boolean
  readonly message: string | null
}

export type ProviderTriageStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'partial'
  | 'unavailable'
  | 'error'

export interface IProviderTriageState {
  readonly status: ProviderTriageStatus
  readonly repositoryKey: string | null
  readonly repositoryName: string | null
  readonly accountKey: string | null
  readonly accountLogin: string | null
  readonly provider: Account['provider'] | null
  readonly items: ReadonlyArray<IProviderTriageItem>
  readonly issues: IProviderTriageChannelState
  readonly pullRequests: IProviderTriageChannelState
  readonly message: string | null
  readonly refreshedAt: Date | null
}

export interface IProviderTriageAPI {
  fetchProviderTriageIssues(
    owner: string,
    name: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<IAPIProviderTriagePage>
  fetchProviderTriagePullRequests(
    owner: string,
    name: string,
    limit: number,
    signal?: AbortSignal
  ): Promise<IAPIProviderTriagePage>
}

export interface IProviderTriageStoreDependencies {
  readonly apiFor: (account: Account) => IProviderTriageAPI
  readonly htmlURLForEndpoint: (endpoint: string) => string
  readonly now: () => Date
}

const defaultDependencies: IProviderTriageStoreDependencies = {
  apiFor: account => API.fromAccount(account),
  htmlURLForEndpoint: endpoint => getHTMLURL(endpoint),
  now: () => new Date(),
}

const idleChannel: IProviderTriageChannelState = {
  status: 'idle',
  capped: false,
  message: null,
}

const loadingChannel: IProviderTriageChannelState = {
  status: 'loading',
  capped: false,
  message: null,
}

const initialState: IProviderTriageState = {
  status: 'idle',
  repositoryKey: null,
  repositoryName: null,
  accountKey: null,
  accountLogin: null,
  provider: null,
  items: [],
  issues: idleChannel,
  pullRequests: idleChannel,
  message: null,
  refreshedAt: null,
}

interface IResolvedProviderTriageTarget {
  readonly account: Account
  readonly owner: string
  readonly name: string
  readonly repositoryKey: string
}

function repositoryStateKey(
  repository: Repository,
  accountKey: string | null
): string | null {
  const remote = repository.gitHubRepository
  if (remote === null) {
    return null
  }
  return `triage-repository-${createHash('sha256')
    .update(
      JSON.stringify([
        repository.id,
        remote.endpoint,
        remote.owner.login,
        remote.name,
        accountKey,
      ])
    )
    .digest('hex')
    .slice(0, 24)}`
}

function accountSnapshotFingerprint(account: Account): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        getAccountKey(account),
        account.provider,
        account.login,
        account.token,
      ])
    )
    .digest('hex')
}

function unavailableState(
  repositoryKey: string | null,
  repositoryName: string | null,
  message: string
): IProviderTriageState {
  return {
    ...initialState,
    status: 'unavailable',
    repositoryKey,
    repositoryName,
    message,
  }
}

function resolveTarget(
  repository: Repository,
  accounts: ReadonlyArray<Account>
): IResolvedProviderTriageTarget | string {
  const remote = repository.gitHubRepository
  if (remote === null) {
    return 'Triage needs a hosted repository association.'
  }

  let account: Account | undefined
  if (repository.accountKey !== null) {
    account = accounts.find(
      candidate => getAccountKey(candidate) === repository.accountKey
    )
    if (account === undefined) {
      return 'The account selected for this repository is no longer signed in.'
    }
  } else {
    const endpointMatches = accounts.filter(
      candidate => candidate.endpoint === remote.endpoint
    )
    if (endpointMatches.length !== 1) {
      return endpointMatches.length === 0
        ? 'Sign in to the repository provider before loading triage.'
        : 'Choose an exact account for this repository before loading triage.'
    }
    account = endpointMatches[0]
  }

  if (account.endpoint !== remote.endpoint) {
    return 'The selected account does not match this repository provider.'
  }
  return {
    account,
    owner: remote.owner.login,
    name: remote.name,
    repositoryKey: repositoryStateKey(repository, getAccountKey(account))!,
  }
}

function channelError(
  provider: Account['provider'],
  kind: ProviderTriageKind
): IProviderTriageChannelState {
  const noun = kind === 'issue' ? 'Issues' : 'Pull requests'
  return {
    status: 'error',
    capped: false,
    message: `${noun} could not be loaded safely from ${providerTriageProviderLabel(
      provider
    )}.`,
  }
}

function channelFromPage(
  page: IAPIProviderTriagePage,
  provider: Account['provider'],
  kind: ProviderTriageKind
): IProviderTriageChannelState {
  if (!page.supported) {
    return {
      status: 'unsupported',
      capped: false,
      message: `${providerTriageProviderLabel(provider)} does not expose ${
        kind === 'issue' ? 'issues' : 'pull requests'
      } through this Desktop triage adapter.`,
    }
  }
  return {
    status: 'ready',
    capped: page.capped,
    message: page.capped
      ? `Showing the newest ${ProviderTriagePageLimit} ${
          kind === 'issue' ? 'issues' : 'pull requests'
        }.`
      : null,
  }
}

function isAbortError(error: unknown): boolean {
  return (error as Error)?.name === 'AbortError'
}

/**
 * Coordinates one current-repository triage load. It retains only normalized
 * presentation data; Account objects (and therefore tokens) stay on the stack.
 */
export class ProviderTriageStore extends BaseStore {
  private state: IProviderTriageState = initialState
  private generation = 0
  private controller: AbortController | null = null
  private selectedAccountKey: string | null = null
  private selectedAccountFingerprint: string | null = null

  public constructor(
    private readonly dependencies: IProviderTriageStoreDependencies = defaultDependencies
  ) {
    super()
  }

  public getState(): IProviderTriageState {
    return this.state
  }

  public updateAccounts(accounts: ReadonlyArray<Account>): void {
    const selected = this.selectedAccountKey
    const current =
      selected === null
        ? undefined
        : accounts.find(account => getAccountKey(account) === selected)
    if (selected !== null && current === undefined) {
      this.cancelCurrent(false)
      this.selectedAccountKey = null
      this.selectedAccountFingerprint = null
      this.state = unavailableState(
        this.state.repositoryKey,
        this.state.repositoryName,
        'The account selected for this repository was signed out. Sign in or choose another account.'
      )
      this.emitUpdate()
      return
    }
    if (
      current !== undefined &&
      this.selectedAccountFingerprint !== null &&
      accountSnapshotFingerprint(current) !== this.selectedAccountFingerprint
    ) {
      this.cancelCurrent(false)
      this.selectedAccountFingerprint = null
      this.state = {
        ...this.state,
        status: 'idle',
        items: [],
        issues: idleChannel,
        pullRequests: idleChannel,
        accountLogin: current.login,
        provider: current.provider,
        message: 'The selected account session changed. Refreshing triage…',
        refreshedAt: null,
      }
      this.emitUpdate()
    }
  }

  private cancelCurrent(updateState: boolean): void {
    this.generation++
    this.controller?.abort()
    this.controller = null
    if (updateState && this.state.status === 'loading') {
      this.state = {
        ...this.state,
        status: 'idle',
        issues: idleChannel,
        pullRequests: idleChannel,
        message: 'Triage refresh canceled.',
      }
      this.emitUpdate()
    }
  }

  public cancel(): void {
    this.cancelCurrent(true)
  }

  public async load(
    repository: Repository,
    accounts: ReadonlyArray<Account>,
    externalSignal?: AbortSignal
  ): Promise<void> {
    this.cancelCurrent(false)
    const generation = this.generation
    const remote = repository.gitHubRepository
    const provisionalKey = repositoryStateKey(repository, null)
    const resolved = resolveTarget(repository, accounts)
    if (typeof resolved === 'string') {
      this.selectedAccountKey = null
      this.state = unavailableState(
        provisionalKey,
        remote?.fullName ?? repository.name,
        resolved
      )
      this.emitUpdate()
      return
    }

    const controller = new AbortController()
    this.controller = controller
    const onExternalAbort = () => controller.abort()
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
    if (externalSignal?.aborted === true) {
      controller.abort()
    }

    const { account, owner, name, repositoryKey } = resolved
    const accountKey = getAccountKey(account)
    this.selectedAccountKey = accountKey
    this.selectedAccountFingerprint = accountSnapshotFingerprint(account)
    this.state = {
      status: 'loading',
      repositoryKey,
      repositoryName: `${owner}/${name}`,
      accountKey,
      accountLogin: account.login,
      provider: account.provider,
      items: [],
      issues: loadingChannel,
      pullRequests: loadingChannel,
      message: null,
      refreshedAt: null,
    }
    this.emitUpdate()

    try {
      const api = this.dependencies.apiFor(account)
      const [issuesResult, pullRequestsResult] = await Promise.allSettled([
        api.fetchProviderTriageIssues(
          owner,
          name,
          ProviderTriagePageLimit,
          controller.signal
        ),
        api.fetchProviderTriagePullRequests(
          owner,
          name,
          ProviderTriagePageLimit,
          controller.signal
        ),
      ])
      if (
        controller.signal.aborted ||
        generation !== this.generation ||
        this.state.repositoryKey !== repositoryKey
      ) {
        if (
          controller.signal.aborted &&
          generation === this.generation &&
          this.state.status === 'loading'
        ) {
          this.state = {
            ...this.state,
            status: 'idle',
            issues: idleChannel,
            pullRequests: idleChannel,
            message: 'Triage refresh canceled.',
          }
          this.emitUpdate()
        }
        return
      }

      const now = this.dependencies.now()
      const htmlBaseURL = this.dependencies.htmlURLForEndpoint(account.endpoint)
      let issues = new Array<IProviderTriageItem>()
      let pullRequests = new Array<IProviderTriageItem>()
      let issuesState: IProviderTriageChannelState
      let pullRequestsState: IProviderTriageChannelState

      if (issuesResult.status === 'fulfilled') {
        try {
          issues = [
            ...normalizeProviderTriagePage(
              account.provider,
              htmlBaseURL,
              owner,
              name,
              accountKey,
              account.login,
              'issue',
              issuesResult.value,
              now
            ),
          ]
          issuesState = channelFromPage(
            issuesResult.value,
            account.provider,
            'issue'
          )
        } catch {
          issuesState = channelError(account.provider, 'issue')
        }
      } else {
        issuesState = channelError(account.provider, 'issue')
      }

      if (pullRequestsResult.status === 'fulfilled') {
        try {
          pullRequests = [
            ...normalizeProviderTriagePage(
              account.provider,
              htmlBaseURL,
              owner,
              name,
              accountKey,
              account.login,
              'pull-request',
              pullRequestsResult.value,
              now
            ),
          ]
          pullRequestsState = channelFromPage(
            pullRequestsResult.value,
            account.provider,
            'pull-request'
          )
        } catch {
          pullRequestsState = channelError(account.provider, 'pull-request')
        }
      } else {
        pullRequestsState = channelError(account.provider, 'pull-request')
      }

      const failedChannels = [issuesState, pullRequestsState].filter(
        channel => channel.status === 'error'
      ).length
      const usableChannels = [issuesState, pullRequestsState].filter(
        channel =>
          channel.status === 'ready' || channel.status === 'unsupported'
      ).length
      this.state = {
        ...this.state,
        status:
          failedChannels === 0
            ? 'ready'
            : usableChannels > 0
            ? 'partial'
            : 'error',
        items: [...issues, ...pullRequests],
        issues: issuesState,
        pullRequests: pullRequestsState,
        message:
          failedChannels === 0
            ? null
            : failedChannels === 1
            ? 'Some triage data could not be loaded. The available results are still shown.'
            : `${providerTriageProviderLabel(
                account.provider
              )} triage could not be loaded safely. Retry in a moment.`,
        refreshedAt: now,
      }
      this.emitUpdate()
    } catch (error) {
      if (
        isAbortError(error) ||
        controller.signal.aborted ||
        generation !== this.generation
      ) {
        return
      }
      this.state = {
        ...this.state,
        status: 'error',
        items: [],
        issues: channelError(account.provider, 'issue'),
        pullRequests: channelError(account.provider, 'pull-request'),
        message: `${providerTriageProviderLabel(
          account.provider
        )} triage could not be loaded safely. Retry in a moment.`,
        refreshedAt: this.dependencies.now(),
      }
      this.emitUpdate()
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort)
      if (generation === this.generation) {
        this.controller = null
      }
    }
  }
}
