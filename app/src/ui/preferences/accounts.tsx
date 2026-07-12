import * as React from 'react'
import classNames from 'classnames'
import {
  Account,
  getAccountKey,
  isDotComAccount,
  isEnterpriseAccount,
} from '../../models/account'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { IAvatarUser } from '../../models/avatar'
import { lookupPreferredEmail } from '../../lib/email'
import { assertNever } from '../../lib/fatal-error'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { DialogContent, DialogPreferredFocusClassName } from '../dialog'
import { Avatar } from '../lib/avatar'
import { CallToAction } from '../lib/call-to-action'
import { getHTMLURL } from '../../lib/api'

interface IAccountsProps {
  readonly accounts: ReadonlyArray<Account>

  readonly onDotComSignIn: () => void
  readonly onEnterpriseSignIn: () => void
  readonly onLogout: (account: Account) => void
}

enum SignInType {
  DotCom,
  Enterprise,
}

export class Accounts extends React.Component<IAccountsProps, {}> {
  public render() {
    return (
      <DialogContent className="accounts-tab">
        <section className="account-section" aria-labelledby="dotcom-accounts">
          <div className="account-section-header">
            <div>
              <h2 id="dotcom-accounts">GitHub.com accounts</h2>
              <p>Switch identities without signing out of your other work.</p>
            </div>
          </div>
          {this.renderMultipleDotComAccounts()}
        </section>

        <section
          className="account-section"
          aria-labelledby="enterprise-accounts"
        >
          <div className="account-section-header">
            <div>
              <h2 id="enterprise-accounts">GitHub Enterprise accounts</h2>
              <p>Connect every organization and Enterprise host you use.</p>
            </div>
          </div>
          {this.renderMultipleEnterpriseAccounts()}
        </section>
      </DialogContent>
    )
  }

  private renderMultipleDotComAccounts() {
    const dotComAccounts = this.props.accounts.filter(isDotComAccount)

    return (
      <>
        <div className="account-card-list">
          {dotComAccounts.map((account, index) =>
            this.renderAccount(account, index === 0)
          )}
        </div>
        {dotComAccounts.length === 0 ? (
          this.renderSignIn(SignInType.DotCom)
        ) : (
          <Button onClick={this.props.onDotComSignIn}>
            Add GitHub.com account
          </Button>
        )}
      </>
    )
  }

  private renderMultipleEnterpriseAccounts() {
    const enterpriseAccounts = this.props.accounts.filter(isEnterpriseAccount)

    return (
      <>
        <div className="account-card-list">
          {enterpriseAccounts.map(account => this.renderAccount(account))}
        </div>
        {enterpriseAccounts.length === 0 ? (
          this.renderSignIn(SignInType.Enterprise)
        ) : (
          <Button onClick={this.props.onEnterpriseSignIn}>
            Add GitHub Enterprise account
          </Button>
        )}
      </>
    )
  }

  private renderAccount(account: Account, preferredFocus = false) {
    const avatarUser: IAvatarUser = {
      name: account.name,
      email: lookupPreferredEmail(account),
      avatarURL: account.avatarURL,
      endpoint: account.endpoint,
    }

    // The DotCom account is shown first, so its sign in/out button should be
    // focused initially when the dialog is opened.
    const className = classNames('sign-out-button', {
      [DialogPreferredFocusClassName]: preferredFocus,
    })

    return (
      <Row key={getAccountKey(account)} className="account-info account-card">
        <div className="user-info-container">
          <Avatar accounts={this.props.accounts} user={avatarUser} />
          <div className="user-info">
            {isEnterpriseAccount(account) ? (
              <>
                <div className="account-title">
                  {account.name === account.login
                    ? `@${account.login}`
                    : `@${account.login} (${account.name})`}
                </div>
                <div className="endpoint">{getHTMLURL(account.endpoint)}</div>
              </>
            ) : (
              <>
                <div className="name">{account.name}</div>
                <div className="login">@{account.login}</div>
              </>
            )}
          </div>
          {preferredFocus && (
            <span className="account-active-chip">
              <Octicon
                className="account-active-check"
                symbol={octicons.check}
              />
              Active
            </span>
          )}
        </div>
        <Button onClick={this.logout(account)} className={className}>
          {__DARWIN__ ? 'Sign Out' : 'Sign out'}
        </Button>
      </Row>
    )
  }

  private onDotComSignIn = () => {
    this.props.onDotComSignIn()
  }

  private onEnterpriseSignIn = () => {
    this.props.onEnterpriseSignIn()
  }

  private renderSignIn(type: SignInType) {
    const signInTitle = __DARWIN__ ? 'Sign Into' : 'Sign into'
    switch (type) {
      case SignInType.DotCom: {
        return (
          <CallToAction
            actionTitle={signInTitle + ' GitHub.com'}
            onAction={this.onDotComSignIn}
            // The DotCom account is shown first, so its sign in/out button should be
            // focused initially when the dialog is opened.
            buttonClassName={DialogPreferredFocusClassName}
          >
            <div>
              Sign in to your GitHub.com account to access your repositories.
            </div>
          </CallToAction>
        )
      }
      case SignInType.Enterprise:
        return (
          <CallToAction
            actionTitle={signInTitle + ' GitHub Enterprise'}
            onAction={this.onEnterpriseSignIn}
          >
            <div>
              If you are using GitHub Enterprise at work, sign in to it to get
              access to your repositories.
            </div>
          </CallToAction>
        )
      default:
        return assertNever(type, `Unknown sign in type: ${type}`)
    }
  }

  private logout = (account: Account) => {
    return () => {
      this.props.onLogout(account)
    }
  }
}
