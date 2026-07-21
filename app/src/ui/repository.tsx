import * as React from 'react'
import { Repository } from '../models/repository'
import { Commit, CommitOneLine } from '../models/commit'
import { TipState } from '../models/tip'
import { UiView } from './ui-view'
import { Changes, ChangesSidebar } from './changes'
import { NoChanges } from './changes/no-changes'
import { MultipleSelection } from './changes/multiple-selection'
import { FilesChangedBadge } from './changes/files-changed-badge'
import { SelectedCommits, CompareSidebar } from './history'
import { Resizable } from './resizable'
import { TabBar, TabBarType } from './tab-bar'
import { Octicon } from './octicons'
import * as octicons from './octicons/octicons.generated'
import {
  IRepositoryState,
  RepositorySectionTab,
  ChangesSelectionKind,
  IConstrainedValue,
  CommitOptions,
  FoldoutType,
} from '../lib/app-state'
import { PreferencesTab } from '../models/preferences'
import { Dispatcher } from './dispatcher'
import {
  getGitHubIssuesAvailability,
  GitHubIssuesStore,
  IssuesStore,
  GitHubUserStore,
} from '../lib/stores'
import { assertNever } from '../lib/fatal-error'
import { Account } from '../models/account'
import { FocusContainer } from './lib/focus-container'
import { ImageDiffType } from '../models/diff'
import { IMenu } from '../models/app-menu'
import { StashDiffViewer } from './stashing'
import { StashedChangesLoadStates } from '../models/stash-entry'
import { TutorialPanel, TutorialWelcome, TutorialDone } from './tutorial'
import { TutorialStep, isValidTutorialStep } from '../models/tutorial-step'
import { openFile } from './lib/open-file'
import { AheadBehindStore } from '../lib/stores/ahead-behind-store'
import { dragAndDropManager } from '../lib/drag-and-drop-manager'
import { DragType } from '../models/drag-drop'
import { PullRequestSuggestedNextAction } from '../models/pull-request'
import { clamp } from '../lib/clamp'
import { Emoji } from '../lib/emoji'
import { PopupType } from '../models/popup'
import {
  accountSupportsActions,
  ActionsStore,
} from '../lib/stores/actions-store'
import { ActionsView } from './actions'
import {
  getGitHubReleasesAvailability,
  GitHubReleasesStore,
} from '../lib/stores/github-releases-store'
import { GitHubReleasesView } from './github-releases'
import { GitHubIssuesView } from './github-issues'
import { GitHubAPIExplorer } from './github-api-explorer'
import { RepositoryTools } from './repository-tools'
import { RepositoryProviderTriage } from './repository-tools/provider-triage'
import { RepositorySettingsTab } from './repository-settings/repository-settings'
import {
  getRepositorySections,
  getRepositorySectionVisualIndex,
} from './repository-sections'
import { getAccountForRepository } from '../lib/get-account-for-repository'
import { AccountSwitcher } from './account-switcher/account-switcher'
import {
  isGitHubAPITabHidden,
  setGitHubAPITabHidden,
} from '../lib/github-api-tab-visibility'
import { MaterialSymbol } from './lib/material-symbol'

interface IRepositoryViewProps {
  readonly repository: Repository
  readonly state: IRepositoryState
  readonly dispatcher: Dispatcher
  readonly emoji: Map<string, Emoji>
  readonly sidebarWidth: IConstrainedValue
  readonly commitSummaryWidth: IConstrainedValue
  readonly stashedFilesWidth: IConstrainedValue
  readonly issuesStore: IssuesStore
  readonly gitHubUserStore: GitHubUserStore
  readonly onViewCommitOnGitHub: (SHA: string, filePath?: string) => void
  readonly imageDiffType: ImageDiffType
  readonly hideWhitespaceInChangesDiff: boolean
  readonly hideWhitespaceInHistoryDiff: boolean
  readonly showSideBySideDiff: boolean
  readonly showDiffCheckMarks: boolean
  readonly preferAbsoluteDates: boolean
  readonly askForConfirmationOnDiscardChanges: boolean
  readonly askForConfirmationOnCommitFilteredChanges: boolean
  readonly askForConfirmationOnDiscardStash: boolean
  readonly askForConfirmationOnCheckoutCommit: boolean
  readonly focusCommitMessage: boolean
  readonly commitSpellcheckEnabled: boolean
  readonly showCommitLengthWarning: boolean
  readonly accounts: ReadonlyArray<Account>
  readonly shouldShowGenerateCommitMessageCallOut: boolean

  /**
   * A value indicating whether or not the application is currently presenting
   * a modal dialog such as the preferences, or an error dialog
   */
  readonly isShowingModal: boolean

  /**
   * A value indicating whether or not the application is currently presenting
   * a foldout dialog such as the file menu, or the branches dropdown
   */
  readonly isShowingFoldout: boolean

  /**
   * Whether or not the user has a configured (explicitly,
   * or automatically) external editor. Used to
   * determine whether or not to render the action for
   * opening the repository in an external editor.
   */
  readonly isExternalEditorAvailable: boolean

  /** The name of the currently selected external editor */
  readonly externalEditorLabel?: string

  /** A cached entry representing an external editor found on the user's machine */
  readonly resolvedExternalEditor: string | null

  /**
   * Callback to open a selected file using the configured external editor
   *
   * @param fullPath The full path to the file on disk
   */
  readonly onOpenInExternalEditor: (fullPath: string) => void

  /**
   * The top-level application menu item.
   */
  readonly appMenu: IMenu | undefined

  readonly currentTutorialStep: TutorialStep

  readonly onExitTutorial: () => void
  readonly aheadBehindStore: AheadBehindStore
  readonly onCherryPick: (
    repository: Repository,
    commits: ReadonlyArray<CommitOneLine>
  ) => void

  /** The user's preference of pull request suggested next action to use **/
  readonly pullRequestSuggestedNextAction?: PullRequestSuggestedNextAction

  /** Whether or not to show the changes filter */
  readonly showChangesFilter: boolean

  /**
   * Whether or not to skip blocking commit hooks when creating commits
   * by means of passing the `--no-verify` flag to git commit
   */
  readonly skipCommitHooks: boolean

  /**
   * Whether or not to add a `Signed-off-by` trailer to commit messages
   * by means of passing the `--signoff` flag to git commit
   */
  readonly signOffCommits: boolean

  /**
   * Whether or not to allow creating a commit without any file changes
   * by means of passing the `--allow-empty` flag to git commit.
   * This option resets to false after each commit.
   */
  readonly allowEmptyCommit: boolean

  /** Callback to set commit options for the given repository */
  readonly onUpdateCommitOptions: (
    repository: Repository,
    options: Partial<CommitOptions>
  ) => void
  readonly actionsStore: ActionsStore
  readonly releasesStore: GitHubReleasesStore
  readonly issueWorkflowsStore: GitHubIssuesStore
}

interface IRepositoryViewState {
  readonly changesListScrollTop: number
  readonly compareListScrollTop: number

  /** Whether the floating account-switcher menu is open */
  readonly isAccountSwitcherOpen: boolean

  /**
   * How many submodules the repository declares (cloned or not), or null
   * while unknown. Gates the tools hub's submodule manager entry.
   */
  readonly submoduleCount: number | null

  /**
   * How many subtrees the repository history records, or null while unknown.
   * Gates the tools hub's subtree manager entry.
   */
  readonly subtreeCount: number | null
  readonly isGitHubAPIHidden: boolean
}

export class RepositoryView extends React.Component<
  IRepositoryViewProps,
  IRepositoryViewState
> {
  private previousSection: RepositorySectionTab =
    this.props.state.selectedSection

  // Flag to force the app to use the scroll position in the state the next time
  // the Compare list is rendered.
  private forceCompareListScrollTop: boolean = false

  private readonly changesSidebarRef = React.createRef<ChangesSidebar>()
  private readonly compareSidebarRef = React.createRef<CompareSidebar>()
  private readonly railAvatarButtonRef = React.createRef<HTMLButtonElement>()

  private focusHistoryNeeded: boolean = false
  private focusChangesNeeded: boolean = false
  private repositoryViewUnmounted = false

  public constructor(props: IRepositoryViewProps) {
    super(props)

    this.state = {
      changesListScrollTop: 0,
      compareListScrollTop: 0,
      isAccountSwitcherOpen: false,
      submoduleCount: null,
      subtreeCount: null,
      isGitHubAPIHidden: isGitHubAPITabHidden(props.repository.hash),
    }
  }

  private loadSubmoduleCount = async () => {
    const repository = this.props.repository
    try {
      const submodules = await this.props.dispatcher.getSubmodules(repository)
      if (
        !this.repositoryViewUnmounted &&
        this.props.repository.hash === repository.hash
      ) {
        this.setState({ submoduleCount: submodules.length })
      }
    } catch {
      if (
        !this.repositoryViewUnmounted &&
        this.props.repository.hash === repository.hash
      ) {
        this.setState({ submoduleCount: null })
      }
    }
  }

  private onOpenSubmoduleManager = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.SubmoduleManager,
      repository: this.props.repository,
    })
  }

  private loadSubtreeCount = async () => {
    const repository = this.props.repository
    try {
      const subtrees = await this.props.dispatcher.getSubtrees(repository)
      if (
        !this.repositoryViewUnmounted &&
        this.props.repository.hash === repository.hash
      ) {
        this.setState({ subtreeCount: subtrees.length })
      }
    } catch {
      if (
        !this.repositoryViewUnmounted &&
        this.props.repository.hash === repository.hash
      ) {
        this.setState({ subtreeCount: null })
      }
    }
  }

  private onOpenSubtreeManager = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.SubtreeManager,
      repository: this.props.repository,
    })
  }

  private supportsGitHubActions() {
    return (
      this.props.repository.gitHubRepository !== null &&
      accountSupportsActions(this.props.repository, this.props.accounts)
    )
  }

  private showsGitHubReleases() {
    const availability = getGitHubReleasesAvailability(
      this.props.repository,
      this.props.accounts
    )
    return availability !== 'not-github'
  }

  private showsGitHubIssues() {
    return (
      getGitHubIssuesAvailability(
        this.props.repository,
        this.props.accounts
      ) !== 'not-github'
    )
  }

  private canUseGitHubAPI() {
    if (this.props.repository.gitHubRepository === null) {
      return false
    }
    const account = getAccountForRepository(
      this.props.accounts,
      this.props.repository
    )
    return account === null || account.provider === 'github'
  }

  private showsGitHubAPI() {
    return this.canUseGitHubAPI() && !this.state.isGitHubAPIHidden
  }

  private getVisibleRepositorySections() {
    return getRepositorySections(
      this.supportsGitHubActions(),
      this.showsGitHubReleases(),
      this.showsGitHubIssues(),
      this.showsGitHubAPI()
    )
  }

  private readonly refreshRepository = () =>
    this.props.dispatcher.refreshRepository(this.props.repository)

  private getSelectedSection() {
    const section = this.props.state.selectedSection
    if (
      (section === RepositorySectionTab.Actions &&
        !this.supportsGitHubActions()) ||
      (section === RepositorySectionTab.Releases &&
        !this.showsGitHubReleases()) ||
      (section === RepositorySectionTab.Issues && !this.showsGitHubIssues()) ||
      (section === RepositorySectionTab.GitHubAPI && !this.showsGitHubAPI())
    ) {
      return RepositorySectionTab.Changes
    }
    return section
  }

  private onHideGitHubAPI = () => {
    setGitHubAPITabHidden(this.props.repository.hash, true)
    this.setState({ isGitHubAPIHidden: true }, () => {
      if (this.props.state.selectedSection === RepositorySectionTab.GitHubAPI) {
        this.props.dispatcher.changeRepositorySection(
          this.props.repository,
          RepositorySectionTab.RepositoryTools
        )
      }
    })
  }

  private onShowGitHubAPI = () => {
    setGitHubAPITabHidden(this.props.repository.hash, false)
    this.setState({ isGitHubAPIHidden: false }, () => {
      this.props.dispatcher.changeRepositorySection(
        this.props.repository,
        RepositorySectionTab.GitHubAPI
      )
    })
  }

  public setFocusHistoryNeeded(): void {
    this.focusHistoryNeeded = true
  }

  public setFocusChangesNeeded(): void {
    this.focusChangesNeeded = true
  }

  public scrollCompareListToTop(): void {
    this.forceCompareListScrollTop = true

    this.setState({
      compareListScrollTop: 0,
    })
  }

  private onChangesListScrolled = (scrollTop: number) => {
    this.setState({ changesListScrollTop: scrollTop })
  }

  private onCompareListScrolled = (scrollTop: number) => {
    this.setState({ compareListScrollTop: scrollTop })
  }

  private renderChangesBadge(): JSX.Element | null {
    const filesChangedCount =
      this.props.state.changesState.workingDirectory.files.length

    if (filesChangedCount <= 0) {
      return null
    }

    return <FilesChangedBadge filesChangedCount={filesChangedCount} />
  }

  private renderTabs(): JSX.Element {
    const selectedSection = this.getSelectedSection()
    const selectedTab = getRepositorySectionVisualIndex(
      selectedSection,
      this.supportsGitHubActions(),
      this.showsGitHubReleases(),
      this.showsGitHubIssues(),
      this.showsGitHubAPI()
    )

    return (
      <TabBar
        selectedIndex={selectedTab}
        onTabClicked={this.onTabClicked}
        type={TabBarType.Vertical}
      >
        <span className="rail-item" id="changes-tab">
          <span className="rail-pill">
            <span className="rail-icon">
              <MaterialSymbol
                name="difference"
                size={22}
                fill={selectedSection === RepositorySectionTab.Changes ? 1 : 0}
              />
            </span>
            {this.renderChangesBadge()}
          </span>
          <span className="rail-label">Changes</span>
        </span>

        <span className="rail-item" id="history-tab">
          <span className="rail-pill">
            <span className="rail-icon">
              <MaterialSymbol
                name="history"
                size={22}
                fill={selectedSection === RepositorySectionTab.History ? 1 : 0}
              />
            </span>
          </span>
          <span className="rail-label">History</span>
        </span>
        {this.supportsGitHubActions() && (
          <span className="rail-item" id="actions-tab" data-dm-feature={true}>
            <span className="rail-pill">
              <span className="rail-icon">
                <MaterialSymbol
                  name="rocket_launch"
                  size={22}
                  fill={
                    selectedSection === RepositorySectionTab.Actions ? 1 : 0
                  }
                />
              </span>
            </span>
            <span className="rail-label">Actions</span>
          </span>
        )}
        {this.showsGitHubReleases() && (
          <span className="rail-item" id="releases-tab" data-dm-feature={true}>
            <span className="rail-pill">
              <Octicon symbol={octicons.tag} className="rail-icon" />
            </span>
            <span className="rail-label">Releases</span>
          </span>
        )}
        {this.showsGitHubIssues() && (
          <span className="rail-item" id="issues-tab" data-dm-feature={true}>
            <span className="rail-pill">
              <Octicon symbol={octicons.issueOpened} className="rail-icon" />
            </span>
            <span className="rail-label">Issues</span>
          </span>
        )}
        {this.showsGitHubAPI() && (
          <span
            className="rail-item"
            id="github-api-tab"
            data-dm-feature={true}
          >
            <span className="rail-pill">
              <Octicon symbol={octicons.codeSquare} className="rail-icon" />
            </span>
            <span className="rail-label">API</span>
          </span>
        )}
        <span className="rail-item" id="triage-tab" data-dm-feature={true}>
          <span className="rail-pill">
            <Octicon symbol={octicons.checklist} className="rail-icon" />
          </span>
          <span className="rail-label">Triage</span>
        </span>
        <span
          className="rail-item"
          id="repository-tools-tab"
          data-dm-feature={true}
        >
          <span className="rail-pill">
            <Octicon symbol={octicons.tools} className="rail-icon" />
          </span>
          <span className="rail-label">Tools</span>
        </span>
      </TabBar>
    )
  }

  private onShowBranches = () => {
    this.props.dispatcher.showFoldout({ type: FoldoutType.Branch })
  }

  private onShowHistoryList = () => {
    this.props.dispatcher.changeCommitSelection(this.props.repository, [], true)
  }

  private onShowChangesList = () => {
    this.props.dispatcher.selectWorkingDirectoryFiles(this.props.repository, [])
  }

  private onShowPreferences = () => {
    this.props.dispatcher.showPopup({ type: PopupType.Preferences })
  }

  private onShowAccounts = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.Preferences,
      initialSelectedTab: PreferencesTab.Accounts,
    })
  }

  private onToggleAccountSwitcher = () => {
    this.setState(state => ({
      isAccountSwitcherOpen: !state.isAccountSwitcherOpen,
    }))
  }

  /** Rail switcher selection actually switches the active identity. */
  private onSwitchAccount = (account: Account) => {
    this.props.dispatcher.promoteAccount(account)
    this.onCloseAccountSwitcher()
  }

  private onCloseAccountSwitcher = () => {
    this.setState({ isAccountSwitcherOpen: false })
    this.railAvatarButtonRef.current?.focus()
  }

  private onAddAccount = () => {
    this.props.dispatcher.showDotComSignInDialog()
  }

  private onShowRepositoryAccount = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.RepositorySettings,
      repository: this.props.repository,
      initialSelectedTab: RepositorySettingsTab.Remote,
    })
  }

  private onAssociateProviderTriageAccount = (
    repository: Repository,
    accountKey: string
  ) => this.props.dispatcher.updateRepositoryAccount(repository, accountKey)

  private renderAvatarContent(): JSX.Element | string {
    const account = this.props.accounts[0]

    if (account === undefined) {
      return <Octicon symbol={octicons.person} className="rail-icon" />
    }

    const source = (account.name || account.login).trim()
    const parts = source.split(/\s+/).filter(part => part.length > 0)
    const initials =
      parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2)

    return initials.toUpperCase()
  }

  private renderRail(): JSX.Element {
    const selectedSection = this.getSelectedSection()
    const changesSelection = this.props.state.changesState.selection
    const showCompactChangesList =
      selectedSection === RepositorySectionTab.Changes &&
      changesSelection.kind === ChangesSelectionKind.WorkingDirectory &&
      changesSelection.selectedFileIDs.length === 1
    const showCompactHistoryList =
      selectedSection === RepositorySectionTab.History &&
      this.props.state.commitSelection.shas.length > 0

    return (
      <nav className="repository-rail" aria-label="Repository navigation">
        {this.renderTabs()}
        {showCompactChangesList && (
          <button
            type="button"
            className="rail-nav-button compact-changes-list-button"
            onClick={this.onShowChangesList}
            aria-label="Show changed files"
          >
            <span className="rail-pill">
              <Octicon symbol={octicons.listUnordered} className="rail-icon" />
            </span>
            <span className="rail-label">Changed files</span>
          </button>
        )}
        {showCompactHistoryList && (
          <button
            type="button"
            className="rail-nav-button compact-history-list-button"
            onClick={this.onShowHistoryList}
            aria-label="Show commit list"
          >
            <span className="rail-pill">
              <Octicon symbol={octicons.listUnordered} className="rail-icon" />
            </span>
            <span className="rail-label">Commit list</span>
          </button>
        )}
        <button
          type="button"
          className="rail-nav-button"
          onClick={this.onShowBranches}
          aria-label="Branches"
        >
          <span className="rail-pill">
            <span className="rail-icon">
              <MaterialSymbol name="alt_route" size={22} />
            </span>
          </span>
          <span className="rail-label">Branches</span>
        </button>
        <div className="rail-spacer" />
        <button
          type="button"
          className="rail-icon-button rail-settings"
          onClick={this.onShowPreferences}
          aria-label="Settings"
        >
          <span className="rail-icon">
            <MaterialSymbol name="settings" size={22} />
          </span>
        </button>
        <button
          type="button"
          className="rail-icon-button rail-avatar"
          onClick={this.onToggleAccountSwitcher}
          aria-label="Switch account"
          aria-haspopup="dialog"
          aria-expanded={this.state.isAccountSwitcherOpen}
          ref={this.railAvatarButtonRef}
        >
          {this.renderAvatarContent()}
        </button>
      </nav>
    )
  }

  private renderAccountSwitcher(): JSX.Element | null {
    if (!this.state.isAccountSwitcherOpen) {
      return null
    }

    return (
      <AccountSwitcher
        accounts={this.props.accounts}
        selectedAccount={this.props.accounts[0] ?? null}
        anchorRef={this.railAvatarButtonRef}
        onClose={this.onCloseAccountSwitcher}
        onSelectAccount={this.onSwitchAccount}
        onAddAccount={this.onAddAccount}
      />
    )
  }

  private onShowCommitProgress = () => {
    if (!this.props.state.subscribeToCommitOutput) {
      return
    }

    this.props.dispatcher.showPopup({
      type: PopupType.CommitProgress,
      subscribeToCommitOutput: this.props.state.subscribeToCommitOutput,
    })
  }

  private renderChangesSidebar(): JSX.Element {
    const tip = this.props.state.branchesState.tip

    let branchName: string | null = null

    if (tip.kind === TipState.Valid) {
      branchName = tip.branch.name
    } else if (tip.kind === TipState.Unborn) {
      branchName = tip.ref
    }

    const localCommitSHAs = this.props.state.localCommitSHAs
    const mostRecentLocalCommitSHA =
      localCommitSHAs.length > 0 ? localCommitSHAs[0] : null
    const mostRecentLocalCommit =
      (mostRecentLocalCommitSHA
        ? this.props.state.commitLookup.get(mostRecentLocalCommitSHA)
        : null) || null

    // -1 Because of right hand side border
    const availableWidth = clamp(this.props.sidebarWidth) - 1

    const scrollTop =
      this.previousSection === RepositorySectionTab.History
        ? this.state.changesListScrollTop
        : undefined
    this.previousSection = RepositorySectionTab.Changes

    return (
      <ChangesSidebar
        ref={this.changesSidebarRef}
        repository={this.props.repository}
        dispatcher={this.props.dispatcher}
        changes={this.props.state.changesState}
        aheadBehind={this.props.state.aheadBehind}
        branch={branchName}
        commitAuthor={this.props.state.commitAuthor}
        emoji={this.props.emoji}
        mostRecentLocalCommit={mostRecentLocalCommit}
        issuesStore={this.props.issuesStore}
        availableWidth={availableWidth}
        gitHubUserStore={this.props.gitHubUserStore}
        isCommitting={this.props.state.isCommitting}
        commitOperationPhase={this.props.state.commitOperationPhase}
        hookProgress={this.props.state.hookProgress}
        onShowCommitProgress={
          this.props.state.subscribeToCommitOutput
            ? this.onShowCommitProgress
            : undefined
        }
        isGeneratingCommitMessage={this.props.state.isGeneratingCommitMessage}
        shouldShowGenerateCommitMessageCallOut={
          this.props.shouldShowGenerateCommitMessageCallOut
        }
        commitToAmend={this.props.state.commitToAmend}
        isPushPullFetchInProgress={this.props.state.isPushPullFetchInProgress}
        focusCommitMessage={this.props.focusCommitMessage}
        askForConfirmationOnDiscardChanges={
          this.props.askForConfirmationOnDiscardChanges
        }
        askForConfirmationOnCommitFilteredChanges={
          this.props.askForConfirmationOnCommitFilteredChanges
        }
        accounts={this.props.accounts}
        isShowingModal={this.props.isShowingModal}
        isShowingFoldout={this.props.isShowingFoldout}
        externalEditorLabel={this.props.externalEditorLabel}
        onOpenInExternalEditor={this.props.onOpenInExternalEditor}
        onChangesListScrolled={this.onChangesListScrolled}
        changesListScrollTop={scrollTop}
        shouldNudgeToCommit={
          this.props.currentTutorialStep === TutorialStep.MakeCommit
        }
        commitSpellcheckEnabled={this.props.commitSpellcheckEnabled}
        showCommitLengthWarning={this.props.showCommitLengthWarning}
        showChangesFilter={this.props.showChangesFilter}
        skipCommitHooks={this.props.skipCommitHooks}
        signOffCommits={this.props.signOffCommits}
        allowEmptyCommit={this.props.allowEmptyCommit}
        onUpdateCommitOptions={this.props.onUpdateCommitOptions}
      />
    )
  }

  private renderCompareSidebar(): JSX.Element {
    const { repository, dispatcher, state, aheadBehindStore, emoji } =
      this.props
    const {
      remote,
      compareState,
      branchesState,
      commitSelection: { shas },
      commitLookup,
      localCommitSHAs,
      localTags,
      tagsToPush,
      multiCommitOperationState: mcos,
    } = state
    const { tip } = branchesState
    const currentBranch = tip.kind === TipState.Valid ? tip.branch : null
    const scrollTop =
      this.forceCompareListScrollTop ||
      this.previousSection === RepositorySectionTab.Changes
        ? this.state.compareListScrollTop
        : undefined
    this.previousSection = RepositorySectionTab.History
    this.forceCompareListScrollTop = false

    return (
      <CompareSidebar
        ref={this.compareSidebarRef}
        repository={repository}
        isLocalRepository={remote === null}
        compareState={compareState}
        selectedCommitShas={shas}
        shasToHighlight={compareState.shasToHighlight}
        currentBranch={currentBranch}
        emoji={emoji}
        commitLookup={commitLookup}
        localCommitSHAs={localCommitSHAs}
        localTags={localTags}
        dispatcher={dispatcher}
        onRevertCommit={this.onRevertCommit}
        onAmendCommit={this.onAmendCommit}
        onViewCommitOnGitHub={this.props.onViewCommitOnGitHub}
        onCompareListScrolled={this.onCompareListScrolled}
        onCherryPick={this.props.onCherryPick}
        compareListScrollTop={scrollTop}
        tagsToPush={tagsToPush}
        aheadBehindStore={aheadBehindStore}
        isMultiCommitOperationInProgress={mcos !== null}
        askForConfirmationOnCheckoutCommit={
          this.props.askForConfirmationOnCheckoutCommit
        }
        accounts={this.props.accounts}
        preferAbsoluteDates={this.props.preferAbsoluteDates}
      />
    )
  }

  private renderSidebarContents(): JSX.Element | null {
    const selectedSection = this.getSelectedSection()

    if (selectedSection === RepositorySectionTab.Changes) {
      return this.renderChangesSidebar()
    } else if (selectedSection === RepositorySectionTab.History) {
      return this.renderCompareSidebar()
    } else if (
      selectedSection === RepositorySectionTab.Actions ||
      selectedSection === RepositorySectionTab.Releases ||
      selectedSection === RepositorySectionTab.Issues ||
      selectedSection === RepositorySectionTab.GitHubAPI ||
      selectedSection === RepositorySectionTab.Triage ||
      selectedSection === RepositorySectionTab.RepositoryTools
    ) {
      return null
    } else {
      return assertNever(selectedSection, 'Unknown repository section')
    }
  }

  private handleSidebarWidthReset = () => {
    this.props.dispatcher.resetSidebarWidth()
  }

  private handleSidebarResize = (width: number) => {
    this.props.dispatcher.setSidebarWidth(width)
  }

  private renderSidebar(): JSX.Element {
    const selectedSection = this.getSelectedSection()
    if (
      selectedSection === RepositorySectionTab.Actions ||
      selectedSection === RepositorySectionTab.Releases ||
      selectedSection === RepositorySectionTab.Issues ||
      selectedSection === RepositorySectionTab.GitHubAPI ||
      selectedSection === RepositorySectionTab.Triage ||
      selectedSection === RepositorySectionTab.RepositoryTools
    ) {
      return <React.Fragment />
    }
    return (
      <FocusContainer onFocusWithinChanged={this.onSidebarFocusWithinChanged}>
        <Resizable
          id="repository-sidebar"
          width={this.props.sidebarWidth.value}
          maximumWidth={this.props.sidebarWidth.max}
          minimumWidth={this.props.sidebarWidth.min}
          onReset={this.handleSidebarWidthReset}
          onResize={this.handleSidebarResize}
          description="Repository sidebar"
        >
          {this.renderSidebarContents()}
        </Resizable>
      </FocusContainer>
    )
  }

  private onSidebarFocusWithinChanged = (sidebarHasFocusWithin: boolean) => {
    if (
      sidebarHasFocusWithin === false &&
      this.props.state.selectedSection === RepositorySectionTab.History
    ) {
      this.props.dispatcher.updateCompareForm(this.props.repository, {
        showBranchList: false,
      })
    }
  }

  private renderStashedChangesContent(): JSX.Element | null {
    const { changesState } = this.props.state
    const { selection } = changesState

    if (
      selection.kind !== ChangesSelectionKind.Stash ||
      selection.selectedStashEntry === null
    ) {
      return null
    }
    const stashEntry = selection.selectedStashEntry

    if (stashEntry.files.kind === StashedChangesLoadStates.Loaded) {
      return (
        <StashDiffViewer
          stashEntry={stashEntry}
          selectedStashedFile={selection.selectedStashedFile}
          stashedFileDiff={selection.selectedStashedFileDiff}
          imageDiffType={this.props.imageDiffType}
          fileListWidth={this.props.stashedFilesWidth}
          repository={this.props.repository}
          dispatcher={this.props.dispatcher}
          askForConfirmationOnDiscardStash={
            this.props.askForConfirmationOnDiscardStash
          }
          showSideBySideDiff={this.props.showSideBySideDiff}
          onOpenBinaryFile={this.onOpenBinaryFile}
          onOpenSubmodule={this.onOpenSubmodule}
          onChangeImageDiffType={this.onChangeImageDiffType}
          onHideWhitespaceInDiffChanged={this.onHideWhitespaceInDiffChanged}
          onOpenInExternalEditor={this.props.onOpenInExternalEditor}
        />
      )
    }

    return null
  }

  private onHideWhitespaceInDiffChanged = (hideWhitespaceInDiff: boolean) => {
    return this.props.dispatcher.onHideWhitespaceInChangesDiffChanged(
      hideWhitespaceInDiff,
      this.props.repository
    )
  }

  private renderContentForHistory(): JSX.Element {
    const { commitSelection, commitLookup, localCommitSHAs } = this.props.state
    const { changesetData, file, diff, shas, shasInDiff, isContiguous } =
      commitSelection

    const selectedCommits = []
    for (const sha of shas) {
      const commit = commitLookup.get(sha)
      if (commit !== undefined) {
        selectedCommits.push(commit)
      }
    }

    const showDragOverlay = dragAndDropManager.isDragOfTypeInProgress(
      DragType.Commit
    )

    return (
      <SelectedCommits
        repository={this.props.repository}
        dispatcher={this.props.dispatcher}
        selectedCommits={selectedCommits}
        shasInDiff={shasInDiff}
        isContiguous={isContiguous}
        localCommitSHAs={localCommitSHAs}
        changesetData={changesetData}
        selectedFile={file}
        currentDiff={diff}
        emoji={this.props.emoji}
        commitSummaryWidth={this.props.commitSummaryWidth}
        selectedDiffType={this.props.imageDiffType}
        externalEditorLabel={this.props.externalEditorLabel}
        onOpenInExternalEditor={this.props.onOpenInExternalEditor}
        onViewCommitOnGitHub={this.props.onViewCommitOnGitHub}
        hideWhitespaceInDiff={this.props.hideWhitespaceInHistoryDiff}
        showSideBySideDiff={this.props.showSideBySideDiff}
        onOpenBinaryFile={this.onOpenBinaryFile}
        onOpenSubmodule={this.onOpenSubmodule}
        onChangeImageDiffType={this.onChangeImageDiffType}
        onDiffOptionsOpened={this.onDiffOptionsOpened}
        showDragOverlay={showDragOverlay}
        accounts={this.props.accounts}
      />
    )
  }

  private onDiffOptionsOpened = () => {
    this.props.dispatcher.incrementMetric('diffOptionsViewedCount')
  }

  private onTutorialCompletionAnnounced = () => {
    this.props.dispatcher.markTutorialCompletionAsAnnounced(
      this.props.repository
    )
  }

  private renderTutorialPane(): JSX.Element {
    if (
      [TutorialStep.AllDone, TutorialStep.Announced].includes(
        this.props.currentTutorialStep
      )
    ) {
      return (
        <TutorialDone
          dispatcher={this.props.dispatcher}
          repository={this.props.repository}
          tutorialCompletionAnnounced={
            this.props.currentTutorialStep === TutorialStep.Announced
          }
          onTutorialCompletionAnnounced={this.onTutorialCompletionAnnounced}
        />
      )
    } else {
      return <TutorialWelcome />
    }
  }

  private renderContentForChanges(): JSX.Element | null {
    const { changesState } = this.props.state
    const { workingDirectory, selection } = changesState

    const tip = this.props.state.branchesState.tip
    const branchName =
      tip.kind === TipState.Valid
        ? tip.branch.name
        : tip.kind === TipState.Unborn
        ? tip.ref
        : undefined

    if (selection.kind === ChangesSelectionKind.Stash) {
      return this.renderStashedChangesContent()
    }

    const { selectedFileIDs, diff } = selection

    if (selectedFileIDs.length > 1) {
      return <MultipleSelection count={selectedFileIDs.length} />
    }

    if (workingDirectory.files.length === 0) {
      if (this.props.currentTutorialStep !== TutorialStep.NotApplicable) {
        return this.renderTutorialPane()
      } else {
        return (
          <NoChanges
            key={this.props.repository.id}
            appMenu={this.props.appMenu}
            repository={this.props.repository}
            repositoryState={this.props.state}
            isExternalEditorAvailable={this.props.isExternalEditorAvailable}
            dispatcher={this.props.dispatcher}
            pullRequestSuggestedNextAction={
              this.props.pullRequestSuggestedNextAction
            }
          />
        )
      }
    } else {
      if (selectedFileIDs.length === 0) {
        return null
      }

      const selectedFile = workingDirectory.findFileWithID(selectedFileIDs[0])

      if (selectedFile === null) {
        return null
      }

      return (
        <Changes
          repository={this.props.repository}
          dispatcher={this.props.dispatcher}
          file={selectedFile}
          diff={diff}
          isCommitting={this.props.state.isCommitting}
          imageDiffType={this.props.imageDiffType}
          hideWhitespaceInDiff={this.props.hideWhitespaceInChangesDiff}
          showSideBySideDiff={this.props.showSideBySideDiff}
          showDiffCheckMarks={this.props.showDiffCheckMarks}
          onOpenBinaryFile={this.onOpenBinaryFile}
          onOpenSubmodule={this.onOpenSubmodule}
          onChangeImageDiffType={this.onChangeImageDiffType}
          askForConfirmationOnDiscardChanges={
            this.props.askForConfirmationOnDiscardChanges
          }
          onDiffOptionsOpened={this.onDiffOptionsOpened}
          branchName={branchName}
          externalEditorLabel={this.props.externalEditorLabel}
          isExternalEditorAvailable={this.props.isExternalEditorAvailable}
          onOpenInExternalEditor={this.props.onOpenInExternalEditor}
        />
      )
    }
  }

  private onOpenBinaryFile = (fullPath: string) => {
    openFile(fullPath, this.props.dispatcher)
  }

  private onOpenSubmodule = (fullPath: string) => {
    this.props.dispatcher.incrementMetric('openSubmoduleFromDiffCount')
    this.props.dispatcher.openOrAddRepository(fullPath)
  }

  private onChangeImageDiffType = (imageDiffType: ImageDiffType) => {
    this.props.dispatcher.changeImageDiffType(imageDiffType)
  }

  private renderContent(): JSX.Element | null {
    const selectedSection = this.getSelectedSection()
    if (selectedSection === RepositorySectionTab.Changes) {
      return this.renderContentForChanges()
    } else if (selectedSection === RepositorySectionTab.History) {
      return this.renderContentForHistory()
    } else if (selectedSection === RepositorySectionTab.Actions) {
      const tip = this.props.state.branchesState.tip
      const currentBranch = tip.kind === TipState.Valid ? tip.branch.name : null
      const branches = [
        ...(currentBranch === null ? [] : [currentBranch]),
        ...this.props.state.branchesState.allBranches.map(
          branch => branch.name
        ),
      ].filter((branch, index, all) => all.indexOf(branch) === index)
      return (
        <ActionsView
          repository={this.props.repository}
          currentBranch={currentBranch}
          branchNames={branches}
          actionsStore={this.props.actionsStore}
        />
      )
    } else if (selectedSection === RepositorySectionTab.Releases) {
      return (
        <GitHubReleasesView
          repository={this.props.repository}
          accounts={this.props.accounts}
          releasesStore={this.props.releasesStore}
        />
      )
    } else if (selectedSection === RepositorySectionTab.Issues) {
      return (
        <GitHubIssuesView
          repository={this.props.repository}
          accounts={this.props.accounts}
          issuesStore={this.props.issueWorkflowsStore}
          dispatcher={this.props.dispatcher}
        />
      )
    } else if (selectedSection === RepositorySectionTab.GitHubAPI) {
      return (
        <GitHubAPIExplorer
          repository={this.props.repository}
          accounts={this.props.accounts}
          functionRegistry={this.props.dispatcher}
          surface="functions"
          autoCreateFunctions={true}
          onHide={this.onHideGitHubAPI}
        />
      )
    } else if (selectedSection === RepositorySectionTab.Triage) {
      return (
        <RepositoryProviderTriage
          repository={this.props.repository}
          accounts={this.props.accounts}
          onAssociateAccount={this.onAssociateProviderTriageAccount}
          onSignIn={this.onShowAccounts}
          onManageAccounts={this.onShowAccounts}
          onChooseRepositoryAccount={this.onShowRepositoryAccount}
          onReauthenticateAccount={this.onShowAccounts}
        />
      )
    } else if (selectedSection === RepositorySectionTab.RepositoryTools) {
      return (
        <RepositoryTools
          repository={this.props.repository}
          repositoryPath={this.props.repository.path}
          onRefreshRepository={this.refreshRepository}
          submoduleCount={this.state.submoduleCount}
          onOpenSubmoduleManager={this.onOpenSubmoduleManager}
          subtreeCount={this.state.subtreeCount}
          onOpenSubtreeManager={this.onOpenSubtreeManager}
          tagLifecycleDispatcher={this.props.dispatcher}
          githubProjects={{
            repository: this.props.repository,
            accounts: this.props.accounts,
          }}
          githubAPIFunctions={
            this.canUseGitHubAPI()
              ? {
                  repository: this.props.repository,
                  accounts: this.props.accounts,
                  functionRegistry: this.props.dispatcher,
                  autoCreateFunctions: true,
                  onShowAPI: this.onShowGitHubAPI,
                }
              : undefined
          }
          cheapLfs={{
            repository: this.props.repository,
            accounts: this.props.accounts,
            dispatcher: this.props.dispatcher,
            available: this.showsGitHubReleases(),
          }}
        />
      )
    } else {
      return assertNever(selectedSection, 'Unknown repository section')
    }
  }

  public render() {
    return (
      <UiView id="repository">
        {this.renderRail()}
        {this.renderAccountSwitcher()}
        {this.renderSidebar()}
        {this.renderContent()}
        {this.maybeRenderTutorialPanel()}
      </UiView>
    )
  }

  private onRevertCommit = (commit: Commit) => {
    this.props.dispatcher.revertCommit(this.props.repository, commit)
  }

  private onAmendCommit = (commit: Commit, isLocalCommit: boolean) => {
    this.props.dispatcher.startAmendingRepository(
      this.props.repository,
      commit,
      isLocalCommit
    )
  }

  public componentDidMount() {
    window.addEventListener('keydown', this.onGlobalKeyDown)
    this.loadSubmoduleCount()
    this.loadSubtreeCount()
  }

  public componentWillUnmount() {
    window.removeEventListener('keydown', this.onGlobalKeyDown)
    this.repositoryViewUnmounted = true
  }

  public componentDidUpdate(prevProps: IRepositoryViewProps): void {
    if (prevProps.repository.hash !== this.props.repository.hash) {
      this.setState({
        submoduleCount: null,
        subtreeCount: null,
        isGitHubAPIHidden: isGitHubAPITabHidden(this.props.repository.hash),
      })
      this.loadSubmoduleCount()
      this.loadSubtreeCount()
    }

    if (this.focusChangesNeeded) {
      this.focusChangesNeeded = false
      this.changesSidebarRef.current?.focus()
    }

    if (this.focusHistoryNeeded) {
      this.focusHistoryNeeded = false
      this.compareSidebarRef.current?.focusHistory()
    }
  }

  private onGlobalKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return
    }

    if (this.props.isShowingModal || this.props.isShowingFoldout) {
      return
    }

    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const requestedIndex = /^[1-9]$/.test(event.key)
        ? Number(event.key) - 1
        : -1
      const shortcut = this.getVisibleRepositorySections()[requestedIndex]
      if (shortcut !== undefined) {
        this.props.dispatcher.changeRepositorySection(
          this.props.repository,
          shortcut
        )
        event.preventDefault()
        return
      }
    }

    // Cycle repository sections on Ctrl+Tab.
    if (event.ctrlKey && event.key === 'Tab') {
      this.changeTab()
      event.preventDefault()
    }
  }

  private changeTab() {
    const sections = this.getVisibleRepositorySections()
    const current = sections.indexOf(this.props.state.selectedSection)
    const section = sections[(current + 1) % sections.length]

    this.props.dispatcher.changeRepositorySection(
      this.props.repository,
      section
    )
  }

  private onTabClicked = (visualIndex: number) => {
    const section = this.getVisibleRepositorySections()[visualIndex]
    if (section === undefined) {
      return
    }

    this.props.dispatcher.changeRepositorySection(
      this.props.repository,
      section
    )
    if (!!section) {
      this.props.dispatcher.updateCompareForm(this.props.repository, {
        showBranchList: false,
      })
    }
  }

  private maybeRenderTutorialPanel(): JSX.Element | null {
    if (isValidTutorialStep(this.props.currentTutorialStep)) {
      return (
        <TutorialPanel
          dispatcher={this.props.dispatcher}
          repository={this.props.repository}
          resolvedExternalEditor={this.props.resolvedExternalEditor}
          currentTutorialStep={this.props.currentTutorialStep}
          onExitTutorial={this.props.onExitTutorial}
        />
      )
    }
    return null
  }
}
