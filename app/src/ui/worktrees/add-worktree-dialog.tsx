import * as React from 'react'

import { Branch } from '../../models/branch'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { TextBox } from '../lib/text-box'
import { RefNameTextBox } from '../lib/ref-name-text-box'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { showOpenDialog } from '../main-process-proxy'
import { addWorktree, listWorktrees } from '../../lib/git/worktree'
import { BranchAutocompletionProvider } from '../autocompletion/branch-autocompletion-provider'

interface IAddWorktreeDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
  readonly initialBranchName?: string
  readonly allBranches: ReadonlyArray<Branch>
}

interface IAddWorktreeDialogState {
  readonly path: string
  readonly branchName: string
  readonly creating: boolean
}

export class AddWorktreeDialog extends React.Component<
  IAddWorktreeDialogProps,
  IAddWorktreeDialogState
> {
  private readonly branchAutocompletionProvider: BranchAutocompletionProvider

  public constructor(props: IAddWorktreeDialogProps) {
    super(props)

    this.branchAutocompletionProvider = new BranchAutocompletionProvider(
      props.allBranches
    )

    this.state = {
      path: '',
      branchName: props.initialBranchName ?? '',
      creating: false,
    }
  }

  private onPathChanged = (path: string) => {
    this.setState({ path })
  }

  private onBranchNameChanged = (branchName: string) => {
    this.setState({ branchName })
  }

  private showFilePicker = async () => {
    const path = await showOpenDialog({
      properties: ['createDirectory', 'openDirectory'],
    })

    if (path === null) {
      return
    }

    this.setState({ path })
  }

  private branchExists(name: string): boolean {
    return this.props.allBranches.some(b => b.name === name)
  }

  private onSubmit = async () => {
    const { path, branchName } = this.state

    this.setState({ creating: true })

    const branchExists = this.branchExists(branchName)

    try {
      await addWorktree(this.props.repository, path, {
        branch: branchExists ? branchName : undefined,
        createBranch:
          !branchExists && branchName.length > 0 ? branchName : undefined,
      })
    } catch (e) {
      this.props.dispatcher.postError(e)
      this.setState({ creating: false })
      return
    }

    const { dispatcher, repository } = this.props
    const worktrees = await listWorktrees(repository)
    const worktree = worktrees.find(wt => wt.path === path)

    if (!worktree) {
      this.props.dispatcher.postError(
        new Error('Failed to find the newly created worktree')
      )
      this.setState({ creating: false })
      return
    }

    await dispatcher.switchWorktree(repository, worktree)

    this.setState({ creating: false })
    this.props.onDismissed()
  }

  private renderBranchStatus() {
    const { branchName } = this.state
    if (branchName.length === 0) {
      return null
    }

    const exists = this.branchExists(branchName)
    const message = exists
      ? `Will check out existing branch "${branchName}"`
      : `Will create new branch "${branchName}"`

    return (
      <Row>
        <p className="branch-status-hint">{message}</p>
      </Row>
    )
  }

  public render() {
    const disabled = this.state.path.length === 0 || this.state.creating

    return (
      <Dialog
        id="add-worktree"
        title={__DARWIN__ ? 'Add Worktree' : 'Add worktree'}
        loading={this.state.creating}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <Row>
            <TextBox
              value={this.state.path}
              label={__DARWIN__ ? 'Worktree Path' : 'Worktree path'}
              placeholder="worktree path"
              onValueChanged={this.onPathChanged}
            />
            <Button onClick={this.showFilePicker}>Choose…</Button>
          </Row>

          <Row>
            <RefNameTextBox
              label={__DARWIN__ ? 'Branch Name' : 'Branch name'}
              initialValue={this.state.branchName}
              onValueChange={this.onBranchNameChanged}
              autocompletionProvider={this.branchAutocompletionProvider}
            />
          </Row>
          {this.renderBranchStatus()}
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={__DARWIN__ ? 'Create Worktree' : 'Create worktree'}
            okButtonDisabled={disabled}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
