import * as React from 'react'
import { Account } from '../../models/account'
import { PopupType } from '../../models/popup'
import { Repository } from '../../models/repository'
import {
  getGitHubIssuesAccount,
  getGitHubIssuesAvailability,
  GitHubIssuesAvailability,
  GitHubIssuesStore,
  IGitHubIssueMutationReview,
} from '../../lib/stores/github-issues-store'
import {
  GitHubIssueDirection,
  GitHubIssueStateFilter,
  GitHubIssueSort,
  IGitHubIssue,
  IGitHubIssueComment,
  IGitHubIssueMetadata,
  IGitHubIssueQuery,
  IGitHubIssueUpdate,
  normalizeGitHubIssueComment,
  normalizeGitHubIssueUpdate,
} from '../../lib/github-issues'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'

type BusyOperation = 'issues' | 'detail' | 'comments' | 'mutation'

interface IIssueEditor {
  readonly title: string
  readonly body: string
  readonly labels: ReadonlyArray<string>
  readonly assignees: ReadonlyArray<string>
  readonly milestone: number | null
}

type IssueConfirmation =
  | {
      readonly kind: 'update'
      readonly issue: IGitHubIssue
      readonly update: IGitHubIssueUpdate
      readonly review: IGitHubIssueMutationReview
    }
  | {
      readonly kind: 'comment'
      readonly issue: IGitHubIssue
      readonly body: string
      readonly review: IGitHubIssueMutationReview
    }
  | {
      readonly kind: 'close' | 'reopen'
      readonly issue: IGitHubIssue
      readonly review: IGitHubIssueMutationReview
    }

export interface IGitHubIssuesViewProps {
  readonly repository: Repository
  readonly accounts: ReadonlyArray<Account>
  readonly issuesStore: GitHubIssuesStore
  readonly dispatcher: Dispatcher
}

interface IGitHubIssuesViewState {
  readonly repositoryKey: string
  readonly availability: GitHubIssuesAvailability
  readonly query: IGitHubIssueQuery
  readonly issues: ReadonlyArray<IGitHubIssue>
  readonly nextIssuePage: number | null
  readonly issuesCapped: boolean
  readonly incompleteSearch: boolean
  readonly selectedIssue: IGitHubIssue | null
  readonly comments: ReadonlyArray<IGitHubIssueComment>
  readonly commentPage: number
  readonly nextCommentPage: number | null
  readonly commentsCapped: boolean
  readonly metadata: IGitHubIssueMetadata | null
  readonly metadataLoading: boolean
  readonly metadataError: string | null
  readonly commentsError: string | null
  readonly editor: IIssueEditor | null
  readonly commentDraft: string | null
  readonly confirmation: IssueConfirmation | null
  readonly busy: BusyOperation | null
  readonly message: string | null
  readonly error: string | null
}

const defaultQuery: IGitHubIssueQuery = {
  state: 'open',
  search: '',
  labels: [],
  assignee: null,
  milestone: null,
  sort: 'updated',
  direction: 'desc',
  page: 1,
}

function repositoryKey(repository: Repository): string {
  const remote = repository.gitHubRepository
  const provider =
    remote === null
      ? 'local'
      : `${remote.endpoint}/${remote.owner.login}/${remote.name}`
  return `${repository.id}:${repository.accountKey ?? ''}:${provider}`
}

function initialState(props: IGitHubIssuesViewProps): IGitHubIssuesViewState {
  return {
    repositoryKey: repositoryKey(props.repository),
    availability: getGitHubIssuesAvailability(props.repository, props.accounts),
    query: defaultQuery,
    issues: [],
    nextIssuePage: null,
    issuesCapped: false,
    incompleteSearch: false,
    selectedIssue: null,
    comments: [],
    commentPage: 1,
    nextCommentPage: null,
    commentsCapped: false,
    metadata: null,
    metadataLoading: false,
    metadataError: null,
    commentsError: null,
    editor: null,
    commentDraft: null,
    confirmation: null,
    busy: null,
    message: null,
    error: null,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'GitHub Issues could not complete this operation safely.'
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function selectedValues(
  event: React.ChangeEvent<HTMLSelectElement>
): ReadonlyArray<string> {
  return Array.from(event.currentTarget.selectedOptions, option => option.value)
}

function formatDate(value: Date): string {
  return value.toLocaleString()
}

function issueEditor(issue: IGitHubIssue): IIssueEditor {
  return {
    title: issue.title,
    body: issue.body,
    labels: issue.labels.map(label => label.name),
    assignees: issue.assignees,
    milestone: issue.milestone?.number ?? null,
  }
}

export class GitHubIssuesView extends React.Component<
  IGitHubIssuesViewProps,
  IGitHubIssuesViewState
> {
  private mounted = false
  private generation = 0
  private operationController: AbortController | null = null
  private metadataGeneration = 0
  private metadataController: AbortController | null = null

  public constructor(props: IGitHubIssuesViewProps) {
    super(props)
    this.state = initialState(props)
  }

  public componentDidMount() {
    this.mounted = true
    void this.loadInitial()
  }

  public componentDidUpdate(prevProps: IGitHubIssuesViewProps) {
    if (
      repositoryKey(prevProps.repository) !==
        repositoryKey(this.props.repository) ||
      prevProps.accounts !== this.props.accounts
    ) {
      this.operationController?.abort()
      this.metadataController?.abort()
      this.generation++
      this.metadataGeneration++
      this.setState(initialState(this.props), () => void this.loadInitial())
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.generation++
    this.operationController?.abort()
    this.metadataController?.abort()
    this.operationController = null
    this.metadataController = null
  }

  private isCurrent(controller: AbortController, generation: number) {
    return (
      this.mounted &&
      this.operationController === controller &&
      this.generation === generation
    )
  }

  private start(operation: BusyOperation) {
    this.operationController?.abort()
    const controller = new AbortController()
    const generation = ++this.generation
    this.operationController = controller
    this.setState({ busy: operation, error: null })
    return { controller, generation }
  }

  private finish(controller: AbortController, generation: number) {
    if (!this.isCurrent(controller, generation)) {
      return false
    }
    this.operationController = null
    this.setState({ busy: null })
    return true
  }

  private loadInitial = async () => {
    if (this.state.availability !== 'available') {
      return
    }
    await this.loadIssues(1)
    if (this.mounted && this.state.availability === 'available') {
      void this.loadMetadata()
    }
  }

  private loadIssues = async (page: number) => {
    const request = this.start('issues')
    const query = { ...this.state.query, page }
    try {
      const result = await this.props.issuesStore.list(
        this.props.repository,
        query,
        request.controller.signal
      )
      if (!this.isCurrent(request.controller, request.generation)) {
        return
      }
      const selectedNumber = this.state.selectedIssue?.number ?? null
      this.setState({
        query: { ...query, page: result.page },
        issues: result.issues,
        nextIssuePage: result.nextPage,
        issuesCapped: result.capped,
        incompleteSearch: result.incomplete,
        selectedIssue:
          selectedNumber === null
            ? null
            : result.issues.find(issue => issue.number === selectedNumber) ??
              null,
        comments: [],
        commentPage: 1,
        nextCommentPage: null,
        commentsCapped: false,
        editor: null,
        commentDraft: null,
        confirmation: null,
        message:
          result.issues.length === 0
            ? 'No issues match the selected filters.'
            : null,
      })
    } catch (error) {
      if (this.isCurrent(request.controller, request.generation)) {
        this.setState({
          error: isAbortError(error) ? null : errorMessage(error),
          message: isAbortError(error) ? 'Issue loading canceled.' : null,
        })
      }
    } finally {
      this.finish(request.controller, request.generation)
    }
  }

  private loadMetadata = async () => {
    this.metadataController?.abort()
    const controller = new AbortController()
    const generation = ++this.metadataGeneration
    this.metadataController = controller
    this.setState({ metadataLoading: true, metadataError: null })
    try {
      const metadata = await this.props.issuesStore.metadata(
        this.props.repository,
        controller.signal
      )
      if (
        this.mounted &&
        this.metadataController === controller &&
        this.metadataGeneration === generation
      ) {
        this.setState({ metadata })
      }
    } catch (error) {
      if (
        this.mounted &&
        this.metadataController === controller &&
        this.metadataGeneration === generation &&
        !isAbortError(error)
      ) {
        this.setState({ metadataError: errorMessage(error) })
      }
    } finally {
      if (
        this.mounted &&
        this.metadataController === controller &&
        this.metadataGeneration === generation
      ) {
        this.metadataController = null
        this.setState({ metadataLoading: false })
      }
    }
  }

  private loadDetail = async (
    issueNumber: number,
    completionMessage: string | null = null
  ) => {
    const request = this.start('detail')
    let loadedIssue: IGitHubIssue | null = null
    try {
      const issue = await this.props.issuesStore.detail(
        this.props.repository,
        issueNumber,
        request.controller.signal
      )
      if (this.isCurrent(request.controller, request.generation)) {
        loadedIssue = issue
        this.setState({
          selectedIssue: issue,
          comments: [],
          commentPage: 1,
          nextCommentPage: null,
          commentsCapped: false,
          commentsError: null,
          editor: null,
          commentDraft: null,
          confirmation: null,
          message: completionMessage,
        })
      }
    } catch (error) {
      if (this.isCurrent(request.controller, request.generation)) {
        this.setState({
          error: isAbortError(error) ? null : errorMessage(error),
          message: isAbortError(error) ? 'Issue loading canceled.' : null,
        })
      }
    } finally {
      const finished = this.finish(request.controller, request.generation)
      if (finished && loadedIssue !== null) {
        void this.loadComments(1, loadedIssue.number)
      }
    }
  }

  private loadComments = async (
    page: number,
    selectedIssueNumber: number | null = this.state.selectedIssue?.number ??
      null
  ) => {
    if (selectedIssueNumber === null) {
      return
    }
    const request = this.start('comments')
    this.setState({ commentsError: null })
    try {
      const result = await this.props.issuesStore.comments(
        this.props.repository,
        selectedIssueNumber,
        page,
        request.controller.signal
      )
      if (this.isCurrent(request.controller, request.generation)) {
        this.setState({
          comments: result.comments,
          commentPage: result.page,
          nextCommentPage: result.nextPage,
          commentsCapped: result.capped,
          commentsError: null,
        })
      }
    } catch (error) {
      if (this.isCurrent(request.controller, request.generation)) {
        this.setState({
          commentsError: isAbortError(error) ? null : errorMessage(error),
          message: isAbortError(error) ? 'Comment loading canceled.' : null,
        })
      }
    } finally {
      this.finish(request.controller, request.generation)
    }
  }

  private cancelOperation = () => {
    this.operationController?.abort()
    this.setState({ message: 'Canceling the current Issues operation…' })
  }

  private refreshIssues = () => void this.loadIssues(this.state.query.page)
  private previousIssues = () =>
    void this.loadIssues(Math.max(1, this.state.query.page - 1))
  private nextIssues = () => {
    if (this.state.nextIssuePage !== null) {
      void this.loadIssues(this.state.nextIssuePage)
    }
  }
  private previousComments = () =>
    void this.loadComments(Math.max(1, this.state.commentPage - 1))
  private nextComments = () => {
    if (this.state.nextCommentPage !== null) {
      void this.loadComments(this.state.nextCommentPage)
    }
  }
  private retryComments = () => void this.loadComments(this.state.commentPage)
  private reloadMetadata = () => void this.loadMetadata()

  private selectIssue = (event: React.MouseEvent<HTMLButtonElement>) => {
    const issueNumber = Number(event.currentTarget.value)
    if (Number.isSafeInteger(issueNumber) && issueNumber > 0) {
      void this.loadDetail(issueNumber)
    }
  }

  private updateSearch = (event: React.ChangeEvent<HTMLInputElement>) =>
    this.setState({
      query: {
        ...this.state.query,
        search: event.currentTarget.value,
        page: 1,
      },
    })

  private updateStateFilter = (event: React.ChangeEvent<HTMLSelectElement>) =>
    this.setState({
      query: {
        ...this.state.query,
        state: event.currentTarget.value as GitHubIssueStateFilter,
        page: 1,
      },
    })

  private updateSort = (event: React.ChangeEvent<HTMLSelectElement>) =>
    this.setState({
      query: {
        ...this.state.query,
        sort: event.currentTarget.value as GitHubIssueSort,
        page: 1,
      },
    })

  private updateDirection = (event: React.ChangeEvent<HTMLSelectElement>) =>
    this.setState({
      query: {
        ...this.state.query,
        direction: event.currentTarget.value as GitHubIssueDirection,
        page: 1,
      },
    })

  private updateLabelFilter = (event: React.ChangeEvent<HTMLSelectElement>) =>
    this.setState({
      query: {
        ...this.state.query,
        labels: selectedValues(event),
        page: 1,
      },
    })

  private updateAssigneeFilter = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) =>
    this.setState({
      query: {
        ...this.state.query,
        assignee: event.currentTarget.value || null,
        page: 1,
      },
    })

  private updateMilestoneFilter = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) =>
    this.setState({
      query: {
        ...this.state.query,
        milestone:
          event.currentTarget.value === ''
            ? null
            : Number(event.currentTarget.value),
        page: 1,
      },
    })

  private applyFilters = (event: React.FormEvent) => {
    event.preventDefault()
    if (
      this.state.query.search.trim().length > 0 &&
      this.state.query.milestone !== null
    ) {
      this.setState({
        error:
          'Clear the milestone filter before text search. GitHub search filters milestones by title, not number.',
      })
      return
    }
    void this.loadIssues(1)
  }

  private resetFilters = () =>
    this.setState(
      { query: defaultQuery, error: null },
      () => void this.loadIssues(1)
    )

  private openCreate = () =>
    this.props.dispatcher.showPopup({
      type: PopupType.CreateGitHubIssue,
      repository: this.props.repository,
    })

  private openProviderIssue = async () => {
    const issue = this.state.selectedIssue
    if (issue === null) {
      return
    }
    const opened = await this.props.dispatcher.openInBrowser(issue.url)
    if (!opened && this.mounted) {
      this.setState({
        error: 'Desktop could not open this issue in your browser.',
      })
    }
  }

  private openEditor = () => {
    if (this.state.selectedIssue !== null) {
      this.setState({
        editor: issueEditor(this.state.selectedIssue),
        commentDraft: null,
        confirmation: null,
        error: null,
      })
    }
  }

  private closeComposer = () =>
    this.setState({ editor: null, commentDraft: null, confirmation: null })

  private updateEditorTitle = (event: React.ChangeEvent<HTMLInputElement>) =>
    this.state.editor === null
      ? undefined
      : this.setState({
          editor: { ...this.state.editor, title: event.currentTarget.value },
        })

  private updateEditorBody = (event: React.ChangeEvent<HTMLTextAreaElement>) =>
    this.state.editor === null
      ? undefined
      : this.setState({
          editor: { ...this.state.editor, body: event.currentTarget.value },
        })

  private updateEditorLabels = (event: React.ChangeEvent<HTMLSelectElement>) =>
    this.state.editor === null
      ? undefined
      : this.setState({
          editor: { ...this.state.editor, labels: selectedValues(event) },
        })

  private updateEditorAssignees = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) =>
    this.state.editor === null
      ? undefined
      : this.setState({
          editor: { ...this.state.editor, assignees: selectedValues(event) },
        })

  private updateEditorMilestone = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) =>
    this.state.editor === null
      ? undefined
      : this.setState({
          editor: {
            ...this.state.editor,
            milestone:
              event.currentTarget.value === ''
                ? null
                : Number(event.currentTarget.value),
          },
        })

  private reviewEditor = () => {
    const issue = this.state.selectedIssue
    const editor = this.state.editor
    if (issue === null || editor === null) {
      return
    }
    try {
      const update = normalizeGitHubIssueUpdate(editor)
      const review = this.props.issuesStore.createMutationReview(
        this.props.repository,
        issue,
        'update',
        update
      )
      this.setState({
        confirmation: { kind: 'update', issue, update, review },
        error: null,
      })
    } catch (error) {
      this.setState({ error: errorMessage(error) })
    }
  }

  private openCommentComposer = () =>
    this.setState({
      editor: null,
      commentDraft: '',
      confirmation: null,
      error: null,
    })

  private updateCommentDraft = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => this.setState({ commentDraft: event.currentTarget.value })

  private reviewComment = () => {
    const issue = this.state.selectedIssue
    const draft = this.state.commentDraft
    if (issue === null || draft === null) {
      return
    }
    try {
      const body = normalizeGitHubIssueComment(draft)
      const review = this.props.issuesStore.createMutationReview(
        this.props.repository,
        issue,
        'comment',
        body
      )
      this.setState({
        confirmation: { kind: 'comment', issue, body, review },
        error: null,
      })
    } catch (error) {
      this.setState({ error: errorMessage(error) })
    }
  }

  private reviewStateChange = () => {
    const issue = this.state.selectedIssue
    if (issue === null) {
      return
    }
    const kind = issue.state === 'open' ? 'close' : 'reopen'
    try {
      const review = this.props.issuesStore.createMutationReview(
        this.props.repository,
        issue,
        kind,
        null
      )
      this.setState({ confirmation: { kind, issue, review }, error: null })
    } catch (error) {
      this.setState({ error: errorMessage(error) })
    }
  }

  private cancelConfirmation = () => this.setState({ confirmation: null })

  private confirmMutation = async () => {
    const confirmation = this.state.confirmation
    if (confirmation === null || this.state.busy !== null) {
      return
    }
    const request = this.start('mutation')
    let refreshCommentIssue = false
    try {
      if (confirmation.kind === 'update') {
        const issue = await this.props.issuesStore.update(
          this.props.repository,
          confirmation.review,
          confirmation.update,
          request.controller.signal
        )
        if (this.isCurrent(request.controller, request.generation)) {
          this.replaceIssue(issue, 'Issue changes saved.')
        }
      } else if (confirmation.kind === 'comment') {
        await this.props.issuesStore.addComment(
          this.props.repository,
          confirmation.review,
          confirmation.body,
          request.controller.signal
        )
        if (this.isCurrent(request.controller, request.generation)) {
          refreshCommentIssue = true
          this.setState({
            confirmation: null,
            commentDraft: null,
            message:
              'Comment added. Refreshing the issue before another change…',
          })
        }
      } else {
        const state = confirmation.kind === 'close' ? 'closed' : 'open'
        const issue = await this.props.issuesStore.setState(
          this.props.repository,
          confirmation.review,
          state,
          request.controller.signal
        )
        if (this.isCurrent(request.controller, request.generation)) {
          this.replaceIssue(
            issue,
            state === 'closed' ? 'Issue closed.' : 'Issue reopened.'
          )
        }
      }
    } catch (error) {
      if (this.isCurrent(request.controller, request.generation)) {
        this.setState({
          error: isAbortError(error) ? null : errorMessage(error),
          message: isAbortError(error)
            ? 'Mutation canceled before GitHub began the reviewed write.'
            : null,
          confirmation: null,
        })
      }
    } finally {
      const finished = this.finish(request.controller, request.generation)
      if (finished && refreshCommentIssue) {
        void this.loadDetail(confirmation.issue.number, 'Comment added.')
      }
    }
  }

  private replaceIssue(issue: IGitHubIssue, message: string) {
    this.setState({
      issues: this.state.issues.map(current =>
        current.number === issue.number ? issue : current
      ),
      selectedIssue: issue,
      editor: null,
      commentDraft: null,
      confirmation: null,
      message,
      error: null,
    })
  }

  private renderAvailability() {
    const availability = this.state.availability
    if (availability === 'available') {
      return null
    }
    const title =
      availability === 'signed-out'
        ? 'Sign in to browse Issues'
        : availability === 'disabled'
        ? 'Issues are disabled'
        : 'Issues are unavailable'
    const copy =
      availability === 'signed-out'
        ? 'Sign in with the account selected for this repository. Desktop will not try another signed-in account implicitly.'
        : availability === 'disabled'
        ? 'This repository reports that its issue tracker is disabled.'
        : 'The selected repository is not hosted by a supported GitHub or GitHub Enterprise account.'
    return (
      <section className="github-issues-empty" role="status">
        <h2>{title}</h2>
        <p>{copy}</p>
      </section>
    )
  }

  private renderFilters() {
    const metadata = this.state.metadata
    return (
      <form className="github-issues-filters" onSubmit={this.applyFilters}>
        <label className="github-issues-search">
          Search title and description
          <input
            type="search"
            value={this.state.query.search}
            maxLength={256}
            placeholder="Search this repository"
            onChange={this.updateSearch}
          />
        </label>
        <label>
          State
          <select
            value={this.state.query.state}
            onChange={this.updateStateFilter}
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">Open and closed</option>
          </select>
        </label>
        <label>
          Sort
          <select value={this.state.query.sort} onChange={this.updateSort}>
            <option value="updated">Recently updated</option>
            <option value="created">Created</option>
            <option value="comments">Comment count</option>
          </select>
        </label>
        <label>
          Direction
          <select
            value={this.state.query.direction}
            onChange={this.updateDirection}
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </label>
        <label>
          Labels
          <select
            multiple={true}
            value={[...this.state.query.labels]}
            onChange={this.updateLabelFilter}
            aria-describedby="github-issues-label-help"
          >
            {metadata?.labels.map(label => (
              <option value={label.name} key={label.id}>
                {label.name}
              </option>
            ))}
          </select>
          <small id="github-issues-label-help">
            Use Ctrl or Command to select several.
          </small>
        </label>
        <label>
          Assignee
          <select
            value={this.state.query.assignee ?? ''}
            onChange={this.updateAssigneeFilter}
          >
            <option value="">Anyone</option>
            {metadata?.assignees.map(login => (
              <option value={login} key={login}>
                {login}
              </option>
            ))}
          </select>
        </label>
        <label>
          Milestone
          <select
            value={this.state.query.milestone ?? ''}
            onChange={this.updateMilestoneFilter}
            disabled={this.state.query.search.trim().length > 0}
          >
            <option value="">Any milestone</option>
            {metadata?.milestones.map(milestone => (
              <option value={milestone.number} key={milestone.number}>
                {milestone.title}
              </option>
            ))}
          </select>
        </label>
        <div className="github-issues-filter-actions">
          <Button type="submit" disabled={this.state.busy !== null}>
            Apply filters
          </Button>
          <Button
            type="button"
            disabled={this.state.busy !== null}
            onClick={this.resetFilters}
          >
            Reset
          </Button>
        </div>
        {metadata !== null && metadata.unavailable.length > 0 && (
          <p className="github-issues-metadata-note" role="status">
            Some repository metadata is unavailable:{' '}
            {metadata.unavailable.join(', ')}. This can mean the provider
            version or selected account access changed.
          </p>
        )}
        {this.state.metadataLoading && (
          <p className="github-issues-metadata-note" role="status">
            Loading repository metadata…
          </p>
        )}
        {this.state.metadataError !== null && (
          <p className="github-issues-error" role="alert">
            {this.state.metadataError}
          </p>
        )}
      </form>
    )
  }

  private renderIssueList() {
    return (
      <section
        className="github-issues-list-panel"
        aria-labelledby="issue-list-title"
      >
        <div className="github-issues-panel-heading">
          <div>
            <h2 id="issue-list-title">Repository issues</h2>
            <span>
              {this.state.issues.length} on page {this.state.query.page}
            </span>
          </div>
        </div>
        <ul className="github-issues-list">
          {this.state.issues.map(issue => {
            const selected = issue.number === this.state.selectedIssue?.number
            return (
              <li key={issue.id}>
                <button
                  type="button"
                  value={issue.number}
                  className={`github-issue-row${selected ? ' selected' : ''}`}
                  aria-current={selected ? 'true' : undefined}
                  disabled={this.state.busy !== null}
                  onClick={this.selectIssue}
                >
                  <span className={`github-issue-state ${issue.state}`}>
                    {issue.state}
                  </span>
                  <strong>{issue.title}</strong>
                  <small>
                    #{issue.number} · updated {formatDate(issue.updatedAt)}
                  </small>
                </button>
              </li>
            )
          })}
        </ul>
        <nav className="github-issues-pagination" aria-label="Issue pages">
          <Button
            disabled={this.state.busy !== null || this.state.query.page <= 1}
            onClick={this.previousIssues}
          >
            Previous
          </Button>
          <span>Page {this.state.query.page}</span>
          <Button
            disabled={
              this.state.busy !== null || this.state.nextIssuePage === null
            }
            onClick={this.nextIssues}
          >
            Next
          </Button>
        </nav>
        {this.state.issuesCapped && (
          <p className="github-issues-safety-note">
            Issue page safety limit reached.
          </p>
        )}
        {this.state.incompleteSearch && (
          <p className="github-issues-safety-note">
            GitHub marked this search incomplete. Refine the search and retry.
          </p>
        )}
      </section>
    )
  }

  private renderMetadata(issue: IGitHubIssue) {
    return (
      <dl className="github-issue-metadata">
        <div>
          <dt>Author</dt>
          <dd>{issue.authorLogin}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDate(issue.createdAt)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatDate(issue.updatedAt)}</dd>
        </div>
        <div>
          <dt>Labels</dt>
          <dd>{issue.labels.map(label => label.name).join(', ') || 'None'}</dd>
        </div>
        <div>
          <dt>Assignees</dt>
          <dd>{issue.assignees.join(', ') || 'None'}</dd>
        </div>
        <div>
          <dt>Milestone</dt>
          <dd>{issue.milestone?.title ?? 'None'}</dd>
        </div>
      </dl>
    )
  }

  private editorOptions(
    kind: 'labels' | 'assignees'
  ): ReadonlyArray<{ readonly value: string; readonly key: string }> {
    const issue = this.state.selectedIssue
    const metadata = this.state.metadata
    const values = new Set<string>()
    if (kind === 'labels') {
      metadata?.labels.forEach(label => values.add(label.name))
      issue?.labels.forEach(label => values.add(label.name))
    } else {
      metadata?.assignees.forEach(login => values.add(login))
      issue?.assignees.forEach(login => values.add(login))
    }
    return [...values].sort().map(value => ({ value, key: value }))
  }

  private renderEditor() {
    const editor = this.state.editor
    if (editor === null || this.state.confirmation !== null) {
      return null
    }
    const milestones = new Map(
      this.state.metadata?.milestones.map(item => [item.number, item]) ?? []
    )
    const current = this.state.selectedIssue?.milestone
    if (current !== null && current !== undefined) {
      milestones.set(current.number, current)
    }
    return (
      <section
        className="github-issue-composer"
        aria-labelledby="issue-editor-title"
      >
        <h3 id="issue-editor-title">Edit issue</h3>
        <label>
          Title
          <input
            value={editor.title}
            maxLength={256}
            onChange={this.updateEditorTitle}
          />
        </label>
        <label>
          Description
          <textarea
            value={editor.body}
            maxLength={65_536}
            onChange={this.updateEditorBody}
          />
        </label>
        <div className="github-issue-metadata-editor">
          <label>
            Labels
            <select
              multiple={true}
              value={[...editor.labels]}
              onChange={this.updateEditorLabels}
            >
              {this.editorOptions('labels').map(option => (
                <option value={option.value} key={option.key}>
                  {option.value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assignees
            <select
              multiple={true}
              value={[...editor.assignees]}
              onChange={this.updateEditorAssignees}
            >
              {this.editorOptions('assignees').map(option => (
                <option value={option.value} key={option.key}>
                  {option.value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Milestone
            <select
              value={editor.milestone ?? ''}
              onChange={this.updateEditorMilestone}
            >
              <option value="">None</option>
              {[...milestones.values()].map(milestone => (
                <option value={milestone.number} key={milestone.number}>
                  {milestone.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="github-issues-controls">
          <Button onClick={this.reviewEditor}>Review changes</Button>
          <Button onClick={this.closeComposer}>Cancel</Button>
        </div>
      </section>
    )
  }

  private renderCommentComposer() {
    if (this.state.commentDraft === null || this.state.confirmation !== null) {
      return null
    }
    return (
      <section
        className="github-issue-composer"
        aria-labelledby="comment-composer-title"
      >
        <h3 id="comment-composer-title">Add a comment</h3>
        <label>
          Comment
          <textarea
            value={this.state.commentDraft}
            maxLength={65_536}
            onChange={this.updateCommentDraft}
          />
        </label>
        <div className="github-issues-controls">
          <Button onClick={this.reviewComment}>Review comment</Button>
          <Button onClick={this.closeComposer}>Cancel</Button>
        </div>
      </section>
    )
  }

  private renderConfirmation() {
    const confirmation = this.state.confirmation
    if (confirmation === null) {
      return null
    }
    const title =
      confirmation.kind === 'update'
        ? 'Review issue changes'
        : confirmation.kind === 'comment'
        ? 'Review comment'
        : confirmation.kind === 'close'
        ? 'Confirm close'
        : 'Confirm reopen'
    return (
      <section
        className="github-issue-confirmation"
        aria-labelledby="issue-confirmation-title"
      >
        <h3 id="issue-confirmation-title">{title}</h3>
        <p>
          This reviewed operation targets issue #{confirmation.issue.number} in
          the selected repository and selected account.
        </p>
        {confirmation.kind === 'update' ? (
          <dl>
            <div>
              <dt>Title</dt>
              <dd>{confirmation.update.title}</dd>
            </div>
            <div>
              <dt>Description</dt>
              <dd className="multiline">
                {confirmation.update.body || 'No description'}
              </dd>
            </div>
            <div>
              <dt>Labels</dt>
              <dd>{confirmation.update.labels.join(', ') || 'None'}</dd>
            </div>
            <div>
              <dt>Assignees</dt>
              <dd>{confirmation.update.assignees.join(', ') || 'None'}</dd>
            </div>
            <div>
              <dt>Milestone</dt>
              <dd>{confirmation.update.milestone ?? 'None'}</dd>
            </div>
          </dl>
        ) : confirmation.kind === 'comment' ? (
          <div className="github-issue-reviewed-body">{confirmation.body}</div>
        ) : (
          <p>
            This will {confirmation.kind} the issue. GitHub notifications and
            automation may run.
          </p>
        )}
        <div className="github-issues-controls">
          <Button
            className={
              confirmation.kind === 'close' ? 'destructive' : undefined
            }
            disabled={this.state.busy !== null}
            onClick={this.confirmMutation}
          >
            Confirm{' '}
            {confirmation.kind === 'update' ? 'changes' : confirmation.kind}
          </Button>
          <Button
            disabled={this.state.busy !== null}
            onClick={this.cancelConfirmation}
          >
            Back
          </Button>
        </div>
      </section>
    )
  }

  private renderComments(issue: IGitHubIssue) {
    return (
      <section
        className="github-issue-comments"
        aria-labelledby="issue-comments-title"
      >
        <div className="github-issues-panel-heading">
          <div>
            <h3 id="issue-comments-title">Comments</h3>
            <span>{issue.commentCount} reported by GitHub</span>
          </div>
          <Button
            disabled={this.state.busy !== null}
            onClick={this.retryComments}
          >
            Retry comments
          </Button>
        </div>
        {this.state.commentsError !== null && (
          <p className="github-issues-error" role="alert">
            {this.state.commentsError}
          </p>
        )}
        {this.state.comments.length === 0 ? (
          <p className="github-issues-empty-copy">No comments on this page.</p>
        ) : (
          <div className="github-issue-comment-list">
            {this.state.comments.map(comment => (
              <article key={comment.id}>
                <header>
                  <strong>{comment.authorLogin}</strong>
                  <span>{formatDate(comment.createdAt)}</span>
                </header>
                <div>{comment.body}</div>
              </article>
            ))}
          </div>
        )}
        <nav className="github-issues-pagination" aria-label="Comment pages">
          <Button
            disabled={this.state.busy !== null || this.state.commentPage <= 1}
            onClick={this.previousComments}
          >
            Previous comments
          </Button>
          <span>Page {this.state.commentPage}</span>
          <Button
            disabled={
              this.state.busy !== null || this.state.nextCommentPage === null
            }
            onClick={this.nextComments}
          >
            Next comments
          </Button>
        </nav>
        {this.state.commentsCapped && (
          <p className="github-issues-safety-note">
            Comment page safety limit reached.
          </p>
        )}
      </section>
    )
  }

  private renderDetail() {
    const issue = this.state.selectedIssue
    if (issue === null) {
      return (
        <section
          className="github-issue-detail github-issues-empty"
          role="status"
        >
          <h2>Select an issue</h2>
          <p>
            Choose one bounded result to load its validated detail and comments.
          </p>
        </section>
      )
    }
    return (
      <article
        className="github-issue-detail"
        aria-labelledby="selected-issue-title"
      >
        <header>
          <div>
            <span className={`github-issue-state ${issue.state}`}>
              {issue.state}
            </span>
            <h2 id="selected-issue-title">{issue.title}</h2>
            <p>Issue #{issue.number}</p>
          </div>
          <div className="github-issues-controls">
            <Button
              disabled={this.state.busy !== null}
              onClick={this.openProviderIssue}
            >
              Open on GitHub
            </Button>
            <Button
              disabled={this.state.busy !== null}
              onClick={this.openEditor}
            >
              Edit
            </Button>
            <Button
              disabled={this.state.busy !== null || issue.locked}
              onClick={this.openCommentComposer}
            >
              Add comment
            </Button>
            <Button
              className={issue.state === 'open' ? 'destructive' : undefined}
              disabled={this.state.busy !== null}
              onClick={this.reviewStateChange}
            >
              {issue.state === 'open' ? 'Close issue' : 'Reopen issue'}
            </Button>
          </div>
        </header>
        {this.renderMetadata(issue)}
        <section
          className="github-issue-body"
          aria-labelledby="issue-body-title"
        >
          <h3 id="issue-body-title">Description</h3>
          <div>{issue.body || 'No description provided.'}</div>
        </section>
        {issue.locked && (
          <p className="github-issues-safety-note">
            This issue is locked; new comments are disabled.
          </p>
        )}
        {this.renderEditor()}
        {this.renderCommentComposer()}
        {this.renderConfirmation()}
        {this.renderComments(issue)}
      </article>
    )
  }

  private renderStatus() {
    return (
      <div className="github-issues-status" aria-live="polite">
        {this.state.busy !== null && (
          <div className="github-issues-busy" role="status">
            <span>Working on {this.state.busy}…</span>
            <Button onClick={this.cancelOperation}>Cancel</Button>
          </div>
        )}
        {this.state.error !== null && (
          <p className="github-issues-error" role="alert">
            {this.state.error}
          </p>
        )}
        {this.state.message !== null && (
          <p className="github-issues-message" role="status">
            {this.state.message}
          </p>
        )}
      </div>
    )
  }

  public render() {
    const account = getGitHubIssuesAccount(
      this.props.repository,
      this.props.accounts
    )
    return (
      <main className="github-issues-view" aria-label="GitHub Issues">
        <header className="github-issues-header">
          <div>
            <h1>Issues</h1>
            <p>Browse and review repository issue changes inside Desktop.</p>
          </div>
          <div className="github-issues-header-actions">
            <span className="github-issues-account">
              {account === null
                ? 'Selected GitHub account'
                : `${account.login} · ${account.friendlyEndpoint}`}
            </span>
            <Button
              disabled={this.state.busy !== null}
              onClick={this.openCreate}
            >
              New issue
            </Button>
            <Button
              disabled={this.state.busy !== null}
              onClick={this.refreshIssues}
            >
              Refresh
            </Button>
            <Button
              disabled={
                this.state.availability !== 'available' ||
                this.state.metadataLoading
              }
              onClick={this.reloadMetadata}
            >
              {this.state.metadataLoading
                ? 'Loading metadata…'
                : 'Reload metadata'}
            </Button>
          </div>
        </header>
        {this.renderAvailability() ?? (
          <>
            {this.renderFilters()}
            <div className="github-issues-layout">
              {this.renderIssueList()}
              {this.renderDetail()}
            </div>
          </>
        )}
        {this.renderStatus()}
      </main>
    )
  }
}
