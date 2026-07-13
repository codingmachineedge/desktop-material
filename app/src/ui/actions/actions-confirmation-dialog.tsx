import * as React from 'react'
import { Button } from '../lib/button'

interface IActionsConfirmationDialogProps {
  readonly eyebrow: string
  readonly title: string
  readonly description: React.ReactNode
  readonly confirmLabel: string
  readonly forceConfirmLabel?: string
  readonly showForceCancelOption?: boolean
  readonly submitting: boolean
  readonly onConfirm: (force: boolean) => void
  readonly onDismissed: () => void
}

interface IActionsConfirmationDialogState {
  readonly force: boolean
}

/** An in-context confirmation surface for destructive Actions mutations. */
export class ActionsConfirmationDialog extends React.Component<
  IActionsConfirmationDialogProps,
  IActionsConfirmationDialogState
> {
  private dialog: HTMLDivElement | null = null

  public constructor(props: IActionsConfirmationDialogProps) {
    super(props)
    this.state = { force: false }
  }

  public componentDidMount() {
    this.dialog?.focus()
  }

  private setDialogRef = (dialog: HTMLDivElement | null) => {
    this.dialog = dialog
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
        {/* This non-modal alertdialog keeps the repository window interactive. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className="actions-confirmation-dialog"
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="actions-confirmation-title"
          aria-describedby="actions-confirmation-description"
          tabIndex={-1}
          ref={this.setDialogRef}
          onKeyDown={this.onKeyDown}
        >
          <header>
            <div>
              <span className="eyebrow">{this.props.eyebrow}</span>
              <h2 id="actions-confirmation-title">{this.props.title}</h2>
            </div>
          </header>
          <div
            className="actions-confirmation-copy"
            id="actions-confirmation-description"
          >
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
          <footer>
            <Button
              onClick={this.props.onDismissed}
              disabled={this.props.submitting}
            >
              Keep current state
            </Button>
            <Button
              className="destructive"
              onClick={this.confirm}
              disabled={this.props.submitting}
              ariaDescribedBy="actions-confirmation-description"
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
