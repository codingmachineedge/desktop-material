import * as Path from 'path'
import { stat } from 'fs/promises'
import * as React from 'react'
import { Account } from '../../models/account'
import { Repository } from '../../models/repository'
import {
  ICheapLfsBatchMaterializeResult,
  ICheapLfsMaterializeResult,
  ICheapLfsPinOptions,
  ICheapLfsPinResult,
  ICheapLfsManagedPointerEntry,
} from '../../lib/cheap-lfs/operations'
import type { ICheapLfsOciMutationResult } from '../../lib/cheap-lfs/oci-operations'
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
import { t } from '../../lib/i18n'
import {
  getCheapLfsCloudCompressionPolicy,
  getCheapLfsCloudCompressionStats,
  IEnsureCheapLfsCloudCompressionResult,
} from '../../lib/cheap-lfs/cloud-compression'
import {
  getCheapLfsStorageProvider,
  IBuildRunPreferences,
} from '../../models/build-run-preferences'
import { Checkbox, CheckboxValue } from '../lib/checkbox'

/**
 * The dispatcher surface the cheap-LFS panel drives. The real `Dispatcher`
 * satisfies this structurally, and the panel's tests inject a fake. Account
 * resolution lives behind these methods (in the app store), so the panel never
 * has to select an account for the transfer itself.
 */
export interface ICheapLfsDispatcher {
  listCheapLfsPointers(
    repository: Repository
  ): Promise<ReadonlyArray<ICheapLfsManagedPointerEntry>>
  pinFileToRelease(
    repository: Repository,
    options: ICheapLfsPinOptions,
    signal?: AbortSignal,
    onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
  ): Promise<ICheapLfsPinResult | ICheapLfsOciMutationResult>
  materializePointer(
    repository: Repository,
    trackedRelativePath: string,
    signal?: AbortSignal,
    onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
  ): Promise<ICheapLfsMaterializeResult>
  materializeAllCheapLfsPointers(
    repository: Repository,
    signal?: AbortSignal,
    onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
  ): Promise<ICheapLfsBatchMaterializeResult>
  cancelAutoMaterializeCheapLfs(
    repository: Repository,
    requestSignal?: AbortSignal
  ): void
  removeCheapLfsPointer(
    repository: Repository,
    trackedRelativePath: string,
    signal?: AbortSignal,
    onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
  ): Promise<void>
  updateRepositoryBuildRunPreferences?(
    repository: Repository,
    preferences: IBuildRunPreferences
  ): Promise<IEnsureCheapLfsCloudCompressionResult | null>
  ensureCheapLfsCloudCompressionWorkflow?(
    repository: Repository,
    preferences: IBuildRunPreferences
  ): Promise<IEnsureCheapLfsCloudCompressionResult>
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
type CheapLfsBusy = 'listing' | 'pin' | 'materialize' | 'remove'

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
  readonly pointers: ReadonlyArray<ICheapLfsManagedPointerEntry>
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
  readonly cloudBusy: boolean
  readonly cloudPrivateOptIn: boolean
  readonly cloudWorkflowReady: boolean
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
 * committed cheap-LFS metadata from the worktree/index, shows whether each path
 * is a pointer or verified materialized bytes, and pins a chosen large file to
 * the configured Release or OCI backend so only a small pointer is committed.
 * It is not real Git LFS — see the copy rendered in the panel intro.
 */
export class CheapLfs extends React.Component<ICheapLfsProps, ICheapLfsState> {
  private mounted = false
  private generation = 0
  private cloudGeneration = 0
  private operationController: AbortController | null = null
  private lastProgressAt = 0
  /** True while the current operation is a whole-repository Materialize all. */
  private materializeAllInFlight = false
  private readonly materializeHandlers = new Map<string, () => void>()
  private readonly removeHandlers = new Map<string, () => void>()

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
      cloudBusy: false,
      cloudPrivateOptIn:
        props.repository.buildRunPreferences.cheapLfsCloudCompression === true,
      cloudWorkflowReady: false,
    }
  }

  public componentDidMount() {
    this.mounted = true
    void this.loadPointers()
    void this.syncCloudCompression()
  }

  public componentDidUpdate(prevProps: ICheapLfsProps) {
    if (prevProps.repository.hash !== this.props.repository.hash) {
      const cloudRepositoryChanged =
        prevProps.repository.id !== this.props.repository.id ||
        prevProps.repository.path !== this.props.repository.path ||
        prevProps.repository.gitHubRepository?.hash !==
          this.props.repository.gitHubRepository?.hash
      if (cloudRepositoryChanged) {
        this.cloudGeneration++
      }
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
          cloudBusy: cloudRepositoryChanged ? false : this.state.cloudBusy,
          cloudPrivateOptIn:
            this.props.repository.buildRunPreferences
              .cheapLfsCloudCompression === true,
          cloudWorkflowReady: cloudRepositoryChanged
            ? false
            : this.state.cloudWorkflowReady,
        },
        () => {
          void this.loadPointers()
          if (cloudRepositoryChanged) {
            void this.syncCloudCompression()
          }
        }
      )
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.generation++
    this.cloudGeneration++
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
    this.materializeAllInFlight = false
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

  private loadPointers = async (notice?: string, failure?: string) => {
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
        error: failure ?? null,
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

  private visiblePointers(): ReadonlyArray<ICheapLfsManagedPointerEntry> {
    const query = this.state.filter.trim()
    if (query.length === 0) {
      return this.state.pointers
    }
    const { results } = matchWithMode(
      query,
      this.state.pointers,
      entry =>
        entry.kind === 'release'
          ? [
              entry.relativePath,
              `${entry.pointer.releaseTag} ${entry.pointer.assetName}`,
              entry.provider,
            ]
          : [
              entry.relativePath,
              entry.pointer.image,
              entry.pointer.object,
              entry.provider,
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

  private removeHandler(entry: ICheapLfsManagedPointerEntry): () => void {
    const key = `${entry.workingTreeState}\0${entry.relativePath}`
    const existing = this.removeHandlers.get(key)
    if (existing !== undefined) {
      return existing
    }
    const handler = () =>
      void this.removeFromRegistryImage(
        entry.relativePath,
        entry.workingTreeState !== 'pointer'
      )
    this.removeHandlers.set(key, handler)
    return handler
  }

  private removeFromRegistryImage = async (
    relativePath: string,
    deletesLocalBytes: boolean
  ) => {
    const remove = this.props.dispatcher.removeCheapLfsPointer
    if (
      !window.confirm(
        `Remove ${relativePath} from the current Cheap LFS registry image? A new immutable image will be published and the remaining pointers will be updated.${
          deletesLocalBytes
            ? ' The materialized local file (including any local edits) will also be deleted.'
            : ''
        } Commit those changes together.`
      )
    ) {
      return
    }
    const operation = this.startOperation('remove')
    if (operation === null) {
      return
    }
    try {
      await remove(
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
            `Removed ${relativePath} from the logical registry image. Review and commit all updated pointers together.`
          )
      )
    } catch (error) {
      if (this.isCurrent(operation.generation, operation.controller)) {
        this.setState({
          busy: null,
          progress: null,
          error:
            (error as Error)?.name === 'AbortError'
              ? null
              : errorMessage(error),
        })
      }
    } finally {
      this.finishOperation(operation.controller)
    }
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

  /** Materialize all through the AppStore's repository-scoped shared queue. */
  private materializeAll = async () => {
    const targets = this.state.pointers.filter(
      entry => entry.workingTreeState === 'pointer'
    )
    if (targets.length === 0) {
      return
    }
    const operation = this.startOperation('materialize')
    if (operation === null) {
      return
    }
    this.materializeAllInFlight = true
    this.lastProgressAt = 0
    this.setState({ materializingPath: 'all pinned files' })
    try {
      const summary =
        await this.props.dispatcher.materializeAllCheapLfsPointers(
          this.props.repository,
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
      const completed = summary.materialized.length
      const failed = summary.failures.length
      this.setState(
        { busy: null, progress: null, materializingPath: null },
        () =>
          void this.loadPointers(
            failed > 0
              ? undefined
              : summary.canceled
              ? 'Materialize canceled; completed files remain verified locally.'
              : 'Materialize all finished. The pinned-file list now reflects every verified local object.',
            failed > 0
              ? `Materialized ${completed} ${
                  completed === 1 ? 'file' : 'files'
                }; ${failed} ${
                  failed === 1
                    ? 'file failed and was left as a pointer.'
                    : 'files failed and were left as pointers.'
                }`
              : undefined
          )
      )
    } catch (error) {
      if (this.isCurrent(operation.generation, operation.controller)) {
        const canceled = (error as Error)?.name === 'AbortError'
        if (canceled) {
          this.finishOperation(operation.controller)
          this.setState(
            { busy: null, progress: null, materializingPath: null },
            () =>
              void this.loadPointers(
                'Materialize canceled; completed files remain verified locally.'
              )
          )
        } else {
          this.setState({
            busy: null,
            progress: null,
            materializingPath: null,
            error: errorMessage(error),
            notice: null,
          })
        }
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
            title: 'Choose a large file to pin',
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
    if (
      getCheapLfsStorageProvider(this.props.repository.buildRunPreferences) ===
        'release' &&
      pin.releaseTag.trim().length === 0
    ) {
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
      const provider = getCheapLfsStorageProvider(
        this.props.repository.buildRunPreferences
      )
      this.setState(
        { busy: null, progress: null, pin: null },
        () =>
          void this.loadPointers(
            provider === 'release'
              ? `Pinned ${options.trackedRelativePath} to published prerelease “${options.releaseTag}”. The pointer is a normal working-tree change — commit it to share.`
              : `Added ${options.trackedRelativePath} to the logical ${
                  provider === 'ghcr' ? 'GHCR' : 'Docker Hub'
                } image. Review and commit every updated pointer together.`
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
    const controller = this.operationController
    controller?.abort()
    if (controller !== null && this.state.busy === 'materialize') {
      // Canceling Materialize all cancels repository-wide: a queued automatic
      // restore would otherwise take over the queue slot and restart the
      // downloads the user just canceled. A single-file cancel stays scoped to
      // its own request signal.
      this.props.dispatcher.cancelAutoMaterializeCheapLfs(
        this.props.repository,
        this.materializeAllInFlight ? undefined : controller.signal
      )
    }
    this.setState({ notice: 'Canceling the current cheap LFS operation…' })
  }

  private async syncCloudCompression(
    preferences: IBuildRunPreferences = this.props.repository
      .buildRunPreferences
  ): Promise<void> {
    const dispatcher = this.props.dispatcher
    const repository = this.props.repository
    const generation = this.cloudGeneration
    if (
      getCheapLfsStorageProvider(preferences) !== 'release' ||
      dispatcher.ensureCheapLfsCloudCompressionWorkflow === undefined ||
      this.state.cloudBusy
    ) {
      return
    }
    this.setState({ cloudBusy: true })
    try {
      const result = await dispatcher.ensureCheapLfsCloudCompressionWorkflow(
        repository,
        preferences
      )
      if (!this.isCurrentCloudRepository(repository, generation)) {
        return
      }
      const enabled =
        result.policy === 'automatic-public' ||
        result.policy === 'enabled-private'
      this.setState({
        cloudBusy: false,
        cloudWorkflowReady: enabled,
        notice: !enabled
          ? result.changed
            ? t('cheapLfs.cloud.workflowDisabled')
            : this.state.notice
          : result.changed
          ? t('cheapLfs.cloud.workflowAdded')
          : enabled
          ? t('cheapLfs.cloud.workflowReady')
          : this.state.notice,
      })
    } catch (error) {
      if (this.isCurrentCloudRepository(repository, generation)) {
        this.setState({ cloudBusy: false, error: errorMessage(error) })
      }
    }
  }

  private isCurrentCloudRepository(
    repository: Repository,
    generation: number
  ): boolean {
    if (!this.mounted) {
      return false
    }
    const sameRepository =
      this.props.repository.id === repository.id &&
      this.props.repository.path === repository.path
    if (!sameRepository) {
      return false
    }
    return this.cloudGeneration === generation
  }

  private onPrivateCloudCompressionChanged = async (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    if (
      this.props.repository.gitHubRepository?.isPrivate !== true ||
      this.state.cloudBusy
    ) {
      return
    }
    const repository = this.props.repository
    const generation = this.cloudGeneration
    const enabled = event.currentTarget.checked
    const preferences: IBuildRunPreferences = {
      ...repository.buildRunPreferences,
      cheapLfsCloudCompression: enabled,
    }
    const dispatcher = this.props.dispatcher
    if (dispatcher.updateRepositoryBuildRunPreferences === undefined) {
      this.setState({
        error: 'This build cannot persist the cloud-compression setting.',
      })
      return
    }
    this.setState({
      cloudBusy: true,
      cloudPrivateOptIn: enabled,
      error: null,
      notice: null,
    })
    try {
      const result = await dispatcher.updateRepositoryBuildRunPreferences(
        repository,
        preferences
      )
      if (!this.isCurrentCloudRepository(repository, generation)) {
        return
      }
      this.setState({
        cloudBusy: false,
        cloudWorkflowReady: enabled,
        notice: enabled
          ? result?.changed === true
            ? t('cheapLfs.cloud.workflowAdded')
            : t('cheapLfs.cloud.workflowReady')
          : t('cheapLfs.cloud.workflowDisabled'),
      })
    } catch (error) {
      if (this.isCurrentCloudRepository(repository, generation)) {
        this.setState({
          cloudBusy: false,
          cloudPrivateOptIn:
            this.props.repository.buildRunPreferences
              .cheapLfsCloudCompression === true,
          error: errorMessage(error),
        })
      }
    }
  }

  private renderCloudCompression() {
    const preferences: IBuildRunPreferences = {
      ...this.props.repository.buildRunPreferences,
      cheapLfsCloudCompression: this.state.cloudPrivateOptIn,
    }
    const policy = getCheapLfsCloudCompressionPolicy(
      this.props.repository,
      preferences
    )
    if (
      getCheapLfsStorageProvider(preferences) !== 'release' ||
      policy === 'not-github'
    ) {
      return null
    }
    return (
      <section
        className="cheap-lfs-cloud-compression"
        aria-labelledby="cheap-lfs-cloud-compression-title"
      >
        <h3 id="cheap-lfs-cloud-compression-title">
          {t('cheapLfs.cloud.title')}
        </h3>
        {policy === 'automatic-public' && (
          <p>{t('cheapLfs.cloud.publicAutomatic')}</p>
        )}
        {(policy === 'enabled-private' || policy === 'disabled-private') && (
          <>
            <Checkbox
              label={t('cheapLfs.cloud.privateToggle')}
              disabled={this.state.cloudBusy}
              value={
                this.state.cloudPrivateOptIn
                  ? CheckboxValue.On
                  : CheckboxValue.Off
              }
              onChange={this.onPrivateCloudCompressionChanged}
            />
            <p>{t('cheapLfs.cloud.privateHelp')}</p>
          </>
        )}
        {policy === 'visibility-unknown' && (
          <p>{t('cheapLfs.cloud.visibilityUnknown')}</p>
        )}
        <p>{t('cheapLfs.cloud.localOnly')}</p>
        {this.state.cloudWorkflowReady && !this.state.cloudBusy && (
          <p className="cheap-lfs-cloud-ready" role="status">
            {t('cheapLfs.cloud.workflowReady')}
          </p>
        )}
      </section>
    )
  }

  private renderIntro() {
    const account = getGitHubReleasesAccount(
      this.props.repository,
      this.props.accounts
    )
    const provider = getCheapLfsStorageProvider(
      this.props.repository.buildRunPreferences
    )
    const storageDescription =
      provider === 'release'
        ? 'a published GitHub prerelease'
        : provider === 'ghcr'
        ? 'one versioned GHCR image'
        : 'one versioned Docker Hub image'
    return (
      <div className="cheap-lfs-intro">
        <h2>{t('cheapLfs.managerTitle')}</h2>
        <p>{t('cheapLfs.managerIntro')}</p>
        <p>
          Store large files in {storageDescription} and commit only small text
          pointers in their place. This is <strong>not</strong> Git LFS: plain
          Git clients see pointer text until Desktop Material restores the
          verified bytes. OCI mode keeps additions and removals in one logical
          image tag while every committed pointer names an immutable digest.
        </p>
        <p className="cheap-lfs-account" role="status">
          {provider === 'docker-hub'
            ? 'Docker Hub uses your existing Docker credential-store sign-in; secrets are never saved in this repository.'
            : account === null
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
      const provider = getCheapLfsStorageProvider(
        this.props.repository.buildRunPreferences
      )
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
            {provider === 'release' ? (
              <>
                <dt>Published prerelease tag</dt>
                <dd>{pin.releaseTag.trim()}</dd>
                <dt>Release name</dt>
                <dd>{pin.releaseName.trim() || 'Same as the tag'}</dd>
              </>
            ) : (
              <>
                <dt>Registry storage</dt>
                <dd>
                  {provider === 'ghcr'
                    ? t('cheapLfs.settings.storageGhcr')
                    : t('cheapLfs.settings.storageDockerHub')}
                </dd>
                <dt>Update behavior</dt>
                <dd>
                  Reuse unchanged layers and publish a new immutable manifest
                  under the same logical tag
                </dd>
              </>
            )}
            <dt>Size</dt>
            <dd>{formatBytes(pin.sizeInBytes)}</dd>
          </dl>
          {pin.sizeInBytes > CHEAP_LFS_PART_SIZE_BYTES && (
            <p className="cheap-lfs-split-note" role="status">
              This file is larger than the{' '}
              {formatBytes(CHEAP_LFS_PART_SIZE_BYTES)} per-asset limit, so it
              will be split into{' '}
              {planFileParts(pin.sizeInBytes, CHEAP_LFS_PART_SIZE_BYTES).length}{' '}
              parts uploaded as separate{' '}
              {provider === 'release' ? 'release assets' : 'OCI layers'}. The
              pointer records every part so materialize rebuilds the original
              file. A timed-out registry layer retries at half the size.
            </p>
          )}
          <p>
            The file uploads to the selected storage; the pointer replaces it in
            your working tree. Commit all generated pointer changes together to
            share the verified snapshot.
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
    const provider = getCheapLfsStorageProvider(
      this.props.repository.buildRunPreferences
    )
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
        {provider === 'release' && (
          <>
            <label>
              <span>Published prerelease tag</span>
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
          </>
        )}
        <p className="cheap-lfs-pin-help">
          {provider === 'release'
            ? 'Files up to 2 GiB upload as a single asset; larger files are split automatically into 1.5 GiB parts. A published prerelease is created without changing the stable Latest release.'
            : 'The full repository object set stays in one logical image. New versions reuse unchanged layers, split new data into at most 1.5 GiB layers, and halve a layer after upload timeout. Private-repository payloads are encrypted with the shared tracked key.'}
        </p>
        <div className="repository-tool-controls">
          <Button onClick={this.reviewPin}>Review pin</Button>
          <Button onClick={this.cancelPin}>Cancel</Button>
        </div>
      </section>
    )
  }

  private renderRow(entry: ICheapLfsManagedPointerEntry) {
    const busy = this.state.busy !== null
    const releaseCompression =
      entry.kind === 'release'
        ? getCheapLfsCloudCompressionStats(entry.pointer)
        : null
    const savings =
      releaseCompression === null ||
      releaseCompression.originalSizeInBytes === 0
        ? 0
        : Math.max(
            0,
            Math.round(
              (1 -
                releaseCompression.storedSizeInBytes /
                  releaseCompression.originalSizeInBytes) *
                1000
            ) / 10
          )
    const compressionLabel =
      releaseCompression === null
        ? null
        : releaseCompression.compressedObjects === 0
        ? t('cheapLfs.cloud.raw')
        : releaseCompression.rawObjects === 0
        ? t('cheapLfs.cloud.compressed', { savings: String(savings) })
        : t('cheapLfs.cloud.mixed', {
            compressed: String(releaseCompression.compressedObjects),
            total: String(releaseCompression.totalObjects),
            savings: String(savings),
          })
    const providerMeta =
      entry.kind === 'release'
        ? `${t('cheapLfs.settings.storageRelease')} · ${
            entry.pointer.releaseTag
          } · ${entry.pointer.assetName}`
        : `${
            entry.provider === 'ghcr'
              ? t('cheapLfs.settings.storageGhcr')
              : t('cheapLfs.settings.storageDockerHub')
          } · ${entry.pointer.image}`
    const localStateLabel =
      entry.workingTreeState === 'materialized'
        ? 'Materialized locally · verified against the committed pointer'
        : entry.workingTreeState === 'modified'
        ? 'Local bytes changed · pin again to store this version'
        : 'Pointer stored locally'
    return (
      <article className="cheap-lfs-row" key={entry.relativePath}>
        <div className="cheap-lfs-row-heading">
          <div>
            <h4 className="cheap-lfs-row-path">{entry.relativePath}</h4>
            <span className="cheap-lfs-row-meta">{providerMeta}</span>
            <span className="cheap-lfs-row-meta">{localStateLabel}</span>
            {compressionLabel !== null && (
              <span className="cheap-lfs-row-meta">{compressionLabel}</span>
            )}
          </div>
          <span className="cheap-lfs-row-size">
            {formatBytes(entry.pointer.sizeInBytes)}
          </span>
        </div>
        <div className="repository-tool-controls">
          <Button
            disabled={busy || entry.workingTreeState !== 'pointer'}
            onClick={this.materializeHandler(entry.relativePath)}
          >
            {entry.workingTreeState === 'pointer'
              ? 'Materialize'
              : entry.workingTreeState === 'materialized'
              ? 'Already materialized'
              : 'Local edits protected'}
          </Button>
          {entry.kind === 'oci' && (
            <Button disabled={busy} onClick={this.removeHandler(entry)}>
              Remove from image
            </Button>
          )}
        </div>
      </article>
    )
  }

  private renderList() {
    const visible = this.visiblePointers()
    const restorableCount = this.state.pointers.filter(
      entry => entry.workingTreeState === 'pointer'
    ).length
    return (
      <section
        className="cheap-lfs-list"
        aria-labelledby="cheap-lfs-list-title"
      >
        <div className="cheap-lfs-list-heading">
          <div>
            <h3 id="cheap-lfs-list-title">Pinned files</h3>
            <span>{this.state.pointers.length} tracked by Cheap LFS</span>
          </div>
          <div className="repository-tool-controls">
            <Button
              disabled={this.state.busy !== null}
              onClick={this.choosePinFile}
            >
              Pin a large file…
            </Button>
            <Button
              disabled={this.state.busy !== null || restorableCount === 0}
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
            data-search-surface-id="cheap-lfs"
            type="search"
            className="cheap-lfs-search-input"
            placeholder="Search pinned files"
            aria-label="Search pinned files"
            value={this.state.filter}
            onChange={this.onFilterChanged}
          />
          <FilterModeControl
            searchSurfaceId="cheap-lfs"
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
        aria-label="Cheap LFS large files"
      >
        {this.renderIntro()}
        {this.renderCloudCompression()}
        {this.renderStatus()}
        {this.renderList()}
      </div>
    )
  }
}
