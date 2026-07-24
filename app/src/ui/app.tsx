import * as React from 'react'
import * as Path from 'path'

import { TransitionGroup, CSSTransition } from 'react-transition-group'
import {
  IAppState,
  RepositorySectionTab,
  FoldoutType,
  SelectionType,
  HistoryTabMode,
  CommitOptions,
} from '../lib/app-state'
import { Dispatcher } from './dispatcher'
import {
  AppStore,
  GitHubUserStore,
  IssuesStore,
  RepositoryTabsStore,
  BuildRunStore,
  ActionsStore,
  GitHubReleasesStore,
  GitHubIssuesStore,
} from '../lib/stores'
import { RepositoryTabStrip } from './repository-tabs/repository-tab-strip'
import { BuildRunToolbarButton } from './build-run/build-run-toolbar-button'
import { BuildRunPanel } from './build-run/build-run-panel'
import { OpencodeFixDialog } from './build-run/opencode-fix-dialog'
import { OpencodeSendDialog } from './build-run/opencode-send-dialog'
import { assertNever } from '../lib/fatal-error'
import { shell } from '../lib/app-shell'
import { updateStore, UpdateStatus } from './lib/update-store'
import { t, translateForAccessibleName } from '../lib/i18n'
import { RetryAction } from '../models/retry-actions'
import { FetchType } from '../models/fetch'
import { shouldRenderApplicationMenu } from './lib/features'
import { ApplicationMenuAltKeyTracker } from './lib/application-menu-alt-key-tracker'
import { matchExistingRepository } from '../lib/repository-matching'
import { getVersion, getName } from './lib/app-proxy'
import {
  getOS,
  isOSNoLongerSupportedByElectron,
  isMacOSAndNoLongerSupportedByElectron,
  isWindowsAndNoLongerSupportedByElectron,
} from '../lib/get-os'
import { MenuEvent, isTestMenuEvent } from '../main-process/menu'
import {
  Repository,
  SubmoduleRepository,
  getGitHubHtmlUrl,
  getNonForkGitHubRepository,
  isRepositoryWithGitHubRepository,
} from '../models/repository'
import { getEditorOverrideLabel } from '../models/editor-override'
import { Branch } from '../models/branch'
import { PreferencesTab } from '../models/preferences'
import { AudioCueStore, getAudioCueStore } from '../lib/audio/audio-cue-store'
import { findItemByAccessKey, itemIsSelectable } from '../models/app-menu'
import { Account, isDotComAccount } from '../models/account'
import { TipState } from '../models/tip'
import { CloneRepositoryTab } from '../models/clone-repository-tab'
import { batchCloneNeedsAttention } from '../models/batch-clone'
import { CloningRepository } from '../models/cloning-repository'
import { IErrorNotice, IErrorNoticeAction } from '../models/error-notice'
import {
  IAppearanceCustomization,
  IRepositoryAppearanceOverrides,
  resolveAppearanceCustomization,
} from '../models/appearance-customization'
import {
  IProfileAppearanceElementSettings,
  IRepositoryAppearanceElementSettings,
  ProfileAppearanceElementId,
  RepositoryAppearanceElementId,
} from '../models/element-appearance'
import {
  isRepositoryFileDrag,
  uniqueDroppedRepositoryPaths,
} from '../lib/repository-folder-drop'

import { TitleBar, ZoomInfo, FullScreenInfo } from './window'

import { RepositoriesList } from './repositories-list'
import { RepositoryView } from './repository'
import { RenameBranch } from './rename-branch'
import { DeleteBranch, DeleteRemoteBranch } from './delete-branch'
import { CloningRepositoryView } from './cloning-repository'
import {
  Toolbar,
  ToolbarItem,
  ToolbarDropdown,
  DropdownState,
  PushPullButton,
  BranchDropdown,
  WorktreeDropdown,
  RevertProgress,
  OneClickCommitPushButton,
  ThemeToggleButton,
} from './toolbar'
import { canAutoCommitPush } from '../lib/automation/automation-guards'
import { Octicon } from './octicons'
import * as octicons from './octicons/octicons.generated'
import {
  showCertificateTrustDialog,
  sendReady,
  isInApplicationFolder,
  selectAllWindowContents,
  installWindowsCLI,
  uninstallWindowsCLI,
  openRepositoryInNewWindow,
  setWindowTitle,
} from './main-process-proxy'
import { DiscardChanges } from './discard-changes'
import { Welcome } from './welcome'
import { FirstRunChecklist } from './welcome/first-run-checklist'
import { AppMenuBar } from './app-menu'
import { UpdateAvailable, renderBanner } from './banners'
import { Preferences } from './preferences'
import { SettingsHistoryDialog } from './settings-history'
import { IVersionedStoreHistorySource } from './version-history'
import { NotificationHistoryDialog } from './notifications/notification-history-dialog'
import { NotificationAutomationsDialog } from './notifications/notification-automations-dialog'
import { LogHistoryDialog } from './log-history/log-history-dialog'
import { FileHistory } from './file-history'
import { SparseCheckoutManager } from './sparse-checkout'
import { BranchRulesInspector } from './branch-rules'
import { EffectiveBranchRulesAPIDataSource } from '../lib/effective-branch-rules-api'
import {
  EffectiveBranchRulesLoader,
  EffectiveBranchRulesetCache,
} from '../lib/effective-branch-rules-loader'
import {
  resolveEffectiveBranchRulesAccount,
  resolveEffectiveBranchRulesContext,
} from '../lib/effective-branch-rules-context'
import { CreateGitHubIssueDialog } from './create-github-issue'
import { CreateGitHubPullRequestDialog } from './create-github-pull-request'
import { GitHubPullRequestLifecycleDialog } from './github-pull-request-lifecycle'
import { GitLabMergeRequestDialog } from './merge-request'
import type { IGitLabMergeRequestDialogService } from './merge-request'
import { getGitHubPullRequestContextVersion } from '../lib/github-pull-request'
import { NotificationCentrePanel } from './notifications/notification-centre-panel'
import { INotificationEntry } from '../models/notification-centre'
import { ErrorNoticeStack } from './error-notice-stack'
import { CrashProofBoundary } from './crash-proof-boundary'
import { Button } from './lib/button'
import { PopoverAnchorPosition } from './lib/popover'
import { MergeAllDialog } from './merge-all'
import { PullAllDialog } from './pull-all'
import { PullPreviewDialog } from './pull-preview'
import { CommitAndPushAllDialog } from './commit-push-all'
import { isCommitPushAllRepositoryClean } from '../lib/automation/commit-push-all'
import { EditCopilotBYOKProviderDialog } from './copilot/edit-byok-provider-dialog'
import { EditCopilotBYOKModelDialog } from './copilot/edit-byok-model-dialog'
import { ConfirmDeleteCopilotBYOKProviderDialog } from './copilot/confirm-delete-byok-provider-dialog'
import type { IBYOKProvider } from '../lib/copilot/byok'
import { getConflictResolutionModelDisplay } from '../lib/copilot/conflict-resolution-model'
import { OpenWithExternalEditor } from './open-with-external-editor/open-with-external-editor'
import {
  AddSubmoduleDialog,
  RepositorySettings,
  RepositorySettingsTab,
} from './repository-settings'
import { AppError } from './app-error'
import { MissingRepository } from './missing-repository'
import { AddExistingRepository, CreateRepository } from './add-repository'
import {
  CloneRepository,
  BatchCloneProgress,
  CloneableSubmodulesDialog,
} from './clone-repository'
import { SubmoduleManagerDialog } from './submodules/submodule-manager-dialog'
import { SubmoduleConfigDialog } from './submodules/submodule-config-dialog'
import { SubmoduleBackButton } from './submodules/submodule-back-button'
import {
  AnchoredAppearanceEditor,
  IAnchoredAppearanceEditorControls,
  IFeatureHighlightingAppearance,
  IRepositoryTabsAppearance,
  AppIdentityAppearanceEditor,
  AppWorkspaceAppearanceEditor,
  CodeDiffAppearanceEditor,
  DefaultRepositoryLogoAppearanceEditor,
  FeatureHighlightingAppearanceEditor,
  RepositoryListAppearanceEditor,
  RepositoryTabsAppearanceEditor,
  RepositoryTabsOverrideAppearanceEditor,
  RepositoryToolbarAppearanceEditor,
  RepositoryWorkspaceAppearanceEditor,
  ToolbarAppearanceEditor,
  UpdateProgressAppearanceEditor,
} from './appearance'
import { LocalizedText } from './lib/localized-text'
import { SubtreeManagerDialog } from './subtrees/subtree-manager-dialog'
import { AddSubtreeDialog } from './subtrees/add-subtree-dialog'
import { IGitModulesEntry } from '../lib/git/gitmodules'
import { InsufficientScopesDialog } from './insufficient-scopes/insufficient-scopes-dialog'
import { CommandPalette } from './command-palette/command-palette'
import {
  ExportRepositoriesDialog,
  ImportRepositoriesDialog,
} from './repository-list-transfer'
import {
  ExportTabSessionDialog,
  ImportTabSessionDialog,
} from './tab-session-transfer'
import { CreateBranch } from './create-branch'
import { SignIn } from './sign-in'
import { InstallGit } from './install-git'
import { EditorError } from './editor'
import { About } from './about'
import { Publish } from './publish-repository'
import { Acknowledgements } from './acknowledgements'
import { UntrustedCertificate } from './untrusted-certificate'
import { NoRepositoriesView } from './no-repositories'
import { ConfirmRemoveRepository } from './remove-repository'
import { TermsAndConditions } from './terms-and-conditions'
import { PushBranchCommits } from './branches'
import { CLIInstalled } from './cli-installed'
import { GenericGitAuthentication } from './generic-git-auth'
import { ShellError } from './shell'
import { InitializeLFS, AttributeMismatch } from './lfs'
import { UpstreamAlreadyExists } from './upstream-already-exists'
import { ReleaseNotes } from './release-notes'
import { DeletePullRequest } from './delete-branch/delete-pull-request-dialog'
import { CommitConflictsWarning } from './merge-conflicts'
import { AppTheme } from './app-theme'
import { ButtonHints } from './lib/button-hints'
import { ApplicationTheme } from './lib/application-theme'
import { RepositoryStateCache } from '../lib/stores/repository-state-cache'
import { hasModalPopup, PopupType, Popup } from '../models/popup'
import { OversizedFiles } from './changes/oversized-files-warning'
import { PushNeedsPullWarning } from './push-needs-pull'
import { getCurrentBranchForcePushState } from '../lib/rebase'
import { getForkRepositoryEligibility } from '../lib/fork-repository'
import { Banner, BannerType } from '../models/banner'
import { StashAndSwitchBranch } from './stash-changes/stash-and-switch-branch-dialog'
import { ConfirmDiscardStashDialog } from './stashing/confirm-discard-stash'
import { ConfirmCheckoutCommitDialog } from './checkout/confirm-checkout-commit'
import { ConfirmDeletePushedTagDialog } from './tag/confirm-delete-pushed-tag'
import { CreateTutorialRepositoryDialog } from './no-repositories/create-tutorial-repository-dialog'
import { ConfirmExitTutorial } from './tutorial'
import { TutorialStep, isValidTutorialStep } from '../models/tutorial-step'
import { WorkflowPushRejectedDialog } from './workflow-push-rejected/workflow-push-rejected'
import { SAMLReauthRequiredDialog } from './saml-reauth-required/saml-reauth-required'
import { CreateForkDialog } from './forks/create-fork-dialog'
import { findContributionTargetDefaultBranch } from '../lib/branch'
import {
  GitHubRepository,
  hasWritePermission,
} from '../models/github-repository'
import { CreateTag } from './create-tag'
import { DeleteTag } from './delete-tag'
import { ChooseForkSettings } from './choose-fork-settings'
import { DiscardSelection } from './discard-changes/discard-selection-dialog'
import { LocalChangesOverwrittenDialog } from './local-changes-overwritten/local-changes-overwritten-dialog'
import memoizeOne from 'memoize-one'
import { AheadBehindStore } from '../lib/stores/ahead-behind-store'
import {
  getAccountForCommitMessageGeneration,
  getAccountForRepository,
} from '../lib/get-account-for-repository'
import { CommitOneLine } from '../models/commit'
import { CommitDragElement } from './drag-elements/commit-drag-element'
import classNames from 'classnames'
import { MoveToApplicationsFolder } from './move-to-applications-folder'
import { ChangeRepositoryAlias } from './change-repository-alias/change-repository-alias-dialog'
import { ChangeRepositoryGroupName } from './change-repository-group-name/change-repository-group-name-dialog'
import { ThankYou } from './thank-you'
import {
  getUserContributions,
  hasUserAlreadyBeenCheckedOrThanked,
  updateLastThankYou,
} from '../lib/thank-you'
import { ReleaseNote } from '../models/release-notes'
import { CommitMessageDialog } from './commit-message/commit-message-dialog'
import { buildAutocompletionProviders } from './autocompletion'
import { DragType, DropTargetSelector } from '../models/drag-drop'
import { dragAndDropManager } from '../lib/drag-and-drop-manager'
import { MultiCommitOperation } from './multi-commit-operation/multi-commit-operation'
import { WarnLocalChangesBeforeUndo } from './undo/warn-local-changes-before-undo'
import { WarnUndoPushedCommit } from './undo/warn-undo-pushed-commit'
import { WarningBeforeReset } from './reset/warning-before-reset'
import { WarnResetToPushedCommit } from './reset/warn-reset-to-pushed-commit'
import { InvalidatedToken } from './invalidated-token/invalidated-token'
import { MultiCommitOperationKind } from '../models/multi-commit-operation'
import { AddSSHHost } from './ssh/add-ssh-host'
import { SSHKeyPassphrase } from './ssh/ssh-key-passphrase'
import { getMultiCommitOperationChooseBranchStep } from '../lib/multi-commit-operation'
import { ConfirmForcePush } from './rebase/confirm-force-push'
import { PullRequestChecksFailed } from './notifications/pull-request-checks-failed'
import { CICheckRunRerunDialog } from './check-runs/ci-check-run-rerun-dialog'
import { WarnForcePushDialog } from './multi-commit-operation/dialog/warn-force-push-dialog'
import { clamp } from '../lib/clamp'
import { generateRepositoryListContextMenu } from './repositories-list/repository-list-item-context-menu'
import * as ipcRenderer from '../lib/ipc-renderer'
import { DiscardChangesRetryDialog } from './discard-changes/discard-changes-retry-dialog'
import { PullRequestReview } from './notifications/pull-request-review'
import { getRepositoryType } from '../lib/git'
import { SSHUserPassword } from './ssh/ssh-user-password'
import { showContextualMenu } from '../lib/menu-item'
import { UnreachableCommitsDialog } from './history/unreachable-commits-dialog'
import { OpenPullRequestDialog } from './open-pull-request/open-pull-request-dialog'
import { sendNonFatalException } from '../lib/helpers/non-fatal-exception'
import { ICustomIntegration } from '../lib/custom-integration'
import { createCommitURL } from '../lib/commit-url'
import { InstallingUpdate } from './installing-update/installing-update'
import { DialogStackContext } from './dialog'
import { TestNotifications } from './test-notifications/test-notifications'
import { NotificationsDebugStore } from '../lib/stores/notifications-debug-store'
import { PullRequestComment } from './notifications/pull-request-comment'
import { UnknownAuthors } from './unknown-authors/unknown-authors-dialog'
import { UnsupportedOSBannerDismissedAtKey } from './banners/os-version-no-longer-supported-banner'
import { offsetFromNow } from '../lib/offset-from'
import { getNumber } from '../lib/local-storage'
import { IconPreviewDialog } from './octicons/icon-preview-dialog'
import { isCertificateErrorSuppressedFor } from '../lib/suppress-certificate-error'
import { webUtils, clipboard } from 'electron'
import { IPaletteCommandContext } from '../lib/command-palette-catalog'
import { showTestUI } from './lib/test-ui-components/test-ui-components'
import { ConfirmCommitFilteredChanges } from './changes/confirm-commit-filtered-changes-dialog'
import { AboutTestDialog } from './about/about-test-dialog'
import { TestCLIActionDialog } from './cli-action/test-cli-action-dialog'
import {
  enableCopilotSdkCommitMessageGeneration,
  enableWorktreeSupport,
} from '../lib/feature-flag'
import {
  ISecretScanResult,
  PushProtectionErrorDialog,
} from './secret-scanning/push-protection-error-dialog'
import { GenerateCommitMessageOverrideWarning } from './generate-commit-message/generate-commit-message-override-warning'
import { CopilotDisclaimer } from './copilot/copilot-disclaimer'
import { CopilotConflictResolutionAlwaysNudge } from './multi-commit-operation/dialog/copilot-conflict-resolution-always-nudge'
import {
  IAPICreatePushProtectionBypassResponse,
  IAPIRepository,
} from '../lib/api'
import {
  BypassPushProtectionDialog,
  BypassReason,
  BypassReasonType,
} from './secret-scanning/bypass-push-protection-dialog'
import { HookFailed } from './hook-failed/hook-failed'
import { CommitProgress } from './commit-progress/commit-progress'
import { AddWorktreeDialog } from './worktrees/add-worktree-dialog'
import { RenameWorktreeDialog } from './worktrees/rename-worktree-dialog'
import { DeleteWorktreeDialog } from './worktrees/delete-worktree-dialog'
import { DeleteWorktreeFailedDialog } from './worktrees/delete-worktree-failed-dialog'
import { WorktreeEntry } from '../models/worktree'
import { SubmoduleReturnInFlightGuard } from './submodules/submodule-return-in-flight-guard'

const MinuteInMilliseconds = 1000 * 60
const HourInMilliseconds = MinuteInMilliseconds * 60

/**
 * Check for updates every 4 hours
 */
const UpdateCheckInterval = 4 * HourInMilliseconds

/**
 * Send usage stats every 4 hours
 */
const SendStatsInterval = 4 * HourInMilliseconds

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

interface IAppProps {
  readonly dispatcher: Dispatcher
  readonly repositoryStateManager: RepositoryStateCache
  readonly appStore: AppStore
  readonly issuesStore: IssuesStore
  readonly gitHubUserStore: GitHubUserStore
  readonly aheadBehindStore: AheadBehindStore
  readonly notificationsDebugStore: NotificationsDebugStore
  readonly repositoryTabsStore: RepositoryTabsStore
  readonly buildRunStore: BuildRunStore
  readonly actionsStore: ActionsStore
  readonly releasesStore: GitHubReleasesStore
  readonly issueWorkflowsStore: GitHubIssuesStore
  readonly startTime: number
}

type ProfileAppearanceEditorTarget = {
  readonly kind: 'profile'
  readonly elementId: ProfileAppearanceElementId
  readonly anchor: HTMLElement
  readonly profileKey: string
}

type FeatureAppearanceEditorTarget = {
  readonly kind: 'feature'
  readonly featureId: string
  readonly label: string
  readonly anchor: HTMLElement
  readonly highlighted: boolean
  readonly profileKey: string
}

type RepositoryAppearanceEditorTarget = {
  readonly kind: 'repository'
  readonly elementId:
    | typeof RepositoryAppearanceElementId.Workspace
    | typeof RepositoryAppearanceElementId.Toolbar
    | typeof RepositoryAppearanceElementId.Tabs
  readonly repository: Repository
  readonly anchor: HTMLElement
  readonly values: IRepositoryAppearanceElementSettings
  readonly historySource: IVersionedStoreHistorySource
  readonly repositoryPath: string
  readonly profileKey: string
}

type AppearanceEditorTarget =
  | ProfileAppearanceEditorTarget
  | FeatureAppearanceEditorTarget
  | RepositoryAppearanceEditorTarget

export const dialogTransitionTimeout = {
  enter: 250,
  exit: 100,
}

/**
 * The set of popup types that should render as blocking modal dialogs (with a
 * scrim and the native top layer). Every other popup renders as a non-modal
 * floating dialog that leaves the app underneath interactive. Errors are
 * deliberately left non-modal so the user can keep working while acknowledging
 * them.
 */
const ModalPopupTypes = new Set<PopupType>([
  PopupType.InstallingUpdate,
  PopupType.PullPreview,
])

export const bannerTransitionTimeout = { enter: 500, exit: 400 }

/**
 * The time to delay (in ms) from when we've loaded the initial state to showing
 * the window. This is try to give Chromium enough time to flush our latest DOM
 * changes. See https://github.com/desktop/desktop/issues/1398.
 */
const ReadyDelay = 100
export class App extends React.Component<IAppProps, IAppState> {
  private loading = true
  private mounted = false
  private initializationError: Error | null = null
  /**
   * The checklist belongs to a welcome flow completed in this process. Keeping
   * this transient prevents an app update from presenting existing users with
   * a new first-run modal before their workspace becomes interactive.
   */
  private showFirstRunChecklist = false
  private repositoryFileDragDepth = 0
  private readonly effectiveBranchRulesetCache =
    new EffectiveBranchRulesetCache()
  private readonly getEffectiveBranchRulesClient = memoizeOne(
    (account: Account, repository: GitHubRepository, _contextVersion: string) =>
      new EffectiveBranchRulesLoader(
        new EffectiveBranchRulesAPIDataSource(account, repository),
        { rulesetCache: this.effectiveBranchRulesetCache }
      )
  )

  private readonly applicationMenuAltKeyTracker =
    new ApplicationMenuAltKeyTracker()

  private updateIntervalHandle?: number

  private repositoryViewRef = React.createRef<RepositoryView>()
  private repositoryDropdownRef = React.createRef<ToolbarDropdown>()
  /** Transient anchored editor state; durable values live in element stores. */
  private appearanceEditorTarget: AppearanceEditorTarget | null = null
  private readonly featureAppearanceValues = new Map<string, boolean>()
  private readonly featureAppearanceLoads = new Map<string, number>()
  private appearanceProfileKey = this.props.dispatcher.getActiveProfileKey()
  private featureAppearanceGeneration = 0
  private readonly submoduleReturnInFlight = new SubmoduleReturnInFlightGuard(
    () => {
      if (this.mounted) {
        this.forceUpdate()
      }
    }
  )

  private readonly refreshRepositoryHandlers = new WeakMap<
    Repository,
    () => Promise<void>
  >()

  /**
   * Gets a value indicating whether or not we're currently showing a
   * modal dialog such as the preferences, or an error dialog.
   */
  private get isShowingModal() {
    return hasModalPopup(this.state.allPopups)
  }

  /**
   * Returns a memoized instance of onPopupDismissed() bound to the
   * passed popupType, so it can be used in render() without creating
   * multiple instances when the component gets re-rendered.
   */
  private getOnPopupDismissedFn = memoizeOne((popupId: number) => {
    return () => this.onPopupDismissed(popupId)
  })

  /**
   * Returns a memoized instance of a callback that brings the popup with the
   * given id to the front of the popup stack, so it can be passed via the
   * DialogStackContext without creating a new function on every render.
   */
  private getOnPopupRequestFrontFn = memoizeOne((popupId: number) => {
    return () => this.props.dispatcher.bringPopupToFront(popupId)
  })

  /** Renderer-only audio system (TTS narrator, SFX, per-repo music). */
  private readonly audioCueStore: AudioCueStore = getAudioCueStore()
  /** Notification ids already routed to audio, so we never replay history. */
  private readonly audioSeenNotificationIds = new Set<string>()
  /** Seeded on the first update so startup history stays silent. */
  private audioSeeded = false
  /** Last repository path handed to the audio system, to detect changes. */
  private audioLastRepositoryPath: string | null = null

  public constructor(props: IAppProps) {
    super(props)

    props.dispatcher.loadInitialState().then(
      () => {
        this.loading = false
        this.forceUpdate()

        requestIdleCallback(
          () => {
            const now = performance.now()
            sendReady(now - props.startTime)

            requestIdleCallback(() => {
              this.performDeferredLaunchActions()
            })
          },
          { timeout: ReadyDelay }
        )
      },
      error => {
        const normalizedError =
          error instanceof Error
            ? error
            : new Error('Initial application state could not be loaded.')
        try {
          log.error('Initial application state failed to load', normalizedError)
        } catch {
          // The visible startup recovery must not depend on diagnostics.
        }
        try {
          sendNonFatalException('startupInitialization', normalizedError)
        } catch {
          // Continue to the bounded recovery surface when reporting is down.
        }
        this.initializationError = normalizedError
        this.loading = false
        this.forceUpdate(() => {
          sendReady(performance.now() - props.startTime)
        })
      }
    )

    this.state = props.appStore.getState()
    props.appStore.onDidUpdate(state => {
      if (this.state.showWelcomeFlow && !state.showWelcomeFlow) {
        this.showFirstRunChecklist = true
      }
      this.syncAudioSystem(state)
      this.setState(state)
    })

    props.appStore.onDidError(error => {
      props.dispatcher.postError(error)
    })

    ipcRenderer.on('menu-event', (_, name) => this.onMenuEvent(name))

    updateStore.onDidChange(async state => {
      const status = state.status

      if (
        !(__RELEASE_CHANNEL__ === 'development') &&
        status === UpdateStatus.UpdateReady
      ) {
        this.props.dispatcher.setUpdateBannerVisibility(true)
      }

      if (
        status !== UpdateStatus.UpdateReady &&
        (await updateStore.isUpdateShowcase())
      ) {
        this.props.dispatcher.setUpdateShowCaseVisibility(true)
      }
    })

    updateStore.onError(error => {
      log.error(`Error checking for updates`, error)

      this.props.dispatcher.postError(error)
    })

    ipcRenderer.on('launch-timing-stats', (_, stats) => {
      console.info(`App ready time: ${stats.mainReadyTime}ms`)
      console.info(`Load time: ${stats.loadTime}ms`)
      console.info(`Renderer ready time: ${stats.rendererReadyTime}ms`)

      this.props.dispatcher.recordLaunchStats(stats)
    })

    ipcRenderer.on('certificate-error', (_, certificate, error, url) => {
      if (isCertificateErrorSuppressedFor(url)) {
        return
      }

      this.props.dispatcher.showPopup({
        type: PopupType.UntrustedCertificate,
        certificate,
        url,
      })
    })

    dragAndDropManager.onDragEnded(this.onDragEnd)
  }

  public componentWillUnmount() {
    this.mounted = false
    this.submoduleReturnInFlight.dispose()
    window.clearInterval(this.updateIntervalHandle)
    document.body.classList.remove('repository-folder-dragging')
    document.removeEventListener('contextmenu', this.onCustomizationContextMenu)

    if (__DARWIN__) {
      window.removeEventListener('keydown', this.onMacOSWindowKeyDown)
    }
  }

  private async performDeferredLaunchActions() {
    // Loading emoji is super important but maybe less important that loading
    // the app. So defer it until we have some breathing space.
    this.props.appStore.loadEmoji()

    this.props.dispatcher.reportStats()
    setInterval(() => this.props.dispatcher.reportStats(), SendStatsInterval)

    this.props.dispatcher.installGlobalLFSFilters(false)

    // We only want to automatically check for updates on beta and prod
    if (
      __RELEASE_CHANNEL__ !== 'development' &&
      __RELEASE_CHANNEL__ !== 'test'
    ) {
      setInterval(() => this.checkForUpdates(true), UpdateCheckInterval)
      this.checkForUpdates(true)
    } else if (await updateStore.isUpdateShowcase()) {
      // The only purpose of this call is so we can see the showcase on dev/test
      // env. Prod and beta environment will trigger this during automatic check
      // for updates.
      this.props.dispatcher.setUpdateShowCaseVisibility(true)
    }

    log.info(`launching: ${getVersion()} (${getOS()})`)
    log.info(`execPath: '${process.execPath}'`)

    // Only show the popup in beta/production releases and mac machines
    if (
      __DEV__ === false &&
      this.state.askToMoveToApplicationsFolderSetting &&
      __DARWIN__ &&
      (await isInApplicationFolder()) === false
    ) {
      this.showPopup({ type: PopupType.MoveToApplicationsFolder })
    }

    this.setOnOpenBanner()
  }

  /**
   * This method sets the app banner on opening the app. The last banner set in
   * this method will be the one shown as only one banner is shown at a time.
   * The only exception is the update available banner is always
   * prioritized over other banners.
   *
   * Priority:
   * 1. OS Not Supported by Electron
   * 2. Accessibility Settings Banner
   * 3. Thank you banner
   */
  private setOnOpenBanner() {
    if (isOSNoLongerSupportedByElectron()) {
      const dismissedAt = getNumber(UnsupportedOSBannerDismissedAtKey, 0)

      // Remind the user that they're running an unsupported OS every 90 days
      if (dismissedAt < offsetFromNow(-90, 'days')) {
        this.setBanner({ type: BannerType.OSVersionNoLongerSupported })
        return
      }
    }

    this.checkIfThankYouIsInOrder()
  }

  private onMenuEvent(name: MenuEvent): any {
    // Don't react to menu events when an error dialog is shown.
    if (name !== 'test-app-error' && this.state.errorCount > 1) {
      return
    }

    switch (name) {
      case 'open-new-window':
        return this.openNewWindow()
      case 'push':
        return this.push()
      case 'force-push':
        return this.push({ forceWithLease: true })
      case 'pull':
        return this.pull()
      case 'fetch':
        return this.fetch()
      case 'fork-repository':
        return this.forkRepository(this.getRepository())
      case 'show-changes':
        return this.showChanges(true)
      case 'show-history':
        return this.showHistory(true)
      case 'show-repository-tools':
        return this.showRepositoryTools()
      case 'choose-repository':
        return this.chooseRepository()
      case 'add-local-repository':
        return this.showAddLocalRepo()
      case 'create-branch':
        return this.showCreateBranch()
      case 'show-branches':
        return this.showBranches()
      case 'show-worktrees':
        return this.showWorktrees()
      case 'create-worktree':
        return this.showCreateWorktree()
      case 'remove-repository':
        return this.removeRepository(this.getRepository())
      case 'create-repository':
        return this.showCreateRepository()
      case 'rename-branch':
        return this.renameBranch()
      case 'delete-branch':
        return this.deleteBranch()
      case 'discard-all-changes':
        return this.discardAllChanges(false)
      case 'permanently-discard-all-changes':
        return this.discardAllChanges(true)
      case 'stash-all-changes':
        return this.stashAllChanges()
      case 'show-preferences':
        return this.props.dispatcher.showPopup({ type: PopupType.Preferences })
      case 'show-settings-history':
        return this.props.dispatcher.showPopup({
          type: PopupType.SettingsHistory,
        })
      case 'view-log-history':
        return this.props.dispatcher.showPopup({
          type: PopupType.LogHistory,
        })
      case 'open-working-directory':
        return this.openCurrentRepositoryWorkingDirectory()
      case 'update-branch-with-contribution-target-branch':
        this.props.dispatcher.incrementMetric(
          'updateFromDefaultBranchMenuCount'
        )
        return this.updateBranchWithContributionTargetBranch()
      case 'compare-to-branch':
        return this.showHistory(false, true)
      case 'merge-branch':
        this.props.dispatcher.recordMenuInitiatedMerge()
        return this.mergeBranch()
      case 'squash-and-merge-branch':
        this.props.dispatcher.recordMenuInitiatedMerge(true)
        return this.mergeBranch(true)
      case 'rebase-branch':
        this.props.dispatcher.incrementMetric('rebaseCurrentBranchMenuCount')
        return this.showRebaseDialog()
      case 'show-repository-settings':
        return this.showRepositorySettings()
      case 'manage-gitignore':
        return this.showRepositorySettings(RepositorySettingsTab.IgnoredFiles)
      case 'manage-sparse-checkout':
        return this.showSparseCheckout()
      case 'build-and-run':
        return this.buildAndRun()
      case 'view-repository-on-github':
        return this.viewRepositoryOnGitHub()
      case 'inspect-branch-rules':
        return this.showBranchRules()
      case 'compare-on-github':
        return this.openBranchOnGitHub('compare')
      case 'branch-on-github':
        return this.openBranchOnGitHub('tree')
      case 'create-issue-in-repository-on-github':
        return this.openIssueCreationOnGitHub()
      case 'open-in-shell':
        return this.openCurrentRepositoryInShell()
      case 'clone-repository':
        return this.showCloneRepo()
      case 'export-repository-list':
        return this.showExportRepositoryList()
      case 'import-repository-list':
        return this.showImportRepositoryList()
      case 'export-tab-session':
        return this.showExportTabSession()
      case 'import-tab-session':
        return this.showImportTabSession()
      case 'show-about':
        return this.showAbout()
      case 'go-to-commit-message':
        return this.goToCommitMessage()
      case 'open-pull-request':
        return this.openPullRequest()
      case 'preview-pull-request':
        return this.startPullRequest()
      case 'install-darwin-cli':
        return this.props.dispatcher.installDarwinCLI()
      case 'install-windows-cli':
        return installWindowsCLI()
      case 'uninstall-windows-cli':
        return uninstallWindowsCLI()
      case 'open-external-editor':
        return this.openCurrentRepositoryInExternalEditor()
      case 'open-with-external-editor':
        return this.showOpenWithExternalEditor()
      case 'select-all':
        return this.selectAll()
      case 'show-stashed-changes':
        return this.showStashedChanges()
      case 'hide-stashed-changes':
        return this.hideStashedChanges()
      case 'find-text':
        // Ctrl+F opens the master command palette; the previous find-in-view
        // behavior remains available as the palette's "Find in current view".
        return this.props.dispatcher.showPopup({
          type: PopupType.CommandPalette,
        })
      case 'increase-active-resizable-width':
        return this.resizeActiveResizable('increase-active-resizable-width')
      case 'decrease-active-resizable-width':
        return this.resizeActiveResizable('decrease-active-resizable-width')
      case 'toggle-changes-filter':
        return this.toggleChangesFilterVisibility()
      case 'zoom-in':
        return this.props.dispatcher.zoomIn()
      case 'zoom-out':
        return this.props.dispatcher.zoomOut()
      case 'zoom-reset':
        return this.props.dispatcher.zoomReset()
      default:
        if (isTestMenuEvent(name)) {
          return showTestUI(
            name,
            this.getRepository(),
            this.props.dispatcher,
            this.state.emoji
          )
        }
        return assertNever(name, `Unknown menu event name: ${name}`)
    }
  }

  /**
   * This method dispatches an action to update the changes filter visibility
   */
  private toggleChangesFilterVisibility() {
    this.props.dispatcher.toggleChangesFilterVisibility()
  }

  /**
   * Handler for the 'increase-active-resizable-width' and
   * 'decrease-active-resizable-width' menu event, dispatches a custom DOM event
   * originating from the element which currently has keyboard focus. Components
   * have a chance to intercept this event and implement their resize logic.
   */
  private resizeActiveResizable(
    menuId:
      | 'increase-active-resizable-width'
      | 'decrease-active-resizable-width'
  ) {
    document.activeElement?.dispatchEvent(
      new CustomEvent(menuId, {
        bubbles: true,
        cancelable: true,
      })
    )
  }

  /**
   * Handler for the 'select-all' menu event, dispatches
   * a custom DOM event originating from the element which
   * currently has keyboard focus. Components have a chance
   * to intercept this event and implement their own 'select
   * all' logic.
   */
  private selectAll() {
    const event = new CustomEvent('select-all', {
      bubbles: true,
      cancelable: true,
    })

    if (
      document.activeElement != null &&
      document.activeElement.dispatchEvent(event)
    ) {
      selectAllWindowContents()
    }
  }

  /**
   * Handler for the 'find-text' menu event, dispatches
   * a custom DOM event originating from the element which
   * currently has keyboard focus (or the document if no element
   * has focus). Components have a chance to intercept this
   * event and implement their own 'find-text' logic. One
   * example of this custom event is the text diff which
   * will trigger a search dialog when seeing this event.
   */
  private findText() {
    const event = new CustomEvent('find-text', {
      bubbles: true,
      cancelable: true,
    })

    if (document.activeElement != null) {
      document.activeElement.dispatchEvent(event)
    } else {
      document.dispatchEvent(event)
    }
  }

  private async goToCommitMessage() {
    await this.showChanges(false)
    this.props.dispatcher.setCommitMessageFocus(true)
  }

  private checkForUpdates(
    inBackground: boolean,
    skipGuidCheck: boolean = false
  ) {
    if (__LINUX__ || __RELEASE_CHANNEL__ === 'development') {
      return
    }

    // Desktop Material fork: getUpdatesURL() (script/dist-info.ts) bakes this
    // fork's OWN GitHub releases feed into __UPDATES_URL__, so update checks
    // target the fork — never upstream's Central endpoint (which serves the
    // official GitHub Desktop binaries and would clobber the fork). Guard only
    // against an update feed that was deliberately blanked out at build time so
    // both the automatic background check and the manual "Check for Updates"
    // button become graceful no-ops rather than throwing on an empty URL.
    if (__UPDATES_URL__.length === 0) {
      log.info('Skipping update check: no update feed is configured.')
      return
    }

    if (isWindowsAndNoLongerSupportedByElectron()) {
      log.error(
        `Can't check for updates on Windows 8.1 or older. Next available update only supports Windows 10 and later`
      )
      return
    }

    if (isMacOSAndNoLongerSupportedByElectron()) {
      log.error(
        `Can't check for updates on macOS 10.15 or older. Next available update only supports macOS 11.0 and later`
      )
      return
    }

    updateStore.checkForUpdates(inBackground, skipGuidCheck)
  }

  private updateBranchWithContributionTargetBranch() {
    const { selectedState } = this.state
    if (
      selectedState == null ||
      selectedState.type !== SelectionType.Repository
    ) {
      return
    }

    const { state, repository } = selectedState

    const contributionTargetDefaultBranch = findContributionTargetDefaultBranch(
      repository,
      state.branchesState
    )
    if (!contributionTargetDefaultBranch) {
      return
    }

    this.props.dispatcher.initializeMergeOperation(
      repository,
      false,
      contributionTargetDefaultBranch
    )

    const { mergeStatus } = state.compareState
    this.props.dispatcher.mergeBranch(
      repository,
      contributionTargetDefaultBranch,
      mergeStatus
    )
  }

  private mergeBranch(isSquash: boolean = false) {
    const selectedState = this.state.selectedState
    if (
      selectedState == null ||
      selectedState.type !== SelectionType.Repository
    ) {
      return
    }
    const { repository } = selectedState
    this.props.dispatcher.startMergeBranchOperation(repository, isSquash)
  }

  private openBranchOnGitHub(view: 'tree' | 'compare') {
    const htmlURL = this.getCurrentRepositoryGitHubURL()
    if (!htmlURL) {
      return
    }

    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    const branchTip = state.state.branchesState.tip
    if (
      branchTip.kind !== TipState.Valid ||
      !branchTip.branch.upstreamWithoutRemote
    ) {
      return
    }

    const urlEncodedBranchName = encodeURIComponent(
      branchTip.branch.upstreamWithoutRemote
    )

    const url = `${htmlURL}/${view}/${urlEncodedBranchName}`
    this.props.dispatcher.openInBrowser(url)
  }

  private openCurrentRepositoryWorkingDirectory() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    this.showRepository(state.repository)
  }

  private renameBranch() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    const tip = state.state.branchesState.tip
    if (tip.kind === TipState.Valid) {
      this.props.dispatcher.showPopup({
        type: PopupType.RenameBranch,
        repository: state.repository,
        branch: tip.branch,
      })
    }
  }

  private deleteBranch() {
    const state = this.state.selectedState
    if (state === null || state.type !== SelectionType.Repository) {
      return
    }

    const tip = state.state.branchesState.tip

    if (tip.kind === TipState.Valid) {
      const currentPullRequest = state.state.branchesState.currentPullRequest
      if (currentPullRequest !== null) {
        this.props.dispatcher.showPopup({
          type: PopupType.DeletePullRequest,
          repository: state.repository,
          branch: tip.branch,
          pullRequest: currentPullRequest,
        })
      } else {
        const existsOnRemote = state.state.aheadBehind !== null

        this.props.dispatcher.showPopup({
          type: PopupType.DeleteBranch,
          repository: state.repository,
          branch: tip.branch,
          existsOnRemote: existsOnRemote,
        })
      }
    }
  }

  private discardAllChanges(permanentlyDiscard: boolean) {
    const state = this.state.selectedState

    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    const { workingDirectory } = state.state.changesState

    this.props.dispatcher.showPopup({
      type: PopupType.ConfirmDiscardChanges,
      repository: state.repository,
      files: workingDirectory.files,
      showDiscardChangesSetting: false,
      discardingAllChanges: true,
      permanentlyDelete: permanentlyDiscard,
    })
  }

  private stashAllChanges() {
    const repository = this.getRepository()

    if (repository !== null && repository instanceof Repository) {
      this.props.dispatcher.createStashForCurrentBranch(repository)
    }
  }

  private showAddLocalRepo = () => {
    return this.props.dispatcher.showPopup({ type: PopupType.AddRepository })
  }

  private showCreateRepository = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.CreateRepository,
    })
  }

  /** Execute a command chosen in the master command palette. */
  private onPaletteCommand = (event: string) => {
    switch (event) {
      case 'palette:find-in-view':
        return this.findText()
      case 'palette:toggle-theme':
        return this.toggleSelectedTheme()
      case 'palette:preferences-accounts':
        return this.showPreferencesTab(PreferencesTab.Accounts)
      case 'palette:preferences-appearance':
        return this.showPreferencesTab(PreferencesTab.Appearance)
      case 'palette:preferences-integrations':
        return this.showPreferencesTab(PreferencesTab.Integrations)
      case 'palette:preferences-automation':
        return this.showPreferencesTab(PreferencesTab.Automation)
      case 'palette:preferences-advanced':
        return this.showPreferencesTab(PreferencesTab.Advanced)
      case 'palette:preferences-notifications':
        return this.showPreferencesTab(PreferencesTab.Notifications)
      case 'palette:preferences-git':
        return this.showPreferencesTab(PreferencesTab.Git)
      case 'palette:preferences-accessibility':
        return this.showPreferencesTab(PreferencesTab.Accessibility)
      case 'palette:preferences-copilot':
      case 'palette:ollama-model-manager':
        // The Ollama manager lives inside the Copilot providers tab; the
        // palette names it directly so it is findable by what it does.
        return this.showPreferencesTab(PreferencesTab.Copilot)
      case 'palette:background-queue':
        return this.showPreferencesTab(PreferencesTab.Queue)
      case 'palette:notification-history':
        return this.props.dispatcher.showPopup({
          type: PopupType.NotificationHistory,
        })
      case 'palette:notification-automations':
        return this.props.dispatcher.showPopup({
          type: PopupType.NotificationAutomations,
        })
      case 'palette:copy-repo-path':
        return this.copyCurrentRepositoryPath()
      case 'palette:copy-branch-name':
        return this.copyCurrentBranchName()
      case 'palette:copy-commit-sha':
        return this.copyCurrentCommitSha()
      default:
        return this.onMenuEvent(event as MenuEvent)
    }
  }

  private showPreferencesTab(initialSelectedTab: PreferencesTab) {
    this.props.dispatcher.showPopup({
      type: PopupType.Preferences,
      initialSelectedTab,
    })
  }

  /** Flip between the light and dark themes, resolving "system" to its match. */
  private toggleSelectedTheme() {
    const current = this.state.selectedTheme
    const next =
      current === ApplicationTheme.Dark
        ? ApplicationTheme.Light
        : ApplicationTheme.Dark
    this.props.dispatcher.setSelectedTheme(next)
  }

  /** The selection's repository state, or null when none is fully selected. */
  private getSelectedRepositoryState() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return null
    }
    return state
  }

  private copyCurrentRepositoryPath() {
    const state = this.getSelectedRepositoryState()
    if (state !== null && state.repository instanceof Repository) {
      clipboard.writeText(state.repository.path)
    }
  }

  private copyCurrentBranchName() {
    const tip = this.getSelectedRepositoryState()?.state.branchesState.tip
    if (tip !== undefined && tip.kind === TipState.Valid) {
      clipboard.writeText(tip.branch.name)
    }
  }

  private copyCurrentCommitSha() {
    const tip = this.getSelectedRepositoryState()?.state.branchesState.tip
    if (tip !== undefined && tip.kind === TipState.Valid) {
      clipboard.writeText(tip.branch.tip.sha)
    }
  }

  /** The current selection snapshot the command palette gates commands on. */
  private getPaletteAvailabilityContext(): IPaletteCommandContext {
    const state = this.getSelectedRepositoryState()
    const tip = state?.state.branchesState.tip
    const repository = state?.repository
    return {
      platform: process.platform,
      hasRepository: repository instanceof Repository,
      hasRemote: state?.state.remote != null,
      hasBranch: tip?.kind === TipState.Valid,
      isGitHubRepository:
        repository instanceof Repository && repository.gitHubRepository != null,
    }
  }

  private onReauthorizeAccount = (account: Account) => {
    if (isDotComAccount(account)) {
      this.props.dispatcher.showDotComSignInDialog()
    } else {
      this.props.dispatcher.showEnterpriseSignInDialog()
    }
  }

  private onShowRepositorySubmodules = (
    repository: IAPIRepository,
    entries: ReadonlyArray<IGitModulesEntry>
  ) => {
    this.props.dispatcher.showPopup({
      type: PopupType.CloneableSubmodules,
      parentName: `${repository.owner.login}/${repository.name}`,
      parentCloneUrl: repository.clone_url,
      entries,
    })
  }

  private showCloneRepo = (cloneUrl?: string) => {
    if (
      cloneUrl === undefined &&
      batchCloneNeedsAttention(this.state.batchCloneState)
    ) {
      return this.props.dispatcher.showPopup({
        type: PopupType.BatchCloneProgress,
      })
    }

    let initialURL: string | null = null

    if (cloneUrl !== undefined) {
      this.props.dispatcher.changeCloneRepositoriesTab(
        CloneRepositoryTab.Generic
      )
      initialURL = cloneUrl
    }

    return this.props.dispatcher.showPopup({
      type: PopupType.CloneRepository,
      initialURL,
    })
  }

  private showExportRepositoryList = () => {
    const repositories = this.state.repositories.filter(
      (r): r is Repository => r instanceof Repository
    )

    return this.props.dispatcher.showPopup({
      type: PopupType.ExportRepositoryList,
      repositories,
    })
  }

  private showImportRepositoryList = () => {
    const existingRepositories = this.state.repositories.filter(
      (r): r is Repository => r instanceof Repository
    )

    return this.props.dispatcher.showPopup({
      type: PopupType.ImportRepositoryList,
      existingRepositories,
    })
  }

  private showExportTabSession = () => {
    return this.props.dispatcher.showPopup({ type: PopupType.ExportTabSession })
  }

  private showImportTabSession = () => {
    const existingRepositories = this.state.repositories.filter(
      (repository): repository is Repository => repository instanceof Repository
    )
    return this.props.dispatcher.showPopup({
      type: PopupType.ImportTabSession,
      existingRepositories,
    })
  }

  private showCreateTutorialRepositoryPopup = () => {
    const account =
      this.state.accounts.find(isDotComAccount) ?? this.state.accounts.at(0)

    if (!account) {
      return
    }

    this.props.dispatcher.showPopup({
      type: PopupType.CreateTutorialRepository,
      account,
    })
  }

  private onResumeTutorialRepository = () => {
    const tutorialRepository = this.getSelectedTutorialRepository()
    if (!tutorialRepository) {
      return
    }

    this.props.dispatcher.resumeTutorial(tutorialRepository)
  }

  private getSelectedTutorialRepository() {
    const { selectedState } = this.state
    const selectedRepository =
      selectedState && selectedState.type === SelectionType.Repository
        ? selectedState.repository
        : null

    const isTutorialRepository =
      selectedRepository && selectedRepository.isTutorialRepository

    return isTutorialRepository ? selectedRepository : null
  }

  private showAbout() {
    this.props.dispatcher.showPopup({ type: PopupType.About })
  }

  private async showHistory(
    shouldFocusHistory: boolean,
    showBranchList: boolean = false
  ) {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    await this.props.dispatcher.closeCurrentFoldout()

    await this.props.dispatcher.initializeCompare(state.repository, {
      kind: HistoryTabMode.History,
    })

    await this.props.dispatcher.changeRepositorySection(
      state.repository,
      RepositorySectionTab.History
    )

    await this.props.dispatcher.updateCompareForm(state.repository, {
      filterText: '',
      showBranchList,
    })

    if (shouldFocusHistory) {
      this.repositoryViewRef.current?.setFocusHistoryNeeded()
    }
  }

  private async showChanges(shouldFocusChanges: boolean) {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    this.props.dispatcher.closeCurrentFoldout()

    await this.props.dispatcher.changeRepositorySection(
      state.repository,
      RepositorySectionTab.Changes
    )

    if (shouldFocusChanges) {
      this.repositoryViewRef.current?.setFocusChangesNeeded()
    }
  }

  private async showRepositoryTools() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    await this.props.dispatcher.closeCurrentFoldout()
    await this.props.dispatcher.changeRepositorySection(
      state.repository,
      RepositorySectionTab.RepositoryTools
    )
  }

  private chooseRepository() {
    if (
      this.state.currentFoldout &&
      this.state.currentFoldout.type === FoldoutType.Repository
    ) {
      return this.props.dispatcher.closeFoldout(FoldoutType.Repository)
    }

    return this.props.dispatcher.showFoldout({
      type: FoldoutType.Repository,
    })
  }

  private showBranches() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    if (
      this.state.currentFoldout &&
      this.state.currentFoldout.type === FoldoutType.Branch
    ) {
      return this.props.dispatcher.closeFoldout(FoldoutType.Branch)
    }

    return this.props.dispatcher.showFoldout({ type: FoldoutType.Branch })
  }

  private showWorktrees() {
    if (!enableWorktreeSupport()) {
      return
    }

    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    if (
      this.state.currentFoldout &&
      this.state.currentFoldout.type === FoldoutType.Worktree
    ) {
      return this.props.dispatcher.closeFoldout(FoldoutType.Worktree)
    }

    return this.props.dispatcher.showFoldout({ type: FoldoutType.Worktree })
  }

  private showCreateWorktree() {
    if (!enableWorktreeSupport()) {
      return
    }

    const state = this.state.selectedState
    if (
      state == null ||
      state.type !== SelectionType.Repository ||
      state.repository instanceof SubmoduleRepository
    ) {
      return
    }

    this.props.dispatcher.showPopup({
      type: PopupType.AddWorktree,
      repository: state.repository,
    })
  }

  private push(options?: { forceWithLease: boolean }) {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    if (options && options.forceWithLease) {
      this.props.dispatcher.confirmOrForcePush(state.repository)
    } else {
      this.props.dispatcher.push(state.repository)
    }
  }

  private async pull() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    this.props.dispatcher.showPopup({
      type: PopupType.PullPreview,
      repository: state.repository,
    })
  }

  private async fetch() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    this.props.dispatcher.fetch(state.repository, FetchType.UserInitiatedTask)
  }

  private showStashedChanges() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    this.props.dispatcher.selectStashedFile(state.repository)
  }

  private hideStashedChanges() {
    const state = this.state.selectedState
    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    this.props.dispatcher.hideStashedChanges(state.repository)
  }

  public componentDidMount() {
    this.mounted = true
    document.addEventListener('contextmenu', this.onCustomizationContextMenu)
    document.ondragenter = e => {
      if (
        e.dataTransfer !== null &&
        isRepositoryFileDrag(e.dataTransfer.types) &&
        !this.isShowingModal
      ) {
        this.repositoryFileDragDepth++
        document.body.classList.add('repository-folder-dragging')
      }
    }

    document.ondragleave = e => {
      if (
        e.dataTransfer !== null &&
        isRepositoryFileDrag(e.dataTransfer.types)
      ) {
        this.repositoryFileDragDepth = Math.max(
          0,
          this.repositoryFileDragDepth - 1
        )
        if (this.repositoryFileDragDepth === 0) {
          document.body.classList.remove('repository-folder-dragging')
        }
      }
    }

    document.ondragover = e => {
      if (e.dataTransfer != null) {
        if (this.isShowingModal) {
          e.dataTransfer.dropEffect = 'none'
        } else if (isRepositoryFileDrag(e.dataTransfer.types)) {
          e.dataTransfer.dropEffect = 'copy'
        }
      }

      e.preventDefault()
    }

    document.ondrop = e => {
      this.clearRepositoryFileDrag()
      e.preventDefault()
    }

    document.body.ondrop = e => {
      if (this.isShowingModal) {
        return
      }
      if (e.dataTransfer != null) {
        const files = e.dataTransfer.files
        void this.handleDragAndDrop(files)
      }
      this.clearRepositoryFileDrag()
      e.preventDefault()
    }

    if (shouldRenderApplicationMenu()) {
      window.addEventListener('keydown', this.onWindowKeyDown)
      window.addEventListener('keyup', this.onWindowKeyUp)
    }

    if (__DARWIN__) {
      window.addEventListener('keydown', this.onMacOSWindowKeyDown)
    }

    document.addEventListener('focus', this.onDocumentFocus, {
      capture: true,
    })

    this.updateWindowTitle()
    window.requestAnimationFrame(() => this.syncFeatureAppearanceOwners())
  }

  private clearRepositoryFileDrag() {
    this.repositoryFileDragDepth = 0
    document.body.classList.remove('repository-folder-dragging')
  }

  /**
   * Offer one consistent customization/history contract for otherwise
   * unhandled shell surfaces. Existing specialized context menus win because
   * they prevent the event before it reaches this document listener.
   */
  private onCustomizationContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) {
      return
    }
    if (event.target.closest('[data-context-menu-owner="true"]') !== null) {
      return
    }
    if (
      event.target.closest(
        'input, textarea, select, [contenteditable="true"], [role="textbox"]'
      ) !== null
    ) {
      return
    }

    const feature = event.target.closest<HTMLElement>('[data-dm-feature]')
    if (feature !== null) {
      const featureId = this.getStableFeatureElementId(feature)
      if (featureId === null) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      this.prepareAppearanceAnchor(feature)
      const profileKey = this.props.dispatcher.getActiveProfileKey()
      void this.props.dispatcher
        .getFeatureAppearanceElement(featureId)
        .then(value => {
          if (
            !this.mounted ||
            !feature.isConnected ||
            this.props.dispatcher.getActiveProfileKey() !== profileKey
          ) {
            return
          }
          this.appearanceEditorTarget = {
            kind: 'feature',
            featureId,
            label:
              feature.dataset.customizationLabel ??
              feature.getAttribute('aria-label') ??
              feature.textContent?.trim() ??
              'Desktop Material feature',
            anchor: feature,
            highlighted: value.highlighted,
            profileKey,
          }
          this.forceUpdate()
        })
        .catch(error => this.props.dispatcher.postError(asError(error)))
      return
    }

    const repositoryMatch = this.findRepositoryAppearanceOwner(event.target)
    const repository = this.getRepository()
    if (repositoryMatch !== null && repository instanceof Repository) {
      event.preventDefault()
      event.stopPropagation()
      this.prepareAppearanceAnchor(repositoryMatch.anchor)
      void this.openRepositoryAppearanceEditor(
        repository,
        repositoryMatch.elementId,
        repositoryMatch.anchor
      ).catch(error => this.props.dispatcher.postError(asError(error)))
      return
    }

    const match = this.findProfileAppearanceOwner(event.target)
    if (match === null) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    this.prepareAppearanceAnchor(match.anchor)
    this.appearanceEditorTarget = {
      kind: 'profile',
      elementId: match.elementId,
      anchor: match.anchor,
      profileKey: this.props.dispatcher.getActiveProfileKey(),
    }
    this.forceUpdate()
  }

  private prepareAppearanceAnchor(anchor: HTMLElement) {
    if (anchor.tabIndex < 0) {
      anchor.tabIndex = -1
    }
  }

  private getStableFeatureElementId(element: HTMLElement): string | null {
    const explicit = element.dataset.dmFeatureId
    if (explicit !== undefined && explicit.trim().length > 0) {
      return explicit.trim()
    }
    if (element.id.length > 0) {
      return element.id
    }
    const stableClass = [...element.classList].find(name =>
      /^(repository-tab-|toolbar-|notification-)/.test(name)
    )
    return stableClass ?? null
  }

  private applyFeatureAppearance(featureId: string, highlighted: boolean) {
    this.featureAppearanceValues.set(featureId, highlighted)
    for (const element of document.querySelectorAll<HTMLElement>(
      '[data-dm-feature]'
    )) {
      if (this.getStableFeatureElementId(element) !== featureId) {
        continue
      }
      element.dataset.dmFeatureId = featureId
      element.toggleAttribute('data-dm-feature-highlighted', highlighted)
    }
  }

  /** Drop every transient owner when the active settings profile changes. */
  private synchronizeAppearanceProfile(): boolean {
    const profileKey = this.props.dispatcher.getActiveProfileKey()
    if (profileKey === this.appearanceProfileKey) {
      return false
    }

    this.appearanceProfileKey = profileKey
    this.featureAppearanceGeneration++
    this.featureAppearanceValues.clear()
    this.featureAppearanceLoads.clear()
    this.appearanceEditorTarget = null
    return true
  }

  private syncFeatureAppearanceOwners() {
    this.synchronizeAppearanceProfile()
    if (!this.props.dispatcher.isElementAppearanceCoordinatorReady()) {
      return
    }
    const ids = new Set<string>()
    for (const element of document.querySelectorAll<HTMLElement>(
      '[data-dm-feature]'
    )) {
      const id = this.getStableFeatureElementId(element)
      if (id === null) {
        continue
      }
      element.dataset.dmFeatureId = id
      ids.add(id)
      const cached = this.featureAppearanceValues.get(id)
      if (cached !== undefined) {
        element.toggleAttribute('data-dm-feature-highlighted', cached)
      }
    }

    for (const id of ids) {
      if (
        this.featureAppearanceValues.has(id) ||
        this.featureAppearanceLoads.has(id)
      ) {
        continue
      }
      const generation = this.featureAppearanceGeneration
      this.featureAppearanceLoads.set(id, generation)
      void this.props.dispatcher
        .getFeatureAppearanceElement(id)
        .then(value => {
          if (
            generation !== this.featureAppearanceGeneration ||
            this.appearanceProfileKey !==
              this.props.dispatcher.getActiveProfileKey()
          ) {
            return
          }
          this.applyFeatureAppearance(id, value.highlighted)
        })
        .catch(error => this.props.dispatcher.postError(asError(error)))
        .finally(() => {
          if (this.featureAppearanceLoads.get(id) === generation) {
            this.featureAppearanceLoads.delete(id)
          }
        })
    }
  }

  private findProfileAppearanceOwner(target: Element): {
    readonly elementId: ProfileAppearanceElementId
    readonly anchor: HTMLElement
  } | null {
    const candidates: ReadonlyArray<
      readonly [string, ProfileAppearanceElementId]
    > = [
      [
        '[data-customization-surface="app-identity"]',
        ProfileAppearanceElementId.AppIdentity,
      ],
      ['.update-download-progress', ProfileAppearanceElementId.UpdateProgress],
      ['#desktop-app-toolbar', ProfileAppearanceElementId.Toolbar],
      ['.repository-list', ProfileAppearanceElementId.RepositoryList],
      ['.repository-tab-strip', ProfileAppearanceElementId.RepositoryTabs],
      [
        '.diff-container, .code-viewer, .blob-wrapper',
        ProfileAppearanceElementId.CodeDiff,
      ],
      ['#desktop-app-contents', ProfileAppearanceElementId.AppWorkspace],
    ]
    for (const [selector, elementId] of candidates) {
      const anchor = target.closest<HTMLElement>(selector)
      if (anchor !== null) {
        return { elementId, anchor }
      }
    }
    return null
  }

  private closeAppearanceEditor = () => {
    if (this.appearanceEditorTarget === null) {
      return
    }
    this.appearanceEditorTarget = null
    if (this.mounted) {
      this.forceUpdate()
    }
  }

  private findRepositoryAppearanceOwner(target: Element): {
    readonly elementId:
      | typeof RepositoryAppearanceElementId.Workspace
      | typeof RepositoryAppearanceElementId.Toolbar
      | typeof RepositoryAppearanceElementId.Tabs
    readonly anchor: HTMLElement
  } | null {
    if (
      target.closest('.diff-container, .code-viewer, .blob-wrapper') !== null
    ) {
      return null
    }
    const toolbar = target.closest<HTMLElement>('#desktop-app-toolbar')
    if (toolbar !== null) {
      return {
        elementId: RepositoryAppearanceElementId.Toolbar,
        anchor: toolbar,
      }
    }
    const tabs = target.closest<HTMLElement>('.repository-tab-strip')
    if (tabs !== null) {
      return {
        elementId: RepositoryAppearanceElementId.Tabs,
        anchor: tabs,
      }
    }
    const workspace = target.closest<HTMLElement>('#repository')
    return workspace === null
      ? null
      : {
          elementId: RepositoryAppearanceElementId.Workspace,
          anchor: workspace,
        }
  }

  private async openRepositoryAppearanceEditor(
    repository: Repository,
    elementId: RepositoryAppearanceEditorTarget['elementId'],
    anchor: HTMLElement
  ) {
    const profileKey = this.props.dispatcher.getActiveProfileKey()
    const [values, historySource, repositoryPath] = await Promise.all([
      this.props.dispatcher.getRepositoryAppearanceElements(repository),
      this.props.dispatcher.getRepositoryAppearanceHistorySource(
        repository,
        elementId
      ),
      this.props.dispatcher.getRepositoryAppearanceRepositoryPath(
        repository,
        elementId
      ),
    ])
    const selectedRepository = this.getRepository()
    if (
      !this.mounted ||
      !anchor.isConnected ||
      this.props.dispatcher.getActiveProfileKey() !== profileKey ||
      !(selectedRepository instanceof Repository) ||
      selectedRepository.id !== repository.id ||
      selectedRepository.path !== repository.path
    ) {
      return
    }
    this.appearanceEditorTarget = {
      kind: 'repository',
      elementId,
      repository,
      anchor,
      values,
      historySource,
      repositoryPath,
      profileKey,
    }
    this.forceUpdate()
  }

  public componentDidUpdate(prevProps: IAppProps, prevState: IAppState) {
    void prevProps
    if (this.getWindowTitle(prevState) !== this.getWindowTitle()) {
      this.updateWindowTitle()
    }
    const profileChanged = this.synchronizeAppearanceProfile()
    const target = this.appearanceEditorTarget
    if (target?.kind === 'repository') {
      const selectedRepository = this.getRepository()
      if (
        !(selectedRepository instanceof Repository) ||
        selectedRepository.id !== target.repository.id ||
        selectedRepository.path !== target.repository.path
      ) {
        this.appearanceEditorTarget = null
      }
    }
    if (profileChanged && this.mounted) {
      this.forceUpdate()
      return
    }
    this.syncFeatureAppearanceOwners()
  }

  private getOnRefreshRepositoryFn(repository: Repository) {
    const existingHandler = this.refreshRepositoryHandlers.get(repository)
    if (existingHandler !== undefined) {
      return existingHandler
    }

    const handler = () => this.props.dispatcher.refreshRepository(repository)
    this.refreshRepositoryHandlers.set(repository, handler)
    return handler
  }

  private getWindowTitle(state: IAppState = this.state): string {
    const repository = state.selectedState?.repository
    const appName = state.appearanceCustomization.appIdentity.displayName
    const repositoryTitle =
      repository instanceof Repository
        ? repository.alias ?? repository.name
        : repository?.name
    return repositoryTitle ? `${repositoryTitle} - ${appName}` : appName
  }

  private updateWindowTitle() {
    setWindowTitle(this.getWindowTitle())
  }

  private onDocumentFocus = (event: FocusEvent) => {
    this.props.dispatcher.appFocusedElementChanged()
  }

  /**
   * Manages keyboard shortcuts specific to macOS.
   * - adds Shift+F10 to open the context menus (like on Windows so macOS
   *   keyboard users are not required to use VoiceOver to trigger context
   *   menus)
   */
  private onMacOSWindowKeyDown = (event: KeyboardEvent) => {
    // We do not want to override Shift+F10 behavior for the context menu on Windows.
    if (!__DARWIN__) {
      return
    }

    if (event.defaultPrevented) {
      return
    }

    if (event.shiftKey && event.key === 'F10') {
      document.activeElement?.dispatchEvent(
        new Event('contextmenu', {
          bubbles: true, // Required for React's event system
        })
      )
    }
  }

  /**
   * On Windows pressing the Alt key and holding it down should
   * highlight the application menu.
   *
   * This method in conjunction with the onWindowKeyUp sets the
   * appMenuToolbarHighlight state when the Alt key (and only the
   * Alt key) is pressed.
   */
  private onWindowKeyDown = (event: KeyboardEvent) => {
    const isBareAltPress = this.applicationMenuAltKeyTracker.onKeyDown(
      event,
      this.isShowingModal
    )

    if (event.defaultPrevented) {
      return
    }

    if (this.isShowingModal) {
      return
    }

    if (shouldRenderApplicationMenu()) {
      if (event.key === 'Shift' && event.altKey) {
        this.props.dispatcher.setAccessKeyHighlightState(false)
      } else if (event.key === 'Alt') {
        if (!isBareAltPress) {
          return
        }
        // Immediately close the menu if open and the user hits Alt. This is
        // a Windows convention.
        if (
          this.state.currentFoldout &&
          this.state.currentFoldout.type === FoldoutType.AppMenu
        ) {
          // Only close it the menu when the key is pressed if there's an open
          // menu. If there isn't we should close it when the key is released
          // instead and that's taken care of in the onWindowKeyUp function.
          if (this.state.appMenuState.length > 1) {
            this.props.dispatcher.setAppMenuState(menu => menu.withReset())
            this.props.dispatcher.closeFoldout(FoldoutType.AppMenu)
          }
        }

        this.props.dispatcher.setAccessKeyHighlightState(true)
      } else if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (this.state.appMenuState.length) {
          const candidates = this.state.appMenuState[0].items
          const menuItemForAccessKey = findItemByAccessKey(
            event.key,
            candidates
          )

          if (menuItemForAccessKey && itemIsSelectable(menuItemForAccessKey)) {
            if (menuItemForAccessKey.type === 'submenuItem') {
              this.props.dispatcher.setAppMenuState(menu =>
                menu
                  .withReset()
                  .withSelectedItem(menuItemForAccessKey)
                  .withOpenedMenu(menuItemForAccessKey, true)
              )

              this.props.dispatcher.showFoldout({
                type: FoldoutType.AppMenu,
                enableAccessKeyNavigation: true,
              })
            } else {
              this.props.dispatcher.executeMenuItem(menuItemForAccessKey)
            }

            event.preventDefault()
          }
        }
      } else if (!event.altKey) {
        this.props.dispatcher.setAccessKeyHighlightState(false)
      }
    }
  }

  /**
   * Open the application menu foldout when the Alt key is pressed.
   *
   * See onWindowKeyDown for more information.
   */
  private onWindowKeyUp = (event: KeyboardEvent) => {
    const shouldToggleMenu = this.applicationMenuAltKeyTracker.onKeyUp(
      event,
      this.isShowingModal
    )

    if (shouldRenderApplicationMenu()) {
      if (event.key === 'Alt') {
        this.props.dispatcher.setAccessKeyHighlightState(false)

        if (shouldToggleMenu) {
          if (
            this.state.currentFoldout &&
            this.state.currentFoldout.type === FoldoutType.AppMenu
          ) {
            this.props.dispatcher.setAppMenuState(menu => menu.withReset())
            this.props.dispatcher.closeFoldout(FoldoutType.AppMenu)
          } else {
            this.props.dispatcher.showFoldout({
              type: FoldoutType.AppMenu,
              enableAccessKeyNavigation: true,
            })
          }
        }
      }
    }
  }

  private async handleDragAndDrop(fileList: FileList) {
    const paths = uniqueDroppedRepositoryPaths(
      Array.from(fileList, webUtils.getPathForFile)
    )
    const { dispatcher } = this.props

    // Bulk drops add every valid folder and open the first result. A single
    // repository opens immediately; non-repositories keep the existing setup
    // dialog so the user can initialize them deliberately.
    if (paths.length > 1) {
      const addedRepositories = await dispatcher.addRepositories(paths)

      if (addedRepositories.length > 0) {
        dispatcher.recordAddExistingRepository()
        await dispatcher.selectRepository(addedRepositories[0])
      }
    } else if (paths.length === 1) {
      // user may accidentally provide a folder within the repository
      // this ensures we use the repository root, if it is actually a repository
      // otherwise we consider it an untracked repository
      let path = paths[0]
      let isRegularRepository = false
      try {
        const repositoryType = await getRepositoryType(path)
        if (repositoryType.kind === 'regular') {
          path = repositoryType.topLevelWorkingDirectory
          isRegularRepository = true
        }
      } catch (e) {
        log.error('Could not determine repository type', e)
      }

      const { repositories } = this.state
      const existingRepository = matchExistingRepository(repositories, path)

      if (existingRepository) {
        await dispatcher.selectRepository(existingRepository)
      } else if (isRegularRepository) {
        const addedRepositories = await dispatcher.addRepositories([path])
        if (addedRepositories.length > 0) {
          dispatcher.recordAddExistingRepository()
          await dispatcher.selectRepository(addedRepositories[0])
        }
      } else {
        await this.showPopup({ type: PopupType.AddRepository, path })
      }
    }
  }

  private removeRepository = (
    repository: Repository | CloningRepository | null
  ) => {
    if (!repository) {
      return
    }

    if (repository instanceof SubmoduleRepository) {
      const parentName =
        repository.parentRepository.alias ?? repository.parentRepository.name
      void this.props.dispatcher.postError(
        new Error(
          t('submodule.temporaryRemovalUnavailable', { parent: parentName })
        )
      )
      return
    }

    if (repository instanceof CloningRepository || repository.missing) {
      this.props.dispatcher.removeRepository(repository, false)
      return
    }

    if (this.state.askForConfirmationOnRepositoryRemoval) {
      this.props.dispatcher.showPopup({
        type: PopupType.RemoveRepository,
        repository,
      })
    } else {
      this.props.dispatcher.removeRepository(repository, false)
    }
  }

  private onConfirmRepoRemoval = async (
    repository: Repository,
    deleteRepoFromDisk: boolean
  ) => {
    return this.props.dispatcher.removeRepository(
      repository,
      deleteRepoFromDisk
    )
  }

  private onForceDeleteRepo = async (repository: Repository) => {
    await this.props.dispatcher.forceRemoveRepository(repository)
  }

  private getRepository(): Repository | CloningRepository | null {
    const state = this.state.selectedState
    if (state == null) {
      return null
    }

    return state.repository
  }

  /**
   * Feed the optional audio system from app-state updates: play a cue/narration
   * for genuinely new notifications and keep the per-repository music in sync
   * with the selected repository. Never throws into the update path.
   */
  private syncAudioSystem(state: IAppState) {
    try {
      const selected = state.selectedState?.repository ?? null
      const repository = selected instanceof Repository ? selected : null
      const path = repository?.path ?? null
      if (path !== this.audioLastRepositoryPath) {
        this.audioLastRepositoryPath = path
        this.audioCueStore.setSelectedRepository(repository)
      }

      const entries = state.notifications
      if (!this.audioSeeded) {
        // First update: remember existing history without replaying it.
        for (const entry of entries) {
          this.audioSeenNotificationIds.add(entry.id)
        }
        this.audioSeeded = true
        return
      }

      // Entries are newest-first; play for any id we have not seen yet.
      const fresh: Array<INotificationEntry> = []
      for (const entry of entries) {
        if (this.audioSeenNotificationIds.has(entry.id)) {
          break
        }
        fresh.push(entry)
      }
      for (let i = fresh.length - 1; i >= 0; i--) {
        this.audioSeenNotificationIds.add(fresh[i].id)
        this.audioCueStore.handleNotificationEntry(fresh[i])
      }

      // Keep the seen-set bounded so it can't grow without limit.
      if (this.audioSeenNotificationIds.size > 1000) {
        const keep = new Set<string>()
        for (const entry of entries) {
          keep.add(entry.id)
        }
        this.audioSeenNotificationIds.clear()
        for (const id of keep) {
          this.audioSeenNotificationIds.add(id)
        }
      }
    } catch {
      // Audio is best-effort and must never break app-state handling.
    }
  }

  private showRebaseDialog() {
    const repository = this.getRepository()

    if (!repository || repository instanceof CloningRepository) {
      return
    }

    this.props.dispatcher.showRebaseDialog(repository)
  }

  private showRepositorySettings(initialSelectedTab?: RepositorySettingsTab) {
    const repository = this.getRepository()

    if (!repository || repository instanceof CloningRepository) {
      return
    }
    if (repository instanceof SubmoduleRepository) {
      const parentName =
        repository.parentRepository.alias ?? repository.parentRepository.name
      void this.props.dispatcher.postError(
        new Error(
          t('submodule.temporarySettingsUnavailable', { parent: parentName })
        )
      )
      return
    }
    this.props.dispatcher.showPopup({
      type: PopupType.RepositorySettings,
      repository,
      initialSelectedTab,
    })
  }

  private forkRepository = (
    repository: Repository | CloningRepository | null
  ) => {
    const eligibility = getForkRepositoryEligibility(
      this.state.accounts,
      repository instanceof Repository ? repository : null
    )

    if (!eligibility.canFork) {
      return
    }

    return this.props.dispatcher.showCreateForkDialog(eligibility.repository)
  }

  private showRepositoryAccountSettings = () => {
    this.showRepositorySettings(RepositorySettingsTab.Remote)
  }

  private showAccountSettings = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.Preferences,
      initialSelectedTab: PreferencesTab.Accounts,
    })
  }

  private showSparseCheckout() {
    const repository = this.getRepository()

    if (
      !repository ||
      repository instanceof CloningRepository ||
      repository instanceof SubmoduleRepository
    ) {
      return
    }
    this.props.dispatcher.showPopup({
      type: PopupType.SparseCheckout,
      repository,
    })
  }

  private showBranchRules() {
    const selectedState = this.state.selectedState
    if (
      selectedState === null ||
      selectedState.type !== SelectionType.Repository ||
      !(selectedState.repository instanceof Repository) ||
      selectedState.state.branchesState.tip.kind !== TipState.Valid
    ) {
      return
    }

    const branch = selectedState.state.branchesState.tip.branch
    const context = resolveEffectiveBranchRulesContext(
      selectedState.repository,
      branch,
      selectedState.state.remote
    )
    this.props.dispatcher.showPopup({
      type: PopupType.BranchRules,
      repository: selectedState.repository,
      initialBranch:
        context.branch ??
        branch.upstreamWithoutRemote ??
        branch.nameWithoutRemote,
    })
  }

  private buildAndRun() {
    const repository = this.getRepository()

    if (
      !repository ||
      repository instanceof CloningRepository ||
      repository instanceof SubmoduleRepository
    ) {
      return
    }

    this.props.dispatcher.setBuildRunPanelOpen(repository, true)
    this.props.dispatcher
      .startBuildRun(repository)
      .catch(err => log.error('Failed to start build & run', err))
  }

  /** Open the guided issue creator for the current GitHub repository. */
  private openIssueCreationOnGitHub() {
    const repository = this.getRepository()
    // this will likely never be null since we disable the
    // issue creation menu item for non-GitHub repositories
    if (repository instanceof Repository) {
      this.props.dispatcher.showPopup({
        type: PopupType.CreateGitHubIssue,
        repository,
      })
    }
  }

  private viewRepositoryOnGitHub() {
    const repository = this.getRepository()

    this.viewOnGitHub(repository)
  }

  /** Returns the URL to the current repository if hosted on GitHub */
  private getCurrentRepositoryGitHubURL() {
    const repository = this.getRepository()

    if (
      !repository ||
      repository instanceof CloningRepository ||
      !repository.gitHubRepository
    ) {
      return null
    }

    return repository.gitHubRepository.htmlURL
  }

  private openCurrentRepositoryInShell = () => {
    const repository = this.getRepository()
    if (!repository) {
      return
    }

    this.openInShell(repository)
  }

  /**
   * Gets a label string for the currently selected external editor, or
   * `undefined` if the user has selected a custom editor.
   */
  private get externalEditorLabel() {
    return this.state.useCustomEditor
      ? undefined
      : this.state.selectedExternalEditor ?? undefined
  }

  private getExternalEditorLabel(repository: Repository | CloningRepository) {
    return !(repository instanceof Repository) ||
      repository.customEditorOverride === null
      ? this.externalEditorLabel
      : getEditorOverrideLabel(repository.customEditorOverride)
  }

  private openCurrentRepositoryInExternalEditor() {
    const repository = this.getRepository()
    if (!repository) {
      return
    }

    this.openInExternalEditor(repository)
  }

  /**
   * Conditionally renders a menu bar. The menu bar is currently only rendered
   * on Windows.
   */
  private renderAppMenuBar() {
    // We only render the app menu bar on Windows
    if (!__WIN32__) {
      return null
    }

    // Have we received an app menu from the main process yet?
    if (!this.state.appMenuState.length) {
      return null
    }

    // Don't render the menu bar during the welcome flow
    if (this.state.showWelcomeFlow) {
      return null
    }

    const currentFoldout = this.state.currentFoldout

    // AppMenuBar requires us to pass a strongly typed AppMenuFoldout state or
    // null if the AppMenu foldout is not currently active.
    const foldoutState =
      currentFoldout && currentFoldout.type === FoldoutType.AppMenu
        ? currentFoldout
        : null

    return (
      <AppMenuBar
        appMenu={this.state.appMenuState}
        dispatcher={this.props.dispatcher}
        highlightAppMenuAccessKeys={this.state.highlightAccessKeys}
        foldoutState={foldoutState}
        onLostFocus={this.onMenuBarLostFocus}
      />
    )
  }

  private onMenuBarLostFocus = () => {
    // Note: This event is emitted in an animation frame separate from
    // that of the AppStore. See onLostFocusWithin inside of the AppMenuBar
    // for more details. This means that it's possible that the current
    // app state in this component's state might be out of date so take
    // caution when considering app state in this method.
    this.props.dispatcher.closeFoldout(FoldoutType.AppMenu)
    this.props.dispatcher.setAppMenuState(menu => menu.withReset())
  }

  private renderTitlebar() {
    const inFullScreen = this.state.windowState === 'full-screen'

    const menuBarActive =
      this.state.currentFoldout &&
      this.state.currentFoldout.type === FoldoutType.AppMenu

    // As Linux still uses the classic Electron menu, we are opting out of the
    // custom menu that is shown as part of the title bar below
    if (__LINUX__) {
      return null
    }

    // When we're in full-screen mode on Windows we only need to render
    // the title bar when the menu bar is active. On other platforms we
    // never render the title bar while in full-screen mode.
    if (inFullScreen) {
      if (!__WIN32__ || !menuBarActive) {
        return null
      }
    }

    const showAppIcon = __WIN32__ && !this.state.showWelcomeFlow
    const inWelcomeFlow = this.state.showWelcomeFlow
    const inNoRepositoriesView = this.inNoRepositoriesViewState()

    // The light title bar style should only be used while we're in
    // the welcome flow as well as the no-repositories blank slate
    // on macOS. The latter case has to do with the application menu
    // being part of the title bar on Windows. We need to render
    // the app menu in the no-repositories blank slate on Windows but
    // the menu doesn't support the light style at the moment so we're
    // forcing it to use the dark style.
    const titleBarStyle =
      inWelcomeFlow || (__DARWIN__ && inNoRepositoriesView) ? 'light' : 'dark'

    return (
      <TitleBar
        appIdentity={this.state.appearanceCustomization.appIdentity}
        showAppIcon={showAppIcon}
        titleBarStyle={titleBarStyle}
        windowState={this.state.windowState}
        windowZoomFactor={this.state.windowZoomFactor}
      >
        {this.renderAppMenuBar()}
      </TitleBar>
    )
  }

  private onPopupDismissed = (popupId: number) => {
    // If the commit progress dialog is open and remains open until after the
    // commit is done the button that triggered the dialog will be gone so focus
    // will return to the document. Instead we'll manually move focus to the
    // commit button under those circumstances to ensure that keyboard users
    // are dropped off in a logical place after the dialog is dismissed.
    //
    // https://github.com/github/accessibility-audits/issues/15830
    if (this.state.currentPopup?.id === popupId) {
      if (
        this.state.currentPopup.type === PopupType.CommitProgress &&
        this.state.selectedState?.type === SelectionType.Repository
      ) {
        const repo = this.state.selectedState.repository
        const repoState = this.props.repositoryStateManager.get(repo)

        if (!repoState.isCommitting) {
          const dialog = document.getElementById('commit-progress-dialog')
          if (dialog && dialog instanceof HTMLDialogElement) {
            dialog.addEventListener(
              'close',
              () => {
                const btn = document.querySelector(
                  '#repository-sidebar button.commit-button'
                )

                if (btn && btn instanceof HTMLButtonElement) {
                  btn.focus()
                }
              },
              { once: true }
            )
          }
        }
      }
    }

    return this.props.dispatcher.closePopupById(popupId)
  }

  private onContinueWithUntrustedCertificate = (
    certificate: Electron.Certificate
  ) => {
    showCertificateTrustDialog(
      certificate,
      'Could not securely connect to the server, because its certificate is not trusted. Attackers might be trying to steal your information.\n\nTo connect unsafely, which may put your data at risk, you can “Always trust” the certificate and try again.'
    )
  }

  private onUpdateAvailableDismissed = () =>
    this.props.dispatcher.setUpdateBannerVisibility(false)

  private popupContent(popup: Popup, isTopMost: boolean): JSX.Element | null {
    if (popup.id === undefined) {
      // Should not be possible... but if it does we want to know about it.
      sendNonFatalException(
        'PopupNoId',
        new Error(
          `Attempted to open a popup of type '${popup.type}' without an Id`
        )
      )
      return null
    }

    const onPopupDismissedFn = this.getOnPopupDismissedFn(popup.id)

    switch (popup.type) {
      case PopupType.RenameBranch:
        return (
          <RenameBranch
            key="rename-branch"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            branch={popup.branch}
            accounts={this.state.accounts}
            cachedRepoRulesets={this.state.cachedRepoRulesets}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.DeleteBranch:
        return (
          <DeleteBranch
            key="delete-branch"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            branch={popup.branch}
            existsOnRemote={popup.existsOnRemote}
            onDismissed={onPopupDismissedFn}
            onDeleted={this.onBranchDeleted}
          />
        )
      case PopupType.DeleteRemoteBranch:
        return (
          <DeleteRemoteBranch
            key="delete-remote-branch"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            branch={popup.branch}
            onDismissed={onPopupDismissedFn}
            onDeleted={this.onBranchDeleted}
          />
        )
      case PopupType.ConfirmDiscardChanges:
        const showSetting = popup.showDiscardChangesSetting ?? true
        const discardingAllChanges = popup.discardingAllChanges ?? false
        const permanentlyDelete = popup.permanentlyDelete ?? false
        return (
          <DiscardChanges
            key="discard-changes"
            repository={popup.repository}
            dispatcher={this.props.dispatcher}
            files={popup.files}
            confirmDiscardChanges={
              this.state.askForConfirmationOnDiscardChanges
            }
            showDiscardChangesSetting={showSetting}
            discardingAllChanges={discardingAllChanges}
            permanentlyDelete={permanentlyDelete}
            onDismissed={onPopupDismissedFn}
            onConfirmDiscardChangesChanged={this.onConfirmDiscardChangesChanged}
          />
        )
      case PopupType.ConfirmDiscardSelection:
        return (
          <DiscardSelection
            key="discard-selection"
            repository={popup.repository}
            dispatcher={this.props.dispatcher}
            file={popup.file}
            diff={popup.diff}
            selection={popup.selection}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.Preferences:
        let repository = this.getRepository()

        if (repository instanceof CloningRepository) {
          repository = null
        }

        return (
          <Preferences
            key="preferences"
            initialSelectedTab={popup.initialSelectedTab}
            dispatcher={this.props.dispatcher}
            accounts={this.state.accounts}
            confirmRepositoryRemoval={
              this.state.askForConfirmationOnRepositoryRemoval
            }
            confirmDiscardChanges={
              this.state.askForConfirmationOnDiscardChanges
            }
            confirmDiscardChangesPermanently={
              this.state.askForConfirmationOnDiscardChangesPermanently
            }
            confirmDiscardStash={this.state.askForConfirmationOnDiscardStash}
            confirmCheckoutCommit={
              this.state.askForConfirmationOnCheckoutCommit
            }
            confirmForcePush={this.state.askForConfirmationOnForcePush}
            confirmUndoCommit={this.state.askForConfirmationOnUndoCommit}
            askForConfirmationOnCommitFilteredChanges={
              this.state.askForConfirmationOnCommitFilteredChanges
            }
            confirmCommitMessageOverride={
              this.state.askForConfirmationOnCommitMessageOverride
            }
            confirmWorktreeRemoval={
              this.state.askForConfirmationOnWorktreeRemoval
            }
            uncommittedChangesStrategy={this.state.uncommittedChangesStrategy}
            selectedExternalEditor={this.state.selectedExternalEditor}
            useWindowsOpenSSH={this.state.useWindowsOpenSSH}
            verboseLogging={this.state.verboseLogging}
            showCommitLengthWarning={this.state.showCommitLengthWarning}
            notificationsEnabled={this.state.notificationsEnabled}
            errorPresentationStyle={this.state.errorPresentationStyle}
            optOutOfUsageTracking={this.state.optOutOfUsageTracking}
            useExternalCredentialHelper={this.state.useExternalCredentialHelper}
            repository={repository}
            onDismissed={onPopupDismissedFn}
            selectedShell={this.state.selectedShell}
            selectedTheme={this.state.selectedTheme}
            appearanceCustomization={this.state.appearanceCustomization}
            zoomBaseFactor={this.state.zoomBaseFactor}
            autoFitZoomEnabled={this.state.autoFitZoomEnabled}
            windowZoomFactor={this.state.windowZoomFactor}
            selectedTabSize={this.state.selectedTabSize}
            useCustomEditor={this.state.useCustomEditor}
            customEditor={this.state.customEditor}
            useCustomShell={this.state.useCustomShell}
            customShell={this.state.customShell}
            branchPresetScript={this.state.branchPresetScript}
            showRecentRepositories={this.state.showRecentRepositories}
            showBranchNameInRepoList={this.state.showBranchNameInRepoList}
            branchSortOrder={this.state.branchSortOrder}
            repositoryIndicatorsEnabled={this.state.repositoryIndicatorsEnabled}
            autoSwitchAccountToRepositoryOwner={
              this.state.autoSwitchAccountToRepositoryOwner
            }
            onEditGlobalGitConfig={this.editGlobalGitConfig}
            underlineLinks={this.state.underlineLinks}
            showDiffCheckMarks={this.state.showDiffCheckMarks}
            selectedCopilotModels={this.state.selectedCopilotModels}
            copilotModels={this.state.copilotModels}
            byokProviders={this.state.byokProviders}
            alwaysUseCopilotForConflictResolution={
              this.state.alwaysUseCopilotForConflictResolution
            }
            automationSettings={this.state.automationSettings}
          />
        )
      case PopupType.SettingsHistory:
        return (
          <SettingsHistoryDialog
            key="settings-history"
            dispatcher={this.props.dispatcher}
            scope={popup.scope}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.NotificationHistory:
        return (
          <NotificationHistoryDialog
            key="notification-history"
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.NotificationAutomations:
        return (
          <NotificationAutomationsDialog
            key="notification-automations"
            dispatcher={this.props.dispatcher}
            entry={popup.entry}
            repositories={this.state.repositories}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.LogHistory:
        return (
          <LogHistoryDialog
            key="log-history"
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.FileHistory:
        return (
          <FileHistory
            key={`file-history-${popup.repository.id}-${popup.path}`}
            repository={popup.repository}
            path={popup.path}
            onRefreshRepository={this.getOnRefreshRepositoryFn(
              popup.repository
            )}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.CreateGitHubIssue:
        return (
          <CreateGitHubIssueDialog
            key={`create-github-issue-${popup.repository.id}`}
            repository={popup.repository}
            accounts={this.state.accounts}
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.CreateGitHubPullRequest: {
        const selection = this.state.selectedState
        const repositoryContextCurrent =
          selection !== null &&
          selection.type === SelectionType.Repository &&
          selection.repository.id === popup.repository.id &&
          selection.repository.hash === popup.repository.hash &&
          selection.state.branchesState.tip.kind === TipState.Valid &&
          getGitHubPullRequestContextVersion(
            selection.repository,
            selection.state.branchesState.tip.branch,
            selection.state.remote
          ) === popup.contextVersion

        return (
          <CreateGitHubPullRequestDialog
            key={`create-github-pull-request-${popup.repository.id}`}
            repository={popup.repository}
            currentBranch={popup.currentBranch}
            sourceRemote={popup.sourceRemote}
            providerHTMLURL={popup.providerHTMLURL}
            targets={popup.targets}
            initialTargetHash={popup.initialTargetHash}
            initialBaseBranchName={popup.initialBaseBranchName}
            contextVersion={popup.contextVersion}
            repositoryContextCurrent={repositoryContextCurrent}
            accounts={this.state.accounts}
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.GitHubPullRequestLifecycle:
        return (
          <GitHubPullRequestLifecycleDialog
            key={`github-pull-request-lifecycle-${popup.repository.id}-${popup.pullRequest.pullRequestNumber}`}
            repository={popup.repository}
            pullRequest={popup.pullRequest}
            baseBranchNames={popup.baseBranchNames}
            accounts={this.state.accounts}
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.GitLabMergeRequest: {
        const dispatcher = this.props.dispatcher
        const service: IGitLabMergeRequestDialogService = {
          availability: repository =>
            dispatcher.getGitLabMergeRequestAvailability(repository),
          contextCurrent: () =>
            dispatcher.isGitLabMergeRequestContextCurrent(
              popup.repository,
              popup.route,
              popup.contextVersion,
              popup.intent
            ),
          listMembers: (repository, signal) =>
            dispatcher.listGitLabMergeRequestMembers(repository, signal),
          get: (repository, mergeRequestIID, signal) =>
            dispatcher.getGitLabMergeRequest(
              repository,
              mergeRequestIID,
              signal
            ),
          create: (repository, draft, signal) =>
            dispatcher.createGitLabMergeRequest(repository, draft, signal),
          createMutationReview: (repository, mergeRequest) =>
            dispatcher.createGitLabMergeRequestMutationReview(
              repository,
              mergeRequest
            ),
          update: (repository, review, update, signal) =>
            dispatcher.updateGitLabMergeRequest(
              repository,
              review,
              update,
              signal
            ),
          setState: (repository, review, state, signal) =>
            dispatcher.setGitLabMergeRequestState(
              repository,
              review,
              state,
              signal
            ),
          approve: (repository, review, signal) =>
            dispatcher.approveGitLabMergeRequest(repository, review, signal),
          unapprove: (repository, review, signal) =>
            dispatcher.unapproveGitLabMergeRequest(repository, review, signal),
          refreshPullRequests: repository =>
            dispatcher.refreshPullRequests(repository),
          openInBrowser: async url => {
            const opened = await dispatcher.openInBrowser(url)
            if (!opened) {
              throw new Error('The operating system did not open the URL.')
            }
          },
        }

        return (
          <GitLabMergeRequestDialog
            key={`gitlab-merge-request-${popup.id}`}
            repository={popup.repository}
            route={popup.route}
            branchContext={popup.branchContext}
            contextVersion={popup.contextVersion}
            intent={popup.intent}
            service={service}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.BranchRules: {
        const selection = this.state.selectedState
        const isSelectedRepository =
          selection !== null &&
          selection.type === SelectionType.Repository &&
          selection.repository.id === popup.repository.id
        const repository = isSelectedRepository
          ? selection.repository
          : popup.repository
        const tip = isSelectedRepository
          ? selection.state.branchesState.tip
          : null
        const branch = tip?.kind === TipState.Valid ? tip.branch : null
        const rulesContext = resolveEffectiveBranchRulesContext(
          repository,
          branch,
          isSelectedRepository ? selection.state.remote : null
        )
        const currentBranch = rulesContext.branch
        const gitHubRepository =
          rulesContext.kind === 'ready'
            ? rulesContext.gitHubRepository
            : repository.gitHubRepository
        const accountResolution =
          rulesContext.kind === 'ready' && gitHubRepository !== null
            ? resolveEffectiveBranchRulesAccount(
                this.state.accounts,
                repository,
                gitHubRepository.endpoint
              )
            : { kind: 'incompatible' as const }

        let availability: React.ComponentProps<
          typeof BranchRulesInspector
        >['availability'] = 'unsupported'
        let requestContext: unknown = rulesContext.contextVersion
        let unavailableMessage =
          rulesContext.kind === 'unsupported'
            ? rulesContext.message
            : 'Branch rules are unavailable for this repository.'
        let client: EffectiveBranchRulesLoader | undefined

        if (
          rulesContext.kind === 'ready' &&
          gitHubRepository !== null &&
          accountResolution.kind === 'signed-out'
        ) {
          availability = 'signed-out'
          requestContext = `signed-out:${rulesContext.contextVersion}`
        } else if (
          rulesContext.kind === 'ready' &&
          gitHubRepository !== null &&
          accountResolution.kind === 'ready'
        ) {
          availability = 'ready'
          client = this.getEffectiveBranchRulesClient(
            accountResolution.account,
            gitHubRepository,
            rulesContext.contextVersion
          )
          requestContext = client
        } else if (
          rulesContext.kind === 'ready' &&
          (accountResolution.kind === 'ambiguous' ||
            accountResolution.kind === 'incompatible')
        ) {
          availability = 'account-selection-required'
          requestContext = `account-selection-required:${rulesContext.contextVersion}`
          unavailableMessage =
            accountResolution.kind === 'ambiguous'
              ? 'Choose an account for this repository in Repository settings before inspecting account-specific permissions and bypasses.'
              : 'The selected account does not match this GitHub repository. Choose the Repository account in Repository settings.'
        }

        return (
          <BranchRulesInspector
            key={`branch-rules-${popup.repository.id}-${popup.initialBranch}`}
            repositoryLabel={gitHubRepository?.fullName ?? repository.name}
            repositoryPath={repository.path}
            initialBranch={popup.initialBranch}
            currentBranch={currentBranch}
            isSelectedRepository={isSelectedRepository}
            availability={availability}
            requestContext={requestContext}
            unavailableMessage={unavailableMessage}
            client={client}
            onSignIn={this.showAccountSettings}
            onChooseRepositoryAccount={this.showRepositoryAccountSettings}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.SparseCheckout:
        if (popup.repository instanceof SubmoduleRepository) {
          return null
        }
        return (
          <SparseCheckoutManager
            key={`sparse-checkout-${popup.repository.id}`}
            repository={popup.repository}
            onRefreshRepository={this.getOnRefreshRepositoryFn(
              popup.repository
            )}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.MergeAll: {
        const mergeState = this.props.repositoryStateManager.get(
          popup.repository
        ).mergeAllState
        return (
          <MergeAllDialog
            key="merge-all"
            repository={popup.repository}
            mode={popup.mode}
            state={mergeState}
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.PullAllRepositories:
        return (
          <PullAllDialog
            key="pull-all-repositories"
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.PullPreview:
        return (
          <PullPreviewDialog
            key={`pull-preview-${popup.repository.id}`}
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.CommitAndPushAll: {
        const lookup = this.state.localRepositoryStateLookup
        const affectedRepositories = this.state.repositories
          .filter((r): r is Repository => r instanceof Repository)
          .filter(r => {
            const state = lookup.get(r.id)
            return !isCommitPushAllRepositoryClean(
              state === undefined
                ? undefined
                : {
                    changedFilesCount: state.changedFilesCount,
                    ahead: state.aheadBehind?.ahead ?? 0,
                    behind: state.aheadBehind?.behind ?? 0,
                  }
            )
          })
          .map(r => ({ id: r.id, name: r.name }))

        return (
          <CommitAndPushAllDialog
            key="commit-push-all-repositories"
            dispatcher={this.props.dispatcher}
            affectedRepositories={affectedRepositories}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.RepositorySettings: {
        const repository = popup.repository
        const state = this.props.repositoryStateManager.get(repository)
        const repositoryAccount = getAccountForRepository(
          this.state.accounts,
          repository
        )

        return (
          <RepositorySettings
            key={`repository-settings-${repository.hash}`}
            initialSelectedTab={popup.initialSelectedTab}
            remote={state.remote}
            dispatcher={this.props.dispatcher}
            repository={repository}
            accounts={this.state.accounts}
            repositoryAccount={repositoryAccount}
            appearanceCustomization={this.state.appearanceCustomization}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.AddSubmodule:
        return (
          <AddSubmoduleDialog
            key={`add-submodule-${popup.repository.hash}`}
            repository={popup.repository}
            dispatcher={this.props.dispatcher}
            accounts={this.state.accounts}
            apiRepositories={this.state.apiRepositories}
            onRefreshRepositories={this.onRefreshRepositories}
            onAdded={popup.onAdded}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.CloneableSubmodules:
        return (
          <CloneableSubmodulesDialog
            key={`cloneable-submodules-${popup.parentCloneUrl}`}
            parentName={popup.parentName}
            parentCloneUrl={popup.parentCloneUrl}
            entries={popup.entries}
            onCloneUrl={popup.onCloneUrl ?? this.showCloneRepo}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.SubmoduleManager:
        return (
          <SubmoduleManagerDialog
            key={`submodule-manager-${popup.repository.hash}`}
            repository={popup.repository}
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.SubmoduleConfig:
        return (
          <SubmoduleConfigDialog
            key={`submodule-config-${popup.repository.hash}-${popup.submodule.path}`}
            repository={popup.repository}
            submodule={popup.submodule}
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.SubtreeManager:
        return (
          <SubtreeManagerDialog
            key={`subtree-manager-${popup.repository.hash}`}
            repository={popup.repository}
            dispatcher={this.props.dispatcher}
            accounts={this.state.accounts}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.AddSubtree:
        return (
          <AddSubtreeDialog
            key={`add-subtree-${popup.repository.hash}`}
            repository={popup.repository}
            dispatcher={this.props.dispatcher}
            accounts={this.state.accounts}
            apiRepositories={this.state.apiRepositories}
            onRefreshRepositories={this.onRefreshRepositories}
            onAdded={popup.onAdded}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.SignIn:
        return (
          <SignIn
            key="sign-in"
            signInState={this.state.signInState}
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
            isCredentialHelperSignIn={popup.isCredentialHelperSignIn}
            credentialHelperUrl={popup.credentialHelperUrl}
          />
        )
      case PopupType.AddRepository:
        return (
          <AddExistingRepository
            key="add-existing-repository"
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            path={popup.path}
            existingRepositories={this.state.repositories}
          />
        )
      case PopupType.CreateRepository:
        return (
          <CreateRepository
            key="create-repository"
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            initialPath={popup.path}
            isTopMost={isTopMost}
          />
        )
      case PopupType.CloneRepository:
        return (
          <CloneRepository
            key="clone-repository"
            accounts={this.state.accounts}
            initialURL={popup.initialURL}
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            repositories={this.state.repositories}
            selectedTab={this.state.selectedCloneRepositoryTab}
            onTabSelected={this.onCloneRepositoriesTabSelected}
            apiRepositories={this.state.apiRepositories}
            onRefreshRepositories={this.onRefreshRepositories}
            isTopMost={isTopMost}
          />
        )
      case PopupType.BatchCloneProgress:
        return (
          <BatchCloneProgress
            key="batch-clone-progress"
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
            batchCloneState={this.state.batchCloneState}
            isTopMost={isTopMost}
          />
        )
      case PopupType.ExportRepositoryList:
        return (
          <ExportRepositoriesDialog
            key="export-repositories"
            onDismissed={onPopupDismissedFn}
            repositories={popup.repositories}
          />
        )
      case PopupType.ImportRepositoryList:
        return (
          <ImportRepositoriesDialog
            key="import-repositories"
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
            existingRepositories={popup.existingRepositories}
          />
        )
      case PopupType.ExportTabSession:
        return (
          <ExportTabSessionDialog
            key="export-tab-session"
            onDismissed={onPopupDismissedFn}
            tabs={this.props.repositoryTabsStore.getState()}
            repositories={this.state.repositories.filter(
              (repository): repository is Repository =>
                repository instanceof Repository
            )}
          />
        )
      case PopupType.ImportTabSession:
        return (
          <ImportTabSessionDialog
            key="import-tab-session"
            dispatcher={this.props.dispatcher}
            tabsStore={this.props.repositoryTabsStore}
            existingRepositories={popup.existingRepositories}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.OpencodeFix:
        return (
          <OpencodeFixDialog
            key="opencode-fix"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            failure={popup.failure}
            buildRunStore={this.props.buildRunStore}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.OpencodeSend:
        return (
          <OpencodeSendDialog
            key="opencode-send"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            context={popup.context}
            buildRunStore={this.props.buildRunStore}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.CreateBranch: {
        const state = this.props.repositoryStateManager.get(popup.repository)
        const branchesState = state.branchesState
        const repository = popup.repository

        if (branchesState.tip.kind === TipState.Unknown) {
          onPopupDismissedFn()
          return null
        }

        let upstreamGhRepo: GitHubRepository | null = null
        let upstreamDefaultBranch: Branch | null = null

        if (isRepositoryWithGitHubRepository(repository)) {
          upstreamGhRepo = getNonForkGitHubRepository(repository)
          upstreamDefaultBranch = branchesState.upstreamDefaultBranch
        }

        return (
          <CreateBranch
            key="create-branch"
            tip={branchesState.tip}
            defaultBranch={branchesState.defaultBranch}
            upstreamDefaultBranch={upstreamDefaultBranch}
            allBranches={branchesState.allBranches}
            repository={repository}
            targetCommit={popup.targetCommit}
            upstreamGitHubRepository={upstreamGhRepo}
            accounts={this.state.accounts}
            cachedRepoRulesets={this.state.cachedRepoRulesets}
            onBranchCreatedFromCommit={this.onBranchCreatedFromCommit}
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            initialName={popup.initialName || ''}
          />
        )
      }
      case PopupType.InstallGit:
        return (
          <InstallGit
            key="install-git"
            onDismissed={onPopupDismissedFn}
            onOpenShell={this.onOpenShellIgnoreWarning}
            path={popup.path}
          />
        )
      case PopupType.EditCopilotBYOKProvider:
        return (
          <EditCopilotBYOKProviderDialog
            key="edit-copilot-byok-provider"
            dispatcher={this.props.dispatcher}
            provider={popup.provider}
            onSave={this.onSaveCopilotBYOKProvider}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.EditCopilotBYOKModel:
        return (
          <EditCopilotBYOKModelDialog
            key="edit-copilot-byok-model"
            model={popup.model}
            otherModelIds={popup.otherModelIds}
            onSave={popup.onSave}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.ConfirmDeleteCopilotBYOKProvider:
        return (
          <ConfirmDeleteCopilotBYOKProviderDialog
            key="confirm-delete-copilot-byok-provider"
            provider={popup.provider}
            onConfirm={this.onConfirmDeleteCopilotBYOKProvider}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.About:
        const version = __DEV__ ? __SHA__.substring(0, 10) : getVersion()

        return (
          <About
            key="about"
            onDismissed={onPopupDismissedFn}
            applicationName={getName()}
            applicationVersion={version}
            applicationArchitecture={process.arch}
            onCheckForNonStaggeredUpdates={this.onCheckForNonStaggeredUpdates}
            onShowAcknowledgements={this.showAcknowledgements}
            onShowTermsAndConditions={this.showTermsAndConditions}
            updateState={this.state.updateState}
            onQuitAndInstall={this.onQuitAndInstall}
          />
        )
      case PopupType.PublishRepository:
        return (
          <Publish
            key="publish"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            accounts={this.state.accounts}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.UntrustedCertificate:
        return (
          <UntrustedCertificate
            key="untrusted-certificate"
            certificate={popup.certificate}
            url={popup.url}
            onDismissed={onPopupDismissedFn}
            onContinue={this.onContinueWithUntrustedCertificate}
          />
        )
      case PopupType.Acknowledgements:
        return (
          <Acknowledgements
            key="acknowledgements"
            onDismissed={onPopupDismissedFn}
            applicationVersion={getVersion()}
          />
        )
      case PopupType.RemoveRepository:
        return (
          <ConfirmRemoveRepository
            key="confirm-remove-repository"
            repository={popup.repository}
            onConfirmation={this.onConfirmRepoRemoval}
            onForceDelete={this.onForceDeleteRepo}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.TermsAndConditions:
        return (
          <TermsAndConditions
            key="terms-and-conditions"
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.PushBranchCommits:
        return (
          <PushBranchCommits
            key="push-branch-commits"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            branch={popup.branch}
            baseBranch={popup.baseBranch}
            unPushedCommits={popup.unPushedCommits}
            onConfirm={this.showCreatePullRequest}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.CLIInstalled:
        return (
          <CLIInstalled key="cli-installed" onDismissed={onPopupDismissedFn} />
        )
      case PopupType.GenericGitAuthentication:
        const onDismiss = () => {
          popup.onDismiss?.()
          onPopupDismissedFn()
        }

        return (
          <GenericGitAuthentication
            key="generic-git-authentication"
            remoteUrl={popup.remoteUrl}
            username={popup.username}
            // eslint-disable-next-line react/jsx-no-bind
            onDismiss={onDismiss}
            onSave={popup.onSubmit}
          />
        )
      case PopupType.ExternalEditorFailed:
        const openPreferences = popup.openPreferences
        const suggestDefaultEditor = popup.suggestDefaultEditor

        return (
          <EditorError
            key="editor-error"
            message={popup.message}
            onDismissed={onPopupDismissedFn}
            showPreferencesDialog={this.onShowIntegrationsPreferences}
            viewPreferences={openPreferences}
            suggestDefaultEditor={suggestDefaultEditor}
          />
        )
      case PopupType.OpenWithExternalEditor:
        return (
          <OpenWithExternalEditor
            onDismissed={onPopupDismissedFn}
            onOpenWithEditor={this.openRepositoryInSelectedEditor}
          />
        )
      case PopupType.OpenShellFailed:
        return (
          <ShellError
            key="shell-error"
            message={popup.message}
            onDismissed={onPopupDismissedFn}
            showPreferencesDialog={this.onShowIntegrationsPreferences}
          />
        )
      case PopupType.InitializeLFS:
        return (
          <InitializeLFS
            key="initialize-lfs"
            repositories={popup.repositories}
            onDismissed={onPopupDismissedFn}
            onInitialize={this.initializeLFS}
          />
        )
      case PopupType.LFSAttributeMismatch:
        return (
          <AttributeMismatch
            key="lsf-attribute-mismatch"
            onDismissed={onPopupDismissedFn}
            onUpdateExistingFilters={this.updateExistingLFSFilters}
            onEditGlobalGitConfig={this.editGlobalGitConfig}
          />
        )
      case PopupType.UpstreamAlreadyExists:
        return (
          <UpstreamAlreadyExists
            key="upstream-already-exists"
            repository={popup.repository}
            existingRemote={popup.existingRemote}
            onDismissed={onPopupDismissedFn}
            onUpdate={this.onUpdateExistingUpstreamRemote}
            onIgnore={this.onIgnoreExistingUpstreamRemote}
          />
        )
      case PopupType.ReleaseNotes:
        return (
          <ReleaseNotes
            key="release-notes"
            emoji={this.state.emoji}
            newReleases={popup.newReleases}
            onDismissed={onPopupDismissedFn}
            underlineLinks={this.state.underlineLinks}
          />
        )
      case PopupType.DeletePullRequest:
        return (
          <DeletePullRequest
            key="delete-pull-request"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            branch={popup.branch}
            onDismissed={onPopupDismissedFn}
            pullRequest={popup.pullRequest}
          />
        )
      case PopupType.OversizedFiles:
        return (
          <OversizedFiles
            key="oversized-files"
            oversizedFiles={popup.oversizedFiles}
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            context={popup.context}
            repository={popup.repository}
            accounts={this.state.accounts}
          />
        )
      case PopupType.CommitConflictsWarning:
        return (
          <CommitConflictsWarning
            key="commit-conflicts-warning"
            dispatcher={this.props.dispatcher}
            files={popup.files}
            repository={popup.repository}
            context={popup.context}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.PushNeedsPull:
        return (
          <PushNeedsPullWarning
            key="push-needs-pull"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.ConfirmForcePush: {
        const { askForConfirmationOnForcePush } = this.state

        return (
          <ConfirmForcePush
            key="confirm-force-push"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            upstreamBranch={popup.upstreamBranch}
            askForConfirmationOnForcePush={askForConfirmationOnForcePush}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.StashAndSwitchBranch: {
        const { repository, branchToCheckout } = popup
        const { branchesState } =
          this.props.repositoryStateManager.get(repository)
        const { tip } = branchesState

        if (tip.kind !== TipState.Valid) {
          return null
        }

        const currentBranch = tip.branch
        return (
          <StashAndSwitchBranch
            key="stash-and-switch-branch"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            currentBranch={currentBranch}
            branchToCheckout={branchToCheckout}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.ConfirmDiscardStash: {
        const { repository, stash } = popup

        return (
          <ConfirmDiscardStashDialog
            key="confirm-discard-stash-dialog"
            dispatcher={this.props.dispatcher}
            askForConfirmationOnDiscardStash={
              this.state.askForConfirmationOnDiscardStash
            }
            repository={repository}
            stash={stash}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.ConfirmCheckoutCommit: {
        const { repository, commit } = popup

        return (
          <ConfirmCheckoutCommitDialog
            key="confirm-checkout-commit-dialog"
            dispatcher={this.props.dispatcher}
            askForConfirmationOnCheckoutCommit={
              this.state.askForConfirmationOnDiscardStash
            }
            repository={repository}
            commit={commit}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.CreateTutorialRepository: {
        return (
          <CreateTutorialRepositoryDialog
            key="create-tutorial-repository-dialog"
            account={popup.account}
            progress={popup.progress}
            onDismissed={onPopupDismissedFn}
            onCreateTutorialRepository={this.onCreateTutorialRepository}
          />
        )
      }
      case PopupType.ConfirmExitTutorial: {
        return (
          <ConfirmExitTutorial
            key="confirm-exit-tutorial"
            onDismissed={onPopupDismissedFn}
            onContinue={this.onExitTutorialToHomeScreen}
          />
        )
      }
      case PopupType.PushRejectedDueToMissingWorkflowScope:
        return (
          <WorkflowPushRejectedDialog
            onDismissed={onPopupDismissedFn}
            rejectedPath={popup.rejectedPath}
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
          />
        )
      case PopupType.SAMLReauthRequired:
        return (
          <SAMLReauthRequiredDialog
            onDismissed={onPopupDismissedFn}
            organizationName={popup.organizationName}
            endpoint={popup.endpoint}
            retryAction={popup.retryAction}
            dispatcher={this.props.dispatcher}
          />
        )
      case PopupType.CreateFork:
        return (
          <CreateForkDialog
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            account={popup.account}
          />
        )
      case PopupType.CreateTag: {
        return (
          <CreateTag
            key="create-tag"
            repository={popup.repository}
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            targetCommitSha={popup.targetCommitSha}
            initialName={popup.initialName}
            localTags={popup.localTags}
          />
        )
      }
      case PopupType.DeleteTag: {
        return (
          <DeleteTag
            key="delete-tag"
            repository={popup.repository}
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
            tagName={popup.tagName}
          />
        )
      }
      case PopupType.ChooseForkSettings: {
        return (
          <ChooseForkSettings
            repository={popup.repository}
            onDismissed={onPopupDismissedFn}
            dispatcher={this.props.dispatcher}
          />
        )
      }
      case PopupType.LocalChangesOverwritten:
        return (
          <LocalChangesOverwrittenDialog
            repository={popup.repository}
            dispatcher={this.props.dispatcher}
            retryAction={popup.retryAction}
            onDismissed={onPopupDismissedFn}
            files={popup.files}
          />
        )
      case PopupType.MoveToApplicationsFolder: {
        return (
          <MoveToApplicationsFolder
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.ChangeRepositoryAlias: {
        return (
          <ChangeRepositoryAlias
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.ChangeRepositoryGroupName: {
        return (
          <ChangeRepositoryGroupName
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.ThankYou:
        return (
          <ThankYou
            key="thank-you"
            emoji={this.state.emoji}
            userContributions={popup.userContributions}
            friendlyName={popup.friendlyName}
            latestVersion={popup.latestVersion}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.CommitMessage:
        const repositoryState = this.props.repositoryStateManager.get(
          popup.repository
        )

        const { tip } = repositoryState.branchesState
        const currentBranchName: string | null =
          tip.kind === TipState.Valid ? tip.branch.name : null

        const hasWritePermissionForRepository =
          popup.repository.gitHubRepository === null ||
          hasWritePermission(popup.repository.gitHubRepository)

        const autocompletionProviders = buildAutocompletionProviders(
          popup.repository,
          this.props.dispatcher,
          this.state.emoji,
          this.props.issuesStore,
          this.props.gitHubUserStore,
          this.state.accounts
        )

        const repositoryAccount = getAccountForRepository(
          this.state.accounts,
          popup.repository
        )

        return (
          <CommitMessageDialog
            key="commit-message"
            autocompletionProviders={autocompletionProviders}
            branch={currentBranchName}
            coAuthors={popup.coAuthors}
            commitAuthor={repositoryState.commitAuthor}
            commitMessage={popup.commitMessage}
            commitSpellcheckEnabled={this.state.commitSpellcheckEnabled}
            showCommitLengthWarning={this.state.showCommitLengthWarning}
            dialogButtonText={popup.dialogButtonText}
            dialogTitle={popup.dialogTitle}
            dispatcher={this.props.dispatcher}
            prepopulateCommitSummary={popup.prepopulateCommitSummary}
            repository={popup.repository}
            showBranchProtected={
              repositoryState.changesState.currentBranchProtected
            }
            repoRulesInfo={repositoryState.changesState.currentRepoRulesInfo}
            aheadBehind={repositoryState.aheadBehind}
            showCoAuthoredBy={popup.showCoAuthoredBy}
            showNoWriteAccess={!hasWritePermissionForRepository}
            onDismissed={onPopupDismissedFn}
            onSubmitCommitMessage={popup.onSubmitCommitMessage}
            repositoryAccount={repositoryAccount}
            accounts={this.state.accounts}
            skipCommitHooks={repositoryState.skipCommitHooks}
            signOffCommits={repositoryState.signOffCommits}
            allowEmptyCommit={repositoryState.allowEmptyCommit}
            onUpdateCommitOptions={this.onUpdateCommitOptions}
          />
        )
      case PopupType.MultiCommitOperation: {
        const { selectedState, emoji } = this.state

        if (
          selectedState === null ||
          selectedState.type !== SelectionType.Repository
        ) {
          return null
        }

        const { changesState, multiCommitOperationState } = selectedState.state
        const { workingDirectory, conflictState } = changesState
        if (multiCommitOperationState === null) {
          log.warn(
            '[App] invalid state encountered - multi commit flow should not be active when step is null'
          )
          return null
        }

        return (
          <MultiCommitOperation
            key="multi-commit-operation"
            repository={popup.repository}
            dispatcher={this.props.dispatcher}
            state={multiCommitOperationState}
            conflictState={conflictState}
            emoji={emoji}
            workingDirectory={workingDirectory}
            askForConfirmationOnForcePush={
              this.state.askForConfirmationOnForcePush
            }
            accounts={this.state.accounts}
            cachedRepoRulesets={this.state.cachedRepoRulesets}
            shouldShowCopilotConflictResolutionCallOut={
              this.state.copilotConflictResolutionClickCount === 0
            }
            copilotConflictResolutionModel={getConflictResolutionModelDisplay(
              this.state.selectedCopilotModels['conflict-resolution'] ?? null,
              this.state.copilotModels,
              this.state.byokProviders
            )}
            openFileInExternalEditor={this.openFileInExternalEditor}
            resolvedExternalEditor={this.state.resolvedExternalEditor}
            openRepositoryInShell={this.openCurrentRepositoryInShell}
          />
        )
      }
      case PopupType.WarnLocalChangesBeforeUndo: {
        const { repository, commit, isWorkingDirectoryClean } = popup
        return (
          <WarnLocalChangesBeforeUndo
            key="warn-local-changes-before-undo"
            dispatcher={this.props.dispatcher}
            repository={repository}
            commit={commit}
            isWorkingDirectoryClean={isWorkingDirectoryClean}
            confirmUndoCommit={this.state.askForConfirmationOnUndoCommit}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.WarningBeforeReset: {
        const { repository, commit } = popup
        return (
          <WarningBeforeReset
            key="warning-before-reset"
            dispatcher={this.props.dispatcher}
            repository={repository}
            commit={commit}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.WarnUndoPushedCommit: {
        const { repository, commit } = popup
        return (
          <WarnUndoPushedCommit
            key="warn-undo-pushed-commit"
            dispatcher={this.props.dispatcher}
            repository={repository}
            commit={commit}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.WarnResetToPushedCommit: {
        const { repository, commit } = popup
        return (
          <WarnResetToPushedCommit
            key="warn-reset-to-pushed-commit"
            dispatcher={this.props.dispatcher}
            repository={repository}
            commit={commit}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.ConfirmDeletePushedTag: {
        const { repository, tagName } = popup
        return (
          <ConfirmDeletePushedTagDialog
            key="confirm-delete-pushed-tag"
            dispatcher={this.props.dispatcher}
            repository={repository}
            tagName={tagName}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.CommandPalette:
        return (
          <CommandPalette
            key="command-palette"
            onExecute={this.onPaletteCommand}
            availabilityContext={this.getPaletteAvailabilityContext()}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.InsufficientOAuthScopes:
        return (
          <InsufficientScopesDialog
            key="insufficient-oauth-scopes"
            account={popup.account}
            missingScopes={popup.missingScopes}
            onSignInAgain={this.onReauthorizeAccount}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.InvalidatedToken: {
        return (
          <InvalidatedToken
            key="invalidated-token"
            dispatcher={this.props.dispatcher}
            account={popup.account}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.AddSSHHost: {
        return (
          <AddSSHHost
            key="add-ssh-host"
            host={popup.host}
            ip={popup.ip}
            keyType={popup.keyType}
            fingerprint={popup.fingerprint}
            onSubmit={popup.onSubmit}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.SSHKeyPassphrase: {
        return (
          <SSHKeyPassphrase
            key="ssh-key-passphrase"
            keyPath={popup.keyPath}
            onSubmit={popup.onSubmit}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.SSHUserPassword: {
        return (
          <SSHUserPassword
            key="ssh-user-password"
            username={popup.username}
            onSubmit={popup.onSubmit}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.PullRequestChecksFailed: {
        return (
          <PullRequestChecksFailed
            key="pull-request-checks-failed"
            dispatcher={this.props.dispatcher}
            shouldChangeRepository={popup.shouldChangeRepository}
            repository={popup.repository}
            pullRequest={popup.pullRequest}
            checks={popup.checks}
            accounts={this.state.accounts}
            onSubmit={onPopupDismissedFn}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.CICheckRunRerun: {
        return (
          <CICheckRunRerunDialog
            key="rerun-check-runs"
            checkRuns={popup.checkRuns}
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            prRef={popup.prRef}
            onDismissed={onPopupDismissedFn}
            failedOnly={popup.failedOnly}
          />
        )
      }
      case PopupType.WarnForcePush: {
        const { askForConfirmationOnForcePush } = this.state
        return (
          <WarnForcePushDialog
            key="warn-force-push"
            dispatcher={this.props.dispatcher}
            operation={popup.operation}
            askForConfirmationOnForcePush={askForConfirmationOnForcePush}
            onBegin={this.getWarnForcePushDialogOnBegin(
              popup.onBegin,
              onPopupDismissedFn
            )}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.DiscardChangesRetry: {
        return (
          <DiscardChangesRetryDialog
            key="discard-changes-retry"
            dispatcher={this.props.dispatcher}
            retryAction={popup.retryAction}
            onDismissed={onPopupDismissedFn}
            onConfirmDiscardChangesChanged={
              this.onConfirmDiscardChangesPermanentlyChanged
            }
          />
        )
      }
      case PopupType.PullRequestReview: {
        return (
          <PullRequestReview
            key="pull-request-review"
            dispatcher={this.props.dispatcher}
            shouldCheckoutBranch={popup.shouldCheckoutBranch}
            shouldChangeRepository={popup.shouldChangeRepository}
            repository={popup.repository}
            pullRequest={popup.pullRequest}
            review={popup.review}
            emoji={this.state.emoji}
            onSubmit={onPopupDismissedFn}
            onDismissed={onPopupDismissedFn}
            underlineLinks={this.state.underlineLinks}
            accounts={this.state.accounts}
          />
        )
      }
      case PopupType.UnreachableCommits: {
        const { selectedState, emoji } = this.state
        if (
          selectedState == null ||
          selectedState.type !== SelectionType.Repository
        ) {
          return null
        }

        const {
          commitLookup,
          commitSelection: { shas, shasInDiff },
        } = selectedState.state

        return (
          <UnreachableCommitsDialog
            selectedShas={shas}
            shasInDiff={shasInDiff}
            commitLookup={commitLookup}
            selectedTab={popup.selectedTab}
            emoji={emoji}
            onDismissed={onPopupDismissedFn}
            accounts={this.state.accounts}
            preferAbsoluteDates={this.state.preferAbsoluteDates}
          />
        )
      }
      case PopupType.StartPullRequest: {
        // Intentionally chose to get the current pull request state  on
        // rerender because state variables such as file selection change
        // via the dispatcher.
        const pullRequestState = this.getPullRequestState()
        if (pullRequestState === null) {
          // This shouldn't happen..
          sendNonFatalException(
            'FailedToStartPullRequest',
            new Error(
              'Failed to start pull request because pull request state was null'
            )
          )
          return null
        }

        const { pullRequestFilesListWidth, hideWhitespaceInPullRequestDiff } =
          this.state

        const {
          prBaseBranches,
          currentBranch,
          defaultBranch,
          imageDiffType,
          externalEditorLabel,
          nonLocalCommitSHA,
          prRecentBaseBranches,
          repository,
          showSideBySideDiff,
          currentBranchHasPullRequest,
        } = popup

        return (
          <OpenPullRequestDialog
            key="open-pull-request"
            prBaseBranches={prBaseBranches}
            currentBranch={currentBranch}
            defaultBranch={defaultBranch}
            dispatcher={this.props.dispatcher}
            fileListWidth={pullRequestFilesListWidth}
            hideWhitespaceInDiff={hideWhitespaceInPullRequestDiff}
            imageDiffType={imageDiffType}
            nonLocalCommitSHA={nonLocalCommitSHA}
            pullRequestState={pullRequestState}
            prRecentBaseBranches={prRecentBaseBranches}
            repository={repository}
            externalEditorLabel={externalEditorLabel}
            showSideBySideDiff={showSideBySideDiff}
            currentBranchHasPullRequest={currentBranchHasPullRequest}
            onDismissed={onPopupDismissedFn}
            onOpenInExternalEditor={this.onOpenInExternalEditor}
          />
        )
      }
      case PopupType.Error: {
        return (
          <AppError
            error={popup.error}
            onDismissed={onPopupDismissedFn}
            onShowPopup={this.showPopup}
            onRetryAction={this.onRetryAction}
          />
        )
      }
      case PopupType.InstallingUpdate: {
        return (
          <InstallingUpdate
            key="installing-update"
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.TestNotifications: {
        return (
          <TestNotifications
            key="test-notifications"
            dispatcher={this.props.dispatcher}
            notificationsDebugStore={this.props.notificationsDebugStore}
            repository={popup.repository}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.PullRequestComment: {
        return (
          <PullRequestComment
            key="pull-request-comment"
            dispatcher={this.props.dispatcher}
            shouldCheckoutBranch={popup.shouldCheckoutBranch}
            shouldChangeRepository={popup.shouldChangeRepository}
            repository={popup.repository}
            pullRequest={popup.pullRequest}
            comment={popup.comment}
            emoji={this.state.emoji}
            onSubmit={onPopupDismissedFn}
            onDismissed={onPopupDismissedFn}
            underlineLinks={this.state.underlineLinks}
            accounts={this.state.accounts}
          />
        )
      }
      case PopupType.UnknownAuthors: {
        return (
          <UnknownAuthors
            key="unknown-authors"
            authors={popup.authors}
            onCommit={popup.onCommit}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.TestIcons: {
        return (
          <IconPreviewDialog
            key="octicons-preview"
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.ConfirmCommitFilteredChanges: {
        return (
          <ConfirmCommitFilteredChanges
            onCommitAnyway={popup.onCommitAnyway}
            onDismissed={onPopupDismissedFn}
            showFilesToBeCommitted={popup.showFilesToBeCommitted}
            setConfirmCommitFilteredChanges={
              this.setConfirmCommitFilteredChanges
            }
          />
        )
      }
      case PopupType.TestAbout:
        return (
          <AboutTestDialog
            key="about"
            onDismissed={onPopupDismissedFn}
            onShowAcknowledgements={this.showAcknowledgements}
            onShowTermsAndConditions={this.showTermsAndConditions}
          />
        )
      case PopupType.TestCLIAction:
        return (
          <TestCLIActionDialog
            key="test-cli-action"
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.PushProtectionError:
        return (
          <PushProtectionErrorDialog
            key="push-protection-error"
            secrets={popup.secrets}
            onDelegatedBypassLinkClick={this.onSecretDelegatedBypassLinkClick}
            onRemediationInstructionsLinkClick={
              this.onSecretRemediationInstructionsLinkClick
            }
            bypassPushProtection={this.openBypassPushProtection}
            onDismissed={onPopupDismissedFn}
          />
        )
      case PopupType.BypassPushProtection:
        return (
          <BypassPushProtectionDialog
            key="bypass-push-protection"
            secret={popup.secret}
            bypassPushProtection={popup.bypassPushProtection}
            onDismissed={this.onDismissBypassPushProtection(
              popup.id,
              popup.onDismissed
            )}
          />
        )
      case PopupType.GenerateCommitMessageOverrideWarning: {
        const account = getAccountForCommitMessageGeneration(
          this.state.accounts,
          popup.repository
        )

        return (
          <GenerateCommitMessageOverrideWarning
            key="generate-commit-message-override-warning"
            dispatcher={this.props.dispatcher}
            repository={popup.repository}
            filesSelected={popup.filesSelected}
            showCopilotInstructionsTip={
              account !== undefined &&
              enableCopilotSdkCommitMessageGeneration(account)
            }
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.GenerateCommitMessageDisclaimer: {
        const { repository, filesSelected } = popup
        const onAccepted = () => {
          this.props.dispatcher.updateCommitMessageGenerationDisclaimerLastSeen()
          this.props.dispatcher.generateCommitMessage(repository, filesSelected)
        }
        return (
          <CopilotDisclaimer
            key="generate-commit-message-disclaimer"
            // eslint-disable-next-line react/jsx-no-bind
            onAccepted={onAccepted}
            onDismissed={onPopupDismissedFn}
          >
            Review and edit the generated message carefully before use.
          </CopilotDisclaimer>
        )
      }
      case PopupType.CopilotConflictResolutionDisclaimer: {
        const { repository } = popup
        const onAccepted = () => {
          this.props.dispatcher.updateCopilotConflictResolutionDisclaimerLastSeen()
          this.props.dispatcher.attemptCopilotConflictResolution(repository)
        }
        return (
          <CopilotDisclaimer
            key="copilot-conflict-resolution-disclaimer"
            // eslint-disable-next-line react/jsx-no-bind
            onAccepted={onAccepted}
            onDismissed={onPopupDismissedFn}
          >
            Review the suggested resolutions carefully before applying them to
            your files.
          </CopilotDisclaimer>
        )
      }
      case PopupType.CopilotConflictResolutionAlwaysNudge: {
        const { repository } = popup
        const onAlwaysUseCopilot = () => {
          this.props.dispatcher.setAlwaysUseCopilotForConflictResolution(true)
          this.props.dispatcher.closePopup(
            PopupType.CopilotConflictResolutionAlwaysNudge
          )
          this.props.dispatcher.attemptCopilotConflictResolution(repository)
        }
        const onDecline = () => {
          this.props.dispatcher.closePopup(
            PopupType.CopilotConflictResolutionAlwaysNudge
          )
          this.props.dispatcher.attemptCopilotConflictResolution(repository)
        }
        return (
          <CopilotConflictResolutionAlwaysNudge
            key="copilot-conflict-resolution-always-nudge"
            // eslint-disable-next-line react/jsx-no-bind
            onAlwaysUseCopilot={onAlwaysUseCopilot}
            // eslint-disable-next-line react/jsx-no-bind
            onDecline={onDecline}
            // eslint-disable-next-line react/jsx-no-bind
            onDismissed={onDecline}
          />
        )
      }
      case PopupType.HookFailed: {
        return (
          <HookFailed
            key="hook-failure-dialog"
            hookName={popup.hookName}
            terminalOutput={popup.terminalOutput}
            resolve={popup.resolve}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.CommitProgress: {
        return (
          <CommitProgress
            key="commit-progress-dialog"
            subscribeToCommitOutput={popup.subscribeToCommitOutput}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.AddWorktree: {
        if (popup.repository instanceof SubmoduleRepository) {
          return null
        }
        const allBranches =
          this.state.selectedState?.type === SelectionType.Repository
            ? this.state.selectedState.state.branchesState.allBranches
            : []
        return (
          <AddWorktreeDialog
            key="add-worktree"
            repository={popup.repository}
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
            initialBranchName={popup.initialBranchName}
            initialWorktreeName={popup.initialWorktreeName}
            commitish={popup.commitish}
            allBranches={allBranches}
          />
        )
      }
      case PopupType.RenameWorktree: {
        return (
          <RenameWorktreeDialog
            key="rename-worktree"
            repository={popup.repository}
            worktreePath={popup.worktreePath}
            dispatcher={this.props.dispatcher}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.DeleteWorktree: {
        return (
          <DeleteWorktreeDialog
            key="delete-worktree"
            repository={popup.repository}
            worktreePath={popup.worktreePath}
            askForConfirmationOnWorktreeRemoval={
              this.state.askForConfirmationOnWorktreeRemoval
            }
            onDeleteWorktree={this.onDeleteWorkTree}
            onConfirmWorktreeRemovalChanged={
              this.onConfirmWorktreeRemovalChanged
            }
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      case PopupType.DeleteWorktreeFailed: {
        return (
          <DeleteWorktreeFailedDialog
            key="delete-worktree-failed"
            repository={popup.repository}
            worktreePath={popup.worktreePath}
            error={popup.error}
            originalWorktree={popup.originalWorktree}
            onDeleteWorktree={this.onDeleteWorkTree}
            onSwitchToWorktree={this.onSwitchToWorktree}
            onDismissed={onPopupDismissedFn}
          />
        )
      }
      default:
        return assertNever(popup, `Unknown popup type: ${popup}`)
    }
  }

  private onSwitchToWorktree = (
    repository: Repository,
    worktree: WorktreeEntry
  ) => {
    return this.props.dispatcher.switchWorktree(repository, worktree)
  }

  private onDeleteWorkTree = (
    repository: Repository,
    worktreePath: string,
    force?: boolean
  ) => {
    return this.props.dispatcher.deleteWorktree(repository, worktreePath, force)
  }

  private onConfirmWorktreeRemovalChanged = (value: boolean) => {
    this.props.dispatcher.setConfirmWorktreeRemovalSetting(value)
  }

  private onUpdateCommitOptions = (
    repository: Repository,
    options: Partial<CommitOptions>
  ) => {
    this.props.dispatcher.updateCommitOptions(repository, options)
  }

  private onSecretDelegatedBypassLinkClick = () => {
    this.props.dispatcher.incrementMetric(
      'secretsDetectedOnPushDelegatedBypassLinkClickedCount'
    )
  }

  private onSecretRemediationInstructionsLinkClick = () => {
    this.props.dispatcher.incrementMetric(
      'secretRemediationInstructionsLinkClickedCount'
    )
  }

  private onDismissBypassPushProtection = (
    popupId: number,
    popupDismiss: () => void
  ) => {
    return () => {
      popupDismiss()
      this.onPopupDismissed(popupId)
    }
  }

  private setConfirmCommitFilteredChanges = (value: boolean) => {
    this.props.dispatcher.setConfirmCommitFilteredChanges(value)
  }

  private getPullRequestState() {
    const { selectedState } = this.state
    if (
      selectedState == null ||
      selectedState.type !== SelectionType.Repository
    ) {
      return null
    }

    return selectedState.state.pullRequestState
  }

  private openBypassPushProtection = (secret: ISecretScanResult) => {
    return new Promise<IAPICreatePushProtectionBypassResponse | null>(
      resolve => {
        this.props.dispatcher.showPopup({
          type: PopupType.BypassPushProtection,
          secret,
          bypassPushProtection: (
            secret: ISecretScanResult,
            reason: BypassReasonType
          ) => {
            this.bypassPushProtection(secret, reason)
              .then(response => {
                this.recordSecretBypassStats(reason)
                resolve(response)
              })
              .catch(error => {
                resolve(null)
                this.props.dispatcher.postError(error)
              })
              .finally(() => {
                this.props.dispatcher.closePopup(PopupType.BypassPushProtection)
              })
          },
          onDismissed: () => {
            resolve(null)
          },
        })
      }
    )
  }

  private recordSecretBypassStats = (reason: BypassReasonType) => {
    this.props.dispatcher.incrementMetric('secretsDetectedOnPushBypassedCount')
    switch (reason) {
      case BypassReason.FalsePositive:
        this.props.dispatcher.incrementMetric(
          'secretsDetectedOnPushBypassedAsFalsePositiveCount'
        )
        break
      case BypassReason.UsedInTests:
        this.props.dispatcher.incrementMetric(
          'secretsDetectedOnPushBypassedAsUsedInTestCount'
        )
        break
      case BypassReason.WillFixLater:
        this.props.dispatcher.incrementMetric(
          'secretsDetectedOnPushBypassedAsWillFixLaterCount'
        )
        break
      default:
        return assertNever(reason, `Unknown Bypass reason: ${reason}`)
    }
  }

  private bypassPushProtection = (
    secret: ISecretScanResult,
    reason: BypassReasonType
  ): Promise<IAPICreatePushProtectionBypassResponse | null> => {
    return this.props.dispatcher.createPushProtectionBypass(
      reason,
      secret.id,
      secret.bypassURL
    )
  }

  private getWarnForcePushDialogOnBegin(
    onBegin: () => void,
    onPopupDismissedFn: () => void
  ) {
    return () => {
      onBegin()
      onPopupDismissedFn()
    }
  }

  private onExitTutorialToHomeScreen = () => {
    const tutorialRepository = this.getSelectedTutorialRepository()
    if (!tutorialRepository) {
      return false
    }

    this.props.dispatcher.pauseTutorial(tutorialRepository)
    return true
  }

  private onCreateTutorialRepository = (account: Account) => {
    this.props.dispatcher.createTutorialRepository(account)
  }

  private onUpdateExistingUpstreamRemote = (repository: Repository) => {
    this.props.dispatcher.updateExistingUpstreamRemote(repository)
  }

  private onIgnoreExistingUpstreamRemote = (repository: Repository) => {
    this.props.dispatcher.ignoreExistingUpstreamRemote(repository)
  }

  private updateExistingLFSFilters = () => {
    this.props.dispatcher.installGlobalLFSFilters(true)
  }

  private editGlobalGitConfig = () =>
    this.props.dispatcher.editGlobalGitConfig()

  private initializeLFS = (repositories: ReadonlyArray<Repository>) => {
    this.props.dispatcher.installLFSHooks(repositories)
  }

  private onCloneRepositoriesTabSelected = (tab: CloneRepositoryTab) => {
    this.props.dispatcher.changeCloneRepositoriesTab(tab)
  }

  private onRefreshRepositories = (account: Account) => {
    this.props.dispatcher.refreshApiRepositories(account)
  }

  private onShowIntegrationsPreferences = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.Preferences,
      initialSelectedTab: PreferencesTab.Integrations,
    })
  }

  private showOpenWithExternalEditor = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.OpenWithExternalEditor,
    })
  }

  private onBranchCreatedFromCommit = () => {
    const repositoryView = this.repositoryViewRef.current
    if (repositoryView !== null) {
      repositoryView.scrollCompareListToTop()
    }
  }

  private onOpenShellIgnoreWarning = (path: string) => {
    this.props.dispatcher.openShell(path, true)
  }

  private onCheckForNonStaggeredUpdates = () =>
    this.checkForUpdates(false, true)

  private onSaveCopilotBYOKProvider = (
    provider: IBYOKProvider,
    secret: string | null | undefined
  ) => {
    if (this.state.byokProviders.some(p => p.id === provider.id)) {
      this.props.dispatcher.updateCopilotBYOKProvider(provider, secret)
    } else {
      this.props.dispatcher.addCopilotBYOKProvider(provider, secret ?? null)
    }
  }

  private onConfirmDeleteCopilotBYOKProvider = (provider: IBYOKProvider) => {
    this.props.dispatcher.deleteCopilotBYOKProvider(provider.id)
  }

  private showAcknowledgements = () => {
    this.props.dispatcher.showPopup({ type: PopupType.Acknowledgements })
  }

  private showTermsAndConditions = () => {
    this.props.dispatcher.showPopup({ type: PopupType.TermsAndConditions })
  }

  private onQuitAndInstall = () => updateStore.quitAndInstallUpdate()

  private renderPopups() {
    const { allPopups, currentPopup } = this.state

    return (
      <div id="dialog-layer">
        <TransitionGroup>
          {allPopups.map((popup, index) => {
            if (popup.id === undefined) {
              return null
            }

            const isTopMost = currentPopup?.id === popup.id
            const content = this.popupContent(popup, isTopMost)

            if (content === null) {
              return null
            }

            const modal = ModalPopupTypes.has(popup.type)
            const onRequestFront = this.getOnPopupRequestFrontFn(popup.id)
            const onPopupDismissedFn = this.getOnPopupDismissedFn(popup.id)

            return (
              <CSSTransition
                classNames="modal"
                timeout={dialogTransitionTimeout}
                key={popup.id}
              >
                <CrashProofBoundary
                  name={`${popup.type} dialog`}
                  resetKey={`${popup.id}:${popup.type}`}
                  onDismiss={onPopupDismissedFn}
                >
                  <DialogStackContext.Provider
                    value={{
                      isTopMost,
                      modal,
                      onRequestFront,
                      stackOrder: index,
                    }}
                  >
                    {content}
                  </DialogStackContext.Provider>
                </CrashProofBoundary>
              </CSSTransition>
            )
          })}
        </TransitionGroup>
      </div>
    )
  }

  private renderDragElement() {
    return <div id="dragElement">{this.renderCurrentDragElement()}</div>
  }

  /**
   * Render the current drag element based on it's type. Used in conjunction
   * with the `Draggable` component.
   */
  private renderCurrentDragElement(): JSX.Element | null {
    const { currentDragElement, emoji } = this.state
    if (currentDragElement === null) {
      return null
    }

    const { gitHubRepository, commit, selectedCommits } = currentDragElement
    switch (currentDragElement.type) {
      case DragType.Commit:
        return (
          <CommitDragElement
            gitHubRepository={gitHubRepository}
            commit={commit}
            selectedCommits={selectedCommits}
            emoji={emoji}
            accounts={this.state.accounts}
          />
        )
      default:
        return assertNever(
          currentDragElement.type,
          `Unknown drag element type: ${currentDragElement}`
        )
    }
  }

  private renderZoomInfo() {
    return <ZoomInfo windowZoomFactor={this.state.windowZoomFactor} />
  }

  private renderFullScreenInfo() {
    return <FullScreenInfo windowState={this.state.windowState} />
  }

  private onConfirmDiscardChangesChanged = (value: boolean) => {
    this.props.dispatcher.setConfirmDiscardChangesSetting(value)
  }

  private onConfirmDiscardChangesPermanentlyChanged = (value: boolean) => {
    this.props.dispatcher.setConfirmDiscardChangesPermanentlySetting(value)
  }

  private onRetryAction = (retryAction: RetryAction) => {
    this.props.dispatcher.performRetry(retryAction)
  }

  private showPopup = (popup: Popup) => {
    this.props.dispatcher.showPopup(popup)
  }

  private setBanner = (banner: Banner) =>
    this.props.dispatcher.setBanner(banner)

  private getDesktopAppContentsClassNames = (): string => {
    const { currentDragElement } = this.state
    const isCommitBeingDragged =
      currentDragElement !== null && currentDragElement.type === DragType.Commit
    return classNames({
      'commit-being-dragged': isCommitBeingDragged,
    })
  }

  private renderRepositoryTabStrip() {
    return (
      <RepositoryTabStrip
        tabsStore={this.props.repositoryTabsStore}
        repositories={this.state.repositories}
        dispatcher={this.props.dispatcher}
        repositoryStateManager={this.props.repositoryStateManager}
        unreadNotificationCount={this.state.unreadNotificationCount}
        isNotificationCentreOpen={this.state.isNotificationCentreOpen}
      />
    )
  }

  private renderNotificationCentre() {
    if (!this.state.isNotificationCentreOpen) {
      return null
    }

    return (
      <NotificationCentrePanel
        dispatcher={this.props.dispatcher}
        entries={this.state.notifications}
        unreadCount={this.state.unreadNotificationCount}
        repositories={this.state.repositories}
        accounts={this.state.accounts}
      />
    )
  }

  private onReturnToParentRepository = (): Promise<void> => {
    const selection = this.state.selectedState
    if (
      selection === null ||
      selection.type !== SelectionType.Repository ||
      !(selection.repository instanceof SubmoduleRepository)
    ) {
      return Promise.resolve()
    }

    const repository = selection.repository
    const parentName =
      repository.parentRepository.alias ?? repository.parentRepository.name
    return this.submoduleReturnInFlight.run(async () => {
      const currentSelection = this.state.selectedState
      if (
        currentSelection === null ||
        currentSelection.type !== SelectionType.Repository ||
        currentSelection.repository !== repository
      ) {
        return
      }

      try {
        await this.props.dispatcher.returnToParentRepository(repository)
        window.requestAnimationFrame(() => {
          if (this.mounted) {
            this.repositoryDropdownRef.current?.focusButton()
          }
        })
      } catch (error) {
        const selectionAfterFailure = this.state.selectedState
        if (
          !this.mounted ||
          selectionAfterFailure === null ||
          selectionAfterFailure.type !== SelectionType.Repository ||
          selectionAfterFailure.repository !== repository
        ) {
          return
        }
        await this.props.dispatcher.postError(
          new Error(
            t('submodule.returnFailed', {
              parent: parentName,
              error: String(error),
            })
          )
        )
      }
    })
  }

  private renderSubmoduleRepositoryContext() {
    const selection = this.state.selectedState
    if (
      selection === null ||
      selection.type !== SelectionType.Repository ||
      !(selection.repository instanceof SubmoduleRepository)
    ) {
      return null
    }

    const repository = selection.repository
    const parent = repository.parentRepository
    const parentName = parent.alias ?? parent.name
    return (
      <aside
        className="submodule-repository-context"
        role="navigation"
        aria-label={translateForAccessibleName(
          'submodule.navigation',
          {},
          this.state.appearanceCustomization.languageMode
        )}
      >
        <SubmoduleBackButton
          appearanceCustomization={this.state.appearanceCustomization}
          parentName={parentName}
          onActivate={this.onReturnToParentRepository}
          onAppearanceCustomizationChanged={
            this.onSubmoduleBackAppearanceChanged
          }
          disabled={this.submoduleReturnInFlight.pending}
          autoFocus={true}
          historySource={
            this.props.dispatcher.isElementAppearanceCoordinatorReady()
              ? this.props.dispatcher.getProfileAppearanceHistorySource(
                  ProfileAppearanceElementId.SubmoduleBackButton
                )
              : undefined
          }
          repositoryPath={
            this.props.dispatcher.isElementAppearanceCoordinatorReady()
              ? this.props.dispatcher.getProfileAppearanceRepositoryPath(
                  ProfileAppearanceElementId.SubmoduleBackButton
                )
              : undefined
          }
        />
        <p>
          <LocalizedText
            translationKey="submodule.viewingContext"
            variables={{ child: repository.name, parent: parentName }}
            languageMode={this.state.appearanceCustomization.languageMode}
          />
        </p>
        <Button
          type="button"
          className="submodule-context-close"
          onClick={this.onReturnToParentRepository}
          disabled={this.submoduleReturnInFlight.pending}
          ariaLabel={translateForAccessibleName(
            'submodule.closeTemporaryViewer',
            {},
            this.state.appearanceCustomization.languageMode
          )}
          tooltip={t('submodule.closeTemporaryViewer')}
        >
          <Octicon symbol={octicons.x} />
          <span className="submodule-context-close-label">
            <LocalizedText
              translationKey="submodule.closeTemporaryViewer"
              languageMode={this.state.appearanceCustomization.languageMode}
            />
          </span>
        </Button>
      </aside>
    )
  }

  private onSubmoduleBackAppearanceChanged = (
    appearanceCustomization: IAppearanceCustomization
  ) => {
    void this.props.dispatcher.setAppearanceCustomization(
      appearanceCustomization
    )
  }

  private renderErrorNotices() {
    return (
      <ErrorNoticeStack
        notices={this.state.errorNotices}
        onDismiss={this.onErrorNoticeDismissed}
        onAction={this.onErrorNoticeAction}
      />
    )
  }

  private onErrorNoticeDismissed = (id: string) => {
    this.props.dispatcher.dismissErrorNotice(id)
  }

  private onErrorNoticeAction = (
    notice: IErrorNotice,
    action: IErrorNoticeAction
  ) => {
    if (action.kind === 'remove-repository-lock') {
      void this.props.dispatcher.removeRepositoryLock(
        action.repositoryId,
        notice.id,
        true
      )
    }
  }

  private setProfileAppearanceElement<K extends ProfileAppearanceElementId>(
    id: K,
    value: IProfileAppearanceElementSettings[K]
  ) {
    void this.props.dispatcher
      .setProfileAppearanceElement(id, value)
      .catch(error => this.props.dispatcher.postError(asError(error)))
  }

  private onAppWorkspaceAppearanceChanged = (
    value: IProfileAppearanceElementSettings[typeof ProfileAppearanceElementId.AppWorkspace]
  ) => {
    this.setProfileAppearanceElement(
      ProfileAppearanceElementId.AppWorkspace,
      value
    )
  }

  private onUpdateProgressAppearanceChanged = (
    value: IProfileAppearanceElementSettings[typeof ProfileAppearanceElementId.UpdateProgress]
  ) => {
    this.setProfileAppearanceElement(
      ProfileAppearanceElementId.UpdateProgress,
      value
    )
  }

  private onToolbarAppearanceChanged = (
    value: IProfileAppearanceElementSettings[typeof ProfileAppearanceElementId.Toolbar]
  ) => {
    this.setProfileAppearanceElement(ProfileAppearanceElementId.Toolbar, value)
  }

  private onRepositoryListAppearanceChanged = (
    value: IProfileAppearanceElementSettings[typeof ProfileAppearanceElementId.RepositoryList]
  ) => {
    this.setProfileAppearanceElement(
      ProfileAppearanceElementId.RepositoryList,
      value
    )
  }

  private onRepositoryTabsAppearanceChanged = (
    value: IRepositoryTabsAppearance
  ) => {
    const id = ProfileAppearanceElementId.RepositoryTabs
    const current = this.props.dispatcher.getProfileAppearanceElement(id)
    this.setProfileAppearanceElement(id, { ...current, ...value })
  }

  private onCodeDiffAppearanceChanged = (
    value: IProfileAppearanceElementSettings[typeof ProfileAppearanceElementId.CodeDiff]
  ) => {
    this.setProfileAppearanceElement(ProfileAppearanceElementId.CodeDiff, value)
  }

  private onAppIdentityAppearanceChanged = (
    value: IProfileAppearanceElementSettings[typeof ProfileAppearanceElementId.AppIdentity]
  ) => {
    this.setProfileAppearanceElement(
      ProfileAppearanceElementId.AppIdentity,
      value
    )
  }

  private onDefaultRepositoryLogoAppearanceChanged = (
    value: IProfileAppearanceElementSettings[typeof ProfileAppearanceElementId.DefaultRepositoryLogo]
  ) => {
    this.setProfileAppearanceElement(
      ProfileAppearanceElementId.DefaultRepositoryLogo,
      value
    )
  }

  private profileAppearanceTitle(id: ProfileAppearanceElementId): string {
    switch (id) {
      case ProfileAppearanceElementId.AppWorkspace:
        return 'App workspace appearance'
      case ProfileAppearanceElementId.UpdateProgress:
        return 'Update progress appearance'
      case ProfileAppearanceElementId.Toolbar:
        return 'Toolbar appearance'
      case ProfileAppearanceElementId.RepositoryList:
        return 'Repository list appearance'
      case ProfileAppearanceElementId.RepositoryTabs:
        return 'Repository tabs appearance'
      case ProfileAppearanceElementId.CodeDiff:
        return 'Code and diff appearance'
      case ProfileAppearanceElementId.SubmoduleBackButton:
        return 'Submodule Back button appearance'
      case ProfileAppearanceElementId.AppIdentity:
        return 'App identity appearance'
      case ProfileAppearanceElementId.DefaultRepositoryLogo:
        return 'Default repository logo appearance'
      default:
        return assertNever(id, `Unknown appearance element: ${id}`)
    }
  }

  private renderProfileAppearanceEditorContents(
    id: ProfileAppearanceElementId,
    showHistory: () => void
  ): JSX.Element | null {
    switch (id) {
      case ProfileAppearanceElementId.AppWorkspace: {
        const value = this.props.dispatcher.getProfileAppearanceElement(id)
        return (
          <AppWorkspaceAppearanceEditor
            value={value}
            onChange={this.onAppWorkspaceAppearanceChanged}
            onShowHistory={showHistory}
          />
        )
      }
      case ProfileAppearanceElementId.UpdateProgress: {
        const value = this.props.dispatcher.getProfileAppearanceElement(id)
        return (
          <UpdateProgressAppearanceEditor
            value={value}
            onChange={this.onUpdateProgressAppearanceChanged}
            onShowHistory={showHistory}
          />
        )
      }
      case ProfileAppearanceElementId.Toolbar: {
        const value = this.props.dispatcher.getProfileAppearanceElement(id)
        return (
          <ToolbarAppearanceEditor
            value={value}
            onChange={this.onToolbarAppearanceChanged}
            onShowHistory={showHistory}
          />
        )
      }
      case ProfileAppearanceElementId.RepositoryList: {
        const value = this.props.dispatcher.getProfileAppearanceElement(id)
        return (
          <RepositoryListAppearanceEditor
            value={value}
            onChange={this.onRepositoryListAppearanceChanged}
            onShowHistory={showHistory}
          />
        )
      }
      case ProfileAppearanceElementId.RepositoryTabs: {
        const current = this.props.dispatcher.getProfileAppearanceElement(id)
        return (
          <RepositoryTabsAppearanceEditor
            value={current}
            onChange={this.onRepositoryTabsAppearanceChanged}
            onShowHistory={showHistory}
          />
        )
      }
      case ProfileAppearanceElementId.CodeDiff: {
        const value = this.props.dispatcher.getProfileAppearanceElement(id)
        return (
          <CodeDiffAppearanceEditor
            value={value}
            onChange={this.onCodeDiffAppearanceChanged}
            onShowHistory={showHistory}
          />
        )
      }
      case ProfileAppearanceElementId.AppIdentity: {
        const value = this.props.dispatcher.getProfileAppearanceElement(id)
        return (
          <AppIdentityAppearanceEditor
            value={value}
            onChange={this.onAppIdentityAppearanceChanged}
            onShowHistory={showHistory}
          />
        )
      }
      case ProfileAppearanceElementId.DefaultRepositoryLogo: {
        const value = this.props.dispatcher.getProfileAppearanceElement(id)
        return (
          <DefaultRepositoryLogoAppearanceEditor
            value={value}
            onChange={this.onDefaultRepositoryLogoAppearanceChanged}
            onShowHistory={showHistory}
          />
        )
      }
      case ProfileAppearanceElementId.SubmoduleBackButton:
        return null
      default:
        return assertNever(id, `Unknown appearance element: ${id}`)
    }
  }

  private refreshFeatureAppearanceTarget = async () => {
    const target = this.appearanceEditorTarget
    if (
      target?.kind !== 'feature' ||
      target.profileKey !== this.props.dispatcher.getActiveProfileKey()
    ) {
      return
    }
    const value = await this.props.dispatcher.getFeatureAppearanceElement(
      target.featureId
    )
    if (target.profileKey !== this.props.dispatcher.getActiveProfileKey()) {
      return
    }
    this.applyFeatureAppearance(target.featureId, value.highlighted)
    if (this.appearanceEditorTarget === target && this.mounted) {
      this.appearanceEditorTarget = {
        ...target,
        highlighted: value.highlighted,
      }
      this.forceUpdate()
    }
  }

  private repositoryElementsAsLegacyOverrides(
    values: IRepositoryAppearanceElementSettings
  ): IRepositoryAppearanceOverrides {
    const workspace = values[RepositoryAppearanceElementId.Workspace]
    const toolbar = values[RepositoryAppearanceElementId.Toolbar]
    const tabs = values[RepositoryAppearanceElementId.Tabs]
    const listName = values[RepositoryAppearanceElementId.ListName]
    const logo = values[RepositoryAppearanceElementId.Logo]
    return {
      accentPalette: workspace.accentPalette ?? undefined,
      surfacePalette: workspace.surfacePalette ?? undefined,
      toolbarLabels: toolbar.toolbarLabels ?? undefined,
      toolbarDensity: toolbar.toolbarDensity ?? undefined,
      toolbarTextStyle: toolbar.toolbarTextStyle ?? undefined,
      tabDensity: tabs.tabDensity ?? undefined,
      tabWidth: tabs.tabWidth ?? undefined,
      listNameStyle: listName.style ?? undefined,
      repositoryLogo: logo.logo ?? undefined,
    }
  }

  private refreshRepositoryAppearanceTarget = async () => {
    const target = this.appearanceEditorTarget
    if (target?.kind !== 'repository') {
      return
    }
    const values = await this.mirrorRepositoryAppearance(target.repository)
    if (this.appearanceEditorTarget === target && this.mounted) {
      this.appearanceEditorTarget = { ...target, values }
      this.forceUpdate()
    }
  }

  private async mirrorRepositoryAppearance(
    repository: Repository
  ): Promise<IRepositoryAppearanceElementSettings> {
    const values = await this.props.dispatcher.getRepositoryAppearanceElements(
      repository
    )
    await this.props.dispatcher.setRepositoryAppearanceOverrides(
      repository,
      this.repositoryElementsAsLegacyOverrides(values)
    )
    return values
  }

  private setRepositoryAppearanceElement<
    K extends RepositoryAppearanceElementId
  >(
    target: RepositoryAppearanceEditorTarget,
    id: K,
    value: IRepositoryAppearanceElementSettings[K]
  ) {
    const values = { ...target.values, [id]: value }
    const next = { ...target, values }
    this.appearanceEditorTarget = next
    this.forceUpdate()
    void this.props.dispatcher
      .setRepositoryAppearanceElement(target.repository, id, value)
      .then(() => this.mirrorRepositoryAppearance(target.repository))
      .then(durableValues => {
        if (this.appearanceEditorTarget === next) {
          this.appearanceEditorTarget = {
            ...next,
            values: durableValues,
          }
          this.forceUpdate()
        }
      })
      .catch(error => this.props.dispatcher.postError(asError(error)))
  }

  private editProfileDefaultForRepositoryTarget(
    target: RepositoryAppearanceEditorTarget
  ) {
    const elementId =
      target.elementId === RepositoryAppearanceElementId.Workspace
        ? ProfileAppearanceElementId.AppWorkspace
        : target.elementId === RepositoryAppearanceElementId.Toolbar
        ? ProfileAppearanceElementId.Toolbar
        : ProfileAppearanceElementId.RepositoryTabs
    this.appearanceEditorTarget = {
      kind: 'profile',
      elementId,
      anchor: target.anchor,
      profileKey: target.profileKey,
    }
    this.forceUpdate()
  }

  private getActiveRepositoryAppearanceTarget(
    elementId: RepositoryAppearanceEditorTarget['elementId']
  ): RepositoryAppearanceEditorTarget | null {
    const target = this.appearanceEditorTarget
    return target?.kind === 'repository' && target.elementId === elementId
      ? target
      : null
  }

  private onRepositoryWorkspaceAppearanceChanged = (
    value: IRepositoryAppearanceElementSettings[typeof RepositoryAppearanceElementId.Workspace]
  ) => {
    const target = this.getActiveRepositoryAppearanceTarget(
      RepositoryAppearanceElementId.Workspace
    )
    if (target !== null) {
      this.setRepositoryAppearanceElement(
        target,
        RepositoryAppearanceElementId.Workspace,
        value
      )
    }
  }

  private onRepositoryToolbarAppearanceChanged = (
    value: IRepositoryAppearanceElementSettings[typeof RepositoryAppearanceElementId.Toolbar]
  ) => {
    const target = this.getActiveRepositoryAppearanceTarget(
      RepositoryAppearanceElementId.Toolbar
    )
    if (target !== null) {
      this.setRepositoryAppearanceElement(
        target,
        RepositoryAppearanceElementId.Toolbar,
        value
      )
    }
  }

  private onRepositoryTabsOverrideAppearanceChanged = (
    value: IRepositoryAppearanceElementSettings[typeof RepositoryAppearanceElementId.Tabs]
  ) => {
    const target = this.getActiveRepositoryAppearanceTarget(
      RepositoryAppearanceElementId.Tabs
    )
    if (target !== null) {
      this.setRepositoryAppearanceElement(
        target,
        RepositoryAppearanceElementId.Tabs,
        value
      )
    }
  }

  private onEditRepositoryProfileDefault = () => {
    const target = this.appearanceEditorTarget
    if (target?.kind === 'repository') {
      this.editProfileDefaultForRepositoryTarget(target)
    }
  }

  private renderRepositoryAppearanceEditor(
    target: RepositoryAppearanceEditorTarget,
    showHistory: () => void
  ): JSX.Element {
    switch (target.elementId) {
      case RepositoryAppearanceElementId.Workspace: {
        const inherited = this.props.dispatcher.getProfileAppearanceElement(
          ProfileAppearanceElementId.AppWorkspace
        )
        return (
          <RepositoryWorkspaceAppearanceEditor
            value={target.values[RepositoryAppearanceElementId.Workspace]}
            inherited={inherited}
            onChange={this.onRepositoryWorkspaceAppearanceChanged}
            onEditProfileDefault={this.onEditRepositoryProfileDefault}
            onShowHistory={showHistory}
          />
        )
      }
      case RepositoryAppearanceElementId.Toolbar: {
        const inherited = this.props.dispatcher.getProfileAppearanceElement(
          ProfileAppearanceElementId.Toolbar
        )
        return (
          <RepositoryToolbarAppearanceEditor
            value={target.values[RepositoryAppearanceElementId.Toolbar]}
            inherited={inherited}
            onChange={this.onRepositoryToolbarAppearanceChanged}
            onEditProfileDefault={this.onEditRepositoryProfileDefault}
            onShowHistory={showHistory}
          />
        )
      }
      case RepositoryAppearanceElementId.Tabs: {
        const inherited = this.props.dispatcher.getProfileAppearanceElement(
          ProfileAppearanceElementId.RepositoryTabs
        )
        return (
          <RepositoryTabsOverrideAppearanceEditor
            value={target.values[RepositoryAppearanceElementId.Tabs]}
            inherited={inherited}
            onChange={this.onRepositoryTabsOverrideAppearanceChanged}
            onEditProfileDefault={this.onEditRepositoryProfileDefault}
            onShowHistory={showHistory}
          />
        )
      }
      default:
        return assertNever(
          target.elementId,
          `Unknown repository appearance element: ${target.elementId}`
        )
    }
  }

  private onFeatureHighlightingAppearanceChanged = (
    value: IFeatureHighlightingAppearance
  ) => {
    const target = this.appearanceEditorTarget
    if (target?.kind !== 'feature') {
      return
    }

    this.applyFeatureAppearance(
      target.featureId,
      value.highlightDesktopMaterialFeatures
    )
    this.appearanceEditorTarget = {
      ...target,
      highlighted: value.highlightDesktopMaterialFeatures,
    }
    this.forceUpdate()
    void this.props.dispatcher
      .setFeatureAppearanceElement(
        target.featureId,
        value.highlightDesktopMaterialFeatures
      )
      .catch(error => this.props.dispatcher.postError(asError(error)))
  }

  private renderFeatureAppearanceEditorContents = (
    controls: IAnchoredAppearanceEditorControls
  ): React.ReactNode => {
    const target = this.appearanceEditorTarget
    if (target?.kind !== 'feature') {
      return null
    }

    return (
      <FeatureHighlightingAppearanceEditor
        value={{
          highlightDesktopMaterialFeatures: target.highlighted,
        }}
        onChange={this.onFeatureHighlightingAppearanceChanged}
        onShowHistory={controls.showHistory}
      />
    )
  }

  private renderRepositoryAppearanceEditorContents = (
    controls: IAnchoredAppearanceEditorControls
  ): React.ReactNode => {
    const target = this.appearanceEditorTarget
    return target?.kind === 'repository'
      ? this.renderRepositoryAppearanceEditor(target, controls.showHistory)
      : null
  }

  private renderProfileAppearanceEditorWithControls = (
    controls: IAnchoredAppearanceEditorControls
  ): React.ReactNode => {
    const target = this.appearanceEditorTarget
    return target?.kind === 'profile'
      ? this.renderProfileAppearanceEditorContents(
          target.elementId,
          controls.showHistory
        )
      : null
  }

  private getAppearanceEditorAnchorPosition(
    target: AppearanceEditorTarget
  ): PopoverAnchorPosition {
    const ownsToolbar =
      (target.kind === 'repository' &&
        target.elementId === RepositoryAppearanceElementId.Toolbar) ||
      (target.kind === 'profile' &&
        target.elementId === ProfileAppearanceElementId.Toolbar)

    return ownsToolbar
      ? PopoverAnchorPosition.BottomLeft
      : PopoverAnchorPosition.RightTop
  }

  private renderAppearanceEditor(): JSX.Element | null {
    const target = this.appearanceEditorTarget
    if (
      target === null ||
      !target.anchor.isConnected ||
      !this.props.dispatcher.isElementAppearanceCoordinatorReady() ||
      target.profileKey !== this.props.dispatcher.getActiveProfileKey()
    ) {
      return null
    }

    if (target.kind === 'repository') {
      const selectedRepository = this.getRepository()
      if (
        !(selectedRepository instanceof Repository) ||
        selectedRepository.id !== target.repository.id ||
        selectedRepository.path !== target.repository.path
      ) {
        return null
      }
    }

    if (target.kind === 'feature') {
      const historySource =
        this.props.dispatcher.getFeatureAppearanceHistorySource(
          target.featureId
        )
      const repositoryPath =
        this.props.dispatcher.getFeatureAppearanceRepositoryPath(
          target.featureId
        )
      return (
        <AnchoredAppearanceEditor
          title={`${target.label} appearance`}
          anchor={target.anchor}
          historySource={historySource}
          repositoryPath={repositoryPath}
          onClose={this.closeAppearanceEditor}
          onMutation={this.refreshFeatureAppearanceTarget}
          contentOwnsHeader={true}
          anchorPosition={this.getAppearanceEditorAnchorPosition(target)}
        >
          {this.renderFeatureAppearanceEditorContents}
        </AnchoredAppearanceEditor>
      )
    }

    if (target.kind === 'repository') {
      const title =
        target.elementId === RepositoryAppearanceElementId.Workspace
          ? 'Repository workspace appearance'
          : target.elementId === RepositoryAppearanceElementId.Toolbar
          ? 'Repository toolbar appearance'
          : 'Repository tabs appearance'
      return (
        <AnchoredAppearanceEditor
          title={title}
          anchor={target.anchor}
          historySource={target.historySource}
          repositoryPath={target.repositoryPath}
          onClose={this.closeAppearanceEditor}
          onMutation={this.refreshRepositoryAppearanceTarget}
          contentOwnsHeader={true}
          anchorPosition={this.getAppearanceEditorAnchorPosition(target)}
        >
          {this.renderRepositoryAppearanceEditorContents}
        </AnchoredAppearanceEditor>
      )
    }

    if (
      this.renderProfileAppearanceEditorContents(
        target.elementId,
        () => undefined
      ) === null
    ) {
      return null
    }
    const historySource =
      this.props.dispatcher.getProfileAppearanceHistorySource(target.elementId)
    const repositoryPath =
      this.props.dispatcher.getProfileAppearanceRepositoryPath(target.elementId)
    return (
      <AnchoredAppearanceEditor
        title={this.profileAppearanceTitle(target.elementId)}
        anchor={target.anchor}
        historySource={historySource}
        repositoryPath={repositoryPath}
        onClose={this.closeAppearanceEditor}
        contentOwnsHeader={true}
        anchorPosition={this.getAppearanceEditorAnchorPosition(target)}
      >
        {this.renderProfileAppearanceEditorWithControls}
      </AnchoredAppearanceEditor>
    )
  }

  private renderApp() {
    const selectedState = this.state.selectedState
    const repositoryBoundaryKey =
      selectedState === null
        ? `none:${this.state.repositories.length}`
        : `${selectedState.type}:${selectedState.repository.hash}`

    return (
      <div
        id="desktop-app-contents"
        className={this.getDesktopAppContentsClassNames()}
        data-customization-surface="app-workspace"
        data-customization-label="App workspace"
        data-customization-scope="profile"
      >
        {this.renderUpdateDownloadProgress()}
        {this.renderRepositoryTabStrip()}
        {this.renderToolbar()}
        {this.renderBanner()}
        {this.renderSubmoduleRepositoryContext()}
        <CrashProofBoundary
          name="Repository workspace"
          resetKey={repositoryBoundaryKey}
        >
          {this.renderRepository()}
        </CrashProofBoundary>
        <CrashProofBoundary
          name="Build runner"
          resetKey={repositoryBoundaryKey}
        >
          {this.renderBuildRunPanel()}
        </CrashProofBoundary>
        <CrashProofBoundary
          name="Notification center"
          resetKey={this.state.isNotificationCentreOpen ? 'open' : 'closed'}
        >
          {this.renderNotificationCentre()}
        </CrashProofBoundary>
        {this.renderAppearanceEditor()}
        {this.renderPopups()}
        {this.renderDragElement()}
        <div
          className="repository-drop-overlay"
          role="status"
          aria-live="polite"
        >
          <span className="repository-drop-overlay-icon">
            <Octicon symbol={octicons.repoPush} height={28} />
          </span>
          <strong>Drop repository folders to open tabs</strong>
          <span>
            Existing repositories switch instantly; new ones are added.
          </span>
        </div>
      </div>
    )
  }

  private renderUpdateDownloadProgress() {
    if (this.state.updateState.status !== UpdateStatus.UpdateAvailable) {
      return null
    }

    return (
      <div
        className="update-download-progress"
        role="progressbar"
        aria-label={t('update.downloadingLabel')}
        aria-valuetext={t('update.downloadingValue')}
      >
        <span />
      </div>
    )
  }

  private renderRepositoryList = (): JSX.Element => {
    const selectedRepository = this.state.selectedState
      ? this.state.selectedState.repository
      : null

    const { useCustomShell, selectedShell } = this.state
    const filterText = this.state.repositoryFilterText
    const repositories = this.state.repositories
    return (
      <RepositoriesList
        accounts={this.state.accounts}
        filterText={filterText}
        onFilterTextChanged={this.onRepositoryFilterTextChanged}
        selectedRepository={selectedRepository}
        onSelectionChanged={this.onSelectionChanged}
        repositories={repositories}
        recentRepositories={this.state.recentRepositories}
        showRecentRepositories={this.state.showRecentRepositories}
        showBranchNameInRepoList={this.state.showBranchNameInRepoList}
        repositoryListDensity={
          this.state.appearanceCustomization.repositoryListDensity
        }
        localRepositoryStateLookup={this.state.localRepositoryStateLookup}
        askForConfirmationOnRemoveRepository={
          this.state.askForConfirmationOnRepositoryRemoval
        }
        onRemoveRepository={this.removeRepository}
        onViewOnGitHub={this.viewOnGitHub}
        onForkRepository={this.forkRepository}
        onOpenInNewWindow={this.openRepositoryInNewWindow}
        onOpenInShell={this.openInShell}
        onShowRepository={this.showRepository}
        onOpenInExternalEditor={this.openInExternalEditor}
        externalEditorLabel={this.externalEditorLabel}
        shellLabel={useCustomShell ? undefined : selectedShell}
        dispatcher={this.props.dispatcher}
      />
    )
  }

  private viewOnGitHub = (
    repository: Repository | CloningRepository | null
  ) => {
    if (!(repository instanceof Repository)) {
      return
    }

    const url = getGitHubHtmlUrl(repository)

    if (url) {
      this.props.dispatcher.openInBrowser(url)
    }
  }

  private openInShell = (repository: Repository | CloningRepository) => {
    if (
      !(repository instanceof Repository) ||
      repository instanceof SubmoduleRepository
    ) {
      return
    }

    this.props.dispatcher.openShell(repository.path)
  }

  private openRepositoryInNewWindow = (
    repository: Repository | CloningRepository | null
  ) => {
    if (
      !(repository instanceof Repository) ||
      repository instanceof SubmoduleRepository ||
      repository.missing
    ) {
      return
    }
    openRepositoryInNewWindow(repository.path)
  }

  private openNewWindow = () => {
    const repository = this.getRepository()
    openRepositoryInNewWindow(
      repository instanceof Repository &&
        !(repository instanceof SubmoduleRepository) &&
        !repository.missing
        ? repository.path
        : null
    )
  }

  private openFileInExternalEditor = (fullPath: string) => {
    const repository = this.state.selectedState?.repository
    if (repository instanceof SubmoduleRepository) {
      return
    }
    this.props.dispatcher.openInExternalEditor(
      fullPath,
      repository instanceof Repository ? repository : null
    )
  }

  private openInExternalEditor = (
    repository: Repository | CloningRepository
  ) => {
    if (
      !(repository instanceof Repository) ||
      repository instanceof SubmoduleRepository
    ) {
      return
    }

    this.props.dispatcher.openInExternalEditor(repository.path, repository)
  }

  private openRepositoryInSelectedEditor = async (
    selectedEditor: string | null,
    customEditor: ICustomIntegration | null
  ) => {
    const repository = this.getRepository()
    if (
      !(repository instanceof Repository) ||
      repository instanceof SubmoduleRepository
    ) {
      return
    }

    await this.props.dispatcher.openInSelectedExternalEditor(
      repository.path,
      selectedEditor,
      customEditor
    )
  }

  private onOpenInExternalEditor = (path: string) => {
    const repository = this.state.selectedState?.repository
    if (repository === undefined || repository instanceof SubmoduleRepository) {
      return
    }

    const fullPath = Path.join(repository.path, path)
    this.props.dispatcher.openInExternalEditor(
      fullPath,
      repository instanceof Repository ? repository : null
    )
  }

  private showRepository = (repository: Repository | CloningRepository) => {
    if (!(repository instanceof Repository)) {
      return
    }

    shell.showFolderContents(repository.path)
  }

  private onRepositoryDropdownStateChanged = (newState: DropdownState) => {
    if (newState === 'open') {
      this.props.dispatcher.showFoldout({ type: FoldoutType.Repository })
    } else {
      this.props.dispatcher.closeFoldout(FoldoutType.Repository)
    }
  }

  private onExitTutorial = () => {
    if (
      this.state.repositories.length === 1 &&
      isValidTutorialStep(this.state.currentOnboardingTutorialStep)
    ) {
      // If the only repository present is the tutorial repo,
      // prompt for confirmation and exit to the BlankSlateView
      this.props.dispatcher.showPopup({
        type: PopupType.ConfirmExitTutorial,
      })
    } else {
      // Otherwise pop open repositories panel
      this.onRepositoryDropdownStateChanged('open')
    }
  }

  private renderRepositoryToolbarButton() {
    const selection = this.state.selectedState

    const repository = selection ? selection.repository : null

    let title: string
    if (repository) {
      const alias = repository instanceof Repository ? repository.alias : null
      title = alias ?? repository.name
    } else if (this.state.repositories.length > 0) {
      title = __DARWIN__ ? 'Select a Repository' : 'Select a repository'
    } else {
      title = __DARWIN__ ? 'No Repositories' : 'No repositories'
    }

    const isOpen =
      this.state.currentFoldout &&
      this.state.currentFoldout.type === FoldoutType.Repository

    const currentState: DropdownState = isOpen ? 'open' : 'closed'

    const tooltip = repository && !isOpen ? repository.path : undefined

    const foldoutWidth = clamp(this.state.sidebarWidth)

    const foldoutStyle: React.CSSProperties = {
      position: 'absolute',
      marginLeft: 0,
      width: foldoutWidth,
      minWidth: foldoutWidth,
      height: '100%',
      top: 0,
    }

    /** The dropdown focus trap will stop focus event propagation we made need
     * in some of our dialogs (noticed with Lists). Disabled this when dialogs
     * are open */
    const enableFocusTrap = this.state.currentPopup === null

    return (
      <ToolbarDropdown
        ref={this.repositoryDropdownRef}
        materialSymbol="book_2"
        materialSymbolSize={19}
        title={title}
        description={__DARWIN__ ? 'Current Repository' : 'Current repository'}
        tooltip={tooltip}
        foldoutStyle={foldoutStyle}
        onContextMenu={
          repository instanceof SubmoduleRepository
            ? undefined
            : this.onRepositoryToolbarButtonContextMenu
        }
        onDropdownStateChanged={this.onRepositoryDropdownStateChanged}
        dropdownContentRenderer={this.renderRepositoryList}
        dropdownState={currentState}
        enableFocusTrap={enableFocusTrap}
      />
    )
  }

  private onRepositoryToolbarButtonContextMenu = () => {
    const repository = this.state.selectedState?.repository
    if (repository === undefined || repository instanceof SubmoduleRepository) {
      return
    }

    const onChangeRepositoryAlias = (repository: Repository) => {
      this.props.dispatcher.showPopup({
        type: PopupType.ChangeRepositoryAlias,
        repository,
      })
    }

    const onRemoveRepositoryAlias = (repository: Repository) => {
      this.props.dispatcher.changeRepositoryAlias(repository, null)
    }

    const onChangeRepositoryGroupName = (repository: Repository) => {
      this.props.dispatcher.showPopup({
        type: PopupType.ChangeRepositoryGroupName,
        repository,
      })
    }

    const onRemoveRepositoryGroupName = (repository: Repository) => {
      this.props.dispatcher.changeRepositoryGroupName(repository, null)
    }

    const onCreateWorktree = (repository: Repository) => {
      this.props.dispatcher.showPopup({
        type: PopupType.AddWorktree,
        repository,
      })
    }

    const onShowWorktrees = () => {
      this.showWorktrees()
    }

    const items = generateRepositoryListContextMenu({
      accounts: this.state.accounts,
      onRemoveRepository: this.removeRepository,
      onShowRepository: this.showRepository,
      onOpenInShell: this.openInShell,
      onOpenInExternalEditor: this.openInExternalEditor,
      askForConfirmationOnRemoveRepository:
        this.state.askForConfirmationOnRepositoryRemoval,
      externalEditorLabel: this.getExternalEditorLabel(repository),
      onChangeRepositoryAlias: onChangeRepositoryAlias,
      onRemoveRepositoryAlias: onRemoveRepositoryAlias,
      onChangeRepositoryGroupName: onChangeRepositoryGroupName,
      onRemoveRepositoryGroupName: onRemoveRepositoryGroupName,
      onViewOnGitHub: this.viewOnGitHub,
      onForkRepository: this.forkRepository,
      onOpenInNewWindow: this.openRepositoryInNewWindow,
      onCreateWorktree: enableWorktreeSupport() ? onCreateWorktree : undefined,
      onShowWorktrees: enableWorktreeSupport() ? onShowWorktrees : undefined,
      repository: repository,
      shellLabel: this.state.useCustomShell
        ? undefined
        : this.state.selectedShell,
    })

    showContextualMenu(items)
  }

  private renderPushPullToolbarButton() {
    const selection = this.state.selectedState
    if (!selection || selection.type !== SelectionType.Repository) {
      return null
    }

    const state = selection.state
    const revertProgress = state.revertProgress
    if (revertProgress) {
      return (
        <RevertProgress
          progress={revertProgress}
          width={this.state.pushPullButtonWidth}
          dispatcher={this.props.dispatcher}
        />
      )
    }

    let remoteName = state.remote ? state.remote.name : null
    const progress = state.pushPullFetchProgress

    const { conflictState } = state.changesState

    const rebaseInProgress =
      conflictState !== null && conflictState.kind === 'rebase'

    const { aheadBehind, branchesState } = state
    const { pullWithRebase, tip } = branchesState

    if (tip.kind === TipState.Valid && tip.branch.upstreamRemoteName !== null) {
      remoteName = tip.branch.upstreamRemoteName

      if (tip.branch.upstreamWithoutRemote !== tip.branch.name) {
        remoteName = tip.branch.upstream
      }
    }

    const currentFoldout = this.state.currentFoldout

    const isDropdownOpen =
      currentFoldout !== null && currentFoldout.type === FoldoutType.PushPull

    const forcePushBranchState = getCurrentBranchForcePushState(
      branchesState,
      aheadBehind
    )

    /** The dropdown focus trap will stop focus event propagation we made need
     * in some of our dialogs (noticed with Lists). Disabled this when dialogs
     * are open */
    const enableFocusTrap = this.state.currentPopup === null

    return (
      <PushPullButton
        dispatcher={this.props.dispatcher}
        repository={selection.repository}
        aheadBehind={state.aheadBehind}
        numTagsToPush={state.tagsToPush !== null ? state.tagsToPush.length : 0}
        remoteName={remoteName}
        lastFetched={state.lastFetched}
        networkActionInProgress={state.isPushPullFetchInProgress}
        progress={progress}
        tipState={tip.kind}
        pullWithRebase={pullWithRebase}
        rebaseInProgress={rebaseInProgress}
        forcePushBranchState={forcePushBranchState}
        shouldNudge={
          this.state.currentOnboardingTutorialStep === TutorialStep.PushBranch
        }
        isDropdownOpen={isDropdownOpen}
        askForConfirmationOnForcePush={this.state.askForConfirmationOnForcePush}
        onDropdownStateChanged={this.onPushPullDropdownStateChanged}
        enableFocusTrap={enableFocusTrap}
        pushPullButtonWidth={this.state.pushPullButtonWidth}
      />
    )
  }

  private showCreateBranch = () => {
    const selection = this.state.selectedState

    // NB: This should never happen but in the case someone
    // manages to delete the last repository while the drop down is
    // open we'll just bail here.
    if (!selection || selection.type !== SelectionType.Repository) {
      return
    }

    // We explicitly disable the menu item in this scenario so this
    // should never happen.
    if (selection.state.branchesState.tip.kind === TipState.Unknown) {
      return
    }

    const repository = selection.repository

    return this.props.dispatcher.showPopup({
      type: PopupType.CreateBranch,
      repository,
    })
  }

  private openPullRequest = () => {
    const state = this.state.selectedState

    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    const currentPullRequest = state.state.branchesState.currentPullRequest
    const dispatcher = this.props.dispatcher

    if (currentPullRequest == null) {
      dispatcher.createPullRequest(state.repository)
      dispatcher.incrementMetric('createPullRequestCount')
    } else {
      dispatcher.showPullRequest(state.repository)
    }
  }

  private startPullRequest = () => {
    const state = this.state.selectedState

    if (state == null || state.type !== SelectionType.Repository) {
      return
    }

    this.props.dispatcher.startPullRequest(state.repository)
  }

  private showCreatePullRequest = (
    repository: Repository,
    branch: Branch,
    baseBranch?: Branch
  ): Promise<void> => {
    return this.props.dispatcher.continueCreatePullRequest(
      repository,
      branch,
      baseBranch
    )
  }

  private onPushPullDropdownStateChanged = (newState: DropdownState) => {
    if (newState === 'open') {
      this.props.dispatcher.showFoldout({ type: FoldoutType.PushPull })
    } else {
      this.props.dispatcher.closeFoldout(FoldoutType.PushPull)
    }
  }

  private onBranchDropdownStateChanged = (newState: DropdownState) => {
    if (newState === 'open') {
      this.props.dispatcher.showFoldout({ type: FoldoutType.Branch })
    } else {
      this.props.dispatcher.closeFoldout(FoldoutType.Branch)
    }
  }

  private onWorktreeDropdownStateChanged = (newState: DropdownState) => {
    if (newState === 'open') {
      this.props.dispatcher.showFoldout({ type: FoldoutType.Worktree })
    } else {
      this.props.dispatcher.closeFoldout(FoldoutType.Worktree)
    }
  }

  private renderBranchToolbarButton(): JSX.Element | null {
    const selection = this.state.selectedState

    if (selection == null || selection.type !== SelectionType.Repository) {
      return null
    }

    const currentFoldout = this.state.currentFoldout

    const isOpen =
      currentFoldout !== null && currentFoldout.type === FoldoutType.Branch

    const repository = selection.repository
    const { branchesState } = selection.state

    /** The dropdown focus trap will stop focus event propagation we made need
     * in some of our dialogs (noticed with Lists). Disabled this when dialogs
     * are open */
    const enableFocusTrap = this.state.currentPopup === null

    return (
      <BranchDropdown
        dispatcher={this.props.dispatcher}
        isOpen={isOpen}
        branchDropdownWidth={this.state.branchDropdownWidth}
        onDropDownStateChanged={this.onBranchDropdownStateChanged}
        repository={repository}
        repositoryState={selection.state}
        selectedTab={this.state.selectedBranchesTab}
        pullRequests={branchesState.openPullRequests}
        currentPullRequest={branchesState.currentPullRequest}
        isLoadingPullRequests={branchesState.isLoadingPullRequests}
        shouldNudge={
          this.state.currentOnboardingTutorialStep === TutorialStep.CreateBranch
        }
        showCIStatusPopover={this.state.showCIStatusPopover}
        emoji={this.state.emoji}
        enableFocusTrap={enableFocusTrap}
        underlineLinks={this.state.underlineLinks}
        branchSortOrder={this.state.branchSortOrder}
      />
    )
  }

  private renderWorktreeToolbarButton(): JSX.Element | null {
    if (!enableWorktreeSupport()) {
      return null
    }

    const selection = this.state.selectedState

    if (
      selection == null ||
      selection.type !== SelectionType.Repository ||
      selection.repository instanceof SubmoduleRepository
    ) {
      return null
    }

    const { worktrees } = selection.state

    const currentFoldout = this.state.currentFoldout

    const isOpen =
      currentFoldout !== null && currentFoldout.type === FoldoutType.Worktree

    // Only show the worktree dropdown when there are linked worktrees or if the
    // foldout is open. This allows the user to create a worktree from the app
    // menu even when there are no worktrees.
    if (worktrees.length <= 1 && !isOpen) {
      return null
    }

    const repository = selection.repository

    const enableFocusTrap = this.state.currentPopup === null

    return (
      <WorktreeDropdown
        dispatcher={this.props.dispatcher}
        repository={repository}
        worktrees={worktrees}
        isOpen={isOpen}
        onDropDownStateChanged={this.onWorktreeDropdownStateChanged}
        enableFocusTrap={enableFocusTrap}
        worktreeDropdownWidth={this.state.worktreeDropdownWidth}
      />
    )
  }

  // we currently only render one banner at a time
  private renderBanner(): JSX.Element | null {
    // The inset light title bar style without the toolbar
    // can't support banners at the moment. So for the
    // no-repositories blank slate we'll have to live without
    // them.
    if (this.inNoRepositoriesViewState()) {
      return null
    }

    let banner = null
    if (this.state.currentBanner !== null) {
      banner = renderBanner(
        this.state.currentBanner,
        this.props.dispatcher,
        this.onBannerDismissed
      )
    } else if (
      this.state.isUpdateAvailableBannerVisible ||
      this.state.isUpdateShowcaseVisible
    ) {
      banner = this.renderUpdateBanner()
    }
    return (
      <div role="alert" aria-atomic="false">
        <TransitionGroup>
          {banner && (
            <CSSTransition
              classNames="banner"
              timeout={bannerTransitionTimeout}
            >
              {banner}
            </CSSTransition>
          )}
        </TransitionGroup>
      </div>
    )
  }

  private renderUpdateBanner() {
    return (
      <UpdateAvailable
        dispatcher={this.props.dispatcher}
        newReleases={updateStore.state.newReleases}
        isX64ToARM64ImmediateAutoUpdate={
          updateStore.state.isX64ToARM64ImmediateAutoUpdate
        }
        prioritizeUpdate={updateStore.state.prioritizeUpdate}
        prioritizeUpdateInfoUrl={updateStore.state.prioritizeUpdateInfoUrl}
        onDismissed={this.onUpdateAvailableDismissed}
        isUpdateShowcaseVisible={this.state.isUpdateShowcaseVisible}
        emoji={this.state.emoji}
        key={'update-available'}
      />
    )
  }

  private onBannerDismissed = () => {
    this.props.dispatcher.clearBanner()
  }

  private renderToolbar() {
    /**
     * No toolbar if we're in the blank slate view.
     */
    if (this.inNoRepositoriesViewState()) {
      return null
    }

    const width = clamp(this.state.sidebarWidth)

    return (
      <Toolbar id="desktop-app-toolbar" ariaLabel="Repository controls">
        <ToolbarItem
          id="repository"
          preferredWidth={220}
          canGrow={true}
          className="sidebar-section"
          style={{ width }}
          overflowLabel="Current repository"
          overflowSymbol="book_2"
        >
          {this.renderRepositoryToolbarButton()}
        </ToolbarItem>
        <ToolbarItem
          id="worktree"
          preferredWidth={220}
          canGrow={true}
          overflowLabel="Worktrees"
          overflowSymbol="account_tree"
        >
          {this.renderWorktreeToolbarButton()}
        </ToolbarItem>
        <ToolbarItem
          id="branch"
          preferredWidth={190}
          canGrow={true}
          overflowLabel="Current branch"
          overflowSymbol="alt_route"
        >
          {this.renderBranchToolbarButton()}
        </ToolbarItem>
        <ToolbarItem
          id="sync"
          preferredWidth={210}
          overflowLabel="Push, pull, and fetch"
          overflowSymbol="sync"
        >
          {this.renderPushPullToolbarButton()}
        </ToolbarItem>
        <ToolbarItem
          id="one-click-commit-push"
          preferredWidth={180}
          overflowPriority={2}
          desktopMaterialFeature={true}
          renderOverflow={this.renderOneClickCommitPushOverflowButton}
        >
          {this.renderOneClickCommitPushButton()}
        </ToolbarItem>
        <ToolbarItem
          id="build-run"
          preferredWidth={210}
          overflowPriority={1}
          desktopMaterialFeature={true}
          renderOverflow={this.renderBuildRunToolbarOverflowButton}
        >
          {this.renderBuildRunToolbarButton()}
        </ToolbarItem>
        <ToolbarItem
          id="theme-toggle"
          preferredWidth={54}
          desktopMaterialFeature={true}
          overflowLabel="Toggle light and dark theme"
          overflowSymbol="light_mode"
        >
          <ThemeToggleButton
            dispatcher={this.props.dispatcher}
            selectedTheme={this.state.selectedTheme}
            currentTheme={this.state.currentTheme}
          />
        </ToolbarItem>
      </Toolbar>
    )
  }

  private renderBuildRunToolbarButton() {
    const selection = this.state.selectedState
    if (
      !selection ||
      selection.type !== SelectionType.Repository ||
      selection.repository instanceof SubmoduleRepository
    ) {
      return null
    }

    return (
      <BuildRunToolbarButton
        key={selection.repository.id}
        repository={selection.repository}
        dispatcher={this.props.dispatcher}
        buildRunStore={this.props.buildRunStore}
      />
    )
  }

  private renderBuildRunToolbarOverflowButton = () =>
    this.renderBuildRunToolbarButton()

  private renderOneClickCommitPushButton() {
    const selection = this.state.selectedState
    if (!selection || selection.type !== SelectionType.Repository) {
      return null
    }
    const state = selection.state
    const tip = state.branchesState.tip
    const message = state.changesState.commitMessage
    const guard = canAutoCommitPush({
      tipIsValid: tip.kind === TipState.Valid,
      hasChanges: state.changesState.workingDirectory.files.length > 0,
      hasConflict: state.changesState.conflictState !== null,
      hasMultiCommitOperation: state.multiCommitOperationState !== null,
      isCommitting: state.isCommitting,
      isGeneratingCommitMessage: state.isGeneratingCommitMessage,
      isPushPullFetchInProgress: state.isPushPullFetchInProgress,
      isCheckingOut: state.checkoutProgress !== null,
      hasDraftCommitMessage:
        message.summary.trim().length > 0 ||
        (message.description?.trim().length ?? 0) > 0,
      hasUpstream:
        tip.kind === TipState.Valid && tip.branch.upstreamRemoteName !== null,
      mergeHeadSet: false,
    })
    return (
      <OneClickCommitPushButton
        repository={selection.repository}
        dispatcher={this.props.dispatcher}
        phase={state.oneClickCommitPushPhase}
        disabledReason={guard.safe ? null : guard.reason}
      />
    )
  }

  private renderOneClickCommitPushOverflowButton = () =>
    this.renderOneClickCommitPushButton()

  private renderBuildRunPanel() {
    const selection = this.state.selectedState
    if (
      !selection ||
      selection.type !== SelectionType.Repository ||
      selection.repository instanceof SubmoduleRepository
    ) {
      return null
    }

    return (
      <BuildRunPanel
        key={selection.repository.id}
        repository={selection.repository}
        dispatcher={this.props.dispatcher}
        buildRunStore={this.props.buildRunStore}
      />
    )
  }

  private renderRepository() {
    const { accounts } = this.state

    if (this.inNoRepositoriesViewState()) {
      return (
        <NoRepositoriesView
          accounts={accounts}
          onCreate={this.showCreateRepository}
          onClone={this.showCloneRepo}
          onAdd={this.showAddLocalRepo}
          onCreateTutorialRepository={this.showCreateTutorialRepositoryPopup}
          onResumeTutorialRepository={this.onResumeTutorialRepository}
          tutorialPaused={this.isTutorialPaused()}
          apiRepositories={this.state.apiRepositories}
          onRefreshRepositories={this.onRefreshRepositories}
          onShowRepositorySubmodules={this.onShowRepositorySubmodules}
        />
      )
    }

    const state = this.state

    const selectedState = state.selectedState
    if (!selectedState) {
      return <NoRepositorySelected />
    }

    if (selectedState.type === SelectionType.Repository) {
      return (
        <RepositoryView
          ref={this.repositoryViewRef}
          // When switching repositories we want to remount the RepositoryView
          // component to reset the scroll positions.
          key={selectedState.repository.hash}
          repository={selectedState.repository}
          state={selectedState.state}
          dispatcher={this.props.dispatcher}
          emoji={state.emoji}
          sidebarWidth={state.sidebarWidth}
          commitSummaryWidth={state.commitSummaryWidth}
          stashedFilesWidth={state.stashedFilesWidth}
          issuesStore={this.props.issuesStore}
          gitHubUserStore={this.props.gitHubUserStore}
          onViewCommitOnGitHub={this.onViewCommitOnGitHub}
          imageDiffType={state.imageDiffType}
          hideWhitespaceInChangesDiff={state.hideWhitespaceInChangesDiff}
          hideWhitespaceInHistoryDiff={state.hideWhitespaceInHistoryDiff}
          showDiffCheckMarks={state.showDiffCheckMarks}
          preferAbsoluteDates={state.preferAbsoluteDates}
          showSideBySideDiff={state.showSideBySideDiff}
          focusCommitMessage={state.focusCommitMessage}
          askForConfirmationOnDiscardChanges={
            state.askForConfirmationOnDiscardChanges
          }
          askForConfirmationOnDiscardStash={
            state.askForConfirmationOnDiscardStash
          }
          askForConfirmationOnCheckoutCommit={
            state.askForConfirmationOnCheckoutCommit
          }
          askForConfirmationOnCommitFilteredChanges={
            state.askForConfirmationOnCommitFilteredChanges
          }
          accounts={state.accounts}
          isExternalEditorAvailable={
            state.useCustomEditor || state.selectedExternalEditor !== null
          }
          externalEditorLabel={this.externalEditorLabel}
          resolvedExternalEditor={state.resolvedExternalEditor}
          onOpenInExternalEditor={this.onOpenInExternalEditor}
          appMenu={state.appMenuState[0]}
          currentTutorialStep={state.currentOnboardingTutorialStep}
          onExitTutorial={this.onExitTutorial}
          isShowingModal={this.isShowingModal}
          isShowingFoldout={this.state.currentFoldout !== null}
          aheadBehindStore={this.props.aheadBehindStore}
          commitSpellcheckEnabled={this.state.commitSpellcheckEnabled}
          showCommitLengthWarning={this.state.showCommitLengthWarning}
          onCherryPick={this.startCherryPickWithoutBranch}
          pullRequestSuggestedNextAction={state.pullRequestSuggestedNextAction}
          showChangesFilter={state.showChangesFilter}
          shouldShowGenerateCommitMessageCallOut={
            !this.state.commitMessageGenerationButtonClicked
          }
          skipCommitHooks={selectedState.state.skipCommitHooks}
          signOffCommits={selectedState.state.signOffCommits}
          allowEmptyCommit={selectedState.state.allowEmptyCommit}
          onUpdateCommitOptions={this.onUpdateCommitOptions}
          actionsStore={this.props.actionsStore}
          releasesStore={this.props.releasesStore}
          issueWorkflowsStore={this.props.issueWorkflowsStore}
        />
      )
    } else if (selectedState.type === SelectionType.CloningRepository) {
      return (
        <CloningRepositoryView
          repository={selectedState.repository}
          progress={selectedState.progress}
        />
      )
    } else if (selectedState.type === SelectionType.MissingRepository) {
      return (
        <MissingRepository
          repository={selectedState.repository}
          dispatcher={this.props.dispatcher}
        />
      )
    } else {
      return assertNever(selectedState, `Unknown state: ${selectedState}`)
    }
  }

  private renderWelcomeFlow() {
    return (
      <Welcome
        dispatcher={this.props.dispatcher}
        accounts={this.state.accounts}
        signInState={this.state.signInState}
      />
    )
  }

  private renderFirstRunChecklist() {
    if (this.state.showWelcomeFlow || !this.showFirstRunChecklist) {
      return null
    }

    return (
      <FirstRunChecklist
        dispatcher={this.props.dispatcher}
        accountsCount={this.state.accounts.length}
        repositoryCount={this.state.repositories.length}
        selectedTheme={this.state.selectedTheme}
      />
    )
  }

  private reloadAppWindow = () => window.location.reload()

  public render() {
    if (this.loading) {
      return null
    }

    if (this.initializationError !== null) {
      return (
        <section
          className="crash-proof-boundary crash-proof-boundary-root"
          role="alert"
          aria-live="assertive"
        >
          <div className="crash-proof-boundary-card">
            <p className="crash-proof-boundary-eyebrow">Startup contained</p>
            <h1>Desktop Material could not finish starting</h1>
            <p>
              The app stopped safely before showing incomplete data. Your
              repositories and durable background work were not modified.
            </p>
            <p className="crash-proof-boundary-message">
              A saved setting or local cache could not be loaded. Reload the app
              window after repairing or restoring the affected data.
            </p>
            <div className="crash-proof-boundary-actions">
              <Button type="button" onClick={this.reloadAppWindow}>
                Reload app window
              </Button>
            </div>
          </div>
        </section>
      )
    }

    const className = classNames(
      this.state.appIsFocused ? 'focused' : 'blurred',
      {
        'underline-links': this.state.underlineLinks,
      }
    )

    const currentTheme = this.state.showWelcomeFlow
      ? ApplicationTheme.Light
      : this.state.currentTheme

    const currentTabSize = this.state.selectedTabSize
    const appearance = resolveAppearanceCustomization(
      this.state.appearanceCustomization,
      this.state.repositoryAppearanceOverrides
    )

    return (
      <div
        id="desktop-app-chrome"
        className={className}
        style={{ tabSize: currentTabSize }}
      >
        <AppTheme theme={currentTheme} appearance={appearance} />
        <ButtonHints />
        {this.renderTitlebar()}
        {this.state.showWelcomeFlow
          ? this.renderWelcomeFlow()
          : this.renderApp()}
        {this.renderFirstRunChecklist()}
        {this.renderErrorNotices()}
        {this.renderZoomInfo()}
        {this.renderFullScreenInfo()}
      </div>
    )
  }

  private onRepositoryFilterTextChanged = (text: string) => {
    this.props.dispatcher.setRepositoryFilterText(text)
  }

  private onSelectionChanged = (repository: Repository | CloningRepository) => {
    this.props.dispatcher.selectRepository(repository)
    this.props.dispatcher.closeFoldout(FoldoutType.Repository)
  }

  private onViewCommitOnGitHub = async (SHA: string, filePath?: string) => {
    const repository = this.getRepository()

    if (
      !repository ||
      repository instanceof CloningRepository ||
      !repository.gitHubRepository
    ) {
      return
    }

    const commitURL = createCommitURL(
      repository.gitHubRepository,
      SHA,
      filePath
    )

    if (commitURL === null) {
      return
    }

    this.props.dispatcher.openInBrowser(commitURL)
  }

  private onBranchDeleted = (repository: Repository) => {
    // In the event a user is in the middle of a compare
    // we need to exit out of the compare state after the
    // branch has been deleted. Calling executeCompare allows
    // us to do just that.
    this.props.dispatcher.executeCompare(repository, {
      kind: HistoryTabMode.History,
    })
  }

  private inNoRepositoriesViewState() {
    return this.state.repositories.length === 0 || this.isTutorialPaused()
  }

  private isTutorialPaused() {
    return this.state.currentOnboardingTutorialStep === TutorialStep.Paused
  }

  /**
   * When starting cherry pick from context menu, we need to initialize the
   * cherry pick state flow step with the ChooseTargetBranch as opposed
   * to drag and drop which will start at the ShowProgress step.
   *
   * Step initialization must be done before and outside of the
   * `currentPopupContent` method because it is a rendering method that is
   * re-run on every update. It will just keep showing the step initialized
   * there otherwise - not allowing for other flow steps.
   */
  private startCherryPickWithoutBranch = (
    repository: Repository,
    commits: ReadonlyArray<CommitOneLine>
  ) => {
    const repositoryState = this.props.repositoryStateManager.get(repository)

    const { tip } = repositoryState.branchesState
    let currentBranch: Branch | null = null

    if (tip.kind === TipState.Valid) {
      currentBranch = tip.branch
    } else {
      throw new Error(
        'Tip is not in a valid state, which is required to start the cherry-pick flow'
      )
    }

    this.props.dispatcher.initializeMultiCommitOperation(
      repository,
      {
        kind: MultiCommitOperationKind.CherryPick,
        sourceBranch: currentBranch,
        branchCreated: false,
        commits,
      },
      null,
      commits,
      tip.branch.tip.sha
    )

    const initialStep = getMultiCommitOperationChooseBranchStep(repositoryState)

    this.props.dispatcher.setMultiCommitOperationStep(repository, initialStep)
    this.props.dispatcher.incrementMetric('cherryPickViaContextMenuCount')

    this.showPopup({
      type: PopupType.MultiCommitOperation,
      repository,
    })
  }

  /**
   * Check if the user signed into their dotCom account has been tagged in
   * our release notes or if they already have received a thank you card.
   *
   * Notes: A user signed into a GHE account should not be contributing to
   * Desktop as that account should be used for GHE repos. Tho, technically it
   * is possible through commit misattribution and we are intentionally ignoring
   * this scenario as it would be expected any misattributed commit would not
   * be able to be detected.
   */
  private async checkIfThankYouIsInOrder(): Promise<void> {
    const dotComAccount = this.state.accounts.find(isDotComAccount)
    if (!dotComAccount) {
      // The user is not signed in or is a GHE user who should not have any.
      return
    }

    const { lastThankYou } = this.state
    const { login } = dotComAccount
    if (hasUserAlreadyBeenCheckedOrThanked(lastThankYou, login, getVersion())) {
      return
    }

    const isOnlyLastRelease =
      lastThankYou !== undefined && lastThankYou.checkedUsers.includes(login)
    const userContributions = await getUserContributions(
      isOnlyLastRelease,
      login
    )
    if (userContributions === null) {
      // This will prevent unnecessary release note retrieval on every time the
      // app is opened for a non-contributor.
      updateLastThankYou(
        this.props.dispatcher,
        lastThankYou,
        login,
        getVersion()
      )
      return
    }

    // If this is the first time user has seen the card, we want to thank them
    // for all previous versions. Thus, only specify current version if they
    // have been thanked before.
    const displayVersion = isOnlyLastRelease ? getVersion() : null
    const banner: Banner = {
      type: BannerType.OpenThankYouCard,
      // Grab emoji's by reference because we could still be loading emoji's
      emoji: this.state.emoji,
      onOpenCard: () =>
        this.openThankYouCard(userContributions, displayVersion, dotComAccount),
      onThrowCardAway: () => {
        updateLastThankYou(
          this.props.dispatcher,
          lastThankYou,
          login,
          getVersion()
        )
      },
    }
    this.setBanner(banner)
  }

  private openThankYouCard = (
    userContributions: ReadonlyArray<ReleaseNote>,
    latestVersion: string | null = null,
    account: Account
  ) => {
    const { friendlyName } = account

    this.props.dispatcher.showPopup({
      type: PopupType.ThankYou,
      userContributions,
      friendlyName,
      latestVersion,
    })
  }

  private onDragEnd = (dropTargetSelector: DropTargetSelector | undefined) => {
    this.props.dispatcher.closeFoldout(FoldoutType.Branch)
    if (dropTargetSelector === undefined) {
      this.props.dispatcher.incrementMetric('dragStartedAndCanceledCount')
    }
  }
}

function NoRepositorySelected() {
  return <div className="panel blankslate">No repository selected</div>
}
