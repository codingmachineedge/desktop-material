import * as React from 'react'
import classNames from 'classnames'
import { Disposable } from 'event-kit'

import { getGitHubNotificationURL } from '../../lib/github-notification-url'
import {
  GitHubNotificationsStore,
  IGitHubNotificationsState,
} from '../../lib/stores/github-notifications-store'
import { shell } from '../../lib/app-shell'
import { IAPINotificationThread } from '../../lib/api'
import { Account, getAccountKey } from '../../models/account'
import { CloningRepository } from '../../models/cloning-repository'
import { INotificationEntry } from '../../models/notification-centre'
import { PopupType } from '../../models/popup'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { GitHubNotificationListItem } from './github-notification-list-item'
import { NotificationListItem } from './notification-list-item'

type NotificationSource = 'local' | 'github'
type NotificationFilter = 'all' | 'unread'

export interface INotificationCentrePanelProps {
  readonly dispatcher: Dispatcher
  readonly entries: ReadonlyArray<INotificationEntry>
  readonly unreadCount: number
  readonly repositories: ReadonlyArray<Repository | CloningRepository>
  readonly accounts: ReadonlyArray<Account>
  /** Injectable for focused UI tests; production creates an on-demand store. */
  readonly githubNotificationsStore?: GitHubNotificationsStore
}

interface INotificationCentrePanelState {
  readonly source: NotificationSource
  readonly filter: NotificationFilter
  readonly confirmingClear: boolean
  readonly confirmingDone: IAPINotificationThread | null
  readonly github: IGitHubNotificationsState
}

/**
 * Non-modal notification side sheet with isolated Local and GitHub sources.
 * The Local source retains the persisted git-backed log; GitHub threads remain
 * on-demand server state with their own account, filter, and mutation controls.
 */
export class NotificationCentrePanel extends React.Component<
  INotificationCentrePanelProps,
  INotificationCentrePanelState
> {
  private readonly githubStore: GitHubNotificationsStore
  private readonly ownsGitHubStore: boolean
  private githubSubscription: Disposable | null = null
  private localSourceTab: HTMLButtonElement | null = null
  private githubSourceTab: HTMLButtonElement | null = null
  private allTab: HTMLButtonElement | null = null
  private unreadTab: HTMLButtonElement | null = null
  private doneConfirmButton: HTMLButtonElement | null = null
  private doneReturnFocus: HTMLButtonElement | null = null
  private mounted = false

  public constructor(props: INotificationCentrePanelProps) {
    super(props)
    this.ownsGitHubStore = props.githubNotificationsStore === undefined
    this.githubStore =
      props.githubNotificationsStore ??
      new GitHubNotificationsStore(props.accounts)
    this.state = {
      source: 'local',
      filter: 'all',
      confirmingClear: false,
      confirmingDone: null,
      github: this.githubStore.getState(),
    }
  }

  public componentDidMount() {
    this.mounted = true
    this.githubSubscription = this.githubStore.subscribe(this.onGitHubState)
    window.addEventListener('keydown', this.onWindowKeyDown)
  }

  public componentDidUpdate(prevProps: INotificationCentrePanelProps) {
    if (prevProps.accounts !== this.props.accounts) {
      this.githubStore.setAccounts(this.props.accounts)
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    window.removeEventListener('keydown', this.onWindowKeyDown)
    this.githubSubscription?.dispose()
    this.githubStore.stop()
    if (this.ownsGitHubStore) {
      this.githubStore.dispose()
    }
  }

  private onGitHubState = (github: IGitHubNotificationsState) => {
    this.setState(state => ({
      github,
      confirmingDone:
        state.confirmingDone !== null &&
        github.notifications.some(item => item.id === state.confirmingDone?.id)
          ? state.confirmingDone
          : null,
    }))
  }

  private onWindowKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.key !== 'Escape') {
      return
    }
    event.preventDefault()
    if (this.state.confirmingDone !== null) {
      this.cancelDoneConfirmation()
    } else if (this.state.confirmingClear) {
      this.setState({ confirmingClear: false })
    } else {
      this.onClose()
    }
  }

  private onClose = () => {
    this.doneReturnFocus = null
    this.githubStore.stop()
    this.props.dispatcher.setNotificationCentreOpen(false)
  }

  private selectSource = (source: NotificationSource) => {
    if (source === this.state.source) {
      return
    }
    this.doneReturnFocus = null
    this.setState(
      { source, confirmingClear: false, confirmingDone: null },
      () => {
        if (source === 'github') {
          void this.githubStore.start()
        } else {
          this.githubStore.stop()
        }
      }
    )
  }

  private onSelectLocalSource = () => this.selectSource('local')
  private onSelectGitHubSource = () => this.selectSource('github')

  private onLocalSourceTabRef = (element: HTMLButtonElement | null) => {
    this.localSourceTab = element
  }

  private onGitHubSourceTabRef = (element: HTMLButtonElement | null) => {
    this.githubSourceTab = element
  }

  private onAllTabRef = (element: HTMLButtonElement | null) => {
    this.allTab = element
  }

  private onUnreadTabRef = (element: HTMLButtonElement | null) => {
    this.unreadTab = element
  }

  private onDoneConfirmButtonRef = (element: HTMLButtonElement | null) => {
    this.doneConfirmButton = element
  }

  private onSourceKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    let source: NotificationSource | null = null
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        source = this.state.source === 'local' ? 'github' : 'local'
        break
      case 'Home':
        source = 'local'
        break
      case 'End':
        source = 'github'
        break
    }
    if (source === null) {
      return
    }
    event.preventDefault()
    this.selectSource(source)
    const tab = source === 'local' ? this.localSourceTab : this.githubSourceTab
    tab?.focus()
  }

  private onFilterKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = this.currentFilter
    let filter: NotificationFilter | null = null
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        filter = current === 'all' ? 'unread' : 'all'
        break
      case 'Home':
        filter = 'all'
        break
      case 'End':
        filter = 'unread'
        break
    }
    if (filter === null) {
      return
    }
    event.preventDefault()
    this.selectFilter(filter)
    const tab = filter === 'all' ? this.allTab : this.unreadTab
    tab?.focus()
  }

  private get currentFilter(): NotificationFilter {
    return this.state.source === 'local'
      ? this.state.filter
      : this.state.github.filter
  }

  private selectFilter = (filter: NotificationFilter) => {
    if (this.state.source === 'local') {
      this.setState({ filter })
    } else {
      this.doneReturnFocus = null
      this.setState({ confirmingDone: null })
      void this.githubStore.setFilter(filter)
    }
  }

  private onSelectAll = () => this.selectFilter('all')
  private onSelectUnread = () => this.selectFilter('unread')

  private onMarkAllRead = () => {
    this.props.dispatcher.markAllNotificationsRead()
  }

  private onClearAll = () => {
    if (!this.state.confirmingClear) {
      this.setState({ confirmingClear: true })
      return
    }
    this.setState({ confirmingClear: false })
    this.props.dispatcher.clearAllNotifications()
  }

  private onShowHistory = () => {
    this.props.dispatcher.showPopup({ type: PopupType.NotificationHistory })
  }

  private onToggleRead = (entry: INotificationEntry) => {
    if (entry.read) {
      this.props.dispatcher.markNotificationUnread(entry.id)
    } else {
      this.props.dispatcher.markNotificationRead(entry.id)
    }
  }

  private onDelete = (entry: INotificationEntry) => {
    this.props.dispatcher.deleteNotification(entry.id)
  }

  private onActivate = (entry: INotificationEntry) => {
    if (!entry.read) {
      this.props.dispatcher.markNotificationRead(entry.id)
    }
    const action = entry.action
    if (action === undefined) {
      return
    }
    switch (action.kind) {
      case 'open-repository': {
        const repository = this.props.repositories.find(
          value => value.id === action.repositoryId
        )
        if (repository !== undefined) {
          this.props.dispatcher.selectRepository(repository)
        }
        break
      }
      case 'open-pull-request':
      case 'open-url':
        shell
          .openExternal(action.url)
          .catch(error => log.error('Failed to open notification link', error))
        break
    }
  }

  private get gitHubAccounts(): ReadonlyArray<Account> {
    return this.props.accounts.filter(
      account => account.provider === 'github' && account.token.length > 0
    )
  }

  private get selectedGitHubAccount(): Account | null {
    const selected = this.state.github.selectedAccountKey
    return (
      this.gitHubAccounts.find(
        account => getAccountKey(account) === selected
      ) ?? null
    )
  }

  private onAccountChange = (event: React.FormEvent<HTMLSelectElement>) => {
    this.doneReturnFocus = null
    this.setState({ confirmingDone: null })
    void this.githubStore.selectAccount(event.currentTarget.value)
  }

  private onParticipatingChange = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.doneReturnFocus = null
    this.setState({ confirmingDone: null })
    void this.githubStore.setParticipating(event.currentTarget.checked)
  }

  private onRefreshGitHub = () => {
    void this.githubStore.refresh()
  }

  private onLoadMore = () => {
    void this.githubStore.loadMore()
  }

  private onActivateGitHub = (thread: IAPINotificationThread) => {
    const account = this.selectedGitHubAccount
    if (account === null) {
      return
    }
    if (thread.unread) {
      void this.githubStore.markThreadRead(thread.id)
    }
    const url = getGitHubNotificationURL(account, thread)
    shell
      .openExternal(url)
      .catch(error => log.error('Failed to open GitHub notification', error))
  }

  private onMarkGitHubRead = (thread: IAPINotificationThread) => {
    void this.githubStore.markThreadRead(thread.id)
  }

  private onRequestDone = (
    thread: IAPINotificationThread,
    returnFocus: HTMLButtonElement
  ) => {
    this.doneReturnFocus = returnFocus
    this.setState({ confirmingDone: thread }, () =>
      this.doneConfirmButton?.focus()
    )
  }

  private cancelDoneConfirmation = () => {
    const returnFocus = this.doneReturnFocus
    this.doneReturnFocus = null
    this.setState({ confirmingDone: null }, () => {
      if (returnFocus?.isConnected) {
        returnFocus.focus()
      } else {
        this.githubSourceTab?.focus()
      }
    })
  }

  private onConfirmDone = async () => {
    const thread = this.state.confirmingDone
    if (thread === null) {
      return
    }
    const context = {
      selectedAccountKey: this.state.github.selectedAccountKey,
      filter: this.state.github.filter,
      participating: this.state.github.participating,
    }
    const success = await this.githubStore.markThreadDone(thread.id)
    if (
      !this.mounted ||
      this.state.source !== 'github' ||
      this.state.github.selectedAccountKey !== context.selectedAccountKey ||
      this.state.github.filter !== context.filter ||
      this.state.github.participating !== context.participating
    ) {
      this.doneReturnFocus = null
      return
    }
    const returnFocus = this.doneReturnFocus
    this.doneReturnFocus = null
    this.setState({ confirmingDone: null }, () => {
      if (!success && returnFocus?.isConnected) {
        returnFocus.focus()
      } else {
        this.githubSourceTab?.focus()
      }
    })
  }

  private renderHeader() {
    const local = this.state.source === 'local'
    const account = this.selectedGitHubAccount
    return (
      <header className="notification-centre-header">
        <span className="notification-centre-header-icon" aria-hidden="true">
          <Octicon symbol={octicons.bellFill} />
        </span>
        <span className="notification-centre-header-copy">
          <h1>Notifications</h1>
          {local ? (
            <small>userData/notifications.git</small>
          ) : (
            <small>
              {account === null
                ? 'GitHub account required'
                : `${account.login} · ${account.friendlyEndpoint}`}
            </small>
          )}
        </span>
        {local ? (
          <>
            <button
              type="button"
              className="notification-centre-icon-button"
              aria-label="Mark all as read"
              disabled={this.props.unreadCount === 0}
              onClick={this.onMarkAllRead}
            >
              <Octicon symbol={octicons.checklist} />
            </button>
            <button
              type="button"
              className="notification-centre-icon-button"
              aria-label="Notification history"
              onClick={this.onShowHistory}
            >
              <Octicon symbol={octicons.history} />
            </button>
            <button
              type="button"
              className={classNames('notification-centre-icon-button', {
                confirming: this.state.confirmingClear,
              })}
              aria-label={
                this.state.confirmingClear ? 'Confirm clear all' : 'Clear all'
              }
              disabled={this.props.entries.length === 0}
              onClick={this.onClearAll}
            >
              <Octicon symbol={octicons.trash} />
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="notification-centre-icon-button notification-centre-close"
          aria-label="Close notifications"
          onClick={this.onClose}
        >
          <Octicon symbol={octicons.x} />
        </button>
      </header>
    )
  }

  private renderSourceTabs() {
    const { source } = this.state
    return (
      <div
        className="notification-centre-source-tabs"
        role="tablist"
        aria-label="Notification sources"
      >
        <button
          id="notification-centre-local-source-tab"
          ref={this.onLocalSourceTabRef}
          type="button"
          role="tab"
          aria-selected={source === 'local'}
          aria-controls="notification-centre-source-panel"
          tabIndex={source === 'local' ? 0 : -1}
          className={classNames({ selected: source === 'local' })}
          onClick={this.onSelectLocalSource}
          onKeyDown={this.onSourceKeyDown}
        >
          Local
        </button>
        <button
          id="notification-centre-github-source-tab"
          ref={this.onGitHubSourceTabRef}
          type="button"
          role="tab"
          aria-selected={source === 'github'}
          aria-controls="notification-centre-source-panel"
          tabIndex={source === 'github' ? 0 : -1}
          className={classNames({ selected: source === 'github' })}
          onClick={this.onSelectGitHubSource}
          onKeyDown={this.onSourceKeyDown}
        >
          GitHub
        </button>
      </div>
    )
  }

  private renderFilters() {
    const filter = this.currentFilter
    const unreadCount =
      this.state.source === 'local'
        ? this.props.unreadCount
        : this.state.github.notifications.filter(item => item.unread).length
    const prefix = `notification-centre-${this.state.source}`
    return (
      <div
        className="notification-centre-segmented"
        role="tablist"
        aria-label={`${this.state.source} notification filters`}
      >
        <button
          id={`${prefix}-all-tab`}
          ref={this.onAllTabRef}
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          aria-controls="notification-centre-filter-panel"
          tabIndex={filter === 'all' ? 0 : -1}
          className={classNames({ selected: filter === 'all' })}
          onClick={this.onSelectAll}
          onKeyDown={this.onFilterKeyDown}
        >
          All
        </button>
        <button
          id={`${prefix}-unread-tab`}
          ref={this.onUnreadTabRef}
          type="button"
          role="tab"
          aria-selected={filter === 'unread'}
          aria-controls="notification-centre-filter-panel"
          tabIndex={filter === 'unread' ? 0 : -1}
          className={classNames({ selected: filter === 'unread' })}
          onClick={this.onSelectUnread}
          onKeyDown={this.onFilterKeyDown}
        >
          Unread{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </button>
      </div>
    )
  }

  private get visibleEntries(): ReadonlyArray<INotificationEntry> {
    return this.state.filter === 'unread'
      ? this.props.entries.filter(entry => !entry.read)
      : this.props.entries
  }

  private renderLocalList() {
    const entries = this.visibleEntries
    if (entries.length === 0) {
      return this.renderEmpty("You're all caught up")
    }
    return (
      <ol className="notification-centre-list">
        {entries.map(entry => (
          <NotificationListItem
            key={entry.id}
            entry={entry}
            onActivate={this.onActivate}
            onToggleRead={this.onToggleRead}
            onDelete={this.onDelete}
          />
        ))}
      </ol>
    )
  }

  private renderGitHubToolbar() {
    const accounts = this.gitHubAccounts
    const { github } = this.state
    const refreshAt = github.nextRefreshAt
    return (
      <div className="github-notifications-toolbar">
        <label className="github-notifications-account">
          <span>Account</span>
          <select
            aria-label="GitHub notification account"
            value={github.selectedAccountKey ?? ''}
            disabled={accounts.length === 0 || github.loading}
            onChange={this.onAccountChange}
          >
            {accounts.length === 0 ? (
              <option value="">No signed-in GitHub accounts</option>
            ) : (
              accounts.map(account => (
                <option
                  key={getAccountKey(account)}
                  value={getAccountKey(account)}
                >
                  {account.login} · {account.friendlyEndpoint}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="github-notifications-participating">
          <input
            type="checkbox"
            checked={github.participating}
            disabled={github.loading || accounts.length === 0}
            onChange={this.onParticipatingChange}
          />
          Participating only
        </label>
        <button
          type="button"
          className="github-notifications-refresh"
          aria-label={
            refreshAt !== null && refreshAt > new Date()
              ? `GitHub allows the next refresh after ${refreshAt.toLocaleTimeString()}`
              : 'Refresh GitHub notifications'
          }
          disabled={github.loading || accounts.length === 0}
          onClick={this.onRefreshGitHub}
        >
          <Octicon symbol={octicons.sync} />
          Refresh
        </button>
      </div>
    )
  }

  private renderGitHubError() {
    const error = this.state.github.error
    if (error === null) {
      return null
    }
    return (
      <div
        className={`github-notifications-error kind-${error.kind}`}
        role="alert"
      >
        <Octicon symbol={octicons.alert} />
        <span>{error.message}</span>
        <button type="button" onClick={this.onRefreshGitHub}>
          Try again
        </button>
      </div>
    )
  }

  private renderDoneConfirmation() {
    const thread = this.state.confirmingDone
    if (thread === null) {
      return null
    }
    return (
      <div
        className="github-notification-done-confirmation"
        role="alertdialog"
        aria-modal="false"
        aria-labelledby="github-notification-done-title"
        aria-describedby="github-notification-done-description"
      >
        <strong id="github-notification-done-title">
          Mark notification done?
        </strong>
        <span id="github-notification-done-description">
          This removes “{thread.subject.title}” from the selected GitHub inbox.
        </span>
        <span className="github-notification-confirmation-actions">
          <button type="button" onClick={this.cancelDoneConfirmation}>
            Cancel
          </button>
          <button
            ref={this.onDoneConfirmButtonRef}
            type="button"
            className="danger"
            disabled={this.state.github.busyThreadId !== null}
            onClick={this.onConfirmDone}
          >
            Mark done
          </button>
        </span>
      </div>
    )
  }

  private renderGitHubList() {
    const { github } = this.state
    if (github.selectedAccountKey === null) {
      return this.renderEmpty('Sign in to a GitHub account to view its inbox')
    }
    if (github.loading && github.notifications.length === 0) {
      return this.renderStatus('Loading GitHub notifications…')
    }
    if (github.error !== null && github.notifications.length === 0) {
      return this.renderGitHubError()
    }
    if (github.notifications.length === 0) {
      return this.renderEmpty(
        github.filter === 'unread'
          ? 'No unread GitHub notifications'
          : 'No GitHub notifications found'
      )
    }
    return (
      <>
        {this.renderGitHubError()}
        <ol className="notification-centre-list github-notifications-list">
          {github.notifications.map(thread => (
            <GitHubNotificationListItem
              key={`${github.selectedAccountKey}:${thread.id}`}
              thread={thread}
              busy={github.busyThreadId === thread.id}
              onActivate={this.onActivateGitHub}
              onMarkRead={this.onMarkGitHubRead}
              onRequestDone={this.onRequestDone}
            />
          ))}
        </ol>
        {github.hasMore || github.loadingMore ? (
          <button
            type="button"
            className="github-notifications-load-more"
            disabled={github.loadingMore}
            onClick={this.onLoadMore}
          >
            {github.loadingMore ? 'Loading…' : 'Load more'}
          </button>
        ) : null}
      </>
    )
  }

  private renderEmpty(message: string) {
    return (
      <div className="notification-centre-empty">
        <Octicon symbol={octicons.bellSlash} />
        <span>{message}</span>
      </div>
    )
  }

  private renderStatus(message: string) {
    return (
      <div
        className="notification-centre-empty"
        role="status"
        aria-label={message}
      >
        <Octicon symbol={octicons.sync} />
        <span>{message}</span>
      </div>
    )
  }

  public render() {
    const { source } = this.state
    const filter = this.currentFilter
    return (
      <section
        className="notification-centre-panel"
        role="dialog"
        aria-label="Notifications"
        aria-modal="false"
      >
        {this.renderHeader()}
        {this.renderSourceTabs()}
        <div
          id="notification-centre-source-panel"
          className="notification-centre-source-panel"
          role="tabpanel"
          aria-labelledby={`notification-centre-${source}-source-tab`}
        >
          {source === 'github' ? this.renderGitHubToolbar() : null}
          {this.renderFilters()}
          {source === 'github' ? this.renderDoneConfirmation() : null}
          <div
            id="notification-centre-filter-panel"
            className="notification-centre-tabpanel"
            role="tabpanel"
            aria-labelledby={`notification-centre-${source}-${filter}-tab`}
            aria-busy={
              source === 'github' &&
              (this.state.github.loading ||
                this.state.github.loadingMore ||
                this.state.github.busyThreadId !== null)
            }
            tabIndex={0}
          >
            {source === 'local'
              ? this.renderLocalList()
              : this.renderGitHubList()}
          </div>
        </div>
      </section>
    )
  }
}
