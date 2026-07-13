import * as React from 'react'
import {
  ActionsRunReviewState,
  IActionsPendingDeployment,
  IActionsRunReviewHistory,
  isForkRunApprovalCandidate,
} from '../../lib/actions-run-reviews'
import { getActionsRunAttempt } from '../../lib/actions-jobs'
import {
  ActionsStore,
  getActionsRepositoryKey,
} from '../../lib/stores/actions-store'
import { IAPIWorkflowRun } from '../../lib/api'
import { Repository } from '../../models/repository'
import { Button } from '../lib/button'
import { LinkButton } from '../lib/link-button'
import { ActionsConfirmationDialog } from './actions-confirmation-dialog'
import { ActionsDeploymentReviewDialog } from './actions-deployment-review-dialog'

interface IActionsRunReviewsProps {
  readonly repository: Repository
  readonly run: IAPIWorkflowRun
  readonly actionsStore: ActionsStore
}

interface IActionsRunReviewsState {
  readonly loading: boolean
  readonly pending: ReadonlyArray<IActionsPendingDeployment>
  readonly history: ReadonlyArray<IActionsRunReviewHistory>
  readonly pendingError: Error | null
  readonly historyError: Error | null
  readonly selectedEnvironmentIds: ReadonlySet<number>
  readonly decision: ActionsRunReviewState | null
  readonly forkConfirmationOpen: boolean
  readonly submitting: boolean
  readonly mutationError: Error | null
  readonly message: string | null
  readonly forkApproved: boolean
}

const initialState = (): IActionsRunReviewsState => ({
  loading: true,
  pending: [],
  history: [],
  pendingError: null,
  historyError: null,
  selectedEnvironmentIds: new Set(),
  decision: null,
  forkConfirmationOpen: false,
  submitting: false,
  mutationError: null,
  message: null,
  forkApproved: false,
})

const reviewKey = (props: IActionsRunReviewsProps) =>
  getActionsRepositoryKey(props.repository) +
  '#run:' +
  props.run.id +
  '#latest-attempt:' +
  (getActionsRunAttempt(props.run.run_attempt) ?? 'unknown')

function reviewError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function waitTimerLabel(environment: IActionsPendingDeployment): string {
  if (environment.waitTimerMinutes === 0) {
    return 'No wait timer'
  }
  const started = environment.waitTimerStartedAt?.toLocaleString()
  return (
    environment.waitTimerMinutes +
    ' minute wait' +
    (started ? ' · started ' + started : '')
  )
}

/** Run-level deployment/fork approval functions, independent of job attempts. */
export class ActionsRunReviews extends React.Component<
  IActionsRunReviewsProps,
  IActionsRunReviewsState
> {
  private mounted = false
  private controller: AbortController | null = null
  private generation = 0

  public constructor(props: IActionsRunReviewsProps) {
    super(props)
    this.state = initialState()
  }

  public componentDidMount() {
    this.mounted = true
    this.load()
  }

  public componentDidUpdate(prevProps: IActionsRunReviewsProps) {
    if (reviewKey(prevProps) !== reviewKey(this.props)) {
      this.cancelLoad()
      this.generation++
      this.setState(initialState(), this.load)
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.generation++
    this.cancelLoad()
  }

  private cancelLoad() {
    this.controller?.abort()
    this.controller = null
  }

  private load = () => {
    this.cancelLoad()
    const controller = new AbortController()
    const generation = this.generation
    const repository = this.props.repository
    const runId = this.props.run.id
    const expectedKey = reviewKey(this.props)
    this.controller = controller
    this.setState({
      loading: true,
      pendingError: null,
      historyError: null,
    })

    const pending = this.props.actionsStore
      .fetchPendingDeployments(repository, runId, controller.signal)
      .then(value => ({ value, error: null as Error | null }))
      .catch(error => ({
        value: [] as ReadonlyArray<IActionsPendingDeployment>,
        error:
          (error as Error)?.name === 'AbortError' ? null : reviewError(error),
      }))
    const history = this.props.actionsStore
      .fetchRunReviewHistory(repository, runId, controller.signal)
      .then(value => ({ value, error: null as Error | null }))
      .catch(error => ({
        value: [] as ReadonlyArray<IActionsRunReviewHistory>,
        error:
          (error as Error)?.name === 'AbortError' ? null : reviewError(error),
      }))

    void Promise.all([pending, history])
      .then(([pendingResult, historyResult]) => {
        if (
          !this.mounted ||
          this.controller !== controller ||
          this.generation !== generation ||
          reviewKey(this.props) !== expectedKey
        ) {
          return
        }
        const approvable = new Set(
          pendingResult.value
            .filter(environment => environment.currentUserCanApprove)
            .map(environment => environment.environmentId)
        )
        this.setState(state => {
          const selectedEnvironmentIds = new Set(
            [...state.selectedEnvironmentIds].filter(id => approvable.has(id))
          )
          const selectionChanged =
            selectedEnvironmentIds.size !== state.selectedEnvironmentIds.size
          return {
            loading: false,
            pending: pendingResult.value,
            history: historyResult.value,
            pendingError: pendingResult.error,
            historyError: historyResult.error,
            selectedEnvironmentIds,
            decision: selectionChanged ? null : state.decision,
            mutationError: selectionChanged ? null : state.mutationError,
          }
        })
      })
      .finally(() => {
        if (this.controller === controller) {
          this.controller = null
        }
      })
  }

  private toggleEnvironment = (environmentId: number) => () => {
    if (
      this.state.submitting ||
      !this.state.pending.some(
        environment =>
          environment.environmentId === environmentId &&
          environment.currentUserCanApprove
      )
    ) {
      return
    }
    const selectedEnvironmentIds = new Set(this.state.selectedEnvironmentIds)
    if (selectedEnvironmentIds.has(environmentId)) {
      selectedEnvironmentIds.delete(environmentId)
    } else {
      selectedEnvironmentIds.add(environmentId)
    }
    this.setState({ selectedEnvironmentIds, mutationError: null })
  }

  private requestDecision = (decision: ActionsRunReviewState) => () =>
    this.setState({
      decision,
      forkConfirmationOpen: false,
      mutationError: null,
    })

  private closeDecision = () => {
    if (!this.state.submitting) {
      this.setState({ decision: null, mutationError: null })
    }
  }

  private selectedEnvironments(): ReadonlyArray<IActionsPendingDeployment> {
    return this.state.pending.filter(
      environment =>
        environment.currentUserCanApprove &&
        this.state.selectedEnvironmentIds.has(environment.environmentId)
    )
  }

  private confirmDecision = async (comment: string) => {
    const decision = this.state.decision
    const environments = this.selectedEnvironments()
    if (
      decision === null ||
      environments.length === 0 ||
      this.state.submitting
    ) {
      return
    }
    const generation = this.generation
    const repository = this.props.repository
    const runId = this.props.run.id
    const expectedKey = reviewKey(this.props)
    this.setState({ submitting: true, mutationError: null, message: null })
    try {
      await this.props.actionsStore.reviewPendingDeployments(
        repository,
        runId,
        environments.map(environment => environment.environmentId),
        decision,
        comment
      )
      if (
        this.mounted &&
        this.generation === generation &&
        reviewKey(this.props) === expectedKey
      ) {
        this.setState(
          {
            submitting: false,
            decision: null,
            selectedEnvironmentIds: new Set(),
            message:
              decision === 'approved'
                ? 'Selected deployments approved.'
                : 'Selected deployments rejected.',
          },
          this.load
        )
      }
    } catch (error) {
      if (
        this.mounted &&
        this.generation === generation &&
        reviewKey(this.props) === expectedKey
      ) {
        this.setState({
          submitting: false,
          mutationError: reviewError(error),
        })
      }
    }
  }

  private requestForkApproval = () =>
    this.setState({
      decision: null,
      forkConfirmationOpen: true,
      mutationError: null,
    })

  private closeForkApproval = () => {
    if (!this.state.submitting) {
      this.setState({ forkConfirmationOpen: false, mutationError: null })
    }
  }

  private confirmForkApproval = async () => {
    if (this.state.submitting) {
      return
    }
    const generation = this.generation
    const repository = this.props.repository
    const runId = this.props.run.id
    const expectedKey = reviewKey(this.props)
    this.setState({ submitting: true, mutationError: null, message: null })
    try {
      await this.props.actionsStore.approveForkRun(repository, runId)
      if (
        this.mounted &&
        this.generation === generation &&
        reviewKey(this.props) === expectedKey
      ) {
        this.setState({
          submitting: false,
          forkConfirmationOpen: false,
          forkApproved: true,
          message: 'Fork workflow run approved.',
        })
      }
    } catch (error) {
      if (
        this.mounted &&
        this.generation === generation &&
        reviewKey(this.props) === expectedKey
      ) {
        this.setState({
          submitting: false,
          mutationError: reviewError(error),
        })
      }
    }
  }

  private renderEnvironment = (environment: IActionsPendingDeployment) => {
    const selected = this.state.selectedEnvironmentIds.has(
      environment.environmentId
    )
    return (
      <article
        className="actions-pending-environment"
        key={environment.environmentId}
      >
        <label>
          <input
            type="checkbox"
            checked={selected}
            disabled={
              !environment.currentUserCanApprove || this.state.submitting
            }
            onChange={this.toggleEnvironment(environment.environmentId)}
          />
          <span>
            <strong>{environment.environmentName}</strong>
            <small>{waitTimerLabel(environment)}</small>
          </span>
        </label>
        <div className="actions-pending-environment-meta">
          <LinkButton
            uri={environment.environmentUrl}
            ariaLabel={`Open ${environment.environmentName} on GitHub`}
          >
            GitHub
          </LinkButton>
          {!environment.currentUserCanApprove && (
            <span>The selected account cannot review this environment.</span>
          )}
        </div>
        {environment.reviewers.length > 0 && (
          <ul className="actions-pending-reviewers">
            {environment.reviewers.map(reviewer => (
              <li key={reviewer.type + ':' + reviewer.id}>
                {reviewer.avatarUrl && <img src={reviewer.avatarUrl} alt="" />}
                <LinkButton uri={reviewer.htmlUrl}>{reviewer.name}</LinkButton>
                <small>{reviewer.type}</small>
              </li>
            ))}
          </ul>
        )}
      </article>
    )
  }

  private renderHistory = (review: IActionsRunReviewHistory, index: number) => (
    <li key={review.user.id + ':' + review.state + ':' + index}>
      <span className={'actions-status-chip ' + review.state}>
        {review.state}
      </span>
      <span>
        <strong>{review.user.name}</strong>
        {' · '}
        {review.environments.map(environment => environment.name).join(', ')}
      </span>
      {review.comment && <p>{review.comment}</p>}
    </li>
  )

  public render() {
    const selected = this.selectedEnvironments()
    const forkEligible =
      isForkRunApprovalCandidate(this.props.run) && !this.state.forkApproved
    return (
      <section className="actions-run-reviews" aria-label="Run approvals">
        <header className="actions-run-reviews-header">
          <div>
            <span className="eyebrow">Current run</span>
            <h3>Pending deployment environments</h3>
          </div>
          <Button
            size="small"
            onClick={this.load}
            disabled={this.state.loading || this.state.submitting}
          >
            {this.state.loading ? 'Loading…' : 'Refresh approvals'}
          </Button>
        </header>
        {this.state.message && (
          <div className="actions-artifact-message" role="status">
            {this.state.message}
          </div>
        )}
        {this.state.pendingError && (
          <div className="actions-inline-error" role="alert">
            {this.state.pendingError.message}
          </div>
        )}
        {!this.state.loading &&
          !this.state.pendingError &&
          this.state.pending.length === 0 && (
            <div className="actions-empty">No deployments await review.</div>
          )}
        {this.state.pending.length > 0 && (
          <div className="actions-pending-environment-grid">
            {this.state.pending.map(this.renderEnvironment)}
          </div>
        )}
        {this.state.pending.some(item => item.currentUserCanApprove) && (
          <div className="actions-deployment-review-actions">
            <span>
              {selected.length} selected of {this.state.pending.length} pending.
            </span>
            <div>
              <Button
                size="small"
                className="button-component-primary"
                disabled={selected.length === 0 || this.state.submitting}
                onClick={this.requestDecision('approved')}
              >
                Approve selected
              </Button>
              <Button
                size="small"
                disabled={selected.length === 0 || this.state.submitting}
                onClick={this.requestDecision('rejected')}
              >
                Reject selected
              </Button>
            </div>
          </div>
        )}
        {forkEligible && (
          <div className="actions-fork-approval">
            <div>
              <strong>First-time contributor fork run</strong>
              <span>
                Review the proposed workflow changes before allowing untrusted
                fork code to run.
              </span>
            </div>
            <Button
              size="small"
              disabled={this.state.submitting}
              onClick={this.requestForkApproval}
            >
              Review fork approval
            </Button>
          </div>
        )}
        {this.state.historyError && (
          <div className="actions-inline-error" role="alert">
            {this.state.historyError.message}
          </div>
        )}
        {this.state.history.length > 0 && (
          <details className="actions-review-history">
            <summary>
              Deployment review history ({this.state.history.length})
            </summary>
            <ol>{this.state.history.map(this.renderHistory)}</ol>
          </details>
        )}
        {this.state.decision && (
          <ActionsDeploymentReviewDialog
            key={this.state.decision}
            decision={this.state.decision}
            environments={selected}
            submitting={this.state.submitting}
            error={this.state.mutationError}
            onConfirm={this.confirmDecision}
            onDismissed={this.closeDecision}
          />
        )}
        {this.state.forkConfirmationOpen && (
          <ActionsConfirmationDialog
            eyebrow="Untrusted fork review"
            title="Approve fork workflow run?"
            description={
              <p>
                Approve run #{this.props.run.run_number ?? this.props.run.id}{' '}
                only after reviewing changes from this first-time contributor,
                especially workflow files.
              </p>
            }
            confirmLabel="Approve fork run"
            confirmClassName="button-component-primary"
            submitting={this.state.submitting}
            error={this.state.mutationError}
            onConfirm={this.confirmForkApproval}
            onDismissed={this.closeForkApproval}
          />
        )}
      </section>
    )
  }
}
