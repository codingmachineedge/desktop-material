import * as React from 'react'

import { Branch } from '../../models/branch'

import { assertNever } from '../../lib/fatal-error'

import { SelectionSource } from '../lib/filter-list'
import { IMatches } from '../../lib/fuzzy-find'
import { Button } from '../lib/button'
import { TextBox } from '../lib/text-box'

import {
  groupBranches,
  IBranchListItem,
  BranchGroupIdentifier,
} from './group-branches'
import { NoBranches } from './no-branches'
import { SelectionDirection, ClickSource } from '../lib/list'
import { generateBranchContextMenuItems } from './branch-list-item-context-menu'
import { showContextualMenu } from '../../lib/menu-item'
import { SectionFilterList } from '../lib/section-filter-list'
import memoizeOne from 'memoize-one'
import { getAuthors } from '../../lib/git/log'
import { Repository } from '../../models/repository'
import { formatDate } from '../../lib/format-date'
import {
  BranchSortOrder,
  DefaultBranchSortOrder,
} from '../../models/branch-sort-order'
import {
  clearBranchVisibilityState,
  IBranchVisibilityState,
  loadBranchVisibilityState,
  saveBranchVisibilityState,
} from '../../lib/branch-visibility'

const RowHeight = 30

interface IBranchListProps {
  readonly repository: Repository

  /**
   * Overrides the default 30px row height. The Branches side sheet passes its
   * own geometry (34px icon chips plus padding) so virtualized slots match
   * what its rows actually draw; dialog consumers keep the default.
   */
  readonly rowHeight?:
    | number
    | ((info: { readonly item: IBranchListItem | null }) => number)

  /**
   * See IBranchesState.defaultBranch
   */
  readonly defaultBranch: Branch | null

  /**
   * The currently checked out branch or null if HEAD is detached
   */
  readonly currentBranch: Branch | null

  /**
   * See IBranchesState.allBranches
   */
  readonly allBranches: ReadonlyArray<Branch>

  /**
   * See IBranchesState.recentBranches
   */
  readonly recentBranches: ReadonlyArray<Branch>

  readonly branchSortOrder?: BranchSortOrder

  /**
   * The currently selected branch in the list, see the onSelectionChanged prop.
   */
  readonly selectedBranch: Branch | null

  /**
   * Called when a key down happens in the filter field. Users have a chance to
   * respond or cancel the default behavior by calling `preventDefault`.
   */
  readonly onFilterKeyDown?: (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => void

  /** Called when an item is clicked. */
  readonly onItemClick?: (item: Branch, source: ClickSource) => void

  /**
   * This function will be called when the selection changes as a result of a
   * user keyboard or mouse action (i.e. not when props change). This function
   * will not be invoked when an already selected row is clicked on.
   *
   * @param selectedItem - The Branch that was just selected
   * @param source       - The kind of user action that provoked the change,
   *                       either a pointer device press, or a keyboard event
   *                       (arrow up/down)
   */
  readonly onSelectionChanged?: (
    selectedItem: Branch | null,
    source: SelectionSource
  ) => void

  /** The current filter text to render */
  readonly filterText: string

  /** Callback to fire when the filter text is changed */
  readonly onFilterTextChanged: (filterText: string) => void

  /** Can users create a new branch? */
  readonly canCreateNewBranch: boolean

  /**
   * Called when the user wants to create a new branch. It will be given a name
   * to prepopulate the new branch name field.
   */
  readonly onCreateNewBranch?: (name: string) => void

  readonly textbox?: TextBox

  /** Aria label for a specific row */
  readonly getBranchAriaLabel: (
    item: IBranchListItem,
    authorDate: Date | undefined
  ) => string | undefined

  /**
   * Render function to apply to each branch in the list
   */
  readonly renderBranch: (
    item: IBranchListItem,
    matches: IMatches,
    authorDate: Date | undefined
  ) => JSX.Element

  /**
   * Callback to fire when the items in the filter list are updated
   */
  readonly onFilterListResultsChanged?: (resultCount: number) => void

  /** If true, we do not render the filter. */
  readonly hideFilterRow?: boolean

  /** Called to render content before/above the branches filter and list. */
  readonly renderPreList?: () => JSX.Element | null

  /** Optional: No branches message */
  readonly noBranchesMessage?: string | JSX.Element

  /** Optional: Callback for if rename context menu should exist */
  readonly onRenameBranch?: (branchName: string) => void

  /** Optional: Callback for if delete context menu should exist */
  readonly onDeleteBranch?: (branchName: string) => void

  /** Optional: Callback to checkout a branch in a new worktree */
  readonly onCheckoutInNewWorktree?: (branch: Branch) => void
}

interface IBranchListState {
  readonly commitAuthorDates: ReadonlyMap<string, Date>
  readonly visibility: IBranchVisibilityState
}

const commitDateCache = new Map<string, Date>()

/** The Branches list component. */
export class BranchList extends React.Component<
  IBranchListProps,
  IBranchListState
> {
  private branchFilterList: SectionFilterList<IBranchListItem> | null = null

  private getGroups = memoizeOne(groupBranches)
  private getSelectedItem = memoizeOne(
    (groups: ReturnType<typeof groupBranches>, selectedBranch: Branch | null) =>
      groups
        .flatMap(g => g.items)
        .find(i => i.branch.name === selectedBranch?.name) ?? null
  )

  /**
   * Generate a new object any time groups or commitAuthorDates changes
   * in order to force the list to re-render.
   *
   * Note, change is determined by reference equality. This opaque object
   * will be passed down to the react-virtualized List component as a prop
   * causing it to re-render whenever either of these inputs change.
   *
   * Note that the return value here can be anything as long as it's not
   * considered equal (reference equality) to the previously returned value.
   * Using a guid which we used to do works but is overkill.
   */
  private getInvalidationProp = memoizeOne(
    (
      _groups: ReturnType<typeof groupBranches>,
      _commitAuthorDates: IBranchListState['commitAuthorDates']
    ) => ({})
  )

  private get invalidationProp() {
    return this.getInvalidationProp(this.groups, this.state.commitAuthorDates)
  }

  private get groups() {
    return this.getGroups(
      this.props.defaultBranch,
      this.props.currentBranch,
      this.props.allBranches,
      this.props.recentBranches,
      this.props.branchSortOrder ?? DefaultBranchSortOrder,
      this.state.visibility
    )
  }

  private get selectedItem() {
    return this.getSelectedItem(this.groups, this.props.selectedBranch)
  }

  public constructor(props: IBranchListProps) {
    super(props)
    this.state = {
      commitAuthorDates: new Map<string, Date>(),
      visibility: loadBranchVisibilityState(props.repository.id),
    }
  }

  public selectNextItem(focus: boolean = false, direction: SelectionDirection) {
    if (this.branchFilterList !== null) {
      this.branchFilterList.selectNextItem(focus, direction)
    }
  }

  public componentDidUpdate(prevProps: IBranchListProps) {
    if (prevProps.repository.id !== this.props.repository.id) {
      this.setState({
        visibility: loadBranchVisibilityState(this.props.repository.id),
      })
    }
    if (prevProps.allBranches !== this.props.allBranches) {
      const solo = this.state.visibility.solo
      if (
        solo !== null &&
        !this.props.allBranches.some(branch => branch.name === solo)
      ) {
        this.persistVisibility({ ...this.state.visibility, solo: null })
      }
      this.populateCommitDates()
    }
  }

  private populateCommitDates = () => {
    const cached = new Map<string, Date>()
    const missing = new Array<string>()
    const uniqShas = new Set(this.props.allBranches.map(b => b.tip.sha))

    for (const sha of uniqShas) {
      const date = commitDateCache.get(sha)
      if (date) {
        cached.set(sha, date)
      } else {
        missing.push(sha)
      }
    }

    // Clean up the cache
    for (const sha of commitDateCache.keys()) {
      if (!uniqShas.has(sha)) {
        commitDateCache.delete(sha)
      }
    }

    this.setState({ commitAuthorDates: cached })

    if (missing.length > 0) {
      getAuthors(this.props.repository, missing)
        .then(x => {
          x.forEach(({ date }, i) => commitDateCache.set(missing[i], date))
          this.populateCommitDates()
        })
        .catch(e => log.error(`Failed to populate commit dates`, e))
    }
  }

  public componentDidMount() {
    this.populateCommitDates()
  }

  public render() {
    return (
      <SectionFilterList<IBranchListItem>
        ref={this.onBranchesFilterListRef}
        className="branches-list"
        rowHeight={this.props.rowHeight ?? RowHeight}
        filterListId="branches"
        filterListLabel="Branches"
        filterText={this.props.filterText}
        onFilterTextChanged={this.props.onFilterTextChanged}
        onFilterKeyDown={this.props.onFilterKeyDown}
        selectedItem={this.selectedItem}
        renderItem={this.renderItem}
        renderRowFocusTooltip={this.renderRowFocusTooltip}
        renderGroupHeader={this.renderGroupHeader}
        onItemClick={this.onItemClick}
        onSelectionChanged={this.onSelectionChanged}
        onEnterPressedWithoutFilteredItems={this.onCreateNewBranch}
        groups={this.groups}
        invalidationProps={this.invalidationProp}
        renderPostFilter={this.onRenderNewButton}
        renderNoItems={this.onRenderNoItems}
        filterTextBox={this.props.textbox}
        hideFilterRow={this.props.hideFilterRow}
        onFilterListResultsChanged={this.props.onFilterListResultsChanged}
        renderPreList={this.renderPreList}
        onItemContextMenu={this.onBranchContextMenu}
        getItemAriaLabel={this.getItemAriaLabel}
        getGroupAriaLabel={this.getGroupAriaLabel}
      />
    )
  }

  private onBranchContextMenu = (
    item: IBranchListItem,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    event.preventDefault()

    const { onRenameBranch, onDeleteBranch, onCheckoutInNewWorktree } =
      this.props

    const { branch } = item

    const items = generateBranchContextMenuItems({
      branch,
      onRenameBranch,
      onDeleteBranch,
      onCheckoutInNewWorktree,
      isPinned: this.state.visibility.pinned.includes(branch.name),
      isSolo: this.state.visibility.solo === branch.name,
      canHide: this.canHideBranch(branch),
      hasVisibilityOverrides: this.hasVisibilityOverrides,
      onTogglePin: this.onTogglePin,
      onHide: this.onHideBranch,
      onSolo: this.onSoloBranch,
      onRestoreVisibility: this.onRestoreVisibility,
    })

    showContextualMenu(items)
  }

  private onBranchesFilterListRef = (
    filterList: SectionFilterList<IBranchListItem> | null
  ) => {
    this.branchFilterList = filterList
  }

  private renderItem = (item: IBranchListItem, matches: IMatches) => {
    return this.props.renderBranch(
      item,
      matches,
      this.state.commitAuthorDates.get(item.branch.tip.sha)
    )
  }

  private renderRowFocusTooltip = (
    item: IBranchListItem
  ): JSX.Element | string | null => {
    const { tip, name } = item.branch
    const authorDate = this.state.commitAuthorDates.get(tip.sha)

    const absoluteDate = authorDate
      ? formatDate(authorDate, {
          dateStyle: 'full',
          timeStyle: 'short',
        })
      : null

    return (
      <div className="branches-list-item-tooltip list-item-tooltip">
        <div>
          <div className="label">Full Name: </div>
          {name}
        </div>
        {absoluteDate && (
          <div>
            <div className="label">Last Modified: </div>
            {absoluteDate}
          </div>
        )}
      </div>
    )
  }

  private parseHeader(label: string): BranchGroupIdentifier | null {
    switch (label) {
      case 'default':
      case 'pinned':
      case 'recent':
      case 'other':
        return label
      default:
        return null
    }
  }

  private getItemAriaLabel = (item: IBranchListItem) => {
    return this.props.getBranchAriaLabel(
      item,
      this.state.commitAuthorDates.get(item.branch.tip.sha)
    )
  }

  private getGroupAriaLabel = (group: number) => {
    const identifier = this.groups[group].identifier as BranchGroupIdentifier
    return this.getGroupLabel(identifier)
  }

  private renderGroupHeader = (label: string) => {
    const identifier = this.parseHeader(label)

    return identifier !== null ? (
      <div className="branches-list-content filter-list-group-header">
        {this.getGroupLabel(identifier)}
      </div>
    ) : null
  }

  private getGroupLabel(identifier: BranchGroupIdentifier) {
    if (identifier === 'default') {
      return __DARWIN__ ? 'Default Branch' : 'Default branch'
    } else if (identifier === 'pinned') {
      return __DARWIN__ ? 'Pinned Branches' : 'Pinned branches'
    } else if (identifier === 'recent') {
      return __DARWIN__ ? 'Recent Branches' : 'Recent branches'
    } else if (identifier === 'other') {
      return __DARWIN__ ? 'Other Branches' : 'Other branches'
    } else {
      return assertNever(identifier, `Unknown identifier: ${identifier}`)
    }
  }

  private get hasVisibilityOverrides() {
    const { pinned, hidden, solo } = this.state.visibility
    return pinned.length > 0 || hidden.length > 0 || solo !== null
  }

  private canHideBranch(branch: Branch) {
    return (
      branch.name !== this.props.currentBranch?.name &&
      branch.name !== this.props.defaultBranch?.name
    )
  }

  private persistVisibility(visibility: IBranchVisibilityState) {
    this.setState({
      visibility: saveBranchVisibilityState(
        this.props.repository.id,
        visibility
      ),
    })
  }

  private onTogglePin = (branch: Branch) => {
    const pinned = new Set(this.state.visibility.pinned)
    if (pinned.has(branch.name)) {
      pinned.delete(branch.name)
    } else {
      pinned.add(branch.name)
    }
    this.persistVisibility({
      pinned: [...pinned],
      hidden: this.state.visibility.hidden.filter(name => name !== branch.name),
      solo: this.state.visibility.solo,
    })
  }

  private onHideBranch = (branch: Branch) => {
    if (!this.canHideBranch(branch)) {
      return
    }
    const hidden = new Set(this.state.visibility.hidden)
    hidden.add(branch.name)
    this.persistVisibility({
      pinned: this.state.visibility.pinned.filter(name => name !== branch.name),
      hidden: [...hidden],
      solo:
        this.state.visibility.solo === branch.name
          ? null
          : this.state.visibility.solo,
    })
  }

  private onSoloBranch = (branch: Branch) => {
    const solo = this.state.visibility.solo === branch.name ? null : branch.name
    this.persistVisibility({
      pinned: this.state.visibility.pinned,
      hidden: this.state.visibility.hidden.filter(name => name !== branch.name),
      solo,
    })
  }

  private onRestoreVisibility = () => {
    this.setState({
      visibility: clearBranchVisibilityState(this.props.repository.id),
    })
  }

  private renderPreList = () => {
    const parentContent = this.props.renderPreList?.() ?? null
    if (!this.hasVisibilityOverrides) {
      return parentContent
    }

    const existingBranchNames = new Set(
      this.props.allBranches.map(branch => branch.name)
    )
    const hiddenCount = this.state.visibility.hidden.filter(name =>
      existingBranchNames.has(name)
    ).length
    const summary =
      this.state.visibility.solo !== null
        ? `Solo view: ${this.state.visibility.solo}`
        : `${this.state.visibility.pinned.length} pinned, ${hiddenCount} hidden`

    return (
      <>
        <div className="branch-visibility-controls">
          <span role="status">{summary}</span>
          <Button onClick={this.onRestoreVisibility}>Restore all</Button>
        </div>
        {parentContent}
      </>
    )
  }

  private onRenderNoItems = () => {
    return (
      <NoBranches
        onCreateNewBranch={this.onCreateNewBranch}
        canCreateNewBranch={this.props.canCreateNewBranch}
        noBranchesMessage={this.props.noBranchesMessage}
      />
    )
  }

  private onRenderNewButton = () => {
    return this.props.canCreateNewBranch ? (
      <Button className="new-branch-button" onClick={this.onCreateNewBranch}>
        {__DARWIN__ ? 'New Branch' : 'New branch'}
      </Button>
    ) : null
  }

  private onItemClick = (item: IBranchListItem, source: ClickSource) => {
    if (this.props.onItemClick) {
      this.props.onItemClick(item.branch, source)
    }
  }

  private onSelectionChanged = (
    selectedItem: IBranchListItem | null,
    source: SelectionSource
  ) => {
    if (this.props.onSelectionChanged) {
      this.props.onSelectionChanged(
        selectedItem ? selectedItem.branch : null,
        source
      )
    }
  }

  private onCreateNewBranch = () => {
    if (this.props.onCreateNewBranch) {
      this.props.onCreateNewBranch(this.props.filterText)
    }
  }
}
