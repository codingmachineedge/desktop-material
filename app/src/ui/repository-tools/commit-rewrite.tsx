import * as React from 'react'

import {
  abortStructuredCommitRewrite,
  continueStructuredCommitRewrite,
  createStructuredCommitRewritePlan,
  executeStructuredCommitRewrite,
  inspectStructuredCommitRewrite,
  IStructuredCommitRewriteInspection,
  IStructuredCommitRewritePlanItem,
  RebaseResult,
  StructuredCommitRewriteAction,
  StructuredCommitRewriteError,
  validateStructuredCommitRewritePlan,
} from '../../lib/git'
import { Repository } from '../../models/repository'
import { shortenSHA } from '../../models/commit'
import { Button } from '../lib/button'

type CommitRewritePhase =
  | 'idle'
  | 'loading'
  | 'planning'
  | 'confirming'
  | 'running'
  | 'continuing'
  | 'aborting'
  | 'refreshing'
  | 'conflict'
  | 'completed'
  | 'failed'

export interface IRepositoryCommitRewriteClient {
  readonly inspect: (
    repository: Repository
  ) => Promise<IStructuredCommitRewriteInspection>
  readonly execute: (
    repository: Repository,
    inspection: IStructuredCommitRewriteInspection,
    plan: ReadonlyArray<IStructuredCommitRewritePlanItem>
  ) => Promise<RebaseResult>
  readonly continue: (repository: Repository) => Promise<RebaseResult>
  readonly abort: (repository: Repository) => Promise<void>
}

const defaultClient: IRepositoryCommitRewriteClient = {
  inspect: inspectStructuredCommitRewrite,
  execute: executeStructuredCommitRewrite,
  continue: continueStructuredCommitRewrite,
  abort: abortStructuredCommitRewrite,
}

export interface IRepositoryCommitRewriteProps {
  readonly repository: Repository
  readonly disabled: boolean
  readonly onRefreshRepository: () => Promise<void>
  readonly onBusyChanged: (busy: boolean) => void
  readonly client?: IRepositoryCommitRewriteClient
}

interface IRepositoryCommitRewriteState {
  readonly phase: CommitRewritePhase
  readonly inspection: IStructuredCommitRewriteInspection | null
  readonly plan: ReadonlyArray<IStructuredCommitRewritePlanItem>
  readonly status: string
  readonly error: string | null
}

function initialState(): IRepositoryCommitRewriteState {
  return {
    phase: 'idle',
    inspection: null,
    plan: [],
    status: 'Review the current branch before building a rewrite plan.',
    error: null,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Unable to complete the structured commit rewrite.'
}

export class RepositoryCommitRewrite extends React.Component<
  IRepositoryCommitRewriteProps,
  IRepositoryCommitRewriteState
> {
  private mounted = false
  private generation = 0
  private confirmButton: HTMLButtonElement | null = null
  private readonly actionHandlers = new Map<
    string,
    (event: React.FormEvent<HTMLSelectElement>) => void
  >()

  public constructor(props: IRepositoryCommitRewriteProps) {
    super(props)
    this.state = initialState()
  }

  private get client() {
    return this.props.client ?? defaultClient
  }

  public componentDidMount() {
    this.mounted = true
  }

  public componentDidUpdate(prevProps: IRepositoryCommitRewriteProps) {
    if (
      prevProps.repository.path === this.props.repository.path &&
      prevProps.client === this.props.client
    ) {
      return
    }
    this.generation++
    this.actionHandlers.clear()
    prevProps.onBusyChanged(false)
    this.setState(initialState())
  }

  public componentWillUnmount() {
    this.mounted = false
    this.generation++
  }

  private isCurrent(repository: Repository, generation: number) {
    return (
      this.mounted &&
      this.props.repository.path === repository.path &&
      this.generation === generation
    )
  }

  private setBusy(busy: boolean) {
    this.props.onBusyChanged(busy)
  }

  private onInspect = () => {
    if (this.props.disabled || this.state.phase === 'loading') {
      return
    }
    const repository = this.props.repository
    const generation = this.generation
    this.setBusy(true)
    this.setState({
      phase: 'loading',
      inspection: null,
      plan: [],
      status: 'Inspecting the bounded local-only commit range…',
      error: null,
    })
    void this.client
      .inspect(repository)
      .then(inspection => {
        if (!this.isCurrent(repository, generation)) {
          return
        }
        this.actionHandlers.clear()
        this.setState({
          phase: 'planning',
          inspection,
          plan: createStructuredCommitRewritePlan(inspection),
          status: `Review ${inspection.commits.length} local-only commits in oldest-first order.`,
          error: null,
        })
      })
      .catch(error => {
        if (!this.isCurrent(repository, generation)) {
          return
        }
        const recoveryAvailable =
          error instanceof StructuredCommitRewriteError &&
          error.code === 'rebase-in-progress'
        if (!recoveryAvailable) {
          this.setBusy(false)
        }
        this.setState({
          phase: recoveryAvailable ? 'conflict' : 'failed',
          inspection: null,
          plan: [],
          status: recoveryAvailable
            ? 'A rebase is waiting for conflict recovery.'
            : 'Commit review unavailable.',
          error: errorMessage(error),
        })
      })
  }

  private onCancelPlan = () => {
    if (
      this.state.phase !== 'planning' &&
      this.state.phase !== 'confirming' &&
      this.state.phase !== 'failed' &&
      this.state.phase !== 'completed'
    ) {
      return
    }
    this.setBusy(false)
    this.setState(initialState())
  }

  private onCancelInspection = () => {
    if (this.state.phase !== 'loading') {
      return
    }
    this.generation++
    this.setBusy(false)
    this.setState(initialState())
  }

  private onActionChanged = (
    sha: string,
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const action = event.currentTarget.value as StructuredCommitRewriteAction
    this.setState(state => ({
      plan: state.plan.map(item =>
        item.sha === sha ? { ...item, action } : item
      ),
      error: null,
    }))
  }

  private getActionHandler(sha: string) {
    let handler = this.actionHandlers.get(sha)
    if (handler === undefined) {
      handler = event => this.onActionChanged(sha, event)
      this.actionHandlers.set(sha, handler)
    }
    return handler
  }

  private moveCommit(sha: string, offset: -1 | 1) {
    this.setState(state => {
      const from = state.plan.findIndex(item => item.sha === sha)
      const to = from + offset
      if (from < 0 || to < 0 || to >= state.plan.length) {
        return null
      }
      const plan = [...state.plan]
      const [item] = plan.splice(from, 1)
      plan.splice(to, 0, item)
      return { plan, error: null }
    })
  }

  private moveUp = (sha: string) => () => this.moveCommit(sha, -1)
  private moveDown = (sha: string) => () => this.moveCommit(sha, 1)

  private canFold(index: number) {
    return this.state.plan.slice(0, index).some(item => item.action === 'pick')
  }

  private onReviewPlan = () => {
    const { inspection, plan } = this.state
    if (inspection === null || this.state.phase !== 'planning') {
      return
    }
    try {
      validateStructuredCommitRewritePlan(inspection, plan)
      this.setState({ phase: 'confirming', error: null }, () =>
        this.confirmButton?.focus()
      )
    } catch (error) {
      this.setState({ error: errorMessage(error) })
    }
  }

  private onBackToPlan = () => {
    if (this.state.phase === 'confirming') {
      this.setState({ phase: 'planning', error: null })
    }
  }

  private onConfirmButtonRef = (button: HTMLButtonElement | null) => {
    this.confirmButton = button
  }

  private onExecute = () => {
    const { inspection, plan } = this.state
    if (inspection === null || this.state.phase !== 'confirming') {
      return
    }
    const repository = this.props.repository
    const generation = this.generation
    this.setState({
      phase: 'running',
      status: 'Applying the confirmed structured rewrite…',
      error: null,
    })
    void this.client
      .execute(repository, inspection, plan)
      .then(result => this.handleRebaseResult(repository, generation, result))
      .catch(error => {
        if (!this.isCurrent(repository, generation)) {
          return
        }
        this.setBusy(false)
        this.setState({
          phase: 'failed',
          status: 'Commit rewrite failed before completion.',
          error: errorMessage(error),
        })
      })
  }

  private onContinue = () => {
    if (this.state.phase !== 'conflict') {
      return
    }
    const repository = this.props.repository
    const generation = this.generation
    this.setState({
      phase: 'continuing',
      status: 'Continuing the rewrite after conflict resolution…',
      error: null,
    })
    void this.client
      .continue(repository)
      .then(result => this.handleRebaseResult(repository, generation, result))
      .catch(error => {
        if (!this.isCurrent(repository, generation)) {
          return
        }
        this.setState({
          phase: 'conflict',
          status: 'The rewrite still needs conflict recovery.',
          error: errorMessage(error),
        })
      })
  }

  private onAbort = () => {
    if (this.state.phase !== 'conflict') {
      return
    }
    const repository = this.props.repository
    const generation = this.generation
    this.setState({
      phase: 'aborting',
      status: 'Aborting the rebase and restoring its original tip…',
      error: null,
    })
    void this.client
      .abort(repository)
      .then(async () => {
        if (!this.isCurrent(repository, generation)) {
          return
        }
        await this.refreshAfterSuccess(
          repository,
          generation,
          'Rewrite aborted; the original branch tip and worktree were restored.'
        )
      })
      .catch(error => {
        if (!this.isCurrent(repository, generation)) {
          return
        }
        this.setState({
          phase: 'conflict',
          status: 'The rewrite could not be aborted.',
          error: errorMessage(error),
        })
      })
  }

  private async handleRebaseResult(
    repository: Repository,
    generation: number,
    result: RebaseResult
  ) {
    if (!this.isCurrent(repository, generation)) {
      return
    }
    if (result === RebaseResult.ConflictsEncountered) {
      this.setState({
        phase: 'conflict',
        status:
          'Resolve the conflicted files in Changes, then continue or abort.',
        error: null,
      })
      return
    }
    if (result === RebaseResult.OutstandingFilesNotStaged) {
      this.setState({
        phase: 'conflict',
        status: 'The rewrite still has unresolved tracked files.',
        error: 'Resolve every tracked conflict before continuing.',
      })
      return
    }
    if (
      result === RebaseResult.CompletedWithoutError ||
      result === RebaseResult.AlreadyUpToDate
    ) {
      await this.refreshAfterSuccess(
        repository,
        generation,
        'Structured commit rewrite completed.'
      )
      return
    }

    this.setBusy(false)
    this.setState({
      phase: 'failed',
      status: 'Commit rewrite did not complete.',
      error: 'Git could not complete the reviewed rewrite plan.',
    })
  }

  private async refreshAfterSuccess(
    repository: Repository,
    generation: number,
    message: string
  ) {
    this.setState({
      phase: 'refreshing',
      status: 'Refreshing repository state…',
    })
    try {
      await this.props.onRefreshRepository()
      if (!this.isCurrent(repository, generation)) {
        return
      }
      this.setBusy(false)
      this.setState({
        phase: 'completed',
        inspection: null,
        plan: [],
        status: message,
        error: null,
      })
    } catch (error) {
      if (!this.isCurrent(repository, generation)) {
        return
      }
      this.setBusy(false)
      this.setState({
        phase: 'failed',
        status: 'The Git operation completed, but repository refresh failed.',
        error: errorMessage(error),
      })
    }
  }

  private renderPlan() {
    const inspection = this.state.inspection
    if (inspection === null || this.state.phase !== 'planning') {
      return null
    }
    const commits = new Map(
      inspection.commits.map(commit => [commit.sha, commit] as const)
    )
    return (
      <div className="repository-commit-rewrite-plan">
        <div className="repository-commit-rewrite-snapshot">
          <span>
            Branch <strong>{inspection.branchName}</strong>
          </span>
          <span>
            Upstream <strong>{inspection.upstreamName}</strong>
          </span>
          <span>
            Range {shortenSHA(inspection.baseSha)}…
            {shortenSHA(inspection.headSha)}
          </span>
        </div>
        <ol aria-label="Ordered local commit rewrite plan">
          {this.state.plan.map((item, index) => {
            const commit = commits.get(item.sha)
            if (commit === undefined) {
              return null
            }
            return (
              <li key={item.sha}>
                <div className="repository-commit-rewrite-identity">
                  <code>{shortenSHA(item.sha)}</code>
                  <span>{commit.summary}</span>
                </div>
                <div className="repository-commit-rewrite-row-controls">
                  <label>
                    <span className="sr-only">
                      Action for {commit.summary} ({shortenSHA(item.sha)})
                    </span>
                    <select
                      aria-label={`Action for ${commit.summary} (${shortenSHA(
                        item.sha
                      )})`}
                      value={item.action}
                      onChange={this.getActionHandler(item.sha)}
                    >
                      <option value="pick">Keep as commit</option>
                      <option value="fixup" disabled={!this.canFold(index)}>
                        Fold into previous (keep previous title)
                      </option>
                      <option value="drop">Drop commit</option>
                    </select>
                  </label>
                  <Button
                    ariaLabel={`Move ${commit.summary} (${shortenSHA(
                      item.sha
                    )}) earlier`}
                    disabled={index === 0}
                    onClick={this.moveUp(item.sha)}
                  >
                    Move up
                  </Button>
                  <Button
                    ariaLabel={`Move ${commit.summary} (${shortenSHA(
                      item.sha
                    )}) later`}
                    disabled={index === this.state.plan.length - 1}
                    onClick={this.moveDown(item.sha)}
                  >
                    Move down
                  </Button>
                </div>
              </li>
            )
          })}
        </ol>
        <div className="repository-tool-controls">
          <Button
            className="repository-tool-write-button"
            onClick={this.onReviewPlan}
          >
            Review final plan
          </Button>
          <Button onClick={this.onCancelPlan}>Cancel plan</Button>
        </div>
      </div>
    )
  }

  private renderConfirmation() {
    const { inspection, plan } = this.state
    if (inspection === null || this.state.phase !== 'confirming') {
      return null
    }
    const commits = new Map(
      inspection.commits.map(commit => [commit.sha, commit] as const)
    )
    const kept = plan.filter(item => item.action === 'pick').length
    const folded = plan.filter(item => item.action === 'fixup').length
    const dropped = plan.filter(item => item.action === 'drop').length
    return (
      <div
        className="repository-commit-rewrite-confirmation"
        role="alertdialog"
        aria-labelledby="repository-commit-rewrite-confirm-title"
        aria-describedby="repository-commit-rewrite-confirm-description"
      >
        <strong id="repository-commit-rewrite-confirm-title">
          Rewrite {plan.length} local commits on {inspection.branchName}?
        </strong>
        <p id="repository-commit-rewrite-confirm-description">
          This replaces local commit IDs. A previously published branch will
          need a force push. Git revalidates this exact branch, upstream, tip,
          and ordered commit set before it starts.
        </p>
        <dl>
          <div>
            <dt>Outcome</dt>
            <dd>
              {kept} kept, {folded} folded, {dropped} dropped
            </dd>
          </div>
          <div>
            <dt>Reviewed tip</dt>
            <dd>{shortenSHA(inspection.headSha)}</dd>
          </div>
        </dl>
        <ol aria-label="Confirmed commit rewrite order">
          {plan.map(item => (
            <li key={item.sha}>
              <strong>{item.action === 'fixup' ? 'fold' : item.action}</strong>{' '}
              <code>{shortenSHA(item.sha)}</code>{' '}
              <span>{commits.get(item.sha)?.summary}</span>
            </li>
          ))}
        </ol>
        <div className="repository-tool-controls">
          <Button
            className="repository-tool-confirm-button"
            onButtonRef={this.onConfirmButtonRef}
            onClick={this.onExecute}
          >
            Confirm and rewrite commits
          </Button>
          <Button onClick={this.onBackToPlan}>Back to plan</Button>
        </div>
      </div>
    )
  }

  private renderConflictRecovery() {
    if (
      this.state.phase !== 'conflict' &&
      this.state.phase !== 'continuing' &&
      this.state.phase !== 'aborting'
    ) {
      return null
    }
    const running =
      this.state.phase === 'continuing' || this.state.phase === 'aborting'
    return (
      <div
        className="repository-commit-rewrite-recovery"
        role="region"
        aria-label="Commit rewrite conflict recovery"
      >
        <strong>Rewrite paused for conflicts</strong>
        <p>
          Resolve every conflicted tracked file in Changes. Then continue the
          reviewed rewrite, or abort to restore the original branch tip and
          worktree.
        </p>
        <div className="repository-tool-controls">
          <Button disabled={running} onClick={this.onContinue}>
            Continue rewrite
          </Button>
          <Button disabled={running} onClick={this.onAbort}>
            Abort and restore
          </Button>
        </div>
      </div>
    )
  }

  public render() {
    const operationRunning = [
      'loading',
      'running',
      'continuing',
      'aborting',
      'refreshing',
    ].includes(this.state.phase)
    return (
      <section
        className="repository-tools-category repository-commit-rewrite"
        aria-labelledby="repository-commit-rewrite-title"
      >
        <h2 id="repository-commit-rewrite-title">Rewrite local commits</h2>
        <article className="repository-tool-card repository-commit-rewrite-card">
          <div>
            <h3>Build a structured, reviewable plan</h3>
            <p>
              Inspect at most 50 linear commits ahead of the configured
              upstream. Reorder them, fold changes while keeping the previous
              title, or drop a commit. No author email, commit body, raw
              command, argument list, or editor is exposed.
            </p>
          </div>
          {(this.state.phase === 'idle' ||
            this.state.phase === 'failed' ||
            this.state.phase === 'completed') && (
            <Button
              disabled={this.props.disabled || operationRunning}
              onClick={this.onInspect}
            >
              Review local commits
            </Button>
          )}
          {this.state.phase === 'loading' && (
            <Button onClick={this.onCancelInspection}>Cancel review</Button>
          )}
          {this.renderPlan()}
          {this.renderConfirmation()}
          {this.renderConflictRecovery()}
          <div
            className="repository-commit-rewrite-status"
            role="status"
            aria-live="polite"
          >
            {this.state.status}
          </div>
          {this.state.error !== null && (
            <p className="repository-tools-error" role="alert">
              {this.state.error}
            </p>
          )}
        </article>
      </section>
    )
  }
}
