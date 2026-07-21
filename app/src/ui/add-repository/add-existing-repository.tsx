import * as React from 'react'
import * as Path from 'path'
import { Dispatcher } from '../dispatcher'
import { addSafeDirectory, getRepositoryType } from '../../lib/git'
import { findRepositoriesInDirectory } from '../../lib/git/find-repositories'
import { Button } from '../lib/button'
import { TextBox } from '../lib/text-box'
import { Row } from '../lib/row'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { LinkButton } from '../lib/link-button'
import { PopupType } from '../../models/popup'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { FoldoutType } from '../../lib/app-state'

import untildify from 'untildify'
import { showOpenDialog } from '../main-process-proxy'
import { Ref } from '../lib/ref'
import { InputError } from '../lib/input-description/input-error'
import { IAccessibleMessage } from '../../models/accessible-message'
import {
  classifyNetworkRepositoryPath,
  NetworkRepositoryPathKind,
  resolveRepositoryInputPath,
} from '../../lib/network-repository-path'
import { matchExistingRepository } from '../../lib/repository-matching'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
  translatedVariable,
  TranslationKey,
  TranslationVariables,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'

interface IAddExistingRepositoryProps {
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void

  /** An optional path to prefill the path text box with.
   * Defaults to the empty string if not defined.
   */
  readonly path?: string

  /**
   * The repositories already tracked by the application. Auto-detected paths
   * that match one of these are excluded from the results so the folder scan
   * never surfaces a repository the user has already added.
   */
  readonly existingRepositories?: ReadonlyArray<{ readonly path: string }>

  /** Optional seams used by focused UI tests. */
  readonly chooseRepositoryFolder?: () => Promise<string | null>
  readonly scanRepositoryFolder?: typeof findRepositoriesInDirectory
}

interface IAddExistingRepositoryState {
  readonly languageMode: LanguageMode
  readonly path: string

  /**
   * Indicates whether or not to render a warning message about the entered path
   * not containing a valid Git repository. This value differs from `isGitRepository` in that it holds
   * its value when the path changes until we've gotten a definitive answer from the asynchronous
   * method that the path is, or isn't, a valid repository path. Separating the two means that
   * we don't toggle visibility of the warning message until it's really necessary, preventing
   * flickering for our users as they type in a path.
   */
  readonly showNonGitRepositoryWarning: boolean
  readonly isRepositoryBare: boolean
  readonly isRepositoryUnsafe: boolean
  readonly repositoryUnsafePath?: string
  readonly isTrustingRepository: boolean
  readonly networkPathKind: NetworkRepositoryPathKind | null
  readonly isCheckingRepository: boolean
  readonly isScanningForRepositories: boolean
  readonly discoveredRepositories: ReadonlyArray<string> | null

  /**
   * How many auto-detected repositories were excluded from
   * `discoveredRepositories` because they are already tracked by the app. Used
   * to distinguish "nothing was found" from "everything found is already added".
   */
  readonly alreadyAddedCount: number
  readonly scanRootPath?: string
  readonly scanWasTruncated: boolean
  readonly repositoryScanError: string | null
}

/** The component for adding an existing local repository. */
export class AddExistingRepository extends React.Component<
  IAddExistingRepositoryProps,
  IAddExistingRepositoryState
> {
  private pathTextBoxRef = React.createRef<TextBox>()
  private scanRequestId = 0

  public constructor(props: IAddExistingRepositoryProps) {
    super(props)

    const path = this.props.path ? this.props.path : ''

    this.state = {
      languageMode: getPersistedLanguageMode(),
      path,
      showNonGitRepositoryWarning: false,
      isRepositoryBare: false,
      isRepositoryUnsafe: false,
      isTrustingRepository: false,
      networkPathKind: null,
      isCheckingRepository: false,
      isScanningForRepositories: false,
      discoveredRepositories: null,
      alreadyAddedCount: 0,
      scanWasTruncated: false,
      repositoryScanError: null,
    }
  }

  public componentDidMount(): void {
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public componentWillUnmount(): void {
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    this.scanRequestId++
  }

  private onLanguageModeChanged = (event: Event) => {
    this.setState({
      languageMode: normalizeLanguageMode(
        (event as CustomEvent<unknown>).detail
      ),
    })
  }

  private localize(
    key: TranslationKey,
    variables?: TranslationVariables
  ): string {
    return translate(key, this.state.languageMode, variables)
  }

  private onTrustDirectory = async () => {
    this.setState({ isTrustingRepository: true })
    const { repositoryUnsafePath, path } = this.state
    if (repositoryUnsafePath) {
      await addSafeDirectory(repositoryUnsafePath)
    }
    await this.validatePath(path)
    this.setState({ isTrustingRepository: false })
  }

  private async updatePath(path: string) {
    this.scanRequestId++
    this.setState({
      path,
      isScanningForRepositories: false,
      discoveredRepositories: null,
      alreadyAddedCount: 0,
      scanRootPath: undefined,
      scanWasTruncated: false,
      repositoryScanError: null,
    })
  }

  private async validatePath(path: string): Promise<boolean> {
    if (path.length === 0) {
      this.setState({
        isRepositoryBare: false,
        showNonGitRepositoryWarning: false,
        networkPathKind: null,
      })
      return false
    }

    this.setState({ isCheckingRepository: true })
    const networkPathKind = await classifyNetworkRepositoryPath(path).catch(
      () => null
    )
    const type = await getRepositoryType(path).catch(() => ({
      kind: 'missing' as const,
    }))

    const isRepository = type.kind !== 'missing' && type.kind !== 'unsafe'
    const isRepositoryUnsafe = type.kind === 'unsafe'
    const isRepositoryBare = type.kind === 'bare'
    const showNonGitRepositoryWarning = !isRepository || isRepositoryBare
    const repositoryUnsafePath = type.kind === 'unsafe' ? type.path : undefined

    if (path === this.state.path) {
      this.setState({
        isRepositoryBare,
        isRepositoryUnsafe,
        showNonGitRepositoryWarning,
        repositoryUnsafePath,
        networkPathKind,
        isCheckingRepository: false,
      })
    } else {
      this.setState({ isCheckingRepository: false })
    }

    return path.length > 0 && isRepository && !isRepositoryBare
  }

  private buildBareRepositoryError() {
    if (
      !this.state.path.length ||
      !this.state.showNonGitRepositoryWarning ||
      !this.state.isRepositoryBare
    ) {
      return null
    }

    const msg =
      'This directory appears to be a bare repository. Bare repositories are not currently supported.'

    return { screenReaderMessage: msg, displayedMessage: msg }
  }

  private buildRepositoryUnsafeError() {
    const { repositoryUnsafePath, path } = this.state
    if (
      !this.state.path.length ||
      !this.state.showNonGitRepositoryWarning ||
      !this.state.isRepositoryUnsafe ||
      repositoryUnsafePath === undefined
    ) {
      return null
    }

    // Git for Windows will replace backslashes with slashes in the error
    // message so we'll do the same to not show "the repo at path c:/repo"
    // when the entered path is `c:\repo`.
    const convertedPath = __WIN32__ ? path.replaceAll('\\', '/') : path

    const displayedMessage = (
      <>
        <p>
          The Git repository
          {repositoryUnsafePath !== convertedPath && (
            <>
              {' at '}
              <Ref>{repositoryUnsafePath}</Ref>
            </>
          )}{' '}
          appears to be owned by another user on your machine. Adding untrusted
          repositories may automatically execute files in the repository.
        </p>
        <p>
          If you trust the owner of the directory you can
          <LinkButton onClick={this.onTrustDirectory}>
            {' '}
            add an exception for this directory
          </LinkButton>{' '}
          in order to continue.
        </p>
      </>
    )

    const screenReaderMessage = `The Git repository appears to be owned by another user on your machine.
      Adding untrusted repositories may automatically execute files in the repository.
      If you trust the owner of the directory you can add an exception for this directory in order to continue.`

    return { screenReaderMessage, displayedMessage }
  }

  private buildNotAGitRepositoryError(): IAccessibleMessage | null {
    if (!this.state.path.length || !this.state.showNonGitRepositoryWarning) {
      return null
    }

    const isNetworkPath = this.state.networkPathKind !== null
    const displayedMessage = (
      <>
        <p>
          {isNetworkPath
            ? this.localize('networkRepository.unavailable')
            : 'This directory does not appear to be a Git repository.'}
        </p>
        {isNetworkPath ? (
          <p>{this.localize('networkRepository.reconnect')}</p>
        ) : null}
        {!isNetworkPath ? (
          <p>
            Would you like to{' '}
            <LinkButton onClick={this.onCreateRepositoryClicked}>
              create a repository
            </LinkButton>{' '}
            here instead?
          </p>
        ) : null}
      </>
    )

    const screenReaderMessage = isNetworkPath
      ? this.localize('networkRepository.unavailableAria')
      : 'This directory does not appear to be a Git repository. Would you like to create a repository here instead?'

    return { screenReaderMessage, displayedMessage }
  }

  private renderErrors() {
    const msg: IAccessibleMessage | null =
      this.buildBareRepositoryError() ??
      this.buildRepositoryUnsafeError() ??
      this.buildNotAGitRepositoryError()

    if (msg === null) {
      return null
    }

    return (
      <Row>
        <InputError
          id="add-existing-repository-path-error"
          ariaLiveMessage={msg.screenReaderMessage}
        >
          {msg.displayedMessage}
        </InputError>
      </Row>
    )
  }

  private renderNetworkNotice() {
    if (
      this.state.networkPathKind === null ||
      this.state.showNonGitRepositoryWarning
    ) {
      return null
    }
    const labelKey: TranslationKey =
      this.state.networkPathKind === 'mapped-drive'
        ? 'networkRepository.mappedDrive'
        : this.state.networkPathKind === 'wsl'
        ? 'networkRepository.wslShare'
        : 'networkRepository.uncShare'
    return (
      <Row>
        <p role="status">
          {this.localize('networkRepository.detected', {
            location: translatedVariable(labelKey),
          })}
        </p>
      </Row>
    )
  }

  private renderRepositoryScanResults() {
    const {
      discoveredRepositories,
      isScanningForRepositories,
      scanRootPath,
      scanWasTruncated,
      repositoryScanError,
    } = this.state

    if (repositoryScanError !== null) {
      return (
        <div className="repository-folder-scan-results" role="alert">
          {repositoryScanError}
        </div>
      )
    }

    if (isScanningForRepositories) {
      return (
        <div className="repository-folder-scan-results" role="status">
          Looking for Git repositories...
        </div>
      )
    }

    if (discoveredRepositories === null) {
      return null
    }

    if (discoveredRepositories.length === 0) {
      if (this.state.alreadyAddedCount > 0) {
        return (
          <div className="repository-folder-scan-results" role="status">
            {this.state.alreadyAddedCount === 1
              ? 'The discovered repository is already added.'
              : 'All discovered repositories are already added.'}
          </div>
        )
      }

      return (
        <div className="repository-folder-scan-results" role="status">
          No Git repositories were found
          {scanWasTruncated
            ? ' in the folders that could be scanned. Some folders could not be read or safe scan limits were reached'
            : ' in this folder'}
          .
        </div>
      )
    }

    const repositoryCount = discoveredRepositories.length

    return (
      <div className="repository-folder-scan-results" role="status">
        <strong>
          Found {repositoryCount} Git{' '}
          {repositoryCount === 1 ? 'repository' : 'repositories'}
        </strong>
        <ul aria-label="Detected Git repositories">
          {discoveredRepositories.map(repositoryPath => {
            const relativePath =
              scanRootPath === undefined
                ? repositoryPath
                : Path.relative(scanRootPath, repositoryPath)

            return (
              <li key={repositoryPath} title={repositoryPath}>
                {relativePath.length > 0
                  ? relativePath
                  : Path.basename(repositoryPath)}
              </li>
            )
          })}
        </ul>
        {scanWasTruncated && (
          <p>
            Some folders could not be read or safe scan limits were reached. Add
            these repositories, then scan a narrower folder to find more.
          </p>
        )}
      </div>
    )
  }

  public render() {
    return (
      <Dialog
        id="add-existing-repository"
        className="add-existing-repository-with-scan"
        title={__DARWIN__ ? 'Add Local Repository' : 'Add local repository'}
        onSubmit={this.addRepository}
        onDismissed={this.props.onDismissed}
        loading={
          this.state.isTrustingRepository ||
          this.state.isCheckingRepository ||
          this.state.isScanningForRepositories
        }
        disabled={this.state.isScanningForRepositories}
      >
        <DialogContent>
          <Row>
            <TextBox
              ref={this.pathTextBoxRef}
              value={this.state.path}
              label={__DARWIN__ ? 'Local Path' : 'Local path'}
              placeholder="repository path"
              onValueChanged={this.onPathChanged}
              ariaDescribedBy="add-existing-repository-path-error"
            />
            <Button onClick={this.showFilePicker}>Choose…</Button>
          </Row>
          <Row className="repository-folder-scan-row">
            <Button onClick={this.showRepositoryFolderPicker}>
              Auto-detect repositories...
            </Button>
            <small>Choose a parent folder to find and add its Git repos.</small>
          </Row>
          {this.renderErrors()}
          {this.renderNetworkNotice()}
          {this.renderRepositoryScanResults()}
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={this.addButtonText}
            okButtonDisabled={
              this.state.isScanningForRepositories ||
              this.state.discoveredRepositories?.length === 0
            }
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onPathChanged = async (path: string) => {
    if (this.state.path !== path) {
      this.updatePath(path)
    }
  }

  private showFilePicker = async () => {
    const path = await showOpenDialog({
      properties: ['createDirectory', 'openDirectory'],
    })

    if (path === null) {
      return
    }

    this.updatePath(path)
  }

  private showRepositoryFolderPicker = async () => {
    const requestId = ++this.scanRequestId
    this.setState({ repositoryScanError: null })

    let path: string | null

    try {
      path = await (this.props.chooseRepositoryFolder?.() ??
        showOpenDialog({ properties: ['openDirectory'] }))
    } catch {
      if (requestId === this.scanRequestId) {
        this.setState({
          isScanningForRepositories: false,
          discoveredRepositories: null,
          alreadyAddedCount: 0,
          scanRootPath: undefined,
          scanWasTruncated: false,
          repositoryScanError:
            "Desktop Material couldn't open the folder picker. Try again.",
        })
      }

      return
    }

    if (requestId !== this.scanRequestId) {
      return
    }

    if (path === null) {
      return
    }

    const resolvedPath = this.resolvedPath(path)
    this.setState({
      path,
      showNonGitRepositoryWarning: false,
      isRepositoryBare: false,
      isRepositoryUnsafe: false,
      repositoryUnsafePath: undefined,
      isScanningForRepositories: true,
      discoveredRepositories: null,
      alreadyAddedCount: 0,
      scanRootPath: resolvedPath,
      scanWasTruncated: false,
      repositoryScanError: null,
    })

    let result

    try {
      result = await (
        this.props.scanRepositoryFolder ?? findRepositoriesInDirectory
      )(resolvedPath)
    } catch {
      if (requestId === this.scanRequestId) {
        this.setState({
          isScanningForRepositories: false,
          discoveredRepositories: null,
          alreadyAddedCount: 0,
          scanWasTruncated: false,
          repositoryScanError:
            "Desktop Material couldn't scan this folder. Check that it can be read and try again.",
        })
      }

      return
    }

    if (requestId !== this.scanRequestId) {
      return
    }

    const { repositories, alreadyAddedCount } =
      this.excludeAlreadyAddedRepositories(result.repositories)

    this.setState({
      isScanningForRepositories: false,
      discoveredRepositories: repositories,
      alreadyAddedCount,
      scanWasTruncated: result.truncated,
      repositoryScanError: null,
    })
  }

  /**
   * Remove auto-detected paths that already correspond to a tracked
   * repository. Comparison is case-insensitive on Windows, matching how the
   * rest of the app identifies a known repository by its path.
   */
  private excludeAlreadyAddedRepositories(paths: ReadonlyArray<string>): {
    readonly repositories: ReadonlyArray<string>
    readonly alreadyAddedCount: number
  } {
    const existingRepositories = this.props.existingRepositories

    if (
      existingRepositories === undefined ||
      existingRepositories.length === 0
    ) {
      return { repositories: paths, alreadyAddedCount: 0 }
    }

    const repositories = paths.filter(
      path => matchExistingRepository(existingRepositories, path) === undefined
    )

    return {
      repositories,
      alreadyAddedCount: paths.length - repositories.length,
    }
  }

  private get addButtonText() {
    const repositoryCount = this.state.discoveredRepositories?.length

    if (repositoryCount !== undefined && repositoryCount > 0) {
      return `Add ${repositoryCount} ${
        repositoryCount === 1 ? 'repository' : 'repositories'
      }`
    }

    return __DARWIN__ ? 'Add Repository' : 'Add repository'
  }

  private resolvedPath(path: string): string {
    return resolveRepositoryInputPath(untildify(path))
  }

  private addRepository = async () => {
    const { discoveredRepositories } = this.state

    if (discoveredRepositories !== null) {
      if (discoveredRepositories.length === 0) {
        return
      }

      return this.addResolvedRepositories(discoveredRepositories)
    }

    const { path } = this.state
    const isValidPath = await this.validatePath(path)

    if (!isValidPath) {
      this.pathTextBoxRef.current?.focus()
      return
    }

    const resolvedPath = this.resolvedPath(path)
    return this.addResolvedRepositories([resolvedPath])
  }

  private addResolvedRepositories = async (paths: ReadonlyArray<string>) => {
    this.props.onDismissed()
    const { dispatcher } = this.props
    const repositories = await dispatcher.addRepositories(paths)

    if (repositories.length > 0) {
      dispatcher.closeFoldout(FoldoutType.Repository)
      dispatcher.selectRepository(repositories[0])
      dispatcher.recordAddExistingRepository()
    }
  }

  private onCreateRepositoryClicked = () => {
    this.props.onDismissed()

    const resolvedPath = this.resolvedPath(this.state.path)

    return this.props.dispatcher.showPopup({
      type: PopupType.CreateRepository,
      path: resolvedPath,
    })
  }
}
