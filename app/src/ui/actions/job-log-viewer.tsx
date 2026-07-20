import * as React from 'react'
import { AutoSizer, List, ListRowProps } from 'react-virtualized'
import memoizeOne from 'memoize-one'
import { IActionsJob } from '../../lib/actions-jobs'
import { ActionsLogParser } from '../../lib/actions-log-parser/action-log-parser'
import {
  ILogLineTemplateData,
  IParsedContent,
} from '../../lib/actions-log-parser/actions-log-parser-objects'
import { APIError } from '../../lib/http'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { Button } from '../lib/button'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'
import { LinkButton } from '../lib/link-button'
import { trapActionsDialogFocus } from './actions-dialog-focus'

/** localStorage key used to persist the find-in-log filter mode. */
const JobLogFilterListId = 'actions-job-log'

interface IJobLogViewerProps {
  readonly job: IActionsJob
  readonly log: string
  readonly loading: boolean
  readonly error: Error | null
  readonly onClose: () => void
}

interface IJobLogViewerState {
  readonly search: string
  readonly searchMode: FilterMode
  readonly searchCaseSensitive: boolean
  readonly match: number
  readonly collapsedGroups: ReadonlySet<number>
}

export function getActionsLogLineText(line: ILogLineTemplateData): string {
  return line.lineContent
    .flatMap(content =>
      content.output.flatMap(item => [item.entry, item.entryUrl, item.afterUrl])
    )
    .filter((value): value is string => value !== undefined)
    .join('')
}

export function getVisibleActionsLogLines(
  lines: ReadonlyArray<ILogLineTemplateData>,
  collapsedGroups: ReadonlySet<number>
): ReadonlyArray<ILogLineTemplateData> {
  let groupCollapsed = false
  const visible = new Array<ILogLineTemplateData>()
  for (const line of lines) {
    if (line.isGroup) {
      groupCollapsed = collapsedGroups.has(line.lineNumber)
      visible.push(line)
      continue
    }
    if (!line.inGroup) {
      groupCollapsed = false
    }
    if (!groupCollapsed) {
      visible.push(line)
    }
  }
  return visible
}

export class JobLogViewer extends React.Component<
  IJobLogViewerProps,
  IJobLogViewerState
> {
  private list: List | null = null
  private viewer: HTMLElement | null = null
  private previousFocus: HTMLElement | null = null
  private readonly groupToggleHandlers = new Map<number, () => void>()
  private parseLog = memoizeOne((log: string, prefix: string) =>
    new ActionsLogParser(log, prefix).getParsedLogLinesTemplateData()
  )
  private getVisibleLines = memoizeOne(getVisibleActionsLogLines)
  private findMatches = memoizeOne(
    (
      lines: ReadonlyArray<ILogLineTemplateData>,
      search: string,
      mode: FilterMode,
      caseSensitive: boolean
    ) => {
      const query = search.trim()
      if (query.length === 0) {
        return { matches: [], regexError: null }
      }
      const { results, regexError } = matchWithMode(
        query,
        lines.map((line, index) => ({ line, index })),
        ({ line }) => [getActionsLogLineText(line)],
        { mode, caseSensitive }
      )
      if (regexError !== null) {
        // An invalid pattern passes every line through matchWithMode; treating
        // that as "every line matches" would make navigation meaningless.
        return { matches: [], regexError }
      }
      // Fuzzy results are score-sorted; Previous/Next should walk line order.
      return {
        matches: results.map(r => r.item).sort((a, b) => a.index - b.index),
        regexError: null,
      }
    }
  )

  public constructor(props: IJobLogViewerProps) {
    super(props)
    this.state = {
      search: '',
      searchMode: readPersistedFilterMode(JobLogFilterListId),
      searchCaseSensitive: false,
      match: 0,
      collapsedGroups: new Set(),
    }
  }

  public componentDidMount() {
    this.previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    this.viewer?.focus()
  }

  public componentWillUnmount() {
    if (this.previousFocus?.isConnected) {
      this.previousFocus.focus()
    }
  }

  private setViewerRef = (viewer: HTMLElement | null) => {
    this.viewer = viewer
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    // Keys pressed inside the regex builder overlay belong to the builder: it
    // dismisses itself on Escape via a window-level listener that would never
    // fire past this handler's stopPropagation.
    if (
      event.target instanceof Element &&
      event.target.closest('.regex-builder-overlay') !== null
    ) {
      return
    }
    event.stopPropagation()
    trapActionsDialogFocus(event, event.currentTarget)
    if (event.key === 'Escape') {
      event.preventDefault()
      this.props.onClose()
    }
  }

  private getLines() {
    const prefix = this.props.job.htmlUrl
      ? `${this.props.job.htmlUrl}#step`
      : ''
    return this.getVisibleLines(
      this.parseLog(this.props.log, prefix),
      this.state.collapsedGroups
    )
  }

  private getSearchResult(lines: ReadonlyArray<ILogLineTemplateData>) {
    return this.findMatches(
      lines,
      this.state.search,
      this.state.searchMode,
      this.state.searchCaseSensitive
    )
  }

  private getMatches(lines: ReadonlyArray<ILogLineTemplateData>) {
    return this.getSearchResult(lines).matches
  }

  private onSearch = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState(
      { search: event.currentTarget.value, match: 0 },
      this.scrollToMatch
    )

  private onSearchModeChange = (searchMode: FilterMode) => {
    persistFilterMode(JobLogFilterListId, searchMode)
    this.setState({ searchMode, match: 0 }, this.scrollToMatch)
  }

  private onSearchCaseSensitiveChange = (searchCaseSensitive: boolean) =>
    this.setState({ searchCaseSensitive, match: 0 }, this.scrollToMatch)

  private onSearchPatternApply = (search: string) =>
    this.setState({ search, match: 0 }, this.scrollToMatch)

  private getSearchSampleItems = () =>
    this.getLines().slice(0, 50).map(getActionsLogLineText)

  private nextMatch = () => {
    const count = this.getMatches(this.getLines()).length
    if (count > 0) {
      this.setState(
        { match: (this.state.match + 1) % count },
        this.scrollToMatch
      )
    }
  }

  private previousMatch = () => {
    const count = this.getMatches(this.getLines()).length
    if (count > 0) {
      this.setState(
        { match: (this.state.match + count - 1) % count },
        this.scrollToMatch
      )
    }
  }

  private scrollToMatch = () => {
    const matches = this.getMatches(this.getLines())
    const target = matches[this.state.match]
    if (target) {
      this.list?.scrollToRow(target.index)
    }
  }

  private toggleGroup = (lineNumber: number) => {
    const collapsedGroups = new Set(this.state.collapsedGroups)
    if (collapsedGroups.has(lineNumber)) {
      collapsedGroups.delete(lineNumber)
    } else {
      collapsedGroups.add(lineNumber)
    }
    this.setState({ collapsedGroups })
  }

  private getGroupToggleHandler(lineNumber: number) {
    let handler = this.groupToggleHandlers.get(lineNumber)
    if (handler === undefined) {
      handler = () => this.toggleGroup(lineNumber)
      this.groupToggleHandlers.set(lineNumber, handler)
    }
    return handler
  }

  private setListRef = (list: List | null) => {
    this.list = list
  }

  private renderParsedContent(content: IParsedContent, index: number) {
    return (
      <span key={index} className={content.classes.join(' ')}>
        {content.output.map((item, outputIndex) => (
          <React.Fragment key={outputIndex}>
            {item.entry}
            {item.entryUrl && (
              <LinkButton uri={item.entryUrl}>{item.entryUrl}</LinkButton>
            )}
            {item.afterUrl}
          </React.Fragment>
        ))}
      </span>
    )
  }

  private renderRow = ({ index, key, style }: ListRowProps) => {
    const lines = this.getLines()
    const line = lines[index]
    const isMatch = this.getMatches(lines).some(match => match.index === index)
    return (
      <div
        key={key}
        style={style}
        className={`actions-log-line ${line.className} ${
          isMatch ? 'search-match' : ''
        }`}
      >
        <button
          type="button"
          className="actions-log-number"
          disabled={!line.isGroup}
          onClick={this.getGroupToggleHandler(line.lineNumber)}
          aria-label={
            line.isGroup
              ? `Toggle log group at line ${line.lineNumber}`
              : undefined
          }
          aria-expanded={
            line.isGroup
              ? !this.state.collapsedGroups.has(line.lineNumber)
              : undefined
          }
        >
          {line.isGroup
            ? this.state.collapsedGroups.has(line.lineNumber)
              ? '▶'
              : '▼'
            : line.lineNumber}
        </button>
        <code>
          {line.lineContent.map((content, contentIndex) =>
            this.renderParsedContent(content, contentIndex)
          )}
        </code>
      </div>
    )
  }

  public render() {
    const lines = this.getLines()
    const { matches, regexError } = this.getSearchResult(lines)
    const expired =
      this.props.error instanceof APIError &&
      this.props.error.responseStatus === 410

    return (
      <div className="actions-dialog-layer">
        {/* The log overlay handles Escape and contains keyboard focus. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <section
          className="actions-log-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={`${this.props.job.name} logs`}
          tabIndex={-1}
          ref={this.setViewerRef}
          onKeyDown={this.onKeyDown}
        >
          <header>
            <div>
              <span className="eyebrow">Job log</span>
              <h2>{this.props.job.name}</h2>
            </div>
            <Button onClick={this.props.onClose}>Close</Button>
          </header>
          <div className="actions-log-search">
            <input
              data-search-surface-id="actions-job-log"
              type="search"
              value={this.state.search}
              onChange={this.onSearch}
              placeholder="Search logs"
              aria-label="Search logs"
            />
            <FilterModeControl
              searchSurfaceId="actions-job-log"
              mode={this.state.searchMode}
              caseSensitive={this.state.searchCaseSensitive}
              onModeChange={this.onSearchModeChange}
              onCaseSensitiveChange={this.onSearchCaseSensitiveChange}
              regexBuilderTarget="Job log"
              getSampleItems={this.getSearchSampleItems}
              filterText={this.state.search}
              onRegexPatternApply={this.onSearchPatternApply}
            />
            <span role="status" aria-live="polite" aria-atomic="true">
              {regexError !== null
                ? regexError
                : matches.length === 0
                ? 'No matches'
                : `${Math.min(this.state.match + 1, matches.length)} of ${
                    matches.length
                  }`}
            </span>
            <Button
              size="small"
              disabled={matches.length === 0}
              onClick={this.previousMatch}
            >
              Previous
            </Button>
            <Button
              size="small"
              disabled={matches.length === 0}
              onClick={this.nextMatch}
            >
              Next
            </Button>
          </div>
          {this.props.loading ? (
            <div className="actions-loading">Downloading job log…</div>
          ) : this.props.error ? (
            <div className="actions-inline-error" role="alert">
              {expired
                ? 'These workflow logs have expired on GitHub.'
                : this.props.error.message}
            </div>
          ) : (
            <div className="actions-log-list">
              <AutoSizer>
                {({ width, height }) => (
                  <List
                    ref={this.setListRef}
                    width={width}
                    height={height}
                    rowCount={lines.length}
                    rowHeight={24}
                    rowRenderer={this.renderRow}
                    overscanRowCount={20}
                  />
                )}
              </AutoSizer>
            </div>
          )}
        </section>
      </div>
    )
  }
}
