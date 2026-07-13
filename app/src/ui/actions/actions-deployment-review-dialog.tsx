import * as React from 'react'
import {
  ActionsRunReviewCommentMaximumLength,
  ActionsRunReviewState,
  IActionsPendingDeployment,
} from '../../lib/actions-run-reviews'
import { Button } from '../lib/button'
import { trapActionsDialogFocus } from './actions-dialog-focus'

interface IActionsDeploymentReviewDialogProps {
  readonly decision: ActionsRunReviewState
  readonly environments: ReadonlyArray<IActionsPendingDeployment>
  readonly submitting: boolean
  readonly error: Error | null
  readonly onConfirm: (comment: string) => void
  readonly onDismissed: () => void
}

interface IActionsDeploymentReviewDialogState {
  readonly comment: string
}

let actionsDeploymentReviewDialogSequence = 0

/** Purpose-built confirmation for an exact set of deployment environments. */
export class ActionsDeploymentReviewDialog extends React.Component<
  IActionsDeploymentReviewDialogProps,
  IActionsDeploymentReviewDialogState
> {
  private commentInput: HTMLTextAreaElement | null = null
  private previousFocus: HTMLElement | null = null
  private readonly titleId: string
  private readonly descriptionId: string
  private readonly commentId: string
  private readonly commentGuidanceId: string
  private readonly commentCountId: string
  private readonly errorId: string

  public constructor(props: IActionsDeploymentReviewDialogProps) {
    super(props)
    const instanceId = ++actionsDeploymentReviewDialogSequence
    this.titleId = `actions-deployment-review-title-${instanceId}`
    this.descriptionId = `actions-deployment-review-description-${instanceId}`
    this.commentId = `actions-review-comment-${instanceId}`
    this.commentGuidanceId = `actions-review-comment-guidance-${instanceId}`
    this.commentCountId = `actions-review-comment-count-${instanceId}`
    this.errorId = `actions-review-comment-error-${instanceId}`
    this.state = { comment: '' }
  }

  public componentDidMount() {
    this.previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    this.commentInput?.focus()
  }

  public componentWillUnmount() {
    if (this.previousFocus?.isConnected) {
      this.previousFocus.focus()
    }
  }

  private setCommentInputRef = (input: HTMLTextAreaElement | null) => {
    this.commentInput = input
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    event.stopPropagation()
    trapActionsDialogFocus(event, event.currentTarget)
    if (event.key === 'Escape' && !this.props.submitting) {
      event.preventDefault()
      this.props.onDismissed()
    }
  }

  private onCommentChanged = (event: React.FormEvent<HTMLTextAreaElement>) =>
    this.setState({ comment: event.currentTarget.value })

  private submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!this.props.submitting && this.state.comment.trim().length > 0) {
      this.props.onConfirm(this.state.comment)
    }
  }

  public render() {
    const approving = this.props.decision === 'approved'
    const validComment = this.state.comment.trim().length > 0
    const title = approving
      ? 'Approve selected deployments?'
      : 'Reject selected deployments?'
    return (
      <div className="actions-dialog-layer">
        {/* This modal surface blocks controls behind the in-context scrim. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <form
          className="actions-deployment-review-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={this.titleId}
          aria-describedby={`${this.descriptionId}${
            this.props.error === null ? '' : ` ${this.errorId}`
          }`}
          tabIndex={-1}
          onKeyDown={this.onKeyDown}
          onSubmit={this.submit}
        >
          <header>
            <div>
              <span className="eyebrow">Deployment review</span>
              <h2 id={this.titleId}>{title}</h2>
            </div>
          </header>
          <div className="actions-confirmation-copy" id={this.descriptionId}>
            <p>
              {approving ? 'Approve' : 'Reject'} exactly{' '}
              {this.props.environments.length}{' '}
              {this.props.environments.length === 1
                ? 'environment'
                : 'environments'}
              :
            </p>
            <ul className="actions-review-environment-summary">
              {this.props.environments.map(environment => (
                <li key={environment.environmentId}>
                  {environment.environmentName}
                </li>
              ))}
            </ul>
          </div>
          <div className="actions-review-comment-field">
            <label htmlFor={this.commentId}>Review comment</label>
            <textarea
              id={this.commentId}
              ref={this.setCommentInputRef}
              value={this.state.comment}
              maxLength={ActionsRunReviewCommentMaximumLength}
              required={true}
              disabled={this.props.submitting}
              onChange={this.onCommentChanged}
              aria-describedby={`${this.commentGuidanceId} ${this.commentCountId}`}
            />
            <small id={this.commentGuidanceId}>
              Required. Explain the decision without including credentials or
              other secrets.
            </small>
            <small
              id={this.commentCountId}
              className="actions-review-comment-count"
              aria-live="polite"
            >
              {this.state.comment.length} /{' '}
              {ActionsRunReviewCommentMaximumLength}
            </small>
          </div>
          {this.props.error && (
            <div
              id={this.errorId}
              className="actions-inline-error"
              role="alert"
            >
              {this.props.error.message}
            </div>
          )}
          <footer>
            <Button
              onClick={this.props.onDismissed}
              disabled={this.props.submitting}
            >
              Keep pending
            </Button>
            <Button
              type="submit"
              className={approving ? 'button-component-primary' : 'destructive'}
              disabled={this.props.submitting || !validComment}
              ariaDescribedBy={`${this.descriptionId} ${this.commentGuidanceId}`}
            >
              {this.props.submitting
                ? 'Submitting…'
                : approving
                ? 'Approve deployments'
                : 'Reject deployments'}
            </Button>
          </footer>
        </form>
      </div>
    )
  }
}
