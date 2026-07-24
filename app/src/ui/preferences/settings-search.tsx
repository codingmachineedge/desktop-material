import * as React from 'react'
import { PreferencesTab } from '../../models/preferences'
import { FilterMode, IMatch } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  ISettingsSearchEntry,
  groupSettingsResultsByTab,
  settingsSearchKeys,
  settingsTabNameKey,
} from '../../lib/settings-search/settings-search-catalog'
import { LanguageMode } from '../../models/language-mode'
import {
  translate,
  translateForAccessibleName,
  TranslationKey,
} from '../../lib/i18n'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

/** The stable audit + persistence identity for the settings search surface. */
export const SettingsSearchSurfaceId = 'preferences'

const ResultsListId = 'settings-search-results'

interface ISettingsSearchProps {
  /** The current search query text. */
  readonly query: string

  /** The active filter mode (fuzzy / substring / regex). */
  readonly filterMode: FilterMode

  /** Whether matching is case sensitive. */
  readonly caseSensitive: boolean

  /** The matched settings for the current query (empty when not searching). */
  readonly results: ReadonlyArray<IMatch<ISettingsSearchEntry>>

  /** The active language mode, used to render copy for the current profile. */
  readonly languageMode: LanguageMode

  /** Called as the query text changes. */
  readonly onQueryChange: (query: string) => void

  /** Called when the user cycles the filter mode. */
  readonly onFilterModeChange: (mode: FilterMode) => void

  /** Called when the user toggles case sensitivity. */
  readonly onCaseSensitiveChange: (caseSensitive: boolean) => void

  /** Called when a regex pattern is applied from the builder. */
  readonly onRegexPatternApply: (pattern: string) => void

  /** Called when the user opens a matching setting's tab. */
  readonly onNavigate: (tab: PreferencesTab, entryId: string) => void
}

interface ISettingsSearchState {
  readonly highlightedIndex: number
}

/**
 * The settings search field shown at the top of the Preferences rail. Because
 * the rail is present on every tab, this box is available from every settings
 * page. It filters a language-neutral catalog of settings and renders a
 * keyboard-navigable result list; choosing a result jumps to that setting's
 * tab.
 */
export class SettingsSearch extends React.Component<
  ISettingsSearchProps,
  ISettingsSearchState
> {
  public constructor(props: ISettingsSearchProps) {
    super(props)
    this.state = { highlightedIndex: props.results.length > 0 ? 0 : -1 }
  }

  public componentDidUpdate(prevProps: ISettingsSearchProps) {
    if (prevProps.results === this.props.results) {
      return
    }

    const count = this.props.results.length
    const clamped =
      count === 0 ? -1 : Math.min(this.state.highlightedIndex, count - 1)
    const next = count > 0 && clamped < 0 ? 0 : clamped
    if (next !== this.state.highlightedIndex) {
      this.setState({ highlightedIndex: next })
    }
  }

  private t = (key: TranslationKey, variables?: Record<string, string>) =>
    translate(key, this.props.languageMode, variables)

  private onQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.props.onQueryChange(event.currentTarget.value)
    this.setState({ highlightedIndex: 0 })
  }

  private onClear = () => {
    this.props.onQueryChange('')
    this.setState({ highlightedIndex: -1 })
  }

  private getSampleItems = (): ReadonlyArray<string> =>
    this.props.results.length > 0
      ? this.props.results.map(r => settingsSearchKeys(r.item).join(' · '))
      : []

  private selectAt(index: number) {
    const match = this.props.results[index]
    if (match !== undefined) {
      this.props.onNavigate(match.item.tab, match.item.id)
    }
  }

  private onResultClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const index = Number(event.currentTarget.dataset.resultIndex)
    if (Number.isInteger(index)) {
      this.selectAt(index)
    }
  }

  private onResultMouseEnter = (event: React.MouseEvent<HTMLButtonElement>) => {
    const index = Number(event.currentTarget.dataset.resultIndex)
    if (Number.isInteger(index)) {
      this.setState({ highlightedIndex: index })
    }
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const count = this.props.results.length
    let highlightedIndex = this.state.highlightedIndex

    switch (event.key) {
      case 'ArrowDown':
        if (count === 0) {
          return
        }
        highlightedIndex = (highlightedIndex + 1 + count) % count
        break
      case 'ArrowUp':
        if (count === 0) {
          return
        }
        highlightedIndex = (highlightedIndex - 1 + count) % count
        break
      case 'Home':
        highlightedIndex = count > 0 ? 0 : -1
        break
      case 'End':
        highlightedIndex = count - 1
        break
      case 'Enter':
        if (highlightedIndex >= 0) {
          event.preventDefault()
          this.selectAt(highlightedIndex)
        }
        return
      case 'Escape':
        if (this.props.query.length > 0) {
          event.preventDefault()
          this.onClear()
        }
        return
      default:
        return
    }

    event.preventDefault()
    this.setState({ highlightedIndex })
  }

  /**
   * Compute which characters of the displayed title to emphasize for the
   * current query. Works directly on the shown string (case-insensitive
   * contiguous match) so the highlight is always correct for the active display
   * language, independent of the language-neutral match keys.
   */
  private titleHighlightIndices(title: string): ReadonlyArray<number> {
    const query = this.props.query.trim()
    if (query.length === 0) {
      return []
    }

    const haystack = this.props.caseSensitive ? title : title.toLowerCase()
    const needle = this.props.caseSensitive ? query : query.toLowerCase()
    const at = haystack.indexOf(needle)
    if (at === -1) {
      return []
    }

    const indices = new Array<number>(needle.length)
    for (let i = 0; i < needle.length; i++) {
      indices[i] = at + i
    }
    return indices
  }

  /** Render a title with the matched character ranges emphasized. */
  private renderHighlighted(text: string, indices: ReadonlyArray<number>) {
    if (indices.length === 0) {
      return text
    }

    const marked = new Set(indices)
    const nodes: Array<React.ReactNode> = []
    let buffer = ''
    let bufferMarked = marked.has(0)

    const flush = (key: number) => {
      if (buffer.length === 0) {
        return
      }
      nodes.push(
        bufferMarked ? (
          <mark key={key} className="settings-search-mark">
            {buffer}
          </mark>
        ) : (
          <React.Fragment key={key}>{buffer}</React.Fragment>
        )
      )
      buffer = ''
    }

    for (let i = 0; i < text.length; i++) {
      const isMarked = marked.has(i)
      if (isMarked !== bufferMarked) {
        flush(i)
        bufferMarked = isMarked
      }
      buffer += text[i]
    }
    flush(text.length)

    return nodes
  }

  private renderResults() {
    if (this.props.query.trim().length === 0) {
      return null
    }

    if (this.props.results.length === 0) {
      return (
        <p className="settings-search-empty" role="status" aria-live="polite">
          {this.t('settingsSearch.noResults', { query: this.props.query })}
        </p>
      )
    }

    const groups = groupSettingsResultsByTab(this.props.results)
    let flatIndex = -1

    return (
      <ul
        id={ResultsListId}
        className="settings-search-results"
        role="listbox"
        aria-label={translateForAccessibleName(
          'settingsSearch.resultsHeading',
          {},
          this.props.languageMode
        )}
      >
        {groups.map(group => {
          const tabName = this.t(settingsTabNameKey(group.tab))
          return (
            <li
              key={`group-${group.tab}`}
              role="presentation"
              className="settings-search-group"
            >
              <div className="settings-search-group-label" aria-hidden={true}>
                {tabName}
              </div>
              <ul role="presentation" className="settings-search-group-list">
                {group.matches.map(match => {
                  flatIndex += 1
                  const index = flatIndex
                  const title = translate(
                    match.item.titleKey,
                    this.props.languageMode
                  )
                  const description = translate(
                    match.item.descriptionKey,
                    this.props.languageMode
                  )
                  const isHighlighted = index === this.state.highlightedIndex
                  const accessibleName = `${translateForAccessibleName(
                    match.item.titleKey,
                    {},
                    this.props.languageMode
                  )}, ${translateForAccessibleName(
                    'settingsSearch.inTab',
                    {
                      tab: translateForAccessibleName(
                        settingsTabNameKey(group.tab),
                        {},
                        this.props.languageMode
                      ),
                    },
                    this.props.languageMode
                  )}`
                  return (
                    <li key={match.item.id} role="presentation">
                      <button
                        id={`settings-search-result-${index}`}
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        aria-label={accessibleName}
                        className={`settings-search-result${
                          isHighlighted ? ' highlighted' : ''
                        }`}
                        data-result-index={index}
                        onClick={this.onResultClick}
                        onMouseEnter={this.onResultMouseEnter}
                      >
                        <span className="settings-search-result-copy">
                          <strong className="settings-search-result-title">
                            {this.renderHighlighted(
                              title,
                              this.titleHighlightIndices(title)
                            )}
                          </strong>
                          <span className="settings-search-result-desc">
                            {description}
                          </span>
                        </span>
                        <span
                          className="settings-search-result-tab"
                          aria-hidden={true}
                        >
                          {this.t('settingsSearch.inTab', { tab: tabName })}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ul>
    )
  }

  private renderStatus() {
    if (this.props.query.trim().length === 0) {
      return null
    }

    const count = this.props.results.length
    const message =
      count === 1
        ? this.t('settingsSearch.resultCountOne')
        : this.t('settingsSearch.resultCountMany', { count: String(count) })

    return (
      <div className="settings-search-status" role="status" aria-live="polite">
        {message}
        {count > 0 && (
          <span className="settings-search-hint">
            {' '}
            {this.t('settingsSearch.jumpHint')}
          </span>
        )}
      </div>
    )
  }

  public render() {
    const isSearching = this.props.query.trim().length > 0
    const activeDescendant =
      isSearching && this.state.highlightedIndex >= 0
        ? `settings-search-result-${this.state.highlightedIndex}`
        : undefined

    const inputLabel = translateForAccessibleName(
      'settingsSearch.inputLabel',
      {},
      this.props.languageMode
    )

    return (
      <div className="settings-search">
        <div className="settings-search-field">
          <Octicon className="settings-search-icon" symbol={octicons.search} />
          <input
            data-search-surface-id="preferences"
            className="settings-search-input"
            type="search"
            role="combobox"
            aria-label={inputLabel}
            aria-controls={ResultsListId}
            aria-expanded={isSearching}
            aria-activedescendant={activeDescendant}
            placeholder={this.t('settingsSearch.inputPlaceholder')}
            autoComplete="off"
            value={this.props.query}
            onChange={this.onQueryChange}
            onKeyDown={this.onKeyDown}
          />
          {this.props.query.length > 0 && (
            <button
              type="button"
              className="settings-search-clear"
              aria-label={translateForAccessibleName(
                'settingsSearch.clear',
                {},
                this.props.languageMode
              )}
              onClick={this.onClear}
            >
              <Octicon symbol={octicons.x} />
            </button>
          )}
        </div>
        <FilterModeControl
          searchSurfaceId="preferences"
          mode={this.props.filterMode}
          caseSensitive={this.props.caseSensitive}
          onModeChange={this.props.onFilterModeChange}
          onCaseSensitiveChange={this.props.onCaseSensitiveChange}
          regexBuilderTarget={inputLabel}
          getSampleItems={this.getSampleItems}
          filterText={this.props.query}
          onRegexPatternApply={this.props.onRegexPatternApply}
        />
        {this.renderResults()}
        {this.renderStatus()}
      </div>
    )
  }
}
