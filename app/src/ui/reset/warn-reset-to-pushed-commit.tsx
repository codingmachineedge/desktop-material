import * as React from 'react'
import { Commit } from '../../models/commit'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'

interface IWarnResetToPushedCommitProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly commit: Commit
  readonly onDismissed: () => void
}

interface IWarnResetToPushedCommitState {
  readonly isLoading: boolean
}

/** Guards a reset which discards commits already present on the remote. */
export class WarnResetToPushedCommit extends React.Component<
  IWarnResetToPushedCommitProps,
  IWarnResetToPushedCommitState
> {
  public constructor(props: IWarnResetToPushedCommitProps) {
    super(props)
    this.state = { isLoading: false }
  }

  public render() {
    return (
      <Dialog
        id="warn-reset-to-pushed-commit"
        type="warning"
        title={
          __DARWIN__ ? 'Reset to Pushed Commit?' : 'Reset to pushed commit?'
        }
        loading={this.state.isLoading}
        disabled={this.state.isLoading}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        role="alertdialog"
        ariaDescribedBy="reset-to-pushed-commit-warning-message"
      >
        <DialogContent>
          <p id="reset-to-pushed-commit-warning-message">
            Resetting here discards commits that have already been pushed and
            rewrites your local branch history.
          </p>
          <p>
            Updating the remote will require a force push and can disrupt
            collaborators. Are you sure you want to continue?
          </p>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup destructive={true} okButtonText="Reset" />
        </DialogFooter>
      </Dialog>
    )
  }

  private onSubmit = async () => {
    const { dispatcher, repository, commit, onDismissed } = this.props
    this.setState({ isLoading: true })
    try {
      await dispatcher.resetToCommit(repository, commit, false)
    } finally {
      this.setState({ isLoading: false })
    }
    onDismissed()
  }
}
