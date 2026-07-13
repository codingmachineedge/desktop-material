import * as React from 'react'

import { getAccountForRepository } from '../../lib/get-account-for-repository'
import {
  getGitHubPullRequestCreationError,
  getGitHubPullRequestHead,
  GitHubPullRequestBodyMaximumLength,
  GitHubPullRequestTitleMaximumLength,
  ICreatedGitHubPullRequest,
  IGitHubPullRequestTarget,
  isGitHubPullRequestAbortError,
  normalizeGitHubPullRequestDraft,
} from '../../lib/github-pull-request'
import { Account, getAccountKey } from '../../models/account'
import { Branch } from '../../models/branch'
import { RepositoryWithGitHubRepository } from '../../models/repository'
import {
  Dialog,
  DialogContent,
  DialogError,
  DialogFooter,
  DialogPreferredFocusClassName,
  DialogStackContext,
} from '../dialog'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'

type CreateGitHubPullRequestStep =
  | 'compose'
  | 'review'
  | 'submitting'
  | 'success'

interface ICreateGitHubPullRequestDialogProps {
  readonly repository: RepositoryWithGitHubRepository
  readonly currentBranch: Branch
  readonly targets: ReadonlyArray<IGitHubPullRequestTarget>
  readonly initialTargetHash: string
  readonly initialBaseBranchName: string | null
  readonly contextVersion: string
  readonly repositoryContextCurrent: boolean
  readonly accounts: ReadonlyArray<Account>
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
}

interface ICreateGitHubPullRequestDialogState {
  readonly step: CreateGitHubPullRequestStep
  readonly targetHash: string
  readonly accountKey: string
  readonly baseBranchName: string
  readonly title: string
  readonly body: string
  readonly draft: boolean
  readonly error: string | null
  readonly createdPullRequest: ICreatedGitHubPullRequest | null
  readonly openingBrowser: boolean
  readonly abortRequested: boolean
}

interface IPullRequestCreationAvailability {
  readonly target: IGitHubPullRequestTarget | null
  readonly account: Account | null
  readonly baseBranch: Branch | null
  readonly head: string | null
  readonly reason: string | null
  readonly browserFallbackAllowed: boolean
}

function getTargetBaseBranches(
  target: IGitHubPullRequestTarget
): ReadonlyArray<Branch> {
  const byName = new Map<string, Branch>()
  for (const branch of target.baseBranches) {
    byName.set(branch.nameWithoutRemote, branch)
  }

  const defaultName = target.defaultBranch?.nameWithoutRemote
  if (defaultName !== undefined && byName.has(defaultName)) {
    const defaultBranch = byName.get(defaultName)!
    byName.delete(defaultName)
    return [defaultBranch, ...byName.values()]
  }

  return [...byName.values()]
}

function getEligibleAccounts(
  accounts: ReadonlyArray<Account>,
  target: IGitHubPullRequestTarget
): ReadonlyArray<Account> {
  return accounts.filter(
    account =>
      account.provider === 'github' &&
      account.token.length > 0 &&
      account.endpoint === target.repository.endpoint
  )
}

function getInitialAccountKey(
  repository: RepositoryWithGitHubRepository,
  accounts: ReadonlyArray<Account>,
  target: IGitHubPullRequestTarget | undefined
): string {
  if (target === undefined) {
    return ''
  }

  const eligible = getEligibleAccounts(accounts, target)
  const preferred = getAccountForRepository(accounts, repository)
  const account =
    preferred !== null && eligible.some(candidate => candidate === preferred)
      ? preferred
      : eligible[0]
  return account === undefined ? '' : getAccountKey(account)
}

function getInitialBaseBranchName(
  target: IGitHubPullRequestTarget | undefined,
  requestedName: string | null
): string {
  if (target === undefined) {
    return ''
  }

  const branches = getTargetBaseBranches(target)
  if (
    requestedName !== null &&
    branches.some(branch => branch.nameWithoutRemote === requestedName)
  ) {
    return requestedName
  }

  return branches[0]?.nameWithoutRemote ?? ''
}

export class CreateGitHubPullRequestDialog extends React.Component<
  ICreateGitHubPullRequestDialogProps,
  ICreateGitHubPullRequestDialogState
> {
  public static contextType = DialogStackContext
  public declare context: React.ContextType<typeof DialogStackContext>

  private request: AbortController | null = null
  private requestGeneration = 0
  private mounted = false
  private titleInput: HTMLInputElement | null = null
  private reviewButton: HTMLButtonElement | null = null
  private cancelRequestButton: HTMLButtonElement | null = null
  private openCreatedPullRequestButton: HTMLButtonElement | null = null

  public constructor(props: ICreateGitHubPullRequestDialogProps) {
    super(props)
    const target =
      props.targets.find(
        candidate => candidate.repository.hash === props.initialTargetHash
      ) ?? props.targets[0]

    this.state = {
      step: 'compose',
      targetHash: target?.repository.hash ?? '',
      accountKey: getInitialAccountKey(
        props.repository,
        props.accounts,
        target
      ),
      baseBranchName: getInitialBaseBranchName(
        target,
        props.initialBaseBranchName
      ),
      title: props.currentBranch.nameWithoutRemote,
      body: '',
      draft: false,
      error: null,
      createdPullRequest: null,
      openingBrowser: false,
      abortRequested: false,
    }
  }

  private setTitleInput = (input: HTMLInputElement | null) => {
    this.titleInput = input
  }

  private setReviewButton = (button: HTMLButtonElement | null) => {
    this.reviewButton = button
    if (
      button !== null &&
      this.state.step === 'review' &&
      this.context.isTopMost
    ) {
      button.focus()
    }
  }

  private setCancelRequestButton = (button: HTMLButtonElement | null) => {
    this.cancelRequestButton = button
    if (
      button !== null &&
      this.state.step === 'submitting' &&
      this.context.isTopMost
    ) {
      button.focus()
    }
  }

  private setOpenCreatedPullRequestButton = (
    button: HTMLButtonElement | null
  ) => {
    this.openCreatedPullRequestButton = button
    if (
      button !== null &&
      this.state.step === 'success' &&
      this.context.isTopMost
    ) {
      button.focus()
    }
  }

  public componentDidMount() {
    this.mounted = true
  }

  public componentWillUnmount() {
    this.mounted = false
    this.requestGeneration++
    this.request?.abort()
  }

  public componentDidUpdate(
    prevProps: ICreateGitHubPullRequestDialogProps,
    prevState: ICreateGitHubPullRequestDialogState
  ) {
    if (
      prevProps.repositoryContextCurrent &&
      !this.props.repositoryContextCurrent &&
      this.state.step !== 'success'
    ) {
      this.requestGeneration++
      this.request?.abort()
      if (this.state.step === 'submitting') {
        this.setState({
          step: 'review',
          error: null,
          abortRequested: false,
        })
        return
      }
    }

    if (prevState.step === this.state.step || !this.context.isTopMost) {
      return
    }

    switch (this.state.step) {
      case 'compose':
        this.titleInput?.focus()
        break
      case 'review':
        this.reviewButton?.focus()
        break
      case 'submitting':
        this.cancelRequestButton?.focus()
        break
      case 'success':
        this.openCreatedPullRequestButton?.focus()
        break
    }
  }

  private onDismissed = () => {
    this.requestGeneration++
    this.request?.abort()
    this.props.onDismissed()
  }

  private canPerformAction(): boolean {
    if (!this.context.isTopMost) {
      return false
    }
    if (!this.props.repositoryContextCurrent) {
      this.setState({
        error:
          'The repository or current branch changed. Close this dialog and start again.',
      })
      return false
    }
    return true
  }

  private getSelectedTarget(): IGitHubPullRequestTarget | null {
    return (
      this.props.targets.find(
        target => target.repository.hash === this.state.targetHash
      ) ?? null
    )
  }

  private getAvailability(): IPullRequestCreationAvailability {
    const target = this.getSelectedTarget()
    if (!this.props.repositoryContextCurrent) {
      return {
        target,
        account: null,
        baseBranch: null,
        head: null,
        reason:
          'The repository or current branch changed. Close this dialog and start again.',
        browserFallbackAllowed: false,
      }
    }
    if (target === null) {
      return {
        target: null,
        account: null,
        baseBranch: null,
        head: null,
        reason: 'Desktop could not identify a GitHub target repository.',
        browserFallbackAllowed: false,
      }
    }
    if (target.repository.isArchived === true) {
      return {
        target,
        account: null,
        baseBranch: null,
        head: null,
        reason: 'The selected repository is archived.',
        browserFallbackAllowed: false,
      }
    }
    if (this.props.currentBranch.upstream === null) {
      return {
        target,
        account: null,
        baseBranch: null,
        head: null,
        reason: 'Publish the current branch before creating a pull request.',
        browserFallbackAllowed: false,
      }
    }

    const baseBranch =
      getTargetBaseBranches(target).find(
        branch => branch.nameWithoutRemote === this.state.baseBranchName
      ) ?? null
    if (baseBranch === null) {
      return {
        target,
        account: null,
        baseBranch: null,
        head: null,
        reason:
          'Desktop could not find a published base branch for this target.',
        browserFallbackAllowed: target.repository.htmlURL !== null,
      }
    }

    const account =
      getEligibleAccounts(this.props.accounts, target).find(
        candidate => getAccountKey(candidate) === this.state.accountKey
      ) ?? null
    if (account === null) {
      return {
        target,
        account: null,
        baseBranch,
        head: null,
        reason:
          'Sign in to a matching GitHub account to create this pull request inside Desktop.',
        browserFallbackAllowed: target.repository.htmlURL !== null,
      }
    }

    try {
      return {
        target,
        account,
        baseBranch,
        head: getGitHubPullRequestHead(
          this.props.repository.gitHubRepository,
          target.repository,
          this.props.currentBranch
        ),
        reason: null,
        browserFallbackAllowed: false,
      }
    } catch (error) {
      return {
        target,
        account,
        baseBranch,
        head: null,
        reason:
          error instanceof Error
            ? error.message
            : 'The pull request head branch is unavailable.',
        browserFallbackAllowed: false,
      }
    }
  }

  private onTargetChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    const targetHash = event.currentTarget.value
    const target = this.props.targets.find(
      candidate => candidate.repository.hash === targetHash
    )
    this.setState({
      targetHash,
      baseBranchName: getInitialBaseBranchName(target, null),
      accountKey: getInitialAccountKey(
        this.props.repository,
        this.props.accounts,
        target
      ),
      error: null,
    })
  }

  private onAccountChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({ accountKey: event.currentTarget.value, error: null })

  private onBaseBranchChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({ baseBranchName: event.currentTarget.value, error: null })

  private onTitleChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ title: event.currentTarget.value, error: null })

  private onBodyChanged = (event: React.FormEvent<HTMLTextAreaElement>) =>
    this.setState({ body: event.currentTarget.value, error: null })

  private onDraftChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ draft: event.currentTarget.checked, error: null })

  private onSubmit = () => {
    if (!this.canPerformAction()) {
      return
    }
    if (this.state.step === 'compose') {
      this.review()
    } else if (this.state.step === 'review') {
      void this.createPullRequest()
    }
  }

  private review = () => {
    const availability = this.getAvailability()
    if (
      availability.target === null ||
      availability.account === null ||
      availability.baseBranch === null ||
      availability.head === null
    ) {
      this.setState({
        error: availability.reason ?? 'Review the pull request prerequisites.',
      })
      return
    }

    try {
      const draft = normalizeGitHubPullRequestDraft(
        this.state.title,
        this.state.body,
        availability.head,
        availability.baseBranch.nameWithoutRemote,
        this.state.draft
      )
      this.setState({
        step: 'review',
        title: draft.title,
        body: draft.body,
        baseBranchName: draft.base,
        error: null,
      })
    } catch (error) {
      this.setState({
        error:
          error instanceof Error ? error.message : 'Review this pull request.',
      })
    }
  }

  private edit = () => {
    if (this.context.isTopMost) {
      this.setState({ step: 'compose', error: null })
    }
  }

  private createPullRequest = async () => {
    const availability = this.getAvailability()
    if (
      availability.target === null ||
      availability.account === null ||
      availability.baseBranch === null ||
      availability.head === null
    ) {
      this.setState({
        error: availability.reason ?? 'Pull request creation is unavailable.',
      })
      return
    }
    if (
      !this.props.dispatcher.isGitHubPullRequestContextCurrent(
        this.props.repository,
        this.props.contextVersion
      )
    ) {
      this.setState({
        error:
          'The repository or current branch changed. Close this dialog and start again.',
      })
      return
    }

    let draft
    try {
      draft = normalizeGitHubPullRequestDraft(
        this.state.title,
        this.state.body,
        availability.head,
        availability.baseBranch.nameWithoutRemote,
        this.state.draft
      )
    } catch (error) {
      this.setState({
        step: 'compose',
        error:
          error instanceof Error ? error.message : 'Review this pull request.',
      })
      return
    }

    const request = new AbortController()
    const generation = ++this.requestGeneration
    this.request = request
    this.setState({
      step: 'submitting',
      error: null,
      abortRequested: false,
    })

    try {
      const createdPullRequest =
        await this.props.dispatcher.createGitHubPullRequest(
          this.props.repository,
          availability.target.repository,
          availability.account,
          this.props.currentBranch,
          this.props.contextVersion,
          draft,
          request.signal
        )
      if (!this.mounted || generation !== this.requestGeneration) {
        return
      }
      if (request.signal.aborted) {
        this.showCancellationResult()
        return
      }
      this.setState({
        step: 'success',
        createdPullRequest,
        error: null,
        abortRequested: false,
      })
    } catch (error) {
      if (!this.mounted || generation !== this.requestGeneration) {
        return
      }
      if (isGitHubPullRequestAbortError(error) || request.signal.aborted) {
        this.showCancellationResult()
      } else {
        this.setState({
          step: 'review',
          error: getGitHubPullRequestCreationError(error).message,
          abortRequested: false,
        })
      }
    } finally {
      if (this.request === request) {
        this.request = null
      }
    }
  }

  private showCancellationResult = () => {
    this.setState({
      step: 'review',
      error:
        'The request was canceled before Desktop received a result. Check GitHub before retrying to avoid a duplicate pull request.',
      abortRequested: false,
    })
  }

  private cancelRequest = () => {
    if (
      this.context.isTopMost &&
      this.request !== null &&
      !this.request.signal.aborted
    ) {
      this.setState({ abortRequested: true })
      this.request.abort()
    }
  }

  private openBrowserFallback = async () => {
    if (!this.canPerformAction()) {
      return
    }
    const availability = this.getAvailability()
    if (!availability.browserFallbackAllowed || availability.target === null) {
      return
    }

    this.setState({ openingBrowser: true, error: null })
    const opened = await this.props.dispatcher.openCreatePullRequestInBrowser(
      this.props.repository,
      this.props.currentBranch,
      availability.baseBranch ?? undefined,
      availability.target.repository
    )
    if (!this.mounted) {
      return
    }
    if (opened) {
      this.props.onDismissed()
    } else {
      this.setState({
        openingBrowser: false,
        error: 'Desktop could not open the GitHub pull request page.',
      })
    }
  }

  private onOpenBrowserFallback = () => {
    void this.openBrowserFallback()
  }

  private openCreatedPullRequest = async () => {
    if (!this.context.isTopMost) {
      return
    }
    const pullRequest = this.state.createdPullRequest
    if (pullRequest === null) {
      return
    }
    const opened = await this.props.dispatcher.openInBrowser(pullRequest.url)
    if (this.mounted && !opened) {
      this.setState({
        error:
          'Desktop could not open the created pull request in your browser.',
      })
    }
  }

  private onOpenCreatedPullRequest = () => {
    void this.openCreatedPullRequest()
  }

  private renderUnavailable(availability: IPullRequestCreationAvailability) {
    const targetName = availability.target?.repository.fullName ?? null
    return (
      <>
        <DialogContent className="create-github-pull-request-content">
          {this.props.repositoryContextCurrent &&
            this.props.targets.length > 1 && (
              <label className="create-github-pull-request-field">
                <span>Target repository</span>
                <select
                  aria-label="Target repository"
                  value={this.state.targetHash}
                  onChange={this.onTargetChanged}
                >
                  {this.props.targets.map(candidate => (
                    <option
                      key={candidate.repository.hash}
                      value={candidate.repository.hash}
                    >
                      {candidate.repository.fullName}
                    </option>
                  ))}
                </select>
              </label>
            )}
          <div className="create-github-pull-request-availability">
            <strong>Native pull request creation is unavailable</strong>
            <p>{availability.reason}</p>
            {targetName !== null && (
              <span className="create-github-pull-request-target">
                {targetName}
              </span>
            )}
          </div>
          {availability.browserFallbackAllowed && (
            <p className="create-github-pull-request-browser-note">
              Browser fallback opens the provider’s form. Desktop will not send
              a title or description.
            </p>
          )}
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            <Button type="button" onClick={this.onDismissed}>
              {availability.browserFallbackAllowed ? 'Cancel' : 'Close'}
            </Button>
            {availability.browserFallbackAllowed && (
              <Button
                type="button"
                disabled={this.state.openingBrowser}
                onClick={this.onOpenBrowserFallback}
              >
                {this.state.openingBrowser
                  ? 'Opening…'
                  : 'Open browser fallback'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </>
    )
  }

  private renderCompose(availability: IPullRequestCreationAvailability) {
    const target = availability.target!
    const account = availability.account!
    const head = availability.head!
    const baseBranches = getTargetBaseBranches(target)
    const eligibleAccounts = getEligibleAccounts(this.props.accounts, target)
    const titleRemaining =
      GitHubPullRequestTitleMaximumLength - this.state.title.length
    const bodyRemaining =
      GitHubPullRequestBodyMaximumLength - this.state.body.length

    return (
      <>
        <DialogContent className="create-github-pull-request-content">
          <div className="create-github-pull-request-routing">
            <label className="create-github-pull-request-field">
              <span>Target repository</span>
              <select
                aria-label="Target repository"
                value={this.state.targetHash}
                onChange={this.onTargetChanged}
              >
                {this.props.targets.map(candidate => (
                  <option
                    key={candidate.repository.hash}
                    value={candidate.repository.hash}
                  >
                    {candidate.repository.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="create-github-pull-request-field">
              <span>Account</span>
              <select
                aria-label="Account"
                value={getAccountKey(account)}
                onChange={this.onAccountChanged}
              >
                {eligibleAccounts.map(candidate => (
                  <option
                    key={getAccountKey(candidate)}
                    value={getAccountKey(candidate)}
                  >
                    {candidate.login} · {candidate.friendlyEndpoint}
                  </option>
                ))}
              </select>
            </label>
            <label className="create-github-pull-request-field">
              <span>Base branch</span>
              <select
                aria-label="Base branch"
                value={this.state.baseBranchName}
                onChange={this.onBaseBranchChanged}
              >
                {baseBranches.map(branch => (
                  <option
                    key={branch.nameWithoutRemote}
                    value={branch.nameWithoutRemote}
                  >
                    {branch.nameWithoutRemote}
                  </option>
                ))}
              </select>
            </label>
            <div
              className="create-github-pull-request-head"
              role="group"
              aria-label="Head branch"
            >
              <span>Head (current branch)</span>
              <strong>{head}</strong>
              <small>Local branch: {this.props.currentBranch.name}</small>
            </div>
          </div>
          <label className="create-github-pull-request-field">
            <span>Title</span>
            <input
              className={DialogPreferredFocusClassName}
              type="text"
              value={this.state.title}
              maxLength={GitHubPullRequestTitleMaximumLength}
              required={true}
              autoFocus={true}
              aria-label="Title"
              aria-describedby="create-github-pull-request-title-count"
              ref={this.setTitleInput}
              onChange={this.onTitleChanged}
            />
            <small id="create-github-pull-request-title-count">
              {titleRemaining} characters remaining
            </small>
          </label>
          <label className="create-github-pull-request-field">
            <span>Description (optional)</span>
            <textarea
              value={this.state.body}
              maxLength={GitHubPullRequestBodyMaximumLength}
              rows={7}
              aria-label="Description (optional)"
              aria-describedby="create-github-pull-request-body-count"
              onChange={this.onBodyChanged}
            />
            <small id="create-github-pull-request-body-count">
              {bodyRemaining} characters remaining · Markdown supported
            </small>
          </label>
          <Checkbox
            className="create-github-pull-request-draft"
            label="Create as draft pull request"
            value={this.state.draft ? CheckboxValue.On : CheckboxValue.Off}
            onChange={this.onDraftChanged}
          />
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            <Button type="button" onClick={this.onDismissed}>
              Cancel
            </Button>
            <Button type="submit" disabled={this.state.title.trim() === ''}>
              Review pull request
            </Button>
          </div>
        </DialogFooter>
      </>
    )
  }

  private renderReview(availability: IPullRequestCreationAvailability) {
    const target = availability.target!
    const account = availability.account!
    const head = availability.head!
    return (
      <>
        <DialogContent className="create-github-pull-request-content">
          <div
            className="create-github-pull-request-context"
            role="group"
            aria-label="Pull request route"
          >
            <strong>{target.repository.fullName}</strong>
            <span>
              {head} → {this.state.baseBranchName}
            </span>
            <span>
              {account.login} · {account.friendlyEndpoint}
            </span>
            <span>{this.state.draft ? 'Draft' : 'Ready for review'}</span>
          </div>
          <div className="create-github-pull-request-review">
            <span className="create-github-pull-request-eyebrow">Title</span>
            <h2>{this.state.title}</h2>
            <span className="create-github-pull-request-eyebrow">
              Description
            </span>
            <div className="create-github-pull-request-review-body">
              {this.state.body === '' ? (
                <em>No description</em>
              ) : (
                this.state.body
              )}
            </div>
          </div>
          <p id="create-github-pull-request-confirmation">
            Confirming will create {this.state.draft ? 'a draft ' : 'a '}pull
            request in {target.repository.fullName} as {account.login}. A
            canceled request may still have reached GitHub.
          </p>
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            <Button type="button" onClick={this.edit}>
              Back to edit
            </Button>
            <Button
              type="submit"
              autoFocus={true}
              ariaDescribedBy="create-github-pull-request-confirmation"
              onButtonRef={this.setReviewButton}
            >
              {this.state.draft
                ? 'Create draft pull request'
                : 'Create pull request'}
            </Button>
          </div>
        </DialogFooter>
      </>
    )
  }

  private renderSubmitting(targetName: string) {
    return (
      <>
        <DialogContent className="create-github-pull-request-content">
          <div className="create-github-pull-request-progress" role="status">
            <strong>Creating pull request…</strong>
            <span>Waiting for {targetName}</span>
          </div>
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            <Button
              type="button"
              disabled={this.state.abortRequested}
              onButtonRef={this.setCancelRequestButton}
              onClick={this.cancelRequest}
            >
              {this.state.abortRequested ? 'Canceling…' : 'Cancel request'}
            </Button>
          </div>
        </DialogFooter>
      </>
    )
  }

  private renderSuccess(targetName: string) {
    const pullRequest = this.state.createdPullRequest
    if (pullRequest === null) {
      return null
    }
    return (
      <>
        <DialogContent className="create-github-pull-request-content">
          <div className="create-github-pull-request-success" role="status">
            <strong>
              {pullRequest.draft ? 'Draft pull request' : 'Pull request'} #
              {pullRequest.number} created
            </strong>
            <span>{targetName}</span>
            <p>{pullRequest.title}</p>
          </div>
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            <Button type="button" onClick={this.onDismissed}>
              Done
            </Button>
            <Button
              type="button"
              autoFocus={true}
              onButtonRef={this.setOpenCreatedPullRequestButton}
              onClick={this.onOpenCreatedPullRequest}
            >
              Open on GitHub
            </Button>
          </div>
        </DialogFooter>
      </>
    )
  }

  public render() {
    const availability = this.getAvailability()
    const title =
      this.state.step === 'review'
        ? 'Review GitHub pull request'
        : this.state.step === 'success'
        ? 'GitHub pull request created'
        : 'Create GitHub pull request'

    let content: JSX.Element | null
    if (
      this.state.step === 'success' &&
      this.state.createdPullRequest !== null
    ) {
      content = this.renderSuccess(
        this.getSelectedTarget()?.repository.fullName ??
          this.props.repository.gitHubRepository.fullName
      )
    } else if (
      availability.target === null ||
      availability.account === null ||
      availability.baseBranch === null ||
      availability.head === null
    ) {
      content = this.renderUnavailable(availability)
    } else {
      switch (this.state.step) {
        case 'compose':
          content = this.renderCompose(availability)
          break
        case 'review':
          content = this.renderReview(availability)
          break
        case 'submitting':
          content = this.renderSubmitting(
            availability.target.repository.fullName
          )
          break
        case 'success':
          content = null
          break
      }
    }

    return (
      <Dialog
        id="create-github-pull-request"
        className="create-github-pull-request-dialog"
        title={title}
        ariaDescribedBy={
          this.state.step === 'review'
            ? 'create-github-pull-request-confirmation'
            : undefined
        }
        onSubmit={this.onSubmit}
        onDismissed={this.onDismissed}
        loading={this.state.step === 'submitting'}
      >
        {this.state.error !== null && (
          <DialogError>{this.state.error}</DialogError>
        )}
        {content}
      </Dialog>
    )
  }
}
