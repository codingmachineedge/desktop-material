import * as React from 'react'
import { Checkbox, CheckboxValue } from '../../lib/checkbox'
import { Dispatcher } from '../../dispatcher'
import { DialogFooter, DialogContent, Dialog } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { DefaultAppDisplayName } from '../../../models/app-identity'

interface IWarnForcePushProps {
  /**
   * This is expected to be capitalized for correct output on windows and macOs.
   *
   * Examples:
   *  - Rebase
   *  - Squash
   *  - Reorder
   *  - Amend
   */
  readonly operation: string
  readonly dispatcher: Dispatcher
  readonly askForConfirmationOnForcePush: boolean
  readonly onBegin: (
    signal?: AbortSignal,
    onPreflightAccepted?: () => void
  ) => void | Promise<void>
  readonly onDismissed: () => void
}

interface IWarnForcePushState {
  readonly askForConfirmationOnForcePush: boolean
  readonly isStarting: boolean
  readonly startError: string | null
}

export class WarnForcePushDialog extends React.Component<
  IWarnForcePushProps,
  IWarnForcePushState
> {
  private startAbortController: AbortController | null = null
  private preflightAdvanced = false
  private isMounted = false

  public constructor(props: IWarnForcePushProps) {
    super(props)

    this.state = {
      askForConfirmationOnForcePush: props.askForConfirmationOnForcePush,
      isStarting: false,
      startError: null,
    }
  }

  public componentDidMount(): void {
    this.isMounted = true
  }

  public componentWillUnmount(): void {
    this.isMounted = false
    if (
      this.startAbortController !== null &&
      this.preflightAdvanced === false
    ) {
      this.startAbortController.abort()
    }
  }

  public render() {
    const { operation } = this.props

    const title = __DARWIN__
      ? `${operation} Will Require Force Push`
      : `${operation} will require force push`

    return (
      <Dialog
        className="multi-commit-force-push-warning"
        title={title}
        onDismissed={this.onDismissed}
        onSubmit={this.onBegin}
        backdropDismissable={false}
        type="warning"
        role="alertdialog"
        ariaDescribedBy="warn-force-push-confirmation-title warn-force-push-confirmation-message"
      >
        <DialogContent>
          <p id="warn-force-push-confirmation-title">
            Are you sure you want to {operation.toLowerCase()}?
          </p>
          <p id="warn-force-push-confirmation-message">
            At the end of the {operation.toLowerCase()} flow,{' '}
            {DefaultAppDisplayName} will enable you to force push the branch to
            update the upstream branch. Force pushing will alter the history on
            the remote and potentially cause problems for others collaborating
            on this branch.
          </p>
          <div>
            <Checkbox
              label="Do not show this message again"
              disabled={this.state.isStarting}
              value={
                this.state.askForConfirmationOnForcePush
                  ? CheckboxValue.Off
                  : CheckboxValue.On
              }
              onChange={this.onAskForConfirmationOnForcePushChanged}
            />
          </div>
          {this.state.isStarting ? (
            <p className="rebase-start-progress" role="status">
              Refreshing branches and safety checks…
            </p>
          ) : null}
          {this.state.startError !== null ? (
            <p className="rebase-start-error" role="alert">
              {this.state.startError}
            </p>
          ) : null}
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={`Begin ${
              __DARWIN__ ? operation : operation.toLowerCase()
            }`}
            okButtonDisabled={this.state.isStarting}
            onCancelButtonClick={this.onDismissed}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onAskForConfirmationOnForcePushChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    const value = !event.currentTarget.checked

    this.setState({ askForConfirmationOnForcePush: value })
  }

  private onDismissed = () => {
    this.startAbortController?.abort()
    this.props.onDismissed()
  }

  private onBegin = async () => {
    if (this.startAbortController !== null) {
      return
    }

    const abortController = new AbortController()
    this.startAbortController = abortController
    this.preflightAdvanced = false
    this.setState({ isStarting: true, startError: null })

    this.props.dispatcher.setConfirmForcePushSetting(
      this.state.askForConfirmationOnForcePush
    )

    try {
      await this.props.onBegin(abortController.signal, () => {
        if (this.startAbortController === abortController) {
          this.preflightAdvanced = true
        }
      })
    } catch (error) {
      if (abortController.signal.aborted || !this.isMounted) {
        return
      }
      this.preflightAdvanced = false
      this.setState({
        isStarting: false,
        startError:
          error instanceof Error
            ? error.message
            : 'Unable to start the operation. Refresh and try again.',
      })
    } finally {
      if (this.startAbortController === abortController) {
        this.startAbortController = null
      }
    }
  }
}
