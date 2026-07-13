import * as React from 'react'
import { Commit } from '../../models/commit'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'

interface IWarnUndoPushedCommitProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly commit: Commit
  readonly onDismissed: () => void
}

interface IWarnUndoPushedCommitState {
  readonly isLoading: boolean
}

/** Guards rewriting HEAD when it has already been pushed. */
export class WarnUndoPushedCommit extends React.Component<
  IWarnUndoPushedCommitProps,
  IWarnUndoPushedCommitState
> {
  public constructor(props: IWarnUndoPushedCommitProps) {
    super(props)
    this.state = { isLoading: false }
  }

  public render() {
    return (
      <Dialog
        id="warn-undo-pushed-commit"
        type="warning"
        title={__DARWIN__ ? 'Undo Pushed Commit?' : 'Undo pushed commit?'}
        loading={this.state.isLoading}
        disabled={this.state.isLoading}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        role="alertdialog"
        ariaDescribedBy="undo-pushed-commit-warning-message"
      >
        <DialogContent>
          <p id="undo-pushed-commit-warning-message">
            This commit has already been pushed. Undoing it rewrites local
            history and requires a force push to update the remote.
          </p>
          <p>
            Collaborators who pulled the commit may have to reconcile their
            history. Are you sure you want to continue?
          </p>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup destructive={true} okButtonText="Undo Commit" />
        </DialogFooter>
      </Dialog>
    )
  }

  private onSubmit = async () => {
    const { dispatcher, repository, commit, onDismissed } = this.props
    this.setState({ isLoading: true })
    try {
      await dispatcher.undoCommit(repository, commit, false)
    } finally {
      this.setState({ isLoading: false })
    }
    onDismissed()
  }
}
