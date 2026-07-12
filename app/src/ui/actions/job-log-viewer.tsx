import * as React from 'react'
import { AutoSizer, List, ListRowProps } from 'react-virtualized'
import memoizeOne from 'memoize-one'
import { IAPIWorkflowJob } from '../../lib/api'
import { ActionsLogParser } from '../../lib/actions-log-parser/action-log-parser'
import {
  ILogLineTemplateData,
  IParsedContent,
} from '../../lib/actions-log-parser/actions-log-parser-objects'
import { APIError } from '../../lib/http'
import { Button } from '../lib/button'
import { LinkButton } from '../lib/link-button'

interface IJobLogViewerProps {
  readonly job: IAPIWorkflowJob
  readonly log: string
  readonly loading: boolean
  readonly error: Error | null
  readonly onClose: () => void
}

interface IJobLogViewerState {
  readonly search: string
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
  private readonly groupToggleHandlers = new Map<number, () => void>()
  private parseLog = memoizeOne((log: string, prefix: string) =>
    new ActionsLogParser(log, prefix).getParsedLogLinesTemplateData()
  )
  private getVisibleLines = memoizeOne(getVisibleActionsLogLines)
  private findMatches = memoizeOne(
    (lines: ReadonlyArray<ILogLineTemplateData>, search: string) => {
      const normalized = search.trim().toLowerCase()
      if (!normalized) {
        return []
      }
      return lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) =>
          getActionsLogLineText(line).toLowerCase().includes(normalized)
        )
    }
  )

  public constructor(props: IJobLogViewerProps) {
    super(props)
    this.state = { search: '', match: 0, collapsedGroups: new Set() }
  }

  private getLines() {
    const prefix = this.props.job.html_url
      ? `${this.props.job.html_url}#step`
      : ''
    return this.getVisibleLines(
      this.parseLog(this.props.log, prefix),
      this.state.collapsedGroups
    )
  }

  private getMatches(lines: ReadonlyArray<ILogLineTemplateData>) {
    return this.findMatches(lines, this.state.search)
  }

  private onSearch = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState(
      { search: event.currentTarget.value, match: 0 },
      this.scrollToMatch
    )

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
    const style: React.CSSProperties = {}
    for (const declaration of content.styles) {
      if (declaration.startsWith('color:')) {
        style.color = declaration.slice(6)
      }
      if (declaration.startsWith('background-color:')) {
        style.backgroundColor = declaration.slice('background-color:'.length)
      }
    }
    return (
      <span key={index} className={content.classes.join(' ')} style={style}>
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
    const matches = this.getMatches(lines)
    const expired =
      this.props.error instanceof APIError &&
      this.props.error.responseStatus === 410

    return (
      <section
        className="actions-log-viewer"
        aria-label={`${this.props.job.name} logs`}
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
            type="search"
            value={this.state.search}
            onChange={this.onSearch}
            placeholder="Search logs"
            aria-label="Search logs"
          />
          <span>
            {matches.length === 0
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
    )
  }
}
