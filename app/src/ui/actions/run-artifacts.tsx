import * as React from 'react'
import { IAPIWorkflowRun } from '../../lib/api'
import {
  ActionsArtifactMaximumDownloadBytes,
  appendActionsArtifactPage,
  getActionsArtifactDefaultFileName,
  IActionsArtifact,
  IActionsArtifactList,
} from '../../lib/actions-artifacts'
import { IActionsArtifactDownloadProgress } from '../../lib/actions-artifact-download'
import {
  ActionsStore,
  getActionsRepositoryKey,
} from '../../lib/stores/actions-store'
import { Repository } from '../../models/repository'
import { Button } from '../lib/button'
import { formatBytes } from '../lib/bytes'
import { showItemInFolder, showSaveDialog } from '../main-process-proxy'

type AttestationCheck =
  | { readonly status: 'loading' }
  | { readonly status: 'found' }
  | { readonly status: 'not-found' }
  | { readonly status: 'error'; readonly message: string }

interface ICompletedArtifactDownload {
  readonly artifactId: number
  readonly path: string
  readonly localDigest: string
  readonly matchesGitHubDigest: boolean | null
}

interface IRunArtifactsProps {
  readonly repository: Repository
  readonly run: IAPIWorkflowRun
  readonly actionsStore: ActionsStore
  readonly chooseDestination?: (
    artifact: IActionsArtifact,
    defaultFileName: string
  ) => Promise<string | null>
  readonly reveal?: (path: string) => Promise<void>
}

interface IRunArtifactsState {
  readonly loading: boolean
  readonly loadingPage: number | null
  readonly list: IActionsArtifactList | null
  readonly error: string | null
  readonly checks: Readonly<Record<number, AttestationCheck>>
  readonly choosingArtifactId: number | null
  readonly downloadingArtifactId: number | null
  readonly progress: IActionsArtifactDownloadProgress | null
  readonly operationMessage: string | null
  readonly operationError: string | null
  readonly completedDownload: ICompletedArtifactDownload | null
}

const initialState = (): IRunArtifactsState => ({
  loading: true,
  loadingPage: 1,
  list: null,
  error: null,
  checks: {},
  choosingArtifactId: null,
  downloadingArtifactId: null,
  progress: null,
  operationMessage: null,
  operationError: null,
  completedDownload: null,
})

function readableBytes(bytes: number): string {
  return bytes === 0 ? '0 B' : formatBytes(bytes, 1)
}

function formatDate(value: Date | null): string {
  return value === null ? 'Not reported' : value.toLocaleString()
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isExpired(artifact: IActionsArtifact): boolean {
  return (
    artifact.expired ||
    (artifact.expiresAt !== null && artifact.expiresAt.valueOf() <= Date.now())
  )
}

export class RunArtifacts extends React.Component<
  IRunArtifactsProps,
  IRunArtifactsState
> {
  private mounted = false
  private loadController: AbortController | null = null
  private readonly attestationControllers = new Map<number, AbortController>()
  private downloadController: AbortController | null = null
  private destinationGeneration = 0
  private lastProgressUpdate = 0

  public constructor(props: IRunArtifactsProps) {
    super(props)
    this.state = initialState()
  }

  public componentDidMount() {
    this.mounted = true
    this.loadArtifacts()
  }

  public componentDidUpdate(prevProps: IRunArtifactsProps) {
    if (
      prevProps.run.id !== this.props.run.id ||
      getActionsRepositoryKey(prevProps.repository) !==
        getActionsRepositoryKey(this.props.repository)
    ) {
      this.cancelOperations()
      this.setState(initialState(), this.loadArtifacts)
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.cancelOperations()
  }

  private cancelOperations() {
    this.destinationGeneration++
    this.loadController?.abort()
    this.loadController = null
    for (const controller of this.attestationControllers.values()) {
      controller.abort()
    }
    this.attestationControllers.clear()
    this.downloadController?.abort()
    this.downloadController = null
  }

  private loadArtifacts = () => this.loadArtifactPage(1)

  private loadMoreArtifacts = () => {
    const page = this.state.list?.nextPage
    if (page !== null && page !== undefined) {
      this.loadArtifactPage(page)
    }
  }

  private loadArtifactPage(page: number) {
    this.loadController?.abort()
    const controller = new AbortController()
    this.loadController = controller
    if (page === 1) {
      this.setState({
        loading: true,
        loadingPage: page,
        list: null,
        error: null,
        checks: {},
        operationMessage: null,
        operationError: null,
        completedDownload: null,
      })
    } else {
      this.setState({
        loading: true,
        loadingPage: page,
        error: null,
        operationMessage: null,
      })
    }
    void this.props.actionsStore
      .fetchArtifacts(
        this.props.repository,
        this.props.run.id,
        page,
        controller.signal
      )
      .then(pageResult => {
        if (this.mounted && this.loadController === controller) {
          this.setState(state => ({
            loading: false,
            loadingPage: null,
            list:
              page === 1 || state.list === null
                ? pageResult
                : appendActionsArtifactPage(state.list, pageResult),
            error: null,
          }))
        }
      })
      .catch(error => {
        if (this.mounted && this.loadController === controller) {
          if ((error as Error)?.name === 'AbortError') {
            this.setState({
              loading: false,
              loadingPage: null,
              operationMessage: 'Artifact loading canceled.',
            })
          } else {
            this.setState({
              loading: false,
              loadingPage: null,
              error: errorMessage(error, 'Unable to load workflow artifacts.'),
            })
          }
        }
      })
      .finally(() => {
        if (this.loadController === controller) {
          this.loadController = null
        }
      })
  }

  private cancelArtifactLoad = () => {
    this.loadController?.abort()
    this.loadController = null
    this.setState({
      loading: false,
      loadingPage: null,
      operationMessage: 'Artifact loading canceled.',
    })
  }

  private checkAttestations = (artifact: IActionsArtifact) => {
    if (artifact.digest === null || this.attestationControllers.size > 0) {
      return
    }
    this.attestationControllers.get(artifact.id)?.abort()
    const controller = new AbortController()
    this.attestationControllers.set(artifact.id, controller)
    this.setState(state => ({
      checks: { ...state.checks, [artifact.id]: { status: 'loading' } },
    }))

    void this.props.actionsStore
      .fetchArtifactAttestationPresence(
        this.props.repository,
        artifact.digest,
        controller.signal
      )
      .then(found => {
        if (
          this.mounted &&
          this.attestationControllers.get(artifact.id) === controller
        ) {
          this.setState(state => ({
            checks: {
              ...state.checks,
              [artifact.id]: { status: found ? 'found' : 'not-found' },
            },
          }))
        }
      })
      .catch(error => {
        if (
          this.mounted &&
          this.attestationControllers.get(artifact.id) === controller &&
          (error as Error)?.name !== 'AbortError'
        ) {
          this.setState(state => ({
            checks: {
              ...state.checks,
              [artifact.id]: {
                status: 'error',
                message: errorMessage(
                  error,
                  'Unable to check artifact attestations.'
                ),
              },
            },
          }))
        }
      })
      .finally(() => {
        if (this.attestationControllers.get(artifact.id) === controller) {
          this.attestationControllers.delete(artifact.id)
        }
      })
  }

  private chooseDestination = async (artifact: IActionsArtifact) => {
    if (
      this.state.choosingArtifactId !== null ||
      this.state.downloadingArtifactId !== null ||
      isExpired(artifact) ||
      artifact.sizeInBytes > ActionsArtifactMaximumDownloadBytes
    ) {
      return
    }

    const generation = ++this.destinationGeneration
    const defaultFileName = getActionsArtifactDefaultFileName(artifact.name)
    this.setState({
      choosingArtifactId: artifact.id,
      operationMessage: null,
      operationError: null,
      completedDownload: null,
    })

    try {
      const destination = this.props.chooseDestination
        ? await this.props.chooseDestination(artifact, defaultFileName)
        : await showSaveDialog({
            title: `Download ${artifact.name}`,
            defaultPath: defaultFileName,
            filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
          })
      if (!this.mounted || generation !== this.destinationGeneration) {
        return
      }
      if (destination === null) {
        this.setState({
          choosingArtifactId: null,
          operationMessage: 'Artifact download canceled before transfer.',
        })
        return
      }
      await this.download(artifact, destination, generation)
    } catch (error) {
      if (this.mounted && generation === this.destinationGeneration) {
        this.setState({
          choosingArtifactId: null,
          downloadingArtifactId: null,
          progress: null,
          operationError: errorMessage(
            error,
            'Unable to choose an artifact destination.'
          ),
        })
      }
    }
  }

  private artifactFromButton(
    event: React.MouseEvent<HTMLButtonElement>,
    prefix: string
  ): IActionsArtifact | null {
    const id = Number(event.currentTarget.id.slice(prefix.length))
    return (
      this.state.list?.artifacts.find(artifact => artifact.id === id) ?? null
    )
  }

  private chooseDestinationFromButton = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const artifact = this.artifactFromButton(event, 'download-artifact-')
    if (artifact !== null) {
      void this.chooseDestination(artifact)
    }
  }

  private checkAttestationsFromButton = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const artifact = this.artifactFromButton(event, 'check-artifact-')
    if (artifact !== null) {
      this.checkAttestations(artifact)
    }
  }

  private async download(
    artifact: IActionsArtifact,
    destination: string,
    generation: number
  ) {
    if (isExpired(artifact)) {
      this.setState({
        choosingArtifactId: null,
        operationError:
          'This artifact expired before the download could start. Refresh artifacts.',
      })
      return
    }

    const controller = new AbortController()
    this.downloadController = controller
    this.lastProgressUpdate = 0
    this.setState({
      choosingArtifactId: null,
      downloadingArtifactId: artifact.id,
      progress: { receivedBytes: 0, totalBytes: artifact.sizeInBytes },
      operationMessage: null,
      operationError: null,
    })

    try {
      const result = await this.props.actionsStore.downloadArtifact(
        this.props.repository,
        { ...artifact, expired: isExpired(artifact) },
        destination,
        controller.signal,
        progress => {
          const now = Date.now()
          if (
            this.mounted &&
            this.downloadController === controller &&
            (now - this.lastProgressUpdate >= 100 ||
              progress.receivedBytes === progress.totalBytes)
          ) {
            this.lastProgressUpdate = now
            this.setState({ progress })
          }
        }
      )
      if (
        this.mounted &&
        generation === this.destinationGeneration &&
        this.downloadController === controller
      ) {
        const digestMessage =
          result.matchesGitHubDigest === true
            ? 'The locally computed SHA-256 matches GitHub’s artifact digest.'
            : 'GitHub did not report a digest; the app computed a local SHA-256.'
        this.setState({
          downloadingArtifactId: null,
          progress: null,
          operationMessage: `Downloaded ${artifact.name}. ${digestMessage}`,
          completedDownload: {
            artifactId: artifact.id,
            path: result.path,
            localDigest: result.localDigest,
            matchesGitHubDigest: result.matchesGitHubDigest,
          },
        })
      }
    } catch (error) {
      if (
        this.mounted &&
        generation === this.destinationGeneration &&
        this.downloadController === controller
      ) {
        if ((error as Error)?.name === 'AbortError') {
          this.setState({
            downloadingArtifactId: null,
            progress: null,
            operationMessage:
              'Artifact download canceled. The partial file was removed.',
          })
        } else {
          this.setState({
            downloadingArtifactId: null,
            progress: null,
            operationError: errorMessage(
              error,
              'Unable to download this artifact.'
            ),
          })
        }
      }
    } finally {
      if (this.downloadController === controller) {
        this.downloadController = null
      }
    }
  }

  private cancelDownload = () => {
    this.downloadController?.abort()
    this.setState({ operationMessage: 'Canceling artifact download…' })
  }

  private revealDownload = async () => {
    const completed = this.state.completedDownload
    if (completed === null) {
      return
    }
    try {
      await (this.props.reveal ?? showItemInFolder)(completed.path)
    } catch (error) {
      if (this.mounted) {
        this.setState({
          operationError: errorMessage(
            error,
            'Unable to reveal the artifact archive.'
          ),
        })
      }
    }
  }

  private renderAttestationState(artifact: IActionsArtifact) {
    const check = this.state.checks[artifact.id]
    if (check === undefined) {
      return null
    }
    if (check.status === 'loading') {
      return <p role="status">Checking attestation records…</p>
    }
    if (check.status === 'error') {
      return <p role="alert">{check.message}</p>
    }
    if (check.status === 'not-found') {
      return (
        <p role="status">
          No attestation record was returned for this digest. This does not
          change the local archive digest check.
        </p>
      )
    }
    return (
      <p role="status">
        Attestation record found. Presence only—cryptographic verification of
        the signature, signer, timestamp, and policy is still required.
      </p>
    )
  }

  private renderArtifact(artifact: IActionsArtifact) {
    const expired = isExpired(artifact)
    const tooLarge = artifact.sizeInBytes > ActionsArtifactMaximumDownloadBytes
    const busy =
      this.state.choosingArtifactId !== null ||
      this.state.downloadingArtifactId !== null
    const checking = this.state.checks[artifact.id]?.status === 'loading'
    const anyAttestationCheck = Object.values(this.state.checks).some(
      check => check.status === 'loading'
    )
    const provenanceRun = artifact.workflowRun
    const branch = provenanceRun?.headBranch ?? this.props.run.head_branch
    const commit = provenanceRun?.headSha ?? this.props.run.head_sha
    const headingId = `actions-artifact-${artifact.id}`
    const completed =
      this.state.completedDownload?.artifactId === artifact.id
        ? this.state.completedDownload
        : null

    return (
      <article
        className="actions-artifact-card"
        key={artifact.id}
        aria-labelledby={headingId}
      >
        <header>
          <div>
            <h4 id={headingId}>{artifact.name}</h4>
            <span
              className={`actions-status-chip ${
                expired ? 'failure' : 'success'
              }`}
            >
              {expired ? 'Expired' : 'Available'}
            </span>
          </div>
          <strong>{readableBytes(artifact.sizeInBytes)}</strong>
        </header>

        <dl className="actions-artifact-metadata">
          <div>
            <dt>Created</dt>
            <dd>{formatDate(artifact.createdAt)}</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{formatDate(artifact.expiresAt)}</dd>
          </div>
          <div>
            <dt>Workflow run</dt>
            <dd>
              #{this.props.run.run_number ?? this.props.run.id}
              {this.props.run.run_attempt
                ? ` · attempt ${this.props.run.run_attempt}`
                : ''}{' '}
              · {this.props.run.event}
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              {branch ?? 'Branch unavailable'}
              {commit ? ` · ${commit.slice(0, 12)}` : ''}
            </dd>
          </div>
          {this.props.run.actor && (
            <div>
              <dt>Actor</dt>
              <dd>{this.props.run.actor.login}</dd>
            </div>
          )}
        </dl>

        <div className="actions-artifact-digest">
          <span>GitHub-reported archive digest</span>
          {artifact.digest === null ? (
            <p>Not available for this artifact.</p>
          ) : (
            <code>{artifact.digest}</code>
          )}
        </div>

        {expired && (
          <p className="actions-artifact-guidance">
            GitHub no longer serves expired artifact archives.
          </p>
        )}
        {tooLarge && (
          <p className="actions-artifact-guidance">
            This archive exceeds the app’s 5 GiB download safety limit.
          </p>
        )}

        <div className="actions-artifact-buttons">
          <Button
            id={`download-artifact-${artifact.id}`}
            size="small"
            className="button-component-primary"
            onClick={this.chooseDestinationFromButton}
            disabled={busy || expired || tooLarge}
            ariaLabel={`Download artifact: ${artifact.name}`}
          >
            {this.state.choosingArtifactId === artifact.id
              ? 'Choosing…'
              : this.state.downloadingArtifactId === artifact.id
              ? 'Downloading…'
              : 'Download archive'}
          </Button>
          {artifact.digest !== null && (
            <Button
              id={`check-artifact-${artifact.id}`}
              size="small"
              onClick={this.checkAttestationsFromButton}
              disabled={anyAttestationCheck}
              ariaLabel={`Check attestation records: ${artifact.name}`}
            >
              {checking ? 'Checking…' : 'Check attestations'}
            </Button>
          )}
          {this.state.downloadingArtifactId === artifact.id && (
            <Button size="small" onClick={this.cancelDownload}>
              Cancel download
            </Button>
          )}
          {completed && (
            <Button size="small" onClick={this.revealDownload}>
              Show in folder
            </Button>
          )}
        </div>

        {this.state.downloadingArtifactId === artifact.id &&
          this.state.progress && (
            <div
              className="actions-artifact-progress"
              role="status"
              aria-live="polite"
            >
              <progress
                max={Math.max(this.state.progress.totalBytes, 1)}
                value={this.state.progress.receivedBytes}
                aria-label={`Downloading ${artifact.name}`}
              />
              <span>
                {readableBytes(this.state.progress.receivedBytes)} of{' '}
                {readableBytes(this.state.progress.totalBytes)}
              </span>
            </div>
          )}
        {completed && (
          <div className="actions-artifact-local-digest">
            <span>Locally computed archive digest</span>
            <code>{completed.localDigest}</code>
            <small>
              {completed.matchesGitHubDigest === true
                ? 'Matches the digest reported by GitHub.'
                : 'GitHub did not report a digest to compare.'}
            </small>
          </div>
        )}
        <div className="actions-artifact-attestation-state">
          {this.renderAttestationState(artifact)}
        </div>
      </article>
    )
  }

  public render() {
    const { list } = this.state
    return (
      <section
        className="actions-artifacts"
        aria-labelledby="actions-artifacts-heading"
      >
        <header className="actions-artifacts-header">
          <div>
            <span className="eyebrow">Run outputs</span>
            <h3 id="actions-artifacts-heading">Artifacts</h3>
          </div>
          <div className="actions-artifacts-header-buttons">
            {this.state.loading && (
              <Button size="small" onClick={this.cancelArtifactLoad}>
                Cancel loading
              </Button>
            )}
            <Button
              size="small"
              onClick={this.loadArtifacts}
              disabled={
                this.state.loading ||
                this.state.choosingArtifactId !== null ||
                this.state.downloadingArtifactId !== null
              }
            >
              Refresh artifacts
            </Button>
          </div>
        </header>

        {this.state.loading && (
          <div className="actions-loading" role="status">
            {this.state.loadingPage === 1
              ? 'Loading artifacts…'
              : `Loading artifact page ${this.state.loadingPage}…`}
          </div>
        )}
        {this.state.error && (
          <div className="actions-inline-error" role="alert">
            {this.state.error}
          </div>
        )}
        {!this.state.loading &&
          !this.state.error &&
          list?.artifacts.length === 0 && (
            <div className="actions-empty">
              No artifacts were returned for this workflow run.
            </div>
          )}
        {list !== null && (
          <p className="actions-artifact-page-note" role="status">
            Showing {list.artifacts.length} of {list.totalCount} artifacts.
            {list.capped
              ? ' The 1,000-record application safety limit has been reached.'
              : list.truncated
              ? ' More artifacts are available.'
              : ' The list is complete.'}
          </p>
        )}
        {list?.nextPage !== null && list?.nextPage !== undefined && (
          <div className="actions-artifact-pagination">
            <Button
              size="small"
              className="button-component-primary"
              onClick={this.loadMoreArtifacts}
              disabled={
                this.state.loading ||
                this.state.choosingArtifactId !== null ||
                this.state.downloadingArtifactId !== null
              }
            >
              Load next 100
            </Button>
          </div>
        )}
        {this.state.operationError && (
          <div className="actions-inline-error" role="alert" aria-atomic="true">
            {this.state.operationError}
          </div>
        )}
        {this.state.operationMessage && (
          <div
            className="actions-artifact-message"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {this.state.operationMessage}
          </div>
        )}
        <div className="actions-artifact-grid">
          {list?.artifacts.map(artifact => this.renderArtifact(artifact))}
        </div>
      </section>
    )
  }
}
