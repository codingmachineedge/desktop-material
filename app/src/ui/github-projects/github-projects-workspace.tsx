import * as React from 'react'
import { API } from '../../lib/api'
import { getAccountForRepository } from '../../lib/get-account-for-repository'
import {
  GitHubProjectsCache,
  IGitHubProjectsCache,
  isGitHubProjectsSnapshotStale,
} from '../../lib/github-projects-cache'
import {
  GitHubProjectsError,
  GitHubProjectsErrorKind,
  IGitHubProjectsClient,
  IGitHubProjectsRepositoryIdentity,
  loadGitHubProjects,
} from '../../lib/github-projects-loader'
import {
  GitHubProjectsPartialReason,
  IGitHubProject,
  IGitHubProjectItem,
  IGitHubProjectsSnapshot,
} from '../../lib/github-projects'
import { t } from '../../lib/i18n'
import { Account, getAccountKey } from '../../models/account'
import { Repository } from '../../models/repository'
import { Button } from '../lib/button'
import { LinkButton } from '../lib/link-button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

export interface IGitHubProjectsClientFactory {
  (account: Account): IGitHubProjectsClient
}

export interface IGitHubProjectsWorkspaceProps {
  readonly repository: Repository
  readonly accounts: ReadonlyArray<Account>
  readonly clientFactory?: IGitHubProjectsClientFactory
  readonly cache?: IGitHubProjectsCache
  readonly now?: () => Date
  /** Tests and static previews may suppress the automatic live request. */
  readonly autoLoad?: boolean
}

type ProjectsDataSource = 'live' | 'cached' | null

interface IGitHubProjectsWorkspaceState {
  readonly snapshot: IGitHubProjectsSnapshot | null
  readonly source: ProjectsDataSource
  readonly selectedProjectId: string | null
  readonly loading: boolean
  readonly error: string | null
}

const defaultClientFactory: IGitHubProjectsClientFactory = account =>
  API.fromAccount(account)

const accountObjectKeys = new WeakMap<Account, number>()
let nextAccountObjectKey = 0

function accountObjectKey(account: Account | null): number | null {
  if (account === null) {
    return null
  }
  const current = accountObjectKeys.get(account)
  if (current !== undefined) {
    return current
  }
  const created = ++nextAccountObjectKey
  accountObjectKeys.set(account, created)
  return created
}

export function getGitHubProjectsIdentity(
  repository: Repository
): IGitHubProjectsRepositoryIdentity | null {
  const remote = repository.gitHubRepository
  return remote === null
    ? null
    : {
        endpoint: remote.endpoint,
        owner: remote.owner.login,
        repository: remote.name,
      }
}

export function getGitHubProjectsAccount(
  repository: Repository,
  accounts: ReadonlyArray<Account>
): Account | null {
  const remote = repository.gitHubRepository
  const account = getAccountForRepository(accounts, repository)
  return remote !== null &&
    account?.provider === 'github' &&
    account.endpoint === remote.endpoint
    ? account
    : null
}

function contextKey(props: IGitHubProjectsWorkspaceProps): string {
  const identity = getGitHubProjectsIdentity(props.repository)
  const account = getGitHubProjectsAccount(props.repository, props.accounts)
  return JSON.stringify([
    props.repository.id,
    identity?.endpoint ?? null,
    identity?.owner ?? null,
    identity?.repository ?? null,
    account === null ? null : getAccountKey(account),
    // Object identity prevents a response made with a replaced credential
    // from becoming current without placing the credential in component state.
    accountObjectKey(account),
  ])
}

function selectedProject(
  snapshot: IGitHubProjectsSnapshot | null,
  selectedProjectId: string | null
): IGitHubProject | null {
  if (snapshot === null) {
    return null
  }
  return (
    snapshot.projects.find(project => project.id === selectedProjectId) ??
    snapshot.projects[0] ??
    null
  )
}

function errorMessage(kind: GitHubProjectsErrorKind | 'signed-out'): string {
  switch (kind) {
    case 'signed-out':
      return t('projects.errorSignedOut')
    case 'authentication':
      return t('projects.errorAuthentication')
    case 'permission':
      return t('projects.errorPermission')
    case 'rate-limit':
      return t('projects.errorRateLimit')
    case 'not-found':
      return t('projects.errorNotFound')
    case 'unsupported':
      return t('projects.errorUnsupported')
    case 'service':
      return t('projects.errorService')
    case 'network':
      return t('projects.errorNetwork')
    case 'invalid-response':
      return t('projects.errorInvalidResponse')
  }
}

function partialReasonLabel(reason: GitHubProjectsPartialReason): string {
  switch (reason) {
    case 'projects-capped':
      return t('projects.partialProjects')
    case 'items-capped':
      return t('projects.partialItems')
    case 'views-capped':
      return t('projects.partialViews')
    case 'classic-fallback':
      return t('projects.partialClassic')
  }
}

function itemKindLabel(item: IGitHubProjectItem): string {
  switch (item.kind) {
    case 'issue':
      return t('projects.kindIssue')
    case 'pull-request':
      return t('projects.kindPullRequest')
    case 'draft-issue':
      return t('projects.kindDraftIssue')
    case 'note':
      return t('projects.kindNote')
    case 'unavailable':
      return t('projects.kindUnavailable')
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export class GitHubProjectsWorkspace extends React.Component<
  IGitHubProjectsWorkspaceProps,
  IGitHubProjectsWorkspaceState
> {
  private readonly cache: IGitHubProjectsCache
  private mounted = false
  private generation = 0
  private controller: AbortController | null = null

  public constructor(props: IGitHubProjectsWorkspaceProps) {
    super(props)
    this.cache = props.cache ?? new GitHubProjectsCache()
    this.state = this.initialState(props)
  }

  private initialState(
    props: IGitHubProjectsWorkspaceProps
  ): IGitHubProjectsWorkspaceState {
    const identity = getGitHubProjectsIdentity(props.repository)
    let cached: IGitHubProjectsSnapshot | null = null
    if (identity !== null) {
      try {
        cached = this.cache.read(identity)
      } catch {
        cached = null
      }
    }
    const account = getGitHubProjectsAccount(props.repository, props.accounts)
    return {
      snapshot: cached,
      source: cached === null ? null : 'cached',
      selectedProjectId: cached?.projects[0]?.id ?? null,
      loading: false,
      error:
        identity !== null && account === null
          ? errorMessage('signed-out')
          : null,
    }
  }

  public componentDidMount() {
    this.mounted = true
    if (this.props.autoLoad !== false) {
      void this.refresh()
    }
  }

  public componentDidUpdate(prevProps: IGitHubProjectsWorkspaceProps) {
    if (contextKey(prevProps) !== contextKey(this.props)) {
      this.resetForContext()
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.generation++
    this.controller?.abort()
    this.controller = null
  }

  private resetForContext() {
    this.generation++
    this.controller?.abort()
    this.controller = null
    this.setState(this.initialState(this.props), () => {
      if (this.props.autoLoad !== false) {
        void this.refresh()
      }
    })
  }

  private readonly refresh = async () => {
    const identity = getGitHubProjectsIdentity(this.props.repository)
    const account = getGitHubProjectsAccount(
      this.props.repository,
      this.props.accounts
    )
    if (identity === null) {
      this.setState({ error: errorMessage('unsupported'), loading: false })
      return
    }
    if (account === null) {
      this.setState({ error: errorMessage('signed-out'), loading: false })
      return
    }

    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    const generation = ++this.generation
    const expectedContext = contextKey(this.props)
    this.setState({ loading: true, error: null })

    try {
      const snapshot = await loadGitHubProjects(
        identity,
        (this.props.clientFactory ?? defaultClientFactory)(account),
        controller.signal,
        this.props.now?.() ?? new Date()
      )
      const currentAccount = getGitHubProjectsAccount(
        this.props.repository,
        this.props.accounts
      )
      if (
        !this.mounted ||
        controller.signal.aborted ||
        generation !== this.generation ||
        expectedContext !== contextKey(this.props) ||
        currentAccount === null ||
        getAccountKey(currentAccount) !== getAccountKey(account) ||
        currentAccount.token !== account.token
      ) {
        return
      }
      try {
        this.cache.write(identity, snapshot, this.props.now?.() ?? new Date())
      } catch {
        // A cache failure does not downgrade the successfully loaded live view.
      }
      this.controller = null
      this.setState(state => ({
        snapshot,
        source: 'live',
        selectedProjectId:
          snapshot.projects.find(
            project => project.id === state.selectedProjectId
          )?.id ??
          snapshot.projects[0]?.id ??
          null,
        loading: false,
        error: null,
      }))
    } catch (error) {
      if (
        !this.mounted ||
        controller.signal.aborted ||
        generation !== this.generation ||
        (error as Error)?.name === 'AbortError'
      ) {
        return
      }
      this.controller = null
      const kind =
        error instanceof GitHubProjectsError
          ? error.kind
          : ('invalid-response' as const)
      this.setState(state => ({
        loading: false,
        source: state.snapshot === null ? null : 'cached',
        error: errorMessage(kind),
      }))
    }
  }

  private readonly selectProject = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const projectId = event.currentTarget.dataset.projectId
    if (
      projectId !== undefined &&
      this.state.snapshot?.projects.some(project => project.id === projectId)
    ) {
      this.setState({ selectedProjectId: projectId })
    }
  }

  private renderStatus() {
    const { snapshot, source, loading } = this.state
    const now = this.props.now?.() ?? new Date()
    return (
      <div className="github-projects-status" role="status" aria-live="polite">
        <span className={`github-projects-source source-${source ?? 'none'}`}>
          {source === 'live'
            ? t('projects.sourceLive')
            : source === 'cached'
            ? t('projects.sourceCached')
            : t('projects.sourceUnavailable')}
        </span>
        {snapshot !== null && (
          <span>
            {t('projects.updatedAt', {
              timestamp: formatTimestamp(snapshot.fetchedAt),
            })}
          </span>
        )}
        {source === 'cached' &&
          snapshot !== null &&
          isGitHubProjectsSnapshotStale(snapshot, now) && (
            <span className="github-projects-stale">{t('projects.stale')}</span>
          )}
        {loading && <span>{t('projects.refreshing')}</span>}
      </div>
    )
  }

  private renderProjectList(project: IGitHubProject | null) {
    const snapshot = this.state.snapshot
    if (snapshot === null || snapshot.projects.length === 0) {
      return null
    }
    return (
      <nav className="github-projects-list" aria-label={t('projects.listAria')}>
        {snapshot.projects.map(candidate => (
          <button
            type="button"
            key={candidate.id}
            data-project-id={candidate.id}
            className="github-projects-list-item"
            aria-current={candidate.id === project?.id ? 'true' : undefined}
            onClick={this.selectProject}
          >
            <span>{candidate.title}</span>
            <small>
              {t('projects.itemCount', {
                count: String(candidate.items.length),
              })}
            </small>
          </button>
        ))}
      </nav>
    )
  }

  private renderItem(item: IGitHubProjectItem) {
    const body = (
      <React.Fragment>
        <span className="github-project-item-title">{item.title}</span>
        <span className="github-project-item-meta">
          <span>{itemKindLabel(item)}</span>
          {item.status !== null && (
            <span className="github-project-item-status">{item.status}</span>
          )}
          {item.state !== null && <span>{item.state}</span>}
          {item.repository !== null && <span>{item.repository}</span>}
        </span>
      </React.Fragment>
    )
    return (
      <li className="github-project-item" key={item.id}>
        {item.url === null ? (
          <div>{body}</div>
        ) : (
          <LinkButton uri={item.url} ariaLabel={item.title}>
            {body}
          </LinkButton>
        )}
      </li>
    )
  }

  private renderProject(project: IGitHubProject | null) {
    if (project === null) {
      return (
        <div className="github-projects-empty" role="status">
          <Octicon symbol={octicons.project} />
          <strong>{t('projects.emptyTitle')}</strong>
          <span>{t('projects.emptyDescription')}</span>
        </div>
      )
    }
    return (
      <article className="github-project-detail">
        <header>
          <div>
            <h3>{project.title}</h3>
            <span className={`github-project-state state-${project.state}`}>
              {project.state === 'open'
                ? t('projects.stateOpen')
                : t('projects.stateClosed')}
            </span>
          </div>
          {project.url !== null && (
            <LinkButton uri={project.url}>
              {t('projects.openOnGitHub')}
            </LinkButton>
          )}
        </header>
        {project.description.length > 0 && <p>{project.description}</p>}
        {project.views.length > 0 && (
          <div
            className="github-project-views"
            role="group"
            aria-label={t('projects.viewsAria')}
          >
            {project.views.map(view => (
              <span key={view.id}>
                {view.name}
                {view.layout === null ? '' : ` · ${view.layout}`}
              </span>
            ))}
          </div>
        )}
        {project.items.length === 0 ? (
          <p className="github-project-items-empty">{t('projects.noItems')}</p>
        ) : (
          <ul className="github-project-items">
            {project.items.map(item => this.renderItem(item))}
          </ul>
        )}
      </article>
    )
  }

  public render() {
    const project = selectedProject(
      this.state.snapshot,
      this.state.selectedProjectId
    )
    const snapshot = this.state.snapshot
    return (
      <section
        className="github-projects-workspace"
        aria-labelledby="github-projects-title"
      >
        <header className="github-projects-header">
          <div>
            <h2 id="github-projects-title">{t('projects.title')}</h2>
            <p>{t('projects.description')}</p>
          </div>
          <Button disabled={this.state.loading} onClick={this.refresh}>
            {t('projects.refresh')}
          </Button>
        </header>
        {this.renderStatus()}
        <p className="github-projects-read-only">
          <Octicon symbol={octicons.eye} /> {t('projects.readOnly')}
        </p>
        {this.state.error !== null && (
          <p className="github-projects-error" role="alert">
            {this.state.error}{' '}
            {snapshot !== null ? t('projects.cacheRecovery') : ''}
          </p>
        )}
        {snapshot !== null && snapshot.partialReasons.length > 0 && (
          <div className="github-projects-partial" role="status">
            <strong>{t('projects.partialTitle')}</strong>
            <ul>
              {snapshot.partialReasons.map(reason => (
                <li key={reason}>{partialReasonLabel(reason)}</li>
              ))}
            </ul>
          </div>
        )}
        {this.state.loading && snapshot === null ? (
          <div className="github-projects-loading" role="status">
            {t('projects.loading')}
          </div>
        ) : (
          <div className="github-projects-layout">
            {this.renderProjectList(project)}
            {this.renderProject(project)}
          </div>
        )}
      </section>
    )
  }
}
