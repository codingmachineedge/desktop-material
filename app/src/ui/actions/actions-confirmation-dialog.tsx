import * as React from 'react'
import { Button } from '../lib/button'
import { trapActionsDialogFocus } from './actions-dialog-focus'

interface IActionsConfirmationDialogProps {
  readonly eyebrow: string
  readonly title: string
  readonly description: React.ReactNode
  readonly confirmLabel: string
  readonly confirmClassName?: string
  readonly forceConfirmLabel?: string
  readonly showForceCancelOption?: boolean
  readonly submitting: boolean
  readonly error?: Error | null
  readonly onConfirm: (force: boolean) => void
  readonly onDismissed: () => void
}

interface IActionsConfirmationDialogState {
  readonly force: boolean
}

let actionsConfirmationDialogSequence = 0

/** An in-context confirmation surface for destructive Actions mutations. */
export class ActionsConfirmationDialog extends React.Component<
  IActionsConfirmationDialogProps,
  IActionsConfirmationDialogState
> {
  private dialog: HTMLDivElement | null = null
  private previousFocus: HTMLElement | null = null
  private readonly titleId: string
  private readonly descriptionId: string

  public constructor(props: IActionsConfirmationDialogProps) {
    super(props)
    const instanceId = ++actionsConfirmationDialogSequence
    this.titleId = `actions-confirmation-title-${instanceId}`
    this.descriptionId = `actions-confirmation-description-${instanceId}`
    this.state = { force: false }
  }

  public componentDidMount() {
    this.previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    this.dialog?.focus()
  }

  public componentWillUnmount() {
    if (this.previousFocus?.isConnected) {
      this.previousFocus.focus()
    }
  }

  private setDialogRef = (dialog: HTMLDivElement | null) => {
    this.dialog = dialog
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    trapActionsDialogFocus(event, event.currentTarget)
    if (event.key === 'Escape' && !this.props.submitting) {
      event.preventDefault()
      this.props.onDismissed()
    }
  }

  private onForceChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ force: event.currentTarget.checked })

  private confirm = () => this.props.onConfirm(this.state.force)

  public render() {
    const forceLabel = this.props.forceConfirmLabel ?? this.props.confirmLabel
    return (
      <div className="actions-dialog-layer">
        {/* This modal surface blocks controls behind the in-context scrim. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className="actions-confirmation-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={this.titleId}
          aria-describedby={this.descriptionId}
          tabIndex={-1}
          ref={this.setDialogRef}
          onKeyDown={this.onKeyDown}
        >
          <header>
            <div>
              <span className="eyebrow">{this.props.eyebrow}</span>
              <h2 id={this.titleId}>{this.props.title}</h2>
            </div>
          </header>
          <div className="actions-confirmation-copy" id={this.descriptionId}>
            {this.props.description}
          </div>
          {this.props.showForceCancelOption && (
            <label className="actions-force-cancel-option">
              <input
                type="checkbox"
                checked={this.state.force}
                disabled={this.props.submitting}
                onChange={this.onForceChanged}
              />
              <span>
                <strong>Force cancellation</strong>
                <small>
                  Bypass cancellation hooks only when the normal request cannot
                  stop the run.
                </small>
              </span>
            </label>
          )}
          {this.props.error && (
            <div className="actions-inline-error" role="alert">
              {this.props.error.message}
            </div>
          )}
          <footer>
            <Button
              onClick={this.props.onDismissed}
              disabled={this.props.submitting}
            >
              Keep current state
            </Button>
            <Button
              className={this.props.confirmClassName ?? 'destructive'}
              onClick={this.confirm}
              disabled={this.props.submitting}
              ariaDescribedBy={this.descriptionId}
            >
              {this.props.submitting
                ? 'Requesting…'
                : this.state.force
                ? forceLabel
                : this.props.confirmLabel}
            </Button>
          </footer>
        </div>
      </div>
    )
  }
}
