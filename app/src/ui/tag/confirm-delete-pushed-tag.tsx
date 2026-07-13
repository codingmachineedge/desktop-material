import * as React from 'react'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Ref } from '../lib/ref'

interface IConfirmDeletePushedTagProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly tagName: string
  readonly onDismissed: () => void
}

interface IConfirmDeletePushedTagState {
  readonly isDeleting: boolean
}

/** Guards deletion of a tag that is known to exist on a remote. */
export class ConfirmDeletePushedTagDialog extends React.Component<
  IConfirmDeletePushedTagProps,
  IConfirmDeletePushedTagState
> {
  public constructor(props: IConfirmDeletePushedTagProps) {
    super(props)
    this.state = { isDeleting: false }
  }

  public render() {
    return (
      <Dialog
        id="delete-pushed-tag"
        type="warning"
        title={__DARWIN__ ? 'Delete Pushed Tag?' : 'Delete pushed tag?'}
        loading={this.state.isDeleting}
        disabled={this.state.isDeleting}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        ariaDescribedBy="delete-pushed-tag-confirmation"
        role="alertdialog"
      >
        <DialogContent>
          <p id="delete-pushed-tag-confirmation">
            The tag <Ref>{this.props.tagName}</Ref> has already been pushed.
            Deleting it removes the local tag, but does not remove the tag from
            the remote repository.
          </p>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup destructive={true} okButtonText="Delete" />
        </DialogFooter>
      </Dialog>
    )
  }

  private onSubmit = async () => {
    const { dispatcher, repository, tagName, onDismissed } = this.props
    this.setState({ isDeleting: true })
    try {
      await dispatcher.deleteTag(repository, tagName)
    } finally {
      this.setState({ isDeleting: false })
    }
    onDismissed()
  }
}
