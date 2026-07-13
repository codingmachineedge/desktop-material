import { Disposable } from 'event-kit'

import { Account, getAccountKey } from '../../models/account'
import {
  API,
  IAPINotificationThread,
  IAPINotificationsOptions,
  IAPINotificationsPage,
} from '../api'
import { APIError } from '../http'
import { TypedBaseStore } from './base-store'

export type GitHubNotificationsFilter = 'unread' | 'all'

export type GitHubNotificationsErrorKind =
  | 'authentication'
  | 'permission'
  | 'rate-limit'
  | 'network'
  | 'unknown'

export interface IGitHubNotificationsError {
  readonly kind: GitHubNotificationsErrorKind
  readonly message: string
  readonly rateLimitReset: Date | null
}

export interface IGitHubNotificationsState {
  readonly selectedAccountKey: string | null
  readonly filter: GitHubNotificationsFilter
  readonly participating: boolean
  readonly notifications: ReadonlyArray<IAPINotificationThread>
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly hasMore: boolean
  readonly page: number
  readonly busyThreadId: string | null
  readonly error: IGitHubNotificationsError | null
  readonly lastModified: string | null
  readonly lastUpdated: Date | null
  readonly nextRefreshAt: Date | null
}

export interface IGitHubNotificationsAPI {
  fetchNotifications(
    options: IAPINotificationsOptions
  ): Promise<IAPINotificationsPage>
  markNotificationThreadRead(
    threadId: string,
    signal?: AbortSignal
  ): Promise<void>
  markNotificationThreadDone(
    threadId: string,
    signal?: AbortSignal
  ): Promise<void>
}

export type GitHubNotificationsAPIFactory = (
  account: Account
) => IGitHubNotificationsAPI

export const GitHubNotificationsPageSize = 50
export const GitHubNotificationsMaxPages = 4
export const GitHubNotificationsMaxItems =
  GitHubNotificationsPageSize * GitHubNotificationsMaxPages

const createState = (
  selectedAccountKey: string | null
): IGitHubNotificationsState => ({
  selectedAccountKey,
  filter: 'unread',
  participating: false,
  notifications: [],
  loading: false,
  loadingMore: false,
  hasMore: false,
  page: 0,
  busyThreadId: null,
  error: null,
  lastModified: null,
  lastUpdated: null,
  nextRefreshAt: null,
})

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'

/** Convert API failures into safe, actionable inbox states. */
export function githubNotificationsError(
  error: unknown
): IGitHubNotificationsError {
  if (error instanceof APIError) {
    if (error.responseStatus === 401) {
      return {
        kind: 'authentication',
        message: 'GitHub could not authenticate this account. Sign in again.',
        rateLimitReset: null,
      }
    }
    if (
      error.responseStatus === 429 ||
      (error.responseStatus === 403 && error.rateLimitReset !== null)
    ) {
      return {
        kind: 'rate-limit',
        message:
          error.rateLimitReset === null
            ? 'GitHub is temporarily limiting notification requests. Try again later.'
            : `GitHub notification requests are limited until ${error.rateLimitReset.toLocaleTimeString()}.`,
        rateLimitReset: error.rateLimitReset,
      }
    }
    if (error.responseStatus === 403) {
      return {
        kind: 'permission',
        message:
          'GitHub denied notification access. This feature requires a classic user token with the notifications or repo scope; organization SSO may also need authorization.',
        rateLimitReset: null,
      }
    }
  }

  if (error instanceof TypeError) {
    return {
      kind: 'network',
      message:
        'GitHub notifications could not be reached. Check your connection.',
      rateLimitReset: null,
    }
  }

  return {
    kind: 'unknown',
    message: 'GitHub notifications could not be loaded. Try refreshing.',
    rateLimitReset: null,
  }
}

/**
 * On-demand, per-account GitHub inbox state. Remote threads never enter the
 * persisted local notification log.
 */
export class GitHubNotificationsStore extends TypedBaseStore<IGitHubNotificationsState> {
  private accounts: ReadonlyArray<Account>
  private state: IGitHubNotificationsState
  private active = false
  private contextGeneration = 0
  private loadRequestId = 0
  private loadController: AbortController | null = null
  private readonly mutationControllers = new Set<AbortController>()

  public constructor(
    accounts: ReadonlyArray<Account>,
    private readonly apiFactory: GitHubNotificationsAPIFactory = account =>
      API.fromAccount(account),
    private readonly now: () => Date = () => new Date()
  ) {
    super()
    this.accounts = this.githubAccounts(accounts)
    this.state = createState(this.firstAccountKey())
  }

  public subscribe(
    callback: (state: IGitHubNotificationsState) => void
  ): Disposable {
    callback(this.state)
    return this.onDidUpdate(callback)
  }

  public getState(): IGitHubNotificationsState {
    return this.state
  }

  public async start(): Promise<void> {
    if (this.active) {
      return
    }
    this.active = true
    await this.refresh(true)
  }

  public stop(): void {
    if (!this.active) {
      return
    }
    this.active = false
    this.cancelContext()
    this.update({ loading: false, loadingMore: false, busyThreadId: null })
  }

  public dispose(): void {
    this.stop()
    this.emitter.dispose()
  }

  public setAccounts(accounts: ReadonlyArray<Account>): void {
    const previous = this.accountForKey(this.state.selectedAccountKey)
    this.accounts = this.githubAccounts(accounts)
    const selectedStillExists = this.accountForKey(
      this.state.selectedAccountKey
    )
    const selectedAccountKey =
      selectedStillExists === null
        ? this.firstAccountKey()
        : this.state.selectedAccountKey
    const replacement = this.accountForKey(selectedAccountKey)
    const contextChanged =
      selectedAccountKey !== this.state.selectedAccountKey ||
      previous?.token !== replacement?.token

    if (!contextChanged) {
      return
    }

    void this.resetContext({ selectedAccountKey })
  }

  public async selectAccount(accountKey: string): Promise<void> {
    if (
      accountKey === this.state.selectedAccountKey ||
      this.accountForKey(accountKey) === null
    ) {
      return
    }
    await this.resetContext({ selectedAccountKey: accountKey })
  }

  public async setFilter(filter: GitHubNotificationsFilter): Promise<void> {
    if (filter === this.state.filter) {
      return
    }
    await this.resetContext({ filter })
  }

  public async setParticipating(participating: boolean): Promise<void> {
    if (participating === this.state.participating) {
      return
    }
    await this.resetContext({ participating })
  }

  public async refresh(force: boolean = false): Promise<void> {
    if (!this.active || this.state.selectedAccountKey === null) {
      return
    }
    if (
      !force &&
      this.state.nextRefreshAt !== null &&
      this.now() < this.state.nextRefreshAt
    ) {
      return
    }
    await this.loadPage(1, true)
  }

  public async loadMore(): Promise<void> {
    if (
      !this.active ||
      !this.state.hasMore ||
      this.state.loading ||
      this.state.loadingMore ||
      this.state.page >= GitHubNotificationsMaxPages
    ) {
      return
    }
    await this.loadPage(this.state.page + 1, false)
  }

  public async markThreadRead(threadId: string): Promise<boolean> {
    const thread = this.state.notifications.find(item => item.id === threadId)
    if (thread === undefined || !thread.unread) {
      return true
    }
    return this.mutateThread(threadId, 'read')
  }

  public async markThreadDone(threadId: string): Promise<boolean> {
    if (!this.state.notifications.some(item => item.id === threadId)) {
      return true
    }
    return this.mutateThread(threadId, 'done')
  }

  private githubAccounts(accounts: ReadonlyArray<Account>) {
    return accounts.filter(
      account => account.provider === 'github' && account.token.length > 0
    )
  }

  private firstAccountKey(): string | null {
    const first = this.accounts[0]
    return first === undefined ? null : getAccountKey(first)
  }

  private accountForKey(accountKey: string | null): Account | null {
    if (accountKey === null) {
      return null
    }
    return (
      this.accounts.find(account => getAccountKey(account) === accountKey) ??
      null
    )
  }

  private update(patch: Partial<IGitHubNotificationsState>): void {
    this.state = { ...this.state, ...patch }
    this.emitUpdate(this.state)
  }

  private async resetContext(
    patch: Partial<
      Pick<
        IGitHubNotificationsState,
        'selectedAccountKey' | 'filter' | 'participating'
      >
    >
  ): Promise<void> {
    const next = {
      ...createState(this.state.selectedAccountKey),
      filter: this.state.filter,
      participating: this.state.participating,
      ...patch,
    }
    this.cancelContext()
    this.state = next
    this.emitUpdate(this.state)
    if (this.active) {
      await this.refresh(true)
    }
  }

  private cancelContext(): void {
    this.contextGeneration++
    this.loadRequestId++
    this.loadController?.abort()
    this.loadController = null
    this.mutationControllers.forEach(controller => controller.abort())
    this.mutationControllers.clear()
  }

  private async loadPage(page: number, replace: boolean): Promise<void> {
    const account = this.accountForKey(this.state.selectedAccountKey)
    if (account === null) {
      return
    }

    const contextGeneration = this.contextGeneration
    const requestId = ++this.loadRequestId
    this.loadController?.abort()
    const controller = new AbortController()
    this.loadController = controller
    this.update({
      loading: replace,
      loadingMore: !replace,
      error: null,
    })

    try {
      const result = await this.apiFactory(account).fetchNotifications({
        includeRead: this.state.filter === 'all',
        participating: this.state.participating,
        page,
        perPage: GitHubNotificationsPageSize,
        lastModified: replace ? this.state.lastModified : null,
        signal: controller.signal,
      })
      if (!this.ownsLoad(contextGeneration, requestId, controller)) {
        return
      }

      const notifications = result.notModified
        ? this.state.notifications
        : replace
        ? result.notifications.slice(0, GitHubNotificationsMaxItems)
        : this.mergeNotifications(
            this.state.notifications,
            result.notifications
          ).slice(0, GitHubNotificationsMaxItems)
      const currentPage = result.notModified ? this.state.page : page
      const hasMore =
        !result.notModified &&
        result.hasNextPage &&
        currentPage < GitHubNotificationsMaxPages &&
        notifications.length < GitHubNotificationsMaxItems
      const updatedAt = this.now()
      const nextRefreshAt =
        result.pollIntervalSeconds === null
          ? null
          : new Date(updatedAt.getTime() + result.pollIntervalSeconds * 1000)
      this.update({
        notifications,
        page: currentPage,
        hasMore,
        loading: false,
        loadingMore: false,
        error: null,
        lastModified: result.lastModified ?? this.state.lastModified,
        lastUpdated: updatedAt,
        nextRefreshAt,
      })
    } catch (error) {
      if (
        !this.ownsLoad(contextGeneration, requestId, controller) ||
        isAbortError(error)
      ) {
        return
      }
      this.update({
        loading: false,
        loadingMore: false,
        error: githubNotificationsError(error),
      })
    } finally {
      if (this.ownsLoad(contextGeneration, requestId, controller)) {
        this.loadController = null
      }
    }
  }

  private ownsLoad(
    contextGeneration: number,
    requestId: number,
    controller: AbortController
  ): boolean {
    return (
      this.active &&
      contextGeneration === this.contextGeneration &&
      requestId === this.loadRequestId &&
      controller === this.loadController &&
      !controller.signal.aborted
    )
  }

  private mergeNotifications(
    existing: ReadonlyArray<IAPINotificationThread>,
    incoming: ReadonlyArray<IAPINotificationThread>
  ): ReadonlyArray<IAPINotificationThread> {
    const byId = new Map(existing.map(item => [item.id, item]))
    incoming.forEach(item => byId.set(item.id, item))
    return [...byId.values()]
  }

  private async mutateThread(
    threadId: string,
    action: 'read' | 'done'
  ): Promise<boolean> {
    const account = this.accountForKey(this.state.selectedAccountKey)
    if (account === null || this.state.busyThreadId !== null) {
      return false
    }

    const contextGeneration = this.contextGeneration
    const accountKey = getAccountKey(account)
    const controller = new AbortController()
    this.mutationControllers.add(controller)
    this.update({ busyThreadId: threadId, error: null })

    try {
      const api = this.apiFactory(account)
      if (action === 'read') {
        await api.markNotificationThreadRead(threadId, controller.signal)
      } else {
        await api.markNotificationThreadDone(threadId, controller.signal)
      }
      if (
        !this.ownsMutation(contextGeneration, accountKey, threadId, controller)
      ) {
        return false
      }

      const notifications =
        action === 'done'
          ? this.state.notifications.filter(item => item.id !== threadId)
          : this.state.notifications.map(item =>
              item.id === threadId ? { ...item, unread: false } : item
            )
      this.update({ notifications, busyThreadId: null, error: null })
      return true
    } catch (error) {
      if (
        !this.ownsMutation(
          contextGeneration,
          accountKey,
          threadId,
          controller
        ) ||
        isAbortError(error)
      ) {
        return false
      }
      this.update({
        busyThreadId: null,
        error: githubNotificationsError(error),
      })
      return false
    } finally {
      this.mutationControllers.delete(controller)
    }
  }

  private ownsMutation(
    contextGeneration: number,
    accountKey: string,
    threadId: string,
    controller: AbortController
  ): boolean {
    return (
      this.active &&
      contextGeneration === this.contextGeneration &&
      accountKey === this.state.selectedAccountKey &&
      threadId === this.state.busyThreadId &&
      this.mutationControllers.has(controller) &&
      !controller.signal.aborted
    )
  }
}
