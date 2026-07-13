import * as React from 'react'
import classNames from 'classnames'

import { IAPINotificationThread } from '../../lib/api'
import { Octicon, OcticonSymbol } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { RelativeTime } from '../relative-time'

interface IGitHubNotificationListItemProps {
  readonly thread: IAPINotificationThread
  readonly busy: boolean
  readonly onActivate: (thread: IAPINotificationThread) => void
  readonly onMarkRead: (thread: IAPINotificationThread) => void
  readonly onRequestDone: (
    thread: IAPINotificationThread,
    returnFocus: HTMLButtonElement
  ) => void
}

const iconForSubject = (type: string): OcticonSymbol => {
  switch (type) {
    case 'PullRequest':
      return octicons.gitPullRequest
    case 'Issue':
      return octicons.issueOpened
    case 'Discussion':
      return octicons.commentDiscussion
    case 'Commit':
      return octicons.gitCommit
    case 'CheckSuite':
      return octicons.workflow
    case 'RepositoryVulnerabilityAlert':
      return octicons.shieldCheck
    default:
      return octicons.bell
  }
}

const readableReason = (reason: string): string =>
  reason.replace(/_/g, ' ').replace(/^./, value => value.toUpperCase())

/** A remote GitHub inbox row; it is never persisted to local history. */
export class GitHubNotificationListItem extends React.Component<IGitHubNotificationListItemProps> {
  private onActivate = () => this.props.onActivate(this.props.thread)

  private onMarkRead = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    this.props.onMarkRead(this.props.thread)
  }

  private onRequestDone = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    this.props.onRequestDone(this.props.thread, event.currentTarget)
  }

  public render() {
    const { thread, busy } = this.props
    return (
      <li
        className={classNames('notification-item', 'github-notification-item', {
          unread: thread.unread,
        })}
      >
        <button
          type="button"
          className="notification-item-activate"
          disabled={busy}
          onClick={this.onActivate}
        >
          <span className="notification-item-icon" aria-hidden="true">
            <Octicon symbol={iconForSubject(thread.subject.type)} />
          </span>
          <span className="notification-item-body">
            <span className="notification-item-title">
              {thread.subject.title}
            </span>
            <span className="notification-item-text github-notification-repository">
              {thread.repository.full_name}
            </span>
            <span className="github-notification-meta">
              <span>{readableReason(thread.reason)}</span>
              <span aria-hidden="true">·</span>
              <span className="notification-item-time">
                <RelativeTime date={new Date(thread.updated_at)} />
              </span>
            </span>
          </span>
        </button>
        {thread.unread ? (
          <span className="notification-item-unread-dot" aria-hidden="true" />
        ) : null}
        {thread.unread ? (
          <button
            type="button"
            className="notification-item-read-toggle"
            aria-label={`Mark as read: ${thread.subject.title}`}
            disabled={busy}
            onClick={this.onMarkRead}
          >
            <Octicon symbol={octicons.check} />
          </button>
        ) : null}
        <button
          type="button"
          className="notification-item-delete github-notification-done"
          aria-label={`Mark as done: ${thread.subject.title}`}
          disabled={busy}
          onClick={this.onRequestDone}
        >
          <Octicon symbol={octicons.archive} />
        </button>
      </li>
    )
  }
}
