import { Account, getAccountKey } from '../../models/account'
import { Repository } from '../../models/repository'
import { createHash } from 'crypto'
import { API, getHTMLURL } from '../api'
import { APIError } from '../http'
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

export type ProviderTriageAccountStatus =
  | 'none'
  | 'ready'
  | 'associating'
  | 'signed-out'
  | 'selection-required'
  | 'binding-invalid'
  | 'binding-mismatch'
  | 'authentication'
  | 'permission'
  | 'sso'

export interface IProviderTriageAccountOption {
  readonly accountKey: string
  readonly label: string
  readonly provider: Account['provider']
}

export interface IProviderTriageState {
  readonly status: ProviderTriageStatus
  readonly repositoryKey: string | null
  readonly repositoryName: string | null
  readonly accountKey: string | null
  readonly accountLogin: string | null
  readonly provider: Account['provider'] | null
  readonly accountStatus: ProviderTriageAccountStatus
  readonly accountOptions: ReadonlyArray<IProviderTriageAccountOption>
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
  accountStatus: 'none',
  accountOptions: [],
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
  readonly shouldAssociate: boolean
}

interface IUnavailableProviderTriageTarget {
  readonly message: string
  readonly accountStatus: ProviderTriageAccountStatus
  readonly accountOptions: ReadonlyArray<IProviderTriageAccountOption>
  readonly accountKey: string | null
}

type ProviderTriageTarget =
  | IResolvedProviderTriageTarget
  | IUnavailableProviderTriageTarget

export type AssociateProviderTriageAccount = (
  repository: Repository,
  accountKey: string
) => Promise<Repository>

function normalizeProviderEndpoint(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null
    }
    url.search = ''
    url.hash = ''
    url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function normalizedAccountKey(value: string): string | null {
  const separator = value.lastIndexOf('#')
  if (separator <= 0) {
    return null
  }
  const endpoint = normalizeProviderEndpoint(value.slice(0, separator))
  const idText = value.slice(separator + 1).trim()
  const id = Number(idText)
  return endpoint === null || !/^\d+$/.test(idText) || !Number.isSafeInteger(id)
    ? null
    : `${endpoint}#${id}`
}

function accountKeysEqual(left: string, right: string): boolean {
  const normalizedLeft = normalizedAccountKey(left)
  const normalizedRight = normalizedAccountKey(right)
  return (
    normalizedLeft !== null &&
    normalizedRight !== null &&
    normalizedLeft === normalizedRight
  )
}

function endpointProvider(endpoint: string): Account['provider'] | null {
  const normalized = normalizeProviderEndpoint(endpoint)
  if (normalized === null) {
    return null
  }
  const url = new URL(normalized)
  if (
    url.hostname === 'api.bitbucket.org' &&
    url.pathname.replace(/\/+$/, '') === '/2.0'
  ) {
    return 'bitbucket'
  }
  if (url.pathname.replace(/\/+$/, '').endsWith('/api/v4')) {
    return 'gitlab'
  }
  return 'github'
}

function isUsableAccount(account: Account): boolean {
  return (
    Number.isSafeInteger(account.id) &&
    account.id >= 0 &&
    account.login.trim() !== '' &&
    account.token.trim() !== '' &&
    normalizeProviderEndpoint(account.endpoint) !== null
  )
}

function accountOption(account: Account): IProviderTriageAccountOption {
  return {
    accountKey: getAccountKey(account),
    label: `${providerTriageProviderLabel(account.provider)} · ${
      account.login
    }`,
    provider: account.provider,
  }
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
        accountKey === null
          ? null
          : normalizedAccountKey(accountKey) ?? accountKey,
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
  message: string,
  accountStatus: ProviderTriageAccountStatus,
  accountOptions: ReadonlyArray<IProviderTriageAccountOption> = [],
  accountKey: string | null = null
): IProviderTriageState {
  return {
    ...initialState,
    status: 'unavailable',
    repositoryKey,
    repositoryName,
    accountKey,
    accountStatus,
    accountOptions,
    message,
  }
}

function resolveTarget(
  repository: Repository,
  accounts: ReadonlyArray<Account>,
  requestedAccountKey: string | null = null
): ProviderTriageTarget {
  const remote = repository.gitHubRepository
  if (remote === null) {
    return {
      message: 'Triage needs a hosted repository association.',
      accountStatus: 'binding-invalid',
      accountOptions: [],
      accountKey: repository.accountKey,
    }
  }

  const remoteEndpoint = normalizeProviderEndpoint(remote.endpoint)
  const remoteProvider = endpointProvider(remote.endpoint)
  if (remoteEndpoint === null || remoteProvider === null) {
    return {
      message: 'This repository has an invalid provider association.',
      accountStatus: 'binding-invalid',
      accountOptions: [],
      accountKey: repository.accountKey,
    }
  }

  let account: Account | undefined
  let shouldAssociate = false
  if (repository.accountKey !== null) {
    account = accounts.find(candidate =>
      accountKeysEqual(getAccountKey(candidate), repository.accountKey!)
    )
    if (account === undefined) {
      return {
        message:
          'The account selected for this repository is no longer signed in. Sign in again or manage accounts without replacing the saved repository binding.',
        accountStatus: 'authentication',
        accountOptions: [],
        accountKey: repository.accountKey,
      }
    }
    if (!isUsableAccount(account)) {
      return {
        message:
          'The account selected for this repository needs to sign in again.',
        accountStatus: 'authentication',
        accountOptions: [],
        accountKey: repository.accountKey,
      }
    }
  } else {
    const endpointMatches = accounts.filter(
      candidate =>
        isUsableAccount(candidate) &&
        candidate.provider === remoteProvider &&
        normalizeProviderEndpoint(candidate.endpoint) === remoteEndpoint
    )
    if (endpointMatches.length === 0) {
      return {
        message:
          'Sign in to the repository provider or manage accounts before loading triage.',
        accountStatus: 'signed-out',
        accountOptions: [],
        accountKey: null,
      }
    }
    if (requestedAccountKey !== null) {
      account = endpointMatches.find(candidate =>
        accountKeysEqual(getAccountKey(candidate), requestedAccountKey)
      )
      if (account === undefined) {
        return {
          message:
            'The selected account changed before it could be saved. Choose the repository account again.',
          accountStatus: 'selection-required',
          accountOptions: endpointMatches.map(accountOption),
          accountKey: null,
        }
      }
      shouldAssociate = true
    } else if (endpointMatches.length > 1) {
      return {
        message:
          "You're signed in, but this repository isn't assigned to an account yet. Choose an exact account to bind before loading triage.",
        accountStatus: 'selection-required',
        accountOptions: endpointMatches.map(accountOption),
        accountKey: null,
      }
    } else {
      shouldAssociate = true
      account = endpointMatches[0]
    }
  }

  if (
    account.provider !== remoteProvider ||
    normalizeProviderEndpoint(account.endpoint) !== remoteEndpoint
  ) {
    return {
      message:
        'The saved repository account does not match this repository provider. Choose a repository account without replacing the valid saved binding automatically.',
      accountStatus: 'binding-mismatch',
      accountOptions: [],
      accountKey: repository.accountKey,
    }
  }
  return {
    account,
    owner: remote.owner.login,
    name: remote.name,
    repositoryKey: repositoryStateKey(repository, getAccountKey(account))!,
    shouldAssociate,
  }
}

type ProviderTriageAuthorizationFailure =
  | 'authentication'
  | 'permission'
  | 'sso'

function authorizationFailure(
  error: unknown
): ProviderTriageAuthorizationFailure | null {
  if (!(error instanceof APIError)) {
    return null
  }
  if (error.responseStatus === 401) {
    return 'authentication'
  }
  if (
    error.responseStatus === 403 &&
    error.rateLimitReset === null &&
    /(?:saml|single[ -]sign[ -]on|\bsso\b)/i.test(error.apiError?.message ?? '')
  ) {
    return 'sso'
  }
  if (
    (error.responseStatus === 403 && error.rateLimitReset === null) ||
    error.responseStatus === 404
  ) {
    return 'permission'
  }
  return null
}

function channelError(
  provider: Account['provider'],
  kind: ProviderTriageKind,
  failure: ProviderTriageAuthorizationFailure | null = null
): IProviderTriageChannelState {
  const noun = kind === 'issue' ? 'Issues' : 'Pull requests'
  const providerLabel = providerTriageProviderLabel(provider)
  return {
    status: 'error',
    capped: false,
    message:
      failure === 'authentication'
        ? `${noun} need the selected ${providerLabel} account to sign in again.`
        : failure === 'sso'
        ? `${noun} need organization SSO authorization for the selected ${providerLabel} account.`
        : failure === 'permission'
        ? `${noun} are not accessible to the selected ${providerLabel} account.`
        : `${noun} could not be loaded safely from ${providerLabel}.`,
  }
}

function authorizationMessage(
  provider: Account['provider'],
  failure: ProviderTriageAuthorizationFailure
): string {
  const providerLabel = providerTriageProviderLabel(provider)
  switch (failure) {
    case 'authentication':
      return `The repository-bound ${providerLabel} account needs to sign in again before triage can refresh.`
    case 'permission':
      return `The repository-bound ${providerLabel} account does not have permission to load all triage data. Check repository access or re-authenticate that account.`
    case 'sso':
      return `The repository-bound ${providerLabel} account needs organization SSO authorization before triage can refresh.`
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
  private repositoryFingerprint: string | null = null
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
        : accounts.find(account =>
            accountKeysEqual(getAccountKey(account), selected)
          )
    if (selected !== null && current === undefined) {
      this.cancelCurrent(false)
      this.selectedAccountKey = null
      this.selectedAccountFingerprint = null
      this.state = unavailableState(
        this.state.repositoryKey,
        this.state.repositoryName,
        'The account selected for this repository was signed out. Sign in again or manage accounts without replacing the saved repository binding.',
        'authentication',
        [],
        selected
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
    externalSignal?: AbortSignal,
    associateAccount?: AssociateProviderTriageAccount,
    requestedAccountKey: string | null = null
  ): Promise<void> {
    this.cancelCurrent(false)
    const generation = this.generation
    let effectiveRepository = repository
    let remote = effectiveRepository.gitHubRepository
    const provisionalKey = repositoryStateKey(
      effectiveRepository,
      effectiveRepository.accountKey
    )
    let resolved = resolveTarget(
      effectiveRepository,
      accounts,
      requestedAccountKey
    )
    if ('message' in resolved) {
      this.selectedAccountKey = null
      this.selectedAccountFingerprint = null
      this.repositoryFingerprint = effectiveRepository.hash
      this.state = unavailableState(
        provisionalKey,
        remote?.fullName ?? effectiveRepository.name,
        resolved.message,
        resolved.accountStatus,
        resolved.accountOptions,
        resolved.accountKey
      )
      this.emitUpdate()
      return
    }

    if (resolved.shouldAssociate) {
      const associationAccount = resolved.account
      const accountKey = getAccountKey(associationAccount)
      if (associateAccount === undefined) {
        this.selectedAccountKey = null
        this.selectedAccountFingerprint = null
        this.repositoryFingerprint = effectiveRepository.hash
        this.state = unavailableState(
          provisionalKey,
          remote?.fullName ?? effectiveRepository.name,
          "You're signed in, but this repository isn't assigned to an account yet. Confirm the exact account to save before loading triage.",
          'selection-required',
          [accountOption(associationAccount)]
        )
        this.emitUpdate()
        return
      }

      this.repositoryFingerprint = effectiveRepository.hash
      this.selectedAccountKey = accountKey
      this.selectedAccountFingerprint =
        accountSnapshotFingerprint(associationAccount)
      this.state = {
        ...initialState,
        status: 'loading',
        repositoryKey: resolved.repositoryKey,
        repositoryName: `${resolved.owner}/${resolved.name}`,
        accountKey,
        accountLogin: associationAccount.login,
        provider: associationAccount.provider,
        accountStatus: 'associating',
        message: `Saving ${associationAccount.login} as this repository's account…`,
      }
      this.emitUpdate()

      try {
        const associated = await associateAccount(
          effectiveRepository,
          accountKey
        )
        if (generation !== this.generation) {
          return
        }
        if (
          associated.id !== effectiveRepository.id ||
          associated.gitHubRepository?.hash !==
            effectiveRepository.gitHubRepository?.hash ||
          associated.accountKey === null ||
          !accountKeysEqual(associated.accountKey, accountKey)
        ) {
          this.state = unavailableState(
            provisionalKey,
            remote?.fullName ?? effectiveRepository.name,
            'The repository account changed before it could be saved. Refresh and choose the account again.',
            'selection-required',
            [accountOption(associationAccount)]
          )
          this.emitUpdate()
          return
        }
        effectiveRepository = associated
        remote = associated.gitHubRepository
        resolved = resolveTarget(effectiveRepository, accounts)
        if ('message' in resolved || resolved.shouldAssociate) {
          this.state = unavailableState(
            repositoryStateKey(
              effectiveRepository,
              effectiveRepository.accountKey
            ),
            remote?.fullName ?? effectiveRepository.name,
            'The saved repository account could not be revalidated. Refresh and choose the account again.',
            'binding-invalid',
            [],
            effectiveRepository.accountKey
          )
          this.emitUpdate()
          return
        }
      } catch {
        if (generation !== this.generation) {
          return
        }
        this.state = unavailableState(
          provisionalKey,
          remote?.fullName ?? effectiveRepository.name,
          'Desktop could not save the repository account. Retry or open Repository settings.',
          'selection-required',
          [accountOption(associationAccount)]
        )
        this.emitUpdate()
        return
      }
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
    this.repositoryFingerprint = effectiveRepository.hash
    this.selectedAccountKey = accountKey
    this.selectedAccountFingerprint = accountSnapshotFingerprint(account)
    this.state = {
      status: 'loading',
      repositoryKey,
      repositoryName: `${owner}/${name}`,
      accountKey,
      accountLogin: account.login,
      provider: account.provider,
      accountStatus: 'ready',
      accountOptions: [],
      items: [],
      issues: loadingChannel,
      pullRequests: loadingChannel,
      message: null,
      refreshedAt: null,
    }
    this.emitUpdate()

    try {
      const api = this.dependencies.apiFor(account)
      if (
        generation !== this.generation ||
        this.repositoryFingerprint !== effectiveRepository.hash ||
        this.selectedAccountFingerprint !== accountSnapshotFingerprint(account)
      ) {
        return
      }
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
        this.state.repositoryKey !== repositoryKey ||
        this.repositoryFingerprint !== effectiveRepository.hash ||
        this.selectedAccountFingerprint !== accountSnapshotFingerprint(account)
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
      let issuesAuthorization: ProviderTriageAuthorizationFailure | null = null
      let pullRequestsAuthorization: ProviderTriageAuthorizationFailure | null =
        null

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
        issuesAuthorization = authorizationFailure(issuesResult.reason)
        issuesState = channelError(
          account.provider,
          'issue',
          issuesAuthorization
        )
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
        pullRequestsAuthorization = authorizationFailure(
          pullRequestsResult.reason
        )
        pullRequestsState = channelError(
          account.provider,
          'pull-request',
          pullRequestsAuthorization
        )
      }

      const failedChannels = [issuesState, pullRequestsState].filter(
        channel => channel.status === 'error'
      ).length
      const usableChannels = [issuesState, pullRequestsState].filter(
        channel =>
          channel.status === 'ready' || channel.status === 'unsupported'
      ).length
      const authorization = [issuesAuthorization, pullRequestsAuthorization]
        .filter(
          (failure): failure is ProviderTriageAuthorizationFailure =>
            failure !== null
        )
        .sort((left, right) => {
          const priority: Readonly<
            Record<ProviderTriageAuthorizationFailure, number>
          > = { sso: 0, authentication: 1, permission: 2 }
          return priority[left] - priority[right]
        })[0]
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
        accountStatus: authorization ?? 'ready',
        message:
          authorization !== undefined
            ? authorizationMessage(account.provider, authorization)
            : failedChannels === 0
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
        accountStatus: 'ready',
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
