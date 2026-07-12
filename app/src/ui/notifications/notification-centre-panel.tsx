import * as React from 'react'
import classNames from 'classnames'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { PopupType } from '../../models/popup'
import { shell } from '../../lib/app-shell'
import { INotificationEntry } from '../../models/notification-centre'
import { NotificationListItem } from './notification-list-item'

type NotificationFilter = 'all' | 'unread'

interface INotificationCentrePanelProps {
  readonly dispatcher: Dispatcher
  readonly entries: ReadonlyArray<INotificationEntry>
  readonly unreadCount: number
  readonly repositories: ReadonlyArray<Repository | CloningRepository>
}

interface INotificationCentrePanelState {
  readonly filter: NotificationFilter
  /** Two-tap guard for Clear all. */
  readonly confirmingClear: boolean
}

/**
 * The notification centre right side sheet (design-spec-overlays §9). Non-modal
 * — it persists while the user keeps working — with an All/Unread segmented
 * control, a flat list of notifications, and overflow actions for mark-all,
 * clear-all (two-tap) and opening the git-backed history manager.
 */
export class NotificationCentrePanel extends React.Component<
  INotificationCentrePanelProps,
  INotificationCentrePanelState
> {
  public constructor(props: INotificationCentrePanelProps) {
    super(props)
    this.state = { filter: 'all', confirmingClear: false }
  }

  public componentDidMount() {
    window.addEventListener('keydown', this.onWindowKeyDown)
  }

  public componentWillUnmount() {
    window.removeEventListener('keydown', this.onWindowKeyDown)
  }

  private onWindowKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.onClose()
    }
  }

  private onClose = () => {
    this.props.dispatcher.setNotificationCentreOpen(false)
  }

  private onSelectAll = () => this.setState({ filter: 'all' })
  private onSelectUnread = () => this.setState({ filter: 'unread' })

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
          r => r.id === action.repositoryId
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
          .catch(err => log.error('Failed to open notification link', err))
        break
    }
  }

  private get visibleEntries(): ReadonlyArray<INotificationEntry> {
    return this.state.filter === 'unread'
      ? this.props.entries.filter(entry => !entry.read)
      : this.props.entries
  }

  private renderHeader() {
    return (
      <header className="notification-centre-header">
        <span className="notification-centre-header-icon" aria-hidden="true">
          <Octicon symbol={octicons.bellFill} />
        </span>
        <span className="notification-centre-header-copy">
          <h1>Notifications</h1>
          <small title="notifications repository">
            userData/notifications.git
          </small>
        </span>
        <button
          type="button"
          className="notification-centre-icon-button"
          aria-label="Mark all as read"
          title="Mark all as read"
          disabled={this.props.unreadCount === 0}
          onClick={this.onMarkAllRead}
        >
          <Octicon symbol={octicons.checklist} />
        </button>
        <button
          type="button"
          className="notification-centre-icon-button"
          aria-label="Notification history"
          title="Notification history"
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
          title={this.state.confirmingClear ? 'Click again to clear' : 'Clear all'}
          disabled={this.props.entries.length === 0}
          onClick={this.onClearAll}
        >
          <Octicon symbol={octicons.trash} />
        </button>
        <button
          type="button"
          className="notification-centre-icon-button notification-centre-close"
          aria-label="Close notifications"
          title="Close notifications"
          onClick={this.onClose}
        >
          <Octicon symbol={octicons.x} />
        </button>
      </header>
    )
  }

  private renderSegmented() {
    const { filter } = this.state
    return (
      <div className="notification-centre-segmented" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className={classNames({ selected: filter === 'all' })}
          onClick={this.onSelectAll}
        >
          All
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'unread'}
          className={classNames({ selected: filter === 'unread' })}
          onClick={this.onSelectUnread}
        >
          Unread{this.props.unreadCount > 0 ? ` (${this.props.unreadCount})` : ''}
        </button>
      </div>
    )
  }

  private renderList() {
    const entries = this.visibleEntries

    if (entries.length === 0) {
      return (
        <div className="notification-centre-empty">
          <Octicon symbol={octicons.bellSlash} />
          <span>You're all caught up</span>
        </div>
      )
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

  public render() {
    return (
      <section
        className="notification-centre-panel"
        role="dialog"
        aria-label="Notifications"
        aria-modal="false"
      >
        {this.renderHeader()}
        {this.renderSegmented()}
        {this.renderList()}
      </section>
    )
  }
}
