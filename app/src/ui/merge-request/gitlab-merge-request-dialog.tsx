import * as React from 'react'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
} from '../../lib/i18n'
import {
  GitLabMergeRequestContextChangedError,
  GitLabMergeRequestError,
  IGitLabMergeRequest,
  IGitLabMergeRequestApprovalState,
  IGitLabMergeRequestDraft,
  IGitLabMergeRequestMember,
  IGitLabMergeRequestMemberList,
  IGitLabMergeRequestUpdate,
} from '../../lib/gitlab-merge-request'
import {
  getGitLabMergeRequestCanonicalURL,
  IGitLabMergeRequestBranchContext,
  IGitLabMergeRequestWorkspaceRoute,
} from '../../lib/gitlab-merge-request-workspace'
import {
  GitLabMergeRequestAvailability,
  IGitLabMergeRequestMutationReview,
} from '../../lib/stores/gitlab-merge-request-store'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { Repository } from '../../models/repository'
import { Dialog, DialogContent } from '../dialog'
import { MergeRequestEditor } from './merge-request-editor'
import {
  getMergeRequestRouteKey,
  IMergeRequestApprovalIntent,
  IMergeRequestEditorContext,
  IMergeRequestEditorInitialValue,
  IMergeRequestEditorSubmission,
  IMergeRequestIdentityOption,
  MergeRequestEditorAvailability,
  MergeRequestEditorOperation,
  MergeRequestLoadError,
  MergeRequestSubmissionError,
} from './merge-request-model'
import {
  IMergeRequestLifecycleSummary,
  MergeRequestLifecycleActions,
  MergeRequestLifecycleAvailability,
  MergeRequestLifecycleOperation,
  MergeRequestLifecycleUnavailableField,
} from './merge-request-lifecycle'

export type GitLabMergeRequestDialogIntent =
  | { readonly kind: 'create' }
  | { readonly kind: 'manage'; readonly mergeRequestIID: number }

export interface IGitLabMergeRequestDialogService {
  readonly availability: (
    repository: Repository
  ) => GitLabMergeRequestAvailability
  readonly contextCurrent: () => boolean
  readonly listMembers: (
    repository: Repository,
    signal?: AbortSignal
  ) => Promise<IGitLabMergeRequestMemberList>
  readonly get: (
    repository: Repository,
    mergeRequestIID: number,
    signal?: AbortSignal
  ) => Promise<IGitLabMergeRequest>
  readonly create: (
    repository: Repository,
    draft: IGitLabMergeRequestDraft,
    signal?: AbortSignal
  ) => Promise<IGitLabMergeRequest>
  readonly createMutationReview: (
    repository: Repository,
    mergeRequest: IGitLabMergeRequest
  ) => IGitLabMergeRequestMutationReview
  readonly update: (
    repository: Repository,
    review: IGitLabMergeRequestMutationReview,
    update: IGitLabMergeRequestUpdate,
    signal?: AbortSignal
  ) => Promise<IGitLabMergeRequest>
  readonly setState: (
    repository: Repository,
    review: IGitLabMergeRequestMutationReview,
    state: 'close' | 'reopen',
    signal?: AbortSignal
  ) => Promise<IGitLabMergeRequest>
  readonly approve: (
    repository: Repository,
    review: IGitLabMergeRequestMutationReview,
    signal?: AbortSignal
  ) => Promise<IGitLabMergeRequestApprovalState>
  readonly unapprove: (
    repository: Repository,
    review: IGitLabMergeRequestMutationReview,
    signal?: AbortSignal
  ) => Promise<IGitLabMergeRequestApprovalState>
  readonly refreshPullRequests: (repository: Repository) => Promise<void>
  readonly openInBrowser: (url: string) => Promise<void>
}

export interface IGitLabMergeRequestDialogProps {
  readonly repository: Repository
  readonly route: IGitLabMergeRequestWorkspaceRoute
  readonly branchContext: IGitLabMergeRequestBranchContext
  readonly contextVersion: string
  readonly intent: GitLabMergeRequestDialogIntent
  readonly service: IGitLabMergeRequestDialogService
  readonly onDismissed: () => void
}

interface IGitLabMergeRequestDialogState {
  readonly languageMode: LanguageMode
  readonly loading: boolean
  readonly stale: boolean
  readonly loadError: MergeRequestLoadError | null
  readonly members: ReadonlyArray<IGitLabMergeRequestMember>
  readonly membersCapped: boolean
  readonly membersUnavailable: boolean
  readonly mergeRequest: IGitLabMergeRequest | null
  readonly review: IGitLabMergeRequestMutationReview | null
  readonly editorOperation: MergeRequestEditorOperation
  readonly lifecycleOperation: MergeRequestLifecycleOperation
}

const emptyMembers: IGitLabMergeRequestMemberList = {
  items: [],
  capped: false,
}

function isAbort(error: unknown): boolean {
  return (error as Error)?.name === 'AbortError'
}

function isContextError(error: unknown): boolean {
  return error instanceof GitLabMergeRequestContextChangedError
}

function availabilityError(
  availability: Exclude<GitLabMergeRequestAvailability, 'available'>
): GitLabMergeRequestError {
  return new GitLabMergeRequestError(
    availability === 'signed-out' ? 'authentication' : 'unsupported',
    'The repository-bound GitLab route is unavailable.'
  )
}

function toLoadError(error: unknown): MergeRequestLoadError {
  if (!(error instanceof GitLabMergeRequestError)) {
    return 'unknown'
  }
  if (error.kind === 'authentication') {
    return 'authentication'
  }
  if (error.kind === 'permission' || error.kind === 'not-found') {
    return 'permission'
  }
  if (error.kind === 'network' || error.kind === 'service') {
    return 'network'
  }
  if (error.kind === 'invalid-response') {
    return 'invalid-response'
  }
  return error.kind === 'unsupported' ? 'unsupported' : 'unknown'
}

function toSubmissionError(error: unknown): MergeRequestSubmissionError {
  if (isContextError(error)) {
    return 'stale'
  }
  if (!(error instanceof GitLabMergeRequestError)) {
    return 'unknown'
  }
  if (error.kind === 'network' || error.kind === 'service') {
    return 'network'
  }
  if (error.kind === 'invalid-response') {
    return 'invalid-response'
  }
  return error.kind === 'conflict' ? 'stale' : 'rejected'
}

function identity(value: {
  readonly id: number
  readonly name: string
  readonly username: string
}): IMergeRequestIdentityOption {
  return {
    id: String(value.id),
    displayName: value.name,
    username: value.username,
  }
}

function uniqueIdentities(
  values: ReadonlyArray<IMergeRequestIdentityOption>
): ReadonlyArray<IMergeRequestIdentityOption> {
  const result = new Array<IMergeRequestIdentityOption>()
  const seen = new Set<string>()
  for (const value of values) {
    if (!seen.has(value.id)) {
      seen.add(value.id)
      result.push(value)
    }
  }
  return result
}

function positiveIds(
  values: ReadonlyArray<string>
): ReadonlyArray<number> | null {
  const result = values.map(Number)
  return result.every(value => Number.isSafeInteger(value) && value > 0)
    ? result
    : null
}

function sameIds(
  left: ReadonlyArray<number>,
  right: ReadonlyArray<number>
): boolean {
  if (left.length !== right.length) {
    return false
  }
  const expected = [...left].sort((a, b) => a - b)
  const actual = [...right].sort((a, b) => a - b)
  return expected.every((value, index) => value === actual[index])
}

function branchTitle(branch: string | null): string {
  if (branch === null) {
    return ''
  }
  const value = branch.replace(/[-_]+/g, ' ').trim()
  return value.length === 0
    ? ''
    : `${value.charAt(0).toUpperCase()}${value.slice(1)}`.slice(0, 255)
}

export class GitLabMergeRequestDialog extends React.Component<
  IGitLabMergeRequestDialogProps,
  IGitLabMergeRequestDialogState
> {
  private mounted = false
  private requestGeneration = 0
  private activeController: AbortController | null = null
  private mutationInFlight = false

  public constructor(props: IGitLabMergeRequestDialogProps) {
    super(props)
    this.state = {
      languageMode: getPersistedLanguageMode(),
      loading: true,
      stale: false,
      loadError: null,
      members: [],
      membersCapped: false,
      membersUnavailable: false,
      mergeRequest: null,
      review: null,
      editorOperation: { kind: 'idle' },
      lifecycleOperation: { kind: 'idle' },
    }
  }

  public componentDidMount(): void {
    this.mounted = true
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    void this.load()
  }

  public componentWillUnmount(): void {
    this.mounted = false
    this.requestGeneration++
    this.activeController?.abort()
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public render() {
    const editing =
      this.props.intent.kind === 'manage' || this.state.mergeRequest !== null
    return (
      <Dialog
        id="gitlab-merge-request-dialog"
        title={translate(
          editing ? 'mrEditor.editTitle' : 'mrEditor.createTitle',
          this.state.languageMode
        )}
        className="gitlab-merge-request-dialog"
        onDismissed={this.props.onDismissed}
        disabled={this.state.loading || this.mutationBusy()}
        dismissDisabled={this.mutationBusy()}
        loading={this.state.loading || this.mutationBusy()}
      >
        <DialogContent>
          <MergeRequestEditor
            mode={editing ? 'edit' : 'create'}
            route={this.props.route}
            availability={this.editorAvailability()}
            initialValue={this.initialValue()}
            operation={this.state.editorOperation}
            onSubmit={this.onSubmit}
            onRefresh={this.onRefresh}
            onCancel={this.props.onDismissed}
          />
          {this.props.intent.kind === 'manage' || editing ? (
            <MergeRequestLifecycleActions
              availability={this.lifecycleAvailability()}
              operation={this.state.lifecycleOperation}
              onClose={this.onClose}
              onReopen={this.onReopen}
              onApprovalChange={this.onApprovalChange}
              onRefresh={this.onRefresh}
              onOpenCanonicalUrl={this.onOpenCanonicalURL}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    )
  }

  private editorContext(): IMergeRequestEditorContext {
    const mergeRequest = this.state.mergeRequest
    const sourceBranch =
      mergeRequest?.sourceBranch ?? this.props.branchContext.sourceBranch
    const targetBranches = [
      ...(mergeRequest === null ? [] : [mergeRequest.targetBranch]),
      ...this.props.branchContext.targetBranches,
    ]
    const members = this.state.members.map(identity)
    return {
      version: JSON.stringify([
        this.props.contextVersion,
        mergeRequest?.iid ?? null,
        mergeRequest?.headSHA ?? null,
        mergeRequest?.updatedAt ?? null,
        this.state.membersCapped,
      ]),
      route: this.props.route,
      sourceBranches: sourceBranch === null ? [] : [{ name: sourceBranch }],
      targetBranches: [...new Set(targetBranches)].map(name => ({ name })),
      reviewers: uniqueIdentities([
        ...(mergeRequest?.reviewers.map(identity) ?? []),
        ...members,
      ]),
      assignees: uniqueIdentities([
        ...(mergeRequest?.assignees.map(identity) ?? []),
        ...members,
      ]),
      detailedMergeStatus: mergeRequest?.readiness.status,
      headSha: mergeRequest?.headSHA,
    }
  }

  private editorAvailability(): MergeRequestEditorAvailability {
    const context = this.editorContext()
    if (this.state.loading) {
      return { kind: 'loading' }
    }
    if (this.state.stale || !this.props.service.contextCurrent()) {
      return { kind: 'stale', context }
    }
    if (this.state.loadError !== null) {
      return { kind: 'error', reason: this.state.loadError }
    }
    if (context.sourceBranches.length === 0) {
      return { kind: 'empty', reason: 'no-source-branches' }
    }
    if (context.targetBranches.length === 0) {
      return { kind: 'empty', reason: 'no-target-branches' }
    }
    const capped = this.state.membersCapped
      ? (['reviewers', 'assignees'] as const)
      : []
    if (this.state.membersUnavailable || capped.length > 0) {
      return {
        kind: 'partial',
        context,
        unavailable: this.state.membersUnavailable
          ? ['reviewers', 'assignees']
          : [],
        capped,
      }
    }
    return { kind: 'ready', context }
  }

  private initialValue(): IMergeRequestEditorInitialValue {
    const mergeRequest = this.state.mergeRequest
    if (mergeRequest === null) {
      return {
        sourceBranch: this.props.branchContext.sourceBranch ?? '',
        targetBranch: this.props.branchContext.initialTargetBranch ?? '',
        title: branchTitle(this.props.branchContext.sourceBranch),
      }
    }
    return {
      sourceBranch: mergeRequest.sourceBranch,
      targetBranch: mergeRequest.targetBranch,
      title: mergeRequest.title,
      body: mergeRequest.description,
      draft: mergeRequest.draft,
      reviewerIds: mergeRequest.reviewers.map(user => String(user.id)),
      assigneeIds: mergeRequest.assignees.map(user => String(user.id)),
    }
  }

  private lifecycleAvailability(): MergeRequestLifecycleAvailability {
    const mergeRequest = this.state.mergeRequest
    if (this.state.loading) {
      return { kind: 'loading' }
    }
    if (this.state.loadError !== null) {
      return { kind: 'unavailable' }
    }
    if (mergeRequest === null) {
      return { kind: 'empty' }
    }
    const summary = this.lifecycleSummary(mergeRequest)
    if (this.state.stale || !this.props.service.contextCurrent()) {
      return { kind: 'stale', summary }
    }
    const unavailable: MergeRequestLifecycleUnavailableField[] = ['pipeline']
    if (mergeRequest.approval === null) {
      unavailable.push('approval')
    }
    return { kind: 'partial', summary, unavailable }
  }

  private lifecycleSummary(
    mergeRequest: IGitLabMergeRequest
  ): IMergeRequestLifecycleSummary {
    const approval = mergeRequest.approval
    return {
      route: this.props.route,
      mergeRequestIid: mergeRequest.iid,
      headSha: mergeRequest.headSHA,
      canonicalUrl:
        getGitLabMergeRequestCanonicalURL(this.props.route, mergeRequest.iid) ??
        '',
      state: mergeRequest.state,
      draft: mergeRequest.draft,
      author: identity(mergeRequest.author),
      reviewers: mergeRequest.reviewers.map(identity),
      assignees: mergeRequest.assignees.map(identity),
      approval:
        approval === null
          ? null
          : {
              approved: approval.approved,
              approvalsRequired: approval.approvalsRequired,
              approvalsLeft: approval.approvalsLeft,
              approvedBy: approval.approvedBy.map(value =>
                identity(value.user)
              ),
              currentUserApproved: approval.approvedBy.some(
                value => value.user.id === this.props.route.accountUserId
              ),
              canApprove:
                mergeRequest.state === 'opened' &&
                !mergeRequest.draft &&
                mergeRequest.readiness.kind !== 'checking',
            },
      pipelineStatus: 'unknown',
      detailedMergeStatus: mergeRequest.readiness.status,
      updatedAt: mergeRequest.updatedAt,
    }
  }

  private load = async (): Promise<void> => {
    const generation = ++this.requestGeneration
    this.activeController?.abort()
    const controller = new AbortController()
    this.activeController = controller
    this.setState({ loading: true, loadError: null })
    try {
      const availability = this.props.service.availability(
        this.props.repository
      )
      if (availability !== 'available') {
        throw availabilityError(availability)
      }
      const membersPromise = this.props.service
        .listMembers(this.props.repository, controller.signal)
        .then(value => ({ value, unavailable: false }))
        .catch(error => {
          if (isAbort(error)) {
            throw error
          }
          return { value: emptyMembers, unavailable: true }
        })
      const mergeRequestPromise =
        this.props.intent.kind === 'manage'
          ? this.props.service.get(
              this.props.repository,
              this.props.intent.mergeRequestIID,
              controller.signal
            )
          : Promise.resolve(null)
      const [members, mergeRequest] = await Promise.all([
        membersPromise,
        mergeRequestPromise,
      ])
      if (
        !this.mounted ||
        generation !== this.requestGeneration ||
        controller.signal.aborted
      ) {
        return
      }
      if (!this.props.service.contextCurrent()) {
        this.setState({ loading: false, stale: true })
        return
      }
      this.setState({
        loading: false,
        stale: false,
        loadError: null,
        members: members.value.items,
        membersCapped: members.value.capped,
        membersUnavailable: members.unavailable,
        mergeRequest,
        review:
          mergeRequest === null
            ? null
            : this.props.service.createMutationReview(
                this.props.repository,
                mergeRequest
              ),
      })
    } catch (error) {
      if (!this.mounted || generation !== this.requestGeneration) {
        return
      }
      if (isAbort(error)) {
        this.setState({ loading: false })
      } else if (isContextError(error)) {
        this.setState({ loading: false, stale: true })
      } else {
        this.setState({ loading: false, loadError: toLoadError(error) })
      }
    } finally {
      if (this.activeController === controller) {
        this.activeController = null
      }
    }
  }

  private onRefresh = (): void => {
    if (this.mutationInFlight) {
      return
    }
    this.setState({
      editorOperation: { kind: 'idle' },
      lifecycleOperation: { kind: 'idle' },
    })
    void this.load()
  }

  private onSubmit = (submission: IMergeRequestEditorSubmission): void => {
    void this.submit(submission)
  }

  private submit = async (
    submission: IMergeRequestEditorSubmission
  ): Promise<void> => {
    const context = this.editorContext()
    if (
      this.mutationInFlight ||
      this.state.loading ||
      this.state.loadError !== null
    ) {
      return
    }
    if (
      this.state.stale ||
      !this.props.service.contextCurrent() ||
      getMergeRequestRouteKey(submission.route) !==
        getMergeRequestRouteKey(this.props.route) ||
      submission.contextVersion !== context.version
    ) {
      this.setState({
        stale: true,
        editorOperation: { kind: 'error', reason: 'stale' },
      })
      return
    }
    const reviewerIds = positiveIds(submission.reviewerIds)
    const assigneeIds = positiveIds(submission.assigneeIds)
    if (reviewerIds === null || assigneeIds === null) {
      this.setState({
        editorOperation: { kind: 'error', reason: 'rejected' },
      })
      return
    }

    this.mutationInFlight = true
    const controller = new AbortController()
    this.activeController?.abort()
    this.activeController = controller
    this.setState({ editorOperation: { kind: 'submitting' } })
    try {
      const current = this.state.mergeRequest
      let updated: IGitLabMergeRequest
      if (current === null) {
        updated = await this.props.service.create(
          this.props.repository,
          {
            sourceBranch: submission.sourceBranch,
            targetBranch: submission.targetBranch,
            title: submission.title,
            description: submission.body,
            draft: submission.draft,
            reviewerIds,
            assigneeIds,
          },
          controller.signal
        )
      } else {
        const review = this.state.review
        if (review === null) {
          throw new GitLabMergeRequestContextChangedError()
        }
        const update = this.dirtyUpdate(
          current,
          submission,
          reviewerIds,
          assigneeIds
        )
        if (Object.keys(update).length === 0) {
          this.setState({ editorOperation: { kind: 'success' } })
          return
        }
        updated = await this.props.service.update(
          this.props.repository,
          review,
          update,
          controller.signal
        )
      }
      if (!this.ownsController(controller)) {
        return
      }
      if (!this.props.service.contextCurrent()) {
        this.setState({
          stale: true,
          editorOperation: { kind: 'error', reason: 'stale' },
        })
        return
      }
      this.acceptMutation(updated, {
        editorOperation: { kind: 'success' },
      })
    } catch (error) {
      if (!this.ownsController(controller)) {
        return
      }
      if (isAbort(error)) {
        this.setState({ editorOperation: { kind: 'canceled' } })
      } else {
        const reason = toSubmissionError(error)
        this.setState({
          stale: reason === 'stale' || this.state.stale,
          editorOperation: { kind: 'error', reason },
        })
      }
    } finally {
      this.mutationInFlight = false
      if (this.activeController === controller) {
        this.activeController = null
      }
    }
  }

  private dirtyUpdate(
    current: IGitLabMergeRequest,
    submission: IMergeRequestEditorSubmission,
    reviewerIds: ReadonlyArray<number>,
    assigneeIds: ReadonlyArray<number>
  ): IGitLabMergeRequestUpdate {
    const update: {
      title?: string
      description?: string
      targetBranch?: string
      draft?: boolean
      reviewerIds?: ReadonlyArray<number>
      assigneeIds?: ReadonlyArray<number>
    } = {}
    if (submission.title !== current.title) {
      update.title = submission.title
    }
    if (submission.body !== current.description) {
      update.description = submission.body
    }
    if (submission.targetBranch !== current.targetBranch) {
      update.targetBranch = submission.targetBranch
    }
    if (submission.draft !== current.draft) {
      update.draft = submission.draft
    }
    if (
      !sameIds(
        reviewerIds,
        current.reviewers.map(value => value.id)
      )
    ) {
      update.reviewerIds = reviewerIds
    }
    if (
      !sameIds(
        assigneeIds,
        current.assignees.map(value => value.id)
      )
    ) {
      update.assigneeIds = assigneeIds
    }
    return update
  }

  private onClose = (): void => {
    void this.changeState('close')
  }

  private onReopen = (): void => {
    void this.changeState('reopen')
  }

  private changeState = async (state: 'close' | 'reopen'): Promise<void> => {
    const review = this.state.review
    if (
      this.mutationInFlight ||
      this.state.loading ||
      this.state.loadError !== null
    ) {
      return
    }
    if (
      this.state.stale ||
      review === null ||
      !this.props.service.contextCurrent()
    ) {
      this.setState({ stale: true })
      return
    }
    this.mutationInFlight = true
    const controller = new AbortController()
    this.activeController?.abort()
    this.activeController = controller
    this.setState({
      lifecycleOperation: { kind: 'running', action: state },
    })
    try {
      const updated = await this.props.service.setState(
        this.props.repository,
        review,
        state,
        controller.signal
      )
      if (!this.ownsController(controller)) {
        return
      }
      if (!this.props.service.contextCurrent()) {
        this.setState({
          stale: true,
          lifecycleOperation: { kind: 'error' },
        })
        return
      }
      this.acceptMutation(updated, {
        lifecycleOperation: { kind: 'success', action: state },
      })
    } catch (error) {
      if (!this.ownsController(controller)) {
        return
      }
      this.handleLifecycleError(error)
    } finally {
      this.mutationInFlight = false
      if (this.activeController === controller) {
        this.activeController = null
      }
    }
  }

  private onApprovalChange = (intent: IMergeRequestApprovalIntent): void => {
    void this.changeApproval(intent.approve)
  }

  private changeApproval = async (approve: boolean): Promise<void> => {
    const review = this.state.review
    const mergeRequest = this.state.mergeRequest
    if (
      this.mutationInFlight ||
      this.state.loading ||
      this.state.loadError !== null
    ) {
      return
    }
    if (
      this.state.stale ||
      review === null ||
      mergeRequest === null ||
      !this.props.service.contextCurrent()
    ) {
      this.setState({ stale: true })
      return
    }
    const action = approve ? 'approve' : 'unapprove'
    this.mutationInFlight = true
    const controller = new AbortController()
    this.activeController?.abort()
    this.activeController = controller
    this.setState({ lifecycleOperation: { kind: 'running', action } })
    try {
      if (approve) {
        await this.props.service.approve(
          this.props.repository,
          review,
          controller.signal
        )
      } else {
        await this.props.service.unapprove(
          this.props.repository,
          review,
          controller.signal
        )
      }
      if (!this.ownsController(controller)) {
        return
      }
      if (!this.props.service.contextCurrent()) {
        this.setState({
          stale: true,
          lifecycleOperation: { kind: 'error' },
        })
        return
      }
      const refreshed = await this.props.service.get(
        this.props.repository,
        mergeRequest.iid,
        controller.signal
      )
      if (!this.ownsController(controller)) {
        return
      }
      if (!this.props.service.contextCurrent()) {
        this.setState({
          stale: true,
          lifecycleOperation: { kind: 'error' },
        })
        return
      }
      this.acceptMutation(refreshed, {
        lifecycleOperation: { kind: 'success', action },
      })
    } catch (error) {
      if (!this.ownsController(controller)) {
        return
      }
      this.handleLifecycleError(error)
    } finally {
      this.mutationInFlight = false
      if (this.activeController === controller) {
        this.activeController = null
      }
    }
  }

  private acceptMutation(
    mergeRequest: IGitLabMergeRequest,
    operations: {
      readonly editorOperation?: MergeRequestEditorOperation
      readonly lifecycleOperation?: MergeRequestLifecycleOperation
    }
  ): void {
    const review = this.props.service.createMutationReview(
      this.props.repository,
      mergeRequest
    )
    this.setState(state => ({
      ...state,
      mergeRequest,
      review,
      stale: false,
      ...operations,
    }))
    void this.props.service
      .refreshPullRequests(this.props.repository)
      .catch(() => undefined)
  }

  private handleLifecycleError(error: unknown): void {
    if (isAbort(error)) {
      this.setState({ lifecycleOperation: { kind: 'canceled' } })
      return
    }
    this.setState({
      stale: isContextError(error) || this.state.stale,
      lifecycleOperation: { kind: 'error' },
    })
  }

  private onOpenCanonicalURL = (url: string): void => {
    const mergeRequest = this.state.mergeRequest
    const expected =
      mergeRequest === null
        ? null
        : getGitLabMergeRequestCanonicalURL(this.props.route, mergeRequest.iid)
    if (
      expected === null ||
      url !== expected ||
      !this.props.service.contextCurrent()
    ) {
      this.setState({ stale: true })
      return
    }
    void this.props.service.openInBrowser(expected).catch(() => {
      if (this.mounted) {
        this.setState({ lifecycleOperation: { kind: 'error' } })
      }
    })
  }

  private mutationBusy(): boolean {
    return (
      this.state.editorOperation.kind === 'submitting' ||
      this.state.lifecycleOperation.kind === 'running'
    )
  }

  private ownsController(controller: AbortController): boolean {
    return (
      this.mounted &&
      this.activeController === controller &&
      !controller.signal.aborted
    )
  }

  private onLanguageModeChanged = (event: Event): void => {
    this.setState({
      languageMode: normalizeLanguageMode(
        (event as CustomEvent<unknown>).detail
      ),
    })
  }
}
