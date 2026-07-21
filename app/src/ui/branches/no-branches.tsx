import * as React from 'react'
import { Button } from '../lib/button'
import { EmptyState } from '../lib/empty-state'
import { KeyboardShortcut } from '../keyboard-shortcut/keyboard-shortcut'

interface INoBranchesProps {
  /** The callback to invoke when the user wishes to create a new branch */
  readonly onCreateNewBranch: () => void
  /** True to display the UI elements for creating a new branch, false to hide them */
  readonly canCreateNewBranch: boolean
  /** Optional: No branches message */
  readonly noBranchesMessage?: string | JSX.Element
}

export class NoBranches extends React.Component<INoBranchesProps> {
  public render() {
    if (this.props.canCreateNewBranch) {
      return (
        <div className="no-branches">
          <EmptyState
            symbol="alt_route"
            title="Sorry, I can't find that branch"
            description="Do you want to create a new branch instead?"
          >
            <Button
              className="create-branch-button"
              onClick={this.props.onCreateNewBranch}
              type="submit"
            >
              {__DARWIN__ ? 'Create New Branch' : 'Create new branch'}
            </Button>

            <div className="protip">
              ProTip! Press{' '}
              <KeyboardShortcut
                darwinKeys={['⌘', '⇧', 'N']}
                keys={['Ctrl', 'Shift', 'N']}
              />{' '}
              to quickly create a new branch from anywhere within the app
            </div>
          </EmptyState>
        </div>
      )
    }

    return (
      <div className="no-branches">
        {this.props.noBranchesMessage ?? "Sorry, I can't find that branch"}
      </div>
    )
  }
}
