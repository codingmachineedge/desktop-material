import * as React from 'react'
import classNames from 'classnames'

import {
  FileHistoryUnavailableError,
  getFileBlame,
  getFileHistory,
  IFileBlameLine,
  IFileBlameResult,
  IFileHistoryEntry,
  IFileHistoryResult,
  restoreFileFromCommit,
} from '../../lib/git/file-history'
import { Repository } from '../../models/repository'
import { Button } from '../lib/button'
import { DialogStackContext } from '../dialog'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { RelativeTime } from '../relative-time'

type FileHistoryView = 'history' | 'blame'

interface IFileHistoryProps {
  readonly repository: Repository
  readonly path: string
  readonly onDismissed: () => void
  readonly onRefreshRepository: () => Promise<void>
}

interface IFileHistoryState {
  readonly view: FileHistoryView
  readonly history: IFileHistoryResult | null
  readonly historyLoading: boolean
  readonly historyError: string | null
  readonly selectedHistorySha: string | null
  readonly blame: IFileBlameResult | null
  readonly blameLoading: boolean
  readonly blameError: string | null
  readonly selectedBlameLine: number | null
  readonly restoreConfirmationSha: string | null
  readonly restoring: boolean
  readonly restoreMessage: string | null
  readonly restoreError: string | null
}

const HistoryTabId = 'file-history-tab'
const HistoryPanelId = 'file-history-history-panel'
const BlameTabId = 'file-blame-tab'
const BlamePanelId = 'file-history-blame-panel'

const getErrorMessage = (error: unknown): string => {
  if (error instanceof FileHistoryUnavailableError) {
    return error.message
  }
  return 'Unable to load this file from Git. Check the repository and retry.'
}

export class FileHistory extends React.Component<
  IFileHistoryProps,
  IFileHistoryState
> {
  public static contextType = DialogStackContext
  public declare context: React.ContextType<typeof DialogStackContext>

  private mounted = false
  private historyController: AbortController | null = null
  private blameController: AbortController | null = null
  private restoreConfirmButton: HTMLButtonElement | null = null

  public constructor(props: IFileHistoryProps) {
    super(props)
    this.state = {
      view: 'history',
      history: null,
      historyLoading: true,
      historyError: null,
      selectedHistorySha: null,
      blame: null,
      blameLoading: false,
      blameError: null,
      selectedBlameLine: null,
      restoreConfirmationSha: null,
      restoring: false,
      restoreMessage: null,
      restoreError: null,
    }
  }

  public componentDidMount() {
    this.mounted = true
    window.addEventListener('keydown', this.onWindowKeyDown)
    this.loadHistory()
  }

  public componentWillUnmount() {
    this.mounted = false
    this.historyController?.abort()
    this.blameController?.abort()
    window.removeEventListener('keydown', this.onWindowKeyDown)
  }

  private onWindowKeyDown = (event: KeyboardEvent) => {
    if (!this.context.isTopMost || event.defaultPrevented) {
      return
    }
    const shortcutKey = __DARWIN__ ? event.metaKey : event.ctrlKey
    if (event.key === 'Escape' || (shortcutKey && event.key === 'w')) {
      event.preventDefault()
      this.props.onDismissed()
    }
  }

  private onPanelMouseDown = () => {
    if (!this.context.isTopMost) {
      this.context.onRequestFront?.()
    }
  }

  private loadHistory = async () => {
    this.historyController?.abort()
    const controller = new AbortController()
    this.historyController = controller
    this.setState({ historyLoading: true, historyError: null })

    try {
      const history = await getFileHistory(
        this.props.repository,
        this.props.path,
        controller.signal
      )
      if (!this.mounted || controller.signal.aborted) {
        return
      }
      this.setState({
        history,
        historyLoading: false,
        selectedHistorySha: history.entries[0]?.sha ?? null,
      })
    } catch (error) {
      if (!this.mounted || controller.signal.aborted) {
        return
      }
      this.setState({
        history: null,
        historyLoading: false,
        historyError: getErrorMessage(error),
      })
    } finally {
      if (this.historyController === controller) {
        this.historyController = null
      }
    }
  }

  private loadBlame = async () => {
    this.blameController?.abort()
    const controller = new AbortController()
    this.blameController = controller
    this.setState({ blameLoading: true, blameError: null })

    try {
      const blame = await getFileBlame(
        this.props.repository,
        this.props.path,
        controller.signal
      )
      if (!this.mounted || controller.signal.aborted) {
        return
      }
      this.setState({
        blame,
        blameLoading: false,
        selectedBlameLine: blame.lines[0]?.finalLine ?? null,
      })
    } catch (error) {
      if (!this.mounted || controller.signal.aborted) {
        return
      }
      this.setState({
        blame: null,
        blameLoading: false,
        blameError: getErrorMessage(error),
      })
    } finally {
      if (this.blameController === controller) {
        this.blameController = null
      }
    }
  }

  private refresh = () => {
    if (this.state.view === 'history') {
      this.loadHistory()
    } else {
      this.loadBlame()
    }
  }

  private onTabClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const view = event.currentTarget.dataset.view as FileHistoryView | undefined
    if (view === undefined || view === this.state.view) {
      return
    }
    this.setState({ view })
    if (view === 'blame' && this.state.blame === null) {
      this.loadBlame()
    }
  }

  private onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    event.preventDefault()
    const view: FileHistoryView =
      this.state.view === 'history' ? 'blame' : 'history'
    this.setState({ view })
    if (view === 'blame' && this.state.blame === null) {
      this.loadBlame()
    }
    document
      .getElementById(view === 'history' ? HistoryTabId : BlameTabId)
      ?.focus()
  }

  private onHistoryEntryClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const sha = event.currentTarget.dataset.sha
    if (sha !== undefined) {
      this.setState({
        selectedHistorySha: sha,
        restoreConfirmationSha: null,
        restoreMessage: null,
        restoreError: null,
      })
    }
  }

  private onHistoryEntryKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    const entries = this.state.history?.entries ?? []
    const current = Number(event.currentTarget.dataset.historyIndex)
    let next = current
    if (event.key === 'ArrowDown') {
      next = Math.min(entries.length - 1, current + 1)
    } else if (event.key === 'ArrowUp') {
      next = Math.max(0, current - 1)
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = entries.length - 1
    } else {
      return
    }
    event.preventDefault()
    const entry = entries[next]
    if (entry !== undefined) {
      this.setState({
        selectedHistorySha: entry.sha,
        restoreConfirmationSha: null,
        restoreMessage: null,
        restoreError: null,
      })
      document
        .querySelector<HTMLButtonElement>(
          `.file-history-list [data-history-index="${next}"]`
        )
        ?.focus()
    }
  }

  private onBlameLineClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const line = Number(event.currentTarget.dataset.line)
    if (Number.isSafeInteger(line)) {
      this.setState({ selectedBlameLine: line })
    }
  }

  private onBlameLineKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    const lines = this.state.blame?.lines ?? []
    const current = Number(event.currentTarget.dataset.blameIndex)
    let next = current
    if (event.key === 'ArrowDown') {
      next = Math.min(lines.length - 1, current + 1)
    } else if (event.key === 'ArrowUp') {
      next = Math.max(0, current - 1)
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = lines.length - 1
    } else {
      return
    }
    event.preventDefault()
    const line = lines[next]
    if (line !== undefined) {
      this.setState({ selectedBlameLine: line.finalLine })
      document
        .querySelector<HTMLButtonElement>(
          `.file-blame-lines [data-blame-index="${next}"]`
        )
        ?.focus()
    }
  }

  private renderHeader() {
    const loading = this.state.historyLoading || this.state.blameLoading
    return (
      <header className="file-history-header">
        <span className="file-history-header-icon" aria-hidden="true">
          <Octicon symbol={octicons.history} />
        </span>
        <span className="file-history-heading-copy">
          <h1 id="file-history-title">File history</h1>
          <small title={this.props.path}>{this.props.path}</small>
        </span>
        {loading ? (
          <Octicon
            className="file-history-progress spin"
            symbol={octicons.sync}
          />
        ) : null}
        <Button
          className="file-history-refresh"
          ariaLabel="Refresh file history"
          tooltip="Refresh"
          onClick={this.refresh}
          disabled={loading}
        >
          <Octicon symbol={octicons.sync} />
        </Button>
        <Button
          className="file-history-close"
          ariaLabel="Close file history"
          tooltip="Close file history"
          onClick={this.props.onDismissed}
        >
          <Octicon symbol={octicons.x} />
        </Button>
      </header>
    )
  }

  private renderTabs() {
    const { view, history } = this.state
    const historyCount = history?.entries.length ?? 0
    return (
      <div className="file-history-toolbar">
        <div
          className="file-history-tabs"
          role="tablist"
          aria-label="File data"
        >
          <button
            id={HistoryTabId}
            type="button"
            role="tab"
            data-view="history"
            aria-selected={view === 'history'}
            aria-controls={HistoryPanelId}
            tabIndex={view === 'history' ? 0 : -1}
            onClick={this.onTabClick}
            onKeyDown={this.onTabKeyDown}
          >
            History
          </button>
          <button
            id={BlameTabId}
            type="button"
            role="tab"
            data-view="blame"
            aria-selected={view === 'blame'}
            aria-controls={BlamePanelId}
            tabIndex={view === 'blame' ? 0 : -1}
            onClick={this.onTabClick}
            onKeyDown={this.onTabKeyDown}
          >
            Line blame
          </button>
        </div>
        <span className="file-history-count" role="status" aria-live="polite">
          {this.state.historyLoading
            ? 'Loading commits…'
            : `${historyCount} commit${historyCount === 1 ? '' : 's'}${
                history?.truncated ? '+' : ''
              }`}
        </span>
      </div>
    )
  }

  private renderMessage(message: string, isError: boolean = false) {
    return (
      <div
        className={classNames('file-history-message', { error: isError })}
        role={isError ? 'alert' : 'status'}
      >
        <Octicon symbol={isError ? octicons.alert : octicons.info} />
        <span>{message}</span>
        {isError ? (
          <Button size="small" onClick={this.refresh}>
            Retry
          </Button>
        ) : null}
      </div>
    )
  }

  private renderHistoryEntry(entry: IFileHistoryEntry, index: number) {
    const selected = this.state.selectedHistorySha === entry.sha
    return (
      <li key={entry.sha} className={classNames({ selected })}>
        <button
          type="button"
          role="option"
          aria-selected={selected}
          data-sha={entry.sha}
          data-history-index={index}
          tabIndex={selected ? 0 : -1}
          onClick={this.onHistoryEntryClick}
          onKeyDown={this.onHistoryEntryKeyDown}
        >
          <code>{entry.shortSha}</code>
          <span className="file-history-entry-copy">
            <strong title={entry.summary}>{entry.summary}</strong>
            <span title={`${entry.authorName} <${entry.authorEmail}>`}>
              {entry.authorName}
            </span>
          </span>
          <RelativeTime
            className="file-history-entry-time"
            date={entry.authoredAt}
          />
        </button>
      </li>
    )
  }

  private getSelectedHistoryEntry(): IFileHistoryEntry | null {
    return (
      this.state.history?.entries.find(
        entry => entry.sha === this.state.selectedHistorySha
      ) ?? null
    )
  }

  private requestRestore = (entry: IFileHistoryEntry) => {
    if (this.state.restoring) {
      return
    }
    this.setState(
      {
        restoreConfirmationSha: entry.sha,
        restoreMessage: null,
        restoreError: null,
      },
      () => this.restoreConfirmButton?.focus()
    )
  }

  private confirmRestore = async () => {
    const sha = this.state.restoreConfirmationSha
    if (sha === null || this.state.restoring) {
      return
    }
    this.setState({ restoring: true, restoreError: null })
    try {
      const path = await restoreFileFromCommit(
        this.props.repository,
        this.props.path,
        sha
      )
      await this.props.onRefreshRepository()
      if (this.mounted) {
        this.setState({
          restoring: false,
          restoreConfirmationSha: null,
          restoreMessage: `Restored ${path} to the working tree. Review the change before committing.`,
          restoreError: null,
        })
      }
    } catch (error) {
      if (this.mounted) {
        this.setState({
          restoring: false,
          restoreError:
            error instanceof FileHistoryUnavailableError
              ? error.message
              : 'Unable to restore this file version. The working tree was refreshed; review its current state before retrying.',
        })
        void this.props.onRefreshRepository().catch(() => undefined)
      }
    }
  }

  private renderRestoreConfirmation(entry: IFileHistoryEntry) {
    if (this.state.restoreConfirmationSha !== entry.sha) {
      return null
    }
    return (
      <div
        className="file-history-restore-confirmation"
        role="alertdialog"
        aria-labelledby="file-history-restore-title"
        aria-describedby="file-history-restore-description"
      >
        <strong id="file-history-restore-title">
          Restore this file version?
        </strong>
        <p id="file-history-restore-description">
          <span title={this.props.path}>{this.props.path}</span> will be
          replaced in the working tree with commit{' '}
          <code title={entry.sha}>{entry.shortSha}</code>. Existing commits and
          the staging area remain unchanged, but current unstaged content at
          this path can be lost.
        </p>
        <div className="file-history-restore-actions">
          <Button
            onButtonRef={button => (this.restoreConfirmButton = button)}
            disabled={this.state.restoring}
            onClick={() => void this.confirmRestore()}
          >
            {this.state.restoring ? 'Restoring…' : 'Restore to working tree'}
          </Button>
          <Button
            disabled={this.state.restoring}
            onClick={() =>
              this.setState({
                restoreConfirmationSha: null,
                restoreError: null,
              })
            }
          >
            Go back
          </Button>
        </div>
      </div>
    )
  }

  private renderHistoryDetails(entry: IFileHistoryEntry | null) {
    if (entry === null) {
      return (
        <div className="file-history-details-empty">
          Select a commit to inspect its metadata.
        </div>
      )
    }
    return (
      <article className="file-history-details-card">
        <h2>{entry.summary}</h2>
        <dl>
          <div>
            <dt>Commit</dt>
            <dd>
              <code title={entry.sha}>{entry.shortSha}</code>
            </dd>
          </div>
          <div>
            <dt>Author</dt>
            <dd>{entry.authorName}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{entry.authorEmail}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>
              <RelativeTime date={entry.authoredAt} onlyRelative={false} />
            </dd>
          </div>
        </dl>
        <div className="file-history-restore-controls">
          <Button
            disabled={this.state.restoring}
            onClick={() => this.requestRestore(entry)}
          >
            Restore this version
          </Button>
          <span>
            Restores only this path to the working tree; it does not create a
            commit.
          </span>
        </div>
        {this.renderRestoreConfirmation(entry)}
        {this.state.restoreMessage !== null && (
          <p className="file-history-restore-message" role="status">
            {this.state.restoreMessage}
          </p>
        )}
        {this.state.restoreError !== null && (
          <p className="file-history-restore-error" role="alert">
            {this.state.restoreError}
          </p>
        )}
      </article>
    )
  }

  private renderHistory() {
    const { history, historyError, historyLoading } = this.state
    let master: JSX.Element
    if (historyLoading) {
      master = this.renderMessage('Following this file through Git history…')
    } else if (historyError !== null) {
      master = this.renderMessage(historyError, true)
    } else if (history === null || history.entries.length === 0) {
      master = this.renderMessage(
        'No committed history was found. Untracked files appear after their first commit.'
      )
    } else {
      master = (
        <ol className="file-history-list" role="listbox" aria-label="Commits">
          {history.entries.map((entry, index) =>
            this.renderHistoryEntry(entry, index)
          )}
        </ol>
      )
    }

    return (
      <div
        id={HistoryPanelId}
        className="file-history-layout"
        role="tabpanel"
        aria-labelledby={HistoryTabId}
      >
        <section className="file-history-master" aria-label="File commits">
          {master}
        </section>
        <section className="file-history-details" aria-label="Commit details">
          {this.renderHistoryDetails(this.getSelectedHistoryEntry())}
        </section>
      </div>
    )
  }

  private getSelectedBlameLine(): IFileBlameLine | null {
    return (
      this.state.blame?.lines.find(
        line => line.finalLine === this.state.selectedBlameLine
      ) ?? null
    )
  }

  private renderBlameDetails(line: IFileBlameLine | null) {
    if (line === null) {
      return (
        <div className="file-blame-details-empty">
          Select a source line to inspect its commit and original location.
        </div>
      )
    }
    return (
      <article className="file-blame-details-card" aria-live="polite">
        <span className="file-blame-detail-heading">
          <code>{line.shortSha}</code>
          <strong>{line.summary || 'No commit summary'}</strong>
        </span>
        <dl>
          <div>
            <dt>Author</dt>
            <dd title={line.authorEmail}>{line.authorName}</dd>
          </div>
          <div>
            <dt>Authored</dt>
            <dd>
              {line.uncommitted ? (
                'Working tree'
              ) : (
                <RelativeTime date={line.authoredAt} onlyRelative={false} />
              )}
            </dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{line.authorEmail}</dd>
          </div>
          <div>
            <dt>Original</dt>
            <dd title={line.originalPath}>
              {line.originalPath}:{line.originalLine}
            </dd>
          </div>
        </dl>
      </article>
    )
  }

  private renderBlameLine(line: IFileBlameLine, index: number) {
    const selected = line.finalLine === this.state.selectedBlameLine
    return (
      <button
        key={line.finalLine}
        type="button"
        className={classNames('file-blame-line', { selected })}
        role="option"
        aria-selected={selected}
        aria-label={`Line ${line.finalLine}, ${line.authorName}, ${line.summary}`}
        data-line={line.finalLine}
        data-blame-index={index}
        tabIndex={selected ? 0 : -1}
        onClick={this.onBlameLineClick}
        onKeyDown={this.onBlameLineKeyDown}
      >
        <span className="file-blame-sha" title={line.sha}>
          {line.shortSha}
        </span>
        <span className="file-blame-line-number">{line.finalLine}</span>
        <code>{line.content.length === 0 ? '\u00a0' : line.content}</code>
      </button>
    )
  }

  private renderBlame() {
    const { blame, blameError, blameLoading } = this.state
    let content: JSX.Element
    if (blameLoading) {
      content = this.renderMessage('Attributing each source line…')
    } else if (blameError !== null) {
      content = this.renderMessage(blameError, true)
    } else if (blame === null || blame.lines.length === 0) {
      content = this.renderMessage('This tracked file has no source lines.')
    } else {
      content = (
        <div className="file-blame-source">
          <div
            className="file-blame-lines"
            role="listbox"
            aria-label={`Line blame for ${blame.path}`}
          >
            {blame.lines.map((line, index) =>
              this.renderBlameLine(line, index)
            )}
          </div>
        </div>
      )
    }

    return (
      <div
        id={BlamePanelId}
        className="file-blame-layout"
        role="tabpanel"
        aria-labelledby={BlameTabId}
      >
        <section
          className="file-blame-details"
          aria-label="Selected line details"
        >
          {this.renderBlameDetails(this.getSelectedBlameLine())}
        </section>
        {content}
      </div>
    )
  }

  public render() {
    return (
      <section
        className="file-history-panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby="file-history-title"
        aria-busy={this.state.historyLoading || this.state.blameLoading}
        onMouseDown={this.onPanelMouseDown}
      >
        {this.renderHeader()}
        {this.renderTabs()}
        <div className="file-history-content">
          {this.state.view === 'history'
            ? this.renderHistory()
            : this.renderBlame()}
        </div>
      </section>
    )
  }
}
