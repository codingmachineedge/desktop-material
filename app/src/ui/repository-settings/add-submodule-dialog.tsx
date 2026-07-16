import * as React from 'react'

import { Account, getAccountKey } from '../../models/account'
import { CloneRepositoryTab } from '../../models/clone-repository-tab'
import { Repository } from '../../models/repository'
import {
  getSubmoduleBranchError,
  getSubmodulePathError,
  getSubmoduleSourceError,
  getSuggestedSubmodulePath,
  normalizeSubmodulePath,
} from '../../models/submodule-add'
import { IAPIOrganization, IAPIRepository } from '../../lib/api'
import { getPreferredGenericCloneAccountKey } from '../../lib/automation/clone-account-fallback'
import { findAccountForRemoteURL } from '../../lib/find-account'
import { validateSubmoduleAddPath } from '../../lib/git'
import { resolveSelectedAccount } from '../../lib/resolve-selected-account'
import { IAccountRepositories } from '../../lib/stores/api-repositories-store'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../dialog'
import { AccountPicker } from '../account-picker'
import { CallToAction } from '../lib/call-to-action'
import { Button } from '../lib/button'
import { Loading } from '../lib/loading'
import { Row } from '../lib/row'
import { TextBox } from '../lib/text-box'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { TabBar } from '../tab-bar'
import { ClickSource } from '../lib/list'
import {
  accountMatchesCloneTab,
  CloneableRepositoryFilterList,
  mergeOrganizationRepositories,
  OrgFilterChips,
} from '../clone-repository'
import { PopupType } from '../../models/popup'
import { PreferencesTab } from '../../models/preferences'

type HostedTab =
  | CloneRepositoryTab.DotCom
  | CloneRepositoryTab.Enterprise
  | CloneRepositoryTab.Providers

interface IHostedTabState {
  readonly filterText: string
  readonly selectedAccount: Account | null
  readonly selectedItem: IAPIRepository | null
  readonly selectedOrganization: string | null
}

type AddSubmoduleOperation = 'idle' | 'adding' | 'success'

interface IAddSubmoduleDialogState {
  readonly selectedTab: CloneRepositoryTab
  readonly dotCom: IHostedTabState
  readonly enterprise: IHostedTabState
  readonly providers: IHostedTabState
  readonly url: string
  readonly path: string
  readonly branch: string
  readonly pathTouched: boolean
  readonly validatingPath: boolean
  readonly pathValidationError: string | null
  readonly operation: AddSubmoduleOperation
  readonly progress: string | null
  readonly progressValue: number
  readonly error: string | null
}

export interface IAddSubmoduleDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly accounts: ReadonlyArray<Account>
  readonly apiRepositories: ReadonlyMap<Account, IAccountRepositories>
  readonly onRefreshRepositories: (account: Account) => void
  readonly onAdded: () => void | Promise<void>
  readonly onDismissed: () => void
}

const emptyHostedState = (): IHostedTabState => ({
  filterText: '',
  selectedAccount: null,
  selectedItem: null,
  selectedOrganization: null,
})

/**
 * Clone-style provider browser for adding one repository as a submodule.
 * Provider selection and exact account affinity mirror Clone; the lower review
 * pane is intentionally submodule-specific.
 */
export class AddSubmoduleDialog extends React.Component<
  IAddSubmoduleDialogProps,
  IAddSubmoduleDialogState
> {
  private operationController: AbortController | null = null
  private pathValidationController: AbortController | null = null
  private pathValidationSequence = 0
  private mounted = false

  public constructor(props: IAddSubmoduleDialogProps) {
    super(props)
    this.state = {
      selectedTab: CloneRepositoryTab.DotCom,
      dotCom: emptyHostedState(),
      enterprise: emptyHostedState(),
      providers: emptyHostedState(),
      url: '',
      path: '',
      branch: '',
      pathTouched: false,
      validatingPath: false,
      pathValidationError: null,
      operation: 'idle',
      progress: null,
      progressValue: 0,
      error: null,
    }
  }

  public componentDidMount() {
    this.mounted = true
  }

  public componentWillUnmount() {
    this.mounted = false
    this.pathValidationController?.abort()
    this.operationController?.abort()
  }

  private getAccountsForTab(tab: HostedTab): ReadonlyArray<Account> {
    return this.props.accounts.filter(account =>
      accountMatchesCloneTab(tab, account)
    )
  }

  private getHostedState(tab: HostedTab): IHostedTabState {
    switch (tab) {
      case CloneRepositoryTab.DotCom:
        return this.state.dotCom
      case CloneRepositoryTab.Enterprise:
        return this.state.enterprise
      case CloneRepositoryTab.Providers:
        return this.state.providers
    }
  }

  private setHostedState(tab: HostedTab, update: Partial<IHostedTabState>) {
    switch (tab) {
      case CloneRepositoryTab.DotCom:
        this.setState(state => ({ dotCom: { ...state.dotCom, ...update } }))
        break
      case CloneRepositoryTab.Enterprise:
        this.setState(state => ({
          enterprise: { ...state.enterprise, ...update },
        }))
        break
      case CloneRepositoryTab.Providers:
        this.setState(state => ({
          providers: { ...state.providers, ...update },
        }))
        break
    }
  }

  private getSelectedAccount(tab: HostedTab): Account | null {
    return resolveSelectedAccount(
      this.getAccountsForTab(tab),
      this.getHostedState(tab).selectedAccount
    )
  }

  private getSelectedSource(): string {
    if (this.state.selectedTab === CloneRepositoryTab.Generic) {
      return this.state.url.trim()
    }
    return (
      this.getHostedState(this.state.selectedTab).selectedItem?.clone_url ?? ''
    )
  }

  private getSelectedAccountKey = async (
    source: string
  ): Promise<string | undefined> => {
    if (this.state.selectedTab !== CloneRepositoryTab.Generic) {
      const account = this.getSelectedAccount(this.state.selectedTab)
      return account !== null && account.token.length > 0
        ? getAccountKey(account)
        : undefined
    }

    const account = await findAccountForRemoteURL(source, this.props.accounts)
    return getPreferredGenericCloneAccountKey(
      source,
      this.props.accounts,
      account
    )
  }

  private getSynchronousErrors() {
    const source = this.getSelectedSource()
    return {
      source: getSubmoduleSourceError(source),
      path: getSubmodulePathError(this.state.path),
      branch: getSubmoduleBranchError(this.state.branch),
    }
  }

  private canSubmit() {
    const errors = this.getSynchronousErrors()
    return (
      this.state.operation === 'idle' &&
      !this.state.validatingPath &&
      this.state.pathValidationError === null &&
      errors.source === null &&
      errors.path === null &&
      errors.branch === null
    )
  }

  private onTabClicked = (selectedTab: CloneRepositoryTab) => {
    this.setState({ selectedTab, error: null }, this.suggestPathForSource)
  }

  private getSelectedTabId() {
    switch (this.state.selectedTab) {
      case CloneRepositoryTab.DotCom:
        return 'add-submodule-dotcom-tab'
      case CloneRepositoryTab.Enterprise:
        return 'add-submodule-enterprise-tab'
      case CloneRepositoryTab.Generic:
        return 'add-submodule-url-tab'
      case CloneRepositoryTab.Providers:
        return 'add-submodule-providers-tab'
    }
  }

  private onSelectedAccountChanged = (account: Account) => {
    if (this.state.selectedTab === CloneRepositoryTab.Generic) {
      return
    }
    this.setHostedState(this.state.selectedTab, {
      selectedAccount: account,
      selectedItem: null,
      selectedOrganization: null,
    })
  }

  private onSelectedOrganizationChanged = (
    organization: IAPIOrganization | null
  ) => {
    if (this.state.selectedTab === CloneRepositoryTab.Generic) {
      return
    }
    const tab = this.state.selectedTab
    this.setHostedState(tab, {
      selectedOrganization: organization?.login ?? null,
      selectedItem: null,
    })
    const account = this.getSelectedAccount(tab)
    if (account !== null && organization !== null) {
      this.props.dispatcher.refreshApiOrganizationRepositories(
        account,
        organization
      )
    }
  }

  private onRefreshOrganization = () => {
    if (this.state.selectedTab === CloneRepositoryTab.Generic) {
      return
    }
    const tab = this.state.selectedTab
    const account = this.getSelectedAccount(tab)
    const selected = this.getHostedState(tab).selectedOrganization
    const organization =
      account === null || selected === null
        ? null
        : this.props.apiRepositories
            .get(account)
            ?.organizations.find(item => item.login === selected) ?? null
    if (account !== null && organization !== null) {
      this.props.dispatcher.refreshApiOrganizationRepositories(
        account,
        organization
      )
    }
  }

  private onFilterTextChanged = (filterText: string) => {
    if (this.state.selectedTab !== CloneRepositoryTab.Generic) {
      this.setHostedState(this.state.selectedTab, { filterText })
    }
  }

  private onSelectionChanged = (selectedItem: IAPIRepository | null) => {
    if (this.state.selectedTab === CloneRepositoryTab.Generic) {
      return
    }
    this.setHostedState(this.state.selectedTab, { selectedItem })
    this.setState({ error: null }, this.suggestPathForSource)
  }

  private onItemClicked = (
    _repository: IAPIRepository,
    source: ClickSource
  ) => {
    if (
      source.kind === 'keyboard' &&
      source.event.key === 'Enter' &&
      this.canSubmit()
    ) {
      this.addSubmodule()
    }
  }

  private onUrlChanged = (url: string) => {
    this.setState({ url, error: null }, this.suggestPathForSource)
  }

  private suggestPathForSource = () => {
    if (this.state.pathTouched) {
      return
    }
    const path = getSuggestedSubmodulePath(this.getSelectedSource())
    this.setState({ path, pathValidationError: null })
  }

  private onPathChanged = (path: string) => {
    this.pathValidationController?.abort()
    this.setState({
      path,
      pathTouched: true,
      validatingPath: false,
      pathValidationError: null,
      error: null,
    })
  }

  private onPathBlur = async () => {
    const syncError = getSubmodulePathError(this.state.path)
    if (syncError !== null) {
      this.setState({ pathValidationError: syncError })
      return
    }

    this.pathValidationController?.abort()
    const controller = new AbortController()
    const sequence = ++this.pathValidationSequence
    this.pathValidationController = controller
    this.setState({ validatingPath: true, pathValidationError: null })

    try {
      const error = await validateSubmoduleAddPath(
        this.props.repository,
        this.state.path,
        controller.signal
      )
      if (this.mounted && sequence === this.pathValidationSequence) {
        this.setState({ validatingPath: false, pathValidationError: error })
      }
    } catch (error) {
      if (
        this.mounted &&
        sequence === this.pathValidationSequence &&
        !controller.signal.aborted
      ) {
        this.setState({
          validatingPath: false,
          pathValidationError:
            error instanceof Error
              ? error.message
              : 'Desktop could not validate this path.',
        })
      }
    }
  }

  private onBranchChanged = (branch: string) =>
    this.setState({ branch, error: null })

  private onProgress = (progress: string, progressValue: number) => {
    if (this.mounted) {
      this.setState({
        progress: progress.trim() || 'Adding the submodule…',
        progressValue: Math.max(0, Math.min(progressValue, 1)),
      })
    }
  }

  private cancelOperation = () => {
    this.operationController?.abort()
    this.setState({ progress: 'Cancelling the Git operation…' })
  }

  private addSubmodule = async () => {
    if (!this.canSubmit()) {
      const errors = this.getSynchronousErrors()
      this.setState({
        error: errors.source ?? errors.path ?? errors.branch,
      })
      return
    }

    const source = this.getSelectedSource()
    const path = normalizeSubmodulePath(this.state.path)
    const branch = this.state.branch.trim()
    const controller = new AbortController()
    this.pathValidationController?.abort()
    this.operationController = controller
    this.setState({
      operation: 'adding',
      validatingPath: false,
      error: null,
      progress: 'Checking the repository and destination…',
      progressValue: 0,
    })

    try {
      const accountKey = await this.getSelectedAccountKey(source)
      await this.props.dispatcher.addSubmodule(
        this.props.repository,
        source,
        path,
        branch.length > 0 ? branch : null,
        {
          accountKey,
          signal: controller.signal,
          onProgress: this.onProgress,
        }
      )
      await this.props.onAdded()
      if (this.mounted) {
        this.setState({
          operation: 'success',
          progress: 'Submodule added.',
          progressValue: 1,
        })
      }
    } catch (error) {
      if (this.mounted) {
        this.setState({
          operation: 'idle',
          progress: null,
          progressValue: 0,
          error: controller.signal.aborted
            ? 'Adding the submodule was cancelled. No further Git work is running.'
            : error instanceof Error
            ? error.message
            : 'Desktop could not add this submodule.',
        })
      }
    } finally {
      if (this.operationController === controller) {
        this.operationController = null
      }
    }
  }

  private signInDotCom = () => this.props.dispatcher.showDotComSignInDialog()
  private signInEnterprise = () =>
    this.props.dispatcher.showEnterpriseSignInDialog()
  private signInProvider = () =>
    this.props.dispatcher.showPopup({
      type: PopupType.Preferences,
      initialSelectedTab: PreferencesTab.Accounts,
    })

  private renderSignIn(tab: HostedTab) {
    switch (tab) {
      case CloneRepositoryTab.DotCom:
        return (
          <CallToAction actionTitle="Sign in" onAction={this.signInDotCom}>
            Sign in to GitHub.com to browse repositories for this submodule.
          </CallToAction>
        )
      case CloneRepositoryTab.Enterprise:
        return (
          <CallToAction actionTitle="Sign in" onAction={this.signInEnterprise}>
            Sign in to GitHub Enterprise to browse repositories for this
            submodule.
          </CallToAction>
        )
      case CloneRepositoryTab.Providers:
        return (
          <CallToAction
            actionTitle="Add provider account"
            onAction={this.signInProvider}
          >
            Add a GitLab or Bitbucket account in Settings to browse its
            repositories.
          </CallToAction>
        )
    }
  }

  private renderHostedTab(tab: HostedTab) {
    const state = this.getHostedState(tab)
    const accounts = this.getAccountsForTab(tab)
    const account = this.getSelectedAccount(tab)
    if (account === null) {
      return (
        <DialogContent className="add-submodule-sign-in">
          {this.renderSignIn(tab)}
        </DialogContent>
      )
    }

    const accountState = this.props.apiRepositories.get(account)
    const organization =
      state.selectedOrganization === null
        ? null
        : accountState?.organizations.find(
            item => item.login === state.selectedOrganization
          ) ?? null
    const organizationState = organization
      ? accountState?.organizationRepositories.get(
          organization.login.toLowerCase()
        )
      : undefined
    const repositories =
      accountState === undefined
        ? null
        : organization === null
        ? accountState.repositories
        : mergeOrganizationRepositories(
            accountState.repositories,
            organizationState?.repositories ?? [],
            organization.login
          )

    return (
      <DialogContent className="add-submodule-hosted-content">
        <Row className="account-picker-row">
          <AccountPicker
            accounts={accounts}
            selectedAccount={account}
            onSelectedAccountChanged={this.onSelectedAccountChanged}
            openButtonClassName="dialog-preferred-focus"
          />
        </Row>
        <OrgFilterChips
          organizations={accountState?.organizations ?? []}
          selectedOrganization={state.selectedOrganization}
          loading={accountState?.organizationsLoading ?? false}
          onSelect={this.onSelectedOrganizationChanged}
        />
        {organizationState?.error !== null &&
          organizationState?.error !== undefined && (
            <div className="org-repositories-error" role="alert">
              <span>Desktop couldn't load every organization repository.</span>
              <Button onClick={this.onRefreshOrganization}>Try again</Button>
            </div>
          )}
        <Row className="add-submodule-repository-list">
          <CloneableRepositoryFilterList
            account={account}
            selectedItem={state.selectedItem}
            onSelectionChanged={this.onSelectionChanged}
            loading={
              accountState?.loading === true ||
              organizationState?.loading === true
            }
            repositories={repositories}
            filterText={state.filterText}
            onFilterTextChanged={this.onFilterTextChanged}
            onRefreshRepositories={this.props.onRefreshRepositories}
            onItemClicked={this.onItemClicked}
            filterListId="add-submodule-repositories"
            filterListLabel="Choose a repository for the submodule"
            placeholderText="Filter repositories for this submodule"
          />
        </Row>
      </DialogContent>
    )
  }

  private renderSource() {
    if (this.state.selectedTab === CloneRepositoryTab.Generic) {
      return (
        <DialogContent className="add-submodule-url-content">
          <Row>
            <TextBox
              label="Repository URL"
              placeholder="https://github.com/owner/repository.git"
              value={this.state.url}
              onValueChanged={this.onUrlChanged}
              spellcheck={false}
              autoFocus={true}
              ariaDescribedBy="add-submodule-url-help"
            />
          </Row>
          <p id="add-submodule-url-help" className="add-submodule-help">
            HTTPS, SSH, and local Git remote URLs are supported.
          </p>
        </DialogContent>
      )
    }
    return this.renderHostedTab(this.state.selectedTab)
  }

  private renderReview() {
    const errors = this.getSynchronousErrors()
    const pathError = errors.path ?? this.state.pathValidationError
    const source = this.getSelectedSource()

    return (
      <DialogContent className="add-submodule-review">
        <div className="add-submodule-fields">
          <TextBox
            label="Path inside repository"
            placeholder="vendor/repository"
            value={this.state.path}
            onValueChanged={this.onPathChanged}
            onBlur={this.onPathBlur}
            spellcheck={false}
            required={true}
            ariaDescribedBy="add-submodule-path-help"
          />
          <TextBox
            label="Branch (optional)"
            placeholder="Remote default branch"
            value={this.state.branch}
            onValueChanged={this.onBranchChanged}
            spellcheck={false}
            ariaDescribedBy="add-submodule-branch-help"
          />
        </div>
        <div className="add-submodule-field-help">
          <small id="add-submodule-path-help">
            {this.state.validatingPath
              ? 'Checking that the destination is safe and empty…'
              : pathError ??
                'A relative checkout path; the final segment becomes the default submodule name.'}
          </small>
          <small id="add-submodule-branch-help">
            {errors.branch ??
              'Leave empty to follow the repository’s remote default branch.'}
          </small>
        </div>
        <section
          className="add-submodule-summary"
          aria-label="Submodule review"
        >
          <h2>Review</h2>
          <dl>
            <div>
              <dt>Repository</dt>
              <dd>{source || 'Choose a source above'}</dd>
            </div>
            <div>
              <dt>Superproject</dt>
              <dd>{this.props.repository.name}</dd>
            </div>
            <div>
              <dt>Checkout path</dt>
              <dd>{normalizeSubmodulePath(this.state.path) || 'Not set'}</dd>
            </div>
            <div>
              <dt>Tracked branch</dt>
              <dd>{this.state.branch.trim() || 'Remote default'}</dd>
            </div>
          </dl>
        </section>
      </DialogContent>
    )
  }

  private renderProgress() {
    if (this.state.operation !== 'adding') {
      return null
    }
    return (
      <div className="add-submodule-progress" role="status" aria-live="polite">
        <Loading />
        <div>
          <strong>Adding submodule</strong>
          <span>{this.state.progress}</span>
        </div>
        <progress
          aria-label="Add submodule progress"
          max={1}
          value={this.state.progressValue}
        />
      </div>
    )
  }

  private renderSuccess() {
    return (
      <>
        <DialogContent className="add-submodule-success">
          <Octicon symbol={octicons.checkCircleFill} />
          <div>
            <h2>Submodule added</h2>
            <p>
              Git updated <code>.gitmodules</code> and checked out the
              repository at{' '}
              <code>{normalizeSubmodulePath(this.state.path)}</code>.
            </p>
          </div>
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            <Button type="button" onClick={this.props.onDismissed}>
              Done
            </Button>
          </div>
        </DialogFooter>
      </>
    )
  }

  public render() {
    const adding = this.state.operation === 'adding'
    if (this.state.operation === 'success') {
      return (
        <Dialog
          className="clone-repository add-submodule-dialog"
          title="Add a submodule"
          onDismissed={this.props.onDismissed}
        >
          {this.renderSuccess()}
        </Dialog>
      )
    }

    return (
      <Dialog
        className="clone-repository add-submodule-dialog"
        title="Add a submodule"
        onSubmit={this.addSubmodule}
        onDismissed={this.props.onDismissed}
        dismissDisabled={adding}
        loading={adding}
      >
        <TabBar
          onTabClicked={this.onTabClicked}
          selectedIndex={this.state.selectedTab}
        >
          <span id="add-submodule-dotcom-tab">GitHub.com</span>
          <span id="add-submodule-enterprise-tab">GitHub Enterprise</span>
          <span id="add-submodule-url-tab">URL</span>
          <span id="add-submodule-providers-tab">GitLab &amp; Bitbucket</span>
        </TabBar>
        {this.state.error !== null && (
          <DialogError>{this.state.error}</DialogError>
        )}
        <div
          className="add-submodule-scroll-region"
          role="tabpanel"
          aria-labelledby={this.getSelectedTabId()}
          aria-busy={adding}
        >
          <fieldset className="add-submodule-inputs" disabled={adding}>
            {this.renderSource()}
            {this.renderReview()}
          </fieldset>
        </div>
        {this.renderProgress()}
        <DialogFooter>
          <div className="button-group">
            <Button type="submit" disabled={!this.canSubmit()}>
              Add submodule
            </Button>
            <Button
              type="button"
              onClick={adding ? this.cancelOperation : this.props.onDismissed}
            >
              {adding ? 'Cancel operation' : 'Cancel'}
            </Button>
          </div>
        </DialogFooter>
      </Dialog>
    )
  }
}
