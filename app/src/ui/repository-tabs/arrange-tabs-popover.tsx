import * as React from 'react'
import {
  Popover,
  PopoverAnchorPosition,
  PopoverDecoration,
} from '../lib/popover'
import { RepositoryTabsStore } from '../../lib/stores/repository-tabs-store'
import { IProfileTabsState, IRepositoryTab } from '../../models/repository-tab'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'

/** The persistence id for the arrange filter's mode. */
const ArrangeTabsFilterListId = 'arrange-tabs'

interface IArrangeTabsPopoverProps {
  readonly tabs: IProfileTabsState
  readonly tabsStore: RepositoryTabsStore
  readonly anchor: HTMLElement | null
  readonly resolveLabel: (tab: IRepositoryTab) => string
  readonly resolveMatchKeys: (tab: IRepositoryTab) => ReadonlyArray<string>
  readonly resolveStatusRank: (tab: IRepositoryTab) => number
  readonly onClose: () => void
}

interface IArrangeTabsPopoverState {
  readonly isApplying: boolean
  readonly announcement: string
  readonly query: string
  readonly filterMode: FilterMode
  readonly filterCaseSensitive: boolean
}

/** A Material one-shot arrange surface with accessible manual-order actions. */
export class ArrangeTabsPopover extends React.Component<
  IArrangeTabsPopoverProps,
  IArrangeTabsPopoverState
> {
  public constructor(props: IArrangeTabsPopoverProps) {
    super(props)
    this.state = {
      isApplying: false,
      announcement: 'Choose a manual move or a one-time sort.',
      query: '',
      filterMode: readPersistedFilterMode(ArrangeTabsFilterListId),
      filterCaseSensitive: false,
    }
  }

  private run = (action: () => Promise<void>, announcement: string) => {
    if (this.state.isApplying) {
      return
    }
    this.setState({ isApplying: true })
    action()
      .then(() => this.setState({ isApplying: false, announcement }))
      .catch(err => {
        log.error('Failed to arrange repository tabs', err)
        this.setState({
          isApplying: false,
          announcement:
            'The tab order could not be saved. Review the current order and try again.',
        })
      })
  }

  private move = (
    tab: IRepositoryTab,
    toIndex: number,
    destination: string
  ) => {
    const label = this.props.resolveLabel(tab)
    this.run(
      () => this.props.tabsStore.moveTab(tab.id, toIndex),
      `${label} moved ${destination}.`
    )
  }

  private togglePinned = (tab: IRepositoryTab) => {
    const willPin = tab.isPinned !== true
    const label = this.props.resolveLabel(tab)
    this.run(
      () => this.props.tabsStore.setTabPinned(tab.id, willPin),
      `${label} ${willPin ? 'pinned' : 'unpinned'}.`
    )
  }

  private toggleFavorite = (tab: IRepositoryTab) => {
    const willFavorite = tab.isFavorite !== true
    const label = this.props.resolveLabel(tab)
    this.run(
      () => this.props.tabsStore.setTabFavorite(tab.id, willFavorite),
      `${label} ${
        willFavorite ? 'added to favorites' : 'removed from favorites'
      }.`
    )
  }

  private onManualAction = (event: React.MouseEvent<HTMLButtonElement>) => {
    const { tabId, action } = event.currentTarget.dataset
    const { tabs } = this.props.tabs
    const tab = tabs.find(candidate => candidate.id === tabId)
    if (tab === undefined) {
      return
    }
    const index = tabs.findIndex(candidate => candidate.id === tab.id)
    const pinnedCount = tabs.filter(item => item.isPinned === true).length
    const groupStart = tab.isPinned === true ? 0 : pinnedCount
    const groupEnd =
      tab.isPinned === true ? Math.max(0, pinnedCount - 1) : tabs.length - 1

    switch (action) {
      case 'pin':
        this.togglePinned(tab)
        break
      case 'favorite':
        this.toggleFavorite(tab)
        break
      case 'first':
        this.move(tab, groupStart, 'to first')
        break
      case 'left':
        this.move(tab, index - 1, 'left')
        break
      case 'right':
        this.move(tab, index + 1, 'right')
        break
      case 'last':
        this.move(tab, groupEnd, 'to last')
        break
    }
  }

  private renderManualRow(tab: IRepositoryTab) {
    const { tabs } = this.props.tabs
    const label = this.props.resolveLabel(tab)
    const index = tabs.findIndex(candidate => candidate.id === tab.id)
    const pinnedCount = tabs.filter(item => item.isPinned === true).length
    const groupStart = tab.isPinned === true ? 0 : pinnedCount
    const groupEnd =
      tab.isPinned === true ? Math.max(0, pinnedCount - 1) : tabs.length - 1
    const atStart = index === groupStart
    const atEnd = index === groupEnd
    const disabled = this.state.isApplying

    return (
      <li className="arrange-tabs-row" key={tab.id}>
        <div className="arrange-tabs-row-label">
          <span>{label}</span>
          {tab.isPinned === true && (
            <span className="arrange-tabs-chip">Pinned</span>
          )}
          {tab.isFavorite === true && (
            <span className="arrange-tabs-chip favorite">Favorite</span>
          )}
        </div>
        <div className="arrange-tabs-row-actions">
          <button
            type="button"
            data-tab-id={tab.id}
            data-action="pin"
            onClick={this.onManualAction}
            disabled={disabled}
            aria-label={`${tab.isPinned === true ? 'Unpin' : 'Pin'} ${label}`}
          >
            {tab.isPinned === true ? 'Unpin' : 'Pin'}
          </button>
          <button
            type="button"
            data-tab-id={tab.id}
            data-action="favorite"
            onClick={this.onManualAction}
            disabled={disabled}
            aria-label={
              (tab.isFavorite === true ? 'Unfavorite' : 'Favorite') +
              ' ' +
              label
            }
          >
            {tab.isFavorite === true ? 'Unstar' : 'Star'}
          </button>
          <button
            type="button"
            data-tab-id={tab.id}
            data-action="first"
            onClick={this.onManualAction}
            disabled={disabled || atStart}
            aria-label={`Move ${label} to first`}
          >
            First
          </button>
          <button
            type="button"
            data-tab-id={tab.id}
            data-action="left"
            onClick={this.onManualAction}
            disabled={disabled || atStart}
            aria-label={`Move ${label} left`}
          >
            Left
          </button>
          <button
            type="button"
            data-tab-id={tab.id}
            data-action="right"
            onClick={this.onManualAction}
            disabled={disabled || atEnd}
            aria-label={`Move ${label} right`}
          >
            Right
          </button>
          <button
            type="button"
            data-tab-id={tab.id}
            data-action="last"
            onClick={this.onManualAction}
            disabled={disabled || atEnd}
            aria-label={`Move ${label} to last`}
          >
            Last
          </button>
        </div>
      </li>
    )
  }

  private arrangeByLabel = (order: 'ascending' | 'descending') => {
    this.run(
      () =>
        this.props.tabsStore.arrangeTabsByLabel(order, this.props.resolveLabel),
      order === 'ascending'
        ? 'Tabs arranged from A to Z.'
        : 'Tabs arranged from Z to A.'
    )
  }

  private arrangeByOpenedAt = (order: 'newest' | 'oldest') => {
    this.run(
      () => this.props.tabsStore.arrangeTabsByOpenedAt(order),
      `Tabs arranged by ${order} opened first.`
    )
  }

  private arrangeByStatus = (
    order: 'needs-attention-first' | 'clean-first'
  ) => {
    this.run(
      () =>
        this.props.tabsStore.arrangeTabsByRepositoryStatus(
          order,
          this.props.resolveStatusRank
        ),
      order === 'needs-attention-first'
        ? 'Tabs needing attention moved first.'
        : 'Clean tabs moved first.'
    )
  }

  private arrangeByFavorite = (order: 'favorites-first' | 'favorites-last') => {
    this.run(
      () => this.props.tabsStore.arrangeTabsByFavorite(order),
      order === 'favorites-first'
        ? 'Favorite tabs moved first.'
        : 'Favorite tabs moved last.'
    )
  }

  private onSortClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    switch (event.currentTarget.dataset.sort) {
      case 'label-ascending':
        this.arrangeByLabel('ascending')
        break
      case 'label-descending':
        this.arrangeByLabel('descending')
        break
      case 'opened-newest':
        this.arrangeByOpenedAt('newest')
        break
      case 'opened-oldest':
        this.arrangeByOpenedAt('oldest')
        break
      case 'status-attention':
        this.arrangeByStatus('needs-attention-first')
        break
      case 'status-clean':
        this.arrangeByStatus('clean-first')
        break
      case 'favorites-first':
        this.arrangeByFavorite('favorites-first')
        break
      case 'favorites-last':
        this.arrangeByFavorite('favorites-last')
        break
    }
  }

  private onFilterChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ query: event.currentTarget.value })
  }

  private onFilterModeChange = (filterMode: FilterMode) => {
    persistFilterMode(ArrangeTabsFilterListId, filterMode)
    this.setState({ filterMode })
  }

  private onFilterCaseSensitiveChange = (filterCaseSensitive: boolean) => {
    this.setState({ filterCaseSensitive })
  }

  private onRegexPatternApply = (pattern: string) => {
    this.setState({ query: pattern })
  }

  private getFilterSampleItems = (): ReadonlyArray<string> =>
    this.props.tabs.tabs.map(tab =>
      this.props.resolveMatchKeys(tab).join(' · ')
    )

  private getFilteredTabs(): ReadonlyArray<IRepositoryTab> {
    const { tabs } = this.props.tabs
    if (this.state.query.trim().length === 0) {
      return tabs
    }

    const { results } = matchWithMode(
      this.state.query,
      tabs,
      this.props.resolveMatchKeys,
      {
        mode: this.state.filterMode,
        caseSensitive: this.state.filterCaseSensitive,
      }
    )

    return results.map(r => r.item)
  }

  public render() {
    const { tabs } = this.props.tabs
    const disabled = this.state.isApplying || tabs.length < 2
    const filteredTabs = this.getFilteredTabs()
    const resultSummary = `${filteredTabs.length} of ${tabs.length} tabs`

    return (
      <Popover
        anchor={this.props.anchor}
        anchorPosition={PopoverAnchorPosition.BottomRight}
        decoration={PopoverDecoration.Balloon}
        ariaLabelledby="arrange-tabs-title"
        ariaDescribedBy="arrange-tabs-status"
        onClickOutside={this.props.onClose}
      >
        <div className="arrange-tabs">
          <header className="arrange-tabs-header">
            <h3 id="arrange-tabs-title">Arrange tabs</h3>
            <p>
              Drag tabs on the strip, or use these keyboard-friendly controls.
              Pinned tabs remain in the leading group.
            </p>
          </header>

          <div className="arrange-tabs-filter" role="search">
            <label htmlFor="arrange-tabs-filter-input">Filter tabs</label>
            <div className="arrange-tabs-filter-field">
              <input
                data-search-surface-id="arrange-tabs"
                id="arrange-tabs-filter-input"
                className="arrange-tabs-filter-input"
                type="search"
                value={this.state.query}
                onChange={this.onFilterChange}
                autoFocus={true}
                placeholder="Name, alias, path, or URL"
              />
              <FilterModeControl
                searchSurfaceId="arrange-tabs"
                mode={this.state.filterMode}
                caseSensitive={this.state.filterCaseSensitive}
                onModeChange={this.onFilterModeChange}
                onCaseSensitiveChange={this.onFilterCaseSensitiveChange}
                regexBuilderTarget="Open tabs"
                getSampleItems={this.getFilterSampleItems}
                filterText={this.state.query}
                onRegexPatternApply={this.onRegexPatternApply}
              />
            </div>
            <span className="arrange-tabs-filter-count" aria-live="polite">
              {resultSummary}
            </span>
          </div>

          <section aria-labelledby="arrange-tabs-manual-title">
            <h4 id="arrange-tabs-manual-title">Manual order</h4>
            {filteredTabs.length === 0 ? (
              <p className="arrange-tabs-empty" role="status">
                No tabs match this filter.
              </p>
            ) : (
              <ul className="arrange-tabs-list">
                {filteredTabs.map(tab => this.renderManualRow(tab))}
              </ul>
            )}
          </section>

          <section aria-labelledby="arrange-tabs-sort-title">
            <h4 id="arrange-tabs-sort-title">Sort once</h4>
            <p className="arrange-tabs-sort-hint">
              Sort actions apply to all open tabs, even while filtering.
            </p>
            <div className="arrange-tabs-sort-grid">
              <button
                type="button"
                disabled={disabled}
                data-sort="label-ascending"
                onClick={this.onSortClick}
              >
                Label A → Z
              </button>
              <button
                type="button"
                disabled={disabled}
                data-sort="label-descending"
                onClick={this.onSortClick}
              >
                Label Z → A
              </button>
              <button
                type="button"
                disabled={disabled}
                data-sort="opened-newest"
                onClick={this.onSortClick}
              >
                Newest opened
              </button>
              <button
                type="button"
                disabled={disabled}
                data-sort="opened-oldest"
                onClick={this.onSortClick}
              >
                Oldest opened
              </button>
              <button
                type="button"
                disabled={disabled}
                data-sort="status-attention"
                onClick={this.onSortClick}
              >
                Needs attention first
              </button>
              <button
                type="button"
                disabled={disabled}
                data-sort="status-clean"
                onClick={this.onSortClick}
              >
                Clean first
              </button>
              <button
                type="button"
                disabled={disabled}
                data-sort="favorites-first"
                onClick={this.onSortClick}
              >
                Favorites first
              </button>
              <button
                type="button"
                disabled={disabled}
                data-sort="favorites-last"
                onClick={this.onSortClick}
              >
                Favorites last
              </button>
            </div>
          </section>

          <div
            id="arrange-tabs-status"
            className="arrange-tabs-status"
            role="status"
            aria-live="polite"
          >
            {this.state.announcement}
          </div>
          <div className="arrange-tabs-actions">
            <button type="button" onClick={this.props.onClose}>
              Done
            </button>
          </div>
        </div>
      </Popover>
    )
  }
}
