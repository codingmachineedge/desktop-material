import * as React from 'react'
import { DialogContent } from '../dialog'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { IManagedSubmodule, SubmoduleStatusKind } from '../../lib/git'
import { Button } from '../lib/button'
import { TextBox } from '../lib/text-box'
import { Loading } from '../lib/loading'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

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

  /** True while an "Update all" / add operation spanning the repo runs. */
  readonly isBusyGlobal: boolean

  /** The latest streamed progress line from an update, if any. */
  readonly progress: string | null

  /** The most recent operation error, surfaced inline. */
  readonly error: string | null

  // --- Add form ---------------------------------------------------------
  readonly addUrl: string
  readonly addPath: string
  readonly addBranch: string
}

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
      addUrl: '',
      addPath: '',
      addBranch: '',
    }
  }

  public componentDidMount() {
    this.loadSubmodules()
  }

  private async loadSubmodules() {
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

  private onSync = async (submodule: IManagedSubmodule) => {
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

  private onAdd = async () => {
    const url = this.state.addUrl.trim()
    const path = this.state.addPath.trim()
    const branch = this.state.addBranch.trim()

    if (url.length === 0 || path.length === 0) {
      return
    }

    this.setState({ isBusyGlobal: true, error: null })
    try {
      await this.props.dispatcher.addSubmodule(
        this.props.repository,
        url,
        path,
        branch.length > 0 ? branch : null
      )
      this.setState({ addUrl: '', addPath: '', addBranch: '' })
      await this.loadSubmodules()
    } catch (e) {
      this.setState({ error: `Failed adding submodule: ${e}` })
    } finally {
      this.setState({ isBusyGlobal: false })
    }
  }

  private onAddUrlChanged = (addUrl: string) => this.setState({ addUrl })
  private onAddPathChanged = (addPath: string) => this.setState({ addPath })
  private onAddBranchChanged = (addBranch: string) =>
    this.setState({ addBranch })

  private renderStatusPill(submodule: IManagedSubmodule): JSX.Element {
    const className = `submodule-status submodule-status-${submodule.status}`
    return <span className={className}>{STATUS_LABEL[submodule.status]}</span>
  }

  private renderRow(submodule: IManagedSubmodule): JSX.Element {
    const isBusy =
      this.state.busyPaths.has(submodule.path) || this.state.isBusyGlobal
    const shortSha = submodule.sha ? submodule.sha.slice(0, 8) : '—'

    return (
      <li key={submodule.path} className="submodule-row">
        <div className="submodule-row-main">
          <div className="submodule-row-heading">
            <Octicon
              className="submodule-row-icon"
              symbol={octicons.fileSubmodule}
            />
            <span className="submodule-row-path">{submodule.path}</span>
            {this.renderStatusPill(submodule)}
          </div>
          <div className="submodule-row-meta">
            {submodule.url !== null && (
              <span className="submodule-row-url" title={submodule.url}>
                {submodule.url}
              </span>
            )}
            {submodule.branch !== null && (
              <span className="submodule-row-branch">
                <Octicon symbol={octicons.gitBranch} />
                {submodule.branch}
              </span>
            )}
            <span className="submodule-row-sha" title={submodule.sha ?? ''}>
              <Octicon symbol={octicons.gitCommit} />
              {shortSha}
            </span>
          </div>
        </div>
        <div className="submodule-row-actions">
          <Button
            type="button"
            disabled={isBusy}
            onClick={() => this.onUpdate(submodule)}
            tooltip="Initialize and update this submodule"
          >
            Update
          </Button>
          <Button
            type="button"
            disabled={isBusy}
            onClick={() => this.onSync(submodule)}
            tooltip="Sync the remote URL from .gitmodules"
          >
            Sync
          </Button>
          <Button
            type="button"
            disabled={isBusy}
            onClick={() => this.onRemove(submodule)}
            tooltip="Deinitialize and remove this submodule"
          >
            Remove
          </Button>
        </div>
      </li>
    )
  }

  private renderList(): JSX.Element {
    const { submodules, isLoading } = this.state

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
          This repository has no submodules. Add one below to get started.
        </p>
      )
    }

    return (
      <ul className="submodule-list">
        {submodules.map(s => this.renderRow(s))}
      </ul>
    )
  }

  private renderAddForm(): JSX.Element {
    const canAdd =
      this.state.addUrl.trim().length > 0 &&
      this.state.addPath.trim().length > 0 &&
      !this.state.isBusyGlobal

    return (
      <section className="submodules-section submodules-add">
        <h3 className="submodules-section-title">
          <Octicon symbol={octicons.plus} />
          Add a submodule
        </h3>
        <div className="submodules-add-fields">
          <TextBox
            label="Repository URL"
            placeholder="https://github.com/owner/repo.git"
            value={this.state.addUrl}
            spellcheck={false}
            onValueChanged={this.onAddUrlChanged}
          />
          <TextBox
            label="Path"
            placeholder="vendor/repo"
            value={this.state.addPath}
            spellcheck={false}
            onValueChanged={this.onAddPathChanged}
          />
          <TextBox
            label={__DARWIN__ ? 'Branch (Optional)' : 'Branch (optional)'}
            placeholder="main"
            value={this.state.addBranch}
            spellcheck={false}
            onValueChanged={this.onAddBranchChanged}
          />
        </div>
        <div className="submodules-add-actions">
          <Button type="button" disabled={!canAdd} onClick={this.onAdd}>
            {this.state.isBusyGlobal ? <Loading /> : null}
            Add submodule
          </Button>
        </div>
      </section>
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
            {this.state.error !== null && (
              <p className="submodules-error">{this.state.error}</p>
            )}
            {this.state.progress !== null && (
              <p className="submodules-progress">{this.state.progress}</p>
            )}
            {this.renderList()}
          </section>
          {this.renderAddForm()}
        </div>
      </DialogContent>
    )
  }
}
