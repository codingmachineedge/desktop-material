import * as React from 'react'
import { TabBar, TabBarType } from '../tab-bar'
import { Remote } from './remote'
import { GitIgnore } from './git-ignore'
import { BuildRunSettings } from './build-run-settings'
import { Submodules } from './submodules'
import { assertNever } from '../../lib/fatal-error'
import { IRemote, diffRemotes } from '../../models/remote'
import { Dispatcher } from '../dispatcher'
import { PopupType } from '../../models/popup'
import {
  Repository,
  getForkContributionTarget,
  isRepositoryWithForkedGitHubRepository,
} from '../../models/repository'
import { Dialog, DialogError, DialogFooter } from '../dialog'
import { NoRemote } from './no-remote'
import { getRemotes, readGitIgnoreAtRoot } from '../../lib/git'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { ForkSettings } from './fork-settings'
import { ForkContributionTarget } from '../../models/workflow-preferences'
import { GitConfigLocation, GitConfig } from './git-config'
import {
  getConfigValue,
  getGlobalConfigValue,
  removeConfigValue,
  setConfigValue,
} from '../../lib/git/config'
import {
  gitAuthorNameIsValid,
  InvalidGitAuthorNameMessage,
} from '../lib/identifier-rules'
import { Account, getAccountKey } from '../../models/account'
import {
  IBuildRunPreferences,
  defaultBuildRunPreferences,
} from '../../models/build-run-preferences'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { AccountPicker } from '../account-picker'
import { AutomationOverrides } from './automation-overrides'
import {
  IAutomationSettingsOverrides,
  loadRepositoryAutomationOverrides,
} from '../../lib/automation/automation-settings'

interface IRepositorySettingsProps {
  readonly initialSelectedTab?: RepositorySettingsTab
  readonly dispatcher: Dispatcher
  readonly remote: IRemote | null
  readonly repository: Repository
  readonly accounts: ReadonlyArray<Account>
  readonly repositoryAccount: Account | null
  readonly onDismissed: () => void
}

export enum RepositorySettingsTab {
  Remote = 0,
  IgnoredFiles,
  GitConfig,
  // Note: BuildRun and Submodules are placed before the conditionally-rendered
  // ForkSettings tab so the enum values keep matching the TabBar positions
  // whether or not the fork tab is shown. Integrator note: if the remotes work
  // (b2:remotes) also inserts a tab here, keep the unconditionally-rendered
  // tabs contiguous and leave ForkSettings last; reconcile the numeric indices
  // so each enum value equals its TabBar position.
  BuildRun,
  Submodules,
  Automation,
  ForkSettings,
}

interface IRepositorySettingsState {
  readonly selectedTab: RepositorySettingsTab
  readonly remote: IRemote | null
  /** The full list of remotes, as edited by the user in the Remote tab. */
  readonly remotes: ReadonlyArray<IRemote>
  /** The remotes as they existed on disk when the dialog was opened. */
  readonly initialRemotes: ReadonlyArray<IRemote>
  readonly ignoreText: string | null
  readonly ignoreTextHasChanged: boolean
  readonly disabled: boolean
  readonly saveDisabled: boolean
  readonly gitConfigLocation: GitConfigLocation
  readonly committerName: string
  readonly committerEmail: string
  readonly globalCommitterName: string
  readonly globalCommitterEmail: string
  readonly initialGitConfigLocation: GitConfigLocation
  readonly initialCommitterName: string | null
  readonly initialCommitterEmail: string | null
  readonly errors?: ReadonlyArray<JSX.Element | string>
  readonly forkContributionTarget: ForkContributionTarget
  readonly isLoadingGitConfig: boolean
  readonly accountKey: string | null
  readonly buildRunPreferences: IBuildRunPreferences
  readonly buildRunPreferencesHaveChanged: boolean
  readonly automationOverrides: IAutomationSettingsOverrides
}

export class RepositorySettings extends React.Component<
  IRepositorySettingsProps,
  IRepositorySettingsState
> {
  public constructor(props: IRepositorySettingsProps) {
    super(props)

    this.state = {
      selectedTab:
        this.props.initialSelectedTab || RepositorySettingsTab.Remote,
      remote: props.remote,
      remotes: props.remote ? [props.remote] : [],
      initialRemotes: props.remote ? [props.remote] : [],
      ignoreText: null,
      ignoreTextHasChanged: false,
      disabled: false,
      forkContributionTarget: getForkContributionTarget(props.repository),
      saveDisabled: false,
      gitConfigLocation: GitConfigLocation.Global,
      committerName: '',
      committerEmail: '',
      globalCommitterName: '',
      globalCommitterEmail: '',
      initialGitConfigLocation: GitConfigLocation.Global,
      initialCommitterName: null,
      initialCommitterEmail: null,
      isLoadingGitConfig: true,
      accountKey:
        props.repository.accountKey ??
        (props.repositoryAccount !== null
          ? getAccountKey(props.repositoryAccount)
          : null),
      buildRunPreferences:
        props.repository.buildRunPreferences ?? defaultBuildRunPreferences,
      buildRunPreferencesHaveChanged: false,
      automationOverrides: loadRepositoryAutomationOverrides(
        props.repository.id
      ),
    }
  }

  public async componentWillMount() {
    try {
      const remotes = await getRemotes(this.props.repository)
      this.setState({ remotes, initialRemotes: remotes })
    } catch (e) {
      log.error(
        `RepositorySettings: unable to read remotes for ${this.props.repository.path}`,
        e
      )
    }

    try {
      const ignoreText = await readGitIgnoreAtRoot(this.props.repository)
      this.setState({ ignoreText })
    } catch (e) {
      log.error(
        `RepositorySettings: unable to read root .gitignore file for ${this.props.repository.path}`,
        e
      )
      this.setState({ errors: [`Could not read root .gitignore: ${e}`] })
    }

    const localCommitterName = await getConfigValue(
      this.props.repository,
      'user.name',
      true
    )
    const localCommitterEmail = await getConfigValue(
      this.props.repository,
      'user.email',
      true
    )

    const globalCommitterName = (await getGlobalConfigValue('user.name')) || ''
    const globalCommitterEmail =
      (await getGlobalConfigValue('user.email')) || ''

    const gitConfigLocation =
      localCommitterName === null && localCommitterEmail === null
        ? GitConfigLocation.Global
        : GitConfigLocation.Local

    let committerName = globalCommitterName
    let committerEmail = globalCommitterEmail

    if (gitConfigLocation === GitConfigLocation.Local) {
      committerName = localCommitterName ?? ''
      committerEmail = localCommitterEmail ?? ''
    }

    this.setState({
      gitConfigLocation,
      committerName,
      committerEmail,
      globalCommitterName,
      globalCommitterEmail,
      initialGitConfigLocation: gitConfigLocation,
      initialCommitterName: localCommitterName,
      initialCommitterEmail: localCommitterEmail,
      isLoadingGitConfig: false,
    })
  }

  private renderErrors(): JSX.Element[] | null {
    const errors = this.state.errors

    if (!errors || !errors.length) {
      return null
    }

    return errors.map((err, ix) => {
      const key = `err-${ix}`
      return <DialogError key={key}>{err}</DialogError>
    })
  }

  public render() {
    const showForkSettings = isRepositoryWithForkedGitHubRepository(
      this.props.repository
    )

    return (
      <Dialog
        id="repository-settings"
        title="Repository settings"
        onDismissed={this.props.onDismissed}
        onSubmit={this.onSubmit}
        disabled={this.state.disabled}
      >
        {this.renderErrors()}

        <div className="tab-container">
          <TabBar
            onTabClicked={this.onTabClicked}
            selectedIndex={this.state.selectedTab}
            type={TabBarType.Vertical}
          >
            <span>
              <Octicon className="icon" symbol={octicons.server} />
              Remote
            </span>
            <span>
              <Octicon className="icon" symbol={octicons.file} />
              {__DARWIN__ ? 'Ignored Files' : 'Ignored files'}
            </span>
            <span>
              <Octicon className="icon" symbol={octicons.gitCommit} />
              {__DARWIN__ ? 'Git Config' : 'Git config'}
            </span>
            <span>
              <Octicon className="icon" symbol={octicons.play} />
              {__DARWIN__ ? 'Build & Run' : 'Build & run'}
            </span>
            <span>
              <Octicon className="icon" symbol={octicons.fileSubmodule} />
              Submodules
            </span>
            <span>
              <Octicon className="icon" symbol={octicons.sync} />
              Automation
            </span>
            {showForkSettings && (
              <span>
                <Octicon className="icon" symbol={octicons.repoForked} />
                {__DARWIN__ ? 'Fork Behavior' : 'Fork behavior'}
              </span>
            )}
          </TabBar>

          <div className="active-tab">{this.renderActiveTab()}</div>
        </div>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Save"
            okButtonDisabled={this.state.saveDisabled}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private renderActiveTab() {
    const tab = this.state.selectedTab
    switch (tab) {
      case RepositorySettingsTab.Remote: {
        return (
          <>
            {this.renderRepositoryAccountPicker()}
            {this.state.remotes.length > 0 ? (
              <Remote
                remotes={this.state.remotes}
                defaultRemoteName={this.props.remote?.name ?? null}
                onRemoteUrlChanged={this.onRemoteUrlChanged}
                onAddRemote={this.onAddRemote}
                onRemoveRemote={this.onRemoveRemote}
              />
            ) : (
              <NoRemote onPublish={this.onPublish} />
            )}
          </>
        )
      }
      case RepositorySettingsTab.IgnoredFiles: {
        return (
          <GitIgnore
            repository={this.props.repository}
            text={this.state.ignoreText}
            onIgnoreTextChanged={this.onIgnoreTextChanged}
            onShowExamples={this.onShowGitIgnoreExamples}
          />
        )
      }
      case RepositorySettingsTab.BuildRun: {
        return (
          <BuildRunSettings
            repository={this.props.repository}
            preferences={this.state.buildRunPreferences}
            onPreferencesChanged={this.onBuildRunPreferencesChanged}
          />
        )
      }
      case RepositorySettingsTab.Submodules: {
        return (
          <Submodules
            repository={this.props.repository}
            dispatcher={this.props.dispatcher}
          />
        )
      }
      case RepositorySettingsTab.Automation: {
        return (
          <AutomationOverrides
            overrides={this.state.automationOverrides}
            onChanged={this.onAutomationOverridesChanged}
          />
        )
      }
      case RepositorySettingsTab.ForkSettings: {
        if (!isRepositoryWithForkedGitHubRepository(this.props.repository)) {
          return null
        }

        return (
          <ForkSettings
            forkContributionTarget={this.state.forkContributionTarget}
            repository={this.props.repository}
            onForkContributionTargetChanged={
              this.onForkContributionTargetChanged
            }
          />
        )
      }

      case RepositorySettingsTab.GitConfig: {
        return (
          <GitConfig
            account={this.props.repositoryAccount}
            gitConfigLocation={this.state.gitConfigLocation}
            onGitConfigLocationChanged={this.onGitConfigLocationChanged}
            name={this.state.committerName}
            email={this.state.committerEmail}
            globalName={this.state.globalCommitterName}
            globalEmail={this.state.globalCommitterEmail}
            onNameChanged={this.onCommitterNameChanged}
            onEmailChanged={this.onCommitterEmailChanged}
            isLoadingGitConfig={this.state.isLoadingGitConfig}
          />
        )
      }

      default:
        return assertNever(tab, `Unknown tab type: ${tab}`)
    }
  }

  private onPublish = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.PublishRepository,
      repository: this.props.repository,
    })
  }

  private renderRepositoryAccountPicker() {
    const endpoint = this.props.repository.gitHubRepository?.endpoint
    if (endpoint === undefined) {
      return null
    }

    const eligibleAccounts = this.props.accounts.filter(
      account => account.endpoint === endpoint
    )
    const selectedAccount =
      eligibleAccounts.find(
        account => getAccountKey(account) === this.state.accountKey
      ) ?? eligibleAccounts.at(0)

    if (selectedAccount === undefined) {
      return (
        <section className="repository-account-setting">
          <h3>Repository account</h3>
          <p>
            Sign in to this GitHub host to choose an identity for authenticated
            operations.
          </p>
        </section>
      )
    }

    return (
      <section className="repository-account-setting">
        <div>
          <h3>Repository account</h3>
          <p>
            Used for fetch, push, pull requests, issues, and other GitHub
            operations in this repository.
          </p>
        </div>
        <AccountPicker
          accounts={eligibleAccounts}
          selectedAccount={selectedAccount}
          onSelectedAccountChanged={this.onSelectedAccountChanged}
        />
      </section>
    )
  }

  private onSelectedAccountChanged = (account: Account) => {
    this.setState({ accountKey: getAccountKey(account) })
  }

  private onShowGitIgnoreExamples = () => {
    this.props.dispatcher.openInBrowser('https://git-scm.com/docs/gitignore')
  }

  private onSubmit = async () => {
    this.setState({ disabled: true, errors: undefined })
    const errors = new Array<JSX.Element | string>()

    this.props.dispatcher.setRepositoryAutomationOverrides(
      this.props.repository.id,
      this.state.automationOverrides
    )

    if (this.state.accountKey !== this.props.repository.accountKey) {
      await this.props.dispatcher.updateRepositoryAccount(
        this.props.repository,
        this.state.accountKey
      )
    }

    // Reconcile the edited remotes against what was on disk when the dialog
    // opened. Removals run first so that re-adding a remote under a name that
    // was just freed up can't collide.
    const normalizedRemotes = this.state.remotes.map(r => ({
      name: r.name,
      url: r.url.trim(),
    }))
    const { added, removed, changed } = diffRemotes(
      this.state.initialRemotes,
      normalizedRemotes
    )

    for (const remote of removed) {
      // Never remove the account-bound default remote.
      if (remote.name === this.props.remote?.name) {
        continue
      }

      try {
        await this.props.dispatcher.removeRemote(
          this.props.repository,
          remote.name
        )
      } catch (e) {
        log.error(
          `RepositorySettings: unable to remove remote "${remote.name}" at ${this.props.repository.path}`,
          e
        )
        errors.push(`Failed removing the remote "${remote.name}": ${e}`)
      }
    }

    for (const remote of added) {
      try {
        await this.props.dispatcher.addRemote(
          this.props.repository,
          remote.name,
          remote.url
        )
      } catch (e) {
        log.error(
          `RepositorySettings: unable to add remote "${remote.name}" at ${this.props.repository.path}`,
          e
        )
        errors.push(`Failed adding the remote "${remote.name}": ${e}`)
      }
    }

    for (const remote of changed) {
      try {
        await this.props.dispatcher.setRemoteURL(
          this.props.repository,
          remote.name,
          remote.url
        )
      } catch (e) {
        log.error(
          `RepositorySettings: unable to set remote URL at ${this.props.repository.path}`,
          e
        )
        errors.push(`Failed setting the "${remote.name}" remote URL: ${e}`)
      }
    }

    if (this.state.ignoreTextHasChanged && this.state.ignoreText !== null) {
      try {
        await this.props.dispatcher.saveGitIgnore(
          this.props.repository,
          this.state.ignoreText
        )
      } catch (e) {
        log.error(
          `RepositorySettings: unable to save gitignore at ${this.props.repository.path}`,
          e
        )
        errors.push(`Failed saving the .gitignore file: ${e}`)
      }
    }

    // only update this if it will be different from what we have stored
    if (
      this.state.forkContributionTarget !==
      this.props.repository.workflowPreferences.forkContributionTarget
    ) {
      await this.props.dispatcher.updateRepositoryWorkflowPreferences(
        this.props.repository,
        {
          ...this.props.repository.workflowPreferences,
          forkContributionTarget: this.state.forkContributionTarget,
        }
      )
    }

    if (this.state.buildRunPreferencesHaveChanged) {
      try {
        await this.props.dispatcher.updateRepositoryBuildRunPreferences(
          this.props.repository,
          this.state.buildRunPreferences
        )
      } catch (e) {
        log.error(
          `RepositorySettings: unable to save Build & Run preferences at ${this.props.repository.path}`,
          e
        )
        errors.push(`Failed saving the Build & Run preferences: ${e}`)
      }
    }

    let shouldRefreshAuthor = false
    const gitLocationChanged =
      this.state.gitConfigLocation !== this.state.initialGitConfigLocation

    if (
      gitLocationChanged &&
      this.state.gitConfigLocation === GitConfigLocation.Global
    ) {
      // If it's now configured to use the global config, just delete the local
      // user info in this repository.
      await removeConfigValue(this.props.repository, 'user.name')
      await removeConfigValue(this.props.repository, 'user.email')

      shouldRefreshAuthor = true
    } else if (this.state.gitConfigLocation === GitConfigLocation.Local) {
      // Otherwise, update the local name and email if needed
      if (this.state.committerName !== this.state.initialCommitterName) {
        await setConfigValue(
          this.props.repository,
          'user.name',
          this.state.committerName
        )
        shouldRefreshAuthor = true
      }

      if (this.state.committerEmail !== this.state.initialCommitterEmail) {
        await setConfigValue(
          this.props.repository,
          'user.email',
          this.state.committerEmail
        )
        shouldRefreshAuthor = true
      }
    }

    if (shouldRefreshAuthor) {
      this.props.dispatcher.refreshAuthor(this.props.repository)
    }

    if (!errors.length) {
      this.props.onDismissed()
    } else {
      this.setState({ disabled: false, errors })
    }
  }

  private onRemoteUrlChanged = (name: string, url: string) => {
    const remotes = this.state.remotes.map(r =>
      r.name === name ? { ...r, url } : r
    )
    const remote =
      this.state.remote && this.state.remote.name === name
        ? { ...this.state.remote, url }
        : this.state.remote
    this.setState({ remotes, remote })
  }

  private onAddRemote = (name: string, url: string) => {
    if (this.state.remotes.some(r => r.name === name)) {
      return
    }

    this.setState({ remotes: [...this.state.remotes, { name, url }] })
  }

  private onRemoveRemote = (name: string) => {
    // The account-bound default remote is protected and cannot be removed.
    if (name === this.props.remote?.name) {
      return
    }

    this.setState({
      remotes: this.state.remotes.filter(r => r.name !== name),
    })
  }

  private onIgnoreTextChanged = (text: string) => {
    this.setState({ ignoreText: text, ignoreTextHasChanged: true })
  }

  private onBuildRunPreferencesChanged = (
    buildRunPreferences: IBuildRunPreferences
  ) => {
    this.setState({
      buildRunPreferences,
      buildRunPreferencesHaveChanged: true,
    })
  }

  private onAutomationOverridesChanged = (
    automationOverrides: IAutomationSettingsOverrides
  ) => {
    this.setState({ automationOverrides })
  }

  private onTabClicked = (index: number) => {
    this.setState({ selectedTab: index })
  }

  private onForkContributionTargetChanged = (
    forkContributionTarget: ForkContributionTarget
  ) => {
    this.setState({
      forkContributionTarget,
    })
  }

  private onGitConfigLocationChanged = (value: GitConfigLocation) => {
    this.setState({ gitConfigLocation: value })
  }

  private onCommitterNameChanged = (committerName: string) => {
    const errors = new Array<JSX.Element | string>()

    if (gitAuthorNameIsValid(committerName)) {
      this.setState({ saveDisabled: false })
    } else {
      this.setState({ saveDisabled: true })
      errors.push(InvalidGitAuthorNameMessage)
    }

    this.setState({ committerName, errors })
  }

  private onCommitterEmailChanged = (committerEmail: string) => {
    this.setState({ committerEmail })
  }
}
