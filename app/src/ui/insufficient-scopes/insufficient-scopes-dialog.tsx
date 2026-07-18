import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Account } from '../../models/account'
import { Ref } from '../lib/ref'

interface IInsufficientScopesDialogProps {
  readonly account: Account
  readonly missingScopes: ReadonlyArray<string>

  /** Starts the sign-in flow that re-grants the full scope set. */
  readonly onSignInAgain: (account: Account) => void

  readonly onDismissed: () => void
}

/**
 * Shown when a signed-in GitHub account's token predates the scopes the
 * app's current features need (e.g. Releases requires the full `repo`
 * grant). Signing in again re-authorizes with the complete scope list.
 */
export class InsufficientScopesDialog extends React.Component<IInsufficientScopesDialogProps> {
  private onSubmit = () => {
    this.props.onDismissed()
    this.props.onSignInAgain(this.props.account)
  }

  public render() {
    const { account, missingScopes } = this.props

    return (
      <Dialog
        id="insufficient-oauth-scopes"
        title={
          __DARWIN__
            ? 'Grant Additional GitHub Permissions'
            : 'Grant additional GitHub permissions'
        }
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          <p>
            Some features — such as Releases, Actions administration, and
            notifications — need more powerful permissions than{' '}
            <Ref>@{account.login}</Ref>'s current sign-in granted.
          </p>
          <p className="insufficient-scopes-list">
            Missing permission {missingScopes.length === 1 ? 'scope' : 'scopes'}
            :{' '}
            {missingScopes.map(scope => (
              <Ref key={scope}>{scope}</Ref>
            ))}
          </p>
          <p>
            Signing in again re-authorizes Desktop Material with the complete
            permission set. Your repositories and settings are untouched.
          </p>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={__DARWIN__ ? 'Sign In Again' : 'Sign in again'}
            cancelButtonText="Not now"
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
