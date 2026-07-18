import * as React from 'react'
import { Dialog, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Submodules } from '../repository-settings/submodules'

interface ISubmoduleManagerDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
}

/**
 * The repository-page submodule manager.
 *
 * Surfaces the full submodule management experience — status reconciliation,
 * per-submodule clone/update/sync/remove, add, and update-all — as a
 * standalone dialog so a repository with submodules can be managed in place
 * without adding each submodule as a separate repository. The underlying
 * component is shared with the Repository Settings "Submodules" tab.
 */
export class SubmoduleManagerDialog extends React.Component<ISubmoduleManagerDialogProps> {
  public render() {
    return (
      <Dialog
        id="submodule-manager"
        title={__DARWIN__ ? 'Submodule Manager' : 'Submodule manager'}
        onSubmit={this.props.onDismissed}
        onDismissed={this.props.onDismissed}
      >
        <Submodules
          repository={this.props.repository}
          dispatcher={this.props.dispatcher}
        />
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Close"
            cancelButtonVisible={false}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
