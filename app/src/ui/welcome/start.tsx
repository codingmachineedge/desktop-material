import * as React from 'react'
import { WelcomeStep } from './welcome'
import { LinkButton } from '../lib/link-button'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { Loading } from '../lib/loading'
import { BrowserRedirectMessage } from '../lib/authentication-form'
import { ENABLE_TELEMETRY } from '../../lib/telemetry-flag'
import { SamplesURL } from '../../lib/stats'

/**
 * The URL to the sign-up page on GitHub.com. Used in conjunction
 * with account actions in the app where the user might want to
 * consider signing up.
 */
export const CreateAccountURL = 'https://github.com/join?source=github-desktop'

/** Material-style open-in-new affordance for the primary sign-in route. */
function OpenInNewIcon() {
  return (
    <svg
      className="welcome-material-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7ZM14 3v2h3.59L7.76 14.83l1.41 1.41L19 6.41V10h2V3h-7Z" />
    </svg>
  )
}

interface IStartProps {
  readonly advance: (step: WelcomeStep) => void
  readonly dispatcher: Dispatcher
  readonly loadingBrowserAuth: boolean
}

/** The first step of the Welcome flow. */
export class Start extends React.Component<IStartProps, {}> {
  public render() {
    return (
      <section
        id="start"
        aria-label="Welcome to Desktop Material"
        aria-describedby="start-description"
      >
        <div className="start-content">
          <p className="welcome-overline">First-run setup</p>
          <h1 className="welcome-title">
            Start with <span>Desktop Material</span>
          </h1>
          {!this.props.loadingBrowserAuth ? (
            <>
              <p id="start-description" className="welcome-text">
                Bring GitHub and GitHub Enterprise repositories into a focused
                Material 3 workspace. Sign in to connect your account, or
                continue locally without one.
              </p>
            </>
          ) : (
            <p>{BrowserRedirectMessage}</p>
          )}

          <div className="welcome-main-buttons">
            <Button
              type="submit"
              className="button-with-icon"
              disabled={this.props.loadingBrowserAuth}
              onClick={this.signInWithBrowser}
              autoFocus={true}
              role="link"
            >
              {this.props.loadingBrowserAuth && <Loading />}
              Sign in with GitHub.com
              <OpenInNewIcon />
            </Button>
            {this.props.loadingBrowserAuth ? (
              <Button onClick={this.cancelBrowserAuth}>Cancel</Button>
            ) : (
              <Button onClick={this.signInToEnterprise}>
                GitHub Enterprise
              </Button>
            )}
          </div>
          <div className="skip-action-container">
            <p className="welcome-text">
              New to GitHub?{' '}
              <LinkButton
                uri={CreateAccountURL}
                className="create-account-link"
              >
                Create your free account.
              </LinkButton>
            </p>
            <LinkButton className="skip-button" onClick={this.skip}>
              Continue without signing in
            </LinkButton>
          </div>
        </div>

        <div className="start-footer">
          <p>
            By creating an account, you agree to the{' '}
            <LinkButton uri={'https://github.com/site/terms'}>
              Terms of Service
            </LinkButton>
            . For more information about GitHub's privacy practices, see the{' '}
            <LinkButton uri={'https://github.com/site/privacy'}>
              GitHub Privacy Statement.
            </LinkButton>
          </p>
          {ENABLE_TELEMETRY && (
            <p>
              GitHub Desktop sends usage metrics to improve the product and
              inform feature decisions.{' '}
              <LinkButton uri={SamplesURL}>
                Learn more about user metrics.
              </LinkButton>
            </p>
          )}
        </div>
      </section>
    )
  }

  private signInWithBrowser = (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (event) {
      event.preventDefault()
    }

    this.props.advance(WelcomeStep.SignInToDotComWithBrowser)
    this.props.dispatcher.requestBrowserAuthenticationToDotcom()
  }

  private cancelBrowserAuth = () => {
    this.props.advance(WelcomeStep.Start)
  }

  private signInToEnterprise = () => {
    this.props.advance(WelcomeStep.SignInToEnterprise)
  }

  private skip = () => {
    this.props.advance(WelcomeStep.ConfigureGit)
  }
}
