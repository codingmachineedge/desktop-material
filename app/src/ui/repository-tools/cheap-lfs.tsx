import * as Path from 'path'
import { stat } from 'fs/promises'
import * as React from 'react'
import { Account } from '../../models/account'
import { Repository } from '../../models/repository'
import {
  ICheapLfsMaterializeResult,
  ICheapLfsPinOptions,
  ICheapLfsPinResult,
  ICheapLfsPointerEntry,
} from '../../lib/cheap-lfs/operations'
import {
  CHEAP_LFS_PART_SIZE_BYTES,
  planFileParts,
  validateCheapLfsTrackedPath,
} from '../../lib/cheap-lfs/pointer'
import { IGitHubReleaseTransferProgressEvent } from '../../lib/github-release-transfer'
import { getGitHubReleasesAccount } from '../../lib/stores/github-releases-store'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'
import { showOpenDialog } from '../main-process-proxy'

/**
 * The dispatcher surface the cheap-LFS panel drives. The real `Dispatcher`
 * satisfies this structurally, and the panel's tests inject a fake. Account
 * resolution lives behind these methods (in the app store), so the panel never
 * has to select an account for the transfer itself.
 */
export interface ICheapLfsDispatcher {
  listCheapLfsPointers(
    repository: Repository
  ): Promise<ReadonlyArray<ICheapLfsPointerEntry>>
  pinFileToRelease(
    repository: Repository,
    options: ICheapLfsPinOptions,
    signal?: AbortSignal,
    onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
  ): Promise<ICheapLfsPinResult>
  materializePointer(
    repository: Repository,
    trackedRelativePath: string,
    signal?: AbortSignal,
    onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
  ): Promise<ICheapLfsMaterializeResult>
}

export interface ICheapLfsProps {
  readonly repository: Repository
  readonly accounts: ReadonlyArray<Account>
  readonly dispatcher: ICheapLfsDispatcher
  /** Test seam over the native open dialog; returns an absolute path or null. */
  readonly chooseFileToPin?: () => Promise<string | null>
  /** Test seam over `fs.stat`; returns the byte size of the picked file. */
  readonly statFileSize?: (path: string) => Promise<number>
}

/** The single in-flight operation, used to disable every other control. */
type CheapLfsBusy = 'listing' | 'pin' | 'materialize'

/** The picked-file pin draft, before and during its review step. */
interface IPinDraft {
  readonly sourcePath: string
  readonly sizeInBytes: number
  readonly trackedRelativePath: string
  readonly releaseTag: string
  readonly releaseName: string
  readonly reviewing: boolean
}

interface ICheapLfsState {
  readonly pointers: ReadonlyArray<ICheapLfsPointerEntry>
  readonly loaded: boolean
  readonly filter: string
  readonly filterMode: FilterMode
  readonly caseSensitive: boolean
  readonly busy: CheapLfsBusy | null
  readonly materializingPath: string | null
  readonly pin: IPinDraft | null
  readonly progress: IGitHubReleaseTransferProgressEvent | null
  readonly notice: string | null
  readonly error: string | null
}

/** The persistence id for this panel's filter mode. */
const CheapLfsFilterId = 'cheap-lfs-pointers'

/** The default release tag suggested when pinning a file. */
const DefaultReleaseTag = 'assets'

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Cheap LFS could not complete this operation safely.'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`
}

/**
 * The repository-relative path of a picked file when it sits inside the
 * repository, or its bare basename when it does not.
 */
function defaultTrackedPath(
  repositoryPath: string,
  sourcePath: string
): string {
  const relative = Path.relative(repositoryPath, sourcePath)
  if (
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${Path.sep}`) &&
    !Path.isAbsolute(relative)
  ) {
    return relative.split(Path.sep).join('/')
  }
  return Path.basename(sourcePath)
}

/**
 * The "large files & storage" panel: a review-gated surface that lists the
 * committed cheap-LFS pointers in the working tree, materializes them back into
 * their real bytes on demand, and pins a chosen large file to a GitHub Release
 * so only a small pointer is committed. It is not real Git LFS — see the copy
 * rendered in the panel intro.
 */
export class CheapLfs extends React.Component<ICheapLfsProps, ICheapLfsState> {
  private mounted = false
  private generation = 0
  private operationController: AbortController | null = null
  private lastProgressAt = 0
  private readonly materializeHandlers = new Map<string, () => void>()

  public constructor(props: ICheapLfsProps) {
    super(props)
    this.state = {
      pointers: [],
      loaded: false,
      filter: '',
      filterMode: readPersistedFilterMode(CheapLfsFilterId),
      caseSensitive: false,
      busy: null,
      materializingPath: null,
      pin: null,
      progress: null,
      notice: null,
      error: null,
    }
  }

  public componentDidMount() {
    this.mounted = true
    void this.loadPointers()
  }

  public componentDidUpdate(prevProps: ICheapLfsProps) {
    if (prevProps.repository.hash !== this.props.repository.hash) {
      this.generation++
      this.operationController?.abort()
      this.operationController = null
      this.setState(
        {
          pointers: [],
          loaded: false,
          filter: '',
          busy: null,
          materializingPath: null,
          pin: null,
          progress: null,
          notice: null,
          error: null,
        },
        () => void this.loadPointers()
      )
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.generation++
    this.operationController?.abort()
    this.operationController = null
  }

  private startOperation(kind: CheapLfsBusy): {
    readonly generation: number
    readonly controller: AbortController
  } | null {
    if (this.state.busy !== null || this.operationController !== null) {
      return null
    }
    const controller = new AbortController()
    this.operationController = controller
    this.setState({ busy: kind, error: null, notice: null, progress: null })
    return { generation: this.generation, controller }
  }

  private isCurrent(generation: number, controller: AbortController): boolean {
    return (
      this.mounted &&
      generation === this.generation &&
      this.operationController === controller
    )
  }

  private finishOperation(controller: AbortController) {
    if (this.operationController === controller) {
      this.operationController = null
    }
  }

  private updateProgress(
    generation: number,
    controller: AbortController,
    progress: IGitHubReleaseTransferProgressEvent
  ) {
    const now = Date.now()
    if (
      this.isCurrent(generation, controller) &&
      (now - this.lastProgressAt >= 100 ||
        progress.transferredBytes === progress.totalBytes)
    ) {
      this.lastProgressAt = now
      this.setState({ progress })
    }
  }

  private loadPointers = async (notice?: string) => {
    const operation = this.startOperation('listing')
    if (operation === null) {
      return
    }
    try {
      const pointers = await this.props.dispatcher.listCheapLfsPointers(
        this.props.repository
      )
      if (!this.isCurrent(operation.generation, operation.controller)) {
        return
      }
      this.finishOperation(operation.controller)
      this.setState({
        pointers,
        loaded: true,
        busy: null,
        materializingPath: null,
        error: null,
        notice: notice ?? null,
      })
    } catch (error) {
      if (this.isCurrent(operation.generation, operation.controller)) {
        this.setState({
          busy: null,
          loaded: true,
          materializingPath: null,
          error: errorMessage(error),
        })
      }
    } finally {
      this.finishOperation(operation.controller)
    }
  }

  private refresh = () => void this.loadPointers()

  private onFilterChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.setState({ filter: event.currentTarget.value })
  }

  private onFilterModeChanged = (filterMode: FilterMode) => {
    persistFilterMode(CheapLfsFilterId, filterMode)
    this.setState({ filterMode })
  }

  private onCaseSensitiveChanged = (caseSensitive: boolean) => {
    this.setState({ caseSensitive })
  }

  private onRegexPatternApply = (filter: string) => {
    this.setState({ filter })
  }

  private getFilterSampleItems = (): ReadonlyArray<string> =>
    this.state.pointers.map(entry => entry.relativePath)

  private visiblePointers(): ReadonlyArray<ICheapLfsPointerEntry> {
    const query = this.state.filter.trim()
    if (query.length === 0) {
      return this.state.pointers
    }
    const { results } = matchWithMode(
      query,
      this.state.pointers,
      entry => [
        entry.relativePath,
        `${entry.pointer.releaseTag} ${entry.pointer.assetName}`,
      ],
      { mode: this.state.filterMode, caseSensitive: this.state.caseSensitive }
    )
    return results.map(result => result.item)
  }

  private materializeHandler(relativePath: string): () => void {
    const existing = this.materializeHandlers.get(relativePath)
    if (existing !== undefined) {
      return existing
    }
    const handler = () => void this.materialize(relativePath)
    this.materializeHandlers.set(relativePath, handler)
    return handler
  }

  private materialize = async (relativePath: string) => {
    const operation = this.startOperation('materialize')
    if (operation === null) {
      return
    }
    this.lastProgressAt = 0
    this.setState({ materializingPath: relativePath })
    try {
      const result = await this.props.dispatcher.materializePointer(
        this.props.repository,
        relativePath,
        operation.controller.signal,
        progress =>
          this.updateProgress(
            operation.generation,
            operation.controller,
            progress
          )
      )
      if (!this.isCurrent(operation.generation, operation.controller)) {
        return
      }
      this.finishOperation(operation.controller)
      this.setState(
        { busy: null, progress: null },
        () =>
          void this.loadPointers(
            `Materialized ${relativePath} (${formatBytes(
              result.bytes
            )}). The real bytes replaced the pointer in your working tree.`
          )
      )
    } catch (error) {
      if (this.isCurrent(operation.generation, operation.controller)) {
        const canceled = (error as Error)?.name === 'AbortError'
        this.setState({
          busy: null,
          progress: null,
          materializingPath: null,
          error: canceled ? null : errorMessage(error),
          notice: canceled
            ? 'Materialize canceled; the pointer was left in place.'
            : null,
        })
      }
    } finally {
      this.finishOperation(operation.controller)
    }
  }

  /**
   * Materialize every loaded pointer sequentially under one cancelable
   * operation — the manual "Materialize all" control. Runs the same per-file
   * materialize the automatic detector uses, records per-file failures without
   * stopping the batch, and reloads the list once at the end.
   */
  private materializeAll = async () => {
    const targets = this.state.pointers
    if (targets.length === 0) {
      return
    }
    const operation = this.startOperation('materialize')
    if (operation === null) {
      return
    }
    this.lastProgressAt = 0
    let materialized = 0
    let failed = 0
    let canceled = false
    try {
      for (const entry of targets) {
        if (!this.isCurrent(operation.generation, operation.controller)) {
          return
        }
        if (operation.controller.signal.aborted) {
          canceled = true
          break
        }
        this.setState({ materializingPath: entry.relativePath })
        try {
          await this.props.dispatcher.materializePointer(
            this.props.repository,
            entry.relativePath,
            operation.controller.signal,
            progress =>
              this.updateProgress(
                operation.generation,
                operation.controller,
                progress
              )
          )
          materialized++
        } catch (error) {
          if ((error as Error)?.name === 'AbortError') {
            canceled = true
            break
          }
          failed++
        }
      }
      if (!this.isCurrent(operation.generation, operation.controller)) {
        return
      }
      this.finishOperation(operation.controller)
      const failedSuffix =
        failed > 0
          ? `; ${failed} failed and ${
              failed === 1 ? 'was' : 'were'
            } left as pointers`
          : ''
      this.setState(
        { busy: null, progress: null },
        () =>
          void this.loadPointers(
            `${
              canceled ? 'Canceled after materializing' : 'Materialized'
            } ${materialized} of ${targets.length} pinned ${
              targets.length === 1 ? 'file' : 'files'
            }${failedSuffix}.`
          )
      )
    } catch (error) {
      if (this.isCurrent(operation.generation, operation.controller)) {
        this.setState({
          busy: null,
          progress: null,
          materializingPath: null,
          error: errorMessage(error),
        })
      }
    } finally {
      this.finishOperation(operation.controller)
    }
  }

  private choosePinFile = async () => {
    if (this.state.busy !== null) {
      return
    }
    try {
      const sourcePath = this.props.chooseFileToPin
        ? await this.props.chooseFileToPin()
        : await showOpenDialog({
            title: 'Choose a large file to pin to a release',
            properties: ['openFile'],
          })
      if (sourcePath === null || !this.mounted) {
        return
      }
      const statSize =
        this.props.statFileSize ?? (p => stat(p).then(s => s.size))
      const sizeInBytes = await statSize(sourcePath)
      if (!this.mounted) {
        return
      }
      this.setState({
        pin: {
          sourcePath,
          sizeInBytes,
          trackedRelativePath: defaultTrackedPath(
            this.props.repository.path,
            sourcePath
          ),
          releaseTag: DefaultReleaseTag,
          releaseName: '',
          reviewing: false,
        },
        error: null,
        notice: null,
      })
    } catch (error) {
      if (this.mounted) {
        this.setState({ error: errorMessage(error) })
      }
    }
  }

  private onPinField = (event: React.FormEvent<HTMLInputElement>) => {
    const pin = this.state.pin
    if (pin === null || pin.reviewing) {
      return
    }
    const { name, value } = event.currentTarget
    const next =
      name === 'trackedRelativePath'
        ? { ...pin, trackedRelativePath: value }
        : name === 'releaseTag'
        ? { ...pin, releaseTag: value }
        : name === 'releaseName'
        ? { ...pin, releaseName: value }
        : pin
    this.setState({ pin: next, error: null })
  }

  private reviewPin = () => {
    const pin = this.state.pin
    if (pin === null) {
      return
    }
    const normalized = validateCheapLfsTrackedPath(pin.trackedRelativePath)
    if (normalized === null) {
      this.setState({
        error:
          'Enter a safe repository-relative path without parent traversal, an absolute root, or Git metadata.',
      })
      return
    }
    if (pin.releaseTag.trim().length === 0) {
      this.setState({
        error: 'Enter the release tag to store this file under.',
      })
      return
    }
    // Files larger than the per-asset cap are no longer rejected; they are split
    // into parts during the pin, so the review step just proceeds.
    this.setState({
      pin: { ...pin, trackedRelativePath: normalized, reviewing: true },
      error: null,
    })
  }

  private revisePin = () => {
    const pin = this.state.pin
    if (pin !== null && this.state.busy === null) {
      this.setState({ pin: { ...pin, reviewing: false } })
    }
  }

  private cancelPin = () => {
    if (this.state.busy === null) {
      this.setState({ pin: null, error: null })
    }
  }

  private submitPin = async () => {
    const pin = this.state.pin
    if (pin === null || !pin.reviewing) {
      return
    }
    const options: ICheapLfsPinOptions = {
      absoluteFilePath: pin.sourcePath,
      trackedRelativePath: pin.trackedRelativePath,
      releaseTag: pin.releaseTag.trim(),
      releaseName:
        pin.releaseName.trim().length > 0 ? pin.releaseName.trim() : undefined,
    }
    const operation = this.startOperation('pin')
    if (operation === null) {
      return
    }
    this.lastProgressAt = 0
    try {
      await this.props.dispatcher.pinFileToRelease(
        this.props.repository,
        options,
        operation.controller.signal,
        progress =>
          this.updateProgress(
            operation.generation,
            operation.controller,
            progress
          )
      )
      if (!this.isCurrent(operation.generation, operation.controller)) {
        return
      }
      this.finishOperation(operation.controller)
      this.setState(
        { busy: null, progress: null, pin: null },
        () =>
          void this.loadPointers(
            `Pinned ${options.trackedRelativePath} to release “${options.releaseTag}”. The pointer is a normal working-tree change — commit it to share.`
          )
      )
    } catch (error) {
      if (this.isCurrent(operation.generation, operation.controller)) {
        const canceled = (error as Error)?.name === 'AbortError'
        this.setState({
          busy: null,
          progress: null,
          error: canceled ? null : errorMessage(error),
          notice: canceled ? 'Pin canceled.' : null,
        })
      }
    } finally {
      this.finishOperation(operation.controller)
    }
  }

  private cancelOperation = () => {
    this.operationController?.abort()
    this.setState({ notice: 'Canceling the current cheap LFS operation…' })
  }

  private renderIntro() {
    const account = getGitHubReleasesAccount(
      this.props.repository,
      this.props.accounts
    )
    return (
      <div className="cheap-lfs-intro">
        <p>
          Store a large file as a GitHub Release asset and commit only a small
          text pointer in its place. This is <strong>not</strong> Git LFS: other
          clients that lack this app see the pointer text, not the file. Draft
          releases are only fetchable by app users signed in to the repository's
          account, so publish the release when collaborators need it.
        </p>
        <p className="cheap-lfs-account" role="status">
          {account === null
            ? 'Sign in with the account selected for this repository to pin or materialize files.'
            : `Using ${account.login} · ${account.friendlyEndpoint}`}
        </p>
      </div>
    )
  }

  private renderStatus() {
    const { busy, materializingPath, progress, error, notice } = this.state
    const busyLabel =
      busy === 'materialize' && materializingPath !== null
        ? `materialize ${materializingPath}`
        : busy
    return (
      <div className="cheap-lfs-status" aria-live="polite">
        {busy !== null && (
          <div className="cheap-lfs-busy" role="status">
            <span>Working: {busyLabel}</span>
            <Button onClick={this.cancelOperation}>Cancel</Button>
          </div>
        )}
        {progress !== null && (
          <div className="cheap-lfs-progress">
            <progress
              max={Math.max(1, progress.totalBytes)}
              value={progress.transferredBytes}
              aria-label={`Cheap LFS ${progress.direction} progress`}
            />
            <span>
              {formatBytes(progress.transferredBytes)} of{' '}
              {formatBytes(progress.totalBytes)}
            </span>
          </div>
        )}
        {error !== null && (
          <p className="cheap-lfs-error" role="alert">
            {error}
          </p>
        )}
        {notice !== null && (
          <p className="cheap-lfs-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    )
  }

  private renderPin() {
    const pin = this.state.pin
    if (pin === null) {
      return null
    }
    if (pin.reviewing) {
      return (
        <section
          className="cheap-lfs-pin-review"
          aria-labelledby="cheap-lfs-pin-review-title"
        >
          <h4 id="cheap-lfs-pin-review-title">Review the pin</h4>
          <dl>
            <dt>Local file</dt>
            <dd className="path">{Path.basename(pin.sourcePath)}</dd>
            <dt>Committed pointer path</dt>
            <dd className="path">{pin.trackedRelativePath}</dd>
            <dt>Release tag</dt>
            <dd>{pin.releaseTag.trim()}</dd>
            <dt>Release name</dt>
            <dd>{pin.releaseName.trim() || 'Same as the tag'}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(pin.sizeInBytes)}</dd>
          </dl>
          {pin.sizeInBytes > CHEAP_LFS_PART_SIZE_BYTES && (
            <p className="cheap-lfs-split-note" role="status">
              This file is larger than the{' '}
              {formatBytes(CHEAP_LFS_PART_SIZE_BYTES)} per-asset limit, so it
              will be split into{' '}
              {planFileParts(pin.sizeInBytes, CHEAP_LFS_PART_SIZE_BYTES).length}{' '}
              parts uploaded as separate release assets. The pointer records
              every part so materialize rebuilds the original file.
            </p>
          )}
          <p>
            The file uploads to the release; the pointer replaces it in your
            working tree. Commit the pointer to share it.
          </p>
          <div className="repository-tool-controls">
            <Button
              disabled={this.state.busy !== null}
              onClick={this.submitPin}
            >
              Pin file
            </Button>
            <Button
              disabled={this.state.busy !== null}
              onClick={this.revisePin}
            >
              Revise
            </Button>
            <Button
              disabled={this.state.busy !== null}
              onClick={this.cancelPin}
            >
              Cancel
            </Button>
          </div>
        </section>
      )
    }
    return (
      <section
        className="cheap-lfs-pin-form"
        aria-labelledby="cheap-lfs-pin-form-title"
      >
        <h4 id="cheap-lfs-pin-form-title">Pin a large file</h4>
        <p className="cheap-lfs-pin-source">
          {Path.basename(pin.sourcePath)} · {formatBytes(pin.sizeInBytes)}
        </p>
        <label>
          <span>Tracked file path</span>
          <input
            name="trackedRelativePath"
            value={pin.trackedRelativePath}
            maxLength={4096}
            spellCheck={false}
            autoComplete="off"
            onChange={this.onPinField}
          />
        </label>
        <label>
          <span>Release tag</span>
          <input
            name="releaseTag"
            value={pin.releaseTag}
            maxLength={255}
            spellCheck={false}
            autoComplete="off"
            onChange={this.onPinField}
          />
        </label>
        <label>
          <span>Release name (optional)</span>
          <input
            name="releaseName"
            value={pin.releaseName}
            maxLength={1024}
            onChange={this.onPinField}
          />
        </label>
        <p className="cheap-lfs-pin-help">
          Files up to 2 GiB upload as a single asset; larger files are split
          automatically into 2 GiB parts, each stored as its own release asset
          and recorded in the pointer. If the tag has no release yet, an
          unpublished draft is created for the assets.
        </p>
        <div className="repository-tool-controls">
          <Button onClick={this.reviewPin}>Review pin</Button>
          <Button onClick={this.cancelPin}>Cancel</Button>
        </div>
      </section>
    )
  }

  private renderRow(entry: ICheapLfsPointerEntry) {
    const busy = this.state.busy !== null
    return (
      <article className="cheap-lfs-row" key={entry.relativePath}>
        <div className="cheap-lfs-row-heading">
          <div>
            <h4 className="cheap-lfs-row-path">{entry.relativePath}</h4>
            <span className="cheap-lfs-row-meta">
              {entry.pointer.releaseTag} · {entry.pointer.assetName}
            </span>
          </div>
          <span className="cheap-lfs-row-size">
            {formatBytes(entry.pointer.sizeInBytes)}
          </span>
        </div>
        <div className="repository-tool-controls">
          <Button
            disabled={busy}
            onClick={this.materializeHandler(entry.relativePath)}
          >
            Materialize
          </Button>
        </div>
      </article>
    )
  }

  private renderList() {
    const visible = this.visiblePointers()
    return (
      <section
        className="cheap-lfs-list"
        aria-labelledby="cheap-lfs-list-title"
      >
        <div className="cheap-lfs-list-heading">
          <div>
            <h3 id="cheap-lfs-list-title">Pinned files</h3>
            <span>{this.state.pointers.length} in this working tree</span>
          </div>
          <div className="repository-tool-controls">
            <Button
              disabled={this.state.busy !== null}
              onClick={this.choosePinFile}
            >
              Pin a large file…
            </Button>
            <Button
              disabled={
                this.state.busy !== null || this.state.pointers.length === 0
              }
              onClick={this.materializeAll}
            >
              Materialize all
            </Button>
            <Button disabled={this.state.busy !== null} onClick={this.refresh}>
              Refresh
            </Button>
          </div>
        </div>
        <div className="cheap-lfs-search">
          <Octicon symbol={octicons.search} />
          <input
            type="search"
            className="cheap-lfs-search-input"
            placeholder="Search pinned files"
            aria-label="Search pinned files"
            value={this.state.filter}
            onChange={this.onFilterChanged}
          />
          <FilterModeControl
            mode={this.state.filterMode}
            caseSensitive={this.state.caseSensitive}
            onModeChange={this.onFilterModeChanged}
            onCaseSensitiveChange={this.onCaseSensitiveChanged}
            regexBuilderTarget="Pinned files"
            getSampleItems={this.getFilterSampleItems}
            filterText={this.state.filter}
            onRegexPatternApply={this.onRegexPatternApply}
          />
        </div>
        {this.renderPin()}
        {visible.length === 0 ? (
          <p className="cheap-lfs-empty">
            {this.state.pointers.length === 0
              ? this.state.loaded
                ? 'No cheap LFS pointers are committed in this working tree yet.'
                : 'Scanning the working tree for pointers…'
              : 'No pinned file matches this search.'}
          </p>
        ) : (
          <div className="cheap-lfs-rows">
            {visible.map(entry => this.renderRow(entry))}
          </div>
        )}
      </section>
    )
  }

  public render() {
    return (
      <div
        className="cheap-lfs"
        role="group"
        aria-label="Release-backed large files"
      >
        {this.renderIntro()}
        {this.renderStatus()}
        {this.renderList()}
      </div>
    )
  }
}
