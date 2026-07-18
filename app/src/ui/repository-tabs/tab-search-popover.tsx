import * as React from 'react'
import {
  Popover,
  PopoverAnchorPosition,
  PopoverDecoration,
} from '../lib/popover'
import { IRepositoryTab } from '../../models/repository-tab'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'

interface ITabSearchPopoverProps {
  readonly tabs: ReadonlyArray<IRepositoryTab>
  readonly activeTabId: string | null
  readonly anchor: HTMLElement | null
  readonly resolveLabel: (tab: IRepositoryTab) => string
  readonly resolveMatchKeys: (tab: IRepositoryTab) => ReadonlyArray<string>
  readonly onSelect: (tab: IRepositoryTab) => void
  readonly onClose: () => void
}

interface ITabSearchPopoverState {
  readonly query: string
  readonly filterMode: FilterMode
  readonly filterCaseSensitive: boolean
  readonly highlightedIndex: number
}

const ResultListId = 'tab-search-results'

/** The persistence id for the tab search's filter mode. */
const TabSearchFilterListId = 'tab-search'

/** Accessible keyboard switcher for every open repository tab. */
export class TabSearchPopover extends React.Component<
  ITabSearchPopoverProps,
  ITabSearchPopoverState
> {
  public constructor(props: ITabSearchPopoverProps) {
    super(props)
    const activeIndex = props.tabs.findIndex(
      tab => tab.id === props.activeTabId
    )
    this.state = {
      query: '',
      filterMode: readPersistedFilterMode(TabSearchFilterListId),
      filterCaseSensitive: false,
      highlightedIndex:
        activeIndex === -1 && props.tabs.length > 0 ? 0 : activeIndex,
    }
  }

  public componentDidUpdate() {
    const resultCount = this.getResults().length
    const nextIndex =
      resultCount === 0
        ? -1
        : Math.min(Math.max(this.state.highlightedIndex, 0), resultCount - 1)
    if (nextIndex !== this.state.highlightedIndex) {
      this.setState({ highlightedIndex: nextIndex })
    }
  }

  private getResults(): ReadonlyArray<IRepositoryTab> {
    if (this.state.query.trim().length === 0) {
      return this.props.tabs
    }

    const { results } = matchWithMode(
      this.state.query,
      this.props.tabs,
      this.props.resolveMatchKeys,
      {
        mode: this.state.filterMode,
        caseSensitive: this.state.filterCaseSensitive,
      }
    )

    return results.map(r => r.item)
  }

  private onQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({
      query: event.currentTarget.value,
      highlightedIndex: 0,
    })
  }

  private onFilterModeChange = (filterMode: FilterMode) => {
    persistFilterMode(TabSearchFilterListId, filterMode)
    this.setState({ filterMode, highlightedIndex: 0 })
  }

  private onFilterCaseSensitiveChange = (filterCaseSensitive: boolean) => {
    this.setState({ filterCaseSensitive, highlightedIndex: 0 })
  }

  private onRegexPatternApply = (pattern: string) => {
    this.setState({ query: pattern, highlightedIndex: 0 })
  }

  private getFilterSampleItems = (): ReadonlyArray<string> =>
    this.props.tabs.map(tab => this.props.resolveMatchKeys(tab).join(' · '))

  private selectResult(tab: IRepositoryTab) {
    this.props.onSelect(tab)
    this.props.onClose()
  }

  private onResultClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const tab = this.props.tabs.find(
      candidate => candidate.id === event.currentTarget.dataset.tabId
    )
    if (tab !== undefined) {
      this.selectResult(tab)
    }
  }

  private onResultMouseEnter = (event: React.MouseEvent<HTMLButtonElement>) => {
    const index = Number(event.currentTarget.dataset.resultIndex)
    if (Number.isInteger(index)) {
      this.setState({ highlightedIndex: index })
    }
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const results = this.getResults()
    let highlightedIndex = this.state.highlightedIndex

    switch (event.key) {
      case 'ArrowDown':
        if (results.length > 0) {
          highlightedIndex =
            (highlightedIndex + 1 + results.length) % results.length
        }
        break
      case 'ArrowUp':
        if (results.length > 0) {
          highlightedIndex =
            (highlightedIndex - 1 + results.length) % results.length
        }
        break
      case 'Home':
        highlightedIndex = results.length > 0 ? 0 : -1
        break
      case 'End':
        highlightedIndex = results.length - 1
        break
      case 'Enter': {
        const selected = results[highlightedIndex]
        if (selected !== undefined) {
          event.preventDefault()
          this.selectResult(selected)
        }
        return
      }
      default:
        return
    }

    event.preventDefault()
    this.setState({ highlightedIndex })
  }

  public render() {
    const results = this.getResults()
    const activeDescendant =
      this.state.highlightedIndex >= 0
        ? `tab-search-result-${this.state.highlightedIndex}`
        : undefined

    return (
      <Popover
        anchor={this.props.anchor}
        anchorPosition={PopoverAnchorPosition.BottomRight}
        decoration={PopoverDecoration.Balloon}
        ariaLabelledby="tab-search-title"
        ariaDescribedBy="tab-search-status"
        onClickOutside={this.props.onClose}
      >
        <div className="tab-search-popover">
          <header className="tab-search-header">
            <h3 id="tab-search-title">Search tabs</h3>
            <p>Find an open tab by name, alias, path, or clone URL.</p>
          </header>

          <div className="tab-search-filter-row">
            <input
              className="tab-search-input"
              type="search"
              role="combobox"
              aria-label="Search open tabs"
              aria-controls={ResultListId}
              aria-expanded={true}
              aria-activedescendant={activeDescendant}
              autoComplete="off"
              autoFocus={true}
              value={this.state.query}
              onChange={this.onQueryChange}
              onKeyDown={this.onKeyDown}
            />
            <FilterModeControl
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

          {results.length === 0 ? (
            <p className="tab-search-empty">No open tabs match this search.</p>
          ) : (
            <ul
              id={ResultListId}
              className="tab-search-results"
              role="listbox"
              aria-label="Matching repository tabs"
            >
              {results.map((tab, index) => {
                const label = this.props.resolveLabel(tab)
                const isActive = tab.id === this.props.activeTabId
                const isHighlighted = index === this.state.highlightedIndex
                return (
                  <li key={tab.id} role="presentation">
                    <button
                      id={`tab-search-result-${index}`}
                      className={`tab-search-result${
                        isHighlighted ? ' highlighted' : ''
                      }${isActive ? ' active' : ''}`}
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      aria-label={`${label}${isActive ? ', active' : ''}${
                        tab.isPinned === true ? ', pinned' : ''
                      }${tab.isFavorite === true ? ', favorite' : ''}`}
                      data-tab-id={tab.id}
                      data-result-index={index}
                      onClick={this.onResultClick}
                      onMouseEnter={this.onResultMouseEnter}
                    >
                      <span className="tab-search-result-copy">
                        <strong>{label}</strong>
                        <span>{tab.repositoryPath}</span>
                      </span>
                      <span className="tab-search-result-chips">
                        {isActive && <span>Active</span>}
                        {tab.isPinned === true && <span>Pinned</span>}
                        {tab.isFavorite === true && <span>Favorite</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <div
            id="tab-search-status"
            className="tab-search-status"
            role="status"
            aria-live="polite"
          >
            {results.length === 1
              ? '1 matching tab'
              : `${results.length} matching tabs`}
          </div>
        </div>
      </Popover>
    )
  }
}
