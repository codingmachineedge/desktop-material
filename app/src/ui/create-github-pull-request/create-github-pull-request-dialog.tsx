import * as React from 'react'

import { getAccountForRepository } from '../../lib/get-account-for-repository'
import {
  getGitHubPullRequestCreationError,
  getGitHubPullRequestHead,
  GitHubPullRequestBodyMaximumLength,
  GitHubPullRequestContextChangedError,
  GitHubPullRequestTitleMaximumLength,
  ICreatedGitHubPullRequest,
  IGitHubPullRequestBaseBranch,
  IGitHubPullRequestDraft,
  IGitHubPullRequestTarget,
  isGitHubPullRequestAbortError,
  normalizeGitHubPullRequestDraft,
  normalizeGitHubPullRequestMetadata,
} from '../../lib/github-pull-request'
import {
  getDefaultGitHubPullRequestTitle,
  IGitHubPullRequestCreationContext,
  IGitHubPullRequestCreationMetadata,
} from '../../lib/github-pull-request-creation'
import {
  bilingualVariable,
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
  translateForAccessibleName,
  TranslationKey,
  TranslationVariables,
} from '../../lib/i18n'
import { Account, getAccountKey } from '../../models/account'
import { Branch } from '../../models/branch'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { IRemote } from '../../models/remote'
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
  readonly sourceRemote: IRemote | null
  readonly providerHTMLURL: string
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
  readonly languageMode: LanguageMode
  readonly creationContext: IGitHubPullRequestCreationContext | null
  readonly creationContextLoading: boolean
  readonly selectedTemplatePath: string
  readonly reviewers: ReadonlyArray<string>
  readonly assignees: ReadonlyArray<string>
  readonly labels: ReadonlyArray<string>
  readonly milestone: number | null
  readonly titleEdited: boolean
  readonly bodyEdited: boolean
  readonly reviewedDraft: IGitHubPullRequestDraft | null
  readonly reviewedMetadata: IGitHubPullRequestCreationMetadata | null
  readonly error: string | null
  readonly successReceipt: ICreateGitHubPullRequestSuccessReceipt | null
  readonly openingBrowser: boolean
  readonly abortRequested: boolean
}

interface IPullRequestCreationAvailability {
  readonly target: IGitHubPullRequestTarget | null
  readonly account: Account | null
  readonly baseBranch: IGitHubPullRequestBaseBranch | null
  readonly head: string | null
  readonly reason: string | null
  readonly browserFallbackAllowed: boolean
}

interface ICreateGitHubPullRequestSuccessReceipt {
  readonly created: ICreatedGitHubPullRequest
  readonly targetName: string
  readonly accountLogin: string
  readonly reviewed: IGitHubPullRequestDraft
  readonly metadata: IGitHubPullRequestCreationMetadata
}

const CancellationResultMessage =
  'The request ended before Desktop received a result. Check GitHub before retrying to avoid a duplicate pull request.'

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

  const branches = target.baseBranches
  if (
    requestedName !== null &&
    branches.some(branch => branch.name === requestedName)
  ) {
    return requestedName
  }

  return target.defaultBranchName ?? branches[0]?.name ?? ''
}

export class CreateGitHubPullRequestDialog extends React.Component<
  ICreateGitHubPullRequestDialogProps,
  ICreateGitHubPullRequestDialogState
> {
  public static contextType = DialogStackContext
  public declare context: React.ContextType<typeof DialogStackContext>

  private request: AbortController | null = null
  private contextRequest: AbortController | null = null
  private requestGeneration = 0
  private contextRequestGeneration = 0
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
      title: getDefaultGitHubPullRequestTitle(
        props.currentBranch.nameWithoutRemote
      ),
      body: '',
      draft: false,
      languageMode: getPersistedLanguageMode(),
      creationContext: null,
      creationContextLoading: false,
      selectedTemplatePath: '',
      reviewers: [],
      assignees: [],
      labels: [],
      milestone: null,
      titleEdited: false,
      bodyEdited: false,
      reviewedDraft: null,
      reviewedMetadata: null,
      error: null,
      successReceipt: null,
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
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    void this.loadCreationContext()
  }

  public componentWillUnmount() {
    this.mounted = false
    this.requestGeneration++
    this.contextRequestGeneration++
    this.request?.abort()
    this.contextRequest?.abort()
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public componentDidUpdate(
    prevProps: ICreateGitHubPullRequestDialogProps,
    prevState: ICreateGitHubPullRequestDialogState
  ) {
    if (
      prevState.targetHash !== this.state.targetHash ||
      prevState.accountKey !== this.state.accountKey ||
      prevState.baseBranchName !== this.state.baseBranchName
    ) {
      void this.loadCreationContext()
    }
    if (
      prevProps.repositoryContextCurrent &&
      !this.props.repositoryContextCurrent &&
      this.state.step !== 'success'
    ) {
      this.contextRequestGeneration++
      this.contextRequest?.abort()
      if (this.state.step === 'submitting') {
        this.request?.abort()
        this.setState({
          step: 'review',
          error: CancellationResultMessage,
          abortRequested: false,
        })
        return
      }
      if (
        this.state.creationContext !== null ||
        this.state.creationContextLoading
      ) {
        this.setState({
          creationContext: null,
          creationContextLoading: false,
        })
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
    if (this.state.step === 'submitting') {
      this.request?.abort()
      this.setState({
        step: 'review',
        error: CancellationResultMessage,
        abortRequested: false,
      })
      return
    }
    this.requestGeneration++
    this.contextRequestGeneration++
    this.request?.abort()
    this.contextRequest?.abort()
    this.props.onDismissed()
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }

  private tr = (key: TranslationKey, variables: TranslationVariables = {}) =>
    translate(key, this.state.languageMode, variables)

  private aria = (key: TranslationKey, variables: TranslationVariables = {}) =>
    translateForAccessibleName(key, variables, this.state.languageMode)

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
      target.baseBranches.find(
        branch => branch.name === this.state.baseBranchName
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
          this.props.currentBranch,
          this.props.sourceRemote,
          this.props.providerHTMLURL
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

  private loadCreationContext = async () => {
    const availability = this.getAvailability()
    this.contextRequestGeneration++
    this.contextRequest?.abort()
    if (
      availability.target === null ||
      availability.account === null ||
      availability.baseBranch === null ||
      availability.head === null ||
      this.state.step !== 'compose'
    ) {
      if (this.mounted) {
        this.setState({
          creationContext: null,
          creationContextLoading: false,
        })
      }
      return
    }

    const request = new AbortController()
    const generation = this.contextRequestGeneration
    this.contextRequest = request
    this.setState({
      creationContext: null,
      creationContextLoading: true,
      selectedTemplatePath: '',
      reviewers: [],
      assignees: [],
      labels: [],
      milestone: null,
      reviewedDraft: null,
      reviewedMetadata: null,
      error: null,
    })
    try {
      const context =
        await this.props.dispatcher.inspectGitHubPullRequestCreation(
          this.props.repository,
          availability.target.repository,
          availability.account,
          this.props.currentBranch,
          this.props.sourceRemote,
          this.props.providerHTMLURL,
          this.props.contextVersion,
          availability.baseBranch.name,
          request.signal
        )
      if (
        !this.mounted ||
        request.signal.aborted ||
        generation !== this.contextRequestGeneration
      ) {
        return
      }
      const template = context.templates[0]
      const applyTemplate = template !== undefined && !this.state.bodyEdited
      this.setState({
        creationContext: context,
        creationContextLoading: false,
        selectedTemplatePath: applyTemplate ? template.path : '',
        title:
          template !== undefined &&
          template.title !== '' &&
          !this.state.titleEdited
            ? template.title
            : this.state.title,
        body: applyTemplate ? template.body : this.state.body,
        draft: applyTemplate ? template.draft : this.state.draft,
        reviewers: applyTemplate ? template.metadata.reviewers : [],
        assignees: applyTemplate ? template.metadata.assignees : [],
        labels: applyTemplate ? template.metadata.labels : [],
        milestone: applyTemplate ? template.metadata.milestone ?? null : null,
      })
    } catch (error) {
      if (
        !this.mounted ||
        request.signal.aborted ||
        generation !== this.contextRequestGeneration
      ) {
        return
      }
      this.setState({
        creationContext: null,
        creationContextLoading: false,
        error:
          error instanceof GitHubPullRequestContextChangedError
            ? 'The repository or current branch changed. Close this dialog and start again.'
            : 'Desktop could not load the pull request creation options safely. Retry by reopening this dialog.',
      })
    } finally {
      if (this.contextRequest === request) {
        this.contextRequest = null
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
      reviewedDraft: null,
      reviewedMetadata: null,
    })
  }

  private onAccountChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({
      accountKey: event.currentTarget.value,
      error: null,
      reviewedDraft: null,
      reviewedMetadata: null,
    })

  private onBaseBranchChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({
      baseBranchName: event.currentTarget.value,
      error: null,
      reviewedDraft: null,
      reviewedMetadata: null,
    })

  private onTitleChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({
      title: event.currentTarget.value,
      titleEdited: true,
      error: null,
    })

  private onBodyChanged = (event: React.FormEvent<HTMLTextAreaElement>) =>
    this.setState({
      body: event.currentTarget.value,
      bodyEdited: true,
      error: null,
    })

  private onDraftChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ draft: event.currentTarget.checked, error: null })

  private selectedValues(event: React.FormEvent<HTMLSelectElement>) {
    return Array.from(
      event.currentTarget.selectedOptions,
      option => option.value
    )
  }

  private onTemplateChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    const path = event.currentTarget.value
    const template = this.state.creationContext?.templates.find(
      candidate => candidate.path === path
    )
    if (template === undefined) {
      this.setState({
        selectedTemplatePath: '',
        title: getDefaultGitHubPullRequestTitle(
          this.props.currentBranch.nameWithoutRemote
        ),
        body: '',
        draft: false,
        reviewers: [],
        assignees: [],
        labels: [],
        milestone: null,
        titleEdited: false,
        bodyEdited: false,
        error: null,
      })
      return
    }
    this.setState({
      selectedTemplatePath: template.path,
      title:
        template.title ||
        getDefaultGitHubPullRequestTitle(
          this.props.currentBranch.nameWithoutRemote
        ),
      body: template.body,
      draft: template.draft,
      reviewers: template.metadata.reviewers,
      assignees: template.metadata.assignees,
      labels: template.metadata.labels,
      milestone: template.metadata.milestone ?? null,
      titleEdited: false,
      bodyEdited: false,
      error: null,
    })
  }

  private onReviewersChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({ reviewers: this.selectedValues(event), error: null })

  private onAssigneesChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({ assignees: this.selectedValues(event), error: null })

  private onLabelsChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({ labels: this.selectedValues(event), error: null })

  private onMilestoneChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({
      milestone:
        event.currentTarget.value === ''
          ? null
          : Number(event.currentTarget.value),
      error: null,
    })

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
    if (
      this.state.creationContextLoading ||
      this.state.creationContext === null
    ) {
      this.setState({
        error: 'Wait for the bounded pull request creation options to load.',
      })
      return
    }

    try {
      const draft = normalizeGitHubPullRequestDraft(
        this.state.title,
        this.state.body,
        availability.head,
        availability.baseBranch.name,
        this.state.draft
      )
      const metadata = normalizeGitHubPullRequestMetadata(
        this.state.reviewers,
        this.state.assignees,
        this.state.labels,
        this.state.milestone === null ? undefined : this.state.milestone
      )
      this.setState({
        step: 'review',
        title: draft.title,
        body: draft.body,
        baseBranchName: draft.base,
        reviewedDraft: draft,
        reviewedMetadata: metadata,
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
      this.setState({
        step: 'compose',
        reviewedDraft: null,
        reviewedMetadata: null,
        error: null,
      })
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

    const draft = this.state.reviewedDraft
    const metadata = this.state.reviewedMetadata
    if (
      draft === null ||
      metadata === null ||
      draft.head !== availability.head ||
      draft.base !== availability.baseBranch.name
    ) {
      this.setState({
        step: 'compose',
        reviewedDraft: null,
        reviewedMetadata: null,
        error: 'The reviewed pull request route changed. Review it again.',
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
          this.props.sourceRemote,
          this.props.providerHTMLURL,
          this.props.contextVersion,
          draft,
          metadata,
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
        successReceipt: {
          created: createdPullRequest,
          targetName: availability.target.repository.fullName,
          accountLogin: availability.account.login,
          reviewed: draft,
          metadata,
        },
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
      error: CancellationResultMessage,
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
      this.props.sourceRemote,
      availability.baseBranch?.name,
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
    const receipt = this.state.successReceipt
    if (receipt === null) {
      return
    }
    const opened = await this.props.dispatcher.openInBrowser(
      receipt.created.url
    )
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
                <span>{this.tr('prCreate.targetRepository')}</span>
                <select
                  aria-label={this.aria('prCreate.targetRepository')}
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
              {this.tr(
                availability.browserFallbackAllowed
                  ? 'prCreate.cancel'
                  : 'prCreate.close'
              )}
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
    const baseBranches = target.baseBranches
    const eligibleAccounts = getEligibleAccounts(this.props.accounts, target)
    const titleRemaining =
      GitHubPullRequestTitleMaximumLength - this.state.title.length
    const bodyRemaining =
      GitHubPullRequestBodyMaximumLength - this.state.body.length
    const context = this.state.creationContext
    const selectedTemplate = context?.templates.find(
      template => template.path === this.state.selectedTemplatePath
    )
    const reviewerOptions = new Set([
      ...(context?.reviewers ?? []),
      ...this.state.reviewers,
    ])
    const assigneeOptions = new Set([
      ...(context?.assignees ?? []),
      ...this.state.assignees,
    ])
    const labelOptions = new Set([
      ...(context?.labels.map(label => label.name) ?? []),
      ...this.state.labels,
    ])
    const unavailable = (kind: string) =>
      context?.unavailable.includes(kind as never)
    const capped = (kind: string) => context?.capped.includes(kind as never)

    return (
      <>
        <DialogContent className="create-github-pull-request-content">
          <div className="create-github-pull-request-routing">
            <label className="create-github-pull-request-field">
              <span>{this.tr('prCreate.targetRepository')}</span>
              <select
                aria-label={this.aria('prCreate.targetRepository')}
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
              <span>{this.tr('prCreate.account')}</span>
              <select
                aria-label={this.aria('prCreate.account')}
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
              <span>{this.tr('prCreate.baseBranch')}</span>
              <select
                aria-label={this.aria('prCreate.baseBranch')}
                value={this.state.baseBranchName}
                onChange={this.onBaseBranchChanged}
              >
                {baseBranches.map(branch => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <div
              className="create-github-pull-request-head"
              role="group"
              aria-label={this.aria('prCreate.headBranch')}
            >
              <span>{this.tr('prCreate.headBranch')}</span>
              <strong>{head}</strong>
              <small>
                {this.tr('prCreate.currentBranch', {
                  branch: this.props.currentBranch.name,
                })}
              </small>
            </div>
          </div>
          {this.state.creationContextLoading && (
            <div
              className="create-github-pull-request-options-status"
              role="status"
            >
              {this.tr('prCreate.loadingOptions')}
            </div>
          )}
          {context !== null && (
            <>
              <label className="create-github-pull-request-field">
                <span>{this.tr('prCreate.template')}</span>
                <select
                  aria-label={this.aria('prCreate.template')}
                  value={this.state.selectedTemplatePath}
                  onChange={this.onTemplateChanged}
                >
                  <option value="">{this.tr('prCreate.noTemplate')}</option>
                  {context.templates.map(template => (
                    <option key={template.path} value={template.path}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              {(context.warnings.length > 0 ||
                context.unavailable.length > 0) && (
                <div
                  className="create-github-pull-request-options-warning"
                  role="status"
                >
                  <strong>{this.tr('prCreate.optionalWarning')}</strong>
                  {context.warnings.map((warning, index) => (
                    <span key={`${index}-${warning}`}>{warning}</span>
                  ))}
                </div>
              )}
              {selectedTemplate?.warnings.map((warning, index) => (
                <small
                  className="create-github-pull-request-template-warning"
                  key={`${index}-${warning}`}
                >
                  {this.tr('prCreate.templateNotice', { notice: warning })}
                </small>
              ))}
            </>
          )}
          <label className="create-github-pull-request-field">
            <span>{this.tr('prCreate.titleField')}</span>
            <input
              className={DialogPreferredFocusClassName}
              type="text"
              value={this.state.title}
              maxLength={GitHubPullRequestTitleMaximumLength}
              required={true}
              autoFocus={true}
              aria-label={this.aria('prCreate.titleField')}
              aria-describedby="create-github-pull-request-title-count"
              ref={this.setTitleInput}
              onChange={this.onTitleChanged}
            />
            <small id="create-github-pull-request-title-count">
              {this.tr('prCreate.charactersRemaining', {
                count: `${titleRemaining}`,
              })}
            </small>
          </label>
          <label className="create-github-pull-request-field">
            <span>{this.tr('prCreate.descriptionField')}</span>
            <textarea
              value={this.state.body}
              maxLength={GitHubPullRequestBodyMaximumLength}
              rows={7}
              aria-label={this.aria('prCreate.descriptionField')}
              aria-describedby="create-github-pull-request-body-count"
              onChange={this.onBodyChanged}
            />
            <small id="create-github-pull-request-body-count">
              {this.tr('prCreate.charactersRemaining', {
                count: `${bodyRemaining}`,
              })}{' '}
              · {this.tr('prCreate.markdownSupported')}
            </small>
          </label>
          <Checkbox
            className="create-github-pull-request-draft"
            label={this.tr('prCreate.draftAction')}
            value={this.state.draft ? CheckboxValue.On : CheckboxValue.Off}
            onChange={this.onDraftChanged}
          />
          {context !== null && (
            <div className="create-github-pull-request-metadata">
              <label className="create-github-pull-request-field">
                <span>{this.tr('prCreate.reviewers')}</span>
                <select
                  multiple={true}
                  size={Math.min(4, Math.max(2, reviewerOptions.size))}
                  aria-label={this.aria('prCreate.reviewers')}
                  value={[...this.state.reviewers]}
                  disabled={unavailable('reviewers')}
                  onChange={this.onReviewersChanged}
                >
                  {[...reviewerOptions].map(login => (
                    <option key={login} value={login}>
                      {login}
                    </option>
                  ))}
                </select>
                {(unavailable('reviewers') || capped('reviewers')) && (
                  <small>
                    {this.tr(
                      unavailable('reviewers')
                        ? 'prCreate.choiceUnavailable'
                        : 'prCreate.choiceCapped'
                    )}
                  </small>
                )}
              </label>
              <label className="create-github-pull-request-field">
                <span>{this.tr('prCreate.assignees')}</span>
                <select
                  multiple={true}
                  size={Math.min(4, Math.max(2, assigneeOptions.size))}
                  aria-label={this.aria('prCreate.assignees')}
                  value={[...this.state.assignees]}
                  disabled={unavailable('assignees')}
                  onChange={this.onAssigneesChanged}
                >
                  {[...assigneeOptions].map(login => (
                    <option key={login} value={login}>
                      {login}
                    </option>
                  ))}
                </select>
                {(unavailable('assignees') || capped('assignees')) && (
                  <small>
                    {this.tr(
                      unavailable('assignees')
                        ? 'prCreate.choiceUnavailable'
                        : 'prCreate.choiceCapped'
                    )}
                  </small>
                )}
              </label>
              <label className="create-github-pull-request-field">
                <span>{this.tr('prCreate.labels')}</span>
                <select
                  multiple={true}
                  size={Math.min(4, Math.max(2, labelOptions.size))}
                  aria-label={this.aria('prCreate.labels')}
                  value={[...this.state.labels]}
                  disabled={unavailable('labels')}
                  onChange={this.onLabelsChanged}
                >
                  {[...labelOptions].map(label => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
                {(unavailable('labels') || capped('labels')) && (
                  <small>
                    {this.tr(
                      unavailable('labels')
                        ? 'prCreate.choiceUnavailable'
                        : 'prCreate.choiceCapped'
                    )}
                  </small>
                )}
              </label>
              <label className="create-github-pull-request-field">
                <span>{this.tr('prCreate.milestone')}</span>
                <select
                  aria-label={this.aria('prCreate.milestone')}
                  value={this.state.milestone ?? ''}
                  disabled={unavailable('milestones')}
                  onChange={this.onMilestoneChanged}
                >
                  <option value="">{this.tr('prCreate.none')}</option>
                  {context.milestones.map(milestone => (
                    <option key={milestone.number} value={milestone.number}>
                      {milestone.title}
                    </option>
                  ))}
                  {this.state.milestone !== null &&
                    !context.milestones.some(
                      milestone => milestone.number === this.state.milestone
                    ) && (
                      <option value={this.state.milestone}>
                        #{this.state.milestone}
                      </option>
                    )}
                </select>
                {(unavailable('milestones') || capped('milestones')) && (
                  <small>
                    {this.tr(
                      unavailable('milestones')
                        ? 'prCreate.choiceUnavailable'
                        : 'prCreate.choiceCapped'
                    )}
                  </small>
                )}
              </label>
            </div>
          )}
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            <Button type="button" onClick={this.onDismissed}>
              {this.tr('prCreate.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                this.state.title.trim() === '' ||
                this.state.creationContextLoading ||
                this.state.creationContext === null
              }
            >
              {this.tr('prCreate.reviewAction')}
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
    const metadata = this.state.reviewedMetadata
    const none = this.tr('prCreate.none')
    const milestone =
      metadata?.milestone === undefined || metadata.milestone === null
        ? none
        : this.state.creationContext?.milestones.find(
            candidate => candidate.number === metadata.milestone
          )?.title ?? `#${metadata.milestone}`
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
            <span>
              {this.tr(
                this.state.draft
                  ? 'prCreate.draftStatus'
                  : 'prCreate.readyStatus'
              )}
            </span>
          </div>
          <div className="create-github-pull-request-review">
            <span className="create-github-pull-request-eyebrow">
              {this.tr('prCreate.titleField')}
            </span>
            <h2>{this.state.title}</h2>
            <span className="create-github-pull-request-eyebrow">
              {this.tr('prCreate.description')}
            </span>
            <div className="create-github-pull-request-review-body">
              {this.state.body === '' ? (
                <em>{this.tr('prCreate.noDescription')}</em>
              ) : (
                this.state.body
              )}
            </div>
            {metadata !== null && (
              <div
                className="create-github-pull-request-review-metadata"
                role="group"
                aria-label={this.aria('prCreate.metadataSummary', {
                  reviewers: metadata.reviewers.join(', ') || none,
                  assignees: metadata.assignees.join(', ') || none,
                  labels: metadata.labels.join(', ') || none,
                  milestone,
                })}
              >
                <span>
                  {this.tr('prCreate.reviewers')}:{' '}
                  {metadata.reviewers.join(', ') || none}
                </span>
                <span>
                  {this.tr('prCreate.assignees')}:{' '}
                  {metadata.assignees.join(', ') || none}
                </span>
                <span>
                  {this.tr('prCreate.labels')}:{' '}
                  {metadata.labels.join(', ') || none}
                </span>
                <span>
                  {this.tr('prCreate.milestone')}: {milestone}
                </span>
              </div>
            )}
          </div>
          <p id="create-github-pull-request-confirmation">
            {this.tr('prCreate.confirmation', {
              status: bilingualVariable(
                this.state.draft ? 'draft' : 'ready-for-review',
                this.state.draft ? '草稿' : '準備覆核'
              ),
              target: target.repository.fullName,
              account: account.login,
            })}
          </p>
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            <Button type="button" onClick={this.edit}>
              {this.tr('prCreate.backToEdit')}
            </Button>
            <Button
              type="submit"
              autoFocus={true}
              ariaDescribedBy="create-github-pull-request-confirmation"
              onButtonRef={this.setReviewButton}
            >
              {this.tr(
                this.state.draft
                  ? 'prCreate.createDraftAction'
                  : 'prCreate.createAction'
              )}
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
            <strong>{this.tr('prCreate.creating')}</strong>
            <span>
              {this.tr('prCreate.waitingFor', { target: targetName })}
            </span>
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
              {this.tr(
                this.state.abortRequested
                  ? 'prCreate.canceling'
                  : 'prCreate.cancelRequest'
              )}
            </Button>
          </div>
        </DialogFooter>
      </>
    )
  }

  private renderSuccess() {
    const receipt = this.state.successReceipt
    if (receipt === null) {
      return null
    }
    const { created, reviewed, metadata } = receipt
    const none = this.tr('prCreate.none')
    return (
      <>
        <DialogContent className="create-github-pull-request-content">
          <div className="create-github-pull-request-success" role="status">
            <strong>
              {this.tr(
                reviewed.draft ? 'prCreate.draftCreated' : 'prCreate.created',
                { number: `${created.number}` }
              )}
            </strong>
            <span>{receipt.targetName}</span>
            <span>
              {reviewed.head} → {reviewed.base}
            </span>
            <span>
              {receipt.accountLogin} ·{' '}
              {this.tr(
                reviewed.draft ? 'prCreate.draftStatus' : 'prCreate.readyStatus'
              )}
            </span>
            <p>{reviewed.title}</p>
            {reviewed.body !== '' && (
              <div className="create-github-pull-request-review-body">
                {reviewed.body}
              </div>
            )}
            <span>
              {this.tr('prCreate.metadataSummary', {
                reviewers: metadata.reviewers.join(', ') || none,
                assignees: metadata.assignees.join(', ') || none,
                labels: metadata.labels.join(', ') || none,
                milestone:
                  metadata.milestone === undefined ||
                  metadata.milestone === null
                    ? none
                    : `#${metadata.milestone}`,
              })}
            </span>
            {created.metadataWarnings !== undefined &&
              created.metadataWarnings.length > 0 && (
                <div
                  className="create-github-pull-request-partial-success"
                  role="status"
                >
                  <strong>{this.tr('prCreate.partialSuccess')}</strong>
                  <ul>
                    {created.metadataWarnings.map(warning => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
          </div>
        </DialogContent>
        <DialogFooter>
          <div className="button-group">
            <Button type="button" onClick={this.onDismissed}>
              {this.tr('prCreate.done')}
            </Button>
            <Button
              type="button"
              autoFocus={true}
              onButtonRef={this.setOpenCreatedPullRequestButton}
              onClick={this.onOpenCreatedPullRequest}
            >
              {this.tr('prCreate.openOnGitHub')}
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
        ? this.tr('prCreate.reviewTitle')
        : this.state.step === 'success'
        ? this.tr('prCreate.successTitle')
        : this.tr('prCreate.title')

    let content: JSX.Element | null
    if (this.state.step === 'success' && this.state.successReceipt !== null) {
      content = this.renderSuccess()
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
        dismissDisabled={this.state.step === 'submitting'}
      >
        {this.state.error !== null && (
          <DialogError>{this.state.error}</DialogError>
        )}
        {content}
      </Dialog>
    )
  }
}
