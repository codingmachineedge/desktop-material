import * as Path from 'path'
import * as React from 'react'
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
import { Button } from '../lib/button'
import {
  showItemInFolder,
  showOpenDialog,
  showSaveDialog,
} from '../main-process-proxy'

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

interface IReleaseEditorState extends IGitHubReleaseDraft {
  readonly mode: 'create' | 'edit'
  readonly releaseId: number | null
  readonly reviewing: boolean
  readonly review: IGitHubReleaseMutationReview | null
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
}

interface IGitHubReleasesViewState {
  readonly repositoryKey: string
  readonly availability: GitHubReleasesAvailability
  readonly releases: ReadonlyArray<IGitHubRelease>
  readonly releasePage: number
  readonly nextReleasePage: number | null
  readonly releasesCapped: boolean
  readonly selectedReleaseId: number | null
  readonly assets: ReadonlyArray<IGitHubReleaseAsset>
  readonly assetPage: number
  readonly nextAssetPage: number | null
  readonly assetsCapped: boolean
  readonly busy: BusyOperation | null
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
    assets: [],
    assetPage: 0,
    nextAssetPage: null,
    assetsCapped: false,
    busy: null,
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
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.generation++
    this.operationController?.abort()
    this.operationController = null
  }

  private resetForProps() {
    this.generation++
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
      this.finishOperation(operation.controller)
      this.setState(
        {
          releases,
          releasePage: result.page,
          nextReleasePage: result.nextPage,
          releasesCapped: result.capped,
          selectedReleaseId,
          busy: null,
          error: null,
          message:
            completedMessage ??
            (refresh && releases.length === 0
              ? 'This repository does not have any Releases yet.'
              : null),
        },
        () => {
          if (selectedReleaseId !== null) {
            void this.loadAssets(selectedReleaseId, true, completedMessage)
          }
        }
      )
    } catch (error) {
      if (this.isCurrent(operation.generation, operation.controller)) {
        const canceled = (error as Error)?.name === 'AbortError'
        this.setState({
          busy: null,
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
        error: null,
        message: completedMessage ?? null,
      })
    } catch (error) {
      if (this.isCurrent(operation.generation, operation.controller)) {
        const canceled = (error as Error)?.name === 'AbortError'
        this.setState({
          busy: null,
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
          ? await this.props.releasesStore.createDraft(
              this.props.repository,
              editor,
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
          ? `Created unpublished draft ${release.tagName}.`
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
        : 'delete-asset'
    const operation = this.startOperation(operationName)
    if (operation === null) {
      return
    }
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
      } else {
        await this.props.releasesStore.deleteAsset(
          this.props.repository,
          confirmation.review,
          operation.controller.signal
        )
      }
      if (!this.isCurrent(operation.generation, operation.controller)) {
        return
      }
      const message =
        confirmation.kind === 'publish'
          ? `Published ${confirmation.release.tagName}.`
          : confirmation.kind === 'delete-release'
          ? `Deleted release ${confirmation.release.tagName}. The Git tag was not deleted.`
          : `Deleted asset ${confirmation.asset.name}.`
      this.finishOperation(operation.controller)
      this.setState(
        { busy: null, confirmation: null },
        () => void this.loadReleases(true, message)
      )
    } catch (error) {
      if (this.isCurrent(operation.generation, operation.controller)) {
        const canceled = (error as Error)?.name === 'AbortError'
        this.setState({
          busy: null,
          error: canceled ? null : errorMessage(error),
          message: canceled ? 'Release operation canceled.' : null,
        })
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

  private renderReleaseList() {
    return (
      <section
        className="github-releases-list-panel"
        aria-labelledby="github-releases-list-title"
      >
        <div className="github-releases-panel-heading">
          <div>
            <h2 id="github-releases-list-title">Repository releases</h2>
            <span>{this.state.releases.length} loaded</span>
          </div>
          <Button disabled={this.state.busy !== null} onClick={this.openCreate}>
            New draft
          </Button>
        </div>
        {this.state.releases.length === 0 && this.state.busy !== 'releases' ? (
          <p className="github-releases-empty-copy">
            Create an unpublished draft to start the first release.
          </p>
        ) : (
          <div className="github-releases-list">
            {this.state.releases.map(release => {
              const selected = release.id === this.state.selectedReleaseId
              return (
                <button
                  type="button"
                  value={release.id}
                  className={`github-release-row${selected ? ' selected' : ''}`}
                  aria-current={selected ? 'true' : undefined}
                  disabled={this.state.busy !== null}
                  onClick={this.selectReleaseFromButton}
                  key={release.id}
                >
                  <span className="github-release-row-title">
                    {release.name || release.tagName}
                  </span>
                  <span className="github-release-row-tag">
                    {release.tagName}
                  </span>
                  <span className="github-release-row-state">
                    {release.draft
                      ? 'Draft'
                      : release.prerelease
                      ? 'Pre-release'
                      : 'Published'}
                  </span>
                </button>
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
          {editor.mode === 'create' ? 'Create release draft' : 'Edit release'}
        </h2>
        {editor.reviewing ? (
          <div
            className="github-release-review"
            role="region"
            aria-label="Release review"
          >
            <p>
              Review the exact metadata that will be sent to GitHub. Creating a
              release here always creates an unpublished draft.
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
                {editor.mode === 'create' ? 'Create draft' : 'Save changes'}
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
    const isPublish = confirmation.kind === 'publish'
    const isAsset = confirmation.kind === 'delete-asset'
    const title = isPublish
      ? `Publish ${confirmation.release.tagName}?`
      : isAsset
      ? `Delete ${confirmation.asset.name}?`
      : `Delete release ${confirmation.release.tagName}?`
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
          {isPublish
            ? 'This makes the reviewed draft visible to repository readers. Its tag, target, notes, pre-release state, and assets will be published as currently shown.'
            : isAsset
            ? 'This permanently removes the selected asset from this release. Local files are not changed.'
            : 'This permanently removes the GitHub release and its uploaded assets. The Git tag is not deleted.'}
        </p>
        <div className="github-releases-controls">
          <Button
            className={isPublish ? undefined : 'destructive'}
            disabled={this.state.busy !== null}
            onClick={this.executeConfirmation}
          >
            {isPublish ? 'Publish reviewed release' : 'Delete permanently'}
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
            <p>
              Uploads are limited to 128 MiB and sent only to this provider.
            </p>
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
        {this.state.assets.length === 0 && this.state.busy !== 'assets' ? (
          <p className="github-releases-empty-copy">No assets are attached.</p>
        ) : (
          <div className="github-release-asset-list">
            {this.state.assets.map(asset => (
              <article className="github-release-asset" key={asset.id}>
                <div className="github-release-asset-heading">
                  <div>
                    <h4>{asset.name}</h4>
                    <span>
                      {asset.label || asset.contentType || 'Release asset'}
                    </span>
                  </div>
                  <span>{formatBytes(asset.sizeInBytes)}</span>
                </div>
                <dl>
                  <dt>Downloads</dt>
                  <dd>{asset.downloadCount}</dd>
                  <dt>Digest</dt>
                  <dd className="digest">
                    {asset.digest ?? 'Not supplied by GitHub'}
                  </dd>
                </dl>
                <div className="github-releases-controls">
                  <Button
                    id={`download-release-asset-${asset.id}`}
                    disabled={this.state.busy !== null}
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
    return (
      <section
        className="github-release-detail"
        aria-labelledby="release-detail-title"
      >
        <header>
          <div>
            <span
              className={`github-release-state ${release.draft ? 'draft' : ''}`}
            >
              {release.draft
                ? 'Unpublished draft'
                : release.prerelease
                ? 'Published pre-release'
                : 'Published release'}
            </span>
            <h2 id="release-detail-title">{release.name || release.tagName}</h2>
            <p>
              <strong>{release.tagName}</strong> targets{' '}
              <strong>{release.targetCommitish}</strong>
            </p>
          </div>
          <div className="github-releases-controls">
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
            <span>Working: {this.state.busy.replace('-', ' ')}</span>
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
          <p className="github-releases-error" role="alert">
            {this.state.error}
          </p>
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
            <Button onClick={this.revealDownload}>Show in folder</Button>
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
            <p>Publish reviewed release metadata and manage verified assets.</p>
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
          <div className="github-releases-layout">
            {this.renderReleaseList()}
            {this.renderDetail()}
          </div>
        )}
      </main>
    )
  }
}
