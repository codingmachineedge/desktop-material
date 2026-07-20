import * as React from 'react'
import { Button } from '../lib/button'
import { trapActionsDialogFocus } from './actions-dialog-focus'

interface IActionsConfirmationDialogProps {
  readonly eyebrow: string
  readonly title: string
  readonly description: React.ReactNode
  readonly confirmLabel: string
  readonly confirmClassName?: string
  readonly submitting: boolean
  readonly error?: Error | null
  readonly progressMessage?: string | null
  readonly onConfirm: () => void
  readonly onDismissed: () => void
  readonly onCancelSubmitting?: () => void
  readonly cancelSubmittingLabel?: string
  readonly onReturnFocus?: () => void
}

let actionsConfirmationDialogSequence = 0

/** An in-context confirmation surface for destructive Actions mutations. */
export class ActionsConfirmationDialog extends React.Component<IActionsConfirmationDialogProps> {
  private dismissButton: HTMLButtonElement | null = null
  private previousFocus: HTMLElement | null = null
  private readonly titleId: string
  private readonly descriptionId: string
  private readonly progressId: string
  private readonly errorId: string

  public constructor(props: IActionsConfirmationDialogProps) {
    super(props)
    const instanceId = ++actionsConfirmationDialogSequence
    this.titleId = `actions-confirmation-title-${instanceId}`
    this.descriptionId = `actions-confirmation-description-${instanceId}`
    this.progressId = `actions-confirmation-progress-${instanceId}`
    this.errorId = `actions-confirmation-error-${instanceId}`
  }

  public componentDidMount() {
    this.previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    this.dismissButton?.focus()
  }

  public componentWillUnmount() {
    if (this.props.onReturnFocus !== undefined) {
      this.props.onReturnFocus()
    } else if (this.previousFocus?.isConnected) {
      this.previousFocus.focus()
    }
  }

  private setDismissButtonRef = (button: HTMLButtonElement | null) => {
    this.dismissButton = button
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    event.stopPropagation()
    trapActionsDialogFocus(event, event.currentTarget)
    if (
      event.key === 'Escape' &&
      (!this.props.submitting || this.props.onCancelSubmitting !== undefined)
    ) {
      event.preventDefault()
      this.dismiss()
    }
  }

  private dismiss = () => {
    if (this.props.submitting) {
      this.props.onCancelSubmitting?.()
      return
    }
    this.props.onDismissed()
  }

  private submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!this.props.submitting) {
      this.props.onConfirm()
    }
  }

  public render() {
    const canCancelSubmission =
      this.props.submitting && this.props.onCancelSubmitting !== undefined
    const describedBy = [
      this.descriptionId,
      this.props.progressMessage ? this.progressId : null,
      this.props.error ? this.errorId : null,
    ]
      .filter((value): value is string => value !== null)
      .join(' ')
    return (
      <div className="actions-dialog-layer">
        {/* This modal surface blocks controls behind the in-context scrim. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <form
          className="actions-confirmation-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={this.titleId}
          aria-describedby={describedBy}
          aria-busy={this.props.submitting}
          tabIndex={-1}
          onKeyDown={this.onKeyDown}
          onSubmit={this.submit}
        >
          <header>
            <div>
              <span className="eyebrow">{this.props.eyebrow}</span>
              <h2 id={this.titleId}>{this.props.title}</h2>
            </div>
          </header>
          <div className="actions-confirmation-body">
            <div className="actions-confirmation-copy" id={this.descriptionId}>
              {this.props.description}
            </div>
            {this.props.progressMessage && (
              <div
                id={this.progressId}
                className="actions-cancellation-progress"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {this.props.progressMessage}
              </div>
            )}
            {this.props.error && (
              <div
                id={this.errorId}
                className="actions-inline-error"
                role="alert"
              >
                {this.props.error.message}
              </div>
            )}
          </div>
          <footer>
            <Button
              onButtonRef={this.setDismissButtonRef}
              onClick={this.dismiss}
              disabled={this.props.submitting && !canCancelSubmission}
            >
              {canCancelSubmission
                ? this.props.cancelSubmittingLabel ?? 'Cancel request'
                : 'Keep current state'}
            </Button>
            <Button
              type="submit"
              className={this.props.confirmClassName ?? 'destructive'}
              disabled={this.props.submitting}
              ariaDescribedBy={this.descriptionId}
            >
              {this.props.submitting ? 'Requesting…' : this.props.confirmLabel}
            </Button>
          </footer>
        </form>
      </div>
    )
  }
}
