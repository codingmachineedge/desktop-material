import * as React from 'react'

import { Commit, CommitOneLine, ICommitContext } from '../../models/commit'
import {
  HistoryTabMode,
  ICompareState,
  ICompareBranch,
  ComparisonMode,
  IDisplayHistory,
} from '../../lib/app-state'
import { CommitList } from './commit-list'
import { Repository } from '../../models/repository'
import { Branch } from '../../models/branch'
import { defaultErrorHandler, Dispatcher } from '../dispatcher'
import { ThrottledScheduler } from '../lib/throttled-scheduler'
import { BranchList } from '../branches'
import { TextBox } from '../lib/text-box'
import { IBranchListItem } from '../branches/group-branches'
import { TabBar } from '../tab-bar'
import { CompareBranchListItem } from './compare-branch-list-item'
import { FancyTextBox } from '../lib/fancy-text-box'
import * as octicons from '../octicons/octicons.generated'
import { SelectionSource } from '../lib/filter-list'
import { FilterMode, IMatches, matchWithMode } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'
import { Ref } from '../lib/ref'
import { MergeCallToActionWithConflicts } from './merge-call-to-action-with-conflicts'
import { AheadBehindStore } from '../../lib/stores/ahead-behind-store'
import { DragType } from '../../models/drag-drop'
import { PopupType } from '../../models/popup'
import { getUniqueCoauthorsAsAuthors } from '../../lib/unique-coauthors-as-authors'
import { getSquashedCommitDescription } from '../../lib/squash/squashed-commit-description'
import { doMergeCommitsExistAfterCommit } from '../../lib/git'
import { KeyboardInsertionData } from '../lib/list'
import { Account } from '../../models/account'
import { Emoji } from '../../lib/emoji'
import { formatNumber } from '../../lib/format-number'
import { getCommitSearchKeys } from '../../lib/commit-search'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import { getBoolean, setBoolean } from '../../lib/local-storage'

interface ICompareSidebarProps {
  readonly repository: Repository
  readonly isLocalRepository: boolean
  readonly compareState: ICompareState
  readonly emoji: Map<string, Emoji>
  readonly commitLookup: Map<string, Commit>
  readonly localCommitSHAs: ReadonlyArray<string>
  readonly askForConfirmationOnCheckoutCommit: boolean
  readonly dispatcher: Dispatcher
  readonly currentBranch: Branch | null
  readonly selectedCommitShas: ReadonlyArray<string>
  readonly onRevertCommit: (commit: Commit) => void
  readonly onAmendCommit: (commit: Commit, isLocalCommit: boolean) => void
  readonly onViewCommitOnGitHub: (sha: string) => void
  readonly onCompareListScrolled: (scrollTop: number) => void
  readonly onCherryPick: (
    repository: Repository,
    commits: ReadonlyArray<CommitOneLine>
  ) => void
  readonly compareListScrollTop?: number
  readonly localTags: Map<string, string> | null
  readonly tagsToPush: ReadonlyArray<string> | null
  readonly aheadBehindStore: AheadBehindStore
  readonly isMultiCommitOperationInProgress?: boolean
  readonly shasToHighlight: ReadonlyArray<string>
  readonly accounts: ReadonlyArray<Account>
  readonly preferAbsoluteDates: boolean
}
interface ICompareSidebarState {
  /**
   * This branch should only be used when tracking interactions that the user is performing.
   *
   * For all other cases, use the prop
   */
  readonly focusedBranch: Branch | null

  /** Data to be reordered via keyboard */
  readonly keyboardReorderData?: KeyboardInsertionData

  /**
   * Free-text filter applied client-side to the History commit list
   * (matches commit summary / author / SHA). Empty string means no filter.
   */
  readonly commitFilterText: string

  /** The matching strategy used by the History commit filter. */
  readonly commitFilterMode: FilterMode

  /** Whether the History commit filter matches case-sensitively. */
  readonly commitFilterCaseSensitive: boolean

  /** Whether the ancestry graph is visible beside commit rows. */
  readonly showCommitGraph: boolean
}

/** localStorage key used to persist the History commit filter mode. */
const CommitFilterListId = 'history-commits'
const ShowCommitGraphKey = 'history-show-commit-graph'

/** If we're within this many rows from the bottom, load the next history batch. */
const CloseToBottomThreshold = 10

export class CompareSidebar extends React.Component<
  ICompareSidebarProps,
  ICompareSidebarState
> {
  private textbox: TextBox | null = null
  private readonly loadChangedFilesScheduler = new ThrottledScheduler(200)
  private branchList: BranchList | null = null
  private commitListRef = React.createRef<CommitList>()
  private loadingMoreCommitsPromise: Promise<void> | null = null
  private loadingSearchCommitsPromise: Promise<void> | null = null
  private exhaustedSearchQuery: string | null = null
  private isUnmounted = false
  private resultCount = 0

  public constructor(props: ICompareSidebarProps) {
    super(props)

    this.state = {
      focusedBranch: null,
      commitFilterText: '',
      commitFilterMode: readPersistedFilterMode(CommitFilterListId),
      commitFilterCaseSensitive: false,
      showCommitGraph: getBoolean(ShowCommitGraphKey, true),
    }
  }

  public componentWillReceiveProps(nextProps: ICompareSidebarProps) {
    const newFormState = nextProps.compareState.formState
    const oldFormState = this.props.compareState.formState

    if (
      newFormState.kind !== oldFormState.kind &&
      newFormState.kind === HistoryTabMode.History
    ) {
      this.setState({
        focusedBranch: null,
      })
      return
    }

    if (
      newFormState.kind !== HistoryTabMode.History &&
      oldFormState.kind !== HistoryTabMode.History
    ) {
      const oldBranch = oldFormState.comparisonBranch
      const newBranch = newFormState.comparisonBranch

      if (oldBranch.name !== newBranch.name) {
        // ensure the focused branch is in sync with the chosen branch
        this.setState({
          focusedBranch: newBranch,
        })
      }
    }
  }

  public componentDidUpdate(prevProps: ICompareSidebarProps) {
    this.ensureCommitSearchDepth()

    const { showBranchList } = this.props.compareState

    if (showBranchList === prevProps.compareState.showBranchList) {
      return
    }

    if (this.textbox !== null) {
      if (showBranchList) {
        this.textbox.focus()
      } else if (!showBranchList) {
        this.textbox.blur()
      }
    }
  }

  private ensureCommitSearchDepth() {
    const query = this.state.commitFilterText.trim()
    const { formState, commitSHAs } = this.props.compareState
    if (
      query.length === 0 ||
      formState.kind !== HistoryTabMode.History ||
      this.getFilteredCommitSHAs(commitSHAs).length >= 50 ||
      this.exhaustedSearchQuery === query ||
      this.loadingSearchCommitsPromise !== null
    ) {
      return
    }

    this.loadingSearchCommitsPromise = this.props.dispatcher
      .loadNextCommitBatch(this.props.repository)
      .then(loaded => {
        if (loaded === 0) {
          this.exhaustedSearchQuery = query
        }
      })
      .catch(error => {
        if (this.state.commitFilterText.trim() === query) {
          this.exhaustedSearchQuery = query
        }
        defaultErrorHandler(error, this.props.dispatcher)
      })
      .then(() => {
        this.loadingSearchCommitsPromise = null
        if (!this.isUnmounted) {
          this.ensureCommitSearchDepth()
        }
      })
  }

  public focusHistory() {
    this.commitListRef.current?.focus()
  }

  public componentWillMount() {
    this.props.dispatcher.initializeCompare(this.props.repository)
  }

  public componentWillUnmount() {
    this.isUnmounted = true
    this.textbox = null

    // by hiding the branch list here when the component is torn down
    // we ensure any ahead/behind computation work is discarded
    this.props.dispatcher.updateCompareForm(this.props.repository, {
      showBranchList: false,
    })
  }

  public render() {
    const { branches, filterText, showBranchList } = this.props.compareState
    const placeholderText = getPlaceholderText(this.props.compareState)

    return (
      <div id="compare-view" role="tabpanel" aria-labelledby="history-tab">
        <div className="compare-form">
          <FancyTextBox
            ariaLabel="Branch filter"
            symbol={octicons.gitBranch}
            displayClearButton={true}
            placeholder={placeholderText}
            onFocus={this.onTextBoxFocused}
            value={filterText}
            disabled={!branches.some(b => !b.isDesktopForkRemoteBranch)}
            onRef={this.onTextBoxRef}
            onValueChanged={this.onBranchFilterTextChanged}
            onKeyDown={this.onBranchFilterKeyDown}
            onSearchCleared={this.handleEscape}
          />
        </div>

        {showBranchList ? this.renderFilterList() : this.renderCommits()}
      </div>
    )
  }

  private onBranchesListRef = (branchList: BranchList | null) => {
    this.branchList = branchList
  }

  private renderCommits() {
    const formState = this.props.compareState.formState
    return (
      <div className="compare-commit-list">
        {formState.kind === HistoryTabMode.History
          ? this.renderCommitList()
          : this.renderTabBar(formState)}
      </div>
    )
  }

  private filterListResultsChanged = (resultCount: number) => {
    this.resultCount = resultCount
  }

  private viewHistoryForBranch = () => {
    this.props.dispatcher.executeCompare(this.props.repository, {
      kind: HistoryTabMode.History,
    })

    this.props.dispatcher.updateCompareForm(this.props.repository, {
      showBranchList: false,
    })
  }

  /**
   * Filter the loaded commit SHAs client-side using the current History filter
   * text / mode. When comparing branches (or with an empty filter) the list is
   * returned unchanged.
   */
  private getFilteredCommitSHAs(
    commitSHAs: ReadonlyArray<string>
  ): ReadonlyArray<string> {
    const query = this.state.commitFilterText.trim()

    if (query.length === 0) {
      return commitSHAs
    }

    // Two keys so fuzzy mode (which only scores the first two) still matches on
    // author and SHA: the summary is the "title", and author + full/short SHA
    // are folded into the "subtitle". Substring / regex modes test every key.
    const getKey = (sha: string): ReadonlyArray<string> => {
      const commit = this.props.commitLookup.get(sha)
      if (commit === undefined) {
        return [sha]
      }
      return getCommitSearchKeys(commit)
    }

    const { results } = matchWithMode(query, commitSHAs, getKey, {
      mode: this.state.commitFilterMode,
      caseSensitive: this.state.commitFilterCaseSensitive,
    })

    return results.map(r => r.item)
  }

  private getCommitFilterSampleItems = (): ReadonlyArray<string> => {
    const items = new Array<string>()
    for (const sha of this.props.compareState.commitSHAs) {
      const commit = this.props.commitLookup.get(sha)
      if (commit !== undefined) {
        items.push(...getCommitSearchKeys(commit))
      }
      if (items.length >= 50) {
        break
      }
    }
    return items
  }

  private onCommitFilterTextChanged = (commitFilterText: string) => {
    this.exhaustedSearchQuery = null
    this.setState({ commitFilterText }, this.ensureCommitSearchDepth)
  }

  private onCommitFilterCleared = () => {
    this.setState({ commitFilterText: '' })
  }

  private onCommitFilterModeChanged = (commitFilterMode: FilterMode) => {
    persistFilterMode(CommitFilterListId, commitFilterMode)
    this.setState({ commitFilterMode })
  }

  private onCommitFilterCaseSensitiveChanged = (
    commitFilterCaseSensitive: boolean
  ) => {
    this.setState({ commitFilterCaseSensitive })
  }

  private onCommitFilterRegexPatternApply = (pattern: string) => {
    this.setState({ commitFilterText: pattern })
  }

  private renderCommitFilter() {
    return (
      <div className="history-commit-filter">
        <TextBox
          className="history-commit-filter-field"
          type="search"
          displayClearButton={true}
          prefixedIcon={octicons.search}
          placeholder="Search title, message, tag or hash"
          ariaLabel="Search commits by title, message, tag, or hash"
          value={this.state.commitFilterText}
          onValueChanged={this.onCommitFilterTextChanged}
          onSearchCleared={this.onCommitFilterCleared}
        />
        <FilterModeControl
          mode={this.state.commitFilterMode}
          caseSensitive={this.state.commitFilterCaseSensitive}
          onModeChange={this.onCommitFilterModeChanged}
          onCaseSensitiveChange={this.onCommitFilterCaseSensitiveChanged}
          regexBuilderTarget="Commits"
          getSampleItems={this.getCommitFilterSampleItems}
          filterText={this.state.commitFilterText}
          onRegexPatternApply={this.onCommitFilterRegexPatternApply}
        />
        <Button
          className="history-commit-graph-toggle"
          ariaLabel="Show commit graph"
          tooltip="Show commit graph"
          ariaPressed={this.state.showCommitGraph}
          onClick={this.onCommitGraphToggle}
        >
          <Octicon symbol={octicons.gitMerge} />
        </Button>
      </div>
    )
  }

  private onCommitGraphToggle = () => {
    this.setState(state => {
      const showCommitGraph = !state.showCommitGraph
      setBoolean(ShowCommitGraphKey, showCommitGraph)
      return { showCommitGraph }
    })
  }

  private renderCommitList() {
    const { formState, commitSHAs } = this.props.compareState

    const isHistory = formState.kind === HistoryTabMode.History
    const filteredCommitSHAs = isHistory
      ? this.getFilteredCommitSHAs(commitSHAs)
      : commitSHAs
    const isCommitFilterActive =
      isHistory && this.state.commitFilterText.trim().length > 0

    let emptyListMessage: string | JSX.Element
    if (isCommitFilterActive && filteredCommitSHAs.length === 0) {
      emptyListMessage = 'No matching commits'
    } else if (formState.kind === HistoryTabMode.History) {
      emptyListMessage = 'No history'
    } else {
      const currentlyComparedBranchName = formState.comparisonBranch.name

      emptyListMessage =
        formState.comparisonMode === ComparisonMode.Ahead ? (
          <p>
            The compared branch (<Ref>{currentlyComparedBranchName}</Ref>) is up
            to date with your branch
          </p>
        ) : (
          <p>
            Your branch is up to date with the compared branch (
            <Ref>{currentlyComparedBranchName}</Ref>)
          </p>
        )
    }

    // While a text filter is active the displayed commits are a non-contiguous
    // subset of history, so row indices no longer map to the real commit graph.
    // Disable the history-mutating affordances (reorder / squash / reset / undo
    // / amend) until the filter is cleared to avoid operating on the wrong
    // commit. Read-only actions (checkout, view, copy SHA, cherry-pick) stay
    // available.
    const allowHistoryOps = isHistory && !isCommitFilterActive

    return (
      <>
        {isHistory && commitSHAs.length > 0 ? this.renderCommitFilter() : null}
        <CommitList
          ref={this.commitListRef}
          gitHubRepository={this.props.repository.gitHubRepository}
          isLocalRepository={this.props.isLocalRepository}
          commitLookup={this.props.commitLookup}
          commitSHAs={filteredCommitSHAs}
          selectedSHAs={this.props.selectedCommitShas}
          shasToHighlight={this.props.shasToHighlight}
          localCommitSHAs={this.props.localCommitSHAs}
          canResetToCommits={allowHistoryOps}
          canUndoCommits={allowHistoryOps}
          canAmendCommits={allowHistoryOps}
          emoji={this.props.emoji}
          reorderingEnabled={allowHistoryOps}
          onViewCommitOnGitHub={this.props.onViewCommitOnGitHub}
          onUndoCommit={this.onUndoCommit}
          onResetToCommit={this.onResetToCommit}
          onRevertCommit={
            ableToRevertCommit(this.props.compareState.formState)
              ? this.props.onRevertCommit
              : undefined
          }
          onAmendCommit={this.props.onAmendCommit}
          onCommitsSelected={this.onCommitsSelected}
          onScroll={this.onScroll}
          onCreateBranch={this.onCreateBranch}
          onCheckoutCommit={this.onCheckoutCommit}
          onCreateTag={this.onCreateTag}
          onDeleteTag={this.onDeleteTag}
          onCherryPick={this.onCherryPick}
          onDropCommitInsertion={this.onDropCommitInsertion}
          onKeyboardReorder={this.onKeyboardReorder}
          onCancelKeyboardReorder={this.onCancelKeyboardReorder}
          onSquash={this.onSquash}
          emptyListMessage={emptyListMessage}
          onCompareListScrolled={this.props.onCompareListScrolled}
          compareListScrollTop={this.props.compareListScrollTop}
          tagsToPush={this.props.tagsToPush ?? []}
          onRenderCommitDragElement={this.onRenderCommitDragElement}
          onRemoveCommitDragElement={this.onRemoveCommitDragElement}
          disableReordering={!allowHistoryOps}
          disableSquashing={!allowHistoryOps}
          isMultiCommitOperationInProgress={
            this.props.isMultiCommitOperationInProgress
          }
          keyboardReorderData={this.state.keyboardReorderData}
          accounts={this.props.accounts}
          preferAbsoluteDates={this.props.preferAbsoluteDates}
          showCommitGraph={
            isHistory && this.state.showCommitGraph && !isCommitFilterActive
          }
        />
      </>
    )
  }

  private onCancelKeyboardReorder = () => {
    this.setState({ keyboardReorderData: undefined })
  }

  private onDropCommitInsertion = async (
    baseCommit: Commit | null,
    commitsToInsert: ReadonlyArray<Commit>,
    lastRetainedCommitRef: string | null
  ) => {
    this.setState({ keyboardReorderData: undefined })

    if (
      await doMergeCommitsExistAfterCommit(
        this.props.repository,
        lastRetainedCommitRef
      )
    ) {
      defaultErrorHandler(
        new Error(
          `Unable to reorder. Reordering replays all commits up to the last one required for the reorder. A merge commit cannot exist among those commits.`
        ),
        this.props.dispatcher
      )
      return
    }

    return this.props.dispatcher.reorderCommits(
      this.props.repository,
      commitsToInsert,
      baseCommit,
      lastRetainedCommitRef
    )
  }

  private onRenderCommitDragElement = (
    commit: Commit,
    selectedCommits: ReadonlyArray<Commit>
  ) => {
    this.props.dispatcher.setDragElement({
      type: DragType.Commit,
      commit,
      selectedCommits,
      gitHubRepository: this.props.repository.gitHubRepository,
    })
  }

  private onRemoveCommitDragElement = () => {
    this.props.dispatcher.clearDragElement()
  }

  private renderActiveTab(view: ICompareBranch) {
    return (
      <div className="compare-commit-list">
        {this.renderCommitList()}
        {view.comparisonMode === ComparisonMode.Behind
          ? this.renderMergeCallToAction(view)
          : null}
      </div>
    )
  }

  private renderFilterList() {
    const { defaultBranch, branches, recentBranches, filterText } =
      this.props.compareState

    return (
      <BranchList
        repository={this.props.repository}
        ref={this.onBranchesListRef}
        defaultBranch={defaultBranch}
        currentBranch={this.props.currentBranch}
        allBranches={branches}
        recentBranches={recentBranches}
        filterText={filterText}
        textbox={this.textbox!}
        selectedBranch={this.state.focusedBranch}
        canCreateNewBranch={false}
        onSelectionChanged={this.onSelectionChanged}
        onItemClick={this.onBranchItemClicked}
        onFilterTextChanged={this.onBranchFilterTextChanged}
        renderBranch={this.renderCompareBranchListItem}
        getBranchAriaLabel={this.getBranchAriaLabel}
        onFilterListResultsChanged={this.filterListResultsChanged}
      />
    )
  }

  private renderMergeCallToAction(formState: ICompareBranch) {
    if (this.props.currentBranch == null) {
      return null
    }

    return (
      <MergeCallToActionWithConflicts
        repository={this.props.repository}
        dispatcher={this.props.dispatcher}
        mergeStatus={this.props.compareState.mergeStatus}
        currentBranch={this.props.currentBranch}
        comparisonBranch={formState.comparisonBranch}
        commitsBehind={formState.aheadBehind.behind}
      />
    )
  }

  private onTabClicked = (index: number) => {
    const formState = this.props.compareState.formState

    if (formState.kind === HistoryTabMode.History) {
      return
    }

    const comparisonMode =
      index === 0 ? ComparisonMode.Behind : ComparisonMode.Ahead
    const branch = formState.comparisonBranch

    this.props.dispatcher.executeCompare(this.props.repository, {
      kind: HistoryTabMode.Compare,
      branch,
      comparisonMode,
    })
  }

  private renderTabBar(formState: ICompareBranch) {
    const selectedTab =
      formState.comparisonMode === ComparisonMode.Behind ? 0 : 1

    return (
      <div className="compare-content">
        <TabBar selectedIndex={selectedTab} onTabClicked={this.onTabClicked}>
          <span>{`Behind (${formatNumber(
            formState.aheadBehind.behind
          )})`}</span>
          <span>{`Ahead (${formatNumber(formState.aheadBehind.ahead)})`}</span>
        </TabBar>
        {this.renderActiveTab(formState)}
      </div>
    )
  }

  private renderCompareBranchListItem = (
    item: IBranchListItem,
    matches: IMatches
  ) => {
    return (
      <CompareBranchListItem
        branch={item.branch}
        currentBranch={this.props.currentBranch}
        matches={matches}
        repository={this.props.repository}
        aheadBehindStore={this.props.aheadBehindStore}
      />
    )
  }

  private getBranchAriaLabel = (item: IBranchListItem): string => {
    return item.branch.name
  }

  private onBranchFilterKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    const key = event.key

    if (key === 'Enter') {
      if (this.resultCount === 0) {
        event.preventDefault()
        return
      }
      const branch = this.state.focusedBranch

      if (branch === null) {
        this.viewHistoryForBranch()
      } else {
        this.props.dispatcher.executeCompare(this.props.repository, {
          kind: HistoryTabMode.Compare,
          comparisonMode: ComparisonMode.Behind,
          branch,
        })

        this.props.dispatcher.updateCompareForm(this.props.repository, {
          filterText: branch.name,
        })
      }

      if (this.textbox) {
        this.textbox.blur()
      }
    } else if (key === 'Escape') {
      this.handleEscape()
    } else if (key === 'ArrowDown') {
      if (this.branchList !== null) {
        this.branchList.selectNextItem(true, 'down')
      }
    } else if (key === 'ArrowUp') {
      if (this.branchList !== null) {
        this.branchList.selectNextItem(true, 'up')
      }
    }
  }

  private handleEscape = () => {
    this.clearFilterState()
    if (this.textbox) {
      this.textbox.blur()
    }
  }

  private onCommitsSelected = (
    commits: ReadonlyArray<Commit>,
    isContiguous: boolean
  ) => {
    this.props.dispatcher.changeCommitSelection(
      this.props.repository,
      commits.map(c => c.sha),
      isContiguous
    )

    this.loadChangedFilesScheduler.queue(() => {
      this.props.dispatcher.loadChangedFilesForCurrentSelection(
        this.props.repository
      )
    })
  }

  private onScroll = (start: number, end: number) => {
    const compareState = this.props.compareState
    const formState = compareState.formState

    if (formState.kind === HistoryTabMode.Compare) {
      // as the app is currently comparing the current branch to some other
      // branch, everything needed should be loaded
      return
    }

    const commits = compareState.commitSHAs
    if (commits.length - end <= CloseToBottomThreshold) {
      if (this.loadingMoreCommitsPromise != null) {
        // as this callback fires for any scroll event we need to guard
        // against re-entrant calls to loadCommitBatch
        return
      }

      this.loadingMoreCommitsPromise = this.props.dispatcher
        .loadNextCommitBatch(this.props.repository)
        .then(() => {
          // deferring unsetting this flag to some time _after_ the commits
          // have been appended to prevent eagerly adding more commits due
          // to scroll events (which fire indiscriminately)
          window.setTimeout(() => {
            this.loadingMoreCommitsPromise = null
          }, 500)
        })
    }
  }

  private onBranchFilterTextChanged = (filterText: string) => {
    if (filterText.length === 0) {
      this.setState({ focusedBranch: null })
    }

    this.props.dispatcher.updateCompareForm(this.props.repository, {
      filterText,
    })
  }

  private clearFilterState = () => {
    this.setState({
      focusedBranch: null,
    })

    this.props.dispatcher.updateCompareForm(this.props.repository, {
      filterText: '',
    })

    this.viewHistoryForBranch()
  }

  private onBranchItemClicked = (branch: Branch) => {
    this.props.dispatcher.executeCompare(this.props.repository, {
      kind: HistoryTabMode.Compare,
      comparisonMode: ComparisonMode.Behind,
      branch,
    })

    this.setState({
      focusedBranch: null,
    })

    this.props.dispatcher.updateCompareForm(this.props.repository, {
      filterText: branch.name,
      showBranchList: false,
    })
  }

  private onSelectionChanged = (
    branch: Branch | null,
    source: SelectionSource
  ) => {
    this.setState({
      focusedBranch: branch,
    })
  }

  private onTextBoxFocused = () => {
    this.props.dispatcher.updateCompareForm(this.props.repository, {
      showBranchList: true,
    })
  }

  private onTextBoxRef = (textbox: TextBox) => {
    this.textbox = textbox
  }

  private onCreateTag = (targetCommitSha: string) => {
    this.props.dispatcher.showCreateTagDialog(
      this.props.repository,
      targetCommitSha,
      this.props.localTags
    )
  }

  private onUndoCommit = (commit: Commit) => {
    this.props.dispatcher.undoCommit(this.props.repository, commit)
  }

  private onResetToCommit = (commit: Commit) => {
    this.props.dispatcher.resetToCommit(this.props.repository, commit)
  }

  private onCreateBranch = (commit: CommitOneLine) => {
    const { repository, dispatcher } = this.props

    dispatcher.showPopup({
      type: PopupType.CreateBranch,
      repository,
      targetCommit: commit,
    })
  }

  private onCheckoutCommit = (commit: CommitOneLine) => {
    const { repository, dispatcher, askForConfirmationOnCheckoutCommit } =
      this.props
    if (!askForConfirmationOnCheckoutCommit) {
      dispatcher.checkoutCommit(repository, commit)
    } else {
      dispatcher.showPopup({
        type: PopupType.ConfirmCheckoutCommit,
        commit: commit,
        repository,
      })
    }
  }

  private onDeleteTag = (tagName: string, unpushed: boolean) => {
    const { dispatcher, repository } = this.props
    if (unpushed) {
      dispatcher.showDeleteTagDialog(repository, tagName)
    } else {
      dispatcher.showPopup({
        type: PopupType.ConfirmDeletePushedTag,
        repository,
        tagName,
      })
    }
  }

  private onCherryPick = (commits: ReadonlyArray<CommitOneLine>) => {
    this.props.onCherryPick(this.props.repository, commits)
  }

  private onKeyboardReorder = (toReorder: ReadonlyArray<Commit>) => {
    const { commitSHAs } = this.props.compareState

    this.setState({
      keyboardReorderData: {
        type: DragType.Commit,
        commits: toReorder,
        itemIndices: toReorder.map(c => commitSHAs.indexOf(c.sha)),
      },
    })
  }

  private onSquash = async (
    toSquash: ReadonlyArray<Commit>,
    squashOnto: Commit,
    lastRetainedCommitRef: string | null,
    isInvokedByContextMenu: boolean
  ) => {
    const toSquashSansSquashOnto = toSquash.filter(
      c => c.sha !== squashOnto.sha
    )

    const allCommitsInSquash = [...toSquashSansSquashOnto, squashOnto]
    const coAuthors = getUniqueCoauthorsAsAuthors(allCommitsInSquash)

    const squashedDescription = getSquashedCommitDescription(
      toSquashSansSquashOnto,
      squashOnto
    )

    if (
      await doMergeCommitsExistAfterCommit(
        this.props.repository,
        lastRetainedCommitRef
      )
    ) {
      defaultErrorHandler(
        new Error(
          `Unable to squash. Squashing replays all commits up to the last one required for the squash. A merge commit cannot exist among those commits.`
        ),
        this.props.dispatcher
      )
      return
    }

    this.props.dispatcher.recordSquashInvoked(isInvokedByContextMenu)

    this.props.dispatcher.showPopup({
      type: PopupType.CommitMessage,
      repository: this.props.repository,
      coAuthors,
      showCoAuthoredBy: coAuthors.length > 0,
      commitMessage: {
        summary: squashOnto.summary,
        description: squashedDescription,
        timestamp: Date.now(),
      },
      dialogTitle: `Squash ${allCommitsInSquash.length} Commits`,
      dialogButtonText: `Squash ${allCommitsInSquash.length} Commits`,
      prepopulateCommitSummary: true,
      onSubmitCommitMessage: async (context: ICommitContext) => {
        this.props.dispatcher.closePopup(PopupType.CommitMessage)

        this.props.dispatcher.squash(
          this.props.repository,
          toSquashSansSquashOnto,
          squashOnto,
          lastRetainedCommitRef,
          context
        )
        return true
      },
    })
  }
}

function getPlaceholderText(state: ICompareState) {
  const { branches, formState } = state

  if (!branches.some(b => !b.isDesktopForkRemoteBranch)) {
    return __DARWIN__ ? 'No Branches to Compare' : 'No branches to compare'
  } else if (formState.kind === HistoryTabMode.History) {
    return __DARWIN__
      ? 'Select Branch to Compare…'
      : 'Select branch to compare…'
  } else {
    return undefined
  }
}

// determine if the `onRevertCommit` function should be exposed to the CommitList/CommitListItem.
// `onRevertCommit` is only exposed if the form state of the branch compare form is either
// 1: History mode, 2: Comparison Mode with the 'Ahead' list shown.
// When not exposed, the context menu item 'Revert this commit' is disabled.
function ableToRevertCommit(
  formState: IDisplayHistory | ICompareBranch
): boolean {
  return (
    formState.kind === HistoryTabMode.History ||
    formState.comparisonMode === ComparisonMode.Ahead
  )
}
