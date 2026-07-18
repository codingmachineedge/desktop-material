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
  readonly busyThreadId: string | null
  readonly clearingAll: boolean
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
export const GitHubNotificationsClearConcurrency = 4

export interface IGitHubNotificationsClearResult {
  readonly attempted: number
  readonly cleared: number
  readonly failedIds: ReadonlyArray<string>
  readonly canceled: boolean
}

const createState = (
  selectedAccountKey: string | null
): IGitHubNotificationsState => ({
  selectedAccountKey,
  filter: 'unread',
  participating: false,
  notifications: [],
  loading: false,
  busyThreadId: null,
  clearingAll: false,
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
    this.update({ loading: false, busyThreadId: null, clearingAll: false })
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
    if (
      !this.active ||
      this.state.selectedAccountKey === null ||
      this.state.clearingAll
    ) {
      return
    }
    if (
      !force &&
      this.state.nextRefreshAt !== null &&
      this.now() < this.state.nextRefreshAt
    ) {
      return
    }
    await this.loadAllPages()
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

  /**
   * Mark every thread in the fully loaded inbox done. Successful mutations are
   * removed in one state update; failed mutations remain in their original
   * order so the user can retry them. Context changes abort all in-flight work
   * and prevent stale results from updating the replacement inbox.
   */
  public async markAllThreadsDone(): Promise<IGitHubNotificationsClearResult> {
    const account = this.accountForKey(this.state.selectedAccountKey)
    const ids = this.state.notifications.map(item => item.id)
    if (
      !this.active ||
      account === null ||
      this.state.loading ||
      this.state.busyThreadId !== null ||
      this.state.clearingAll
    ) {
      return {
        attempted: 0,
        cleared: 0,
        failedIds: [],
        canceled: true,
      }
    }
    if (ids.length === 0) {
      return {
        attempted: 0,
        cleared: 0,
        failedIds: [],
        canceled: false,
      }
    }

    const contextGeneration = this.contextGeneration
    const accountKey = getAccountKey(account)
    const api = this.apiFactory(account)
    const succeeded = new Set<string>()
    const failed = new Set<string>()
    let nextIndex = 0
    this.update({ clearingAll: true, error: null })

    const worker = async () => {
      while (this.ownsClearAll(contextGeneration, accountKey)) {
        const index = nextIndex++
        const id = ids[index]
        if (id === undefined) {
          return
        }

        const controller = new AbortController()
        this.mutationControllers.add(controller)
        try {
          await api.markNotificationThreadDone(id, controller.signal)
          if (!this.ownsClearAll(contextGeneration, accountKey)) {
            return
          }
          succeeded.add(id)
        } catch (error) {
          if (
            !this.ownsClearAll(contextGeneration, accountKey) ||
            isAbortError(error)
          ) {
            return
          }
          failed.add(id)
        } finally {
          this.mutationControllers.delete(controller)
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(ids.length, GitHubNotificationsClearConcurrency) },
        worker
      )
    )

    if (!this.ownsClearAll(contextGeneration, accountKey)) {
      return {
        attempted: ids.length,
        cleared: succeeded.size,
        failedIds: [...failed],
        canceled: true,
      }
    }

    const failedIds = ids.filter(id => failed.has(id))
    const failedCount = failedIds.length
    this.update({
      notifications: this.state.notifications.filter(
        item => !succeeded.has(item.id)
      ),
      clearingAll: false,
      error:
        failedCount === 0
          ? null
          : {
              kind: 'unknown',
              message: `${failedCount} GitHub notification${
                failedCount === 1 ? '' : 's'
              } could not be marked done. ${
                failedCount === 1 ? 'It remains' : 'They remain'
              } in the inbox so you can retry.`,
              rateLimitReset: null,
            },
    })
    return {
      attempted: ids.length,
      cleared: succeeded.size,
      failedIds,
      canceled: false,
    }
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

  /**
   * Load the complete selected GitHub inbox. GitHub bounds each response page,
   * so a refresh follows every advertised next page instead of making older
   * notifications depend on a manual "Load more" action or an item ceiling.
   */
  private async loadAllPages(): Promise<void> {
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
      loading: true,
      error: null,
    })

    try {
      const api = this.apiFactory(account)
      let page = 1
      let notifications: ReadonlyArray<IAPINotificationThread> = []
      let lastModified = this.state.lastModified
      let pollIntervalSeconds: number | null = null
      let notModified = false

      while (true) {
        const result = await api.fetchNotifications({
          includeRead: this.state.filter === 'all',
          participating: this.state.participating,
          page,
          perPage: GitHubNotificationsPageSize,
          lastModified: page === 1 ? this.state.lastModified : null,
          signal: controller.signal,
        })
        if (!this.ownsLoad(contextGeneration, requestId, controller)) {
          return
        }

        if (page === 1) {
          lastModified = result.lastModified ?? lastModified
          pollIntervalSeconds = result.pollIntervalSeconds
          if (result.notModified) {
            notModified = true
            break
          }
        }

        notifications = this.mergeNotifications(
          notifications,
          result.notifications
        )
        if (!result.hasNextPage) {
          break
        }
        page++
      }

      const updatedAt = this.now()
      const nextRefreshAt =
        pollIntervalSeconds === null
          ? null
          : new Date(updatedAt.getTime() + pollIntervalSeconds * 1000)
      this.update({
        notifications: notModified ? this.state.notifications : notifications,
        loading: false,
        error: null,
        lastModified,
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
    if (
      account === null ||
      this.state.busyThreadId !== null ||
      this.state.clearingAll
    ) {
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

  private ownsClearAll(contextGeneration: number, accountKey: string): boolean {
    return (
      this.active &&
      contextGeneration === this.contextGeneration &&
      accountKey === this.state.selectedAccountKey &&
      this.state.clearingAll
    )
  }
}
