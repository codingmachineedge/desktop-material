import * as React from 'react'
import type { Disposable } from 'event-kit'

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
import {
  GitHubPullRequestDiffSide,
  GitHubPullRequestPendingCommentMaximumItems,
  IGitHubPullRequestPendingInlineComment,
  IGitHubPullRequestPendingReply,
  IGitHubPullRequestReviewComment,
  IGitHubPullRequestWorkspace,
  normalizeGitHubPullRequestPendingInlineComment,
  normalizeGitHubPullRequestPendingReply,
} from '../../lib/github-pull-request-workspace'
import { ICombinedRefCheck, IRefCheck } from '../../lib/ci-checks/ci-checks'
import { Account, getAccountKey } from '../../models/account'
import { GitHubRepository } from '../../models/github-repository'
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
import { CICheckRunList } from '../check-runs/ci-check-run-list'
import { getLabelForCheck } from '../branches/ci-status'

type LifecycleMode =
  | 'details'
  | 'confirm-update'
  | 'confirm-review'
  | 'confirm-state'
  | 'confirm-merge'
  | 'merged'
type LifecycleOperation = 'load' | 'update' | 'review' | 'state' | 'merge'
type LifecycleTab = 'overview' | 'files' | 'commits' | 'conversation' | 'checks'

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
  readonly workspace: IGitHubPullRequestWorkspace | null
  readonly activeTab: LifecycleTab
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
  readonly inlinePath: string
  readonly inlineLine: string
  readonly inlineSide: GitHubPullRequestDiffSide
  readonly inlineBody: string
  readonly pendingInlineComments: ReadonlyArray<IGitHubPullRequestPendingInlineComment>
  readonly replyTargetId: number | null
  readonly replyBody: string
  readonly pendingReplies: ReadonlyArray<IGitHubPullRequestPendingReply>
  readonly stateTarget: 'open' | 'closed'
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

interface IPullRequestChecksProps {
  readonly dispatcher: Dispatcher
  readonly repository: GitHubRepository
  readonly headSHA: string
}

interface IPullRequestChecksState {
  readonly check: ICombinedRefCheck | null
}

class PullRequestChecks extends React.PureComponent<
  IPullRequestChecksProps,
  IPullRequestChecksState
> {
  private subscription: Disposable | null = null

  public constructor(props: IPullRequestChecksProps) {
    super(props)
    this.state = {
      check: props.dispatcher.tryGetCommitStatus(
        props.repository,
        props.headSHA
      ),
    }
  }

  public componentDidMount() {
    this.subscribe()
  }

  public componentDidUpdate(prevProps: IPullRequestChecksProps) {
    if (
      prevProps.repository !== this.props.repository ||
      prevProps.headSHA !== this.props.headSHA
    ) {
      this.setState({
        check: this.props.dispatcher.tryGetCommitStatus(
          this.props.repository,
          this.props.headSHA
        ),
      })
      this.subscribe()
    }
  }

  public componentWillUnmount() {
    this.subscription?.dispose()
    this.subscription = null
  }

  private subscribe() {
    this.subscription?.dispose()
    this.subscription = this.props.dispatcher.subscribeToCommitStatus(
      this.props.repository,
      this.props.headSHA,
      this.onStatus
    )
  }

  private onStatus = (check: ICombinedRefCheck | null) => {
    this.setState({ check })
  }

  private viewCheck = (check: IRefCheck) => {
    if (check.htmlUrl !== null) {
      void this.props.dispatcher.openInBrowser(check.htmlUrl)
    }
  }

  public render() {
    const check = this.state.check
    if (check === null || check.checks.length === 0) {
      return (
        <p className="github-pull-request-lifecycle-note" role="status">
          No check results are available for this head commit yet.
        </p>
      )
    }
    return (
      <div className="github-pull-request-lifecycle-checks">
        <p>
          <strong>{getLabelForCheck(check)}</strong> · {check.checks.length}{' '}
          {check.checks.length === 1 ? 'check' : 'checks'} for head{' '}
          {this.props.headSHA.slice(0, 12)}
        </p>
        <CICheckRunList
          checkRuns={check.checks}
          isCondensedView={true}
          onViewCheckDetails={this.viewCheck}
        />
      </div>
    )
  }
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
      workspace: null,
      activeTab: 'overview',
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
      inlinePath: '',
      inlineLine: '',
      inlineSide: 'RIGHT',
      inlineBody: '',
      pendingInlineComments: [],
      replyTargetId: null,
      replyBody: '',
      pendingReplies: [],
      stateTarget: 'closed',
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
    if (operation === 'load') {
      this.setState({
        busy: operation,
        error: null,
        notice: null,
        warnings: [],
        snapshot: null,
        workspace: null,
        pendingInlineComments: [],
        pendingReplies: [],
        replyTargetId: null,
        replyBody: '',
      })
    } else {
      this.setState({
        busy: operation,
        error: null,
        notice: null,
        warnings: [],
      })
    }
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

  private applySnapshot(
    snapshot: IGitHubPullRequestLifecycle,
    workspace: IGitHubPullRequestWorkspace
  ) {
    this.setState({
      snapshot,
      workspace,
      mode: 'details',
      busy: null,
      title: snapshot.title,
      body: snapshot.body,
      base: snapshot.base,
      reviewers: snapshot.metadata.reviewers.join(', '),
      assignees: snapshot.metadata.assignees.join(', '),
      labels: snapshot.metadata.labels.join(', '),
      inlinePath: workspace.files[0]?.path ?? '',
      mergeConfirmation: '',
    })
  }

  private failClosedAfterSuccessfulMutation(
    notice: string,
    warnings: ReadonlyArray<string>,
    clearReview: boolean = false
  ) {
    this.setState({
      snapshot: null,
      workspace: null,
      mode: 'details',
      busy: null,
      notice,
      warnings: [
        ...warnings,
        'The change succeeded, but the latest review workspace could not be loaded. Refresh before continuing.',
      ],
    })
    if (clearReview) {
      this.setState({
        reviewBody: '',
        pendingInlineComments: [],
        pendingReplies: [],
        replyTargetId: null,
        replyBody: '',
      })
    }
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
      const workspace =
        await this.props.dispatcher.inspectGitHubPullRequestWorkspace(
          this.props.repository,
          this.props.pullRequest,
          account,
          snapshot.headSHA,
          request.signal
        )
      if (this.isCurrent(request, generation)) {
        this.applySnapshot(snapshot, workspace)
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
      let workspace: IGitHubPullRequestWorkspace
      try {
        workspace =
          await this.props.dispatcher.inspectGitHubPullRequestWorkspace(
            this.props.repository,
            this.props.pullRequest,
            account,
            receipt.pullRequest.headSHA,
            request.signal
          )
      } catch {
        if (this.isCurrent(request, generation)) {
          this.failClosedAfterSuccessfulMutation(
            'Pull request details updated.',
            receipt.warnings
          )
        }
        return
      }
      if (this.isCurrent(request, generation)) {
        this.applySnapshot(receipt.pullRequest, workspace)
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

  private prepareStateChange = () => {
    const snapshot = this.state.snapshot
    if (snapshot === null || snapshot.merged || !this.context.isTopMost) {
      return
    }
    this.setState({
      mode: 'confirm-state',
      stateTarget: snapshot.state === 'open' ? 'closed' : 'open',
      error: null,
      notice: null,
    })
  }

  private changeState = async () => {
    const account = this.getAccount()
    const snapshot = this.state.snapshot
    if (account === null || snapshot === null || !this.context.isTopMost) {
      return
    }
    const { request, generation } = this.begin('state')
    try {
      const receipt = await this.props.dispatcher.setGitHubPullRequestState(
        this.props.repository,
        this.props.pullRequest,
        account,
        snapshot.headSHA,
        this.state.stateTarget,
        request.signal
      )
      let workspace: IGitHubPullRequestWorkspace
      try {
        workspace =
          await this.props.dispatcher.inspectGitHubPullRequestWorkspace(
            this.props.repository,
            this.props.pullRequest,
            account,
            receipt.pullRequest.headSHA,
            request.signal
          )
      } catch {
        if (this.isCurrent(request, generation)) {
          this.failClosedAfterSuccessfulMutation(
            receipt.pullRequest.state === 'open'
              ? 'Pull request reopened.'
              : 'Pull request closed.',
            receipt.warnings
          )
        }
        return
      }
      if (this.isCurrent(request, generation)) {
        this.applySnapshot(receipt.pullRequest, workspace)
        this.setState({
          notice:
            receipt.pullRequest.state === 'open'
              ? 'Pull request reopened.'
              : 'Pull request closed.',
          warnings: receipt.warnings,
        })
      }
    } catch (error) {
      if (this.isCurrent(request, generation)) {
        this.setState({
          mode: 'details',
          busy: null,
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
        this.state.reviewBody,
        this.state.pendingInlineComments,
        this.state.pendingReplies
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
      this.state.reviewBody,
      this.state.pendingInlineComments,
      this.state.pendingReplies
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
      let refreshed: IGitHubPullRequestLifecycle
      let workspace: IGitHubPullRequestWorkspace
      try {
        refreshed = await this.props.dispatcher.inspectGitHubPullRequest(
          this.props.repository,
          this.props.pullRequest,
          account,
          request.signal
        )
        workspace =
          await this.props.dispatcher.inspectGitHubPullRequestWorkspace(
            this.props.repository,
            this.props.pullRequest,
            account,
            refreshed.headSHA,
            request.signal
          )
      } catch {
        if (this.isCurrent(request, generation)) {
          this.failClosedAfterSuccessfulMutation(
            `Review #${
              receipt.id
            } submitted as ${receipt.state.toLowerCase()}.`,
            receipt.warnings ?? [],
            true
          )
        }
        return
      }
      if (this.isCurrent(request, generation)) {
        this.applySnapshot(refreshed, workspace)
        this.setState({
          reviewBody: '',
          pendingInlineComments: [],
          pendingReplies: [],
          replyTargetId: null,
          replyBody: '',
          notice: `Review #${
            receipt.id
          } submitted as ${receipt.state.toLowerCase()}.`,
          warnings: receipt.warnings ?? [],
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
        snapshot: null,
        workspace: null,
        pendingInlineComments: [],
        pendingReplies: [],
        replyTargetId: null,
        replyBody: '',
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
    this.setState(
      {
        accountKey: event.currentTarget.value,
        workspace: null,
        pendingInlineComments: [],
        pendingReplies: [],
        replyTargetId: null,
        replyBody: '',
      },
      () => {
        void this.load()
      }
    )
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
  private onInlinePathChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({ inlinePath: event.currentTarget.value, error: null })
  private onInlineLineChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ inlineLine: event.currentTarget.value, error: null })
  private onInlineSideChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({
      inlineSide: event.currentTarget.value as GitHubPullRequestDiffSide,
      error: null,
    })
  private onInlineBodyChanged = (event: React.FormEvent<HTMLTextAreaElement>) =>
    this.setState({ inlineBody: event.currentTarget.value, error: null })
  private onReplyBodyChanged = (event: React.FormEvent<HTMLTextAreaElement>) =>
    this.setState({ replyBody: event.currentTarget.value, error: null })
  private onMergeMethodChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({
      mergeMethod: event.currentTarget.value as GitHubPullRequestMergeMethod,
      error: null,
    })
  private onMergeConfirmationChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => this.setState({ mergeConfirmation: event.currentTarget.value })
  private backToDetails = () => this.setState({ mode: 'details', error: null })
  private setActiveTab = (activeTab: LifecycleTab) =>
    this.setState({ activeTab, error: null })

  private queueInlineComment = () => {
    const workspace = this.state.workspace
    try {
      if (
        workspace === null ||
        !workspace.files.some(file => file.path === this.state.inlinePath)
      ) {
        throw new Error('Refresh the file list before queuing this comment.')
      }
      if (
        this.state.pendingInlineComments.length +
          this.state.pendingReplies.length >=
        GitHubPullRequestPendingCommentMaximumItems
      ) {
        throw new Error(
          `Queue no more than ${GitHubPullRequestPendingCommentMaximumItems} inline comments and replies per review.`
        )
      }
      const comment = normalizeGitHubPullRequestPendingInlineComment({
        path: this.state.inlinePath,
        line: Number(this.state.inlineLine),
        side: this.state.inlineSide,
        body: this.state.inlineBody,
      })
      this.setState({
        pendingInlineComments: [...this.state.pendingInlineComments, comment],
        inlineLine: '',
        inlineBody: '',
        notice: `Inline comment queued for ${comment.path}:${comment.line}.`,
        error: null,
      })
    } catch (error) {
      this.setState({
        error:
          error instanceof Error
            ? error.message
            : 'Review this inline comment.',
      })
    }
  }

  private removeInlineComment = (index: number) => {
    this.setState({
      pendingInlineComments: this.state.pendingInlineComments.filter(
        (_, candidate) => candidate !== index
      ),
      notice: null,
    })
  }

  private onRemoveInlineComment = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    this.removeInlineComment(Number(event.currentTarget.dataset.index))
  }

  private chooseReply = (comment: IGitHubPullRequestReviewComment) => {
    this.setState({
      activeTab: 'conversation',
      replyTargetId: comment.id,
      replyBody: '',
      error: null,
    })
  }

  private onChooseReply = (event: React.MouseEvent<HTMLButtonElement>) => {
    const id = Number(event.currentTarget.dataset.commentId)
    const comment = this.state.workspace?.reviewComments.find(
      candidate => candidate.id === id
    )
    if (comment !== undefined) {
      this.chooseReply(comment)
    }
  }

  private queueReply = () => {
    const workspace = this.state.workspace
    const targetId = this.state.replyTargetId
    try {
      if (
        workspace === null ||
        targetId === null ||
        !workspace.reviewComments.some(comment => comment.id === targetId)
      ) {
        throw new Error('Choose a current review comment before replying.')
      }
      if (
        this.state.pendingInlineComments.length +
          this.state.pendingReplies.length >=
        GitHubPullRequestPendingCommentMaximumItems
      ) {
        throw new Error(
          `Queue no more than ${GitHubPullRequestPendingCommentMaximumItems} inline comments and replies per review.`
        )
      }
      const reply = normalizeGitHubPullRequestPendingReply({
        inReplyToId: targetId,
        body: this.state.replyBody,
      })
      this.setState({
        pendingReplies: [...this.state.pendingReplies, reply],
        replyTargetId: null,
        replyBody: '',
        notice: `Reply to comment #${targetId} queued.`,
        error: null,
      })
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : 'Review this reply.',
      })
    }
  }

  private removeReply = (index: number) => {
    this.setState({
      pendingReplies: this.state.pendingReplies.filter(
        (_, candidate) => candidate !== index
      ),
      notice: null,
    })
  }

  private onRemoveReply = (event: React.MouseEvent<HTMLButtonElement>) => {
    this.removeReply(Number(event.currentTarget.dataset.index))
  }

  private onTabSelected = (event: React.MouseEvent<HTMLButtonElement>) => {
    this.setActiveTab(event.currentTarget.dataset.tab as LifecycleTab)
  }

  private onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const tabs: ReadonlyArray<LifecycleTab> = [
      'overview',
      'files',
      'commits',
      'conversation',
      'checks',
    ]
    const current = tabs.indexOf(
      event.currentTarget.dataset.tab as LifecycleTab
    )
    let next = current
    if (event.key === 'ArrowRight') {
      next = (current + 1) % tabs.length
    } else if (event.key === 'ArrowLeft') {
      next = (current - 1 + tabs.length) % tabs.length
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = tabs.length - 1
    } else {
      return
    }
    event.preventDefault()
    const activeTab = tabs[next]
    this.setState({ activeTab, error: null }, () => {
      document.getElementById(`pull-request-${activeTab}-tab`)?.focus()
    })
  }
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

  private renderOverview(
    snapshot: IGitHubPullRequestLifecycle,
    canMutate: boolean,
    canMerge: boolean
  ) {
    const accounts = getEligibleAccounts(
      this.props.accounts,
      this.props.pullRequest
    )
    return (
      <>
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
            ready-for-review and convert-to-draft remain on GitHub because this
            bounded REST lifecycle does not expose those GraphQL mutations.
          </p>
          <Button
            type="button"
            disabled={!canMutate}
            onClick={this.prepareUpdate}
          >
            Review updates
          </Button>
        </section>
        <section aria-labelledby="pull-request-state-heading">
          <h2 id="pull-request-state-heading">Lifecycle</h2>
          <p>
            {snapshot.state === 'open'
              ? 'Closing preserves the pull request and allows it to be reopened later.'
              : 'Reopening restores review and merge actions against the same head.'}
          </p>
          <Button
            type="button"
            disabled={snapshot.merged}
            onClick={this.prepareStateChange}
          >
            {snapshot.state === 'open'
              ? 'Close pull request'
              : 'Reopen pull request'}
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
      </>
    )
  }

  private renderFiles(
    workspace: IGitHubPullRequestWorkspace,
    canMutate: boolean
  ) {
    return (
      <>
        <section aria-labelledby="pull-request-files-heading">
          <h2 id="pull-request-files-heading">Changed files</h2>
          <p>
            {workspace.files.length}{' '}
            {workspace.files.length === 1 ? 'file' : 'files'} loaded for this
            exact head.
          </p>
          {workspace.files.length === 0 ? (
            <p>No changed files were returned.</p>
          ) : (
            <ol className="github-pull-request-lifecycle-file-list">
              {workspace.files.map(file => (
                <li key={`${file.path}:${file.sha}`}>
                  <article>
                    <header>
                      <strong>{file.path}</strong>
                      <span>
                        {file.status} · +{file.additions} −{file.deletions}
                      </span>
                    </header>
                    {file.previousPath !== null && (
                      <p>Renamed from {file.previousPath}</p>
                    )}
                    {file.patch === null ? (
                      <p className="github-pull-request-lifecycle-note">
                        GitHub did not provide a text patch for this file.
                      </p>
                    ) : (
                      <pre role="region" aria-label={`Patch for ${file.path}`}>
                        {file.patch}
                      </pre>
                    )}
                  </article>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section aria-labelledby="pull-request-inline-comment-heading">
          <h2 id="pull-request-inline-comment-heading">
            Queue an inline comment
          </h2>
          <p>
            Choose a line shown by the current GitHub patch. GitHub validates
            the final line and side when the review is submitted.
          </p>
          <div className="github-pull-request-lifecycle-grid">
            <label className="github-pull-request-lifecycle-field github-pull-request-lifecycle-wide">
              <span>File</span>
              <select
                aria-label="Inline comment file"
                value={this.state.inlinePath}
                disabled={!canMutate || workspace.files.length === 0}
                onChange={this.onInlinePathChanged}
              >
                {workspace.files.map(file => (
                  <option key={file.path} value={file.path}>
                    {file.path}
                  </option>
                ))}
              </select>
            </label>
            <label className="github-pull-request-lifecycle-field">
              <span>Line</span>
              <input
                type="number"
                min="1"
                step="1"
                aria-label="Inline comment line"
                value={this.state.inlineLine}
                disabled={!canMutate}
                onChange={this.onInlineLineChanged}
              />
            </label>
            <label className="github-pull-request-lifecycle-field">
              <span>Side</span>
              <select
                aria-label="Inline comment side"
                value={this.state.inlineSide}
                disabled={!canMutate}
                onChange={this.onInlineSideChanged}
              >
                <option value="RIGHT">New version</option>
                <option value="LEFT">Old version</option>
              </select>
            </label>
          </div>
          <label className="github-pull-request-lifecycle-field">
            <span>Comment</span>
            <textarea
              rows={3}
              aria-label="Inline review comment"
              value={this.state.inlineBody}
              disabled={!canMutate}
              onChange={this.onInlineBodyChanged}
            />
          </label>
          <Button
            type="button"
            disabled={!canMutate || workspace.files.length === 0}
            onClick={this.queueInlineComment}
          >
            Queue inline comment
          </Button>
        </section>
      </>
    )
  }

  private renderCommits(workspace: IGitHubPullRequestWorkspace) {
    return (
      <section aria-labelledby="pull-request-commits-heading">
        <h2 id="pull-request-commits-heading">Commits</h2>
        {workspace.commits.length === 0 ? (
          <p>No commits were returned for this pull request.</p>
        ) : (
          <ol className="github-pull-request-lifecycle-commit-list">
            {workspace.commits.map(commit => (
              <li key={commit.sha}>
                <strong>{commit.message.split('\n', 1)[0]}</strong>
                <span>
                  {commit.sha.slice(0, 12)} ·{' '}
                  {commit.authorLogin ?? commit.authorName ?? 'Unknown author'}
                  {commit.authoredAt === null ? '' : ` · ${commit.authoredAt}`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    )
  }

  private renderPendingReviewQueue() {
    if (
      this.state.pendingInlineComments.length === 0 &&
      this.state.pendingReplies.length === 0
    ) {
      return null
    }
    return (
      <section aria-labelledby="pull-request-pending-review-heading">
        <h2 id="pull-request-pending-review-heading">Pending review queue</h2>
        <ul className="github-pull-request-lifecycle-pending-list">
          {this.state.pendingInlineComments.map((comment, index) => (
            <li key={`inline:${index}:${comment.path}:${comment.line}`}>
              <span>
                Inline · {comment.path}:{comment.line} ({comment.side}) ·{' '}
                {comment.body}
              </span>
              <button
                type="button"
                className="button-component"
                data-index={index}
                onClick={this.onRemoveInlineComment}
              >
                Remove inline comment {index + 1}
              </button>
            </li>
          ))}
          {this.state.pendingReplies.map((reply, index) => (
            <li key={`reply:${index}:${reply.inReplyToId}`}>
              <span>
                Reply to #{reply.inReplyToId} · {reply.body}
              </span>
              <button
                type="button"
                className="button-component"
                data-index={index}
                onClick={this.onRemoveReply}
              >
                Remove reply {index + 1}
              </button>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  private renderConversation(
    workspace: IGitHubPullRequestWorkspace,
    canMutate: boolean
  ) {
    const timeline = [
      ...workspace.reviews.map(review => ({
        key: `review:${review.id}`,
        time: review.submittedAt ?? '',
        content: (
          <article>
            <header>
              <strong>{review.author}</strong>
              <span>{review.state.replace('_', ' ')}</span>
            </header>
            <p>{review.body || 'No review message'}</p>
            <small>{review.submittedAt ?? 'Pending review'}</small>
          </article>
        ),
      })),
      ...workspace.issueComments.map(comment => ({
        key: `issue:${comment.id}`,
        time: comment.createdAt,
        content: (
          <article>
            <header>
              <strong>{comment.author}</strong>
              <span>Conversation comment</span>
            </header>
            <p>{comment.body}</p>
            <small>{comment.createdAt}</small>
          </article>
        ),
      })),
      ...workspace.reviewComments.map(comment => ({
        key: `inline:${comment.id}`,
        time: comment.createdAt,
        content: (
          <article>
            <header>
              <strong>{comment.author}</strong>
              <span>
                {comment.inReplyToId === null
                  ? 'Inline comment'
                  : `Reply to #${comment.inReplyToId}`}
              </span>
            </header>
            <p>
              {comment.path}
              {comment.line === null ? '' : `:${comment.line}`} · {comment.body}
            </p>
            {comment.diffHunk !== '' && (
              <pre
                role="region"
                aria-label={`Diff context for comment ${comment.id}`}
              >
                {comment.diffHunk}
              </pre>
            )}
            <footer>
              <small>{comment.createdAt}</small>
              <button
                type="button"
                className="button-component"
                disabled={!canMutate}
                data-comment-id={comment.id}
                onClick={this.onChooseReply}
              >
                Reply to comment {comment.id}
              </button>
            </footer>
          </article>
        ),
      })),
    ].sort((left, right) => {
      const timeDifference = Date.parse(left.time) - Date.parse(right.time)
      return (
        (Number.isFinite(timeDifference) ? timeDifference : 0) ||
        left.key.localeCompare(right.key)
      )
    })

    return (
      <>
        <section aria-labelledby="pull-request-conversation-heading">
          <h2 id="pull-request-conversation-heading">Review timeline</h2>
          {timeline.length === 0 ? (
            <p>No review conversation has been posted yet.</p>
          ) : (
            <ol className="github-pull-request-lifecycle-timeline">
              {timeline.map(item => (
                <li key={item.key}>{item.content}</li>
              ))}
            </ol>
          )}
        </section>
        {this.state.replyTargetId !== null && (
          <section aria-labelledby="pull-request-reply-heading">
            <h2 id="pull-request-reply-heading">
              Queue reply to comment #{this.state.replyTargetId}
            </h2>
            <label className="github-pull-request-lifecycle-field">
              <span>Reply</span>
              <textarea
                rows={3}
                aria-label={`Reply to review comment ${this.state.replyTargetId}`}
                value={this.state.replyBody}
                onChange={this.onReplyBodyChanged}
              />
            </label>
            <Button type="button" onClick={this.queueReply}>
              Queue reply
            </Button>
          </section>
        )}
        {this.renderPendingReviewQueue()}
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
              <span>Top-level review comment</span>
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
      </>
    )
  }

  private renderDetails(snapshot: IGitHubPullRequestLifecycle) {
    const workspace = this.state.workspace
    if (workspace === null || workspace.headSHA !== snapshot.headSHA) {
      return this.renderBusy('load')
    }
    const canMutate = snapshot.state === 'open' && !snapshot.merged
    const canMerge =
      canMutate && !snapshot.draft && snapshot.mergeable !== false
    const conversationCount =
      workspace.reviews.length +
      workspace.issueComments.length +
      workspace.reviewComments.length
    const tabs: ReadonlyArray<{
      readonly id: LifecycleTab
      readonly label: string
    }> = [
      { id: 'overview', label: 'Overview' },
      { id: 'files', label: `Files (${workspace.files.length})` },
      { id: 'commits', label: `Commits (${workspace.commits.length})` },
      { id: 'conversation', label: `Conversation (${conversationCount})` },
      { id: 'checks', label: 'Checks' },
    ]
    const tabContent =
      this.state.activeTab === 'overview' ? (
        this.renderOverview(snapshot, canMutate, canMerge)
      ) : this.state.activeTab === 'files' ? (
        this.renderFiles(workspace, canMutate)
      ) : this.state.activeTab === 'commits' ? (
        this.renderCommits(workspace)
      ) : this.state.activeTab === 'conversation' ? (
        this.renderConversation(workspace, canMutate)
      ) : (
        <section aria-labelledby="pull-request-checks-heading">
          <h2 id="pull-request-checks-heading">Checks</h2>
          <PullRequestChecks
            dispatcher={this.props.dispatcher}
            repository={this.props.pullRequest.base.gitHubRepository}
            headSHA={snapshot.headSHA}
          />
        </section>
      )
    const cappedKinds = Object.entries(workspace.capped)
      .filter(([, capped]) => capped)
      .map(([kind]) => kind.replace(/([A-Z])/g, ' $1').toLowerCase())
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
              {workspace.files.length} files · {workspace.commits.length}{' '}
              commits · {conversationCount} conversation items
            </span>
            <span>
              Merge status: {snapshot.mergeableState}
              {snapshot.mergeable === null ? ' (computing)' : ''}
            </span>
            {cappedKinds.length > 0 && (
              <span role="status">
                Safety limit reached for {cappedKinds.join(', ')}. Open on
                GitHub for the remaining items.
              </span>
            )}
          </section>
          <div
            className="github-pull-request-lifecycle-tabs"
            role="tablist"
            aria-label="Pull request workspace"
          >
            {tabs.map(tab => (
              <button
                key={tab.id}
                id={`pull-request-${tab.id}-tab`}
                type="button"
                role="tab"
                aria-selected={this.state.activeTab === tab.id}
                aria-controls={`pull-request-${tab.id}-panel`}
                tabIndex={this.state.activeTab === tab.id ? 0 : -1}
                data-tab={tab.id}
                onClick={this.onTabSelected}
                onKeyDown={this.onTabKeyDown}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {tabs.map(tab => (
            <div
              key={tab.id}
              id={`pull-request-${tab.id}-panel`}
              className="github-pull-request-lifecycle-tab-panel"
              role="tabpanel"
              aria-labelledby={`pull-request-${tab.id}-tab`}
              tabIndex={this.state.activeTab === tab.id ? 0 : -1}
              hidden={this.state.activeTab !== tab.id}
            >
              {this.state.activeTab === tab.id ? tabContent : null}
            </div>
          ))}
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
              <span>
                {this.state.pendingInlineComments.length} inline comments ·{' '}
                {this.state.pendingReplies.length} replies queued
              </span>
              {this.state.pendingReplies.length > 0 && (
                <p>
                  The review is submitted first. If a later reply fails, the
                  successful review is preserved and the failed reply is
                  reported without automatic retry.
                </p>
              )}
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
    if (this.state.mode === 'confirm-state') {
      const action = this.state.stateTarget === 'open' ? 'reopen' : 'close'
      return (
        <>
          <DialogContent className="github-pull-request-lifecycle-content">
            <section className="github-pull-request-lifecycle-confirmation">
              <h2>Confirm {action}</h2>
              <p>
                {action === 'close'
                  ? 'This preserves the pull request and its conversation. It can be reopened later.'
                  : 'This restores review and merge actions against the inspected head.'}
              </p>
              <span>Head {snapshot.headSHA.slice(0, 12)}</span>
            </section>
          </DialogContent>
          <DialogFooter>
            <div className="button-group">
              <Button type="button" onClick={this.backToDetails}>
                Back
              </Button>
              <Button type="button" onClick={this.changeState}>
                {action === 'close'
                  ? 'Close pull request'
                  : 'Reopen pull request'}
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
        {this.state.warnings.map((warning, index) => (
          <DialogError key={`${index}:${warning}`}>{warning}</DialogError>
        ))}
        {content}
      </Dialog>
    )
  }
}
