import * as React from 'react'

import {
  getGitHubIssueCreationError,
  GitHubIssueBodyMaximumLength,
  GitHubIssueTitleMaximumLength,
  ICreatedGitHubIssue,
  isAbortError,
  normalizeGitHubIssueDraft,
} from '../../lib/github-issue'
import { getAccountForRepository } from '../../lib/get-account-for-repository'
import { Account } from '../../models/account'
import {
  getNonForkGitHubRepository,
  isRepositoryWithGitHubRepository,
  Repository,
} from '../../models/repository'
import {
  Dialog,
  DialogContent,
  DialogError,
  DialogFooter,
  DialogPreferredFocusClassName,
} from '../dialog'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'

type CreateGitHubIssueStep = 'compose' | 'review' | 'submitting' | 'success'

interface ICreateGitHubIssueDialogProps {
  readonly repository: Repository
  readonly accounts: ReadonlyArray<Account>
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
}

interface ICreateGitHubIssueDialogState {
  readonly step: CreateGitHubIssueStep
  readonly title: string
  readonly body: string
  readonly error: string | null
  readonly createdIssue: ICreatedGitHubIssue | null
  readonly openingBrowser: boolean
  readonly abortRequested: boolean
}

interface IIssueCreationAvailability {
  readonly account: Account | null
  readonly targetName: string | null
  readonly reason: string | null
}

function getIssueCreationAvailability(
  repository: Repository,
  accounts: ReadonlyArray<Account>
): IIssueCreationAvailability {
  if (!isRepositoryWithGitHubRepository(repository)) {
    return {
      account: null,
      targetName: null,
      reason: 'This repository is not connected to GitHub.',
    }
  }

  const target = getNonForkGitHubRepository(repository)
  if (target.isArchived === true) {
    return {
      account: null,
      targetName: target.fullName,
      reason: 'This repository is archived and cannot accept new issues.',
    }
  }
  if (target.issuesEnabled === false) {
    return {
      account: null,
      targetName: target.fullName,
      reason: 'Issues are disabled for this repository.',
    }
  }

  const account = getAccountForRepository(accounts, repository)
  if (
    account === null ||
    account.provider !== 'github' ||
    account.token.length === 0 ||
    account.endpoint !== target.endpoint
  ) {
    return {
      account: null,
      targetName: target.fullName,
      reason:
        'Sign in to the matching GitHub account to create this issue inside Desktop.',
    }
  }

  return { account, targetName: target.fullName, reason: null }
}

export class CreateGitHubIssueDialog extends React.Component<
  ICreateGitHubIssueDialogProps,
  ICreateGitHubIssueDialogState
> {
  private request: AbortController | null = null
  private mounted = false
  private titleInput: HTMLInputElement | null = null
  private reviewButton: HTMLButtonElement | null = null
  private cancelRequestButton: HTMLButtonElement | null = null
  private openCreatedIssueButton: HTMLButtonElement | null = null

  public constructor(props: ICreateGitHubIssueDialogProps) {
    super(props)
    this.state = {
      step: 'compose',
      title: '',
      body: '',
      error: null,
      createdIssue: null,
      openingBrowser: false,
      abortRequested: false,
    }
  }

  private setTitleInput = (input: HTMLInputElement | null) => {
    this.titleInput = input
  }

  private setReviewButton = (button: HTMLButtonElement | null) => {
    this.reviewButton = button
    if (button !== null && this.state.step === 'review') {
      button.focus()
    }
  }

  private setCancelRequestButton = (button: HTMLButtonElement | null) => {
    this.cancelRequestButton = button
    if (button !== null && this.state.step === 'submitting') {
      button.focus()
    }
  }

  private setOpenCreatedIssueButton = (button: HTMLButtonElement | null) => {
    this.openCreatedIssueButton = button
    if (button !== null && this.state.step === 'success') {
      button.focus()
    }
  }

  public componentDidMount() {
    this.mounted = true
  }

  public componentWillUnmount() {
    this.mounted = false
    this.request?.abort()
  }

  public componentDidUpdate(
    prevProps: ICreateGitHubIssueDialogProps,
    prevState: ICreateGitHubIssueDialogState
  ) {
    void prevProps
    if (prevState.step === this.state.step) {
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
        this.openCreatedIssueButton?.focus()
        break
    }
  }

  private onDismissed = () => {
    this.request?.abort()
    this.props.onDismissed()
  }

  private onTitleChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ title: event.currentTarget.value, error: null })

  private onBodyChanged = (event: React.FormEvent<HTMLTextAreaElement>) =>
    this.setState({ body: event.currentTarget.value, error: null })

  private onSubmit = () => {
    if (this.state.step === 'compose') {
      this.review()
    } else if (this.state.step === 'review') {
      void this.createIssue()
    }
  }

  private review = () => {
    try {
      const draft = normalizeGitHubIssueDraft(this.state.title, this.state.body)
      this.setState({
        step: 'review',
        title: draft.title,
        body: draft.body,
        error: null,
      })
    } catch (error) {
      this.setState({
        error: error instanceof Error ? error.message : 'Review this issue.',
      })
    }
  }

  private edit = () => this.setState({ step: 'compose', error: null })

  private createIssue = async () => {
    const availability = getIssueCreationAvailability(
      this.props.repository,
      this.props.accounts
    )
    if (availability.account === null) {
      this.setState({ error: availability.reason })
      return
    }

    const request = new AbortController()
    this.request = request
    this.setState({
      step: 'submitting',
      error: null,
      abortRequested: false,
    })

    try {
      const createdIssue = await this.props.dispatcher.createGitHubIssue(
        this.props.repository,
        availability.account,
        this.state.title,
        this.state.body,
        request.signal
      )
      if (!this.mounted) {
        return
      }
      if (request.signal.aborted) {
        this.showCancellationResult()
        return
      }
      this.setState({
        step: 'success',
        createdIssue,
        error: null,
        abortRequested: false,
      })
    } catch (error) {
      if (!this.mounted) {
        return
      }
      if (isAbortError(error) || request.signal.aborted) {
        this.showCancellationResult()
      } else {
        this.setState({
          step: 'review',
          error: getGitHubIssueCreationError(error).message,
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
        'The request was canceled before Desktop received a result. Check GitHub before retrying to avoid a duplicate issue.',
      abortRequested: false,
    })
  }

  private cancelRequest = () => {
    if (this.request !== null && !this.request.signal.aborted) {
      this.setState({ abortRequested: true })
      this.request.abort()
    }
  }

  private openBrowserFallback = async () => {
    this.setState({ openingBrowser: true, error: null })
    const opened = await this.props.dispatcher.openIssueCreationPage(
      this.props.repository
    )
    if (!this.mounted) {
      return
    }
    if (opened) {
      this.props.onDismissed()
    } else {
      this.setState({
        openingBrowser: false,
        error: 'Desktop could not open the GitHub issue page.',
      })
    }
  }

  private onOpenBrowserFallback = () => {
    void this.openBrowserFallback()
  }

  private openCreatedIssue = async () => {
    const issue = this.state.createdIssue
    if (issue === null) {
      return
    }
    const opened = await this.props.dispatcher.openInBrowser(issue.url)
    if (this.mounted && !opened) {
      this.setState({
        error: 'Desktop could not open the created issue in your browser.',
      })
    }
  }

  private onOpenCreatedIssue = () => {
    void this.openCreatedIssue()
  }

  private renderUnavailable(reason: string, targetName: string | null) {
    return (
      <>
        <DialogContent className="create-github-issue-content">
          <div className="create-github-issue-availability">
            <strong>Native issue creation is unavailable</strong>
            <p>{reason}</p>
            {targetName !== null && (
              <span className="create-github-issue-target">{targetName}</span>
            )}
          </div>
          <p className="create-github-issue-browser-note">
            You can continue in the provider’s issue form without sending any
            draft text from Desktop.
          </p>
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            <Button type="button" onClick={this.onDismissed}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={this.state.openingBrowser}
              onClick={this.onOpenBrowserFallback}
            >
              {this.state.openingBrowser ? 'Opening…' : 'Open in browser'}
            </Button>
          </div>
        </DialogFooter>
      </>
    )
  }

  private renderCompose(account: Account, targetName: string) {
    const titleRemaining =
      GitHubIssueTitleMaximumLength - this.state.title.length
    const bodyRemaining = GitHubIssueBodyMaximumLength - this.state.body.length
    return (
      <>
        <DialogContent className="create-github-issue-content">
          <div
            className="create-github-issue-context"
            role="group"
            aria-label="Issue target"
          >
            <strong>{targetName}</strong>
            <span>
              {account.login} · {account.friendlyEndpoint}
            </span>
          </div>
          <label className="create-github-issue-field">
            <span>Title</span>
            <input
              className={DialogPreferredFocusClassName}
              type="text"
              value={this.state.title}
              maxLength={GitHubIssueTitleMaximumLength}
              required={true}
              autoFocus={true}
              aria-label="Title"
              aria-describedby="create-github-issue-title-count"
              ref={this.setTitleInput}
              onChange={this.onTitleChanged}
            />
            <small id="create-github-issue-title-count">
              {titleRemaining} characters remaining
            </small>
          </label>
          <label className="create-github-issue-field">
            <span>Description (optional)</span>
            <textarea
              value={this.state.body}
              maxLength={GitHubIssueBodyMaximumLength}
              rows={8}
              aria-label="Description (optional)"
              aria-describedby="create-github-issue-body-count"
              onChange={this.onBodyChanged}
            />
            <small id="create-github-issue-body-count">
              {bodyRemaining} characters remaining · Markdown supported
            </small>
          </label>
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            <Button type="button" onClick={this.onDismissed}>
              Cancel
            </Button>
            <Button type="submit" disabled={this.state.title.trim() === ''}>
              Review issue
            </Button>
          </div>
        </DialogFooter>
      </>
    )
  }

  private renderReview(account: Account, targetName: string) {
    return (
      <>
        <DialogContent className="create-github-issue-content">
          <div
            className="create-github-issue-context"
            role="group"
            aria-label="Issue target"
          >
            <strong>{targetName}</strong>
            <span>
              {account.login} · {account.friendlyEndpoint}
            </span>
          </div>
          <div className="create-github-issue-review">
            <span className="create-github-issue-eyebrow">Title</span>
            <h2>{this.state.title}</h2>
            <span className="create-github-issue-eyebrow">Description</span>
            <div className="create-github-issue-review-body">
              {this.state.body === '' ? (
                <em>No description</em>
              ) : (
                this.state.body
              )}
            </div>
          </div>
          <p id="create-github-issue-confirmation">
            Confirming will publish this issue to {targetName} as{' '}
            {account.login}.
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
              ariaDescribedBy="create-github-issue-confirmation"
              onButtonRef={this.setReviewButton}
            >
              Create issue
            </Button>
          </div>
        </DialogFooter>
      </>
    )
  }

  private renderSubmitting(targetName: string) {
    return (
      <>
        <DialogContent className="create-github-issue-content">
          <div className="create-github-issue-progress" role="status">
            <strong>Creating issue…</strong>
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
    const issue = this.state.createdIssue
    if (issue === null) {
      return null
    }
    return (
      <>
        <DialogContent className="create-github-issue-content">
          <div className="create-github-issue-success" role="status">
            <strong>Issue #{issue.number} created</strong>
            <span>{targetName}</span>
            <p>{issue.title}</p>
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
              onButtonRef={this.setOpenCreatedIssueButton}
              onClick={this.onOpenCreatedIssue}
            >
              Open on GitHub
            </Button>
          </div>
        </DialogFooter>
      </>
    )
  }

  public render() {
    const availability = getIssueCreationAvailability(
      this.props.repository,
      this.props.accounts
    )
    const title =
      this.state.step === 'review'
        ? 'Review GitHub issue'
        : this.state.step === 'success'
        ? 'GitHub issue created'
        : 'Create GitHub issue'

    let content: JSX.Element | null
    if (availability.account === null || availability.targetName === null) {
      content = this.renderUnavailable(
        availability.reason ?? 'Native issue creation is unavailable.',
        availability.targetName
      )
    } else {
      switch (this.state.step) {
        case 'compose':
          content = this.renderCompose(
            availability.account,
            availability.targetName
          )
          break
        case 'review':
          content = this.renderReview(
            availability.account,
            availability.targetName
          )
          break
        case 'submitting':
          content = this.renderSubmitting(availability.targetName)
          break
        case 'success':
          content = this.renderSuccess(availability.targetName)
          break
      }
    }

    return (
      <Dialog
        id="create-github-issue"
        className="create-github-issue-dialog"
        title={title}
        ariaDescribedBy={
          this.state.step === 'review'
            ? 'create-github-issue-confirmation'
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
