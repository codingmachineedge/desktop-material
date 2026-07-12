import * as React from 'react'
import { Dispatcher } from '../dispatcher'
import { nameOf, Repository } from '../../models/repository'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { TextBox } from '../lib/text-box'

interface IChangeRepositoryGroupNameProps {
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
  readonly repository: Repository
}

interface IChangeRepositoryGroupNameState {
  readonly newGroupName: string
}

export class ChangeRepositoryGroupName extends React.Component<
  IChangeRepositoryGroupNameProps,
  IChangeRepositoryGroupNameState
> {
  public constructor(props: IChangeRepositoryGroupNameProps) {
    super(props)
    this.state = {
      newGroupName:
        props.repository.groupName ??
        props.repository.gitHubRepository?.owner.login ??
        '',
    }
  }

  private onNameChanged = (newGroupName: string) => {
    this.setState({ newGroupName })
  }

  private changeGroupName = () => {
    const name = this.state.newGroupName.trim()
    if (name.length === 0) {
      return
    }
    this.props.dispatcher.changeRepositoryGroupName(this.props.repository, name)
    this.props.onDismissed()
  }

  public render() {
    return (
      <Dialog
        id="change-repository-group-name"
        title={
          __DARWIN__
            ? 'Change Repository Group Name'
            : 'Change repository group name'
        }
        ariaDescribedBy="change-repository-group-name-description"
        onDismissed={this.props.onDismissed}
        onSubmit={this.changeGroupName}
      >
        <DialogContent>
          <p id="change-repository-group-name-description">
            Choose a list group for “{nameOf(this.props.repository)}”.
          </p>
          <TextBox
            ariaLabel="Group name"
            value={this.state.newGroupName}
            onValueChanged={this.onNameChanged}
          />
          <p className="description">
            This changes only Desktop Material’s local organization.
          </p>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={__DARWIN__ ? 'Change Group' : 'Change group'}
            okButtonDisabled={this.state.newGroupName.trim().length === 0}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
