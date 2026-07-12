import * as React from 'react'

import classNames from 'classnames'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { RelativeTime } from '../relative-time'
import { TextBox } from '../lib/text-box'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'

const VersionHistoryPageSize = 50

/** The common commit shape rendered by all versioned local stores. */
export interface IVersionHistoryEntry {
  readonly sha: string
  readonly shortSha: string
  readonly summary: string
  readonly body: string
  readonly committedAt: Date
  readonly undoOf: string | null
  readonly redoOf: string | null
  readonly restoreOf: string | null
}

/** A page of append-only version history. */
export interface IVersionHistoryPage {
  readonly entries: ReadonlyArray<IVersionHistoryEntry>
  readonly total: number
  readonly hasMore: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
}

/**
 * Store-specific operations consumed by the shared history manager. Settings,
 * notifications, and future Git-backed stores adapt their APIs to this seam.
 */
export interface IVersionedStoreHistorySource {
  readonly getHistory: (
    skip?: number,
    limit?: number
  ) => Promise<IVersionHistoryPage>
  readonly getFiles: (sha: string) => Promise<ReadonlyArray<string>>
  readonly getDiff: (sha: string, file?: string) => Promise<string>
  readonly undoLastChange: () => Promise<void>
  readonly redoLastChange: () => Promise<void>
  readonly restoreTo: (sha: string) => Promise<void>
}

export interface IVersionedStoreHistoryProps {
  readonly title: string
  readonly timelineLabel: string
  readonly description: string
  readonly emptyTitle?: string
  readonly emptyDescription?: string
  readonly className?: string
  readonly source: IVersionedStoreHistorySource
  readonly onStoreMutated?: () => Promise<void> | void
  readonly onDismissed: () => void
}

type VersionHistoryOperation = 'undo' | 'redo' | 'restore'

interface IVersionedStoreHistoryState {
  readonly page: IVersionHistoryPage | null
  readonly selectedSha: string | null
  readonly selectedFile: string | null
  readonly filesBySha: Readonly<
    Record<string, ReadonlyArray<string> | undefined>
  >
  readonly diff: string | null
  readonly loadingHistory: boolean
  readonly loadingMore: boolean
  readonly loadingDiff: boolean
  readonly operation: VersionHistoryOperation | null
  readonly confirmRestoreSha: string | null
  readonly error: string | null
  readonly filterText: string
  readonly filterMode: FilterMode
  readonly filterCaseSensitive: boolean
}

export type VersionHistoryDiffLineKind =
  | 'addition'
  | 'deletion'
  | 'hunk'
  | 'header'
  | 'context'

/** Classify a raw unified-diff line for the read-only history viewer. */
export function classifyVersionHistoryDiffLine(
  line: string
): VersionHistoryDiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return 'header'
  }

  if (line.startsWith('+')) {
    return 'addition'
  }

  if (line.startsWith('-')) {
    return 'deletion'
  }

  if (line.startsWith('@@')) {
    return 'hunk'
  }

  if (
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('new file mode ') ||
    line.startsWith('deleted file mode ')
  ) {
    return 'header'
  }

  return 'context'
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A reusable, non-destructive manager for local Git-backed stores. Every undo,
 * redo, and restore action creates a new commit, preserving the full timeline.
 */
export class VersionedStoreHistory extends React.Component<
  IVersionedStoreHistoryProps,
  IVersionedStoreHistoryState
> {
  private isMountedFlag = false
  private selectionRequest = 0
  private historyRequestGeneration = 0
  private readonly loadingFiles = new Map<
    string,
    Promise<ReadonlyArray<string> | null>
  >()

  public constructor(props: IVersionedStoreHistoryProps) {
    super(props)

    this.state = {
      page: null,
      selectedSha: null,
      selectedFile: null,
      filesBySha: {},
      diff: null,
      loadingHistory: true,
      loadingMore: false,
      loadingDiff: false,
      operation: null,
      confirmRestoreSha: null,
      error: null,
      filterText: '',
      filterMode: FilterMode.Fuzzy,
      filterCaseSensitive: false,
    }
  }

  public componentDidMount() {
    this.isMountedFlag = true
    window.addEventListener('keydown', this.onWindowKeyDown)
    this.loadHistory(true)
  }

  public componentWillUnmount() {
    this.isMountedFlag = false
    this.selectionRequest++
    this.historyRequestGeneration++
    window.removeEventListener('keydown', this.onWindowKeyDown)
  }

  private onWindowKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return
    }

    const shortcutKey = __DARWIN__ ? event.metaKey : event.ctrlKey
    if (event.key === 'Escape' || (shortcutKey && event.key === 'w')) {
      event.preventDefault()
      this.props.onDismissed()
    }
  }

  private loadHistory = async (reset: boolean) => {
    const generation = ++this.historyRequestGeneration
    const previousEntries = reset ? [] : this.state.page?.entries ?? []

    this.setState({
      loadingHistory: reset,
      loadingMore: !reset,
      error: null,
    })

    try {
      const page = await this.props.source.getHistory(
        previousEntries.length,
        VersionHistoryPageSize
      )

      if (!this.isMountedFlag || generation !== this.historyRequestGeneration) {
        return
      }

      const entries = reset
        ? page.entries
        : [...previousEntries, ...page.entries]
      const nextPage = { ...page, entries }
      const selectedSha = reset
        ? entries[0]?.sha ?? null
        : this.state.selectedSha

      this.setState(
        {
          page: nextPage,
          selectedSha,
          selectedFile: reset ? null : this.state.selectedFile,
          diff: reset ? null : this.state.diff,
          loadingHistory: false,
          loadingMore: false,
        },
        () => {
          if (generation !== this.historyRequestGeneration) {
            return
          }

          if (reset && selectedSha !== null) {
            this.loadSelectedEntry(selectedSha)
          }
        }
      )
    } catch (error) {
      if (!this.isMountedFlag || generation !== this.historyRequestGeneration) {
        return
      }

      this.setState({
        loadingHistory: false,
        loadingMore: false,
        error: getErrorMessage(error),
      })
    }
  }

  private loadFiles = (sha: string): Promise<ReadonlyArray<string> | null> => {
    const cached = this.state.filesBySha[sha]
    if (cached !== undefined) {
      return Promise.resolve(cached)
    }

    const pending = this.loadingFiles.get(sha)
    if (pending !== undefined) {
      return pending
    }

    const request = this.fetchFiles(sha)
    this.loadingFiles.set(sha, request)
    return request
  }

  private fetchFiles = async (
    sha: string
  ): Promise<ReadonlyArray<string> | null> => {
    try {
      const files = await this.props.source.getFiles(sha)

      if (this.isMountedFlag) {
        this.setState(state => ({
          filesBySha: { ...state.filesBySha, [sha]: files },
        }))
      }

      return files
    } catch (error) {
      if (this.isMountedFlag && this.state.selectedSha === sha) {
        this.setState({ error: getErrorMessage(error) })
      }
      return null
    } finally {
      this.loadingFiles.delete(sha)
    }
  }

  private loadSelectedEntry = async (sha: string) => {
    const request = ++this.selectionRequest
    const files = await this.loadFiles(sha)

    if (
      !this.isMountedFlag ||
      request !== this.selectionRequest ||
      this.state.selectedSha !== sha
    ) {
      return
    }

    const selectedFile = files?.[0] ?? null
    this.setState({ selectedFile }, () =>
      this.loadDiff(sha, selectedFile ?? undefined, request)
    )
  }

  private loadDiff = async (
    sha: string,
    file: string | undefined,
    request: number
  ) => {
    this.setState({ loadingDiff: true, diff: null, error: null })

    try {
      const diff = await this.props.source.getDiff(sha, file)
      if (
        this.isMountedFlag &&
        request === this.selectionRequest &&
        this.state.selectedSha === sha &&
        this.state.selectedFile === (file ?? null)
      ) {
        this.setState({ diff, loadingDiff: false })
      }
    } catch (error) {
      if (this.isMountedFlag && request === this.selectionRequest) {
        this.setState({
          diff: null,
          loadingDiff: false,
          error: getErrorMessage(error),
        })
      }
    }
  }

  private selectEntry = (sha: string) => {
    if (sha === this.state.selectedSha) {
      return
    }

    this.selectionRequest++
    this.setState(
      {
        selectedSha: sha,
        selectedFile: null,
        diff: null,
        loadingDiff: false,
        confirmRestoreSha: null,
        error: null,
      },
      () => this.loadSelectedEntry(sha)
    )
  }

  private selectFile = (file: string) => {
    const sha = this.state.selectedSha
    if (sha === null || file === this.state.selectedFile) {
      return
    }

    const request = ++this.selectionRequest
    this.setState({ selectedFile: file }, () =>
      this.loadDiff(sha, file, request)
    )
  }

  private runOperation = async (
    operation: VersionHistoryOperation,
    action: () => Promise<void>
  ) => {
    this.selectionRequest++
    this.historyRequestGeneration++
    this.setState({
      loadingHistory: false,
      loadingMore: false,
      operation,
      confirmRestoreSha: null,
      error: null,
    })

    try {
      await action()
      await this.props.onStoreMutated?.()
      if (this.isMountedFlag) {
        await this.loadHistory(true)
      }
    } catch (error) {
      if (this.isMountedFlag) {
        this.setState({ error: getErrorMessage(error) })
      }
    } finally {
      if (this.isMountedFlag) {
        this.setState({ operation: null })
      }
    }
  }

  private undo = () =>
    this.runOperation('undo', () => this.props.source.undoLastChange())

  private redo = () =>
    this.runOperation('redo', () => this.props.source.redoLastChange())

  private restore = (sha: string) =>
    this.runOperation('restore', () => this.props.source.restoreTo(sha))

  private confirmRestore = (sha: string) => {
    this.setState({ confirmRestoreSha: sha })
  }

  private cancelRestore = () => {
    this.setState({ confirmRestoreSha: null })
  }

  private loadMore = () => this.loadHistory(false)

  private onFilterTextChanged = (filterText: string) => {
    this.setState({ filterText })
  }

  private onFilterModeChanged = (filterMode: FilterMode) => {
    this.setState({ filterMode })
  }

  private onFilterCaseSensitiveChanged = (filterCaseSensitive: boolean) => {
    this.setState({ filterCaseSensitive })
  }

  private getFilterSamples = () =>
    (this.state.page?.entries ?? []).map(entry =>
      [entry.summary, entry.body, entry.shortSha].filter(Boolean).join(' · ')
    )

  private getFilteredEntries() {
    const entries = this.state.page?.entries ?? []
    const { filterText, filterMode, filterCaseSensitive, filesBySha } =
      this.state
    if (filterText.length === 0) {
      return { entries, regexError: null }
    }

    const result = matchWithMode(
      filterText,
      entries,
      entry => [
        entry.summary,
        entry.body,
        entry.sha,
        entry.shortSha,
        entry.committedAt.toISOString(),
        entry.undoOf === null ? '' : 'undo',
        entry.redoOf === null ? '' : 'redo',
        entry.restoreOf === null ? '' : 'restore',
        ...(filesBySha[entry.sha] ?? []),
      ],
      { mode: filterMode, caseSensitive: filterCaseSensitive }
    )

    return {
      entries: result.results.map(match => match.item),
      regexError: result.regexError,
    }
  }

  private renderFilter() {
    const { filterText, filterMode, filterCaseSensitive, page } = this.state
    const result = this.getFilteredEntries()
    return (
      <div className="versioned-store-history-filter">
        <div className="versioned-store-history-filter-row">
          <TextBox
            className="versioned-store-history-filter-input"
            type="search"
            ariaLabel="Search version history"
            placeholder="Search messages, hashes, dates, or files"
            value={filterText}
            displayClearButton={true}
            prefixedIcon={octicons.search}
            onValueChanged={this.onFilterTextChanged}
          />
          <FilterModeControl
            mode={filterMode}
            caseSensitive={filterCaseSensitive}
            onModeChange={this.onFilterModeChanged}
            onCaseSensitiveChange={this.onFilterCaseSensitiveChanged}
            regexBuilderTarget="version history"
            getSampleItems={this.getFilterSamples}
            filterText={filterText}
            onRegexPatternApply={this.onFilterTextChanged}
          />
        </div>
        <div
          className="versioned-store-history-filter-status"
          aria-live="polite"
        >
          {result.regexError !== null ? (
            <span className="versioned-store-history-filter-error">
              {result.regexError}
            </span>
          ) : filterText.length > 0 ? (
            <span>
              {result.entries.length} of {page?.entries.length ?? 0} loaded
              commits match
            </span>
          ) : (
            <span>Search the loaded timeline</span>
          )}
        </div>
      </div>
    )
  }

  private renderToolbar() {
    const { page, operation } = this.state
    const busy = operation !== null

    return (
      <div className="versioned-store-history-toolbar">
        <div className="versioned-store-history-introduction">
          <small>{this.props.description}</small>
        </div>
        <div className="versioned-store-history-actions">
          <Button
            className="versioned-store-history-undo"
            onClick={this.undo}
            disabled={busy || page === null || !page.canUndo}
          >
            <Octicon symbol={octicons.undo} /> Undo last
          </Button>
          <Button
            onClick={this.redo}
            disabled={busy || page === null || !page.canRedo}
          >
            <Octicon symbol={octicons.redo} /> Redo
          </Button>
          <span className="versioned-store-history-count">
            {page?.total ?? 0} {page?.total === 1 ? 'commit' : 'commits'}
          </span>
        </div>
      </div>
    )
  }

  private renderFileChips(sha: string) {
    const files = this.state.filesBySha[sha]
    if (files === undefined) {
      return (
        <span className="versioned-store-history-files-loading">
          {this.state.selectedSha === sha
            ? 'Loading files…'
            : 'Select to inspect'}
        </span>
      )
    }

    if (files.length === 0) {
      return (
        <span className="versioned-store-history-files-empty">No files</span>
      )
    }

    return files.map(file => (
      <span className="versioned-store-history-file-chip" key={file}>
        {file}
      </span>
    ))
  }

  private renderEntry(entry: IVersionHistoryEntry, index: number) {
    const selected = entry.sha === this.state.selectedSha
    const confirming = entry.sha === this.state.confirmRestoreSha
    const busy = this.state.operation !== null

    return (
      <li
        className={
          selected
            ? 'versioned-store-history-entry selected'
            : 'versioned-store-history-entry'
        }
        key={entry.sha}
      >
        <div className="versioned-store-history-entry-row">
          <button
            type="button"
            className="versioned-store-history-entry-select"
            role="option"
            aria-selected={selected}
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => this.selectEntry(entry.sha)}
          >
            <code>{entry.shortSha}</code>
            <span className="versioned-store-history-entry-copy">
              <strong>{entry.summary}</strong>
              <span className="versioned-store-history-entry-time">
                <RelativeTime date={entry.committedAt} />
              </span>
              <span className="versioned-store-history-entry-files">
                {this.renderFileChips(entry.sha)}
              </span>
            </span>
            {index === 0 ? (
              <span className="versioned-store-history-head">HEAD</span>
            ) : null}
          </button>
          <Button
            className="versioned-store-history-restore"
            size="small"
            ariaLabel={`Restore ${entry.summary}`}
            tooltip="Restore to this point"
            disabled={busy}
            // eslint-disable-next-line react/jsx-no-bind
            onClick={() => this.confirmRestore(entry.sha)}
          >
            <Octicon symbol={octicons.history} />
          </Button>
        </div>
        {confirming ? (
          <div
            className="versioned-store-history-restore-confirmation"
            role="group"
          >
            <span>Restore this point? This creates a new commit.</span>
            <Button size="small" onClick={this.cancelRestore}>
              Cancel
            </Button>
            <Button
              size="small"
              className="button-component-primary"
              // eslint-disable-next-line react/jsx-no-bind
              onClick={() => this.restore(entry.sha)}
            >
              Restore
            </Button>
          </div>
        ) : null}
      </li>
    )
  }

  private renderHistoryList() {
    const { page, loadingHistory, loadingMore } = this.state

    if (loadingHistory) {
      return (
        <div className="versioned-store-history-empty">
          <Octicon className="spin" symbol={octicons.sync} /> Loading history…
        </div>
      )
    }

    if (page === null || page.entries.length === 0) {
      return (
        <div className="versioned-store-history-empty">
          <Octicon symbol={octicons.history} />
          <strong>{this.props.emptyTitle ?? 'No version history yet'}</strong>
          <span>
            {this.props.emptyDescription ??
              'The first committed change will appear here.'}
          </span>
        </div>
      )
    }

    const result = this.getFilteredEntries()

    return (
      <>
        {this.renderFilter()}
        {result.entries.length === 0 ? (
          <div className="versioned-store-history-empty filtered">
            <Octicon symbol={octicons.search} />
            <strong>No matching history</strong>
            <span>Try another term or matching mode.</span>
          </div>
        ) : (
          <ol className="versioned-store-history-list" role="listbox">
            {result.entries.map(entry =>
              this.renderEntry(entry, page.entries.indexOf(entry))
            )}
          </ol>
        )}
        {page.hasMore ? (
          <Button
            className="versioned-store-history-load-more"
            onClick={this.loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        ) : null}
      </>
    )
  }

  private renderEntryBadges(entry: IVersionHistoryEntry) {
    return (
      <div className="versioned-store-history-entry-badges">
        {entry.undoOf !== null ? <span>Undo</span> : null}
        {entry.redoOf !== null ? <span>Redo</span> : null}
        {entry.restoreOf !== null ? <span>Restore</span> : null}
      </div>
    )
  }

  private renderDiff() {
    if (this.state.loadingDiff) {
      return (
        <div className="versioned-store-history-diff-empty">
          <Octicon className="spin" symbol={octicons.sync} /> Loading diff…
        </div>
      )
    }

    if (this.state.diff === null || this.state.diff.length === 0) {
      return (
        <div className="versioned-store-history-diff-empty">
          <Octicon symbol={octicons.fileDiff} />
          <span>No textual changes for this selection.</span>
        </div>
      )
    }

    return (
      <pre
        className="versioned-store-history-diff"
        role="region"
        aria-label="Version change diff"
      >
        {this.state.diff.split('\n').map((line, index) => (
          <span
            className={`versioned-store-history-diff-${classifyVersionHistoryDiffLine(
              line
            )}`}
            key={`${index}-${line}`}
          >
            {line.length === 0 ? ' ' : line}
            {'\n'}
          </span>
        ))}
      </pre>
    )
  }

  private renderDetails() {
    const entry = this.state.page?.entries.find(
      candidate => candidate.sha === this.state.selectedSha
    )

    if (entry === undefined) {
      return (
        <div className="versioned-store-history-details-empty">
          <Octicon symbol={octicons.gitCommit} />
          <span>Select a commit to inspect its changes.</span>
        </div>
      )
    }

    const files = this.state.filesBySha[entry.sha] ?? []

    return (
      <>
        <div className="versioned-store-history-details-header">
          <div className="versioned-store-history-details-title">
            <div>
              <h2>{entry.summary}</h2>
              <span>
                <code>{entry.shortSha}</code> ·{' '}
                <RelativeTime date={entry.committedAt} onlyRelative={false} />
              </span>
            </div>
            {this.renderEntryBadges(entry)}
          </div>
          {entry.body.length > 0 ? (
            <p className="versioned-store-history-entry-body">{entry.body}</p>
          ) : null}
          <div className="versioned-store-history-file-tabs" role="tablist">
            {files.map(file => (
              <button
                type="button"
                role="tab"
                aria-selected={file === this.state.selectedFile}
                className={
                  file === this.state.selectedFile ? 'selected' : undefined
                }
                key={file}
                // eslint-disable-next-line react/jsx-no-bind
                onClick={() => this.selectFile(file)}
              >
                <Octicon symbol={octicons.file} /> {file}
              </button>
            ))}
          </div>
        </div>
        <div className="versioned-store-history-diff-container">
          {this.renderDiff()}
        </div>
      </>
    )
  }

  private renderError() {
    return this.state.error === null ? null : (
      <div className="versioned-store-history-error" role="alert">
        <Octicon symbol={octicons.xCircle} />
        <span>{this.state.error}</span>
        <Button
          size="small"
          // eslint-disable-next-line react/jsx-no-bind
          onClick={() => this.loadHistory(true)}
        >
          Retry
        </Button>
      </div>
    )
  }

  private renderHeader() {
    return (
      <header className="versioned-store-history-header">
        <span
          className="versioned-store-history-header-icon"
          aria-hidden="true"
        >
          <Octicon symbol={octicons.history} />
        </span>
        <span className="versioned-store-history-header-copy">
          <h1>{this.props.title}</h1>
          <small>{this.props.timelineLabel}</small>
        </span>
        {this.state.operation !== null ? (
          <Octicon
            className="versioned-store-history-header-progress spin"
            symbol={octicons.sync}
          />
        ) : null}
        <Button
          className="versioned-store-history-close"
          ariaLabel={`Close ${this.props.title}`}
          tooltip={`Close ${this.props.title}`}
          onClick={this.props.onDismissed}
        >
          <Octicon symbol={octicons.x} />
        </Button>
      </header>
    )
  }

  public render() {
    return (
      <section
        className={classNames(
          'versioned-store-history-panel',
          this.props.className
        )}
        role="dialog"
        aria-label={this.props.title}
        aria-modal="false"
        aria-busy={this.state.operation !== null}
      >
        {this.renderHeader()}
        {this.renderToolbar()}
        {this.renderError()}
        <div className="versioned-store-history-layout">
          <section
            className="versioned-store-history-master"
            aria-label={`${this.props.title} commits`}
          >
            {this.renderHistoryList()}
          </section>
          <section
            className="versioned-store-history-details"
            aria-label={`${this.props.title} details`}
          >
            {this.renderDetails()}
          </section>
        </div>
      </section>
    )
  }
}
