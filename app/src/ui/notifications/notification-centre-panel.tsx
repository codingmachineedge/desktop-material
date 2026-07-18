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
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { Account, getAccountKey } from '../../models/account'
import { CloningRepository } from '../../models/cloning-repository'
import {
  INotificationEntry,
  NotificationCentreKind,
} from '../../models/notification-centre'
import { PopupType } from '../../models/popup'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { GitHubNotificationListItem } from './github-notification-list-item'
import { NotificationListItem } from './notification-list-item'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'
import { TooltippedContent } from '../lib/tooltipped-content'
import { TooltipDirection } from '../lib/tooltip'

const NotificationSearchFilterId = 'notification-centre-search'

type NotificationSource = 'local' | 'github'
type NotificationFilter = 'all' | 'unread'
type NotificationKindFilter = 'all' | NotificationCentreKind
type BulkConfirmation = 'delete-local' | 'done-github'

const notificationKindLabels: Readonly<Record<NotificationCentreKind, string>> =
  {
    'pr-review-submit': 'Pull request reviews',
    'pr-comment': 'Pull request comments',
    'pr-checks-failed': 'Failed checks',
    'app-error': 'Errors',
    'clone-batch': 'Clones',
    'auto-commit': 'Automatic commits',
    'merge-all': 'Merge all',
    'auto-pull': 'Automatic pulls',
    'cheap-lfs': 'Large files',
    info: 'Information',
  }

const notificationKinds = Object.keys(
  notificationKindLabels
) as ReadonlyArray<NotificationCentreKind>

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
  readonly query: string
  readonly queryMode: FilterMode
  readonly queryCaseSensitive: boolean
  readonly kind: NotificationKindFilter
  readonly selectedLocalIds: ReadonlySet<string>
  readonly selectedGitHubIds: ReadonlySet<string>
  readonly bulkBusy: boolean
  readonly confirmingBulk: BulkConfirmation | null
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
  private clearConfirmation: HTMLDivElement | null = null
  private clearReturnFocus: HTMLButtonElement | null = null
  private clearSource: NotificationSource | null = null
  private bulkConfirmation: HTMLDivElement | null = null
  private bulkReturnFocus: HTMLButtonElement | null = null
  private selectAllCheckbox: HTMLInputElement | null = null
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
      query: '',
      queryMode: readPersistedFilterMode(NotificationSearchFilterId),
      queryCaseSensitive: false,
      kind: 'all',
      selectedLocalIds: new Set<string>(),
      selectedGitHubIds: new Set<string>(),
      bulkBusy: false,
      confirmingBulk: null,
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
    this.pruneSelections()
    this.updateSelectAllIndeterminate()
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
    const contextChanged =
      github.selectedAccountKey !== this.state.github.selectedAccountKey ||
      github.filter !== this.state.github.filter ||
      github.participating !== this.state.github.participating
    if (
      contextChanged &&
      this.state.source === 'github' &&
      this.state.confirmingClear
    ) {
      this.clearReturnFocus = null
      this.clearSource = null
    }
    this.setState(state => ({
      github,
      confirmingClear:
        contextChanged && state.source === 'github'
          ? false
          : state.confirmingClear,
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
    } else if (this.state.confirmingBulk !== null) {
      this.onCancelBulkConfirmation()
    } else if (this.state.confirmingClear) {
      this.onCancelClearAll()
    } else {
      this.onClose()
    }
  }

  private onClose = () => {
    this.doneReturnFocus = null
    this.clearSource = null
    this.githubStore.stop()
    this.props.dispatcher.setNotificationCentreOpen(false)
  }

  private selectSource = (source: NotificationSource) => {
    if (source === this.state.source) {
      return
    }
    this.doneReturnFocus = null
    this.clearSource = null
    this.setState(
      {
        source,
        query: '',
        selectedLocalIds: new Set<string>(),
        selectedGitHubIds: new Set<string>(),
        bulkBusy: false,
        confirmingClear: false,
        confirmingBulk: null,
        confirmingDone: null,
      },
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

  private onClearConfirmationRef = (element: HTMLDivElement | null) => {
    this.clearConfirmation = element
  }

  private onBulkConfirmationRef = (element: HTMLDivElement | null) => {
    this.bulkConfirmation = element
  }

  private restoreFocus(returnFocus: HTMLButtonElement | null) {
    if (returnFocus?.isConnected && !returnFocus.disabled) {
      returnFocus.focus()
    } else {
      const tab =
        this.state.source === 'local'
          ? this.localSourceTab
          : this.githubSourceTab
      tab?.focus()
    }
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
      this.setState({
        filter,
        selectedLocalIds: new Set<string>(),
        bulkBusy: false,
        confirmingBulk: null,
      })
    } else {
      this.doneReturnFocus = null
      this.setState({
        selectedGitHubIds: new Set<string>(),
        bulkBusy: false,
        confirmingBulk: null,
        confirmingDone: null,
      })
      void this.githubStore.setFilter(filter)
    }
  }

  private onSelectAll = () => this.selectFilter('all')
  private onSelectUnread = () => this.selectFilter('unread')

  private onQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({
      query: event.currentTarget.value,
      selectedLocalIds: new Set<string>(),
      selectedGitHubIds: new Set<string>(),
      confirmingBulk: null,
    })
  }

  // Mode, case, and applied patterns change the visible set, so they clear
  // selections the same way typing in the search field does.
  private onQueryModeChange = (queryMode: FilterMode) => {
    persistFilterMode(NotificationSearchFilterId, queryMode)
    this.setState({
      queryMode,
      selectedLocalIds: new Set<string>(),
      selectedGitHubIds: new Set<string>(),
      confirmingBulk: null,
    })
  }

  private onQueryCaseSensitiveChange = (queryCaseSensitive: boolean) => {
    this.setState({
      queryCaseSensitive,
      selectedLocalIds: new Set<string>(),
      selectedGitHubIds: new Set<string>(),
      confirmingBulk: null,
    })
  }

  private onQueryPatternApply = (query: string) => {
    this.setState({
      query,
      selectedLocalIds: new Set<string>(),
      selectedGitHubIds: new Set<string>(),
      confirmingBulk: null,
    })
  }

  private getQuerySampleItems = (): ReadonlyArray<string> =>
    this.state.source === 'local'
      ? this.props.entries.slice(0, 50).map(entry => entry.title)
      : this.state.github.notifications
          .slice(0, 50)
          .map(
            thread => `${thread.repository.full_name} ${thread.subject.title}`
          )

  private onKindChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    this.setState({
      kind: event.currentTarget.value as NotificationKindFilter,
      selectedLocalIds: new Set<string>(),
      confirmingBulk: null,
    })
  }

  private onSelectAllCheckboxRef = (element: HTMLInputElement | null) => {
    this.selectAllCheckbox = element
    this.updateSelectAllIndeterminate()
  }

  private updateSelectAllIndeterminate() {
    if (this.selectAllCheckbox === null) {
      return
    }
    const selected = this.currentSelectedIds
    const visible = this.visibleIds
    const selectedVisible = visible.filter(id => selected.has(id)).length
    this.selectAllCheckbox.indeterminate =
      selectedVisible > 0 && selectedVisible < visible.length
  }

  private get currentSelectedIds(): ReadonlySet<string> {
    return this.state.source === 'local'
      ? this.state.selectedLocalIds
      : this.state.selectedGitHubIds
  }

  private get visibleIds(): ReadonlyArray<string> {
    return this.state.source === 'local'
      ? this.visibleEntries.map(entry => entry.id)
      : this.visibleGitHubNotifications.map(thread => thread.id)
  }

  private get allVisibleSelected(): boolean {
    const visible = this.visibleIds
    const selected = this.currentSelectedIds
    return visible.length > 0 && visible.every(id => selected.has(id))
  }

  private onSelectAllVisible = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = new Set(this.currentSelectedIds)
    for (const id of this.visibleIds) {
      if (event.currentTarget.checked) {
        selected.add(id)
      } else {
        selected.delete(id)
      }
    }
    if (this.state.source === 'local') {
      this.setState({
        selectedLocalIds: selected,
        confirmingBulk: null,
      })
    } else {
      this.setState({
        selectedGitHubIds: selected,
        confirmingBulk: null,
      })
    }
  }

  private onToggleLocalSelected = (
    entry: INotificationEntry,
    checked: boolean
  ) => {
    const selected = new Set(this.state.selectedLocalIds)
    if (checked) {
      selected.add(entry.id)
    } else {
      selected.delete(entry.id)
    }
    this.setState({ selectedLocalIds: selected, confirmingBulk: null })
  }

  private onToggleGitHubSelected = (
    thread: IAPINotificationThread,
    checked: boolean
  ) => {
    const selected = new Set(this.state.selectedGitHubIds)
    if (checked) {
      selected.add(thread.id)
    } else {
      selected.delete(thread.id)
    }
    this.setState({ selectedGitHubIds: selected, confirmingBulk: null })
  }

  private pruneSelections() {
    const localIds = new Set(this.props.entries.map(entry => entry.id))
    const githubIds = new Set(
      this.state.github.notifications.map(thread => thread.id)
    )
    const selectedLocalIds = new Set(
      [...this.state.selectedLocalIds].filter(id => localIds.has(id))
    )
    const selectedGitHubIds = new Set(
      [...this.state.selectedGitHubIds].filter(id => githubIds.has(id))
    )
    if (
      selectedLocalIds.size !== this.state.selectedLocalIds.size ||
      selectedGitHubIds.size !== this.state.selectedGitHubIds.size
    ) {
      this.setState({ selectedLocalIds, selectedGitHubIds })
    }
  }

  private onMarkAllRead = () => {
    this.props.dispatcher.markAllNotificationsRead()
  }

  // The toolbar trigger only ever requests confirmation. Splitting request
  // from perform means a second activation of the still-focused trigger can
  // never silently clear (the confirmation button owns the destructive path).
  private onRequestClearAll = (event: React.MouseEvent<HTMLButtonElement>) => {
    this.clearReturnFocus = event.currentTarget
    this.clearSource = this.state.source
    this.setState({ confirmingClear: true }, () =>
      this.clearConfirmation?.focus()
    )
  }

  private onConfirmClearAll = async () => {
    if (!this.state.confirmingClear) {
      return
    }
    const source = this.clearSource ?? this.state.source
    const returnFocus = this.clearReturnFocus
    this.clearReturnFocus = null
    this.clearSource = null
    this.setState({
      confirmingClear: false,
      bulkBusy: true,
      selectedLocalIds:
        source === 'local' ? new Set<string>() : this.state.selectedLocalIds,
      selectedGitHubIds:
        source === 'github' ? new Set<string>() : this.state.selectedGitHubIds,
    })
    try {
      if (source === 'local') {
        await this.props.dispatcher.clearAllNotifications()
      } else {
        await this.githubStore.markAllThreadsDone()
      }
    } catch (error) {
      await this.props.dispatcher.postError(
        error instanceof Error ? error : new Error(String(error))
      )
    } finally {
      if (this.mounted && this.state.source === source) {
        this.setState({ bulkBusy: false }, () => this.restoreFocus(returnFocus))
      }
    }
  }

  private onCancelClearAll = () => {
    const returnFocus = this.clearReturnFocus
    this.clearReturnFocus = null
    this.clearSource = null
    this.setState({ confirmingClear: false }, () =>
      this.restoreFocus(returnFocus)
    )
  }

  private runLocalBulkRead = async (read: boolean) => {
    const ids = [...this.state.selectedLocalIds]
    if (ids.length === 0 || this.state.bulkBusy) {
      return
    }
    this.setState({ bulkBusy: true, confirmingBulk: null })
    try {
      await this.props.dispatcher.setNotificationsRead(ids, read)
    } catch (error) {
      await this.props.dispatcher.postError(
        error instanceof Error ? error : new Error(String(error))
      )
    } finally {
      if (this.mounted) {
        this.setState({
          bulkBusy: false,
          selectedLocalIds: new Set<string>(),
        })
      }
    }
  }

  private onBulkMarkRead = () => {
    if (this.state.source === 'local') {
      void this.runLocalBulkRead(true)
    } else {
      void this.runGitHubBulk('read')
    }
  }

  private onBulkMarkUnread = () => {
    void this.runLocalBulkRead(false)
  }

  private onRequestBulkDelete = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    this.bulkReturnFocus = event.currentTarget
    this.setState(
      { confirmingBulk: 'delete-local', confirmingClear: false },
      () => this.bulkConfirmation?.focus()
    )
  }

  private onRequestBulkDone = (event: React.MouseEvent<HTMLButtonElement>) => {
    this.bulkReturnFocus = event.currentTarget
    this.setState(
      { confirmingBulk: 'done-github', confirmingClear: false },
      () => this.bulkConfirmation?.focus()
    )
  }

  private onCancelBulkConfirmation = () => {
    const returnFocus = this.bulkReturnFocus
    this.bulkReturnFocus = null
    this.setState({ confirmingBulk: null }, () =>
      this.restoreFocus(returnFocus)
    )
  }

  private onConfirmBulkDelete = async () => {
    const ids = [...this.state.selectedLocalIds]
    if (ids.length === 0 || this.state.bulkBusy) {
      return
    }
    const returnFocus = this.bulkReturnFocus
    this.bulkReturnFocus = null
    this.setState({ bulkBusy: true, confirmingBulk: null })
    try {
      await this.props.dispatcher.deleteNotifications(ids)
    } catch (error) {
      await this.props.dispatcher.postError(
        error instanceof Error ? error : new Error(String(error))
      )
    } finally {
      if (this.mounted) {
        this.setState(
          {
            bulkBusy: false,
            selectedLocalIds: new Set<string>(),
          },
          () => this.restoreFocus(returnFocus)
        )
      }
    }
  }

  private onConfirmBulkDone = () => {
    const returnFocus = this.bulkReturnFocus
    this.bulkReturnFocus = null
    this.setState({ confirmingBulk: null }, () => {
      void this.runGitHubBulk('done').finally(() => {
        if (this.mounted) {
          this.restoreFocus(returnFocus)
        }
      })
    })
  }

  private runGitHubBulk = async (action: 'read' | 'done') => {
    const ids = [...this.state.selectedGitHubIds]
    if (ids.length === 0 || this.state.bulkBusy) {
      return
    }
    const context = {
      selectedAccountKey: this.state.github.selectedAccountKey,
      filter: this.state.github.filter,
      participating: this.state.github.participating,
    }
    const failed = new Set<string>()
    this.setState({ bulkBusy: true, confirmingBulk: null })
    for (const id of ids) {
      const current = this.githubStore.getState()
      if (
        current.selectedAccountKey !== context.selectedAccountKey ||
        current.filter !== context.filter ||
        current.participating !== context.participating
      ) {
        if (this.mounted) {
          this.setState({
            bulkBusy: false,
            selectedGitHubIds: new Set<string>(),
          })
        }
        return
      }
      const succeeded =
        action === 'read'
          ? await this.githubStore.markThreadRead(id)
          : await this.githubStore.markThreadDone(id)
      if (!succeeded) {
        failed.add(id)
      }
    }
    if (!this.mounted || this.state.source !== 'github') {
      return
    }
    const current = this.githubStore.getState()
    if (
      current.selectedAccountKey !== context.selectedAccountKey ||
      current.filter !== context.filter ||
      current.participating !== context.participating
    ) {
      this.setState({
        bulkBusy: false,
        selectedGitHubIds: new Set<string>(),
      })
      return
    }
    this.setState({
      bulkBusy: false,
      selectedGitHubIds: failed,
    })
  }

  private onShowHistory = () => {
    this.props.dispatcher.showPopup({ type: PopupType.NotificationHistory })
  }

  private onOpenAutomations = (entry: INotificationEntry) => {
    this.props.dispatcher.showPopup({
      type: PopupType.NotificationAutomations,
      entry,
    })
  }

  private onToggleRead = (entry: INotificationEntry) => {
    const selectedLocalIds = new Set(this.state.selectedLocalIds)
    selectedLocalIds.delete(entry.id)
    this.setState({ selectedLocalIds })
    if (entry.read) {
      this.props.dispatcher.markNotificationUnread(entry.id)
    } else {
      this.props.dispatcher.markNotificationRead(entry.id)
    }
  }

  private onDelete = (entry: INotificationEntry) => {
    const selectedLocalIds = new Set(this.state.selectedLocalIds)
    selectedLocalIds.delete(entry.id)
    this.setState({ selectedLocalIds })
    this.props.dispatcher.deleteNotification(entry.id)
  }

  private onActivate = (entry: INotificationEntry) => {
    const selectedLocalIds = new Set(this.state.selectedLocalIds)
    selectedLocalIds.delete(entry.id)
    this.setState({ selectedLocalIds })
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
    this.setState({
      selectedGitHubIds: new Set<string>(),
      bulkBusy: false,
      confirmingBulk: null,
      confirmingDone: null,
    })
    void this.githubStore.selectAccount(event.currentTarget.value)
  }

  private onParticipatingChange = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.doneReturnFocus = null
    this.setState({
      selectedGitHubIds: new Set<string>(),
      bulkBusy: false,
      confirmingBulk: null,
      confirmingDone: null,
    })
    void this.githubStore.setParticipating(event.currentTarget.checked)
  }

  private onRefreshGitHub = () => {
    void this.githubStore.refresh()
  }

  private onActivateGitHub = (thread: IAPINotificationThread) => {
    const account = this.selectedGitHubAccount
    if (account === null) {
      return
    }
    const selectedGitHubIds = new Set(this.state.selectedGitHubIds)
    selectedGitHubIds.delete(thread.id)
    this.setState({ selectedGitHubIds })
    if (thread.unread) {
      void this.githubStore.markThreadRead(thread.id)
    }
    const url = getGitHubNotificationURL(account, thread)
    shell
      .openExternal(url)
      .catch(error => log.error('Failed to open GitHub notification', error))
  }

  private onMarkGitHubRead = (thread: IAPINotificationThread) => {
    const selectedGitHubIds = new Set(this.state.selectedGitHubIds)
    selectedGitHubIds.delete(thread.id)
    this.setState({ selectedGitHubIds })
    void this.githubStore.markThreadRead(thread.id)
  }

  private onRequestDone = (
    thread: IAPINotificationThread,
    returnFocus: HTMLButtonElement
  ) => {
    this.doneReturnFocus = returnFocus
    const selectedGitHubIds = new Set(this.state.selectedGitHubIds)
    selectedGitHubIds.delete(thread.id)
    this.setState({ confirmingDone: thread, selectedGitHubIds }, () =>
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
            <TooltippedContent
              className="notification-centre-tooltip-target"
              tooltip="Mark every Local notification as read"
              direction={TooltipDirection.SOUTH_WEST}
              openOnFocus={true}
            >
              <button
                type="button"
                className="notification-centre-icon-button"
                aria-label="Mark all as read"
                disabled={this.props.unreadCount === 0}
                onClick={this.onMarkAllRead}
              >
                <Octicon symbol={octicons.checklist} />
              </button>
            </TooltippedContent>
            <TooltippedContent
              className="notification-centre-tooltip-target"
              tooltip="Open notification history"
              direction={TooltipDirection.SOUTH_WEST}
              openOnFocus={true}
            >
              <button
                type="button"
                className="notification-centre-icon-button"
                aria-label="Notification history"
                onClick={this.onShowHistory}
              >
                <Octicon symbol={octicons.history} />
              </button>
            </TooltippedContent>
          </>
        ) : null}
        <TooltippedContent
          className="notification-centre-tooltip-target"
          tooltip="Close notifications"
          direction={TooltipDirection.SOUTH_WEST}
          openOnFocus={true}
        >
          <button
            type="button"
            className="notification-centre-icon-button notification-centre-close"
            aria-label="Close notifications"
            onClick={this.onClose}
          >
            <Octicon symbol={octicons.x} />
          </button>
        </TooltippedContent>
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

  private renderSearchFilters() {
    const local = this.state.source === 'local'
    return (
      <div className="notification-centre-filter-bar">
        <div className="notification-centre-search-row">
          <label className="notification-centre-search">
            <span>Search</span>
            <input
              type="search"
              value={this.state.query}
              disabled={this.state.bulkBusy}
              aria-label={`Search ${this.state.source} notifications`}
              placeholder="Title, message, repository, or reason"
              onChange={this.onQueryChange}
            />
          </label>
          <FilterModeControl
            mode={this.state.queryMode}
            caseSensitive={this.state.queryCaseSensitive}
            onModeChange={this.onQueryModeChange}
            onCaseSensitiveChange={this.onQueryCaseSensitiveChange}
            regexBuilderTarget={
              local ? 'Local notifications' : 'GitHub notifications'
            }
            getSampleItems={this.getQuerySampleItems}
            filterText={this.state.query}
            onRegexPatternApply={this.onQueryPatternApply}
          />
        </div>
        {local ? (
          <label className="notification-centre-kind-filter">
            <span>Type</span>
            <select
              value={this.state.kind}
              disabled={this.state.bulkBusy}
              aria-label="Local notification type"
              onChange={this.onKindChange}
            >
              <option value="all">All types</option>
              {notificationKinds.map(kind => (
                <option key={kind} value={kind}>
                  {notificationKindLabels[kind]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    )
  }

  private renderBulkToolbar() {
    const local = this.state.source === 'local'
    const busy =
      this.state.bulkBusy ||
      (!local &&
        (this.state.github.clearingAll ||
          this.state.github.busyThreadId !== null))
    const selected = this.currentSelectedIds
    const selectedEntries = this.props.entries.filter(entry =>
      this.state.selectedLocalIds.has(entry.id)
    )
    const selectedThreads = this.state.github.notifications.filter(thread =>
      this.state.selectedGitHubIds.has(thread.id)
    )
    const canMarkRead = local
      ? selectedEntries.some(entry => !entry.read)
      : selectedThreads.some(thread => thread.unread)
    const canMarkUnread = selectedEntries.some(entry => entry.read)
    const disabled = selected.size === 0 || busy
    const clearCount = local
      ? this.props.entries.length
      : this.state.github.notifications.length
    return (
      <div className="notification-centre-bulk-toolbar">
        <label className="notification-centre-select-all">
          <input
            ref={this.onSelectAllCheckboxRef}
            type="checkbox"
            checked={this.allVisibleSelected}
            disabled={this.visibleIds.length === 0 || busy}
            aria-label="Select all visible notifications"
            onChange={this.onSelectAllVisible}
          />
          <span>Select all visible</span>
        </label>
        <span className="notification-centre-selected-count" aria-live="polite">
          {selected.size} selected
        </span>
        <div className="notification-centre-bulk-actions">
          <button
            type="button"
            disabled={disabled || !canMarkRead}
            onClick={this.onBulkMarkRead}
          >
            Mark read
          </button>
          {local ? (
            <button
              type="button"
              disabled={disabled || !canMarkUnread}
              onClick={this.onBulkMarkUnread}
            >
              Mark unread
            </button>
          ) : null}
          <button
            type="button"
            className="danger"
            disabled={disabled}
            onClick={local ? this.onRequestBulkDelete : this.onRequestBulkDone}
          >
            {local ? 'Delete selected' : 'Mark selected done'}
          </button>
          <button
            type="button"
            className="clear-all"
            disabled={
              clearCount === 0 || busy || (!local && this.state.github.loading)
            }
            onClick={this.onRequestClearAll}
          >
            Clear all
          </button>
        </div>
      </div>
    )
  }

  private renderClearConfirmation() {
    if (!this.state.confirmingClear) {
      return null
    }
    const local = this.state.source === 'local'
    const count = local
      ? this.props.entries.length
      : this.state.github.notifications.length
    return (
      <div
        className="notification-centre-confirmation"
        role="alertdialog"
        aria-modal="false"
        aria-labelledby="notification-centre-clear-title"
        aria-describedby="notification-centre-clear-description"
        tabIndex={-1}
        ref={this.onClearConfirmationRef}
      >
        <strong id="notification-centre-clear-title">
          {local
            ? 'Clear every Local notification?'
            : 'Clear every GitHub notification?'}
        </strong>
        <span id="notification-centre-clear-description">
          {local
            ? `This removes ${count} notification${
                count === 1 ? '' : 's'
              } from the current list. Notification history can restore them later.`
            : `This marks all ${count} notification${
                count === 1 ? '' : 's'
              } done and removes them from the selected GitHub inbox. Any failures stay visible so you can retry.`}
        </span>
        <span className="notification-centre-confirmation-actions">
          <button type="button" onClick={this.onCancelClearAll}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            onClick={this.onConfirmClearAll}
          >
            Clear all
          </button>
        </span>
      </div>
    )
  }

  private renderBulkConfirmation() {
    const confirmation = this.state.confirmingBulk
    if (confirmation === null) {
      return null
    }
    const local = confirmation === 'delete-local'
    const count = local
      ? this.state.selectedLocalIds.size
      : this.state.selectedGitHubIds.size
    return (
      <div
        className="notification-centre-confirmation"
        role="alertdialog"
        aria-modal="false"
        aria-labelledby="notification-centre-bulk-title"
        aria-describedby="notification-centre-bulk-description"
        tabIndex={-1}
        ref={this.onBulkConfirmationRef}
      >
        <strong id="notification-centre-bulk-title">
          {local
            ? 'Delete selected notifications?'
            : 'Mark selected threads done?'}
        </strong>
        <span id="notification-centre-bulk-description">
          {local
            ? `Delete ${count} selected Local notification${
                count === 1 ? '' : 's'
              } in one history-backed change.`
            : `Remove ${count} loaded thread${
                count === 1 ? '' : 's'
              } from the selected GitHub inbox.`}
        </span>
        <span className="notification-centre-confirmation-actions">
          <button type="button" onClick={this.onCancelBulkConfirmation}>
            Cancel
          </button>
          <button
            type="button"
            className="danger"
            onClick={local ? this.onConfirmBulkDelete : this.onConfirmBulkDone}
          >
            {local ? 'Delete selected' : 'Mark done'}
          </button>
        </span>
      </div>
    )
  }

  private get visibleEntries(): ReadonlyArray<INotificationEntry> {
    const entries = this.props.entries.filter(entry => {
      if (this.state.filter === 'unread' && entry.read) {
        return false
      }
      return this.state.kind === 'all' || entry.kind === this.state.kind
    })
    // Two keys so fuzzy mode (which only scores the first two) still matches on
    // the body, kind, and account folded into the "subtitle" key.
    return this.matchQuery(entries, entry => [
      entry.title,
      [
        entry.body,
        notificationKindLabels[entry.kind],
        entry.accountKey ?? '',
        entry.repositoryId?.toString() ?? '',
      ].join(' '),
    ])
  }

  private get visibleGitHubNotifications(): ReadonlyArray<IAPINotificationThread> {
    const threads = this.state.github.notifications.filter(
      thread => this.state.github.filter !== 'unread' || thread.unread
    )
    return this.matchQuery(threads, thread => [
      thread.subject.title,
      [
        thread.subject.type,
        thread.repository.full_name,
        thread.reason.replace(/_/g, ' '),
      ].join(' '),
    ])
  }

  private matchQuery<T>(
    items: ReadonlyArray<T>,
    getKey: (item: T) => ReadonlyArray<string>
  ): ReadonlyArray<T> {
    const query = this.state.query.trim()
    if (query.length === 0) {
      return items
    }
    const { results } = matchWithMode(query, items, getKey, {
      mode: this.state.queryMode,
      caseSensitive: this.state.queryCaseSensitive,
    })
    return results.map(match => match.item)
  }

  private renderLocalList() {
    const entries = this.visibleEntries
    if (entries.length === 0) {
      return this.renderEmpty(
        this.state.query.trim().length > 0 || this.state.kind !== 'all'
          ? 'No Local notifications match these filters'
          : "You're all caught up"
      )
    }
    return (
      <ol className="notification-centre-list">
        {entries.map(entry => (
          <NotificationListItem
            key={entry.id}
            entry={entry}
            selected={this.state.selectedLocalIds.has(entry.id)}
            selectionDisabled={this.state.bulkBusy}
            onToggleSelected={this.onToggleLocalSelected}
            onActivate={this.onActivate}
            onToggleRead={this.onToggleRead}
            onDelete={this.onDelete}
            onOpenAutomations={this.onOpenAutomations}
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
              <option value="">No signed-in accounts</option>
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
    const notifications = this.visibleGitHubNotifications
    if (github.selectedAccountKey === null) {
      return this.renderEmpty('Sign in to a GitHub account to view its inbox')
    }
    if (github.loading && github.notifications.length === 0) {
      return this.renderStatus('Loading GitHub notifications…')
    }
    if (github.error !== null && github.notifications.length === 0) {
      return this.renderGitHubError()
    }
    if (notifications.length === 0) {
      return this.renderEmpty(
        this.state.query.trim().length > 0
          ? 'No GitHub notifications match this search'
          : github.filter === 'unread'
          ? 'No unread GitHub notifications'
          : 'No GitHub notifications found'
      )
    }
    return (
      <>
        {this.renderGitHubError()}
        <ol className="notification-centre-list github-notifications-list">
          {notifications.map(thread => (
            <GitHubNotificationListItem
              key={`${github.selectedAccountKey}:${thread.id}`}
              thread={thread}
              busy={github.busyThreadId === thread.id}
              selected={this.state.selectedGitHubIds.has(thread.id)}
              selectionDisabled={this.state.bulkBusy}
              onToggleSelected={this.onToggleGitHubSelected}
              onActivate={this.onActivateGitHub}
              onMarkRead={this.onMarkGitHubRead}
              onRequestDone={this.onRequestDone}
            />
          ))}
        </ol>
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
          {this.renderSearchFilters()}
          {this.renderFilters()}
          {this.renderBulkToolbar()}
          {this.renderClearConfirmation()}
          {this.renderBulkConfirmation()}
          {source === 'github' ? this.renderDoneConfirmation() : null}
          <div
            id="notification-centre-filter-panel"
            className="notification-centre-tabpanel"
            role="tabpanel"
            aria-labelledby={`notification-centre-${source}-${filter}-tab`}
            aria-busy={
              source === 'github' &&
              (this.state.github.loading ||
                this.state.github.clearingAll ||
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
