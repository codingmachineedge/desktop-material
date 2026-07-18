import * as Path from 'path'
import * as React from 'react'
import { Dispatcher } from '../dispatcher'
import { getDefaultDir, setDefaultDir } from '../lib/default-dir'
import {
  Account,
  getAccountKey,
  isBitbucketAccount,
  isDotComAccount,
  isEnterpriseAccount,
  isGitLabAccount,
} from '../../models/account'
import { resolveSelectedAccount } from '../../lib/resolve-selected-account'
import { FoldoutType } from '../../lib/app-state'
import {
  IRepositoryIdentifier,
  parseRepositoryIdentifier,
  parseRemote,
} from '../../lib/remote-parsing'
import { findAccountForRemoteURL } from '../../lib/find-account'
import {
  API,
  IAPIOrganization,
  IAPIRepository,
  IAPIRepositoryCloneInfo,
} from '../../lib/api'
import { Dialog, DialogError, DialogFooter, DialogContent } from '../dialog'
import { TabBar } from '../tab-bar'
import { CloneRepositoryTab } from '../../models/clone-repository-tab'
import { CloneGenericRepository } from './clone-generic-repository'
import { CloneGithubRepository } from './clone-github-repository'
import { assertNever } from '../../lib/fatal-error'
import { CallToAction } from '../lib/call-to-action'
import { Button } from '../lib/button'
import { IAccountRepositories } from '../../lib/stores/api-repositories-store'
import { merge } from '../../lib/merge'
import { ClickSource } from '../lib/list'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { showOpenDialog, showSaveDialog } from '../main-process-proxy'
import { isTopMostDialog } from '../dialog/is-top-most'
import memoizeOne from 'memoize-one'
import {
  NonEmptyCloneFolderError,
  validateEmptyFolder,
} from '../../lib/path-validation'
import {
  BatchCloneMode,
  IBatchCloneItem,
  IBatchCloneInput,
  buildBatchCloneItems,
} from '../../models/batch-clone'
import { mergeOrganizationRepositories } from './org-filter-chips'
import {
  RepositoryVisibilityFilter,
  filterRepositoriesByVisibility,
} from './group-repositories'
import { PopupType } from '../../models/popup'
import { PreferencesTab } from '../../models/preferences'
import { getPreferredGenericCloneAccountKey } from '../../lib/automation/clone-account-fallback'
import { normalizeCloneDepth } from '../../models/clone-options'
import { getAutoClonePolicy } from '../../lib/stores/auto-clone-store'
import { Repository } from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { GitModulesProbe } from '../../lib/submodules/gitmodules-probe'

interface ICloneRepositoryProps {
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void

  readonly accounts: ReadonlyArray<Account>

  /** Repositories already tracked locally, including active clones. */
  readonly repositories: ReadonlyArray<Repository | CloningRepository>

  /** The initial URL or `owner/name` shortcut to use. */
  readonly initialURL: string | null

  /** The currently select tab. */
  readonly selectedTab: CloneRepositoryTab

  /** Called when the user selects a tab. */
  readonly onTabSelected: (tab: CloneRepositoryTab) => void

  /**
   * A map keyed on a user account (GitHub.com or GitHub Enterprise)
   * containing an object with repositories that the authenticated
   * user has explicit permission (:read, :write, or :admin) to access
   * as well as information about whether the list of repositories
   * is currently being loaded or not.
   *
   * If a currently signed in account is missing from the map that
   * means that the list of accessible repositories has not yet been
   * loaded. An entry for an account with an empty list of repositories
   * means that no accessible repositories was found for the account.
   *
   * See the ApiRepositoriesStore for more details on loading repositories
   */
  readonly apiRepositories: ReadonlyMap<Account, IAccountRepositories>

  /**
   * Called when the user requests a refresh of the repositories
   * available for cloning.
   */
  readonly onRefreshRepositories: (account: Account) => void

  /** Whether the dialog is the top most in the dialog stack */
  readonly isTopMost: boolean
}

/** Whether an authenticated account belongs on a hosted clone tab. */
export function accountMatchesCloneTab(
  tab: CloneRepositoryTab,
  account: Account
): boolean {
  switch (tab) {
    case CloneRepositoryTab.DotCom:
      return isDotComAccount(account)
    case CloneRepositoryTab.Enterprise:
      return isEnterpriseAccount(account)
    case CloneRepositoryTab.Providers:
      return isGitLabAccount(account) || isBitbucketAccount(account)
    case CloneRepositoryTab.Generic:
      return false
    default:
      return assertNever(tab, `Unknown clone repository tab: ${tab}`)
  }
}

/**
 * True when an account-list update changes the identity a hosted clone tab
 * resolves to. Account objects are routinely refreshed in place, so compare
 * stable endpoint/id keys rather than object identity.
 */
export function resolvedCloneAccountChanged(
  tab: CloneRepositoryTab,
  selectedAccount: Account | null,
  previousAccounts: ReadonlyArray<Account>,
  accounts: ReadonlyArray<Account>
): boolean {
  if (tab === CloneRepositoryTab.Generic) {
    return false
  }
  const previous = resolveSelectedAccount(
    previousAccounts.filter(account => accountMatchesCloneTab(tab, account)),
    selectedAccount
  )
  const current = resolveSelectedAccount(
    accounts.filter(account => accountMatchesCloneTab(tab, account)),
    selectedAccount
  )
  return (
    (previous === null ? null : getAccountKey(previous)) !==
    (current === null ? null : getAccountKey(current))
  )
}

/**
 * True when a hosted clone tab has several repositories checked for a batch
 * clone. In that mode the chosen path is a *base* directory that each checked
 * repository is cloned into as its own `<base>/<name>` child (validated per-repo
 * by the batch clone flow), so the base is expected to already contain other
 * folders and must not be required to be empty. A single-select clone still
 * writes directly to `path` and keeps the strict empty-folder requirement.
 */
export function isMultiRepositoryCloneSelection(
  tab: CloneRepositoryTab,
  checkedUrls: ReadonlySet<string>
): boolean {
  return tab !== CloneRepositoryTab.Generic && checkedUrls.size > 1
}

/**
 * Preserve account affinity while allowing Git to resolve an API 404.
 *
 * GitHub deliberately uses 404 for private repositories an identity cannot
 * see. Falling back to the entered URL lets the credential trampoline try the
 * remaining exact-origin signed-in accounts instead of stopping before clone.
 */
export function cloneInfoWithAccountFallback(
  info: IAPIRepositoryCloneInfo | null,
  fallbackUrl: string,
  accountKey?: string
): IAPIRepositoryCloneInfo {
  return {
    ...(info ?? { url: fallbackUrl }),
    ...(accountKey !== undefined ? { accountKey } : {}),
  }
}

interface ICloneRepositoryState {
  /** A copy of the path state field which is set when the component initializes.
   *
   *  This value, as opposed to the path state variable, doesn't change for the
   *  lifetime of the component. Used to keep track of whether the user has
   *  modified the path state field which influences whether we show a
   *  warning about the directory already existing or not.
   *
   *  See the onWindowFocus method for more information.
   */
  readonly initialPath: string | null

  /** Are we currently trying to load the entered repository? */
  readonly loading: boolean

  /** The parallel/sequential mode used when cloning multiple repositories. */
  readonly batchMode: BatchCloneMode

  /** Whether a single-repository clone should fetch bounded history. */
  readonly shallowClone: boolean

  /** User-entered shallow history depth, parsed only at the clone boundary. */
  readonly cloneDepth: string

  /** Whether newly discovered repositories should be cloned automatically. */
  readonly autoCloneNewRepositories: boolean

  /** Bumped when a `.gitmodules` probe lands so visible rows re-render. */
  readonly submoduleBadgeVersion: number

  /**
   * A submodule clone URL waiting for the URL tab to become selected. The
   * tab switch round-trips through the dispatcher, so the URL must only be
   * applied once props.selectedTab has actually changed.
   */
  readonly pendingSubmoduleCloneUrl: string | null

  /**
   * The persisted state of the CloneGitHubRepository component for
   * the GitHub.com account.
   */
  readonly dotComTabState: IGitHubTabState

  /**
   * The persisted state of the CloneGitHubRepository component for
   * the GitHub Enterprise account.
   */
  readonly enterpriseTabState: IGitHubTabState

  /** GitLab and Bitbucket repository browser state. */
  readonly providerTabState: IGitHubTabState

  /**
   * The persisted state of the CloneGenericRepository component.
   */
  readonly urlTabState: IUrlTabState
}

/**
 * Common persisted state for the CloneGitHubRepository and
 * CloneGenericRepository components.
 */
interface IBaseTabState {
  /** The current error if one occurred. */
  readonly error: Error | null

  /**
   * The repository identifier that was last parsed from the user-entered URL.
   */
  readonly lastParsedIdentifier: IRepositoryIdentifier | null

  /** The local path to clone to. */
  readonly path: string | null

  /** The user-entered URL or `owner/name` shortcut. */
  readonly url: string

  readonly selectedAccount: Account | null
}

interface IUrlTabState extends IBaseTabState {
  readonly kind: 'urlTabState'
}

/**
 * Persisted state for the CloneGitHubRepository component.
 */
interface IGitHubTabState extends IBaseTabState {
  readonly kind: 'dotComTabState' | 'enterpriseTabState' | 'providerTabState'

  /**
   * The contents of the filter text box used to filter the list of
   * repositories.
   */
  readonly filterText: string

  /**
   * The currently selected repository, or null if no repository
   * is selected.
   */
  readonly selectedItem: IAPIRepository | null

  /**
   * The clone URLs checked for multi-clone. Empty means the tab behaves as a
   * single-select clone.
   */
  readonly checkedUrls: Set<string>

  /** Organization login currently filtering this tab, or all repositories. */
  readonly selectedOrganization: string | null

  /** Visibility scope (all/public/private/forked) filtering this tab. */
  readonly visibilityFilter: RepositoryVisibilityFilter
}

/** The component for cloning a repository. */
export class CloneRepository extends React.Component<
  ICloneRepositoryProps,
  ICloneRepositoryState
> {
  /** Invalidates async validation when the selected tab/account/input changes. */
  private pathValidationSequence = 0
  private cloneInputSequence = 0
  private autoCloneHydrationKey: string | null = null
  private hasUnmounted = false

  private checkIsTopMostDialog = isTopMostDialog(
    () => {
      this.validatePath()
      window.addEventListener('focus', this.onWindowFocus)
    },
    () => {
      window.removeEventListener('focus', this.onWindowFocus)
    }
  )

  private getAccountsForTab = memoizeOne(
    (tab: CloneRepositoryTab, accounts: ReadonlyArray<Account>) =>
      tab === CloneRepositoryTab.Generic
        ? []
        : accounts.filter(account => accountMatchesCloneTab(tab, account))
  )

  /** Lazy per-account `.gitmodules` probes backing the submodule badges. */
  private readonly submoduleProbes = new Map<string, GitModulesProbe>()

  public constructor(props: ICloneRepositoryProps) {
    super(props)

    const defaultDirectory = null

    const initialBaseTabState: IBaseTabState = {
      error: null,
      lastParsedIdentifier: null,
      path: defaultDirectory,
      url: this.props.initialURL || '',
      selectedAccount: null,
    }

    this.state = {
      initialPath: defaultDirectory,
      loading: false,
      batchMode: BatchCloneMode.Parallel,
      shallowClone: false,
      cloneDepth: '1',
      autoCloneNewRepositories: false,
      submoduleBadgeVersion: 0,
      pendingSubmoduleCloneUrl: null,
      dotComTabState: {
        kind: 'dotComTabState',
        filterText: '',
        selectedItem: null,
        checkedUrls: new Set<string>(),
        selectedOrganization: null,
        visibilityFilter: 'all',
        ...initialBaseTabState,
      },
      enterpriseTabState: {
        kind: 'enterpriseTabState',
        filterText: '',
        selectedItem: null,
        checkedUrls: new Set<string>(),
        selectedOrganization: null,
        visibilityFilter: 'all',
        ...initialBaseTabState,
      },
      providerTabState: {
        kind: 'providerTabState',
        filterText: '',
        selectedItem: null,
        checkedUrls: new Set<string>(),
        selectedOrganization: null,
        visibilityFilter: 'all',
        ...initialBaseTabState,
      },
      urlTabState: {
        kind: 'urlTabState',
        ...initialBaseTabState,
      },
    }

    this.initializePath()
  }

  public componentDidUpdate(prevProps: ICloneRepositoryProps) {
    if (prevProps.selectedTab !== this.props.selectedTab) {
      this.pathValidationSequence += 1
      this.cloneInputSequence += 1
      this.syncAutoCloneState(false, () =>
        this.validatePath(this.props.selectedTab)
      )
    }

    const pendingSubmoduleUrl = this.state.pendingSubmoduleCloneUrl
    if (
      pendingSubmoduleUrl !== null &&
      this.props.selectedTab === CloneRepositoryTab.Generic
    ) {
      this.setState({ pendingSubmoduleCloneUrl: null })
      this.updateUrl(pendingSubmoduleUrl)
    }

    if (prevProps.initialURL !== this.props.initialURL) {
      this.updateUrl(this.props.initialURL || '')
    }

    if (prevProps.accounts !== this.props.accounts) {
      this.pathValidationSequence += 1
      this.cloneInputSequence += 1
      if (this.resetChangedHostedAccounts(prevProps.accounts)) {
        // The reset callback hydrates any saved policy against the new account
        // and validates its destination after stale selection state is gone.
      } else {
        this.syncAutoCloneState()
      }
    }

    if (prevProps.repositories !== this.props.repositories) {
      this.syncAutoCloneState()
    }

    this.checkIsTopMostDialog(this.props.isTopMost)
  }

  public componentDidMount() {
    const initialURL = this.props.initialURL
    if (initialURL) {
      this.updateUrl(initialURL)
    }

    this.checkIsTopMostDialog(this.props.isTopMost)
    this.syncAutoCloneState()
  }

  public componentWillUnmount(): void {
    this.hasUnmounted = true
    this.checkIsTopMostDialog(false)
    this.pathValidationSequence += 1
    this.cloneInputSequence += 1
  }

  private initializePath = async () => {
    const initialPath = await getDefaultDir()
    if (this.hasUnmounted) {
      return
    }
    this.setState(
      previousState => ({
        initialPath,
        dotComTabState:
          previousState.dotComTabState.path === null
            ? { ...previousState.dotComTabState, path: initialPath }
            : previousState.dotComTabState,
        enterpriseTabState:
          previousState.enterpriseTabState.path === null
            ? { ...previousState.enterpriseTabState, path: initialPath }
            : previousState.enterpriseTabState,
        providerTabState:
          previousState.providerTabState.path === null
            ? { ...previousState.providerTabState, path: initialPath }
            : previousState.providerTabState,
        urlTabState:
          previousState.urlTabState.path === null
            ? { ...previousState.urlTabState, path: initialPath }
            : previousState.urlTabState,
      }),
      () => {
        // The asynchronous default-directory lookup must not overwrite a
        // persisted per-account automatic-clone destination.
        this.autoCloneHydrationKey = null
        this.syncAutoCloneState(true, () => {
          const selectedTabState = this.getSelectedTabState()
          this.updateUrl(selectedTabState.url)
        })
      }
    )
  }

  /**
   * Clear repository-specific state when sign-out/account refresh changes the
   * account a tab falls back to. Without this, the new account can inherit the
   * previous account's selected row, URL, organization, and checked batch.
   */
  private resetChangedHostedAccounts(
    previousAccounts: ReadonlyArray<Account>
  ): boolean {
    const changed = new Map<CloneRepositoryTab, Account | null>()
    const hostedTabs = [
      CloneRepositoryTab.DotCom,
      CloneRepositoryTab.Enterprise,
      CloneRepositoryTab.Providers,
    ] as const

    for (const tab of hostedTabs) {
      const tabState = this.getGitHubTabState(tab)
      if (
        resolvedCloneAccountChanged(
          tab,
          tabState.selectedAccount,
          previousAccounts,
          this.props.accounts
        )
      ) {
        changed.set(tab, this.getAccountForTab(tab))
      }
    }

    if (changed.size === 0) {
      return false
    }

    const reset = (
      state: IGitHubTabState,
      account: Account | null
    ): IGitHubTabState => ({
      ...state,
      selectedAccount: account,
      selectedOrganization: null,
      selectedItem: null,
      checkedUrls: new Set<string>(),
      url: '',
      lastParsedIdentifier: null,
      error: null,
      path:
        state.path !== null && state.lastParsedIdentifier !== null
          ? Path.dirname(state.path)
          : state.path,
    })

    this.setState(
      previousState => ({
        dotComTabState: changed.has(CloneRepositoryTab.DotCom)
          ? reset(
              previousState.dotComTabState,
              changed.get(CloneRepositoryTab.DotCom) ?? null
            )
          : previousState.dotComTabState,
        enterpriseTabState: changed.has(CloneRepositoryTab.Enterprise)
          ? reset(
              previousState.enterpriseTabState,
              changed.get(CloneRepositoryTab.Enterprise) ?? null
            )
          : previousState.enterpriseTabState,
        providerTabState: changed.has(CloneRepositoryTab.Providers)
          ? reset(
              previousState.providerTabState,
              changed.get(CloneRepositoryTab.Providers) ?? null
            )
          : previousState.providerTabState,
      }),
      () => {
        const selectedAccount = changed.get(this.props.selectedTab)
        if (selectedAccount !== undefined && selectedAccount !== null) {
          this.props.onRefreshRepositories(selectedAccount)
        }
        this.syncAutoCloneState(false, () =>
          this.validatePath(this.props.selectedTab)
        )
      }
    )
    return true
  }

  /**
   * v2 header subtitle: names the account host/login the repository list is
   * scoped to, or falls back to generic guidance on the URL tab.
   */
  private getDialogSubtitle(): string {
    const tab = this.props.selectedTab
    const account =
      tab === CloneRepositoryTab.Generic ? null : this.getAccountForTab(tab)

    if (account === null) {
      return 'Enter a repository location, then choose where to clone it on your machine'
    }

    const host = account.friendlyEndpoint
      .replace(/^GitLab · |^Bitbucket · /, '')
      .toLowerCase()

    return `Select any number of repositories from ${host}/${account.login}, then clone them in parallel or one by one`
  }

  /**
   * v2 header: leading 40x40 radius-14 primary-container icon chip, the
   * dialog title, and an 11.5px on-surface-variant subtitle line.
   */
  private renderDialogTitle() {
    return (
      <>
        <span className="clone-dialog-icon-chip" aria-hidden="true">
          <Octicon symbol={octicons.desktopDownload} />
        </span>
        <span className="clone-dialog-title-block">
          <span className="clone-dialog-title">
            {__DARWIN__ ? 'Clone Repositories' : 'Clone repositories'}
          </span>
          <span className="clone-dialog-subtitle">
            {this.getDialogSubtitle()}
          </span>
        </span>
      </>
    )
  }

  public render() {
    const { error } = this.getSelectedTabState()
    return (
      <Dialog
        className="clone-repository"
        title={this.renderDialogTitle()}
        onSubmit={this.clone}
        onDismissed={this.props.onDismissed}
        loading={this.state.loading}
      >
        <TabBar
          onTabClicked={this.onTabClicked}
          selectedIndex={this.props.selectedTab}
        >
          <span id="dotcom-tab">GitHub.com</span>
          <span id="enterprise-tab">GitHub Enterprise</span>
          <span id="url-tab">URL</span>
          <span id="providers-tab">GitLab &amp; Bitbucket</span>
        </TabBar>

        {error ? (
          <DialogError>
            <span>{error.message}</span>
            {error instanceof NonEmptyCloneFolderError && (
              <Button onClick={this.onTryToAddInstead}>
                Try to add instead
              </Button>
            )}
          </DialogError>
        ) : null}

        <div
          className="clone-repository-tab-panel"
          role="tabpanel"
          aria-labelledby={this.getSelectedTabId()}
        >
          {this.renderActiveTab()}
        </div>

        {this.renderFooter()}
      </Dialog>
    )
  }

  private getSelectedTabId = () => {
    return this.props.selectedTab === CloneRepositoryTab.DotCom
      ? 'dotcom-tab'
      : this.props.selectedTab === CloneRepositoryTab.Enterprise
      ? 'enterprise-tab'
      : this.props.selectedTab === CloneRepositoryTab.Generic
      ? 'url-tab'
      : 'providers-tab'
  }

  private checkIfCloningDisabled = () => {
    const tabState = this.getSelectedTabState()
    const { error, url, path } = tabState
    const { loading } = this.state

    const disabled =
      url.length === 0 ||
      path == null ||
      path.length === 0 ||
      loading ||
      error !== null ||
      this.getCloneDepthError() !== null

    return disabled
  }

  private renderFooter() {
    const selectedTab = this.props.selectedTab
    if (
      selectedTab !== CloneRepositoryTab.Generic &&
      !this.getAccountForTab(selectedTab)
    ) {
      return null
    }

    const disabled = this.checkIfCloningDisabled()

    return (
      <DialogFooter>
        <div className="clone-history-options">
          <label className="clone-shallow-toggle">
            <input
              type="checkbox"
              checked={this.state.shallowClone}
              onChange={this.onShallowCloneChanged}
            />
            <span>
              <strong>Shallow clone</strong>
              <small>Current branch and recursive submodules</small>
            </span>
          </label>
          <label className="clone-depth-field">
            <span>Commit depth</span>
            <input
              type="number"
              min="1"
              max="2147483647"
              step="1"
              inputMode="numeric"
              value={this.state.cloneDepth}
              disabled={!this.state.shallowClone}
              aria-invalid={this.getCloneDepthError() !== null}
              aria-describedby="clone-depth-guidance"
              onChange={this.onCloneDepthChanged}
            />
          </label>
          <small id="clone-depth-guidance" role="status">
            {this.getCloneDepthError() ??
              (this.state.shallowClone
                ? 'Fetches less history now; deepen later with Repository tools.'
                : 'Full history will be cloned.')}
          </small>
        </div>
        <OkCancelButtonGroup okButtonText="Clone" okButtonDisabled={disabled} />
      </DialogFooter>
    )
  }

  private onShallowCloneChanged = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => this.setState({ shallowClone: event.currentTarget.checked })

  private onCloneDepthChanged = (event: React.ChangeEvent<HTMLInputElement>) =>
    this.setState({ cloneDepth: event.currentTarget.value })

  private getCloneDepthError(): string | null {
    if (!this.state.shallowClone) {
      return null
    }
    try {
      normalizeCloneDepth(this.state.cloneDepth)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Enter a valid depth.'
    }
  }

  private onTabClicked = (tab: CloneRepositoryTab) => {
    this.props.onTabSelected(tab)
  }

  private onPathChanged = (path: string) => {
    const tab = this.props.selectedTab
    this.cloneInputSequence += 1
    this.setTabState({ path }, tab, () => {
      this.validatePath(tab)
      if (this.state.autoCloneNewRepositories) {
        this.onAutoCloneNewRepositoriesChanged(true)
      }
    })
  }

  private renderActiveTab() {
    const tab = this.props.selectedTab

    switch (tab) {
      case CloneRepositoryTab.Generic:
        const tabState = this.state.urlTabState
        return (
          <CloneGenericRepository
            path={tabState.path ?? ''}
            url={tabState.url}
            onPathChanged={this.onPathChanged}
            onUrlChanged={this.updateUrl}
            onChooseDirectory={this.onChooseDirectory}
          />
        )

      case CloneRepositoryTab.DotCom:
      case CloneRepositoryTab.Enterprise:
      case CloneRepositoryTab.Providers: {
        const tabState = this.getGitHubTabState(tab)
        const tabAccounts = this.getAccountsForTab(tab, this.props.accounts)
        const selectedAccount = this.getAccountForTab(tab)

        if (!selectedAccount) {
          return <DialogContent>{this.renderSignIn(tab)}</DialogContent>
        } else {
          const accountState = this.props.apiRepositories.get(selectedAccount)
          const repositories =
            accountState === undefined ? null : accountState.repositories
          const organization =
            tabState.selectedOrganization === null
              ? null
              : accountState?.organizations.find(
                  x => x.login === tabState.selectedOrganization
                ) ?? null
          const organizationState = organization
            ? accountState?.organizationRepositories.get(
                organization.login.toLowerCase()
              )
            : undefined
          const mergedRepositories =
            repositories === null || organization === null
              ? repositories
              : mergeOrganizationRepositories(
                  repositories,
                  organizationState?.repositories ?? [],
                  organization.login
                )
          const visibleRepositories =
            mergedRepositories === null
              ? null
              : filterRepositoriesByVisibility(
                  mergedRepositories,
                  tabState.visibilityFilter
                )
          const loading =
            accountState === undefined ? false : accountState.loading

          return (
            <CloneGithubRepository
              path={tabState.path ?? ''}
              account={selectedAccount}
              accounts={tabAccounts}
              selectedItem={tabState.selectedItem}
              onSelectionChanged={this.onSelectionChanged}
              onPathChanged={this.onPathChanged}
              onChooseDirectory={this.onChooseDirectory}
              repositories={visibleRepositories}
              loading={loading || organizationState?.loading === true}
              repositoryError={accountState?.error ?? null}
              organizations={accountState?.organizations ?? []}
              organizationsLoading={accountState?.organizationsLoading ?? false}
              selectedOrganization={tabState.selectedOrganization}
              organizationError={organizationState?.error ?? null}
              onSelectedOrganizationChanged={this.onSelectedOrganizationChanged}
              visibilityFilter={tabState.visibilityFilter}
              onVisibilityFilterChanged={this.onVisibilityFilterChanged}
              onRefreshOrganization={this.onRefreshOrganization}
              onRefreshRepositories={this.props.onRefreshRepositories}
              filterText={tabState.filterText}
              onFilterTextChanged={this.onFilterTextChanged}
              onItemClicked={this.onItemClicked}
              onSelectedAccountChanged={this.onSelectedAccountChanged}
              checkedUrls={tabState.checkedUrls}
              onToggleItemChecked={this.onToggleRepositoryChecked}
              onToggleAllItemsChecked={this.onToggleAllRepositoriesChecked}
              batchMode={this.state.batchMode}
              onBatchModeChanged={this.onBatchModeChanged}
              onCloneBatch={this.onCloneBatch}
              autoCloneNewRepositories={this.state.autoCloneNewRepositories}
              onAutoCloneNewRepositoriesChanged={
                this.onAutoCloneNewRepositoriesChanged
              }
              getSubmoduleCount={this.getSubmoduleCountForUrl}
              onProbeSubmodules={this.onProbeSubmodules}
              onShowSubmodules={this.onShowSubmodules}
              submoduleBadgeVersion={this.state.submoduleBadgeVersion}
            />
          )
        }
      }
      default:
        return assertNever(tab, `Unknown tab: ${tab}`)
    }
  }

  private onSubmoduleProbeUpdated = () => {
    if (!this.hasUnmounted) {
      this.setState(previous => ({
        submoduleBadgeVersion: previous.submoduleBadgeVersion + 1,
      }))
    }
  }

  private getSubmoduleProbe(account: Account): GitModulesProbe {
    const key = getAccountKey(account)
    const existing = this.submoduleProbes.get(key)
    if (existing !== undefined) {
      return existing
    }

    const api = API.fromAccount(account)
    const probe = new GitModulesProbe(async (owner, name) => {
      try {
        return await api.fetchWorkflowFileContent(owner, name, '.gitmodules')
      } catch {
        // No .gitmodules (404) and unreadable both mean "no badge".
        return null
      }
    }, this.onSubmoduleProbeUpdated)

    this.submoduleProbes.set(key, probe)
    return probe
  }

  private onProbeSubmodules = (repository: IAPIRepository) => {
    const account = this.getAccountForTab(this.props.selectedTab)
    if (account !== null) {
      this.getSubmoduleProbe(account).probe({
        cloneUrl: repository.clone_url,
        ownerLogin: repository.owner.login,
        name: repository.name,
      })
    }
  }

  private getSubmoduleCountForUrl = (url: string): number | undefined => {
    const account = this.getAccountForTab(this.props.selectedTab)
    if (account === null) {
      return undefined
    }
    return this.submoduleProbes.get(getAccountKey(account))?.getCachedCount(url)
  }

  private onShowSubmodules = (repository: IAPIRepository) => {
    const account = this.getAccountForTab(this.props.selectedTab)
    if (account === null) {
      return
    }

    const entries = this.getSubmoduleProbe(account).getCachedEntries(
      repository.clone_url
    )
    if (entries === undefined || entries.length === 0) {
      return
    }

    this.props.dispatcher.showPopup({
      type: PopupType.CloneableSubmodules,
      parentName: `${repository.owner.login}/${repository.name}`,
      parentCloneUrl: repository.clone_url,
      entries,
      onCloneUrl: this.onCloneSubmoduleUrl,
    })
  }

  /**
   * Take a submodule's resolved URL into this already-open clone dialog's URL
   * tab instead of opening a second clone dialog on the popup stack.
   *
   * updateUrl writes into the tab that is selected *at call time*, and the
   * tab switch round-trips through the dispatcher, so the URL is parked in
   * state and applied from componentDidUpdate once the URL tab is actually
   * selected — otherwise it would land in the previous tab's state and the
   * URL field would appear empty.
   */
  private onCloneSubmoduleUrl = (url: string) => {
    if (this.props.selectedTab === CloneRepositoryTab.Generic) {
      this.updateUrl(url)
      return
    }
    this.setState({ pendingSubmoduleCloneUrl: url })
    this.props.onTabSelected(CloneRepositoryTab.Generic)
  }

  private onSelectedAccountChanged = (account: Account) => {
    const tab = this.props.selectedTab
    if (tab !== CloneRepositoryTab.Generic) {
      const previous = this.getGitHubTabState(tab)
      const basePath =
        previous.path !== null && previous.lastParsedIdentifier !== null
          ? Path.dirname(previous.path)
          : previous.path
      this.pathValidationSequence += 1
      this.cloneInputSequence += 1
      this.setGitHubTabState(
        {
          selectedAccount: account,
          selectedOrganization: null,
          visibilityFilter: 'all',
          selectedItem: null,
          checkedUrls: new Set<string>(),
          url: '',
          lastParsedIdentifier: null,
          error: null,
          path: basePath,
        },
        tab,
        () => {
          this.syncAutoCloneState(false, () => {
            this.props.onRefreshRepositories(account)
            this.validatePath(tab)
          })
        }
      )
    }
  }

  private onVisibilityFilterChanged = (filter: RepositoryVisibilityFilter) => {
    const tab = this.props.selectedTab
    if (tab !== CloneRepositoryTab.Generic) {
      this.setGitHubTabState({ visibilityFilter: filter }, tab)
    }
  }

  private onSelectedOrganizationChanged = (
    organization: IAPIOrganization | null
  ) => {
    const tab = this.props.selectedTab
    if (tab === CloneRepositoryTab.Generic) {
      return
    }

    this.setGitHubTabState(
      {
        selectedOrganization: organization?.login ?? null,
        selectedItem: null,
        url: '',
      },
      tab
    )

    const account = this.getAccountForTab(tab)
    if (account !== null && organization !== null) {
      this.props.dispatcher.refreshApiOrganizationRepositories(
        account,
        organization
      )
    }
  }

  private onRefreshOrganization = () => {
    const tab = this.props.selectedTab
    if (tab === CloneRepositoryTab.Generic) {
      return
    }
    const account = this.getAccountForTab(tab)
    const login = this.getGitHubTabState(tab).selectedOrganization
    const organization =
      account === null || login === null
        ? null
        : this.props.apiRepositories
            .get(account)
            ?.organizations.find(x => x.login === login) ?? null
    if (account !== null && organization !== null) {
      this.props.dispatcher.refreshApiOrganizationRepositories(
        account,
        organization
      )
    }
  }

  private getAccountForTab(tab: CloneRepositoryTab): Account | null {
    const tabState = this.getTabState(tab)
    const tabAccounts = this.getAccountsForTab(tab, this.props.accounts)

    return resolveSelectedAccount(tabAccounts, tabState.selectedAccount)
  }

  private getGitHubTabState(
    tab:
      | CloneRepositoryTab.DotCom
      | CloneRepositoryTab.Enterprise
      | CloneRepositoryTab.Providers
  ): IGitHubTabState {
    if (tab === CloneRepositoryTab.DotCom) {
      return this.state.dotComTabState
    } else if (tab === CloneRepositoryTab.Enterprise) {
      return this.state.enterpriseTabState
    } else if (tab === CloneRepositoryTab.Providers) {
      return this.state.providerTabState
    } else {
      return assertNever(tab, `Unknown tab: ${tab}`)
    }
  }

  private getTabState(tab: CloneRepositoryTab): IBaseTabState {
    if (tab === CloneRepositoryTab.DotCom) {
      return this.state.dotComTabState
    } else if (tab === CloneRepositoryTab.Enterprise) {
      return this.state.enterpriseTabState
    } else if (tab === CloneRepositoryTab.Generic) {
      return this.state.urlTabState
    } else if (tab === CloneRepositoryTab.Providers) {
      return this.state.providerTabState
    } else {
      return assertNever(tab, `Unknown tab: ${tab}`)
    }
  }

  private getSelectedTabState(): IBaseTabState {
    return this.getTabState(this.props.selectedTab)
  }

  /**
   * Update the state for the currently selected tab. Note that
   * since the selected tab can be using either IGitHubTabState
   * or IUrlTabState this method can only accept subset state
   * shared between the two types.
   */
  private setSelectedTabState<K extends keyof IBaseTabState>(
    state: Pick<IBaseTabState, K>,
    callback?: () => void
  ) {
    this.setTabState(state, this.props.selectedTab, callback)
  }

  /**
   * Merge the current state with the provided subset of state
   * for the provided tab.
   */
  private setTabState<K extends keyof IBaseTabState>(
    state: Pick<IBaseTabState, K>,
    tab: CloneRepositoryTab,
    callback?: () => void
  ): void {
    if (tab === CloneRepositoryTab.DotCom) {
      this.setState(
        prevState => ({
          dotComTabState: {
            ...prevState.dotComTabState,
            ...state,
          },
        }),
        callback
      )
    } else if (tab === CloneRepositoryTab.Enterprise) {
      this.setState(
        prevState => ({
          enterpriseTabState: {
            ...prevState.enterpriseTabState,
            ...state,
          },
        }),
        callback
      )
    } else if (tab === CloneRepositoryTab.Generic) {
      this.setState(
        prevState => ({
          urlTabState: { ...prevState.urlTabState, ...state },
        }),
        callback
      )
    } else if (tab === CloneRepositoryTab.Providers) {
      this.setState(
        prevState => ({
          providerTabState: {
            ...prevState.providerTabState,
            ...state,
          },
        }),
        callback
      )
    } else {
      return assertNever(tab, `Unknown tab: ${tab}`)
    }
  }

  private setGitHubTabState<K extends keyof IGitHubTabState>(
    tabState: Pick<IGitHubTabState, K>,
    tab:
      | CloneRepositoryTab.DotCom
      | CloneRepositoryTab.Enterprise
      | CloneRepositoryTab.Providers,
    callback?: () => void
  ): void {
    if (tab === CloneRepositoryTab.DotCom) {
      this.setState(
        prevState => ({
          dotComTabState: merge(prevState.dotComTabState, tabState),
        }),
        callback
      )
    } else if (tab === CloneRepositoryTab.Enterprise) {
      this.setState(
        prevState => ({
          enterpriseTabState: merge(prevState.enterpriseTabState, tabState),
        }),
        callback
      )
    } else if (tab === CloneRepositoryTab.Providers) {
      this.setState(
        prevState => ({
          providerTabState: merge(prevState.providerTabState, tabState),
        }),
        callback
      )
    } else {
      return assertNever(tab, `Unknown tab: ${tab}`)
    }
  }

  private renderSignIn(tab: CloneRepositoryTab) {
    const signInTitle = __DARWIN__ ? 'Sign In' : 'Sign in'
    switch (tab) {
      case CloneRepositoryTab.DotCom:
        return (
          <CallToAction actionTitle={signInTitle} onAction={this.signInDotCom}>
            <div>
              Sign in to your GitHub.com account to access your repositories.
            </div>
          </CallToAction>
        )
      case CloneRepositoryTab.Enterprise:
        return (
          <CallToAction
            actionTitle={signInTitle}
            onAction={this.signInEnterprise}
          >
            <div>
              If you are using GitHub Enterprise at work, sign in to it to get
              access to your repositories.
            </div>
          </CallToAction>
        )
      case CloneRepositoryTab.Generic:
        return null
      case CloneRepositoryTab.Providers:
        return (
          <CallToAction
            actionTitle="Add provider account"
            onAction={this.signInProvider}
          >
            <div>
              Add a GitLab personal access token or Bitbucket app password in
              Settings to browse and clone your repositories.
            </div>
          </CallToAction>
        )
      default:
        return assertNever(tab, `Unknown sign in tab: ${tab}`)
    }
  }

  private signInDotCom = () => {
    this.props.dispatcher.showDotComSignInDialog()
  }

  private signInEnterprise = () => {
    this.props.dispatcher.showEnterpriseSignInDialog()
  }

  private signInProvider = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.Preferences,
      initialSelectedTab: PreferencesTab.Accounts,
    })
  }

  private onFilterTextChanged = (filterText: string) => {
    if (this.props.selectedTab !== CloneRepositoryTab.Generic) {
      this.setGitHubTabState({ filterText }, this.props.selectedTab)
    }
  }

  private onSelectionChanged = (selectedItem: IAPIRepository | null) => {
    if (this.props.selectedTab !== CloneRepositoryTab.Generic) {
      this.setGitHubTabState({ selectedItem }, this.props.selectedTab)
      this.updateUrl(selectedItem === null ? '' : selectedItem.clone_url)
    }
  }

  private onToggleRepositoryChecked = (url: string) => {
    const tab = this.props.selectedTab
    if (tab === CloneRepositoryTab.Generic) {
      return
    }

    const tabState = this.getGitHubTabState(tab)
    const checkedUrls = new Set(tabState.checkedUrls)
    if (checkedUrls.has(url)) {
      checkedUrls.delete(url)
    } else {
      checkedUrls.add(url)
    }

    // Crossing into (or out of) multi-select mode changes whether `path` is a
    // per-repo destination or a base directory, so revalidate to clear or
    // restore the empty-folder error accordingly.
    this.setGitHubTabState({ checkedUrls }, tab, () => this.validatePath(tab))
  }

  private onToggleAllRepositoriesChecked = (
    urls: ReadonlyArray<string>,
    checked: boolean
  ) => {
    const tab = this.props.selectedTab
    if (tab === CloneRepositoryTab.Generic) {
      return
    }

    const checkedUrls = new Set(this.getGitHubTabState(tab).checkedUrls)
    for (const url of urls) {
      if (checked) {
        checkedUrls.add(url)
      } else {
        checkedUrls.delete(url)
      }
    }

    this.setGitHubTabState({ checkedUrls }, tab, () => this.validatePath(tab))
  }

  private onAutoCloneNewRepositoriesChanged = (enabled: boolean) => {
    const tab = this.props.selectedTab
    if (tab === CloneRepositoryTab.Generic) {
      return
    }
    const account = this.getAccountForTab(tab)
    if (account === null) {
      return
    }
    const baseDirectory = this.getAutoCloneBaseDirectory(tab)
    if (enabled && (baseDirectory === null || baseDirectory.length === 0)) {
      this.setGitHubTabState(
        {
          error: new Error(
            'Choose a base directory before enabling auto-clone.'
          ),
        },
        tab
      )
      return
    }
    this.props.dispatcher.configureAutoClone(
      account,
      baseDirectory ?? '',
      this.state.batchMode,
      enabled
    )
    this.setState({ autoCloneNewRepositories: enabled })
  }

  private onBatchModeChanged = (batchMode: BatchCloneMode) => {
    this.setState({ batchMode }, () => {
      if (this.state.autoCloneNewRepositories) {
        this.onAutoCloneNewRepositoriesChanged(true)
      }
    })
  }

  private syncAutoCloneState = (
    forceHydration = false,
    callback?: () => void
  ) => {
    const tab = this.props.selectedTab
    const account =
      tab === CloneRepositoryTab.Generic ? null : this.getAccountForTab(tab)
    const policy = account === null ? null : getAutoClonePolicy(account)
    const hydrationKey =
      account === null ? `${tab}:none` : `${tab}:${getAccountKey(account)}`
    const shouldHydrate =
      forceHydration || this.autoCloneHydrationKey !== hydrationKey
    this.autoCloneHydrationKey = hydrationKey

    const enabled = policy !== null
    const nextState = {
      autoCloneNewRepositories: enabled,
      batchMode: policy?.mode ?? this.state.batchMode,
    }
    const finish = () => {
      if (
        shouldHydrate &&
        policy !== null &&
        tab !== CloneRepositoryTab.Generic
      ) {
        const tabState = this.getGitHubTabState(tab)
        if (tabState.selectedItem === null && tabState.url.length === 0) {
          this.setGitHubTabState(
            {
              path: policy.baseDirectory,
              lastParsedIdentifier: null,
              error: null,
            },
            tab,
            callback
          )
          return
        }
      }
      callback?.()
    }

    if (
      this.state.autoCloneNewRepositories !==
        nextState.autoCloneNewRepositories ||
      this.state.batchMode !== nextState.batchMode
    ) {
      this.setState(nextState, finish)
    } else {
      finish()
    }
  }

  private getAutoCloneBaseDirectory(
    tab:
      | CloneRepositoryTab.DotCom
      | CloneRepositoryTab.Enterprise
      | CloneRepositoryTab.Providers
  ): string | null {
    const tabState = this.getGitHubTabState(tab)
    if (tabState.path === null) {
      return null
    }
    return tabState.lastParsedIdentifier === null
      ? tabState.path
      : Path.dirname(tabState.path)
  }

  private onCloneBatch = () => {
    const tab = this.props.selectedTab
    if (tab === CloneRepositoryTab.Generic) {
      return
    }

    const tabState = this.getGitHubTabState(tab)
    const baseDirectory = this.getAutoCloneBaseDirectory(tab)

    if (baseDirectory === null || baseDirectory.length === 0) {
      this.setGitHubTabState(
        { error: new Error('Please choose a base directory to clone into.') },
        tab
      )
      return
    }

    const account = this.getAccountForTab(tab)
    const accountState = account
      ? this.props.apiRepositories.get(account)
      : undefined
    const repositories = accountState
      ? [
          ...accountState.repositories,
          ...Array.from(accountState.organizationRepositories.values()).flatMap(
            x => x.repositories
          ),
        ]
      : null

    const inputs: ReadonlyArray<IBatchCloneInput> = Array.from(
      tabState.checkedUrls
    ).map(url => {
      const repo = repositories?.find(r => r.clone_url === url) ?? null
      return {
        url,
        ...(account !== null && account.token.length > 0
          ? { accountKey: getAccountKey(account) }
          : {}),
        ...(repo
          ? { name: repo.name, defaultBranch: repo.default_branch }
          : {}),
      }
    })

    if (inputs.length === 0) {
      return
    }

    let items: ReadonlyArray<IBatchCloneItem>
    try {
      items = buildBatchCloneItems(inputs, baseDirectory)
    } catch (error) {
      this.setGitHubTabState(
        {
          error:
            error instanceof Error
              ? error
              : new Error('Unable to build a safe clone queue.'),
        },
        tab
      )
      return
    }

    this.props.dispatcher.closeFoldout(FoldoutType.Repository)
    this.props.dispatcher.cloneBatch(items, this.state.batchMode)

    setDefaultDir(baseDirectory)
    this.props.onDismissed()
  }

  private validatePath = async (
    tab: CloneRepositoryTab = this.props.selectedTab
  ) => {
    const request = ++this.pathValidationSequence
    const tabState = this.getTabState(tab)
    const { path, url, error } = tabState
    const accountSnapshotKey = this.getAccountSnapshotKey(tab)
    const { initialPath } = this.state
    const isDefaultPath = initialPath === path
    const isURLNotEntered = url === ''
    const isHostedBaseDirectory =
      tab !== CloneRepositoryTab.Generic &&
      isURLNotEntered &&
      tabState.lastParsedIdentifier === null
    // Cloning several checked repositories writes each into its own
    // `<base>/<name>` child, so `path` is a base directory that is expected to
    // be non-empty; the per-repo destinations are validated by the batch flow.
    const isMultiRepositoryClone =
      tab !== CloneRepositoryTab.Generic &&
      isMultiRepositoryCloneSelection(
        tab,
        this.getGitHubTabState(tab).checkedUrls
      )

    if (
      (isDefaultPath && isURLNotEntered) ||
      isHostedBaseDirectory ||
      isMultiRepositoryClone
    ) {
      if (error) {
        this.setTabState({ error: null }, tab)
      }
    } else {
      const pathValidation = await validateEmptyFolder(path)

      // A validation belongs to one exact tab/account/url/path snapshot. An OS
      // picker, account switch, or tab switch invalidates it before it can land.
      const newTabState = this.getTabState(tab)
      if (
        request === this.pathValidationSequence &&
        this.props.selectedTab === tab &&
        newTabState.path === path &&
        newTabState.url === url &&
        this.getAccountSnapshotKey(tab) === accountSnapshotKey
      ) {
        this.setTabState({ error: pathValidation, path }, tab)
      }
    }
  }

  private onTryToAddInstead = async () => {
    const tab = this.props.selectedTab
    const path = this.getTabState(tab).path
    if (path === null) {
      return
    }

    const accountKey = this.getAccountSnapshotKey(tab)
    const accountKeysByPath =
      accountKey === null ? undefined : new Map([[path, accountKey]])
    const added = await this.props.dispatcher.addRepositories(
      [path],
      accountKeysByPath
    )
    if (added.length > 0) {
      this.props.onDismissed()
    }
  }

  private getAccountSnapshotKey(tab: CloneRepositoryTab): string | null {
    if (tab === CloneRepositoryTab.Generic) {
      return null
    }
    const account = this.getAccountForTab(tab)
    return account === null ? null : getAccountKey(account)
  }

  private onChooseDirectory = async () => {
    // We received feedback (#12812) that using the save dialog is confusing on
    // windows due to appearing to require a file selection. This is not the case
    // on mac where it more clearly shows directory creation.
    if (__DARWIN__) {
      return this.onChooseWithSaveDialog()
    }

    return this.onChooseWithOpenDialog()
  }

  private onChooseWithOpenDialog = async (): Promise<string | undefined> => {
    const tab = this.props.selectedTab
    const accountSnapshotKey = this.getAccountSnapshotKey(tab)
    const request = this.cloneInputSequence
    const path = await showOpenDialog({
      properties: ['createDirectory', 'openDirectory'],
    })

    if (
      path === null ||
      request !== this.cloneInputSequence ||
      tab !== this.props.selectedTab ||
      accountSnapshotKey !== this.getAccountSnapshotKey(tab)
    ) {
      return
    }

    const tabState = this.getTabState(tab)
    const lastParsedIdentifier = tabState.lastParsedIdentifier
    const directory = lastParsedIdentifier
      ? Path.join(path, lastParsedIdentifier.name)
      : path

    this.setTabState({ path: directory, error: null }, tab, () =>
      this.validatePath(tab)
    )

    return directory
  }

  private onChooseWithSaveDialog = async (): Promise<string | undefined> => {
    const tab = this.props.selectedTab
    const accountKey = this.getAccountSnapshotKey(tab)
    const request = this.cloneInputSequence
    const tabState = this.getTabState(tab)

    const path = await showSaveDialog({
      buttonLabel: 'Select',
      nameFieldLabel: 'Clone As:',
      showsTagField: false,
      defaultPath: tabState.path ?? '',
      properties: ['createDirectory'],
    })

    if (
      path == null ||
      request !== this.cloneInputSequence ||
      tab !== this.props.selectedTab ||
      accountKey !== this.getAccountSnapshotKey(tab)
    ) {
      return
    }

    this.setTabState({ path, error: null }, tab, () => this.validatePath(tab))

    return path
  }

  private updateUrl = async (url: string) => {
    const tab = this.props.selectedTab
    this.cloneInputSequence += 1
    const parsed = parseRepositoryIdentifier(url)
    const tabState = this.getTabState(tab)
    const lastParsedIdentifier = tabState.lastParsedIdentifier

    // If there is no path yet, just update the url
    if (tabState.path === null) {
      this.setTabState({ url }, tab, () => this.validatePath(tab))
      return
    }

    let newPath: string

    const dirPath = tabState.path
    if (lastParsedIdentifier) {
      if (parsed) {
        newPath = Path.join(Path.dirname(dirPath), parsed.name)
      } else {
        newPath = Path.dirname(dirPath)
      }
    } else if (parsed) {
      newPath = Path.join(dirPath, parsed.name)
    } else {
      newPath = dirPath
    }

    this.setTabState(
      {
        url,
        lastParsedIdentifier: parsed,
        path: newPath,
      },
      tab,
      () => this.validatePath(tab)
    )
  }

  /**
   * Lookup the account associated with the clone (if applicable) and resolve
   * the repository alias to the clone URL and the repository default branch,
   * if possible.
   */
  private async resolveCloneInfo(): Promise<IAPIRepositoryCloneInfo | null> {
    const { url, lastParsedIdentifier } = this.getSelectedTabState()

    const tab = this.props.selectedTab
    const selectedAccount =
      tab === CloneRepositoryTab.Generic ? null : this.getAccountForTab(tab)
    const account =
      selectedAccount ??
      (await findAccountForRemoteURL(url, this.props.accounts))
    const accountKey =
      selectedAccount !== null && selectedAccount.token.length > 0
        ? getAccountKey(selectedAccount)
        : tab === CloneRepositoryTab.Generic
        ? getPreferredGenericCloneAccountKey(url, this.props.accounts, account)
        : undefined

    if (url.endsWith('.wiki.git')) {
      return { url, accountKey }
    }

    if (lastParsedIdentifier !== null && account !== null) {
      const api = API.fromAccount(account)
      const { owner, name } = lastParsedIdentifier
      // Respect the user's preference if they provided an SSH URL
      const protocol = parseRemote(url)?.protocol

      return api
        .fetchRepositoryCloneInfo(owner, name, protocol)
        .then(info => cloneInfoWithAccountFallback(info, url, accountKey))
        .catch(err => {
          log.error(`Failed to look up repository clone info for '${url}'`, err)
          return cloneInfoWithAccountFallback(null, url, accountKey)
        })
    }

    return { url, accountKey }
  }

  private onItemClicked = (repository: IAPIRepository, source: ClickSource) => {
    if (source.kind === 'keyboard' && source.event.key === 'Enter') {
      if (this.checkIfCloningDisabled() === false) {
        this.clone()
      }
    }
  }

  private clone = async () => {
    const tab = this.props.selectedTab
    const inputSequence = this.cloneInputSequence
    const accountSnapshotKey = this.getAccountSnapshotKey(tab)
    const inputState = this.getTabState(tab)
    this.setState({ loading: true })

    const cloneInfo = await this.resolveCloneInfo()
    const currentState = this.getTabState(tab)
    if (
      tab !== this.props.selectedTab ||
      inputSequence !== this.cloneInputSequence ||
      accountSnapshotKey !== this.getAccountSnapshotKey(tab) ||
      inputState.url !== currentState.url ||
      inputState.path !== currentState.path
    ) {
      this.setState({ loading: false })
      return
    }
    const { path } = currentState

    if (path == null) {
      const error = new Error(`Directory could not be created at this path.`)
      this.setState({ loading: false })
      this.setSelectedTabState({ error })
      return
    }

    if (!cloneInfo) {
      const error = new Error(
        `We couldn't find that repository. Check that you are logged in, the network is accessible, and the URL or repository alias are spelled correctly.`
      )
      this.setState({ loading: false })
      this.setSelectedTabState({ error })
      return
    }

    const { url, defaultBranch, accountKey } = cloneInfo

    this.props.dispatcher.closeFoldout(FoldoutType.Repository)
    try {
      this.cloneImpl(url.trim(), path, defaultBranch, accountKey ?? undefined)
    } catch (e) {
      log.error(`CloneRepository: clone failed to complete to ${path}`, e)
      this.setState({ loading: false })
      this.setSelectedTabState({ error: e })
    }
  }

  private cloneImpl(
    url: string,
    path: string,
    defaultBranch?: string,
    accountKey?: string
  ) {
    const depth = this.state.shallowClone
      ? normalizeCloneDepth(this.state.cloneDepth)
      : undefined
    this.props.dispatcher.clone(url, path, {
      defaultBranch,
      ...(accountKey !== undefined ? { accountKey } : {}),
      depth,
      singleBranch: depth !== undefined,
      shallowSubmodules: depth !== undefined,
    })
    this.props.onDismissed()

    setDefaultDir(Path.resolve(path, '..'))
  }

  private onWindowFocus = () => {
    // Verify the path after focus has been regained in
    // case the directory or directory contents has been
    // created/removed/altered while the user wasn't in-app.
    this.validatePath()
  }
}
