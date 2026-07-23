import * as Path from 'path'
import * as React from 'react'
import { shell } from '../../lib/app-shell'
import { t } from '../../lib/i18n'
import { Account } from '../../models/account'
import { Repository } from '../../models/repository'
import {
  getGitHubReleasesAccount,
  getGitHubReleasesAvailability,
  GitHubReleasesAvailability,
  GitHubReleasesStore,
  IGitHubReleaseMutationReview,
} from '../../lib/stores/github-releases-store'
import {
  IGitHubRelease,
  IGitHubReleaseAsset,
  IGitHubReleaseDraft,
  normalizeGitHubReleaseAssetLabel,
  normalizeGitHubReleaseAssetName,
  normalizeGitHubReleaseDraft,
} from '../../lib/github-releases'
import { IGitHubReleaseTransferProgressEvent } from '../../lib/github-release-transfer'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { Button } from '../lib/button'
import { FilterModeControl } from '../lib/filter-mode-control'
import { LinkButton } from '../lib/link-button'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'
import {
  showItemInFolder,
  showOpenDialog,
  showSaveDialog,
} from '../main-process-proxy'

const ReleasesSearchFilterId = 'github-releases-search'

type ReleaseStatusFilter = 'all' | 'published' | 'prerelease' | 'draft'

type BusyOperation =
  | 'releases'
  | 'assets'
  | 'create'
  | 'update'
  | 'publish'
  | 'delete'
  | 'upload'
  | 'download'
  | 'delete-asset'
  | 'bulk-publish'
  | 'bulk-delete'

const BusyOperationLabels: Record<BusyOperation, string> = {
  releases: 'Loading releases…',
  assets: 'Loading release assets…',
  create: 'Creating release…',
  update: 'Updating release metadata…',
  publish: 'Publishing release…',
  delete: 'Deleting release…',
  upload: 'Uploading release asset…',
  download: 'Downloading release asset…',
  'delete-asset': 'Deleting release asset…',
  'bulk-publish': 'Publishing selected release drafts…',
  'bulk-delete': 'Deleting selected releases…',
}

interface IReleaseEditorState extends IGitHubReleaseDraft {
  readonly mode: 'create' | 'edit'
  readonly releaseId: number | null
  readonly reviewing: boolean
  readonly review: IGitHubReleaseMutationReview | null
  readonly publishImmediately: boolean
}

interface IAssetUploadState {
  readonly sourcePath: string
  readonly name: string
  readonly label: string
  readonly reviewing: boolean
  readonly review: IGitHubReleaseMutationReview | null
}

type ReleaseConfirmation =
  | {
      readonly kind: 'publish'
      readonly release: IGitHubRelease
      readonly review: IGitHubReleaseMutationReview
    }
  | {
      readonly kind: 'delete-release'
      readonly release: IGitHubRelease
      readonly review: IGitHubReleaseMutationReview
    }
  | {
      readonly kind: 'delete-asset'
      readonly release: IGitHubRelease
      readonly asset: IGitHubReleaseAsset
      readonly review: IGitHubReleaseMutationReview
    }
  | {
      readonly kind: 'bulk-publish' | 'bulk-delete'
      readonly releases: ReadonlyArray<IGitHubRelease>
      readonly reviews: ReadonlyArray<IGitHubReleaseMutationReview>
    }

interface ICompletedDownload {
  readonly path: string
  readonly assetName: string
  readonly localDigest: string
  readonly matchesGitHubDigest: boolean | null
}

interface IGitHubReleasesViewProps {
  readonly repository: Repository
  readonly accounts: ReadonlyArray<Account>
  readonly releasesStore: GitHubReleasesStore
  readonly chooseUploadFile?: () => Promise<string | null>
  readonly chooseDownloadDestination?: (
    asset: IGitHubReleaseAsset
  ) => Promise<string | null>
  readonly revealDownload?: (path: string) => Promise<void>
  readonly openDownload?: (path: string) => Promise<string | void>
}

interface IGitHubReleasesViewState {
  readonly repositoryKey: string
  readonly availability: GitHubReleasesAvailability
  readonly releases: ReadonlyArray<IGitHubRelease>
  readonly releasePage: number
  readonly nextReleasePage: number | null
  readonly releasesCapped: boolean
  readonly selectedReleaseId: number | null
  readonly selectedReleaseIds: ReadonlySet<number>
  readonly search: string
  readonly searchMode: FilterMode
  readonly searchCaseSensitive: boolean
  readonly statusFilter: ReleaseStatusFilter
  readonly assets: ReadonlyArray<IGitHubReleaseAsset>
  readonly assetPage: number
  readonly nextAssetPage: number | null
  readonly assetsCapped: boolean
  readonly busy: BusyOperation | null
  readonly failedOperation: 'releases' | 'assets' | null
  readonly message: string | null
  readonly error: string | null
  readonly editor: IReleaseEditorState | null
  readonly upload: IAssetUploadState | null
  readonly confirmation: ReleaseConfirmation | null
  readonly progress: IGitHubReleaseTransferProgressEvent | null
  readonly completedDownload: ICompletedDownload | null
}

function repositoryKey(repository: Repository): string {
  const remote = repository.gitHubRepository
  return `${repository.id}:${repository.path}:${repository.accountKey ?? ''}:${
    remote === null
      ? 'local'
      : `${remote.endpoint}/${remote.owner.login}/${remote.name}`
  }`
}

function initialState(
  props: IGitHubReleasesViewProps
): IGitHubReleasesViewState {
  return {
    repositoryKey: repositoryKey(props.repository),
    availability: getGitHubReleasesAvailability(
      props.repository,
      props.accounts
    ),
    releases: [],
    releasePage: 0,
    nextReleasePage: null,
    releasesCapped: false,
    selectedReleaseId: null,
    selectedReleaseIds: new Set(),
    search: '',
    searchMode: readPersistedFilterMode(ReleasesSearchFilterId),
    searchCaseSensitive: false,
    statusFilter: 'all',
    assets: [],
    assetPage: 0,
    nextAssetPage: null,
    assetsCapped: false,
    busy: null,
    failedOperation: null,
    message: null,
    error: null,
    editor: null,
    upload: null,
    confirmation: null,
    progress: null,
    completedDownload: null,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'GitHub Releases could not complete this operation safely.'
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

function formatTimestamp(date: Date): string {
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function ReleaseTimestamp(props: { readonly date: Date }) {
  return (
    <time dateTime={props.date.toISOString()}>
      {formatTimestamp(props.date)}
    </time>
  )
}

function releaseStatus(
  release: IGitHubRelease
): Exclude<ReleaseStatusFilter, 'all'> {
  if (release.draft) {
    return 'draft'
  }
  return release.prerelease ? 'prerelease' : 'published'
}

function releaseStatusLabel(release: IGitHubRelease): string {
  switch (releaseStatus(release)) {
    case 'draft':
      return 'Draft'
    case 'prerelease':
      return 'Pre-release'
    case 'published':
      return 'Published'
  }
}

function appendUnique<T extends { readonly id: number }>(
  current: ReadonlyArray<T>,
  incoming: ReadonlyArray<T>
): ReadonlyArray<T> {
  const values = new Map(current.map(item => [item.id, item]))
  for (const item of incoming) {
    values.set(item.id, item)
  }
  return [...values.values()]
}

export class GitHubReleasesView extends React.Component<
  IGitHubReleasesViewProps,
  IGitHubReleasesViewState
> {
  private mounted = false
  private generation = 0
  private operationController: AbortController | null = null
  private lastProgressAt = 0
  private openDownloadRequest = 0
  private selectAllVisibleRef = React.createRef<HTMLInputElement>()
  private releaseSearchRef = React.createRef<HTMLInputElement>()

  public constructor(props: IGitHubReleasesViewProps) {
    super(props)
    this.state = initialState(props)
  }

  public componentDidMount() {
    this.mounted = true
    if (this.state.availability === 'available') {
      void this.loadReleases(true)
    }
  }

  public componentDidUpdate(prevProps: IGitHubReleasesViewProps) {
    if (
      repositoryKey(prevProps.repository) !==
        repositoryKey(this.props.repository) ||
      prevProps.accounts !== this.props.accounts
    ) {
      this.resetForProps()
      return
    }
    this.reconcileSelectionWithVisibleReleases()
  }

  public componentWillUnmount() {
    this.mounted = false
    this.generation++
    this.openDownloadRequest++
    this.operationController?.abort()
    this.operationController = null
  }

  private resetForProps() {
    this.generation++
    this.openDownloadRequest++
    this.operationController?.abort()
    this.operationController = null
    const state = initialState(this.props)
    this.setState(state, () => {
      if (state.availability === 'available') {
        void this.loadReleases(true)
      }
    })
  }

  private startOperation(operation: BusyOperation): {
    readonly generation: number
    readonly controller: AbortController
  } | null {
    if (this.state.busy !== null || this.operationController !== null) {
      return null
    }
    const controller = new AbortController()
    this.operationController = controller
    this.setState({
      busy: operation,
      failedOperation: null,
      error: null,
      message: null,
      progress: null,
    })
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

  private loadReleases = async (
    refresh: boolean = false,
    completedMessage?: string
  ) => {
    const operation = this.startOperation('releases')
    if (operation === null) {
      return
    }
    const page = refresh ? 1 : this.state.nextReleasePage
    if (page === null) {
      this.finishOperation(operation.controller)
      this.setState({ busy: null })
      return
    }
    try {
      const result = await this.props.releasesStore.list(
        this.props.repository,
        page,
        operation.controller.signal
      )
      if (!this.isCurrent(operation.generation, operation.controller)) {
        return
      }
      const releases = refresh
        ? result.releases
        : appendUnique(this.state.releases, result.releases)
      const selectedReleaseId =
        this.state.selectedReleaseId !== null &&
        releases.some(release => release.id === this.state.selectedReleaseId)
          ? this.state.selectedReleaseId
          : releases[0]?.id ?? null
      const loadedReleaseIds = new Set(releases.map(release => release.id))
      const selectedReleaseIds = new Set(
        [...this.state.selectedReleaseIds].filter(id =>
          loadedReleaseIds.has(id)
        )
      )
      this.finishOperation(operation.controller)
      this.setState(
        {
          releases,
          releasePage: result.page,
          nextReleasePage: result.nextPage,
          releasesCapped: result.capped,
          selectedReleaseId,
          selectedReleaseIds,
          busy: null,
          failedOperation: null,
          error: null,
          message:
            completedMessage ??
            (refresh && releases.length === 0
              ? 'This repository does not have any Releases yet.'
              : null),
        },
        () => {
          if (
            selectedReleaseId !== null &&
            this.getVisibleReleases().releases.some(
              release => release.id === selectedReleaseId
            )
          ) {
            void this.loadAssets(selectedReleaseId, true, completedMessage)
          }
        }
      )
    } catch (error) {
      if (this.isCurrent(operation.generation, operation.controller)) {
        const canceled = (error as Error)?.name === 'AbortError'
        this.setState({
          busy: null,
          failedOperation: canceled ? null : 'releases',
          error: canceled ? null : errorMessage(error),
          message: canceled ? 'Release loading canceled.' : null,
        })
      }
    } finally {
      this.finishOperation(operation.controller)
    }
  }

  private loadAssets = async (
    releaseId: number,
    refresh: boolean = false,
    completedMessage?: string
  ) => {
    const operation = this.startOperation('assets')
    if (operation === null) {
      return
    }
    const page = refresh ? 1 : this.state.nextAssetPage
    if (page === null) {
      this.finishOperation(operation.controller)
      this.setState({ busy: null })
      return
    }
    try {
      const result = await this.props.releasesStore.listAssets(
        this.props.repository,
        releaseId,
        page,
        operation.controller.signal
      )
      if (
        !this.isCurrent(operation.generation, operation.controller) ||
        this.state.selectedReleaseId !== releaseId
      ) {
        return
      }
      this.finishOperation(operation.controller)
      this.setState({
        assets: refresh
          ? result.assets
          : appendUnique(this.state.assets, result.assets),
        assetPage: result.page,
        nextAssetPage: result.nextPage,
        assetsCapped: result.capped,
        busy: null,
        failedOperation: null,
        error: null,
        message: completedMessage ?? null,
      })
    } catch (error) {
      if (this.isCurrent(operation.generation, operation.controller)) {
        const canceled = (error as Error)?.name === 'AbortError'
        this.setState({
          busy: null,
          failedOperation: canceled ? null : 'assets',
          error: canceled ? null : errorMessage(error),
          message: canceled ? 'Asset loading canceled.' : null,
        })
      }
    } finally {
      this.finishOperation(operation.controller)
    }
  }

  private selectRelease = (releaseId: number) => {
    if (
      this.state.busy !== null ||
      releaseId === this.state.selectedReleaseId
    ) {
      return
    }
    this.setState(
      {
        selectedReleaseId: releaseId,
        assets: [],
        assetPage: 0,
        nextAssetPage: null,
        assetsCapped: false,
        editor: null,
        upload: null,
        confirmation: null,
        message: null,
        error: null,
      },
      () => void this.loadAssets(releaseId, true)
    )
  }

  private selectReleaseFromButton = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const releaseId = Number(event.currentTarget.value)
    if (Number.isSafeInteger(releaseId) && releaseId > 0) {
      this.selectRelease(releaseId)
    }
  }

  private loadMoreReleases = () => void this.loadReleases(false)

  private refreshReleases = () => void this.loadReleases(true)

  private retryFailedOperation = () => {
    if (this.state.failedOperation === 'assets') {
      const releaseId = this.state.selectedReleaseId
      if (releaseId !== null) {
        void this.loadAssets(releaseId, true)
      }
      return
    }
    void this.loadReleases(true)
  }

  private updateSearch = (event: React.ChangeEvent<HTMLInputElement>) =>
    this.setState({ search: event.currentTarget.value })

  private updateStatusFilter = (event: React.ChangeEvent<HTMLSelectElement>) =>
    this.setState({
      statusFilter: event.currentTarget.value as ReleaseStatusFilter,
    })

  private onSearchModeChange = (searchMode: FilterMode) => {
    persistFilterMode(ReleasesSearchFilterId, searchMode)
    this.setState({ searchMode })
  }

  private onSearchCaseSensitiveChange = (searchCaseSensitive: boolean) =>
    this.setState({ searchCaseSensitive })

  private onSearchPatternApply = (search: string) => this.setState({ search })

  private clearReleaseFilters = () =>
    this.setState({ search: '', statusFilter: 'all' })

  private toggleReleaseSelection = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const releaseId = Number(event.currentTarget.value)
    if (!Number.isSafeInteger(releaseId) || releaseId <= 0) {
      return
    }
    const checked = event.currentTarget.checked
    this.setState(state => {
      const selectedReleaseIds = new Set(state.selectedReleaseIds)
      if (checked) {
        selectedReleaseIds.add(releaseId)
      } else {
        selectedReleaseIds.delete(releaseId)
      }
      return { selectedReleaseIds, confirmation: null }
    })
  }

  private toggleAllVisibleReleases = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const visibleIds = this.getVisibleReleases().releases.map(
      release => release.id
    )
    const checked = event.currentTarget.checked
    this.setState(state => {
      const selectedReleaseIds = new Set(state.selectedReleaseIds)
      for (const id of visibleIds) {
        if (checked) {
          selectedReleaseIds.add(id)
        } else {
          selectedReleaseIds.delete(id)
        }
      }
      return { selectedReleaseIds, confirmation: null }
    })
  }

  private clearReleaseSelection = () =>
    this.setState({ selectedReleaseIds: new Set(), confirmation: null }, () => {
      const selectAllVisible = this.selectAllVisibleRef.current
      if (selectAllVisible !== null && !selectAllVisible.disabled) {
        selectAllVisible.focus()
      } else {
        this.releaseSearchRef.current?.focus()
      }
    })

  private selectedReleases(): ReadonlyArray<IGitHubRelease> {
    return this.state.releases.filter(release =>
      this.state.selectedReleaseIds.has(release.id)
    )
  }

  private confirmBulkPublish = () =>
    this.confirmBulkReleaseMutation(
      'bulk-publish',
      this.selectedReleases().filter(release => release.draft)
    )

  private confirmBulkDelete = () =>
    this.confirmBulkReleaseMutation('bulk-delete', this.selectedReleases())

  private confirmBulkReleaseMutation(
    kind: 'bulk-publish' | 'bulk-delete',
    releases: ReadonlyArray<IGitHubRelease>
  ) {
    if (releases.length === 0 || this.state.busy !== null) {
      return
    }
    try {
      const reviews = releases.map(release =>
        this.props.releasesStore.createMutationReview(
          this.props.repository,
          release
        )
      )
      this.setState({
        confirmation: { kind, releases, reviews },
        editor: null,
        upload: null,
        error: null,
        message: null,
      })
    } catch (error) {
      this.setState({ error: errorMessage(error) })
    }
  }

  private getSearchSampleItems = () =>
    this.state.releases.map(
      release => `${release.name || release.tagName} ${release.tagName}`
    )

  private getVisibleReleases(): {
    readonly releases: ReadonlyArray<IGitHubRelease>
    readonly regexError: string | null
  } {
    const { releases, statusFilter, search } = this.state
    const matchingStatus =
      statusFilter === 'all'
        ? releases
        : releases.filter(release => releaseStatus(release) === statusFilter)
    const query = search.trim()
    if (query.length === 0) {
      return { releases: matchingStatus, regexError: null }
    }

    const { results, regexError } = matchWithMode(
      query,
      matchingStatus,
      release => [
        `${release.name} ${release.tagName}`,
        [
          release.body,
          release.targetCommitish,
          release.authorLogin,
          ...release.assets.flatMap(asset => [
            asset.name,
            asset.label,
            asset.contentType,
          ]),
        ].join(' '),
      ],
      {
        mode: this.state.searchMode,
        caseSensitive: this.state.searchCaseSensitive,
      }
    )
    return { releases: results.map(match => match.item), regexError }
  }

  /**
   * Filters must not leave a hidden release selected in the adjacent detail
   * pane, where its edit and destructive actions would otherwise remain live.
   * Wait for an in-flight operation to settle before clearing its context.
   */
  private reconcileSelectionWithVisibleReleases() {
    const selectedReleaseId = this.state.selectedReleaseId
    if (selectedReleaseId === null || this.state.busy !== null) {
      return
    }
    const visible = this.getVisibleReleases().releases
    if (visible.some(release => release.id === selectedReleaseId)) {
      return
    }

    const assetsFailed = this.state.failedOperation === 'assets'
    this.setState({
      selectedReleaseId: null,
      assets: [],
      assetPage: 0,
      nextAssetPage: null,
      assetsCapped: false,
      failedOperation: assetsFailed ? null : this.state.failedOperation,
      error: assetsFailed ? null : this.state.error,
      editor: this.state.editor?.mode === 'edit' ? null : this.state.editor,
      upload: null,
      confirmation: null,
    })
  }

  private latestStableRelease(): IGitHubRelease | null {
    let latest: IGitHubRelease | null = null
    for (const release of this.state.releases) {
      if (releaseStatus(release) !== 'published') {
        continue
      }
      const releaseTime = (release.publishedAt ?? release.createdAt).getTime()
      const latestTime =
        latest === null
          ? Number.NEGATIVE_INFINITY
          : (latest.publishedAt ?? latest.createdAt).getTime()
      if (releaseTime > latestTime) {
        latest = release
      }
    }
    return latest
  }

  private releaseUrl(release: IGitHubRelease): string | null {
    const baseUrl = this.props.repository.gitHubRepository?.htmlURL
    if (baseUrl === null || baseUrl === undefined) {
      return null
    }
    const releasesUrl = `${baseUrl.replace(/\/+$/, '')}/releases`
    return release.draft
      ? releasesUrl
      : `${releasesUrl}/tag/${encodeURIComponent(release.tagName)}`
  }

  private preventSubmit = (event: React.FormEvent<HTMLFormElement>) =>
    event.preventDefault()

  private selectedRelease(): IGitHubRelease | null {
    return (
      this.state.releases.find(
        release => release.id === this.state.selectedReleaseId
      ) ?? null
    )
  }

  private openCreate = () => {
    this.setState({
      editor: {
        mode: 'create',
        releaseId: null,
        tagName: '',
        targetCommitish: 'main',
        name: '',
        body: '',
        prerelease: false,
        reviewing: false,
        review: null,
        publishImmediately: true,
      },
      upload: null,
      confirmation: null,
      error: null,
      message: null,
    })
  }

  private openEdit = () => {
    const release = this.selectedRelease()
    if (release === null) {
      return
    }
    try {
      const review = this.props.releasesStore.createMutationReview(
        this.props.repository,
        release
      )
      this.setState({
        editor: {
          mode: 'edit',
          releaseId: release.id,
          tagName: release.tagName,
          targetCommitish: release.targetCommitish,
          name: release.name,
          body: release.body,
          prerelease: release.prerelease,
          reviewing: false,
          review,
          publishImmediately: false,
        },
        upload: null,
        confirmation: null,
        error: null,
        message: null,
      })
    } catch (error) {
      this.setState({ error: errorMessage(error) })
    }
  }

  private closeEditor = () => this.setState({ editor: null, error: null })

  private onEditorText = (
    event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const editor = this.state.editor
    if (editor === null || editor.reviewing) {
      return
    }
    const element = event.currentTarget
    this.setState({
      editor: { ...editor, [element.name]: element.value },
      error: null,
    })
  }

  private onEditorPrerelease = (event: React.FormEvent<HTMLInputElement>) => {
    const editor = this.state.editor
    if (editor !== null && !editor.reviewing) {
      this.setState({
        editor: { ...editor, prerelease: event.currentTarget.checked },
      })
    }
  }

  private onEditorPublishImmediately = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    const editor = this.state.editor
    if (editor !== null && editor.mode === 'create' && !editor.reviewing) {
      this.setState({
        editor: {
          ...editor,
          publishImmediately: event.currentTarget.checked,
        },
      })
    }
  }

  private reviewEditor = () => {
    const editor = this.state.editor
    if (editor === null) {
      return
    }
    try {
      const normalized = normalizeGitHubReleaseDraft(editor)
      this.setState({ editor: { ...editor, ...normalized, reviewing: true } })
    } catch (error) {
      this.setState({ error: errorMessage(error) })
    }
  }

  private reviseEditor = () => {
    if (this.state.editor !== null) {
      this.setState({
        editor: { ...this.state.editor, reviewing: false },
        error: null,
      })
    }
  }

  private submitEditor = async () => {
    const editor = this.state.editor
    if (
      editor === null ||
      !editor.reviewing ||
      (editor.mode === 'edit' && editor.review === null)
    ) {
      return
    }
    const operation = this.startOperation(
      editor.mode === 'create' ? 'create' : 'update'
    )
    if (operation === null) {
      return
    }
    try {
      const release =
        editor.mode === 'create'
          ? await this.props.releasesStore.create(
              this.props.repository,
              editor,
              editor.publishImmediately,
              operation.controller.signal
            )
          : await this.props.releasesStore.update(
              this.props.repository,
              editor.review!,
              {
                releaseId: editor.releaseId!,
                tagName: editor.tagName,
                targetCommitish: editor.targetCommitish,
                name: editor.name,
                body: editor.body,
                prerelease: editor.prerelease,
              },
              operation.controller.signal
            )
      if (!this.isCurrent(operation.generation, operation.controller)) {
        return
      }
      const message =
        editor.mode === 'create'
          ? release.draft
            ? `Created unpublished draft ${release.tagName}.`
            : `Published ${release.tagName}.`
          : `Updated ${release.tagName}.`
      this.finishOperation(operation.controller)
      this.setState(
        {
          busy: null,
          editor: null,
          selectedReleaseId: release.id,
        },
        () => void this.loadReleases(true, message)
      )
    } catch (error) {
      if (this.isCurrent(operation.generation, operation.controller)) {
        const canceled = (error as Error)?.name === 'AbortError'
        this.setState({
          busy: null,
          error: canceled ? null : errorMessage(error),
          message: canceled ? 'Release change canceled.' : null,
        })
      }
    } finally {
      this.finishOperation(operation.controller)
    }
  }

  private confirmPublish = () => {
    const release = this.selectedRelease()
    if (release?.draft) {
      try {
        const review = this.props.releasesStore.createMutationReview(
          this.props.repository,
          release
        )
        this.setState({
          confirmation: { kind: 'publish', release, review },
          editor: null,
          upload: null,
          error: null,
        })
      } catch (error) {
        this.setState({ error: errorMessage(error) })
      }
    }
  }

  private confirmDeleteRelease = () => {
    const release = this.selectedRelease()
    if (release !== null) {
      try {
        const review = this.props.releasesStore.createMutationReview(
          this.props.repository,
          release
        )
        this.setState({
          confirmation: { kind: 'delete-release', release, review },
          editor: null,
          upload: null,
          error: null,
        })
      } catch (error) {
        this.setState({ error: errorMessage(error) })
      }
    }
  }

  private confirmDeleteAsset = (asset: IGitHubReleaseAsset) => {
    const release = this.selectedRelease()
    if (release !== null) {
      try {
        const review = this.props.releasesStore.createMutationReview(
          this.props.repository,
          release,
          asset
        )
        this.setState({
          confirmation: { kind: 'delete-asset', release, asset, review },
          editor: null,
          upload: null,
          error: null,
        })
      } catch (error) {
        this.setState({ error: errorMessage(error) })
      }
    }
  }

  private dismissConfirmation = () =>
    this.setState({ confirmation: null, error: null })

  private executeConfirmation = async () => {
    const confirmation = this.state.confirmation
    if (confirmation === null) {
      return
    }
    const operationName: BusyOperation =
      confirmation.kind === 'publish'
        ? 'publish'
        : confirmation.kind === 'delete-release'
        ? 'delete'
        : confirmation.kind === 'delete-asset'
        ? 'delete-asset'
        : confirmation.kind
    const operation = this.startOperation(operationName)
    if (operation === null) {
      return
    }
    const completedIds = new Set<number>()
    try {
      if (confirmation.kind === 'publish') {
        await this.props.releasesStore.publish(
          this.props.repository,
          confirmation.review,
          operation.controller.signal
        )
      } else if (confirmation.kind === 'delete-release') {
        await this.props.releasesStore.delete(
          this.props.repository,
          confirmation.review,
          operation.controller.signal
        )
      } else if (confirmation.kind === 'delete-asset') {
        await this.props.releasesStore.deleteAsset(
          this.props.repository,
          confirmation.review,
          operation.controller.signal
        )
      } else {
        for (let index = 0; index < confirmation.reviews.length; index++) {
          const review = confirmation.reviews[index]
          const release = confirmation.releases[index]
          if (review === undefined || release === undefined) {
            throw new Error(
              'The reviewed release selection changed. Review the bulk action again.'
            )
          }
          if (confirmation.kind === 'bulk-publish') {
            await this.props.releasesStore.publish(
              this.props.repository,
              review,
              operation.controller.signal
            )
          } else {
            await this.props.releasesStore.delete(
              this.props.repository,
              review,
              operation.controller.signal
            )
          }
          completedIds.add(release.id)
        }
      }
      if (!this.isCurrent(operation.generation, operation.controller)) {
        return
      }
      const message =
        confirmation.kind === 'publish'
          ? `Published ${confirmation.release.tagName}.`
          : confirmation.kind === 'delete-release'
          ? `Deleted release ${confirmation.release.tagName}. The Git tag was not deleted.`
          : confirmation.kind === 'delete-asset'
          ? `Deleted asset ${confirmation.asset.name}.`
          : confirmation.kind === 'bulk-publish'
          ? `Published ${confirmation.releases.length} selected release ${
              confirmation.releases.length === 1 ? 'draft' : 'drafts'
            }.`
          : `Deleted ${confirmation.releases.length} selected ${
              confirmation.releases.length === 1 ? 'release' : 'releases'
            }. Git tags were not deleted.`
      this.finishOperation(operation.controller)
      this.setState(
        {
          busy: null,
          confirmation: null,
          selectedReleaseIds:
            completedIds.size === 0
              ? this.state.selectedReleaseIds
              : new Set(
                  [...this.state.selectedReleaseIds].filter(
                    id => !completedIds.has(id)
                  )
                ),
        },
        () => void this.loadReleases(true, message)
      )
    } catch (error) {
      if (this.isCurrent(operation.generation, operation.controller)) {
        const canceled = (error as Error)?.name === 'AbortError'
        const batch =
          confirmation.kind === 'bulk-publish' ||
          confirmation.kind === 'bulk-delete'
        const selectedReleaseIds = new Set(
          [...this.state.selectedReleaseIds].filter(id => !completedIds.has(id))
        )
        this.finishOperation(operation.controller)
        this.setState(
          {
            busy: null,
            confirmation: batch ? null : confirmation,
            selectedReleaseIds,
            error:
              canceled || completedIds.size > 0 ? null : errorMessage(error),
            message:
              completedIds.size > 0
                ? `${completedIds.size} selected ${
                    completedIds.size === 1 ? 'release was' : 'releases were'
                  } changed before the bulk operation stopped. ${errorMessage(
                    error
                  )}`
                : canceled
                ? 'Release operation canceled.'
                : null,
          },
          () => {
            if (completedIds.size > 0) {
              void this.loadReleases(true, this.state.message ?? undefined)
            }
          }
        )
      }
    } finally {
      this.finishOperation(operation.controller)
    }
  }

  private chooseUpload = async () => {
    if (this.state.busy !== null || this.selectedRelease() === null) {
      return
    }
    try {
      const sourcePath = this.props.chooseUploadFile
        ? await this.props.chooseUploadFile()
        : await showOpenDialog({
            title: 'Choose a release asset to upload',
            properties: ['openFile'],
          })
      if (sourcePath === null || !this.mounted) {
        return
      }
      const name = normalizeGitHubReleaseAssetName(Path.basename(sourcePath))
      this.setState({
        upload: {
          sourcePath,
          name,
          label: '',
          reviewing: false,
          review: null,
        },
        editor: null,
        confirmation: null,
        error: null,
        message: null,
      })
    } catch (error) {
      this.setState({ error: errorMessage(error) })
    }
  }

  private onUploadText = (event: React.FormEvent<HTMLInputElement>) => {
    const upload = this.state.upload
    if (upload !== null && !upload.reviewing) {
      const element = event.currentTarget
      this.setState({
        upload: { ...upload, [element.name]: element.value },
        error: null,
      })
    }
  }

  private reviewUpload = () => {
    const upload = this.state.upload
    if (upload === null) {
      return
    }
    try {
      const name = normalizeGitHubReleaseAssetName(upload.name)
      const label = normalizeGitHubReleaseAssetLabel(upload.label)
      const release = this.selectedRelease()
      if (release === null) {
        throw new Error('Select the release again before reviewing the upload.')
      }
      const review = this.props.releasesStore.createMutationReview(
        this.props.repository,
        release
      )
      this.setState({
        upload: {
          ...upload,
          name,
          label: label ?? '',
          reviewing: true,
          review,
        },
      })
    } catch (error) {
      this.setState({ error: errorMessage(error) })
    }
  }

  private reviseUpload = () => {
    const upload = this.state.upload
    if (upload !== null && this.state.busy === null) {
      this.setState({ upload: { ...upload, reviewing: false, review: null } })
    }
  }

  private closeUpload = () => {
    if (this.state.busy === null) {
      this.setState({ upload: null })
    }
  }

  private submitUpload = async () => {
    const upload = this.state.upload
    const release = this.selectedRelease()
    if (
      upload === null ||
      !upload.reviewing ||
      upload.review === null ||
      release === null
    ) {
      return
    }
    const operation = this.startOperation('upload')
    if (operation === null) {
      return
    }
    this.lastProgressAt = 0
    try {
      const result = await this.props.releasesStore.uploadAsset(
        this.props.repository,
        upload.review,
        upload.sourcePath,
        upload.name,
        normalizeGitHubReleaseAssetLabel(upload.label),
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
      const message = `Uploaded ${result.asset.name}. Local SHA-256: ${result.localDigest}`
      this.finishOperation(operation.controller)
      this.setState(
        {
          busy: null,
          progress: null,
          upload: null,
        },
        () => void this.loadReleases(true, message)
      )
    } catch (error) {
      if (this.isCurrent(operation.generation, operation.controller)) {
        const canceled = (error as Error)?.name === 'AbortError'
        this.setState({
          busy: null,
          progress: null,
          error: canceled ? null : errorMessage(error),
          message: canceled ? 'Release asset upload canceled.' : null,
        })
      }
    } finally {
      this.finishOperation(operation.controller)
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

  private downloadAsset = async (asset: IGitHubReleaseAsset) => {
    const release = this.selectedRelease()
    if (release === null || this.state.busy !== null) {
      return
    }
    try {
      const destination = this.props.chooseDownloadDestination
        ? await this.props.chooseDownloadDestination(asset)
        : await showSaveDialog({
            title: `Download ${asset.name}`,
            defaultPath: asset.name,
          })
      if (destination === null || !this.mounted) {
        return
      }
      const operation = this.startOperation('download')
      if (operation === null) {
        return
      }
      this.lastProgressAt = 0
      try {
        const result = await this.props.releasesStore.downloadAsset(
          this.props.repository,
          release.id,
          asset,
          destination,
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
        const message =
          result.matchesGitHubDigest === true
            ? `Downloaded ${asset.name}; the local SHA-256 matches GitHub’s digest.`
            : `Downloaded ${asset.name}; GitHub did not provide a digest, so the app recorded a local SHA-256.`
        this.finishOperation(operation.controller)
        this.setState(
          {
            busy: null,
            progress: null,
            completedDownload: {
              path: result.path,
              assetName: asset.name,
              localDigest: result.localDigest,
              matchesGitHubDigest: result.matchesGitHubDigest,
            },
          },
          () => void this.loadReleases(true, message)
        )
      } catch (error) {
        if (this.isCurrent(operation.generation, operation.controller)) {
          const canceled = (error as Error)?.name === 'AbortError'
          this.setState({
            busy: null,
            progress: null,
            error: canceled ? null : errorMessage(error),
            message: canceled
              ? 'Release asset download canceled; the partial file was removed.'
              : null,
          })
        }
      } finally {
        this.finishOperation(operation.controller)
      }
    } catch (error) {
      if (this.mounted) {
        this.setState({ error: errorMessage(error) })
      }
    }
  }

  private assetForButton(
    event: React.MouseEvent<HTMLButtonElement>,
    prefix: string
  ): IGitHubReleaseAsset | null {
    const buttonId = event.currentTarget.id
    if (!buttonId.startsWith(prefix)) {
      return null
    }
    const idText = buttonId.slice(prefix.length)
    if (!/^\d+$/.test(idText)) {
      return null
    }
    const assetId = Number(idText)
    return this.state.assets.find(asset => asset.id === assetId) ?? null
  }

  private downloadAssetFromButton = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const asset = this.assetForButton(event, 'download-release-asset-')
    if (asset !== null) {
      void this.downloadAsset(asset)
    }
  }

  private deleteAssetFromButton = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const asset = this.assetForButton(event, 'delete-release-asset-')
    if (asset !== null) {
      this.confirmDeleteAsset(asset)
    }
  }

  private loadMoreAssets = () => {
    const release = this.selectedRelease()
    if (release !== null) {
      void this.loadAssets(release.id, false)
    }
  }

  private cancelOperation = () => {
    this.operationController?.abort()
    this.setState({ message: 'Canceling the current Releases operation…' })
  }

  private revealDownload = async () => {
    const completed = this.state.completedDownload
    if (completed === null) {
      return
    }
    try {
      await (this.props.revealDownload ?? showItemInFolder)(completed.path)
    } catch {
      this.setState({
        error: 'The downloaded release asset could not be shown in its folder.',
      })
    }
  }

  private openDownload = async () => {
    const completed = this.state.completedDownload
    if (completed === null) {
      return
    }
    const generation = this.generation
    const request = ++this.openDownloadRequest
    const path = completed.path
    this.setState({ error: null })
    try {
      const result = await (this.props.openDownload ?? shell.openPath)(path)
      if (
        !this.mounted ||
        generation !== this.generation ||
        request !== this.openDownloadRequest ||
        this.state.completedDownload?.path !== path
      ) {
        return
      }
      if (typeof result === 'string' && result.trim().length > 0) {
        throw new Error(result)
      }
    } catch (error) {
      if (
        !this.mounted ||
        generation !== this.generation ||
        request !== this.openDownloadRequest ||
        this.state.completedDownload?.path !== path
      ) {
        return
      }
      const detail = errorMessage(error)
      this.setState({
        error: t('githubReleases.openFileError', { detail }),
      })
    }
  }

  private renderAvailability() {
    const account = getGitHubReleasesAccount(
      this.props.repository,
      this.props.accounts
    )
    if (this.state.availability === 'signed-out') {
      return (
        <section className="github-releases-empty" role="status">
          <h2>Sign in to manage Releases</h2>
          <p>
            Sign in with the account selected for this repository, then return
            to Releases. No other signed-in account will be used implicitly.
          </p>
        </section>
      )
    }
    if (this.state.availability === 'unsupported') {
      return (
        <section className="github-releases-empty" role="status">
          <h2>Releases are unavailable</h2>
          <p>
            This GitHub Enterprise Server version does not expose the Releases
            API supported by Desktop Material.
          </p>
        </section>
      )
    }
    if (this.state.availability === 'not-github') {
      return (
        <section className="github-releases-empty" role="status">
          <h2>GitHub repository required</h2>
          <p>
            Releases are available for GitHub and GitHub Enterprise
            repositories.
          </p>
        </section>
      )
    }
    return (
      <span className="github-releases-account">
        {account === null
          ? 'Selected GitHub account'
          : `${account.login} · ${account.friendlyEndpoint}`}
      </span>
    )
  }

  private renderOverview() {
    const counts = { published: 0, prerelease: 0, draft: 0 }
    let assetCount = 0
    let downloadCount = 0
    for (const release of this.state.releases) {
      counts[releaseStatus(release)]++
      assetCount += release.assets.length
      downloadCount += release.assets.reduce(
        (sum, asset) => sum + asset.downloadCount,
        0
      )
    }
    const latestStable = this.latestStableRelease()

    return (
      <section
        className="github-releases-overview"
        aria-label="Loaded release summary"
      >
        <article className="github-release-metric">
          <span>Loaded releases</span>
          <strong>{this.state.releases.length}</strong>
          <small>
            {assetCount} {assetCount === 1 ? 'asset' : 'assets'} ·{' '}
            {downloadCount} downloads
          </small>
        </article>
        <article className="github-release-metric published">
          <span>Published</span>
          <strong>{counts.published}</strong>
          <small>Stable releases</small>
        </article>
        <article className="github-release-metric prerelease">
          <span>Pre-releases</span>
          <strong>{counts.prerelease}</strong>
          <small>Published previews</small>
        </article>
        <article className="github-release-metric draft">
          <span>Drafts</span>
          <strong>{counts.draft}</strong>
          <small>Not yet published</small>
        </article>
        <article className="github-release-metric latest">
          <span>Latest stable</span>
          <strong>
            {latestStable === null ? 'None loaded' : latestStable.tagName}
          </strong>
          <small>
            {latestStable === null ? (
              'No stable release is in the loaded results.'
            ) : (
              <>
                <ReleaseTimestamp
                  date={latestStable.publishedAt ?? latestStable.createdAt}
                />{' '}
                · newest stable in loaded results
              </>
            )}
          </small>
        </article>
      </section>
    )
  }

  private renderReleaseList() {
    const { releases: visibleReleases, regexError } = this.getVisibleReleases()
    const visibleSelectedCount = visibleReleases.filter(release =>
      this.state.selectedReleaseIds.has(release.id)
    ).length
    const allVisibleSelected =
      visibleReleases.length > 0 &&
      visibleSelectedCount === visibleReleases.length
    const selectedReleases = this.selectedReleases()
    const selectedDraftCount = selectedReleases.filter(
      release => release.draft
    ).length
    const latestStableId = this.latestStableRelease()?.id ?? null
    const hasFilters =
      this.state.search.trim().length > 0 || this.state.statusFilter !== 'all'
    const initiallyLoading =
      this.state.releases.length === 0 &&
      this.state.releasePage === 0 &&
      this.state.busy === 'releases'

    return (
      <section
        className="github-releases-list-panel"
        aria-labelledby="github-releases-list-title"
      >
        <div className="github-releases-panel-heading">
          <div>
            <h2 id="github-releases-list-title">Repository releases</h2>
            <span>
              {visibleReleases.length} of {this.state.releases.length} shown
            </span>
          </div>
          <Button disabled={this.state.busy !== null} onClick={this.openCreate}>
            New release
          </Button>
        </div>
        {this.state.releases.length > 0 && (
          <div className="github-releases-filter-area">
            <div className="github-releases-filter-toolbar">
              <div className="github-releases-search">
                <label htmlFor="github-releases-search">
                  Search loaded releases
                </label>
                <div className="github-releases-search-field">
                  <input
                    ref={this.releaseSearchRef}
                    data-search-surface-id="github-releases-search"
                    id="github-releases-search"
                    type="search"
                    value={this.state.search}
                    maxLength={256}
                    placeholder="Name, tag, notes, author, or asset"
                    onChange={this.updateSearch}
                  />
                  <FilterModeControl
                    searchSurfaceId="github-releases-search"
                    mode={this.state.searchMode}
                    caseSensitive={this.state.searchCaseSensitive}
                    onModeChange={this.onSearchModeChange}
                    onCaseSensitiveChange={this.onSearchCaseSensitiveChange}
                    regexBuilderTarget="Releases"
                    getSampleItems={this.getSearchSampleItems}
                    filterText={this.state.search}
                    onRegexPatternApply={this.onSearchPatternApply}
                  />
                </div>
              </div>
              <label className="github-releases-status-filter">
                Status
                <select
                  aria-label="Release status"
                  value={this.state.statusFilter}
                  onChange={this.updateStatusFilter}
                >
                  <option value="all">All statuses</option>
                  <option value="published">Published</option>
                  <option value="prerelease">Pre-releases</option>
                  <option value="draft">Drafts</option>
                </select>
              </label>
            </div>
            {hasFilters && (
              <div className="github-releases-filter-summary">
                <span>
                  {t('githubReleases.filterSummary', {
                    visible: visibleReleases.length.toString(),
                    total: this.state.releases.length.toString(),
                  })}
                </span>
                <Button onClick={this.clearReleaseFilters}>
                  Clear filters
                </Button>
              </div>
            )}
            {regexError !== null && (
              <p className="github-releases-filter-error" role="alert">
                Invalid release search pattern: {regexError}
              </p>
            )}
          </div>
        )}
        {this.state.releases.length > 0 && (
          <div
            className="github-releases-bulk-toolbar"
            role="group"
            aria-label="Bulk release actions"
          >
            <div className="github-releases-bulk-selection">
              <label>
                <input
                  ref={this.selectAllVisibleRef}
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={
                    visibleReleases.length === 0 || this.state.busy !== null
                  }
                  onChange={this.toggleAllVisibleReleases}
                  aria-label="Select all visible releases"
                />
                Select all visible
              </label>
              <span
                className={
                  selectedReleases.length === 0 ? 'sr-only' : undefined
                }
                aria-live="polite"
              >
                {selectedReleases.length} selected
              </span>
            </div>
            {selectedReleases.length > 0 && (
              <div className="github-releases-bulk-actions">
                <Button
                  disabled={
                    selectedDraftCount === 0 || this.state.busy !== null
                  }
                  onClick={this.confirmBulkPublish}
                >
                  Publish drafts ({selectedDraftCount})
                </Button>
                <Button
                  disabled={this.state.busy !== null}
                  onClick={this.confirmBulkDelete}
                >
                  Delete selected ({selectedReleases.length})
                </Button>
                <Button
                  disabled={this.state.busy !== null}
                  onClick={this.clearReleaseSelection}
                >
                  Clear selection
                </Button>
              </div>
            )}
          </div>
        )}
        {initiallyLoading ? (
          <div className="github-releases-loading" role="status">
            <span
              className="github-releases-loading-indicator"
              aria-hidden={true}
            />
            <div>
              <strong>Loading releases…</strong>
              <span>Fetching release metadata from the selected provider.</span>
            </div>
          </div>
        ) : this.state.releases.length === 0 ? (
          <div className="github-releases-list-empty" role="status">
            <strong>
              {this.state.failedOperation === 'releases'
                ? 'Releases could not be loaded'
                : 'No releases yet'}
            </strong>
            <span>
              {this.state.failedOperation === 'releases'
                ? 'Retry the provider request from the error message above.'
                : 'Create a public release or save an unpublished draft to start.'}
            </span>
          </div>
        ) : visibleReleases.length === 0 ? (
          <div className="github-releases-list-empty" role="status">
            <strong>No loaded releases match</strong>
            <span>Adjust the search or status filter to see a release.</span>
            <Button onClick={this.clearReleaseFilters}>Clear filters</Button>
          </div>
        ) : (
          <div className="github-releases-list">
            {visibleReleases.map(release => {
              const selected = release.id === this.state.selectedReleaseId
              const status = releaseStatus(release)
              const date = release.publishedAt ?? release.createdAt
              return (
                <div className="github-release-row-shell" key={release.id}>
                  <label className="github-release-row-checkbox">
                    <input
                      type="checkbox"
                      value={release.id}
                      checked={this.state.selectedReleaseIds.has(release.id)}
                      disabled={this.state.busy !== null}
                      onChange={this.toggleReleaseSelection}
                      aria-label={`Select release ${release.tagName}`}
                    />
                  </label>
                  <button
                    type="button"
                    value={release.id}
                    className={`github-release-row status-${status}${
                      selected ? ' selected' : ''
                    }`}
                    aria-current={selected ? 'true' : undefined}
                    disabled={this.state.busy !== null}
                    onClick={this.selectReleaseFromButton}
                  >
                    <span className="github-release-row-title">
                      {release.name || release.tagName}
                    </span>
                    <span className="github-release-row-badges">
                      {release.id === latestStableId && (
                        <span className="github-release-latest-badge">
                          Latest stable
                        </span>
                      )}
                      <span className="github-release-row-state">
                        {releaseStatusLabel(release)}
                      </span>
                    </span>
                    <span className="github-release-row-tag">
                      {release.tagName}
                    </span>
                    <span className="github-release-row-date">
                      {release.draft ? 'Created' : 'Published'}{' '}
                      <ReleaseTimestamp date={date} />
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <div className="github-releases-pagination">
          <Button
            disabled={
              this.state.busy !== null || this.state.nextReleasePage === null
            }
            onClick={this.loadMoreReleases}
          >
            Load more releases
          </Button>
          <span>
            {this.state.releasesCapped
              ? 'Safety limit reached. Refresh to begin again.'
              : `Page ${Math.max(1, this.state.releasePage)}`}
          </span>
        </div>
      </section>
    )
  }

  private renderEditor() {
    const editor = this.state.editor
    if (editor === null) {
      return null
    }
    return (
      <section
        className="github-release-editor"
        aria-labelledby="github-release-editor-title"
      >
        <h2 id="github-release-editor-title">
          {editor.mode === 'create' ? 'Create release' : 'Edit release'}
        </h2>
        {editor.reviewing ? (
          <div
            className="github-release-review"
            role="region"
            aria-label="Release review"
          >
            <p>
              Review the exact metadata and publication state that will be sent
              to GitHub.
            </p>
            <dl>
              <dt>Tag</dt>
              <dd>{editor.tagName}</dd>
              <dt>Target</dt>
              <dd>{editor.targetCommitish}</dd>
              <dt>Name</dt>
              <dd>{editor.name || 'No display name'}</dd>
              <dt>Release type</dt>
              <dd>{editor.prerelease ? 'Pre-release' : 'Standard release'}</dd>
              {editor.mode === 'create' && (
                <>
                  <dt>Publication</dt>
                  <dd>
                    {editor.publishImmediately
                      ? 'Publish immediately'
                      : 'Save as unpublished draft'}
                  </dd>
                </>
              )}
              <dt>Notes</dt>
              <dd className="github-release-review-notes">
                {editor.body || 'No release notes'}
              </dd>
            </dl>
            <div className="github-releases-controls">
              <Button
                disabled={this.state.busy !== null}
                onClick={this.submitEditor}
              >
                {editor.mode === 'create'
                  ? editor.publishImmediately
                    ? 'Publish release'
                    : 'Create draft'
                  : 'Save changes'}
              </Button>
              <Button
                disabled={this.state.busy !== null}
                onClick={this.reviseEditor}
              >
                Revise
              </Button>
              <Button
                disabled={this.state.busy !== null}
                onClick={this.closeEditor}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={this.preventSubmit}>
            <div className="github-release-editor-grid">
              <label>
                <span>Tag</span>
                <input
                  name="tagName"
                  value={editor.tagName}
                  maxLength={255}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={this.onEditorText}
                />
              </label>
              <label>
                <span>Target branch or commit</span>
                <input
                  name="targetCommitish"
                  value={editor.targetCommitish}
                  maxLength={1024}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={this.onEditorText}
                />
              </label>
            </div>
            <label>
              <span>Release name</span>
              <input
                name="name"
                value={editor.name}
                maxLength={1024}
                onChange={this.onEditorText}
              />
            </label>
            <label>
              <span>Release notes</span>
              <textarea
                name="body"
                value={editor.body}
                maxLength={125000}
                rows={8}
                onChange={this.onEditorText}
              />
            </label>
            <label className="github-release-checkbox">
              <input
                type="checkbox"
                checked={editor.prerelease}
                onChange={this.onEditorPrerelease}
              />
              <span>Mark as a pre-release</span>
            </label>
            {editor.mode === 'create' && (
              <label className="github-release-checkbox">
                <input
                  type="checkbox"
                  checked={editor.publishImmediately}
                  onChange={this.onEditorPublishImmediately}
                />
                <span>Publish immediately</span>
              </label>
            )}
            <div className="github-releases-controls">
              <Button onClick={this.reviewEditor}>Review changes</Button>
              <Button onClick={this.closeEditor}>Cancel</Button>
            </div>
          </form>
        )}
      </section>
    )
  }

  private renderConfirmation() {
    const confirmation = this.state.confirmation
    if (confirmation === null) {
      return null
    }
    const isBulk =
      confirmation.kind === 'bulk-publish' ||
      confirmation.kind === 'bulk-delete'
    const isPublish =
      confirmation.kind === 'publish' || confirmation.kind === 'bulk-publish'
    const isAsset = confirmation.kind === 'delete-asset'
    const title = isBulk
      ? `${isPublish ? 'Publish' : 'Delete'} ${
          confirmation.releases.length
        } selected ${
          confirmation.releases.length === 1 ? 'release' : 'releases'
        }?`
      : confirmation.kind === 'publish'
      ? `Publish ${confirmation.release.tagName}?`
      : isAsset
      ? `Delete ${confirmation.asset.name}?`
      : confirmation.kind === 'delete-release'
      ? `Delete release ${confirmation.release.tagName}?`
      : 'Review selected releases?'
    return (
      <section
        className={`github-release-confirmation${
          isPublish ? '' : ' destructive'
        }`}
        role="alertdialog"
        aria-labelledby="github-release-confirmation-title"
        aria-describedby="github-release-confirmation-description"
      >
        <h2 id="github-release-confirmation-title">{title}</h2>
        <p id="github-release-confirmation-description">
          {confirmation.kind === 'bulk-publish'
            ? 'Each exact reviewed draft will be revalidated immediately before it is published. Processing stops on the first stale or failed item.'
            : confirmation.kind === 'bulk-delete'
            ? 'Each exact reviewed release will be revalidated immediately before permanent deletion. Git tags are not deleted. Processing stops on the first stale or failed item.'
            : isPublish
            ? 'This makes the reviewed draft visible to repository readers. Its tag, target, notes, pre-release state, and assets will be published as currently shown.'
            : isAsset
            ? 'This permanently removes the selected asset from this release. Local files are not changed.'
            : 'This permanently removes the GitHub release and its uploaded assets. The Git tag is not deleted.'}
        </p>
        {isBulk && (
          <ul className="github-release-bulk-review-list">
            {confirmation.releases.map(release => (
              <li key={release.id}>
                <strong>{release.name || release.tagName}</strong>{' '}
                <code>{release.tagName}</code> · {releaseStatusLabel(release)}
              </li>
            ))}
          </ul>
        )}
        <div className="github-releases-controls">
          <Button
            className={isPublish ? undefined : 'destructive'}
            disabled={this.state.busy !== null}
            onClick={this.executeConfirmation}
          >
            {isPublish
              ? isBulk
                ? 'Publish reviewed drafts'
                : 'Publish reviewed release'
              : isBulk
              ? 'Delete reviewed releases'
              : 'Delete permanently'}
          </Button>
          <Button
            disabled={this.state.busy !== null}
            onClick={this.dismissConfirmation}
          >
            Go back
          </Button>
        </div>
      </section>
    )
  }

  private renderUpload() {
    const upload = this.state.upload
    if (upload === null) {
      return null
    }
    return (
      <section
        className="github-release-upload"
        aria-labelledby="release-upload-title"
      >
        <h3 id="release-upload-title">Upload release asset</h3>
        {upload.reviewing ? (
          <div className="github-release-review">
            <p>Review the exact local file and remote asset metadata.</p>
            <dl>
              <dt>Local file</dt>
              <dd className="path">{Path.basename(upload.sourcePath)}</dd>
              <dt>Asset name</dt>
              <dd>{upload.name}</dd>
              <dt>Label</dt>
              <dd>{upload.label || 'No label'}</dd>
            </dl>
            <div className="github-releases-controls">
              <Button
                disabled={this.state.busy !== null}
                onClick={this.submitUpload}
              >
                Upload asset
              </Button>
              <Button
                disabled={this.state.busy !== null}
                onClick={this.reviseUpload}
              >
                Revise
              </Button>
              <Button
                disabled={this.state.busy !== null}
                onClick={this.closeUpload}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={this.preventSubmit}>
            <p className="github-release-upload-path">
              {Path.basename(upload.sourcePath)} selected locally.
            </p>
            <label>
              <span>Asset name</span>
              <input
                name="name"
                value={upload.name}
                maxLength={255}
                onChange={this.onUploadText}
              />
            </label>
            <label>
              <span>Optional label</span>
              <input
                name="label"
                value={upload.label}
                maxLength={255}
                onChange={this.onUploadText}
              />
            </label>
            <p>Uploads are limited to 2 GiB and sent only to this provider.</p>
            <div className="github-releases-controls">
              <Button onClick={this.reviewUpload}>Review upload</Button>
              <Button onClick={this.closeUpload}>Cancel</Button>
            </div>
          </form>
        )}
      </section>
    )
  }

  private renderAssets(release: IGitHubRelease) {
    return (
      <section
        className="github-release-assets"
        aria-labelledby="release-assets-title"
      >
        <div className="github-releases-panel-heading">
          <div>
            <h3 id="release-assets-title">Assets</h3>
            <span>{this.state.assets.length} loaded</span>
          </div>
          <Button
            disabled={this.state.busy !== null}
            onClick={this.chooseUpload}
          >
            Upload asset
          </Button>
        </div>
        {this.renderUpload()}
        {this.state.assets.length === 0 && this.state.busy === 'assets' ? (
          <div className="github-releases-loading compact" role="status">
            <span
              className="github-releases-loading-indicator"
              aria-hidden={true}
            />
            <div>
              <strong>Loading assets…</strong>
              <span>Fetching files and download metadata.</span>
            </div>
          </div>
        ) : this.state.assets.length === 0 ? (
          <p className="github-releases-empty-copy">No assets are attached.</p>
        ) : (
          <div className="github-release-asset-list">
            {this.state.assets.map(asset => (
              <article className="github-release-asset" key={asset.id}>
                <div className="github-release-asset-heading">
                  <div>
                    <h4>{asset.name}</h4>
                    <span>{asset.label || 'Release asset'}</span>
                  </div>
                  <span className="github-release-asset-state">
                    {asset.state === 'uploaded' ? 'Uploaded' : 'Processing'}
                  </span>
                </div>
                <dl>
                  <dt>File size</dt>
                  <dd>{formatBytes(asset.sizeInBytes)}</dd>
                  <dt>Content type</dt>
                  <dd>{asset.contentType || 'Not supplied'}</dd>
                  <dt>Downloads</dt>
                  <dd>{asset.downloadCount}</dd>
                  <dt>Uploaded</dt>
                  <dd>
                    <ReleaseTimestamp date={asset.createdAt} />
                  </dd>
                  <dt>Updated</dt>
                  <dd>
                    <ReleaseTimestamp date={asset.updatedAt} />
                  </dd>
                  <dt>Digest</dt>
                  <dd className="digest">
                    {asset.digest ?? 'Not supplied by GitHub'}
                  </dd>
                </dl>
                <div className="github-releases-controls">
                  <Button
                    id={`download-release-asset-${asset.id}`}
                    disabled={
                      this.state.busy !== null || asset.state !== 'uploaded'
                    }
                    onClick={this.downloadAssetFromButton}
                  >
                    Download
                  </Button>
                  <Button
                    id={`delete-release-asset-${asset.id}`}
                    className="destructive"
                    disabled={this.state.busy !== null}
                    onClick={this.deleteAssetFromButton}
                  >
                    Delete
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
        <div className="github-releases-pagination">
          <Button
            disabled={
              this.state.busy !== null || this.state.nextAssetPage === null
            }
            onClick={this.loadMoreAssets}
          >
            Load more assets
          </Button>
          <span>
            {this.state.assetsCapped
              ? 'Safety limit reached. Refresh assets to begin again.'
              : `Page ${Math.max(1, this.state.assetPage)}`}
          </span>
        </div>
      </section>
    )
  }

  private renderDetail() {
    if (this.state.editor !== null) {
      return this.renderEditor()
    }
    if (this.state.confirmation !== null) {
      return this.renderConfirmation()
    }
    const release = this.selectedRelease()
    if (release === null) {
      return (
        <section
          className="github-release-detail github-releases-empty"
          role="status"
        >
          <h2>Select or create a release</h2>
          <p>Release details and securely managed assets appear here.</p>
        </section>
      )
    }
    const status = releaseStatus(release)
    const latestStable = this.latestStableRelease()?.id === release.id
    const releaseUrl = this.releaseUrl(release)
    const downloadCount = this.state.assets.reduce(
      (sum, asset) => sum + asset.downloadCount,
      0
    )
    return (
      <section
        className="github-release-detail"
        aria-labelledby="release-detail-title"
      >
        <header>
          <div>
            <div className="github-release-state-row">
              <span className={`github-release-state ${status}`}>
                {release.draft
                  ? 'Unpublished draft'
                  : release.prerelease
                  ? 'Published pre-release'
                  : 'Published release'}
              </span>
              {latestStable && (
                <span className="github-release-latest-badge">
                  Latest stable
                </span>
              )}
            </div>
            <h2 id="release-detail-title">{release.name || release.tagName}</h2>
            <p>
              <strong>{release.tagName}</strong> targets{' '}
              <strong>{release.targetCommitish}</strong>
            </p>
          </div>
          <div className="github-releases-controls">
            {releaseUrl !== null && (
              <LinkButton
                uri={releaseUrl}
                className="github-release-provider-link"
                disabled={this.state.busy !== null}
              >
                {release.draft ? 'Open Releases page' : 'Open release page'}
              </LinkButton>
            )}
            <Button disabled={this.state.busy !== null} onClick={this.openEdit}>
              Edit
            </Button>
            {release.draft && (
              <Button
                disabled={this.state.busy !== null}
                onClick={this.confirmPublish}
              >
                Review publish
              </Button>
            )}
            <Button
              className="destructive"
              disabled={this.state.busy !== null}
              onClick={this.confirmDeleteRelease}
            >
              Review delete
            </Button>
          </div>
        </header>
        <dl className="github-release-metadata" aria-label="Release metadata">
          <div>
            <dt>Status</dt>
            <dd>{releaseStatusLabel(release)}</dd>
          </div>
          <div>
            <dt>Author</dt>
            <dd>@{release.authorLogin}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>
              <ReleaseTimestamp date={release.createdAt} />
            </dd>
          </div>
          <div>
            <dt>Published</dt>
            <dd>
              {release.publishedAt === null ? (
                'Not published'
              ) : (
                <ReleaseTimestamp date={release.publishedAt} />
              )}
            </dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>{release.targetCommitish}</dd>
          </div>
          <div>
            <dt>Loaded assets</dt>
            <dd>
              {this.state.assets.length} · {downloadCount} downloads
            </dd>
          </div>
        </dl>
        <div className="github-release-notes">
          <h3>Release notes</h3>
          <p>{release.body || 'No release notes were provided.'}</p>
        </div>
        {this.renderAssets(release)}
      </section>
    )
  }

  private renderOperationStatus() {
    const progress = this.state.progress
    return (
      <div className="github-releases-status" aria-live="polite">
        {this.state.busy !== null && (
          <div className="github-releases-busy" role="status">
            <span>{BusyOperationLabels[this.state.busy]}</span>
            <Button onClick={this.cancelOperation}>Cancel</Button>
          </div>
        )}
        {progress !== null && (
          <div className="github-releases-progress">
            <progress
              max={Math.max(1, progress.totalBytes)}
              value={progress.transferredBytes}
              aria-label={`Release asset ${progress.direction} progress`}
            />
            <span>
              {formatBytes(progress.transferredBytes)} of{' '}
              {formatBytes(progress.totalBytes)}
            </span>
          </div>
        )}
        {this.state.error !== null && (
          <div className="github-releases-error" role="alert">
            <span>{this.state.error}</span>
            {this.state.failedOperation !== null && (
              <Button
                disabled={this.state.busy !== null}
                onClick={this.retryFailedOperation}
              >
                {this.state.failedOperation === 'assets'
                  ? 'Retry assets'
                  : 'Retry releases'}
              </Button>
            )}
          </div>
        )}
        {this.state.message !== null && (
          <p className="github-releases-message" role="status">
            {this.state.message}
          </p>
        )}
        {this.state.completedDownload !== null && (
          <div className="github-release-download-result">
            <div>
              <strong>{this.state.completedDownload.assetName}</strong>
              <code>{this.state.completedDownload.localDigest}</code>
            </div>
            <div className="github-release-download-actions">
              <Button onClick={this.openDownload}>
                {t('githubReleases.openFile')}
              </Button>
              <Button onClick={this.revealDownload}>Show in folder</Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  public render() {
    return (
      <main className="github-releases-view" aria-label="GitHub Releases">
        <header className="github-releases-header">
          <div>
            <h1>Releases</h1>
            <p>
              Review release health, publish approved metadata, and manage
              verified assets.
            </p>
          </div>
          <div className="github-releases-header-actions">
            {this.renderAvailability()}
            <Button
              disabled={
                this.state.busy !== null ||
                this.state.availability !== 'available'
              }
              onClick={this.refreshReleases}
            >
              Refresh
            </Button>
          </div>
        </header>
        {this.renderOperationStatus()}
        {this.state.availability === 'available' && (
          <>
            {this.state.releases.length > 0 && this.renderOverview()}
            <div className="github-releases-layout">
              {this.renderReleaseList()}
              {this.renderDetail()}
            </div>
          </>
        )}
      </main>
    )
  }
}
