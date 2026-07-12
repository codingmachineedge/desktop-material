import * as React from 'react'
import classNames from 'classnames'
import { Octicon, OcticonSymbol } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { RelativeTime } from '../relative-time'
import {
  INotificationEntry,
  NotificationCentreKind,
} from '../../models/notification-centre'

interface INotificationListItemProps {
  readonly entry: INotificationEntry
  /** Activate the row: run its action (if any) and mark it read. */
  readonly onActivate: (entry: INotificationEntry) => void
  /** Toggle the read/unread state without activating the action. */
  readonly onToggleRead: (entry: INotificationEntry) => void
  readonly onDelete: (entry: INotificationEntry) => void
}

/** The octicon shown in each notification's kind chip. */
const kindIcons: Record<NotificationCentreKind, OcticonSymbolVariant> = {
  'pr-review-submit': octicons.eye,
  'pr-comment': octicons.comment,
  'pr-checks-failed': octicons.xCircle,
  'app-error': octicons.alert,
  'clone-batch': octicons.desktopDownload,
  'auto-commit': octicons.gitCommit,
  'merge-all': octicons.gitMerge,
  'auto-pull': octicons.arrowDown,
  info: octicons.info,
}

/** A single row in the notification centre list. */
export class NotificationListItem extends React.Component<INotificationListItemProps> {
  private onActivate = () => this.props.onActivate(this.props.entry)

  private onToggleRead = (event: React.MouseEvent) => {
    event.stopPropagation()
    this.props.onToggleRead(this.props.entry)
  }

  private onDelete = (event: React.MouseEvent) => {
    event.stopPropagation()
    this.props.onDelete(this.props.entry)
  }

  private onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      this.onActivate()
    }
  }

  public render() {
    const { entry } = this.props
    const className = classNames('notification-item', `kind-${entry.kind}`, {
      unread: !entry.read,
    })

    return (
      <li
        className={className}
        role="button"
        tabIndex={0}
        onClick={this.onActivate}
        onKeyDown={this.onKeyDown}
      >
        <span className="notification-item-icon" aria-hidden="true">
          <Octicon symbol={kindIcons[entry.kind] ?? octicons.info} />
        </span>
        <span className="notification-item-body">
          <span className="notification-item-title">{entry.title}</span>
          <span className="notification-item-text">{entry.body}</span>
          <span className="notification-item-time">
            <RelativeTime date={new Date(entry.createdAt)} />
          </span>
        </span>
        {!entry.read ? (
          <span
            className="notification-item-unread-dot"
            aria-label="Unread"
            title="Unread"
          />
        ) : null}
        <button
          type="button"
          className="notification-item-read-toggle"
          aria-label={entry.read ? 'Mark as unread' : 'Mark as read'}
          title={entry.read ? 'Mark as unread' : 'Mark as read'}
          onClick={this.onToggleRead}
        >
          <Octicon symbol={entry.read ? octicons.dotFill : octicons.check} />
        </button>
        <button
          type="button"
          className="notification-item-delete"
          aria-label="Delete notification"
          title="Delete notification"
          onClick={this.onDelete}
        >
          <Octicon symbol={octicons.trash} />
        </button>
      </li>
    )
  }
}
