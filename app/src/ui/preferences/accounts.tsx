import * as React from 'react'
import classNames from 'classnames'
import {
  Account,
  getAccountKey,
  isBitbucketAccount,
  isDotComAccount,
  isEnterpriseAccount,
  isGitLabAccount,
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
import { TextBox } from '../lib/text-box'
import { PasswordTextBox } from '../lib/password-text-box'

interface IAccountsProps {
  readonly accounts: ReadonlyArray<Account>

  readonly onDotComSignIn: () => void
  readonly onEnterpriseSignIn: () => void
  readonly onProviderSignIn: (
    provider: 'gitlab' | 'bitbucket',
    endpoint: string,
    token: string
  ) => Promise<Account>
  readonly onLogout: (account: Account) => void
}

interface IAccountsState {
  readonly gitLabEndpoint: string
  readonly gitLabToken: string
  readonly bitbucketUsername: string
  readonly bitbucketAppPassword: string
  readonly authenticatingProvider: 'gitlab' | 'bitbucket' | null
  readonly providerError: string | null
  readonly providerErrorFor: 'gitlab' | 'bitbucket' | null
}

enum SignInType {
  DotCom,
  Enterprise,
}

export class Accounts extends React.Component<IAccountsProps, IAccountsState> {
  public state: IAccountsState = {
    gitLabEndpoint: 'https://gitlab.com',
    gitLabToken: '',
    bitbucketUsername: '',
    bitbucketAppPassword: '',
    authenticatingProvider: null,
    providerError: null,
    providerErrorFor: null,
  }

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

        {this.renderGitLabAccounts()}
        {this.renderBitbucketAccounts()}
      </DialogContent>
    )
  }

  private renderGitLabAccounts() {
    const accounts = this.props.accounts.filter(isGitLabAccount)
    const loading = this.state.authenticatingProvider === 'gitlab'
    return (
      <section className="account-section" aria-labelledby="gitlab-accounts">
        <div className="account-section-header">
          <div>
            <h2 id="gitlab-accounts">GitLab accounts</h2>
            <p>
              Connect GitLab.com or any self-hosted GitLab instance with a
              personal access token.
            </p>
          </div>
        </div>
        <div className="account-card-list">
          {accounts.map(account => this.renderAccount(account))}
        </div>
        <div className="provider-sign-in-card">
          <TextBox
            label="GitLab server"
            placeholder="https://gitlab.example.com"
            value={this.state.gitLabEndpoint}
            disabled={loading}
            onValueChanged={gitLabEndpoint => this.setState({ gitLabEndpoint })}
          />
          <PasswordTextBox
            label="Personal access token"
            placeholder="Token with api scope"
            value={this.state.gitLabToken}
            disabled={loading}
            onValueChanged={gitLabToken => this.setState({ gitLabToken })}
          />
          <Button
            onClick={this.signInToGitLab}
            disabled={
              loading ||
              this.state.gitLabEndpoint.trim().length === 0 ||
              this.state.gitLabToken.length === 0
            }
          >
            {loading ? 'Connecting…' : 'Add GitLab account'}
          </Button>
        </div>
        {this.renderProviderError('gitlab')}
      </section>
    )
  }

  private renderBitbucketAccounts() {
    const accounts = this.props.accounts.filter(isBitbucketAccount)
    const loading = this.state.authenticatingProvider === 'bitbucket'
    return (
      <section className="account-section" aria-labelledby="bitbucket-accounts">
        <div className="account-section-header">
          <div>
            <h2 id="bitbucket-accounts">Bitbucket Cloud accounts</h2>
            <p>Connect with your Bitbucket username and an app password.</p>
          </div>
        </div>
        <div className="account-card-list">
          {accounts.map(account => this.renderAccount(account))}
        </div>
        <div className="provider-sign-in-card">
          <TextBox
            label="Username"
            placeholder="Bitbucket username"
            value={this.state.bitbucketUsername}
            disabled={loading}
            onValueChanged={bitbucketUsername =>
              this.setState({ bitbucketUsername })
            }
          />
          <PasswordTextBox
            label="App password"
            placeholder="Bitbucket app password"
            value={this.state.bitbucketAppPassword}
            disabled={loading}
            onValueChanged={bitbucketAppPassword =>
              this.setState({ bitbucketAppPassword })
            }
          />
          <Button
            onClick={this.signInToBitbucket}
            disabled={
              loading ||
              this.state.bitbucketUsername.trim().length === 0 ||
              this.state.bitbucketAppPassword.length === 0
            }
          >
            {loading ? 'Connecting…' : 'Add Bitbucket account'}
          </Button>
        </div>
        {this.renderProviderError('bitbucket')}
      </section>
    )
  }

  private renderProviderError(provider: 'gitlab' | 'bitbucket') {
    return this.state.providerErrorFor === provider &&
      this.state.providerError !== null &&
      this.state.authenticatingProvider === null ? (
      <p className="provider-sign-in-error" role="alert">
        {this.state.providerError}
      </p>
    ) : null
  }

  private signInToGitLab = async () => {
    this.setState({
      authenticatingProvider: 'gitlab',
      providerError: null,
      providerErrorFor: null,
    })
    try {
      await this.props.onProviderSignIn(
        'gitlab',
        this.state.gitLabEndpoint.trim(),
        this.state.gitLabToken
      )
      this.setState({
        gitLabToken: '',
        authenticatingProvider: null,
        providerErrorFor: null,
      })
    } catch (error) {
      this.setState({
        authenticatingProvider: null,
        providerErrorFor: 'gitlab',
        providerError: `Unable to connect to GitLab: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    }
  }

  private signInToBitbucket = async () => {
    this.setState({
      authenticatingProvider: 'bitbucket',
      providerError: null,
      providerErrorFor: null,
    })
    try {
      const username = this.state.bitbucketUsername.trim()
      await this.props.onProviderSignIn(
        'bitbucket',
        'https://api.bitbucket.org/2.0',
        `${username}:${this.state.bitbucketAppPassword}`
      )
      this.setState({
        bitbucketAppPassword: '',
        authenticatingProvider: null,
        providerErrorFor: null,
      })
    } catch (error) {
      this.setState({
        authenticatingProvider: null,
        providerErrorFor: 'bitbucket',
        providerError: `Unable to connect to Bitbucket: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    }
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
            {!isDotComAccount(account) ? (
              <>
                <div className="account-title">
                  {account.name === account.login
                    ? `@${account.login}`
                    : `@${account.login} (${account.name})`}
                </div>
                <div className="endpoint">{account.friendlyEndpoint}</div>
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
