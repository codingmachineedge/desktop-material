import * as React from 'react'
import { DialogContent } from '../dialog'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { IManagedSubmodule, SubmoduleStatusKind } from '../../lib/git'
import { Button } from '../lib/button'
import { Loading } from '../lib/loading'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { TooltippedContent } from '../lib/tooltipped-content'
import { PopupType } from '../../models/popup'
import { TextBox } from '../lib/text-box'
import {
  SubmoduleStatusFilter,
  filterSubmodules,
} from '../../lib/submodules/submodule-filter'

interface ISubmodulesProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
}

interface ISubmodulesState {
  /** The reconciled submodules, or null until the first load resolves. */
  readonly submodules: ReadonlyArray<IManagedSubmodule> | null

  /** True while the submodule list is (re)loading. */
  readonly isLoading: boolean

  /** The paths of submodules with an in-flight per-row operation. */
  readonly busyPaths: ReadonlySet<string>

  /** True while an "Update all" operation spanning the repo runs. */
  readonly isBusyGlobal: boolean

  /** The latest streamed progress line from an update, if any. */
  readonly progress: string | null

  /** The most recent operation error, surfaced inline. */
  readonly error: string | null

  /** Free-text query narrowing the list by name, path, or URL. */
  readonly filterText: string

  /** Status scope narrowing the list. */
  readonly statusFilter: SubmoduleStatusFilter
}

const StatusFilterLabels: ReadonlyArray<{
  readonly key: SubmoduleStatusFilter
  readonly label: string
}> = [
  { key: 'all', label: 'All' },
  { key: 'cloned', label: 'Cloned' },
  { key: 'uncloned', label: 'Not cloned' },
  { key: 'out-of-date', label: 'Out of date' },
  { key: 'conflicted', label: 'Conflicted' },
]

/** The user-facing label for each submodule status kind. */
const STATUS_LABEL: Record<SubmoduleStatusKind, string> = {
  uninitialized: 'Not initialized',
  'up-to-date': 'Up to date',
  'out-of-date': 'Out of date',
  conflicted: 'Conflicted',
}

/**
 * The Repository Settings "Submodules" tab.
 *
 * Lists the repository's submodules (path, URL, tracked branch, current SHA and
 * working-tree status) and offers add / update / sync / remove actions plus an
 * "Update all". Every action routes through the {@link Dispatcher}; results are
 * reflected by reloading the list. Unlike the other settings tabs these
 * operations apply immediately rather than being deferred to the dialog's Save
 * button.
 */
export class Submodules extends React.Component<
  ISubmodulesProps,
  ISubmodulesState
> {
  public constructor(props: ISubmodulesProps) {
    super(props)
    this.state = {
      submodules: null,
      isLoading: true,
      busyPaths: new Set<string>(),
      isBusyGlobal: false,
      progress: null,
      error: null,
      filterText: '',
      statusFilter: 'all',
    }
  }

  private onFilterTextChanged = (filterText: string) => {
    this.setState({ filterText })
  }

  private onStatusChipClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const key = event.currentTarget.dataset.statusFilter
    const entry = StatusFilterLabels.find(value => value.key === key)
    if (entry !== undefined) {
      this.setState({ statusFilter: entry.key })
    }
  }

  public componentDidMount() {
    this.loadSubmodules()
  }

  private loadSubmodules = async () => {
    this.setState({ isLoading: true })
    try {
      const submodules = await this.props.dispatcher.getSubmodules(
        this.props.repository
      )
      this.setState({ submodules, isLoading: false })
    } catch (e) {
      log.error(
        `Submodules: unable to list submodules for ${this.props.repository.path}`,
        e
      )
      this.setState({
        submodules: [],
        isLoading: false,
        error: `Could not list submodules: ${e}`,
      })
    }
  }

  private setPathBusy(path: string, busy: boolean) {
    this.setState(prev => {
      const busyPaths = new Set(prev.busyPaths)
      if (busy) {
        busyPaths.add(path)
      } else {
        busyPaths.delete(path)
      }
      return { busyPaths }
    })
  }

  private onProgress = (line: string) => {
    this.setState({ progress: line })
  }

  private onUpdateAll = async () => {
    this.setState({ isBusyGlobal: true, error: null, progress: null })
    try {
      await this.props.dispatcher.updateSubmodules(
        this.props.repository,
        undefined,
        this.onProgress
      )
      await this.loadSubmodules()
    } catch (e) {
      this.setState({ error: `Failed updating submodules: ${e}` })
    } finally {
      this.setState({ isBusyGlobal: false, progress: null })
    }
  }

  private onUpdate = async (submodule: IManagedSubmodule) => {
    this.setPathBusy(submodule.path, true)
    this.setState({ error: null, progress: null })
    try {
      await this.props.dispatcher.updateSubmodules(
        this.props.repository,
        [submodule.path],
        this.onProgress
      )
      await this.loadSubmodules()
    } catch (e) {
      this.setState({ error: `Failed updating ${submodule.path}: ${e}` })
    } finally {
      this.setPathBusy(submodule.path, false)
      this.setState({ progress: null })
    }
  }

  private onSyncSubmodule = async (submodule: IManagedSubmodule) => {
    this.setPathBusy(submodule.path, true)
    this.setState({ error: null })
    try {
      await this.props.dispatcher.syncSubmodules(this.props.repository, [
        submodule.path,
      ])
      await this.loadSubmodules()
    } catch (e) {
      this.setState({ error: `Failed syncing ${submodule.path}: ${e}` })
    } finally {
      this.setPathBusy(submodule.path, false)
    }
  }

  private onRemove = async (submodule: IManagedSubmodule) => {
    this.setPathBusy(submodule.path, true)
    this.setState({ error: null })
    try {
      await this.props.dispatcher.removeSubmodule(
        this.props.repository,
        submodule.path,
        submodule.name
      )
      await this.loadSubmodules()
    } catch (e) {
      this.setState({ error: `Failed removing ${submodule.path}: ${e}` })
    } finally {
      this.setPathBusy(submodule.path, false)
    }
  }

  private onShowAddSubmodule = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.AddSubmodule,
      repository: this.props.repository,
      onAdded: this.loadSubmodules,
    })
  }

  private renderSummary(): JSX.Element | null {
    const { submodules } = this.state
    if (submodules === null || submodules.length === 0) {
      return null
    }

    const uncloned = submodules.filter(s => s.status === 'uninitialized').length
    const cloned = submodules.length - uncloned

    return (
      <div className="submodules-summary" role="status">
        <span className="submodules-summary-chip">
          {submodules.length}{' '}
          {submodules.length === 1 ? 'submodule' : 'submodules'}
        </span>
        <span className="submodules-summary-chip submodules-summary-cloned">
          {cloned} cloned
        </span>
        {uncloned > 0 && (
          <span className="submodules-summary-chip submodules-summary-uncloned">
            {uncloned} not cloned
          </span>
        )}
      </div>
    )
  }

  private renderStatusPill(submodule: IManagedSubmodule): JSX.Element {
    const className = `submodule-status submodule-status-${submodule.status}`
    return <span className={className}>{STATUS_LABEL[submodule.status]}</span>
  }

  private renderRow(submodule: IManagedSubmodule): JSX.Element {
    const isBusy =
      this.state.busyPaths.has(submodule.path) || this.state.isBusyGlobal

    return (
      <SubmoduleRow
        key={submodule.path}
        submodule={submodule}
        isBusy={isBusy}
        statusPill={this.renderStatusPill(submodule)}
        onUpdate={this.onUpdate}
        onSyncSubmodule={this.onSyncSubmodule}
        onRemove={this.onRemove}
      />
    )
  }

  private renderFilterControls(): JSX.Element | null {
    const { submodules } = this.state
    if (submodules === null || submodules.length === 0) {
      return null
    }

    return (
      <div className="submodules-filter-row">
        <TextBox
          className="submodules-filter-text"
          placeholder="Search submodules by name, path, or URL"
          ariaLabel="Search submodules"
          value={this.state.filterText}
          onValueChanged={this.onFilterTextChanged}
        />
        <div
          className="submodules-filter-chips"
          role="group"
          aria-label="Filter submodules by status"
        >
          {StatusFilterLabels.map(({ key, label }) => (
            <button
              type="button"
              key={key}
              data-status-filter={key}
              className={
                this.state.statusFilter === key
                  ? 'submodules-filter-chip selected'
                  : 'submodules-filter-chip'
              }
              aria-pressed={this.state.statusFilter === key}
              onClick={this.onStatusChipClick}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  private renderList(): JSX.Element {
    const { submodules, isLoading, filterText, statusFilter } = this.state

    if (isLoading && submodules === null) {
      return (
        <p className="submodules-empty">
          <Loading /> Loading submodules…
        </p>
      )
    }

    if (submodules === null || submodules.length === 0) {
      return (
        <p className="submodules-empty">
          This repository has no submodules yet.
        </p>
      )
    }

    const visible = filterSubmodules(submodules, filterText, statusFilter)

    if (visible.length === 0) {
      return (
        <p className="submodules-empty">
          No submodules match the current search and status filter.
        </p>
      )
    }

    return (
      <ul className="submodule-list">{visible.map(s => this.renderRow(s))}</ul>
    )
  }

  public render() {
    const hasSubmodules =
      this.state.submodules !== null && this.state.submodules.length > 0

    return (
      <DialogContent>
        <div className="submodules-settings">
          <section className="submodules-section">
            <div className="submodules-section-header">
              <h3 className="submodules-section-title">
                <Octicon symbol={octicons.fileSubmodule} />
                Submodules
              </h3>
              <div className="submodules-header-actions">
                <Button
                  type="button"
                  disabled={this.state.isBusyGlobal}
                  onClick={this.onShowAddSubmodule}
                  tooltip="Choose a hosted repository or URL to add"
                >
                  <Octicon symbol={octicons.plus} />
                  Add submodule…
                </Button>
                {hasSubmodules && (
                  <Button
                    type="button"
                    disabled={this.state.isBusyGlobal}
                    onClick={this.onUpdateAll}
                    tooltip="Initialize and update every submodule"
                  >
                    {this.state.isBusyGlobal ? <Loading /> : null}
                    {__DARWIN__ ? 'Update All' : 'Update all'}
                  </Button>
                )}
              </div>
            </div>
            {this.renderSummary()}
            {this.renderFilterControls()}
            {this.state.error !== null && (
              <p className="submodules-error">{this.state.error}</p>
            )}
            {this.state.progress !== null && (
              <p className="submodules-progress">{this.state.progress}</p>
            )}
            {this.renderList()}
          </section>
        </div>
      </DialogContent>
    )
  }
}

interface ISubmoduleRowProps {
  readonly submodule: IManagedSubmodule
  readonly isBusy: boolean
  readonly statusPill: JSX.Element
  readonly onUpdate: (submodule: IManagedSubmodule) => void
  readonly onSyncSubmodule: (submodule: IManagedSubmodule) => void
  readonly onRemove: (submodule: IManagedSubmodule) => void
}

/**
 * A single submodule row. Extracted so the per-row action handlers can be
 * stable instance methods bound to the submodule rather than inline arrows.
 */
function SubmoduleRow(props: ISubmoduleRowProps) {
  const { submodule, isBusy, statusPill } = props
  const onUpdate = React.useCallback(
    () => props.onUpdate(submodule),
    [props.onUpdate, submodule]
  )
  const onSyncClicked = React.useCallback(
    () => props.onSyncSubmodule(submodule),
    [props.onSyncSubmodule, submodule]
  )
  const onRemove = React.useCallback(
    () => props.onRemove(submodule),
    [props.onRemove, submodule]
  )
  const shortSha = submodule.sha ? submodule.sha.slice(0, 8) : '—'

  return (
    <li className="submodule-row">
      <div className="submodule-row-main">
        <div className="submodule-row-heading">
          <Octicon
            className="submodule-row-icon"
            symbol={octicons.fileSubmodule}
          />
          <span className="submodule-row-path">{submodule.path}</span>
          {statusPill}
        </div>
        <div className="submodule-row-meta">
          {submodule.url !== null && (
            <TooltippedContent
              tagName="span"
              className="submodule-row-url"
              tooltip={submodule.url}
              onlyWhenOverflowed={true}
            >
              {submodule.url}
            </TooltippedContent>
          )}
          {submodule.branch !== null && (
            <span className="submodule-row-branch">
              <Octicon symbol={octicons.gitBranch} />
              {submodule.branch}
            </span>
          )}
          <TooltippedContent
            tagName="span"
            className="submodule-row-sha"
            tooltip={submodule.sha ?? ''}
          >
            <Octicon symbol={octicons.gitCommit} />
            {shortSha}
          </TooltippedContent>
        </div>
      </div>
      <div className="submodule-row-actions">
        <Button
          type="button"
          disabled={isBusy}
          onClick={onUpdate}
          tooltip={
            submodule.status === 'uninitialized'
              ? 'Clone this submodule into the working tree'
              : 'Initialize and update this submodule'
          }
        >
          {submodule.status === 'uninitialized' ? 'Clone' : 'Update'}
        </Button>
        <Button
          type="button"
          disabled={isBusy}
          onClick={onSyncClicked}
          tooltip="Sync the remote URL from .gitmodules"
        >
          Sync
        </Button>
        <Button
          type="button"
          disabled={isBusy}
          onClick={onRemove}
          tooltip="Deinitialize and remove this submodule"
        >
          Remove
        </Button>
      </div>
    </li>
  )
}
