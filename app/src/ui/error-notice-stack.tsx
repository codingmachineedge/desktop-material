import * as React from 'react'

import { IErrorNotice } from '../models/error-notice'
import { Octicon } from './octicons'
import * as octicons from './octicons/octicons.generated'
import { TooltippedContent } from './lib/tooltipped-content'
import { TooltipDirection } from './lib/tooltip'

interface IErrorNoticeCardProps {
  readonly notice: IErrorNotice
  readonly onDismiss: (id: string) => void
  readonly onShowDetails?: (notice: IErrorNotice) => void
}

interface IErrorNoticeCardState {
  readonly detailsExpanded: boolean
}

class ErrorNoticeCard extends React.PureComponent<
  IErrorNoticeCardProps,
  IErrorNoticeCardState
> {
  public state: IErrorNoticeCardState = { detailsExpanded: false }

  private onDismiss = () => {
    this.props.onDismiss(this.props.notice.id)
  }

  private onShowDetails = () => {
    if (this.props.onShowDetails !== undefined) {
      this.props.onShowDetails(this.props.notice)
      return
    }

    this.setState(state => ({ detailsExpanded: !state.detailsExpanded }))
  }

  public render() {
    const { notice } = this.props
    const showDetails = notice.details !== null

    return (
      <article
        className="error-notice"
        role="alert"
        aria-atomic="true"
        data-error-notice-id={notice.id}
      >
        <span className="error-notice-icon" aria-hidden="true">
          <Octicon symbol={octicons.alert} />
        </span>
        <div className="error-notice-content">
          <h2>{notice.title}</h2>
          <p>{notice.message}</p>
          {notice.occurrences > 1 && (
            <span className="error-notice-occurrences">
              Reported {notice.occurrences} times
            </span>
          )}
          {this.state.detailsExpanded && notice.details !== null && (
            <pre className="error-notice-diagnostic">{notice.details}</pre>
          )}
        </div>
        <div className="error-notice-actions">
          {showDetails && (
            <button
              type="button"
              className="error-notice-details"
              onClick={this.onShowDetails}
              aria-expanded={this.state.detailsExpanded}
            >
              {this.state.detailsExpanded ? 'Hide details' : 'Details'}
            </button>
          )}
          <TooltippedContent
            tooltip={`Dismiss ${notice.title}`}
            direction={TooltipDirection.WEST}
            openOnFocus={true}
          >
            <button
              type="button"
              className="error-notice-dismiss"
              aria-label={`Dismiss ${notice.title}`}
              onClick={this.onDismiss}
            >
              <Octicon symbol={octicons.x} />
            </button>
          </TooltippedContent>
        </div>
      </article>
    )
  }
}

export interface IErrorNoticeStackProps {
  readonly notices: ReadonlyArray<IErrorNotice>
  readonly onDismiss: (id: string) => void
  readonly onShowDetails?: (notice: IErrorNotice) => void
}

/** Fixed non-modal stack for bounded transient application errors. */
export class ErrorNoticeStack extends React.PureComponent<IErrorNoticeStackProps> {
  public render() {
    if (this.props.notices.length === 0) {
      return null
    }

    return (
      <section className="error-notice-stack" aria-label="Error notifications">
        {this.props.notices.map(notice => (
          <ErrorNoticeCard
            key={notice.id}
            notice={notice}
            onDismiss={this.props.onDismiss}
            onShowDetails={this.props.onShowDetails}
          />
        ))}
      </section>
    )
  }
}
