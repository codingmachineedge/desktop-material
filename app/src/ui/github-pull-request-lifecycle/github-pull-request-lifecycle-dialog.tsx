import * as React from 'react'

import { getAccountForRepository } from '../../lib/get-account-for-repository'
import {
  getGitHubPullRequestLifecycleError,
  GitHubPullRequestMergeMethod,
  GitHubPullRequestReviewEvent,
  IGitHubPullRequestLifecycle,
  normalizeGitHubPullRequestMetadata,
  normalizeGitHubPullRequestReview,
  normalizeGitHubPullRequestUpdate,
  parseGitHubPullRequestMetadataField,
} from '../../lib/github-pull-request'
import { Account, getAccountKey } from '../../models/account'
import { PullRequest } from '../../models/pull-request'
import { RepositoryWithGitHubRepository } from '../../models/repository'
import {
  Dialog,
  DialogContent,
  DialogError,
  DialogFooter,
  DialogStackContext,
} from '../dialog'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'

type LifecycleMode =
  | 'details'
  | 'confirm-update'
  | 'confirm-review'
  | 'confirm-merge'
  | 'merged'
type LifecycleOperation = 'load' | 'update' | 'review' | 'merge'

interface IGitHubPullRequestLifecycleDialogProps {
  readonly repository: RepositoryWithGitHubRepository
  readonly pullRequest: PullRequest
  readonly baseBranchNames: ReadonlyArray<string>
  readonly accounts: ReadonlyArray<Account>
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
}

interface IGitHubPullRequestLifecycleDialogState {
  readonly accountKey: string
  readonly snapshot: IGitHubPullRequestLifecycle | null
  readonly mode: LifecycleMode
  readonly busy: LifecycleOperation | null
  readonly error: string | null
  readonly notice: string | null
  readonly warnings: ReadonlyArray<string>
  readonly title: string
  readonly body: string
  readonly base: string
  readonly reviewers: string
  readonly assignees: string
  readonly labels: string
  readonly reviewEvent: GitHubPullRequestReviewEvent
  readonly reviewBody: string
  readonly mergeMethod: GitHubPullRequestMergeMethod
  readonly mergeConfirmation: string
}

function getEligibleAccounts(
  accounts: ReadonlyArray<Account>,
  pullRequest: PullRequest
): ReadonlyArray<Account> {
  const endpoint = pullRequest.base.gitHubRepository.endpoint
  return accounts.filter(
    account =>
      account.provider === 'github' &&
      account.token.length > 0 &&
      account.endpoint === endpoint
  )
}

function getInitialAccountKey(
  repository: RepositoryWithGitHubRepository,
  pullRequest: PullRequest,
  accounts: ReadonlyArray<Account>
): string {
  const eligible = getEligibleAccounts(accounts, pullRequest)
  const preferred = getAccountForRepository(accounts, repository)
  const account =
    preferred !== null && eligible.includes(preferred) ? preferred : eligible[0]
  return account === undefined ? '' : getAccountKey(account)
}

export class GitHubPullRequestLifecycleDialog extends React.Component<
  IGitHubPullRequestLifecycleDialogProps,
  IGitHubPullRequestLifecycleDialogState
> {
  public static contextType = DialogStackContext
  public declare context: React.ContextType<typeof DialogStackContext>

  private request: AbortController | null = null
  private generation = 0
  private mounted = false

  public constructor(props: IGitHubPullRequestLifecycleDialogProps) {
    super(props)
    this.state = {
      accountKey: getInitialAccountKey(
        props.repository,
        props.pullRequest,
        props.accounts
      ),
      snapshot: null,
      mode: 'details',
      busy: null,
      error: null,
      notice: null,
      warnings: [],
      title: props.pullRequest.title,
      body: props.pullRequest.body,
      base: props.pullRequest.base.ref,
      reviewers: '',
      assignees: '',
      labels: '',
      reviewEvent: 'COMMENT',
      reviewBody: '',
      mergeMethod: 'merge',
      mergeConfirmation: '',
    }
  }

  public componentDidMount() {
    this.mounted = true
    void this.load()
  }

  public componentWillUnmount() {
    this.mounted = false
    this.generation++
    this.request?.abort()
  }

  private getAccount(): Account | null {
    return (
      getEligibleAccounts(this.props.accounts, this.props.pullRequest).find(
        account => getAccountKey(account) === this.state.accountKey
      ) ?? null
    )
  }

  private begin(operation: LifecycleOperation): {
    readonly request: AbortController
    readonly generation: number
  } {
    this.request?.abort()
    const request = new AbortController()
    const generation = ++this.generation
    this.request = request
    this.setState({ busy: operation, error: null, notice: null, warnings: [] })
    return { request, generation }
  }

  private finish(request: AbortController) {
    if (this.request === request) {
      this.request = null
    }
  }

  private isCurrent(request: AbortController, generation: number): boolean {
    return (
      this.mounted && this.request === request && this.generation === generation
    )
  }

  private applySnapshot(snapshot: IGitHubPullRequestLifecycle) {
    this.setState({
      snapshot,
      mode: 'details',
      busy: null,
      title: snapshot.title,
      body: snapshot.body,
      base: snapshot.base,
      reviewers: snapshot.metadata.reviewers.join(', '),
      assignees: snapshot.metadata.assignees.join(', '),
      labels: snapshot.metadata.labels.join(', '),
      mergeConfirmation: '',
    })
  }

  private load = async () => {
    if (!this.context.isTopMost) {
      return
    }
    const account = this.getAccount()
    if (account === null) {
      this.setState({
        busy: null,
        error:
          'Sign in to a matching GitHub account to manage this pull request.',
      })
      return
    }
    const { request, generation } = this.begin('load')
    try {
      const snapshot = await this.props.dispatcher.inspectGitHubPullRequest(
        this.props.repository,
        this.props.pullRequest,
        account,
        request.signal
      )
      if (this.isCurrent(request, generation)) {
        this.applySnapshot(snapshot)
      }
    } catch (error) {
      if (this.isCurrent(request, generation)) {
        this.setState({
          busy: null,
          error: getGitHubPullRequestLifecycleError(error, 'load'),
        })
      }
    } finally {
      this.finish(request)
    }
  }

  private getUpdate() {
    return normalizeGitHubPullRequestUpdate(
      this.state.title,
      this.state.body,
      this.state.base,
      normalizeGitHubPullRequestMetadata(
        parseGitHubPullRequestMetadataField(this.state.reviewers),
        parseGitHubPullRequestMetadataField(this.state.assignees),
        parseGitHubPullRequestMetadataField(this.state.labels)
      )
    )
  }

  private prepareUpdate = () => {
    if (!this.context.isTopMost) {
      return
    }
    try {
      this.getUpdate()
      this.setState({ mode: 'confirm-update', error: null, notice: null })
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : 'Review the pull request update.',
      })
    }
  }

  private update = async () => {
    const account = this.getAccount()
    const snapshot = this.state.snapshot
    if (account === null || snapshot === null || !this.context.isTopMost) {
      return
    }
    const reviewed = this.getUpdate()
    const { request, generation } = this.begin('update')
    try {
      const receipt = await this.props.dispatcher.updateGitHubPullRequest(
        this.props.repository,
        this.props.pullRequest,
        account,
        snapshot.headSHA,
        reviewed,
        request.signal
      )
      if (this.isCurrent(request, generation)) {
        this.applySnapshot(receipt.pullRequest)
        this.setState({
          notice: 'Pull request details updated.',
          warnings: receipt.warnings,
        })
      }
    } catch (error) {
      if (this.isCurrent(request, generation)) {
        this.setState({
          busy: null,
          mode: 'details',
          error: getGitHubPullRequestLifecycleError(error, 'update'),
        })
      }
    } finally {
      this.finish(request)
    }
  }

  private prepareReview = () => {
    if (!this.context.isTopMost) {
      return
    }
    try {
      normalizeGitHubPullRequestReview(
        this.state.reviewEvent,
        this.state.reviewBody
      )
      this.setState({ mode: 'confirm-review', error: null, notice: null })
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : 'Review this decision.',
      })
    }
  }

  private submitReview = async () => {
    const account = this.getAccount()
    const snapshot = this.state.snapshot
    if (account === null || snapshot === null || !this.context.isTopMost) {
      return
    }
    const review = normalizeGitHubPullRequestReview(
      this.state.reviewEvent,
      this.state.reviewBody
    )
    const { request, generation } = this.begin('review')
    try {
      const receipt = await this.props.dispatcher.submitGitHubPullRequestReview(
        this.props.repository,
        this.props.pullRequest,
        account,
        snapshot.headSHA,
        review,
        request.signal
      )
      if (this.isCurrent(request, generation)) {
        this.setState({
          mode: 'details',
          busy: null,
          reviewBody: '',
          notice: `Review #${
            receipt.id
          } submitted as ${receipt.state.toLowerCase()}.`,
        })
      }
    } catch (error) {
      if (this.isCurrent(request, generation)) {
        this.setState({
          mode: 'details',
          busy: null,
          error: getGitHubPullRequestLifecycleError(error, 'review'),
        })
      }
    } finally {
      this.finish(request)
    }
  }

  private prepareMerge = () => {
    if (this.context.isTopMost) {
      this.setState({
        mode: 'confirm-merge',
        mergeConfirmation: '',
        error: null,
        notice: null,
      })
    }
  }

  private merge = async () => {
    const account = this.getAccount()
    const snapshot = this.state.snapshot
    const required = `#${this.props.pullRequest.pullRequestNumber}`
    if (
      account === null ||
      snapshot === null ||
      this.state.mergeConfirmation !== required ||
      !this.context.isTopMost
    ) {
      return
    }
    const { request, generation } = this.begin('merge')
    try {
      const receipt = await this.props.dispatcher.mergeGitHubPullRequest(
        this.props.repository,
        this.props.pullRequest,
        account,
        snapshot.headSHA,
        this.state.mergeMethod,
        request.signal
      )
      if (this.isCurrent(request, generation)) {
        this.setState({
          mode: 'merged',
          busy: null,
          notice: `${receipt.message} Commit ${receipt.sha.slice(0, 12)}.`,
        })
      }
    } catch (error) {
      if (this.isCurrent(request, generation)) {
        this.setState({
          mode: 'details',
          busy: null,
          error: getGitHubPullRequestLifecycleError(error, 'merge'),
        })
      }
    } finally {
      this.finish(request)
    }
  }

  private cancelRequest = () => {
    if (this.context.isTopMost && this.request !== null) {
      this.generation++
      this.request.abort()
      this.request = null
      this.setState({
        busy: null,
        mode: 'details',
        error:
          'The request was canceled. Refresh this pull request before retrying.',
      })
    }
  }

  private onDismissed = () => {
    if (this.state.busy === null) {
      this.props.onDismissed()
    }
  }

  private onSubmit = () => {}

  private onAccountChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    this.setState({ accountKey: event.currentTarget.value }, () => {
      void this.load()
    })
  }

  private onTitleChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ title: event.currentTarget.value, error: null })
  private onBodyChanged = (event: React.FormEvent<HTMLTextAreaElement>) =>
    this.setState({ body: event.currentTarget.value, error: null })
  private onBaseChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({ base: event.currentTarget.value, error: null })
  private onReviewersChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ reviewers: event.currentTarget.value, error: null })
  private onAssigneesChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ assignees: event.currentTarget.value, error: null })
  private onLabelsChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ labels: event.currentTarget.value, error: null })
  private onReviewEventChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({
      reviewEvent: event.currentTarget.value as GitHubPullRequestReviewEvent,
      error: null,
    })
  private onReviewBodyChanged = (event: React.FormEvent<HTMLTextAreaElement>) =>
    this.setState({ reviewBody: event.currentTarget.value, error: null })
  private onMergeMethodChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({
      mergeMethod: event.currentTarget.value as GitHubPullRequestMergeMethod,
      error: null,
    })
  private onMergeConfirmationChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => this.setState({ mergeConfirmation: event.currentTarget.value })
  private backToDetails = () => this.setState({ mode: 'details', error: null })
  private openInBrowser = () => {
    const url = this.state.snapshot?.url
    if (url !== undefined) {
      void this.props.dispatcher.openInBrowser(url)
    }
  }

  private renderBusy(operation: LifecycleOperation) {
    return (
      <>
        <DialogContent className="github-pull-request-lifecycle-content">
          <div className="github-pull-request-lifecycle-status" role="status">
            {operation === 'load'
              ? 'Loading pull request…'
              : `${operation[0].toUpperCase()}${operation.slice(
                  1
                )} in progress…`}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button type="button" onClick={this.cancelRequest}>
            Cancel request
          </Button>
        </DialogFooter>
      </>
    )
  }

  private renderDetails(snapshot: IGitHubPullRequestLifecycle) {
    const accounts = getEligibleAccounts(
      this.props.accounts,
      this.props.pullRequest
    )
    const canMutate = snapshot.state === 'open' && !snapshot.merged
    const canMerge =
      canMutate && !snapshot.draft && snapshot.mergeable !== false
    return (
      <>
        <DialogContent className="github-pull-request-lifecycle-content">
          <section className="github-pull-request-lifecycle-summary">
            <strong>
              {this.props.pullRequest.base.gitHubRepository.fullName} #
              {snapshot.number}
            </strong>
            <span>
              {snapshot.headRepository}:{snapshot.headRef} → {snapshot.base}
            </span>
            <span>
              {snapshot.draft ? 'Draft' : 'Ready'} · {snapshot.state} · head{' '}
              {snapshot.headSHA.slice(0, 12)}
            </span>
            <span>
              Merge status: {snapshot.mergeableState}
              {snapshot.mergeable === null ? ' (computing)' : ''}
            </span>
          </section>
          <label className="github-pull-request-lifecycle-field">
            <span>Account</span>
            <select
              aria-label="Lifecycle account"
              value={this.state.accountKey}
              onChange={this.onAccountChanged}
            >
              {accounts.map(account => (
                <option
                  key={getAccountKey(account)}
                  value={getAccountKey(account)}
                >
                  {account.login} · {account.friendlyEndpoint}
                </option>
              ))}
            </select>
          </label>
          <section aria-labelledby="pull-request-details-heading">
            <h2 id="pull-request-details-heading">Details and metadata</h2>
            <div className="github-pull-request-lifecycle-grid">
              <label className="github-pull-request-lifecycle-field">
                <span>Title</span>
                <input
                  type="text"
                  value={this.state.title}
                  disabled={!canMutate}
                  aria-label="Pull request title"
                  onChange={this.onTitleChanged}
                />
              </label>
              <label className="github-pull-request-lifecycle-field">
                <span>Base branch</span>
                <select
                  value={this.state.base}
                  disabled={!canMutate}
                  aria-label="Pull request base branch"
                  onChange={this.onBaseChanged}
                >
                  {this.props.baseBranchNames.map(name => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="github-pull-request-lifecycle-field">
              <span>Description</span>
              <textarea
                value={this.state.body}
                disabled={!canMutate}
                rows={5}
                aria-label="Pull request description"
                onChange={this.onBodyChanged}
              />
            </label>
            <div
              className="github-pull-request-lifecycle-grid"
              role="group"
              aria-label="Pull request lifecycle metadata"
            >
              <label className="github-pull-request-lifecycle-field">
                <span>Requested reviewers</span>
                <input
                  type="text"
                  value={this.state.reviewers}
                  disabled={!canMutate}
                  onChange={this.onReviewersChanged}
                />
              </label>
              <label className="github-pull-request-lifecycle-field">
                <span>Assignees</span>
                <input
                  type="text"
                  value={this.state.assignees}
                  disabled={!canMutate}
                  onChange={this.onAssigneesChanged}
                />
              </label>
              <label className="github-pull-request-lifecycle-field">
                <span>Labels</span>
                <input
                  type="text"
                  value={this.state.labels}
                  disabled={!canMutate}
                  onChange={this.onLabelsChanged}
                />
              </label>
            </div>
            <p className="github-pull-request-lifecycle-note">
              Draft status is shown from GitHub. Creating a draft is supported;
              changing draft status remains on GitHub because this bounded REST
              lifecycle does not expose an undocumented mutation.
            </p>
            <Button
              type="button"
              disabled={!canMutate}
              onClick={this.prepareUpdate}
            >
              Review updates
            </Button>
          </section>
          <section aria-labelledby="pull-request-review-heading">
            <h2 id="pull-request-review-heading">Submit a review</h2>
            <div className="github-pull-request-lifecycle-grid">
              <label className="github-pull-request-lifecycle-field">
                <span>Decision</span>
                <select
                  aria-label="Review decision"
                  value={this.state.reviewEvent}
                  disabled={!canMutate}
                  onChange={this.onReviewEventChanged}
                >
                  <option value="COMMENT">Comment</option>
                  <option value="APPROVE">Approve</option>
                  <option value="REQUEST_CHANGES">Request changes</option>
                </select>
              </label>
              <label className="github-pull-request-lifecycle-field github-pull-request-lifecycle-wide">
                <span>Review comment</span>
                <textarea
                  value={this.state.reviewBody}
                  disabled={!canMutate}
                  rows={3}
                  aria-label="Review comment"
                  onChange={this.onReviewBodyChanged}
                />
              </label>
            </div>
            <Button
              type="button"
              disabled={!canMutate}
              onClick={this.prepareReview}
            >
              Review submission
            </Button>
          </section>
          <section aria-labelledby="pull-request-merge-heading">
            <h2 id="pull-request-merge-heading">Merge</h2>
            <label className="github-pull-request-lifecycle-field">
              <span>Merge method</span>
              <select
                aria-label="Merge method"
                value={this.state.mergeMethod}
                disabled={!canMerge}
                onChange={this.onMergeMethodChanged}
              >
                <option value="merge">Create a merge commit</option>
                <option value="squash">Squash and merge</option>
                <option value="rebase">Rebase and merge</option>
              </select>
            </label>
            <Button
              type="button"
              disabled={!canMerge}
              onClick={this.prepareMerge}
            >
              Prepare merge
            </Button>
          </section>
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            <Button type="button" onClick={this.load}>
              Refresh
            </Button>
            <Button type="button" onClick={this.openInBrowser}>
              Open on GitHub
            </Button>
            <Button type="button" onClick={this.onDismissed}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </>
    )
  }

  private renderConfirmation(snapshot: IGitHubPullRequestLifecycle) {
    if (this.state.mode === 'confirm-update') {
      const update = this.getUpdate()
      return (
        <>
          <DialogContent className="github-pull-request-lifecycle-content">
            <section className="github-pull-request-lifecycle-confirmation">
              <h2>Review updates</h2>
              <strong>{update.title}</strong>
              <span>
                Base: {snapshot.base} → {update.base}
              </span>
              <span>
                Reviewers: {update.metadata.reviewers.join(', ') || 'None'}
              </span>
              <span>
                Assignees: {update.metadata.assignees.join(', ') || 'None'}
              </span>
              <span>Labels: {update.metadata.labels.join(', ') || 'None'}</span>
              <p>{update.body || 'No description'}</p>
            </section>
          </DialogContent>
          <DialogFooter>
            <div className="button-group">
              <Button type="button" onClick={this.backToDetails}>
                Back
              </Button>
              <Button type="button" onClick={this.update}>
                Apply updates
              </Button>
            </div>
          </DialogFooter>
        </>
      )
    }
    if (this.state.mode === 'confirm-review') {
      return (
        <>
          <DialogContent className="github-pull-request-lifecycle-content">
            <section className="github-pull-request-lifecycle-confirmation">
              <h2>Review submission</h2>
              <strong>{this.state.reviewEvent.replace('_', ' ')}</strong>
              <p>{this.state.reviewBody || 'No review comment'}</p>
              <span>Head {snapshot.headSHA.slice(0, 12)}</span>
            </section>
          </DialogContent>
          <DialogFooter>
            <div className="button-group">
              <Button type="button" onClick={this.backToDetails}>
                Back
              </Button>
              <Button type="button" onClick={this.submitReview}>
                Submit review
              </Button>
            </div>
          </DialogFooter>
        </>
      )
    }
    const required = `#${snapshot.number}`
    return (
      <>
        <DialogContent className="github-pull-request-lifecycle-content">
          <section className="github-pull-request-lifecycle-confirmation">
            <h2>Confirm merge</h2>
            <p>
              Merge {this.props.pullRequest.base.gitHubRepository.fullName}{' '}
              {required} at head {snapshot.headSHA.slice(0, 12)} using{' '}
              {this.state.mergeMethod}.
            </p>
            <label className="github-pull-request-lifecycle-field">
              <span>Type {required} to confirm</span>
              <input
                type="text"
                value={this.state.mergeConfirmation}
                aria-label={`Type ${required} to confirm merge`}
                onChange={this.onMergeConfirmationChanged}
              />
            </label>
          </section>
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            <Button type="button" onClick={this.backToDetails}>
              Back
            </Button>
            <Button
              type="button"
              disabled={this.state.mergeConfirmation !== required}
              onClick={this.merge}
            >
              Merge pull request
            </Button>
          </div>
        </DialogFooter>
      </>
    )
  }

  public render() {
    const snapshot = this.state.snapshot
    let content: JSX.Element
    if (this.state.busy !== null) {
      content = this.renderBusy(this.state.busy)
    } else if (this.state.mode === 'merged') {
      content = (
        <>
          <DialogContent className="github-pull-request-lifecycle-content">
            <div className="github-pull-request-lifecycle-status" role="status">
              {this.state.notice ?? 'Pull request merged.'}
            </div>
          </DialogContent>
          <DialogFooter>
            <Button type="button" onClick={this.onDismissed}>
              Done
            </Button>
          </DialogFooter>
        </>
      )
    } else if (snapshot === null) {
      content = (
        <>
          <DialogContent className="github-pull-request-lifecycle-content">
            <p>Choose a matching account, then refresh this pull request.</p>
          </DialogContent>
          <DialogFooter>
            <div className="button-group">
              <Button type="button" onClick={this.load}>
                Refresh
              </Button>
              <Button type="button" onClick={this.onDismissed}>
                Close
              </Button>
            </div>
          </DialogFooter>
        </>
      )
    } else if (this.state.mode === 'details') {
      content = this.renderDetails(snapshot)
    } else {
      content = this.renderConfirmation(snapshot)
    }

    return (
      <Dialog
        id="github-pull-request-lifecycle"
        className="github-pull-request-lifecycle-dialog"
        title={`Pull request #${this.props.pullRequest.pullRequestNumber}`}
        onSubmit={this.onSubmit}
        onDismissed={this.onDismissed}
        dismissDisabled={this.state.busy !== null}
        loading={this.state.busy !== null}
      >
        {this.state.error !== null && (
          <DialogError>{this.state.error}</DialogError>
        )}
        {this.state.notice !== null && this.state.mode !== 'merged' && (
          <div className="github-pull-request-lifecycle-notice" role="status">
            {this.state.notice}
          </div>
        )}
        {this.state.warnings.map(warning => (
          <DialogError key={warning}>{warning}</DialogError>
        ))}
        {content}
      </Dialog>
    )
  }
}
