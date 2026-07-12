import * as React from 'react'
import classNames from 'classnames'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface INotificationBellButtonProps {
  readonly unreadCount: number
  readonly isOpen: boolean
  readonly onClick: () => void
}

/**
 * The tab-strip bell that toggles the notification centre. Shows a filled bell
 * and an error-coloured unread badge (capped at "99+") when there are unread
 * notifications, per design-spec-overlays §9.
 */
export class NotificationBellButton extends React.Component<INotificationBellButtonProps> {
  public render() {
    const { unreadCount, isOpen } = this.props
    const hasUnread = unreadCount > 0
    const className = classNames('notification-bell-button', {
      open: isOpen,
      'has-unread': hasUnread,
    })
    const label = hasUnread
      ? `Notifications (${unreadCount} unread)`
      : 'Notifications'

    return (
      <button
        type="button"
        className={className}
        aria-label={label}
        title={label}
        aria-pressed={isOpen}
        onClick={this.props.onClick}
      >
        <Octicon symbol={hasUnread ? octicons.bellFill : octicons.bell} />
        {hasUnread ? (
          <span className="notification-bell-badge" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>
    )
  }
}
