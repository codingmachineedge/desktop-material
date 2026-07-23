import * as React from 'react'
import classNames from 'classnames'
import {
  AutocompletingTextArea,
  AutocompletingInput,
  IAutocompletionProvider,
  CoAuthorAutocompletionProvider,
} from '../autocompletion'
import { CommitIdentity } from '../../models/commit-identity'
import {
  DefaultCommitMessage,
  ICommitMessage,
} from '../../models/commit-message'
import { Repository } from '../../models/repository'
import { Button } from '../lib/button'
import { Loading } from '../lib/loading'
import { AuthorInput } from '../lib/author-input/author-input'
import { FocusContainer } from '../lib/focus-container'
import { MaterialSymbol } from '../lib/material-symbol'
import { Author, UnknownAuthor, isKnownAuthor } from '../../models/author'
import { IMenuItem } from '../../lib/menu-item'
import { Commit, ICommitContext } from '../../models/commit'
import { startTimer } from '../lib/timing'
import { CommitWarning, CommitWarningIcon } from './commit-warning'
import { LinkButton } from '../lib/link-button'
import {
  CommitOperationPhase,
  CommitOptions,
  Foldout,
  FoldoutType,
} from '../../lib/app-state'
import { IAvatarUser, getAvatarUserFromAuthor } from '../../models/avatar'
import { showContextualMenu } from '../../lib/menu-item'
import { Account, isEnterpriseAccount } from '../../models/account'
import {
  CommitMessageAvatar,
  CommitMessageAvatarWarningType,
} from './commit-message-avatar'
import {
  getStealthEmailForUser,
  isAttributableEmailFor,
  lookupPreferredEmail,
} from '../../lib/email'
import {
  formatConfigPath,
  formatConfigScope,
  getConfigValueWithOrigin,
  IConfigValueOrigin,
  setGlobalConfigValue,
} from '../../lib/git/config'
import { Popup, PopupType } from '../../models/popup'
import { RepositorySettingsTab } from '../repository-settings/repository-settings'
import { IdealSummaryLength } from '../../lib/wrap-rich-text-commit-message'
import { isEmptyOrWhitespace } from '../../lib/is-empty-or-whitespace'
import { TooltipDirection } from '../lib/tooltip'
import { ToggledtippedContent } from '../lib/toggletipped-content'
import { TooltippedContent } from '../lib/tooltipped-content'
import { PreferencesTab } from '../../models/preferences'
import {
  RepoRuleEnforced,
  RepoRulesInfo,
  RepoRulesMetadataFailures,
} from '../../models/repo-rules'
import { IAheadBehind } from '../../models/branch'
import {
  Popover,
  PopoverAnchorPosition,
  PopoverDecoration,
} from '../lib/popover'
import { RepoRulesetsForBranchLink } from '../repository-rules/repo-rulesets-for-branch-link'
import { RepoRulesMetadataFailureList } from '../repository-rules/repo-rules-failure-list'
import { formatCommitMessage } from '../../lib/format-commit-message'
import { useRepoRulesLogic } from '../../lib/helpers/repo-rules'
import { isDotCom } from '../../lib/endpoint-capabilities'
import { WorkingDirectoryFileChange } from '../../models/status'
import {
  enableCommitMessageGeneration,
  enableCopilotSdkCommitMessageGeneration,
  enableHooksEnvironment,
} from '../../lib/feature-flag'
import { getAccountForCommitMessageGeneration } from '../../lib/get-account-for-repository'
import { AriaLiveContainer } from '../accessibility/aria-live-container'
import { HookProgress } from '../../lib/git'
import { assertNever } from '../../lib/fatal-error'
import { getShowCommitAuthorInfo } from '../../models/commit-author-display'
import {
  bilingualVariable,
  t,
  translate,
  translateForAccessibleName,
  translatedVariable,
} from '../../lib/i18n'
import { formatBytes } from '../lib/bytes'
import type {
  CheapLfsAutoPinPhase,
  ICheapLfsAutoPinProgress,
} from '../../lib/cheap-lfs/operations'

const CheapLfsTerminalPathMaximumLength = 160

interface ICheapLfsDisplayProgress {
  readonly completedFiles: number
  readonly succeededFiles: number
  readonly failedFiles: number
  readonly totalFiles: number
  readonly currentPath: string | null
  readonly transferredBytes: number
  readonly totalBytes: number
  readonly percentage: number | null
  readonly activeFiles: ReadonlyArray<ICheapLfsDisplayActiveFile>
  readonly selectedStorageProvider: string | null
  readonly recommendedStorageProvider: string | null
  readonly estimatedRegistryLayers: number | null
}

interface ICheapLfsDisplayActiveFile {
  readonly path: string
  readonly phase: CheapLfsAutoPinPhase
  readonly processedBytes: number
  readonly totalBytes: number
  readonly percentage: number | null
}

export interface ICheapLfsTransferTimingSample {
  readonly repositoryId: number
  readonly operationStartedAt: number
  readonly rateStartedAt: number
  readonly rateInitialTransferredBytes: number
  readonly lastObservedAt: number
  readonly phase: CheapLfsAutoPinPhase
  readonly completedFiles: number
  readonly totalBytes: number
  readonly totalFiles: number
  readonly lastTransferredBytes: number
}

interface ICheapLfsDisplayTiming {
  readonly elapsedMilliseconds: number
  readonly bytesPerSecond: number | null
  readonly etaMilliseconds: number | null
}

/** Keep untrusted progress values finite and inside the range the UI promises. */
function boundedWholeNumber(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }

  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value))
}

/**
 * Strip terminal control characters and cap path output before putting it in
 * the terminal-like surface. React still performs the final HTML escaping.
 */
function sanitizeCheapLfsTerminalPath(path: string | null): string | null {
  if (path === null) {
    return null
  }

  const normalized = path
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized.length === 0) {
    return null
  }

  const characters = Array.from(normalized)
  if (characters.length <= CheapLfsTerminalPathMaximumLength) {
    return normalized
  }

  return `${characters
    .slice(0, CheapLfsTerminalPathMaximumLength - 1)
    .join('')}…`
}

function normalizeCheapLfsDisplayProgress(
  progress: ICheapLfsAutoPinProgress
): ICheapLfsDisplayProgress {
  const totalFiles = boundedWholeNumber(progress.totalFiles)
  const completedFiles = Math.min(
    totalFiles,
    boundedWholeNumber(progress.completedFiles)
  )
  const totalBytes = boundedWholeNumber(progress.totalBytes)
  const transferredBytes =
    totalBytes === 0
      ? 0
      : Math.min(totalBytes, boundedWholeNumber(progress.transferredBytes))
  const percentage =
    totalBytes === 0
      ? null
      : Math.min(100, Math.floor((transferredBytes / totalBytes) * 100))
  const failedFiles = Math.min(
    completedFiles,
    boundedWholeNumber(progress.failedFiles ?? 0)
  )
  const succeededFiles = Math.min(
    completedFiles - failedFiles,
    boundedWholeNumber(
      progress.succeededFiles ?? Math.max(0, completedFiles - failedFiles)
    )
  )
  const activeFiles = (progress.activeFiles ?? [])
    .slice(0, 3)
    .map(file => {
      const path = sanitizeCheapLfsTerminalPath(file.relativePath)
      const fileTotalBytes = boundedWholeNumber(file.totalBytes)
      const processedBytes =
        fileTotalBytes === 0
          ? 0
          : Math.min(fileTotalBytes, boundedWholeNumber(file.processedBytes))
      return path === null
        ? null
        : {
            path,
            phase: file.phase,
            processedBytes,
            totalBytes: fileTotalBytes,
            percentage:
              fileTotalBytes === 0
                ? null
                : Math.min(
                    100,
                    Math.floor((processedBytes / fileTotalBytes) * 100)
                  ),
          }
    })
    .filter((file): file is ICheapLfsDisplayActiveFile => file !== null)

  return {
    completedFiles,
    succeededFiles,
    failedFiles,
    totalFiles,
    currentPath: sanitizeCheapLfsTerminalPath(progress.currentPath),
    transferredBytes,
    totalBytes,
    percentage,
    activeFiles,
    selectedStorageProvider: progress.selectedStorageProvider ?? null,
    recommendedStorageProvider: progress.recommendedStorageProvider ?? null,
    estimatedRegistryLayers:
      progress.estimatedRegistryLayers === undefined
        ? null
        : boundedWholeNumber(progress.estimatedRegistryLayers),
  }
}

function formatCheapLfsBytes(bytes: number): string {
  return bytes === 0 ? '0 B' : formatBytes(bytes, 1)
}

function formatCheapLfsDuration(milliseconds: number): string {
  const totalSeconds = Number.isFinite(milliseconds)
    ? Math.max(0, Math.floor(milliseconds / 1_000))
    : 0
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes === 0) {
    return `${seconds}s`
  }

  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  return hours === 0
    ? `${minutes}m ${seconds}s`
    : `${hours}h ${minutes}m ${seconds}s`
}

function formatCheapLfsRate(bytesPerSecond: number): string | null {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return null
  }

  return bytesPerSecond < 1
    ? '<1 B/s'
    : `${formatCheapLfsBytes(Math.max(1, Math.floor(bytesPerSecond)))}/s`
}

interface ICreateCommitOptions {
  warnUnknownAuthors: boolean
  warnFilesNotVisible: boolean
}

interface ICommitMessageProps {
  readonly onCreateCommit: (context: ICommitContext) => Promise<boolean>
  readonly branch: string | null
  readonly commitAuthor: CommitIdentity | null
  readonly anyFilesSelected: boolean
  readonly filesToBeCommittedCount?: number
  /** Whether the user can see all the files to commit in the changes list. They
   * may not be able to if the list is filtered */
  readonly showPromptForCommittingFileHiddenByFilter?: boolean
  readonly isShowingModal: boolean
  readonly isShowingFoldout: boolean

  /**
   * Whether it's possible to select files for commit, affects messaging
   * when commit button is disabled
   */
  readonly anyFilesAvailable: boolean
  readonly filesSelected: ReadonlyArray<WorkingDirectoryFileChange>
  readonly focusCommitMessage: boolean
  readonly commitMessage: ICommitMessage | null
  readonly repository: Repository
  readonly repositoryAccount: Account | null
  readonly autocompletionProviders: ReadonlyArray<IAutocompletionProvider<any>>
  readonly isCommitting?: boolean
  readonly commitOperationPhase: CommitOperationPhase | null
  readonly hookProgress: HookProgress | null
  readonly onShowCommitProgress: (() => void) | undefined
  readonly onManualCheapLfsUpload?: () => void
  readonly onCancelCheapLfsCommit?: () => void
  readonly isGeneratingCommitMessage?: boolean
  readonly shouldShowGenerateCommitMessageCallOut?: boolean
  readonly commitToAmend: Commit | null
  readonly placeholder: string
  readonly prepopulateCommitSummary: boolean
  readonly showBranchProtected: boolean
  readonly repoRulesInfo: RepoRulesInfo
  readonly aheadBehind: IAheadBehind | null
  readonly showNoWriteAccess: boolean

  /**
   * Whether or not to show a field for adding co-authors to
   * a commit (currently only supported for GH/GHE repositories)
   */
  readonly showCoAuthoredBy: boolean

  /**
   * Whether or not to show a input labels (Default: false)
   */
  readonly showInputLabels?: boolean

  /**
   * A list of authors (name, email pairs) which have been
   * entered into the co-authors input box in the commit form
   * and which _may_ be used in the subsequent commit to add
   * Co-Authored-By commit message trailers depending on whether
   * the user has chosen to do so.
   */
  readonly coAuthors: ReadonlyArray<Author>

  /** Whether this component should show its onboarding tutorial nudge arrow */
  readonly shouldNudge?: boolean

  readonly commitSpellcheckEnabled: boolean

  readonly showCommitLengthWarning: boolean

  /** Optional text to override default commit button text */
  readonly commitButtonText?: string

  readonly mostRecentLocalCommit: Commit | null

  /** Whether or not to remember the coauthors in the changes state */
  readonly onCoAuthorsUpdated: (coAuthors: ReadonlyArray<Author>) => void
  readonly onShowCoAuthoredByChanged: (showCoAuthoredBy: boolean) => void
  readonly onConfirmCommitWithUnknownCoAuthors: (
    coAuthors: ReadonlyArray<UnknownAuthor>,
    onCommitAnyway: () => void
  ) => void

  /**
   * Called when the component unmounts to give callers the ability
   * to persist the commit message (i.e. when switching between changes
   * and history view).
   */
  readonly onPersistCommitMessage?: (message: ICommitMessage) => void

  readonly onGenerateCommitMessage?: (
    filesSelected: ReadonlyArray<WorkingDirectoryFileChange>,
    mustOverrideExistingMessage: boolean
  ) => void

  readonly onCancelGenerateCommitMessage?: () => void

  /**
   * Called when the component has given the commit message focus due to
   * `focusCommitMessage` being set. Used to reset the `focusCommitMessage`
   * prop.
   */
  readonly onCommitMessageFocusSet: () => void

  /**
   * Called when the user email in Git config has been updated to refresh
   * the repository state.
   */
  readonly onRefreshAuthor: () => void

  readonly onShowPopup: (popup: Popup) => void
  readonly onShowFoldout: (foldout: Foldout) => void
  readonly onCommitSpellcheckEnabledChanged: (enabled: boolean) => void
  readonly onStopAmending: () => void
  readonly onShowCreateForkDialog: () => void
  readonly onFilesToCommitNotVisible?: (onCommitAnyway: () => {}) => void
  readonly onSuccessfulCommitCreated?: () => void
  readonly accounts: ReadonlyArray<Account>

  /** Optional to add an id to a message that should be provided as an aria
   * description of the submit button */
  readonly submitButtonAriaDescribedBy?: string

  /**
   * Whether or not to skip blocking commit hooks when creating commits
   * by means of passing the `--no-verify` flag to git commit
   */
  readonly skipCommitHooks: boolean

  /**
   * Whether or not to add a `Signed-off-by` trailer to commit messages
   * by means of passing the `--signoff` flag to git commit
   */
  readonly signOffCommits: boolean

  /**
   * Whether or not to allow creating a commit without any file changes
   * by means of passing the `--allow-empty` flag to git commit.
   * This option resets to false after each commit.
   */
  readonly allowEmptyCommit: boolean

  /**
   * Whether or not to show the "Allow empty commit" option in the commit
   * options context menu. Should be false when the CommitMessage component
   * is used in contexts where empty commits are not applicable, such as the
   * squash commit dialog.
   */
  readonly showAllowEmptyCommitOption?: boolean

  /** Callback to set commit options for the given repository */
  readonly onUpdateCommitOptions: (
    repository: Repository,
    options: Partial<CommitOptions>
  ) => void
}

function getCheapLfsTimingProgress(
  props: ICommitMessageProps
): ICheapLfsAutoPinProgress | null {
  return props.isCommitting && props.commitOperationPhase?.kind === 'cheap-lfs'
    ? props.commitOperationPhase.progress
    : null
}

/**
 * Advance the renderer-observed upload clock without mutating during render.
 * Operation duration survives OCI phase/total changes, while rate and ETA use
 * a narrower baseline that resets when the byte stream changes shape.
 */
export function advanceCheapLfsTransferTiming(
  previous: ICheapLfsTransferTimingSample | null,
  repositoryId: number,
  progress: ICheapLfsAutoPinProgress | null,
  now: number
): ICheapLfsTransferTimingSample | null {
  if (progress === null) {
    return null
  }

  const display = normalizeCheapLfsDisplayProgress(progress)
  const hasValidClock = Number.isFinite(now) && now >= 0
  const safeNow = hasValidClock ? now : previous?.lastObservedAt ?? 0

  if (previous === null || previous.repositoryId !== repositoryId) {
    return {
      repositoryId,
      operationStartedAt: safeNow,
      rateStartedAt: safeNow,
      rateInitialTransferredBytes: display.transferredBytes,
      lastObservedAt: safeNow,
      phase: progress.phase,
      completedFiles: display.completedFiles,
      totalBytes: display.totalBytes,
      totalFiles: display.totalFiles,
      lastTransferredBytes: display.transferredBytes,
    }
  }

  const clockRegressed = !hasValidClock || safeNow < previous.lastObservedAt
  const observedAt = clockRegressed ? previous.lastObservedAt : safeNow
  const resetRate =
    clockRegressed ||
    previous.phase !== progress.phase ||
    previous.completedFiles !== display.completedFiles ||
    previous.totalBytes !== display.totalBytes ||
    previous.totalFiles !== display.totalFiles ||
    display.transferredBytes < previous.lastTransferredBytes

  return {
    repositoryId,
    operationStartedAt: previous.operationStartedAt,
    rateStartedAt: resetRate ? observedAt : previous.rateStartedAt,
    rateInitialTransferredBytes: resetRate
      ? display.transferredBytes
      : previous.rateInitialTransferredBytes,
    lastObservedAt: observedAt,
    phase: progress.phase,
    completedFiles: display.completedFiles,
    totalBytes: display.totalBytes,
    totalFiles: display.totalFiles,
    lastTransferredBytes: display.transferredBytes,
  }
}

interface ICommitMessageState {
  readonly commitMessage: ICommitMessage

  readonly cheapLfsTransferTiming: ICheapLfsTransferTimingSample | null

  readonly commitMessageAutocompletionProviders: ReadonlyArray<
    IAutocompletionProvider<any>
  >
  readonly coAuthorAutocompletionProvider: CoAuthorAutocompletionProvider | null

  /**
   * Whether or not the description text area has more text that's
   * obscured by the action bar. Note that this will always be
   * false when there's no action bar.
   */
  readonly descriptionObscured: boolean

  readonly isCommittingStatusMessage: string

  readonly repoRulesEnabled: boolean

  readonly isRuleFailurePopoverOpen: boolean

  readonly repoRuleCommitMessageFailures: RepoRulesMetadataFailures
  readonly repoRuleCommitAuthorFailures: RepoRulesMetadataFailures
  readonly repoRuleBranchNameFailures: RepoRulesMetadataFailures
  readonly commitAuthorNameOrigin: IConfigValueOrigin | null
  readonly commitAuthorEmailOrigin: IConfigValueOrigin | null
}

function findCommitMessageAutoCompleteProvider(
  providers: ReadonlyArray<IAutocompletionProvider<any>>
): ReadonlyArray<IAutocompletionProvider<any>> {
  return providers.filter(
    provider => !(provider instanceof CoAuthorAutocompletionProvider)
  )
}

function findCoAuthorAutoCompleteProvider(
  providers: ReadonlyArray<IAutocompletionProvider<any>>
): CoAuthorAutocompletionProvider | null {
  for (const provider of providers) {
    if (provider instanceof CoAuthorAutocompletionProvider) {
      return provider
    }
  }

  return null
}

export class CommitMessage extends React.Component<
  ICommitMessageProps,
  ICommitMessageState
> {
  private descriptionComponent: AutocompletingTextArea | null = null

  private wrapperRef = React.createRef<HTMLDivElement>()
  private summaryGroupRef = React.createRef<HTMLDivElement>()
  private summaryTextInput: HTMLInputElement | null = null

  private descriptionTextArea: HTMLTextAreaElement | null = null
  private descriptionTextAreaScrollDebounceId: number | null = null
  private cheapLfsTimingIntervalId: number | null = null

  private coAuthorInputRef = React.createRef<AuthorInput>()

  private readonly COMMIT_MSG_ERROR_BTN_ID = 'commit-message-failure-hint'

  public constructor(props: ICommitMessageProps) {
    super(props)
    const { commitMessage } = this.props

    this.state = {
      commitMessage: commitMessage ?? DefaultCommitMessage,
      cheapLfsTransferTiming: advanceCheapLfsTransferTiming(
        null,
        props.repository.id,
        getCheapLfsTimingProgress(props),
        Date.now()
      ),
      commitMessageAutocompletionProviders:
        findCommitMessageAutoCompleteProvider(props.autocompletionProviders),
      coAuthorAutocompletionProvider: findCoAuthorAutoCompleteProvider(
        props.autocompletionProviders
      ),
      descriptionObscured: false,
      isCommittingStatusMessage: '',
      repoRulesEnabled: false,
      isRuleFailurePopoverOpen: false,
      repoRuleCommitMessageFailures: new RepoRulesMetadataFailures(),
      repoRuleCommitAuthorFailures: new RepoRulesMetadataFailures(),
      repoRuleBranchNameFailures: new RepoRulesMetadataFailures(),
      commitAuthorNameOrigin: null,
      commitAuthorEmailOrigin: null,
    }
  }

  // Persist our current commit message if the caller wants to
  public componentWillUnmount() {
    const { props, state } = this
    props.onPersistCommitMessage?.(state.commitMessage)
    window.removeEventListener('keydown', this.onKeyDown)
    if (this.cheapLfsTimingIntervalId !== null) {
      window.clearInterval(this.cheapLfsTimingIntervalId)
      this.cheapLfsTimingIntervalId = null
    }
  }

  public async componentDidMount() {
    window.addEventListener('keydown', this.onKeyDown)
    this.syncCheapLfsTimingInterval()
    await Promise.all([
      this.updateRepoRuleFailures(undefined, undefined, true),
      this.loadCommitAuthorOrigins(),
    ])
  }

  /**
   * Special case for the summary/description being reset (empty) after a commit
   * and the commit state changing thereafter, needing a sync with incoming props.
   * We prefer the current UI state values if the user updated them manually.
   *
   * NOTE: although using the lifecycle method is generally an anti-pattern, we
   * (and the React docs) believe it to be the right answer for this situation, see:
   * https://reactjs.org/docs/react-component.html#unsafe_componentwillreceiveprops
   */
  public componentWillReceiveProps(nextProps: ICommitMessageProps) {
    const { commitMessage } = nextProps

    this.setState(
      {
        cheapLfsTransferTiming: advanceCheapLfsTransferTiming(
          this.state.cheapLfsTransferTiming,
          nextProps.repository.id,
          getCheapLfsTimingProgress(nextProps),
          Date.now()
        ),
      },
      this.syncCheapLfsTimingInterval
    )

    if (!commitMessage || commitMessage === this.props.commitMessage) {
      return
    }

    if (commitMessage.timestamp > this.state.commitMessage.timestamp) {
      this.setState({
        commitMessage,
      })
    }
  }

  private syncCheapLfsTimingInterval = () => {
    const needsTicker = this.state.cheapLfsTransferTiming !== null
    if (needsTicker && this.cheapLfsTimingIntervalId === null) {
      this.cheapLfsTimingIntervalId = window.setInterval(
        this.tickCheapLfsTiming,
        1_000
      )
    } else if (!needsTicker && this.cheapLfsTimingIntervalId !== null) {
      window.clearInterval(this.cheapLfsTimingIntervalId)
      this.cheapLfsTimingIntervalId = null
    }
  }

  private tickCheapLfsTiming = () => {
    const now = Date.now()
    this.setState(state => {
      const sample = state.cheapLfsTransferTiming
      if (
        sample === null ||
        !Number.isFinite(now) ||
        now <= sample.lastObservedAt
      ) {
        return null
      }
      return {
        cheapLfsTransferTiming: { ...sample, lastObservedAt: now },
      }
    })
  }

  public async componentDidUpdate(
    prevProps: ICommitMessageProps,
    prevState: ICommitMessageState
  ) {
    if (
      this.props.autocompletionProviders !== prevProps.autocompletionProviders
    ) {
      this.setState({
        commitMessageAutocompletionProviders:
          findCommitMessageAutoCompleteProvider(
            this.props.autocompletionProviders
          ),
        coAuthorAutocompletionProvider: findCoAuthorAutoCompleteProvider(
          this.props.autocompletionProviders
        ),
      })
    }

    if (this.props.repository.id !== prevProps.repository.id) {
      await this.loadCommitAuthorOrigins()
    }

    if (
      this.props.focusCommitMessage &&
      this.props.focusCommitMessage !== prevProps.focusCommitMessage
    ) {
      this.focusSummary()
    } else if (
      prevProps.showCoAuthoredBy === false &&
      this.isCoAuthorInputVisible &&
      // The co-author input could be also shown when switching between repos,
      // but in that case we don't want to give the focus to the input.
      prevProps.repository.id === this.props.repository.id &&
      !!prevProps.commitToAmend === !!this.props.commitToAmend
    ) {
      this.coAuthorInputRef.current?.focus()
    }

    const previousCommitPhase = prevProps.commitOperationPhase
    const currentCommitPhase = this.props.commitOperationPhase
    const commitPhaseChanged =
      previousCommitPhase?.kind !== currentCommitPhase?.kind ||
      (previousCommitPhase?.kind === 'cheap-lfs' &&
        currentCommitPhase?.kind === 'cheap-lfs' &&
        previousCommitPhase.progress.phase !==
          currentCommitPhase.progress.phase)
    if (
      this.props.isCommitting &&
      (prevProps.isCommitting !== this.props.isCommitting || commitPhaseChanged)
    ) {
      this.setState({ isCommittingStatusMessage: this.getButtonTitle() })
    }

    if (
      prevProps.mostRecentLocalCommit?.sha !==
        this.props.mostRecentLocalCommit?.sha &&
      this.props.mostRecentLocalCommit !== null
    ) {
      this.setState({
        isCommittingStatusMessage: `Committed Just now - ${this.props.mostRecentLocalCommit.summary} (Sha: ${this.props.mostRecentLocalCommit.shortSha})`,
      })
    }

    await this.updateRepoRuleFailures(prevProps, prevState)
  }

  private loadCommitAuthorOrigins = async () => {
    try {
      const [commitAuthorNameOrigin, commitAuthorEmailOrigin] =
        await Promise.all([
          getConfigValueWithOrigin(this.props.repository, 'user.name'),
          getConfigValueWithOrigin(this.props.repository, 'user.email'),
        ])
      this.setState({ commitAuthorNameOrigin, commitAuthorEmailOrigin })
    } catch (error) {
      log.warn('Unable to load effective Git author config origins', error)
      this.setState({
        commitAuthorNameOrigin: null,
        commitAuthorEmailOrigin: null,
      })
    }
  }

  private async updateRepoRuleFailures(
    prevProps?: ICommitMessageProps,
    prevState?: ICommitMessageState,
    forceUpdate: boolean = false
  ) {
    let repoRulesEnabled = this.state.repoRulesEnabled
    if (
      forceUpdate ||
      prevProps?.repository !== this.props.repository ||
      prevProps?.repositoryAccount !== this.props.repositoryAccount
    ) {
      repoRulesEnabled = useRepoRulesLogic(
        this.props.repositoryAccount,
        this.props.repository
      )
      this.setState({ repoRulesEnabled })
    }

    if (!repoRulesEnabled) {
      return
    }

    await this.updateRepoRulesCommitMessageFailures(
      prevProps,
      prevState,
      forceUpdate
    )
    this.updateRepoRulesCommitAuthorFailures(prevProps, forceUpdate)
    this.updateRepoRulesBranchNameFailures(prevProps, forceUpdate)
  }

  private async updateRepoRulesCommitMessageFailures(
    prevProps?: ICommitMessageProps,
    prevState?: ICommitMessageState,
    forceUpdate?: boolean
  ) {
    if (
      forceUpdate ||
      prevState?.commitMessage.summary !== this.state.commitMessage.summary ||
      prevState?.commitMessage.description !==
        this.state.commitMessage.description ||
      prevProps?.coAuthors !== this.props.coAuthors ||
      prevProps?.commitToAmend !== this.props.commitToAmend ||
      prevProps?.repository !== this.props.repository ||
      prevProps?.repoRulesInfo.commitMessagePatterns !==
        this.props.repoRulesInfo.commitMessagePatterns
    ) {
      let summary = this.state.commitMessage.summary
      if (!summary && !this.state.commitMessage.description) {
        summary = this.summaryOrPlaceholder
      }

      const context: ICommitContext = {
        summary,
        description: this.state.commitMessage.description,
        trailers: this.getCoAuthorTrailers(),
        amend: this.props.commitToAmend !== null,
        messageGeneratedByCopilot:
          this.state.commitMessage.generatedByCopilot ?? false,
      }

      const msg = await formatCommitMessage(this.props.repository, context)
      const failures =
        this.props.repoRulesInfo.commitMessagePatterns.getFailedRules(msg)

      this.setState({ repoRuleCommitMessageFailures: failures })
    }
  }

  private updateRepoRulesCommitAuthorFailures(
    prevProps?: ICommitMessageProps,
    forceUpdate?: boolean
  ) {
    if (
      forceUpdate ||
      prevProps?.commitAuthor?.email !== this.props.commitAuthor?.email ||
      prevProps?.repoRulesInfo.commitAuthorEmailPatterns !==
        this.props.repoRulesInfo.commitAuthorEmailPatterns
    ) {
      const email = this.props.commitAuthor?.email
      let failures: RepoRulesMetadataFailures

      if (!email) {
        failures = new RepoRulesMetadataFailures()
      } else {
        failures =
          this.props.repoRulesInfo.commitAuthorEmailPatterns.getFailedRules(
            email
          )
      }

      this.setState({ repoRuleCommitAuthorFailures: failures })
    }
  }

  private updateRepoRulesBranchNameFailures(
    prevProps?: ICommitMessageProps,
    forceUpdate?: boolean
  ) {
    if (
      forceUpdate ||
      prevProps?.branch !== this.props.branch ||
      prevProps?.repoRulesInfo.branchNamePatterns !==
        this.props.repoRulesInfo.branchNamePatterns
    ) {
      const branch = this.props.branch
      let failures: RepoRulesMetadataFailures

      if (!branch) {
        failures = new RepoRulesMetadataFailures()
      } else {
        failures =
          this.props.repoRulesInfo.branchNamePatterns.getFailedRules(branch)
      }

      this.setState({ repoRuleBranchNameFailures: failures })
    }
  }

  private clearCommitMessage() {
    this.setState({ commitMessage: DefaultCommitMessage })
  }

  private focusSummary() {
    if (this.summaryTextInput !== null) {
      this.summaryTextInput.focus()
      this.props.onCommitMessageFocusSet()
    }
  }

  private onSummaryChanged = (summary: string) => {
    this.setState({
      commitMessage: {
        ...this.state.commitMessage,
        summary,
        // Since this method is called when the user types, we can assume
        // that the commit message was not generated by Copilot (anymore).
        generatedByCopilot: false,
        timestamp: Date.now(),
      },
    })
  }

  private onDescriptionChanged = (description: string) => {
    this.setState({
      commitMessage: {
        ...this.state.commitMessage,
        description,
        // Since this method is called when the user types, we can assume
        // that the commit message was not generated by Copilot (anymore).
        generatedByCopilot: false,
        timestamp: Date.now(),
      },
    })
  }

  private onSubmit = () => {
    this.createCommit()
  }

  private getCoAuthorTrailers() {
    const { coAuthors } = this.props
    const token = 'Co-Authored-By'
    return this.isCoAuthorInputEnabled
      ? coAuthors
          .filter(isKnownAuthor)
          .map(a => ({ token, value: `${a.name} <${a.email}>` }))
      : []
  }

  private get summaryOrPlaceholder() {
    return this.props.prepopulateCommitSummary &&
      !this.state.commitMessage.summary
      ? this.props.placeholder
      : this.state.commitMessage.summary
  }

  private async createCommit(options?: ICreateCommitOptions) {
    const { description } = this.state.commitMessage

    if (!this.canCommit() && !this.canAmend()) {
      return
    }

    if (options?.warnUnknownAuthors !== false) {
      const unknownAuthors = this.props.coAuthors.filter(
        (author): author is UnknownAuthor => !isKnownAuthor(author)
      )

      if (unknownAuthors.length > 0) {
        this.props.onConfirmCommitWithUnknownCoAuthors(unknownAuthors, () =>
          this.createCommit({
            warnUnknownAuthors: false,
            warnFilesNotVisible: options?.warnFilesNotVisible === true,
          })
        )
        return
      }
    }

    const trailers = this.getCoAuthorTrailers()

    const commitContext: ICommitContext = {
      summary: this.summaryOrPlaceholder,
      description,
      trailers,
      amend: this.props.commitToAmend !== null,
      messageGeneratedByCopilot:
        this.state.commitMessage.generatedByCopilot ?? false,
    }

    if (
      options?.warnFilesNotVisible !== false &&
      this.props.showPromptForCommittingFileHiddenByFilter === true &&
      this.props.onFilesToCommitNotVisible
    ) {
      this.props.onFilesToCommitNotVisible(() =>
        this.createCommit({
          warnUnknownAuthors: options?.warnUnknownAuthors === true,
          warnFilesNotVisible: false,
        })
      )
      return
    }

    const timer = startTimer('create commit', this.props.repository)
    const commitCreated = await this.props.onCreateCommit(commitContext)
    timer.done()

    if (commitCreated) {
      this.props.onSuccessfulCommitCreated?.()
      this.clearCommitMessage()
    }
  }

  private canCommit(): boolean {
    return (
      (((this.props.anyFilesSelected === true ||
        this.props.allowEmptyCommit === true) &&
        this.state.commitMessage.summary.length > 0) ||
        this.props.prepopulateCommitSummary) &&
      !this.hasRepoRuleFailure()
    )
  }

  private canAmend(): boolean {
    return (
      this.props.commitToAmend !== null &&
      (this.state.commitMessage.summary.length > 0 ||
        this.props.prepopulateCommitSummary) &&
      !this.hasRepoRuleFailure()
    )
  }

  /**
   * Whether the user will be prevented from pushing this commit due to a repo rule failure.
   */
  private hasRepoRuleFailure(): boolean {
    const { aheadBehind, repoRulesInfo } = this.props

    if (!this.state.repoRulesEnabled) {
      return false
    }

    return (
      repoRulesInfo.basicCommitWarning === true ||
      repoRulesInfo.signedCommitsRequired === true ||
      repoRulesInfo.pullRequestRequired === true ||
      this.state.repoRuleCommitMessageFailures.status === 'fail' ||
      this.state.repoRuleCommitAuthorFailures.status === 'fail' ||
      (aheadBehind === null &&
        (repoRulesInfo.creationRestricted === true ||
          this.state.repoRuleBranchNameFailures.status === 'fail'))
    )
  }

  private canExcecuteCommitShortcut(event: KeyboardEvent) {
    // Once upon a time the CommitMessage component was only ever used in the
    // changes view so it was safe to bind to the keyDown event of the Window in
    // order to allow users to hit CmdOrCtrl+Enter to commit from pretty much
    // anywhere in the app as long as the changes view was active and we weren't
    // showing a modal or foldout.
    //
    // Now that the CommitMessage component is used in other places, such as in
    // the squash dialog we still want the CmdOrCtrl+Enter shortcut to work
    // so we'll allow the shortcut even if a dialog is open as long as it's
    // coming from within the component itself.
    return (
      (event.target instanceof Node &&
        this.wrapperRef.current?.contains(event.target)) ||
      (!this.props.isShowingFoldout && !this.props.isShowingModal)
    )
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return
    }

    const isShortcutKey = __DARWIN__ ? event.metaKey : event.ctrlKey
    if (
      isShortcutKey &&
      event.key === 'Enter' &&
      (this.canCommit() || this.canAmend()) &&
      this.canExcecuteCommitShortcut(event)
    ) {
      this.createCommit()
      event.preventDefault()
    }
  }

  private renderAvatar() {
    const { commitAuthor, repository } = this.props
    const { gitHubRepository } = repository
    const avatarUser: IAvatarUser | undefined =
      commitAuthor !== null
        ? getAvatarUserFromAuthor(commitAuthor, gitHubRepository)
        : undefined

    const repositoryAccount = this.props.repositoryAccount
    const accountEmails =
      repositoryAccount?.emails.filter(e => e.verified).map(e => e.email) ?? []

    if (repositoryAccount && isDotCom(repositoryAccount.endpoint)) {
      const { id, login, endpoint } = repositoryAccount
      const stealthEmail = getStealthEmailForUser(id, login, endpoint)

      if (
        !accountEmails
          .map(x => x.toLowerCase())
          .includes(stealthEmail.toLowerCase())
      ) {
        accountEmails.push(stealthEmail)
      }
    }

    const email = commitAuthor?.email

    let warningType: CommitMessageAvatarWarningType = 'none'
    if (email !== undefined) {
      if (
        this.state.repoRulesEnabled &&
        this.state.repoRuleCommitAuthorFailures.status !== 'pass'
      ) {
        warningType = 'disallowedEmail'
      } else if (
        repositoryAccount !== null &&
        repositoryAccount !== undefined &&
        isAttributableEmailFor(repositoryAccount, email) === false
      ) {
        warningType = 'misattribution'
      }
    }

    return (
      <CommitMessageAvatar
        user={avatarUser}
        email={commitAuthor?.email}
        isEnterpriseAccount={
          repositoryAccount !== null && isEnterpriseAccount(repositoryAccount)
        }
        warningType={warningType}
        emailRuleFailures={this.state.repoRuleCommitAuthorFailures}
        branch={this.props.branch}
        accountEmails={accountEmails}
        preferredAccountEmail={
          repositoryAccount !== null && repositoryAccount !== undefined
            ? lookupPreferredEmail(repositoryAccount)
            : ''
        }
        onUpdateEmail={this.onUpdateUserEmail}
        onOpenRepositorySettings={this.onOpenRepositorySettings}
        onOpenGitSettings={this.onOpenGitSettings}
        repository={repository}
        accounts={this.props.accounts}
      />
    )
  }

  private renderCommitAuthorIdentity() {
    const { commitAuthor, repository } = this.props
    if (!getShowCommitAuthorInfo() || commitAuthor === null) {
      return null
    }

    const { commitAuthorNameOrigin, commitAuthorEmailOrigin } = this.state
    const origins = [commitAuthorNameOrigin, commitAuthorEmailOrigin].filter(
      (origin): origin is IConfigValueOrigin => origin !== null
    )
    const sourceText = origins.length
      ? Array.from(
          new Set(
            origins.map(
              origin =>
                `${formatConfigScope(origin)} · ${formatConfigPath(
                  origin,
                  repository.path
                )}`
            )
          )
        ).join(' / ')
      : 'Git effective configuration'

    return (
      <div className="commit-author-identity">
        {this.renderAvatar()}
        <div className="commit-author-info">
          <span className="commit-author-name">{commitAuthor.name}</span>
          <span className="commit-author-email">{commitAuthor.email}</span>
          <TooltippedContent
            tagName="span"
            className="commit-author-source"
            tooltip={sourceText}
            onlyWhenOverflowed={true}
          >
            {sourceText}
          </TooltippedContent>
        </div>
      </div>
    )
  }

  private onUpdateUserEmail = async (email: string) => {
    await setGlobalConfigValue('user.email', email)
    this.props.onRefreshAuthor()
  }

  private onOpenRepositorySettings = () => {
    this.props.onShowPopup({
      type: PopupType.RepositorySettings,
      repository: this.props.repository,
      initialSelectedTab: RepositorySettingsTab.GitConfig,
    })
  }

  private onOpenGitSettings = () => {
    this.props.onShowPopup({
      type: PopupType.Preferences,
      initialSelectedTab: PreferencesTab.Git,
    })
  }

  private get isCoAuthorInputEnabled() {
    return this.props.repository.gitHubRepository !== null
  }

  private get isCoAuthorInputVisible() {
    return this.props.showCoAuthoredBy && this.isCoAuthorInputEnabled
  }

  private onCoAuthorsUpdated = (coAuthors: ReadonlyArray<Author>) =>
    this.props.onCoAuthorsUpdated(coAuthors)

  private renderCoAuthorInput() {
    if (!this.isCoAuthorInputVisible) {
      return null
    }

    const autocompletionProvider = this.state.coAuthorAutocompletionProvider

    if (!autocompletionProvider) {
      return null
    }

    return (
      <AuthorInput
        ref={this.coAuthorInputRef}
        onAuthorsUpdated={this.onCoAuthorsUpdated}
        authors={this.props.coAuthors}
        autoCompleteProvider={autocompletionProvider}
        readOnly={this.props.isCommitting === true}
      />
    )
  }

  private onToggleCoAuthors = () => {
    this.props.onShowCoAuthoredByChanged(!this.props.showCoAuthoredBy)
  }

  private get toggleCoAuthorsText(): string {
    return this.props.showCoAuthoredBy
      ? __DARWIN__
        ? 'Remove Co-Authors'
        : 'Remove co-authors'
      : __DARWIN__
      ? 'Add Co-Authors'
      : 'Add co-authors'
  }

  private getAddRemoveCoAuthorsMenuItem(): IMenuItem {
    return {
      label: this.toggleCoAuthorsText,
      action: this.onToggleCoAuthors,
      enabled:
        this.props.repository.gitHubRepository !== null &&
        this.props.isCommitting !== true,
    }
  }

  private getGenerateCommitMessageMenuItem(): IMenuItem | null {
    const {
      accounts,
      onGenerateCommitMessage,
      filesSelected,
      isCommitting,
      isGeneratingCommitMessage,
      commitToAmend,
    } = this.props

    if (
      !accounts.some(enableCommitMessageGeneration) ||
      onGenerateCommitMessage === undefined
    ) {
      return null
    }

    const noFilesSelected = filesSelected.length === 0
    const noChangesAvailable = !commitToAmend && noFilesSelected

    return {
      label: __DARWIN__
        ? 'Generate Commit Message with Copilot'
        : 'Generate commit message with Copilot',
      action: () => {
        const { commitMessage } = this.state
        onGenerateCommitMessage(
          filesSelected,
          !!commitMessage.summary || !!commitMessage.description
        )
      },
      enabled:
        isCommitting !== true &&
        !isGeneratingCommitMessage &&
        !noChangesAvailable,
    }
  }

  private onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLInputElement
    ) {
      return
    }

    const items: IMenuItem[] = [this.getAddRemoveCoAuthorsMenuItem()]

    const generateMenuItem = this.getGenerateCommitMessageMenuItem()
    if (generateMenuItem) {
      items.push(generateMenuItem)
    }

    showContextualMenu(items)
  }

  private onAutocompletingInputContextMenu = () => {
    const items: IMenuItem[] = [this.getAddRemoveCoAuthorsMenuItem()]

    const generateMenuItem = this.getGenerateCommitMessageMenuItem()
    if (generateMenuItem) {
      items.push(generateMenuItem)
    }

    items.push(
      { type: 'separator' },
      { role: 'editMenu' },
      { type: 'separator' }
    )

    items.push(
      this.getCommitSpellcheckEnabilityMenuItem(
        this.props.commitSpellcheckEnabled
      )
    )

    showContextualMenu(items, true)
  }

  private getCommitSpellcheckEnabilityMenuItem(isEnabled: boolean): IMenuItem {
    const enableLabel = __DARWIN__
      ? 'Enable Commit Spellcheck'
      : 'Enable commit spellcheck'
    const disableLabel = __DARWIN__
      ? 'Disable Commit Spellcheck'
      : 'Disable commit spellcheck'
    return {
      label: isEnabled ? disableLabel : enableLabel,
      action: () => this.props.onCommitSpellcheckEnabledChanged(!isEnabled),
    }
  }

  private onCopilotButtonClick = async (
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.preventDefault()

    if (this.props.isGeneratingCommitMessage) {
      if (this.canCancelGenerateCommitMessage) {
        this.props.onCancelGenerateCommitMessage?.()
      }
      return
    }

    const { commitMessage } = this.state

    this.props.onGenerateCommitMessage?.(
      this.props.filesSelected,
      !!commitMessage.summary || !!commitMessage.description
    )
  }

  private onCoAuthorToggleButtonClick = async (
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.preventDefault()

    this.onToggleCoAuthors()
  }

  private renderCopilotButton() {
    if (!this.isCopilotButtonEnabled) {
      return null
    }

    const {
      filesSelected,
      isCommitting,
      isGeneratingCommitMessage,
      commitToAmend,
      shouldShowGenerateCommitMessageCallOut,
    } = this.props

    const noFilesSelected = filesSelected.length === 0
    const noChangesAvailable = !commitToAmend && noFilesSelected

    let ariaLabel = 'Generate commit message with Copilot'
    const canCancelGenerateCommitMessage = this.canCancelGenerateCommitMessage
    const showCancelGenerateCommitMessage =
      isGeneratingCommitMessage === true && canCancelGenerateCommitMessage

    if (!isGeneratingCommitMessage && noChangesAvailable) {
      ariaLabel += '. Files must be selected to generate a commit message.'
    } else if (showCancelGenerateCommitMessage) {
      ariaLabel = 'Cancel generating commit details'
    } else if (isGeneratingCommitMessage) {
      ariaLabel = 'Generating commit details…'
    }

    return (
      <>
        {this.isCoAuthorInputEnabled && <div className="separator" />}
        <Button
          className="copilot-button"
          onClick={this.onCopilotButtonClick}
          ariaLabel={ariaLabel}
          tooltip={ariaLabel}
          disabled={
            isCommitting === true ||
            (isGeneratingCommitMessage === true &&
              !canCancelGenerateCommitMessage) ||
            (!isGeneratingCommitMessage && noChangesAvailable)
          }
        >
          <AriaLiveContainer
            message={
              isGeneratingCommitMessage ? 'Generating commit details…' : ''
            }
          />
          <MaterialSymbol
            name={showCancelGenerateCommitMessage ? 'cancel' : 'auto_awesome'}
            size={18}
          />
          {shouldShowGenerateCommitMessageCallOut && (
            <span className="call-to-action-bubble">New</span>
          )}
        </Button>
      </>
    )
  }

  private renderCommitOptionsButton() {
    const ariaLabel = 'Configure commit options'

    return (
      <>
        {(this.isCoAuthorInputEnabled || this.isCopilotButtonEnabled) && (
          <div className="separator" />
        )}
        <Button
          className={classNames('commit-options-button', {
            'default-options':
              !this.props.skipCommitHooks &&
              !this.props.signOffCommits &&
              !this.props.allowEmptyCommit,
          })}
          onClick={this.onCommitOptionsButtonClick}
          ariaLabel={ariaLabel}
          tooltip={ariaLabel}
        >
          <MaterialSymbol name="settings" size={18} />
        </Button>
      </>
    )
  }

  private onCommitOptionsButtonClick = (
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    e.preventDefault()

    const items: IMenuItem[] = []

    if (enableHooksEnvironment()) {
      items.push({
        type: 'checkbox',
        checked: this.props.skipCommitHooks,
        label: __DARWIN__ ? 'Bypass Commit Hooks' : 'Bypass Commit hooks',
        action: () => {
          this.props.onUpdateCommitOptions(this.props.repository, {
            skipCommitHooks: !this.props.skipCommitHooks,
          })
        },
      })
    }

    items.push({
      type: 'checkbox',
      checked: this.props.signOffCommits,
      label: __DARWIN__
        ? 'Add Signed-off-by Trailer'
        : 'Add Signed-off-by trailer',
      action: () => {
        this.props.onUpdateCommitOptions(this.props.repository, {
          signOffCommits: !this.props.signOffCommits,
        })
      },
    })

    if (this.props.showAllowEmptyCommitOption) {
      items.push({
        type: 'checkbox',
        checked: this.props.allowEmptyCommit,
        label: __DARWIN__ ? 'Allow Empty Commit' : 'Allow empty commit',
        action: () => {
          this.props.onUpdateCommitOptions(this.props.repository, {
            allowEmptyCommit: !this.props.allowEmptyCommit,
          })
        },
      })
    }

    showContextualMenu(items)
  }

  private renderCoAuthorToggleButton() {
    if (this.props.repository.gitHubRepository === null) {
      return null
    }

    return (
      <Button
        className="co-authors-toggle"
        onClick={this.onCoAuthorToggleButtonClick}
        ariaLabel={this.toggleCoAuthorsText}
        tooltip={this.toggleCoAuthorsText}
        disabled={
          this.props.isCommitting === true ||
          this.props.isGeneratingCommitMessage
        }
      >
        <MaterialSymbol name="group_add" size={18} />
      </Button>
    )
  }

  private onDescriptionFieldRef = (
    component: AutocompletingTextArea | null
  ) => {
    this.descriptionComponent = component
  }

  private onDescriptionTextAreaScroll = () => {
    this.descriptionTextAreaScrollDebounceId = null

    const elem = this.descriptionTextArea
    const descriptionObscured =
      elem !== null && elem.scrollTop + elem.offsetHeight < elem.scrollHeight

    if (this.state.descriptionObscured !== descriptionObscured) {
      this.setState({ descriptionObscured })
    }
  }

  private onDescriptionTextAreaRef = (elem: HTMLTextAreaElement | null) => {
    if (elem) {
      const checkDescriptionScrollState = () => {
        if (this.descriptionTextAreaScrollDebounceId !== null) {
          cancelAnimationFrame(this.descriptionTextAreaScrollDebounceId)
          this.descriptionTextAreaScrollDebounceId = null
        }
        this.descriptionTextAreaScrollDebounceId = requestAnimationFrame(
          this.onDescriptionTextAreaScroll
        )
      }
      elem.addEventListener('input', checkDescriptionScrollState)
      elem.addEventListener('scroll', checkDescriptionScrollState)
    }

    this.descriptionTextArea = elem
  }

  private onSummaryInputRef = (elem: HTMLInputElement | null) => {
    this.summaryTextInput = elem
  }

  private onFocusContainerClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) {
      // Our description text area is styled to look like it's a big textarea
      // with buttons towards the bottom but it's not. It's a textarea inside of
      // a focus container (div) which is styled to look like a text area.
      // To maintain that illusion we need to focus the description text area
      // when the user clicks on the focus container but we don't want to
      // do that if the user clicked on one of the buttons in the action bar
      return
    }

    if (this.descriptionComponent) {
      this.descriptionComponent.focus()
    }
  }

  /**
   * Whether the Copilot button should be available
   */
  private get isCopilotButtonEnabled() {
    const { accounts, onGenerateCommitMessage } = this.props
    return (
      accounts.some(enableCommitMessageGeneration) &&
      onGenerateCommitMessage !== undefined
    )
  }

  /**
   * Whether an in-flight commit message generation can be cancelled.
   */
  private get canCancelGenerateCommitMessage() {
    const account = getAccountForCommitMessageGeneration(
      this.props.accounts,
      this.props.repository
    )

    return (
      account !== undefined &&
      enableCopilotSdkCommitMessageGeneration(account) &&
      this.props.onCancelGenerateCommitMessage !== undefined
    )
  }

  private renderActionBar() {
    const { isCommitting, isGeneratingCommitMessage } = this.props

    const className = classNames('action-bar', {
      disabled: isCommitting === true || isGeneratingCommitMessage === true,
    })

    return (
      <div className={className}>
        {this.renderCoAuthorToggleButton()}
        {this.renderCopilotButton()}
        {this.renderCommitOptionsButton()}
      </div>
    )
  }

  private renderAmendCommitNotice() {
    const { commitToAmend } = this.props

    if (commitToAmend !== null) {
      return (
        <CommitWarning icon={CommitWarningIcon.Information}>
          Your changes will modify your <strong>most recent commit</strong>.{' '}
          <LinkButton onClick={this.props.onStopAmending}>
            Stop amending
          </LinkButton>{' '}
          to make these changes as a new commit.
        </CommitWarning>
      )
    } else {
      return null
    }
  }

  private renderBranchProtectionsRepoRulesCommitWarning() {
    const {
      showNoWriteAccess,
      showBranchProtected,
      repoRulesInfo,
      aheadBehind,
      repository,
      branch,
    } = this.props

    const { repoRuleBranchNameFailures, repoRulesEnabled } = this.state

    // if one of these is not bypassable, then that failure message needs to be shown rather than
    // just displaying the first one in the if statement below
    type WarningToDisplay = 'publish' | 'commitSigning' | 'basic' | null
    const ruleEnforcementStatuses = new Map<
      Exclude<WarningToDisplay, null>,
      RepoRuleEnforced
    >()

    let repoRuleWarningToDisplay: WarningToDisplay = null

    if (repoRulesEnabled) {
      // has the current branch has been published?
      if (aheadBehind === null && branch !== null) {
        if (
          repoRulesInfo.creationRestricted === true ||
          repoRuleBranchNameFailures.status === 'fail'
        ) {
          ruleEnforcementStatuses.set('publish', true)
        } else if (
          repoRulesInfo.creationRestricted === 'bypass' ||
          repoRuleBranchNameFailures.status === 'bypass'
        ) {
          ruleEnforcementStatuses.set('publish', 'bypass')
        } else {
          ruleEnforcementStatuses.set('publish', false)
        }
      }

      ruleEnforcementStatuses.set(
        'commitSigning',
        repoRulesInfo.signedCommitsRequired
      )
      ruleEnforcementStatuses.set('basic', repoRulesInfo.basicCommitWarning)

      // grab the first error to display
      for (const status of ruleEnforcementStatuses) {
        if (status[1] === true) {
          repoRuleWarningToDisplay = status[0]
          break
        }
      }

      // if none errored, display the first bypassed
      if (repoRuleWarningToDisplay === null) {
        for (const status of ruleEnforcementStatuses) {
          if (status[1] === 'bypass') {
            repoRuleWarningToDisplay = status[0]
            break
          }
        }
      }
    }

    if (showNoWriteAccess) {
      return (
        <CommitWarning icon={CommitWarningIcon.Warning}>
          You don't have write access to <strong>{repository.name}</strong>.
          Want to{' '}
          <LinkButton onClick={this.props.onShowCreateForkDialog}>
            create a fork
          </LinkButton>
          ?
        </CommitWarning>
      )
    } else if (showBranchProtected) {
      if (branch === null) {
        // If the branch is null that means we haven't loaded the tip yet or
        // we're on a detached head. We shouldn't ever end up here with
        // showBranchProtected being true without a branch but who knows
        // what fun and exciting edge cases the future might hold
        return null
      }

      return (
        <CommitWarning icon={CommitWarningIcon.Warning}>
          <strong>{branch}</strong> is a protected branch. Want to{' '}
          <LinkButton onClick={this.onSwitchBranch}>switch branches</LinkButton>
          ?
        </CommitWarning>
      )
    } else if (repoRuleWarningToDisplay === 'publish') {
      const canBypass = ruleEnforcementStatuses.get('publish') === 'bypass'

      return (
        <CommitWarning
          icon={canBypass ? CommitWarningIcon.Warning : CommitWarningIcon.Error}
        >
          The branch name <strong>{branch}</strong> fails{' '}
          <RepoRulesetsForBranchLink
            repository={repository.gitHubRepository}
            branch={branch}
          >
            one or more rules
          </RepoRulesetsForBranchLink>{' '}
          that {canBypass ? 'would' : 'will'} prevent it from being published
          {canBypass && ', but you can bypass them. Proceed with caution!'}
          {!canBypass && (
            <>
              . Want to{' '}
              <LinkButton onClick={this.onSwitchBranch}>
                switch branches
              </LinkButton>
              ?
            </>
          )}
        </CommitWarning>
      )
    } else if (repoRuleWarningToDisplay === 'commitSigning') {
      const canBypass = repoRulesInfo.signedCommitsRequired === 'bypass'

      return (
        <CommitWarning
          icon={canBypass ? CommitWarningIcon.Warning : CommitWarningIcon.Error}
        >
          <RepoRulesetsForBranchLink
            repository={repository.gitHubRepository}
            branch={branch}
          >
            One or more rules
          </RepoRulesetsForBranchLink>{' '}
          apply to the branch <strong>{branch}</strong> that require signed
          commits
          {canBypass && ', but you can bypass them. Proceed with caution!'}
          {!canBypass && '.'}{' '}
          <LinkButton uri="https://docs.github.com/authentication/managing-commit-signature-verification/signing-commits">
            Learn more about commit signing.
          </LinkButton>
        </CommitWarning>
      )
    } else if (repoRuleWarningToDisplay === 'basic') {
      const canBypass = repoRulesInfo.basicCommitWarning === 'bypass'

      return (
        <CommitWarning
          icon={canBypass ? CommitWarningIcon.Warning : CommitWarningIcon.Error}
        >
          <RepoRulesetsForBranchLink
            repository={repository.gitHubRepository}
            branch={branch}
          >
            One or more rules
          </RepoRulesetsForBranchLink>{' '}
          apply to the branch <strong>{branch}</strong> that{' '}
          {canBypass ? 'would' : 'will'} prevent pushing
          {canBypass && ', but you can bypass them. Proceed with caution!'}
          {!canBypass && (
            <>
              . Want to{' '}
              <LinkButton onClick={this.onSwitchBranch}>
                switch branches
              </LinkButton>
              ?
            </>
          )}
        </CommitWarning>
      )
    } else {
      return null
    }
  }

  private renderRuleFailurePopover() {
    const { branch, repository } = this.props

    // the failure status is checked here separately from whether the popover is open. if the
    // user has it open but rules pass as they're typing, then keep the popover logic open
    // but just don't render it. as they keep typing, if the message fails again, then the
    // popover will open back up.
    if (
      !branch ||
      !repository.gitHubRepository ||
      !this.state.repoRulesEnabled ||
      this.state.repoRuleCommitMessageFailures.status === 'pass'
    ) {
      return
    }

    const header = __DARWIN__
      ? 'Commit Message Rule Failures'
      : 'Commit message rule failures'
    return (
      <Popover
        anchor={this.summaryTextInput}
        anchorPosition={PopoverAnchorPosition.Right}
        decoration={PopoverDecoration.Balloon}
        minHeight={200}
        ariaLabelledby="commit-message-rule-failure-popover-header"
        onClickOutside={this.closeRuleFailurePopover}
      >
        <h3 id="commit-message-rule-failure-popover-header">{header}</h3>

        <RepoRulesMetadataFailureList
          repository={repository.gitHubRepository}
          branch={branch}
          failures={this.state.repoRuleCommitMessageFailures}
          leadingText="This commit message"
        />
      </Popover>
    )
  }

  private toggleRuleFailurePopover = () => {
    this.setState({
      isRuleFailurePopoverOpen: !this.state.isRuleFailurePopoverOpen,
    })
  }

  private closeRuleFailurePopover = () => {
    this.setState({ isRuleFailurePopoverOpen: false })
  }

  private onSwitchBranch = () => {
    this.props.onShowFoldout({ type: FoldoutType.Branch })
  }

  private getButtonVerb() {
    const { isCommitting, commitToAmend } = this.props

    const amendVerb = isCommitting ? 'Amending' : 'Amend'
    const commitVerb = isCommitting ? 'Committing' : 'Commit'
    const isAmending = commitToAmend !== null

    return isAmending ? amendVerb : commitVerb
  }

  /** Localize one cheap-LFS phase without hiding what the operation is doing. */
  private getCheapLfsOperationText(): string | null {
    const phase = this.props.commitOperationPhase
    if (phase?.kind !== 'cheap-lfs') {
      return null
    }

    const { progress } = phase
    const displayProgress = normalizeCheapLfsDisplayProgress(progress)
    const count = displayProgress.totalFiles
    const fileKey = count === 1 ? 'cheapLfs.files.one' : 'cheapLfs.files.many'
    const countVariable = { count: count.toString() }
    const files = bilingualVariable(
      translate(fileKey, 'english', countVariable),
      translate(fileKey, 'cantonese', countVariable)
    )
    const amend =
      this.props.commitToAmend === null
        ? ''
        : bilingualVariable(
            translate('cheapLfs.progress.amendSuffix', 'english'),
            translate('cheapLfs.progress.amendSuffix', 'cantonese')
          )
    const variables = { files, amend }

    switch (progress.phase) {
      case 'preparing':
        return t('cheapLfs.progress.preparing', variables)
      case 'hashing': {
        const percentage =
          displayProgress.percentage === null ? 0 : displayProgress.percentage
        return t('cheapLfs.progress.hashing', {
          ...variables,
          percentage: percentage.toString(),
        })
      }
      case 'release':
        return t('cheapLfs.progress.release', variables)
      case 'uploading': {
        if (
          displayProgress.percentage === null ||
          displayProgress.transferredBytes === 0
        ) {
          return t('cheapLfs.progress.uploadStarting', variables)
        }

        return t('cheapLfs.progress.uploading', {
          ...variables,
          percentage: displayProgress.percentage.toString(),
        })
      }
      case 'verifying':
        return t('cheapLfs.progress.verifying', variables)
      case 'manual-preparing': {
        const percentage =
          displayProgress.percentage === null ? 0 : displayProgress.percentage
        return t('cheapLfs.progress.manualPreparing', {
          amend,
          percentage: percentage.toString(),
        })
      }
      case 'manual-waiting':
        return t('cheapLfs.progress.manualWaiting', { amend })
      case 'manual-verifying':
        return t('cheapLfs.progress.manualVerifying', { amend })
      case 'manual-detected':
        return t('cheapLfs.progress.manualDetected', { amend })
      default:
        return assertNever(
          progress.phase,
          'Unknown cheap-LFS commit operation phase'
        )
    }
  }

  /** Describe the real stage inside the broader commit operation lock. */
  private getCommitOperationButtonText(): string | null {
    if (!this.props.isCommitting) {
      return null
    }

    const phase = this.props.commitOperationPhase
    if (phase === null) {
      return null
    }

    switch (phase.kind) {
      case 'preparing': {
        const count = this.props.filesToBeCommittedCount ?? 0
        if (count < 1) {
          return 'Preparing commit'
        }
        return `Preparing ${count} ${count === 1 ? 'file' : 'files'} for commit`
      }
      case 'cheap-lfs': {
        return this.getCheapLfsOperationText()
      }
      case 'git-commit': {
        const count = phase.cheapLfsPointerCount
        if (count < 1) {
          return null
        }
        if (this.props.commitToAmend !== null) {
          return `Amending last commit with ${count} cheap-LFS ${
            count === 1 ? 'pointer' : 'pointers'
          }`
        }
        const destination =
          this.props.branch === null ? '' : ` to ${this.props.branch}`
        return `Committing ${count} cheap-LFS ${
          count === 1 ? 'pointer' : 'pointers'
        }${destination}`
      }
      default:
        return assertNever(phase, 'Unknown commit operation phase')
    }
  }

  private getCommittingButtonText() {
    const { branch } = this.props
    const verb = this.getButtonVerb()

    if (branch === null) {
      return verb
    }

    /** N.B. For screen reader users, this string literal is important! This was
     * moved into a string literal because when it was JSX it was interpreted
     * as three separate strings "Verb" and "Count" and "to" and even tho
     * visually it was correctly adding spacings, for screen reader users it was
     * not and putting them all to together as one word. */
    const action = `${verb} ${this.getFilesToBeCommittedButtonText()}to `

    return (
      <>
        {action}
        <strong>{branch}</strong>
      </>
    )
  }

  private getFilesToBeCommittedButtonText() {
    const { filesToBeCommittedCount } = this.props

    if (
      filesToBeCommittedCount === undefined ||
      filesToBeCommittedCount === 0
    ) {
      return ''
    }

    const pluralizedFile = filesToBeCommittedCount > 1 ? 'files' : 'file'

    return `${filesToBeCommittedCount} ${pluralizedFile} `
  }

  private getCommittingButtonTitle() {
    const { branch } = this.props
    const verb = this.getButtonVerb()

    if (branch === null) {
      return verb
    }

    return `${verb} to ${branch}`
  }

  private getButtonText() {
    const operationText = this.getCommitOperationButtonText()
    if (operationText !== null) {
      return operationText
    }

    const { commitToAmend, commitButtonText } = this.props

    if (commitButtonText) {
      return commitButtonText
    }

    const isAmending = commitToAmend !== null
    return isAmending ? this.getButtonTitle() : this.getCommittingButtonText()
  }

  private getButtonTitle(): string {
    const operationText = this.getCommitOperationButtonText()
    if (operationText !== null) {
      return operationText
    }

    const { commitToAmend, commitButtonText } = this.props

    if (commitButtonText) {
      return commitButtonText
    }

    const isAmending = commitToAmend !== null
    return isAmending
      ? `${this.getButtonVerb()} last commit`
      : this.getCommittingButtonTitle()
  }

  private getButtonTooltip(buttonEnabled: boolean) {
    if (buttonEnabled) {
      return this.getButtonTitle()
    }

    const isSummaryBlank = isEmptyOrWhitespace(this.summaryOrPlaceholder)
    if (isSummaryBlank) {
      return `A commit summary is required to commit`
    } else if (
      !this.props.anyFilesSelected &&
      this.props.anyFilesAvailable &&
      !this.props.allowEmptyCommit
    ) {
      return `Select one or more files to commit`
    } else if (this.props.isCommitting) {
      const operationText = this.getCommitOperationButtonText()
      return operationText === null
        ? `Committing changes…`
        : `${operationText}…`
    }

    return undefined
  }

  private renderSubmitButton() {
    const { isCommitting, isGeneratingCommitMessage } = this.props
    const isSummaryBlank = isEmptyOrWhitespace(this.summaryOrPlaceholder)
    const buttonEnabled =
      (this.canCommit() || this.canAmend()) &&
      !isCommitting &&
      !isSummaryBlank &&
      !isGeneratingCommitMessage
    const loading =
      isCommitting || isGeneratingCommitMessage ? <Loading /> : undefined
    const generatingCommitDetailsMessage = isGeneratingCommitMessage
      ? 'Generating commit details…'
      : null
    const tooltip =
      generatingCommitDetailsMessage ?? this.getButtonTooltip(buttonEnabled)
    const commitButton = generatingCommitDetailsMessage ?? this.getButtonText()

    return (
      <Button
        type="submit"
        className="commit-button"
        onClick={this.onSubmit}
        disabled={!buttonEnabled}
        tooltip={tooltip}
        tooltipDismissable={false}
        onlyShowTooltipWhenOverflowed={buttonEnabled}
        ariaDescribedBy={this.props.submitButtonAriaDescribedBy}
      >
        <>
          {loading}
          {/* Keep the label (text + branch <strong>) in a single inline span so
              it truncates with an ellipsis when the branch name is long, and so
              the button's flex `gap` doesn't render as an extra space before the
              bold branch. The `action` string itself stays one text node to
              preserve the screen-reader spacing noted in getCommittingButtonText. */}
          <span className="commit-button-label">{commitButton}</span>
        </>
      </Button>
    )
  }

  private renderSummaryLengthHint(): JSX.Element | null {
    return (
      <ToggledtippedContent
        delay={0}
        tooltip={
          <>
            <div className="title">
              Great commit summaries contain fewer than 50 characters
            </div>
            <div className="description">
              Place extra information in the description field.
            </div>
          </>
        }
        ariaLiveMessage={
          'Great commit summaries contain fewer than 50 characters. Place extra information in the description field.'
        }
        direction={TooltipDirection.NORTH}
        className="length-hint"
        tooltipClassName="length-hint-tooltip"
        ariaLabel="Open Summary Length Info"
      >
        <MaterialSymbol name="live_help" size={12} />
      </ToggledtippedContent>
    )
  }

  private renderRepoRuleCommitMessageFailureHint(): JSX.Element | null {
    // enableRepoRules FF is checked before this method

    if (this.state.repoRuleCommitMessageFailures.status === 'pass') {
      return null
    }

    const canBypass =
      this.state.repoRuleCommitMessageFailures.status === 'bypass'

    let ariaLabelPrefix: string
    let bypassMessage = ''
    if (canBypass) {
      ariaLabelPrefix = 'Warning'
      bypassMessage = ', but you can bypass them'
    } else {
      ariaLabelPrefix = 'Error'
    }

    return (
      <button
        id="commit-message-failure-hint"
        className="commit-message-failure-hint button-component"
        aria-label={`${ariaLabelPrefix}: Commit message fails repository rules${bypassMessage}. View details.`}
        aria-haspopup="dialog"
        aria-expanded={this.state.isRuleFailurePopoverOpen}
        onClick={this.toggleRuleFailurePopover}
      >
        <MaterialSymbol
          name={canBypass ? 'warning' : 'error'}
          size={12}
          className={canBypass ? 'warning-icon' : 'error-icon'}
        />
      </button>
    )
  }

  /**
   * A bounded snapshot of structured Cheap LFS progress. This intentionally
   * does not render raw process output: release-transfer diagnostics can contain
   * sensitive request details and are kept in the main process.
   */
  private getCheapLfsTerminalPhaseText(phase: CheapLfsAutoPinPhase): string {
    switch (phase) {
      case 'preparing':
        return t('cheapLfs.progress.terminalStagePreparing')
      case 'hashing':
        return t('cheapLfs.progress.terminalStageHashing')
      case 'release':
        return t('cheapLfs.progress.terminalStageRelease')
      case 'uploading':
        return t('cheapLfs.progress.terminalStageUploading')
      case 'verifying':
        return t('cheapLfs.progress.terminalStageVerifying')
      case 'manual-preparing':
        return t('cheapLfs.progress.terminalStageManualPreparing')
      case 'manual-waiting':
        return t('cheapLfs.progress.terminalStageManualWaiting')
      case 'manual-verifying':
        return t('cheapLfs.progress.terminalStageManualVerifying')
      case 'manual-detected':
        return t('cheapLfs.progress.terminalStageManualDetected')
      default:
        return assertNever(phase, `Unknown Cheap LFS phase: ${phase}`)
    }
  }

  private getCheapLfsStorageProviderVariable(provider: string) {
    switch (provider) {
      case 'git':
        return translatedVariable('cheapLfs.progress.terminalProviderGit')
      case 'release':
        return translatedVariable('cheapLfs.settings.storageRelease')
      case 'ghcr':
        return translatedVariable('cheapLfs.settings.storageGhcr')
      case 'docker-hub':
        return translatedVariable('cheapLfs.settings.storageDockerHub')
      default:
        return translatedVariable('cheapLfs.progress.terminalProviderUnknown')
    }
  }

  private getCheapLfsStorageReasonText(
    reason: NonNullable<ICheapLfsAutoPinProgress['storageRecommendationReason']>
  ): string {
    switch (reason) {
      case 'ordinary-git':
        return t('cheapLfs.progress.terminalReasonOrdinaryGit')
      case 'single-release-transfer':
        return t('cheapLfs.progress.terminalReasonSingleRelease')
      case 'github-registry-large-batch':
        return t('cheapLfs.progress.terminalReasonGhcr')
      case 'docker-hub-large-batch':
        return t('cheapLfs.progress.terminalReasonDockerHub')
      case 'release-registry-unavailable':
        return t('cheapLfs.progress.terminalReasonReleaseFallback')
      default:
        return assertNever(
          reason,
          `Unknown Cheap LFS storage recommendation: ${reason}`
        )
    }
  }

  /** Derive renderer-observed timing without mutating component data. */
  private getCheapLfsDisplayTiming(
    display: ICheapLfsDisplayProgress,
    phase: CheapLfsAutoPinPhase
  ): ICheapLfsDisplayTiming {
    const sample = this.state.cheapLfsTransferTiming
    if (sample === null) {
      return {
        elapsedMilliseconds: 0,
        bytesPerSecond: null,
        etaMilliseconds: null,
      }
    }

    const rawElapsed = sample.lastObservedAt - sample.operationStartedAt
    const elapsedMilliseconds = Number.isFinite(rawElapsed)
      ? Math.max(0, rawElapsed)
      : 0
    if (phase !== 'uploading' || sample.phase !== 'uploading') {
      return {
        elapsedMilliseconds,
        bytesPerSecond: null,
        etaMilliseconds: null,
      }
    }

    const rateElapsedMilliseconds = Math.max(
      0,
      sample.lastObservedAt - sample.rateStartedAt
    )
    const observedBytes = Math.max(
      0,
      display.transferredBytes - sample.rateInitialTransferredBytes
    )
    const bytesPerSecond =
      rateElapsedMilliseconds >= 1_000 && observedBytes > 0
        ? observedBytes / (rateElapsedMilliseconds / 1_000)
        : null
    const remainingBytes = Math.max(
      0,
      display.totalBytes - display.transferredBytes
    )
    const calculatedEta =
      remainingBytes === 0 && display.totalBytes > 0
        ? 0
        : bytesPerSecond === null
        ? null
        : (remainingBytes / bytesPerSecond) * 1_000
    const etaMilliseconds =
      calculatedEta !== null && Number.isFinite(calculatedEta)
        ? calculatedEta
        : null

    return { elapsedMilliseconds, bytesPerSecond, etaMilliseconds }
  }

  private renderCheapLfsTerminal(
    progress: ICheapLfsAutoPinProgress
  ): JSX.Element {
    const display = normalizeCheapLfsDisplayProgress(progress)
    const timing = this.getCheapLfsDisplayTiming(display, progress.phase)
    const title = t('cheapLfs.progress.terminalTitle')
    const stage = this.getCheapLfsOperationText() ?? title
    const files = t('cheapLfs.progress.terminalFilesDetailed', {
      completed: display.completedFiles.toString(),
      succeeded: display.succeededFiles.toString(),
      failed: display.failedFiles.toString(),
      total: display.totalFiles.toString(),
    })
    const bytes =
      display.totalBytes === 0
        ? t('cheapLfs.progress.terminalBytesPending')
        : t('cheapLfs.progress.terminalBytes', {
            transferred: formatCheapLfsBytes(display.transferredBytes),
            total: formatCheapLfsBytes(display.totalBytes),
          })
    const progressValueText =
      display.percentage === null
        ? `${files}; ${bytes}`
        : `${files}; ${bytes}; ${display.percentage}%`
    const unsettledFiles = Math.max(
      0,
      display.totalFiles - display.completedFiles
    )
    const isManualStatusOnly =
      progress.phase === 'manual-waiting' ||
      progress.phase === 'manual-verifying' ||
      progress.phase === 'manual-detected'
    const visibleActiveFiles = isManualStatusOnly
      ? 0
      : display.activeFiles.length > 0
      ? display.activeFiles.length
      : display.currentPath !== null
      ? 1
      : 0
    const activeFiles = Math.min(unsettledFiles, visibleActiveFiles)
    const queuedFiles = Math.max(0, unsettledFiles - activeFiles)
    const activity =
      progress.phase === 'manual-waiting'
        ? t('cheapLfs.progress.terminalAwaitingAction', {
            count: unsettledFiles.toString(),
          })
        : progress.phase === 'manual-verifying'
        ? t('cheapLfs.progress.terminalManualVerification', {
            count: unsettledFiles.toString(),
          })
        : progress.phase === 'manual-detected'
        ? t('cheapLfs.progress.terminalManualComplete')
        : t('cheapLfs.progress.terminalActivity', {
            active: activeFiles.toString(),
            queued: queuedFiles.toString(),
          })
    const elapsed = formatCheapLfsDuration(timing.elapsedMilliseconds)
    const rate =
      timing.bytesPerSecond === null
        ? null
        : formatCheapLfsRate(timing.bytesPerSecond)
    const eta =
      timing.etaMilliseconds === null
        ? null
        : formatCheapLfsDuration(timing.etaMilliseconds)
    const timingSummary =
      progress.phase === 'uploading'
        ? t('cheapLfs.progress.terminalTiming', {
            elapsed,
            rate:
              rate ??
              translatedVariable('cheapLfs.progress.terminalRatePending'),
            eta:
              eta ?? translatedVariable('cheapLfs.progress.terminalEtaPending'),
          })
        : t('cheapLfs.progress.terminalObservedElapsed', { elapsed })
    const hasRegistryRecommendation =
      display.selectedStorageProvider === 'ghcr' ||
      display.selectedStorageProvider === 'docker-hub' ||
      display.recommendedStorageProvider === 'ghcr' ||
      display.recommendedStorageProvider === 'docker-hub'
    const layers =
      !hasRegistryRecommendation ||
      display.estimatedRegistryLayers === null ||
      display.estimatedRegistryLayers < 1
        ? ''
        : translatedVariable(
            display.estimatedRegistryLayers === 1
              ? 'cheapLfs.progress.terminalLayer'
              : 'cheapLfs.progress.terminalLayers',
            { count: display.estimatedRegistryLayers.toString() }
          )
    const storageRecommendation =
      display.selectedStorageProvider === null
        ? null
        : display.recommendedStorageProvider === null
        ? t('cheapLfs.progress.terminalStorageSelected', {
            selected: this.getCheapLfsStorageProviderVariable(
              display.selectedStorageProvider
            ),
            layers,
          })
        : t(
            display.selectedStorageProvider ===
              display.recommendedStorageProvider
              ? 'cheapLfs.progress.terminalStorageMatched'
              : 'cheapLfs.progress.terminalStorage',
            {
              selected: this.getCheapLfsStorageProviderVariable(
                display.selectedStorageProvider
              ),
              recommended: this.getCheapLfsStorageProviderVariable(
                display.recommendedStorageProvider
              ),
              layers,
            }
          )
    const storageReason =
      progress.storageRecommendationReason === undefined
        ? null
        : this.getCheapLfsStorageReasonText(
            progress.storageRecommendationReason
          )

    return (
      <div
        className="cheap-lfs-mini-terminal"
        role="region"
        aria-label={translateForAccessibleName(
          'cheapLfs.progress.terminalTitle'
        )}
      >
        <div className="cheap-lfs-mini-terminal-header" aria-hidden="true">
          <span className="cheap-lfs-terminal-lights">
            <span className="cheap-lfs-terminal-light stop" />
            <span className="cheap-lfs-terminal-light wait" />
            <span className="cheap-lfs-terminal-light go" />
          </span>
          <span className="cheap-lfs-terminal-title">{title}</span>
        </div>
        <div className="cheap-lfs-mini-terminal-body">
          <div
            className="cheap-lfs-terminal-command"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="cheap-lfs-terminal-prompt" aria-hidden="true">
              &gt;
            </span>
            <span className="cheap-lfs-terminal-stage">{stage}</span>
          </div>
          <div className="cheap-lfs-terminal-facts">
            <span>{activity}</span>
            <span>{timingSummary}</span>
          </div>
          {storageRecommendation !== null && (
            <div className="cheap-lfs-terminal-path">
              {storageRecommendation}
            </div>
          )}
          {storageReason !== null && (
            <details className="cheap-lfs-terminal-recommendation">
              <summary>
                <span>{storageReason}</span>
              </summary>
            </details>
          )}
          {!isManualStatusOnly &&
            display.currentPath !== null &&
            display.activeFiles.length === 0 && (
              <div className="cheap-lfs-terminal-path">
                {t('cheapLfs.progress.terminalCurrentFile', {
                  path: display.currentPath,
                })}
              </div>
            )}
          {!isManualStatusOnly && display.activeFiles.length > 0 && (
            <div className="cheap-lfs-terminal-active-files" role="list">
              {display.activeFiles.map((file, index) => {
                const phase = this.getCheapLfsTerminalPhaseText(file.phase)
                const byteProgress =
                  file.totalBytes === 0
                    ? t('cheapLfs.progress.terminalBytesPending')
                    : t('cheapLfs.progress.terminalFileBytes', {
                        transferred: formatCheapLfsBytes(file.processedBytes),
                        total: formatCheapLfsBytes(file.totalBytes),
                        percentage: (file.percentage ?? 0).toString(),
                      })
                return (
                  <div
                    className="cheap-lfs-terminal-active-file"
                    role="listitem"
                    key={`${index}:${file.path}`}
                  >
                    <span
                      className="cheap-lfs-terminal-worker"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <span className="cheap-lfs-terminal-active-main">
                      <span className="cheap-lfs-terminal-active-path">
                        {file.path}
                      </span>
                      <span className="cheap-lfs-terminal-active-detail">
                        {phase} · {byteProgress}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <div className="cheap-lfs-terminal-details">
            <span>{files}</span>
            <span>{bytes}</span>
            {display.percentage !== null && (
              <span className="cheap-lfs-terminal-percentage">
                {display.percentage}%
              </span>
            )}
          </div>
          <div
            className={classNames('cheap-lfs-terminal-progress', {
              indeterminate: display.percentage === null,
            })}
            role="progressbar"
            aria-label={translateForAccessibleName(
              'cheapLfs.progress.terminalProgressLabel'
            )}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={display.percentage ?? undefined}
            aria-valuetext={progressValueText}
          >
            {display.percentage !== null && (
              <span style={{ width: `${display.percentage}%` }} />
            )}
          </div>
        </div>
      </div>
    )
  }

  private renderCommitProgress() {
    const {
      isCommitting,
      commitOperationPhase,
      hookProgress,
      onShowCommitProgress,
    } = this.props
    if (!isCommitting) {
      return null
    }

    if (commitOperationPhase?.kind === 'cheap-lfs') {
      const { phase, activeFiles } = commitOperationPhase.progress
      const canSwitchToManual =
        (commitOperationPhase.progress.selectedStorageProvider === undefined ||
          commitOperationPhase.progress.selectedStorageProvider ===
            'release') &&
        (phase === 'uploading' ||
          activeFiles?.some(file => file.phase === 'uploading') === true)
      const showManualUpload =
        canSwitchToManual && this.props.onManualCheapLfsUpload !== undefined
      const showCancel = this.props.onCancelCheapLfsCommit !== undefined

      return (
        <div className="commit-progress cheap-lfs-progress">
          {this.renderCheapLfsTerminal(commitOperationPhase.progress)}
          {showManualUpload && (
            <Button
              type="button"
              className="cheap-lfs-action"
              onClick={this.props.onManualCheapLfsUpload}
            >
              {t('cheapLfs.manualUpload')}
            </Button>
          )}
          {showCancel && (
            <Button
              type="button"
              className="cheap-lfs-action cheap-lfs-cancel"
              onClick={this.props.onCancelCheapLfsCommit}
            >
              {t('cheapLfs.cancel')}
            </Button>
          )}
        </div>
      )
    }

    if (!hookProgress) {
      return null
    }

    const { status, hookName } = hookProgress

    const text =
      hookName === 'pre-auto-gc' && status === 'finished'
        ? 'Optimizing repository…'
        : status === 'started'
        ? `${hookName} hook running…`
        : status === 'finished'
        ? `${hookName} hook finished`
        : status === 'failed'
        ? `${hookName} hook failed`
        : assertNever(status, `Unknown hook status: ${status}`)

    const cn = classNames('commit-progress', {
      'with-button': onShowCommitProgress !== undefined,
    })
    return (
      <div className={cn}>
        <div className="description">{text}</div>
        {onShowCommitProgress && (
          <Button tooltip="Show commit progress" onClick={onShowCommitProgress}>
            <MaterialSymbol name="terminal" size={12} />
          </Button>
        )}
      </div>
    )
  }

  public render() {
    const className = classNames('commit-message-component', {
      'with-action-bar': true,
      'with-co-authors': this.isCoAuthorInputVisible,
    })

    const descriptionClassName = classNames('description-field', {
      'with-overflow': this.state.descriptionObscured,
    })

    const showRepoRuleCommitMessageFailureHint =
      this.state.repoRulesEnabled &&
      this.state.repoRuleCommitMessageFailures.status !== 'pass'

    const showSummaryLengthHint =
      this.props.showCommitLengthWarning &&
      !showRepoRuleCommitMessageFailureHint &&
      this.state.commitMessage.summary.length > IdealSummaryLength

    const summaryClassName = classNames('summary', {
      'with-trailing-icon':
        showRepoRuleCommitMessageFailureHint || showSummaryLengthHint,
    })
    const summaryInputClassName = classNames('summary-field', 'nudge-arrow', {
      'nudge-arrow-left': this.props.shouldNudge === true,
    })

    const ariaDescribedBy = showRepoRuleCommitMessageFailureHint
      ? this.COMMIT_MSG_ERROR_BTN_ID
      : undefined

    const {
      placeholder,
      isCommitting,
      isGeneratingCommitMessage,
      commitSpellcheckEnabled,
    } = this.props

    return (
      <div
        role="group"
        aria-label="Create commit"
        className={className}
        onContextMenu={this.onContextMenu}
        ref={this.wrapperRef}
      >
        {this.renderCommitAuthorIdentity()}
        <div className={summaryClassName} ref={this.summaryGroupRef}>
          {!getShowCommitAuthorInfo() && this.renderAvatar()}

          <AutocompletingInput
            required={true}
            label={this.props.showInputLabels === true ? 'Summary' : undefined}
            screenReaderLabel="Commit summary"
            className={summaryInputClassName}
            placeholder={placeholder}
            value={this.state.commitMessage.summary}
            onValueChanged={this.onSummaryChanged}
            onElementRef={this.onSummaryInputRef}
            autocompletionProviders={
              this.state.commitMessageAutocompletionProviders
            }
            aria-describedby={ariaDescribedBy}
            onContextMenu={this.onAutocompletingInputContextMenu}
            readOnly={
              isCommitting === true || isGeneratingCommitMessage === true
            }
            spellcheck={commitSpellcheckEnabled}
          />
          {showRepoRuleCommitMessageFailureHint &&
            this.renderRepoRuleCommitMessageFailureHint()}
          {showSummaryLengthHint && this.renderSummaryLengthHint()}
        </div>

        {this.state.isRuleFailurePopoverOpen && this.renderRuleFailurePopover()}

        {this.props.showInputLabels === true && (
          <label htmlFor="commit-message-description">Description</label>
        )}
        <FocusContainer
          className="description-focus-container"
          onClick={this.onFocusContainerClick}
        >
          <AutocompletingTextArea
            inputId="commit-message-description"
            rows={2}
            className={descriptionClassName}
            screenReaderLabel={
              this.props.showInputLabels !== true
                ? 'Commit description'
                : undefined
            }
            placeholder="Description"
            value={this.state.commitMessage.description || ''}
            onValueChanged={this.onDescriptionChanged}
            autocompletionProviders={
              this.state.commitMessageAutocompletionProviders
            }
            aria-describedby={ariaDescribedBy}
            ref={this.onDescriptionFieldRef}
            onElementRef={this.onDescriptionTextAreaRef}
            onContextMenu={this.onAutocompletingInputContextMenu}
            readOnly={
              isCommitting === true || isGeneratingCommitMessage === true
            }
            spellcheck={commitSpellcheckEnabled}
          />
          {this.renderActionBar()}
        </FocusContainer>

        {this.renderCoAuthorInput()}

        {this.renderAmendCommitNotice()}
        {this.renderBranchProtectionsRepoRulesCommitWarning()}

        {this.renderSubmitButton()}
        {this.renderCommitProgress()}
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {this.state.isCommittingStatusMessage}
        </span>
      </div>
    )
  }
}
