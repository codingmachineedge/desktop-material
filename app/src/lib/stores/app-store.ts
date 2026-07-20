import * as Path from 'path'
import { writeFile } from 'fs/promises'
import {
  AccountsStore,
  BatchCloneStore,
  selectRegisteredBatchClonePaths,
  CloningRepositoriesStore,
  CopilotStore,
  GitHubUserStore,
  GitStore,
  IssuesStore,
  PullRequestCoordinator,
  RepositoriesStore,
  SignInResult,
  SignInStore,
  UpstreamRemoteName,
} from '.'
import type { CopilotFeature, CopilotModelSelections } from './copilot-store'
import { CommitMessageGenerationCancelledError } from './copilot-store'
import { FileBatchCloneStagingManager } from './batch-clone-staging'
import {
  getGitHubReleasesAccount,
  getGitHubReleasesAvailability,
  GitHubReleasesError,
  GitHubReleasesStore,
} from './github-releases-store'
import {
  autoPinLargeFilesForCommit,
  defaultCheapLfsFileSystem,
  ICheapLfsAutoPinnedFile,
  ICheapLfsMaterializeResult,
  ICheapLfsPinOptions,
  ICheapLfsPinResult,
  ICheapLfsPointerEntry,
  listCheapLfsPointers,
  materializeCheapLfsPointers,
  materializePointer,
  pinFileToRelease,
  shouldAutoMaterializeCheapLfs,
  shouldAutoPinLargeFilesOnCommit,
} from '../cheap-lfs/operations'
import { CheapLfsPinThresholdBytes } from '../large-files'
import { IGitHubRelease } from '../github-releases'
import { IGitHubReleaseTransferProgressEvent } from '../github-release-transfer'
import {
  IBYOKProvider,
  loadBYOKProviders,
  saveBYOKProviders,
  setBYOKSecret,
  deleteBYOKSecret,
  getBYOKSecret,
  parseModelKey,
} from '../copilot/byok'
import { getConflictResolutionModelDisplay } from '../copilot/conflict-resolution-model'
import type {
  CopilotModelRequest,
  CopilotProviderConfig,
} from './copilot-store'
import { Account, getAccountKey, isDotComAccount } from '../../models/account'
import { AppMenu, IMenu } from '../../models/app-menu'
import { Author } from '../../models/author'
import { Branch, BranchType, IAheadBehind } from '../../models/branch'
import { BranchesTab } from '../../models/branches-tab'
import {
  BranchSortOrder,
  DefaultBranchSortOrder,
} from '../../models/branch-sort-order'
import {
  IAppearanceCustomization,
  IRepositoryAppearanceOverrides,
  normalizeAppearanceCustomization,
} from '../../models/appearance-customization'
import { CloneRepositoryTab } from '../../models/clone-repository-tab'
import type { CloneOptions } from '../../models/clone-options'
import { CloningRepository } from '../../models/cloning-repository'
import {
  getPreferAbsoluteDates,
  setPreferAbsoluteDates,
} from '../../models/formatting-preferences'
import {
  Commit,
  ICommitContext,
  CommitOneLine,
  shortenSHA,
} from '../../models/commit'
import {
  DiffSelection,
  DiffSelectionType,
  DiffType,
  ImageDiffType,
  ITextDiff,
} from '../../models/diff'
import { FetchType } from '../../models/fetch'
import {
  GitHubRepository,
  hasWritePermission,
} from '../../models/github-repository'
import {
  defaultPullRequestSuggestedNextAction,
  PullRequest,
  PullRequestSuggestedNextAction,
} from '../../models/pull-request'
import {
  forkPullRequestRemoteName,
  IRemote,
  IRemoteManagementPlan,
  IRemoteManagementSnapshot,
  remoteEquals,
} from '../../models/remote'
import {
  ILocalRepositoryState,
  nameOf,
  Repository,
  isRepositoryWithGitHubRepository,
  RepositoryWithGitHubRepository,
  getNonForkGitHubRepository,
  isForkedRepositoryContributingToParent,
  isSubmoduleRepository,
  SubmoduleRepository,
} from '../../models/repository'
import {
  buildGitHubPullRequestTargets,
  getGitHubPullRequestBaseBranchName,
  getGitHubPullRequestCreationURL,
  getGitHubPullRequestContextVersion,
  resolveRefreshedGitHubPullRequestBranch,
} from '../github-pull-request'
import {
  CommittedFileChange,
  WorkingDirectoryFileChange,
  WorkingDirectoryStatus,
  AppFileStatusKind,
} from '../../models/status'
import { TipState, tipEquals, IValidBranch } from '../../models/tip'
import {
  DefaultCommitMessage,
  ICommitMessage,
} from '../../models/commit-message'
import {
  Progress,
  ICheckoutProgress,
  IFetchProgress,
  IRevertProgress,
  IMultiCommitOperationProgress,
} from '../../models/progress'
import { Popup, PopupType } from '../../models/popup'
import { themeChangeMonitor } from '../../ui/lib/theme-change-monitor'
import { getAppPath } from '../../ui/lib/app-proxy'
import {
  ApplicableTheme,
  ApplicationTheme,
  getCurrentlyAppliedTheme,
  getPersistedThemeName,
  setPersistedTheme,
} from '../../ui/lib/application-theme'
import {
  getAppMenu,
  getCurrentWindowState,
  getCurrentWindowZoomFactor,
  updatePreferredAppMenuItemLabels,
  updateAccounts,
  setWindowZoomFactor,
  onShowInstallingUpdate,
  sendWillQuitEvenIfUpdatingSync,
  quitApp,
  sendCancelQuittingSync,
  sendVerboseLoggingEnabled,
  showOpenDialog,
  runNotificationAutomationWebhook,
  runNotificationAutomationCommand,
} from '../../ui/main-process-proxy'
import {
  resetRendererShutdown,
  runAfterRendererShutdown,
} from '../../ui/lib/renderer-shutdown'
import {
  API,
  getAccountForEndpoint,
  getHTMLURL,
  IAPIOrganization,
  IAPIFullRepository,
  IAPIComment,
  IAPIRepoRuleset,
  deleteToken,
  IAPICreatePushProtectionBypassResponse,
} from '../api'
import {
  missingRequiredScopes,
  parseGrantedScopes,
} from '../oauth-scope-validation'
import { findAccountForRemoteURL } from '../find-account'
import { shell } from '../app-shell'
import {
  CompareAction,
  HistoryScope,
  HistoryTabMode,
  Foldout,
  FoldoutType,
  IAppState,
  ICompareBranch,
  ICompareFormUpdate,
  ICompareToBranch,
  IDisplayHistory,
  PossibleSelections,
  RepositorySectionTab,
  SelectionType,
  IRepositoryState,
  ChangesSelectionKind,
  ChangesWorkingDirectorySelection,
  isRebaseConflictState,
  isCherryPickConflictState,
  IFileListFilterState,
  isMergeConflictState,
  IMultiCommitOperationState,
  ConflictState,
  IConstrainedValue,
  ICompareState,
  IChangesState,
  CommitOptions,
  OneClickCommitPushPhase,
} from '../app-state'
import {
  findEditorOrDefault,
  getAvailableEditors,
  launchCustomExternalEditor,
  launchExternalEditor,
  launchAndReturnStdout,
} from '../editors'
import { assertNever, fatalError, forceUnwrap } from '../fatal-error'
import {
  IBranchNamePreset,
  parseBranchNamePresets,
} from '../../models/branch-preset'

import { formatCommitMessage } from '../format-commit-message'
import {
  getAccountForCommitMessageGeneration,
  getAccountForCopilotConflictResolution,
  getAccountForRepository,
  getRepositoryOwnerAccountToPromote,
} from '../get-account-for-repository'
import { getForkRepositoryEligibility } from '../fork-repository'
import {
  assertCheckoutPlanSelection,
  createForkNetworkBranchCatalog,
  createForkNetworkCatalog,
  ForkBranchCheckoutError,
  getForkNetworkRepositoryIdentity,
  IForkBranchCheckoutPlan,
  IForkBranchCheckoutResult,
  IForkNetworkBranch,
  IForkNetworkBranchCatalog,
  IForkNetworkCatalog,
  IForkNetworkRepository,
} from '../fork-network'
import {
  abortMerge,
  addRemote,
  checkoutBranch,
  createCommit,
  getAuthorIdentity,
  getChangedFiles,
  getCommitDiff,
  getMergeBase,
  getRemotes,
  getWorkingDirectoryDiff,
  isCoAuthoredByTrailer,
  pull as pullRepo,
  push as pushRepo,
  renameBranch,
  saveGitIgnore,
  appendIgnoreRule,
  createMergeCommit,
  getBranchesPointedAt,
  abortRebase,
  continueRebase,
  rebase,
  PushOptions,
  RebaseResult,
  getRebaseSnapshot,
  IStatusResult,
  GitError,
  MergeResult,
  getBranchesDifferingFromUpstream,
  deleteLocalBranch,
  deleteReviewedLocalBranches,
  deleteRemoteBranch,
  IReviewedBranchDeletion,
  IReviewedBranchDeletionResult,
  fastForwardBranches,
  GitResetMode,
  reset,
  getBranchAheadBehind,
  getRebaseInternalState,
  getCommit,
  appendIgnoreFile,
  getRepositoryType,
  RepositoryType,
  addWorktree,
  listWorktrees,
  listWorktreesFromGitDir,
  removeWorktree,
  moveWorktree,
  lockWorktree,
  unlockWorktree,
  pruneWorktrees,
  repairWorktrees,
  validateWorktreeRepairPaths,
  getCommitRangeDiff,
  getCommitRangeChangedFiles,
  updateRemoteHEAD,
  getBranchMergeBaseChangedFiles,
  getBranchMergeBaseDiff,
  checkoutCommit,
  getRemoteURL,
  getRemotePushURL,
  getGlobalConfigPath,
  getFilesDiffText,
  isMergeHeadSet,
  TerminalOutput,
  HookProgress,
  git,
  getSubmodules,
  createSubmoduleRepository,
  revalidateSubmoduleRepository,
  addSubmodule,
  updateSubmodules,
  syncSubmodules,
  removeSubmodule,
  setSubmoduleUrl,
  setSubmoduleBranch,
  setSubmoduleConfigKey,
  initSubmodule,
  deinitSubmodule,
  IManagedSubmodule,
  IAddSubmoduleOptions,
  SubmoduleConfigKey,
  discoverSubtrees,
  addSubtree,
  pullSubtree,
  pushSubtree,
  splitSubtree,
  isSubtreeAvailable,
  IManagedSubtree,
  ISubtreeMergeOptions,
  ISubtreeRemoteOptions,
  ISubtreeSplitOptions,
  IRemoteManagementApplyOptions,
  unstageAll,
  fetchRepositoryShallowHistory,
  applyForkBranchCheckoutPlan,
  reviewForkBranchCheckout,
} from '../git'
import type {
  ICreateTagLifecycleOptions,
  IMoveTagLifecycleOptions,
  IRemoteTagDeletionReview,
  ITagRefReview,
  ITagPushReview,
  IRepositoryShallowHistoryFetchRequest,
  ITagLifecycleInventory,
} from '../git'
import {
  installGlobalLFSFilters,
  installLFSHooks,
  isUsingLFS,
} from '../git/lfs'
import { inferLastPushForRepository } from '../infer-last-push-for-repository'
import { updateMenuState } from '../menu-update'
import { merge } from '../merge'
import {
  IMatchedGitHubRepository,
  matchGitHubRepository,
  matchExistingRepository,
  urlMatchesRemote,
  urlMatchesCloneURL,
  urlsMatch,
} from '../repository-matching'
import { ForcePushBranchState, getCurrentBranchForcePushState } from '../rebase'
import { RetryAction, RetryActionType } from '../../models/retry-actions'
import {
  Default as DefaultShell,
  findShellOrDefault,
  launchCustomShell,
  launchShell,
  parse as parseShell,
  Shell,
} from '../shells'
import { ILaunchStats, StatsStore } from '../stats'
import { hasShownWelcomeFlow, markWelcomeFlowComplete } from '../welcome'
import { WindowState } from '../window-state'
import { TypedBaseStore } from './base-store'
import { MergeTreeResult } from '../../models/merge'
import { promiseWithMinimumTimeout } from '../promise'
import { BackgroundFetcher } from './helpers/background-fetcher'
import { RepositoryStateCache } from './repository-state-cache'
import { readEmoji } from '../read-emoji'
import { Emoji } from '../emoji'
import { GitStoreCache } from './git-store-cache'
import { GitErrorContext } from '../git-error-context'
import {
  setNumber,
  setBoolean,
  getBoolean,
  getNumber,
  getNumberArray,
  setNumberArray,
  getEnum,
  getObject,
  setObject,
  getFloatNumber,
} from '../local-storage'
import { t } from '../i18n'
import {
  defaultShowBranchNameInRepoListSetting,
  ShowBranchNameInRepoListSetting,
} from '../../models/show-branch-name-in-repo-list'
import {
  clampZoom,
  computeAutoFitMultiplier,
  stepZoom,
  EffectiveZoomEpsilon,
  AutoFitDebounceMs,
} from '../zoom'
import { ExternalEditorError, suggestedExternalEditor } from '../editors/shared'
import { ApiRepositoriesStore } from './api-repositories-store'
import {
  updateChangedFiles,
  updateConflictState,
  selectWorkingDirectoryFiles,
} from './updates/changes-state'
import { ManualConflictResolution } from '../../models/manual-conflict-resolution'
import {
  IAutomationSettingsState,
  loadAutomationSettings,
  saveAutomationSettings,
  saveRepositoryAutomationOverrides,
  IAutomationSettingsOverrides,
  loadRepositoryAutomationOverrides,
  resolveAutomationSettings,
} from '../automation/automation-settings'
import { buildFallbackCommitMessage } from '../automation/fallback-commit-message'
import {
  IAutomationGuardState,
  canAutoCommitPush,
  canAutoPull,
} from '../automation/automation-guards'
import { AutomationScheduler } from './helpers/automation-scheduler'
import {
  IMergeAllCandidate,
  IMergeAllResult,
  IMergeAllState,
  MergeAllMode,
  selectBranchCandidates,
  selectWorktreeCandidates,
} from '../automation/merge-all'
import {
  IPullAllCandidate,
  IPullAllResult,
  IRepositorySyncRequest,
  PullAllProgressListener,
  runBoundedPullAll,
} from '../automation/pull-all'
import {
  commitPushAllRepository,
  CommitPushAllProgressListener,
  ICommitPushAllRepositoryActions,
  ICommitPushAllResult,
  isCommitPushAllRepositoryClean,
  runBoundedCommitPushAll,
} from '../automation/commit-push-all'
import {
  PullAllFallbackSuccessDetail,
  pullWithAccountFallback,
} from '../automation/pull-all-account-fallback'
import { fetchShallowHistoryWithAccountFallback } from '../automation/shallow-history-account-fallback'
import { BranchPruner } from './helpers/branch-pruner'
import {
  enableCopilotConflictResolution,
  enableCopilotSdkCommitMessageGeneration,
  enableCustomIntegration,
  enableWorktreeSupport,
} from '../feature-flag'
import { isGHES } from '../endpoint-capabilities'
import { Banner, BannerType } from '../../models/banner'
import { ComputedAction } from '../../models/computed-action'
import {
  applyDesktopStashEntry,
  clearReviewedDesktopStashes,
  createBranchFromDesktopStash,
  createDesktopStashEntry,
  createNamedDesktopStashEntry,
  getLastDesktopStashEntryForBranch,
  popStashEntry,
  moveStashEntry,
  StashManagerError,
  updateDesktopStashEntry,
} from '../git/stash'
import {
  UncommittedChangesStrategy,
  defaultUncommittedChangesStrategy,
} from '../../models/uncommitted-changes-strategy'
import {
  ICreateManagedStashRequest,
  IStashEntry,
  IUpdateManagedStashRequest,
  StashedChangesLoadStates,
} from '../../models/stash-entry'
import { arrayEquals } from '../equality'
import { MenuLabelsEvent } from '../../models/menu-labels'
import { findRemoteBranchName } from './helpers/find-branch-name'
import { updateRemoteUrl } from './updates/update-remote-url'
import {
  TutorialStep,
  orderedTutorialSteps,
  isValidTutorialStep,
} from '../../models/tutorial-step'
import { OnboardingTutorialAssessor } from './helpers/tutorial-assessor'
import {
  getConflictedFiles,
  getUntrackedFiles,
  hasConflictedFiles,
} from '../status'
import { isBranchPushable } from '../helpers/push-control'
import {
  findAssociatedPullRequest,
  isPullRequestAssociatedWithBranch,
} from '../helpers/pull-request-matching'
import { parseRemote } from '../../lib/remote-parsing'
import { createTutorialRepository } from './helpers/create-tutorial-repository'
import { sendNonFatalException } from '../helpers/non-fatal-exception'
import { getDefaultDir } from '../../ui/lib/default-dir'
import { WorkflowPreferences } from '../../models/workflow-preferences'
import {
  defaultBuildRunPreferences,
  IBuildRunPreferences,
} from '../../models/build-run-preferences'
import { RepositoryIndicatorUpdater } from './helpers/repository-indicator-updater'
import { isAttributableEmailFor } from '../email'
import { TrashNameLabel } from '../../ui/lib/context-menu'
import { GitError as DugiteError } from 'dugite'
import {
  ErrorWithMetadata,
  CheckoutError,
  DiscardChangesError,
  StashChangesError,
} from '../error-with-metadata'
import {
  ShowSideBySideDiffDefault,
  getShowSideBySideDiff,
  setShowSideBySideDiff,
} from '../../ui/lib/diff-mode'
import {
  abortCherryPick,
  cherryPick,
  CherryPickResult,
  continueCherryPick,
  getCherryPickSnapshot,
  isCherryPickHeadFound,
} from '../git/cherry-pick'
import { DragElement } from '../../models/drag-drop'
import { ILastThankYou } from '../../models/last-thank-you'
import { squash } from '../git/squash'
import { getTipSha } from '../tip'
import {
  MultiCommitOperationDetail,
  MultiCommitOperationKind,
  MultiCommitOperationStep,
  MultiCommitOperationStepKind,
} from '../../models/multi-commit-operation'
import { reorder } from '../git/reorder'
import { UseWindowsOpenSSHKey } from '../ssh/ssh'
import {
  loadSSHDockerDeploymentsForPush,
  runSSHWorkingCopyAction,
} from '../ssh/ssh-working-copy'
import { isConflictsFlow } from '../multi-commit-operation'
import { clamp } from '../clamp'
import { EndpointToken } from '../endpoint-token'
import { IRefCheck } from '../ci-checks/ci-checks'
import {
  NotificationsStore,
  getNotificationsEnabled,
} from './notifications-store'
import { NotificationCentreStore } from './notification-centre-store'
import { NotificationAutomationStore } from './notification-automation-store'
import { LogStore } from './log-store'
import { setLogSinkVerbose } from '../logging/renderer/log-sink'
import {
  INotificationEntry,
  INotificationInput,
} from '../../models/notification-centre'
import {
  INotificationAutomationRule,
  NotificationAutomationReceiptPrefix,
} from '../notifications/automation/notification-automation'
import { evaluateNotificationAutomations } from '../notifications/automation/evaluate'
import {
  dismissErrorNotice,
  enqueueErrorNotice,
  IErrorNotice,
} from '../../models/error-notice'
import {
  ErrorPresentationStyle,
  getErrorPresentationStyle,
  setErrorPresentationStyle,
} from '../../models/error-presentation'
import {
  getAppErrorPresentation,
  shouldPresentErrorAsNotice,
} from '../app-error-presentation'
import {
  BatchCloneMode,
  BatchCloneSource,
  IBatchCloneInput,
  IBatchCloneItem,
  IBatchCloneState,
  buildBatchCloneItems,
} from '../../models/batch-clone'
import { AutoCloneStore } from './auto-clone-store'
import { IProfileHistoryPage } from '../../models/profile'
import * as ipcRenderer from '../ipc-renderer'
import { pathExists } from '../path-exists'
import { offsetFromNow } from '../offset-from'
import { findContributionTargetDefaultBranch } from '../branch'
import {
  gitErrorReferencesRepositoryIndexLock,
  removeStaleRepositoryLock,
} from '../git/remove-lock'
import { ValidNotificationPullRequestReview } from '../valid-notification-pull-request-review'
import { determineMergeability } from '../git/merge-tree'
import { PopupManager } from '../popup-manager'
import { resizableComponentClass } from '../../ui/resizable'
import { compare } from '../compare'
import { parseRepoRules, useRepoRulesLogic } from '../helpers/repo-rules'
import { RepoRulesInfo } from '../../models/repo-rules'
import {
  setUseExternalCredentialHelper,
  useExternalCredentialHelper,
  useExternalCredentialHelperDefault,
} from '../trampoline/use-external-credential-helper'
import { IOAuthAction } from '../parse-app-url'
import {
  ICustomIntegration,
  migratedCustomIntegration,
} from '../custom-integration'
import { updateStore } from '../../ui/lib/update-store'
import { startTimer } from '../../ui/lib/timing'
import { BypassReasonType } from '../../ui/secret-scanning/bypass-push-protection-dialog'
import {
  selectReferencedContext,
  fallbackReferencedContext,
  IConflictResolutionProgress,
  ICopilotResolutionSummary,
  IFileResolution,
} from '../copilot-conflict-resolution'
import {
  buildConflictContext,
  gatherCommitContext,
  IConflictContextCommit,
  IConflictContextPullRequest,
  IConflictResolutionContext,
} from '../copilot-conflict-context'
import {
  extractPullRequestNumbersFromCommits,
  findPullRequestsByNumbers,
} from '../pull-request-refs'
import { resolveWithin } from '../path'
import {
  IWorktreeMaintenancePreview,
  WorktreeEntry,
  WorktreeMaintenanceOperation,
} from '../../models/worktree'
import type { Model } from '@github/copilot-sdk/dist/generated/rpc'
import {
  getAppearanceCustomization,
  getRepositoryAppearanceOverrides,
  setAppearanceCustomization,
  setRepositoryAppearanceOverrides,
} from '../appearance-customization'
import type { ElementAppearanceCoordinator } from './element-appearance-coordinator'

const LastSelectedRepositoryIDKey = 'last-selected-repository-id'

/**
 * Upper bound on how many pull requests we'll resolve (across both sides)
 * when gathering Copilot conflict-resolution context. Caps best-effort API
 * lookups so a noisy set of `#NNNN` references can't stall resolution.
 */
const MaxPullRequestLookups = 10

const RecentRepositoriesKey = 'recently-selected-repositories'
/**
 *  maximum number of repositories shown in the "Recent" repositories group
 *  in the repository switcher dropdown
 */
const RecentRepositoriesLength = 3

const defaultSidebarWidth: number = 372
const sidebarWidthConfigKey: string = 'sidebar-width'

const defaultCommitSummaryWidth: number = 250
const commitSummaryWidthConfigKey: string = 'commit-summary-width'

const defaultStashedFilesWidth: number = 250
const stashedFilesWidthConfigKey: string = 'stashed-files-width'

const defaultPullRequestFileListWidth: number = 250
const pullRequestFileListConfigKey: string = 'pull-request-files-width'

const defaultBranchDropdownWidth: number = 230
const branchDropdownWidthConfigKey: string = 'branch-dropdown-width'

const defaultWorktreeDropdownWidth: number = 230
const worktreeDropdownWidthConfigKey: string = 'worktree-dropdown-width'

const defaultPushPullButtonWidth: number = 230
const pushPullButtonWidthConfigKey: string = 'push-pull-button-width'

const askToMoveToApplicationsFolderDefault: boolean = true
const confirmRepoRemovalDefault: boolean = true
const showCommitLengthWarningDefault: boolean = false
const confirmDiscardChangesDefault: boolean = true
const confirmDiscardChangesPermanentlyDefault: boolean = true
const confirmDiscardStashDefault: boolean = true
const confirmCheckoutCommitDefault: boolean = true
const askForConfirmationOnForcePushDefault = true
const confirmUndoCommitDefault: boolean = true
const confirmCommitFilteredChangesDefault: boolean = true
const confirmCommitMessageOverrideDefault: boolean = true
const confirmWorktreeRemovalDefault: boolean = true
const autoSwitchAccountToRepositoryOwnerDefault: boolean = true
const askToMoveToApplicationsFolderKey: string = 'askToMoveToApplicationsFolder'
const confirmRepoRemovalKey: string = 'confirmRepoRemoval'
const showCommitLengthWarningKey: string = 'showCommitLengthWarning'
const confirmDiscardChangesKey: string = 'confirmDiscardChanges'
const confirmDiscardStashKey: string = 'confirmDiscardStash'
const confirmCheckoutCommitKey: string = 'confirmCheckoutCommit'
const confirmDiscardChangesPermanentlyKey: string =
  'confirmDiscardChangesPermanentlyKey'
const confirmForcePushKey: string = 'confirmForcePush'
const confirmUndoCommitKey: string = 'confirmUndoCommit'
const confirmCommitFilteredChangesKey: string =
  'confirmCommitFilteredChangesKey'
const confirmCommitMessageOverrideKey: string = 'confirmCommitMessageOverride'
const confirmWorktreeRemovalKey: string = 'confirmWorktreeRemoval'
const autoSwitchAccountToRepositoryOwnerKey: string =
  'autoSwitchAccountToRepositoryOwner'

const uncommittedChangesStrategyKey = 'uncommittedChangesStrategyKind'

const externalEditorKey: string = 'externalEditor'

const imageDiffTypeDefault = ImageDiffType.TwoUp
const imageDiffTypeKey = 'image-diff-type'

const hideWhitespaceInChangesDiffDefault = false
const hideWhitespaceInChangesDiffKey = 'hide-whitespace-in-changes-diff'
const hideWhitespaceInHistoryDiffDefault = false
const hideWhitespaceInHistoryDiffKey = 'hide-whitespace-in-diff'
const hideWhitespaceInPullRequestDiffDefault = false
const hideWhitespaceInPullRequestDiffKey =
  'hide-whitespace-in-pull-request-diff'

const commitSpellcheckEnabledDefault = true
const commitSpellcheckEnabledKey = 'commit-spellcheck-enabled'

export const tabSizeDefault: number = 4
const tabSizeKey: string = 'tab-size'

const shellKey = 'shell'

const showRecentRepositoriesKey = 'show-recent-repositories'
const showBranchNameInRepoListKey = 'show-branch-name-in-repo-list'
const repositoryIndicatorsEnabledKey = 'enable-repository-indicators'
const branchSortOrderKey = 'branch-sort-order'
const verboseLoggingKey = 'verboseLogging'

// background fetching should occur hourly when Desktop is active, but this
// lower interval ensures user interactions like switching repositories and
// switching between apps does not result in excessive fetching in the app
const BackgroundFetchMinimumInterval = 30 * 60 * 1000

/**
 * Wait 2 minutes before refreshing repository indicators
 */
const InitialRepositoryIndicatorTimeout = 2 * 60 * 1000

const MaxInvalidFoldersToDisplay = 3

const lastThankYouKey = 'version-and-users-of-last-thank-you'
const pullRequestSuggestedNextActionKey =
  'pull-request-suggested-next-action-key'

export const useCustomEditorKey = 'use-custom-editor'
const customEditorKey = 'custom-editor'

export const useCustomShellKey = 'use-custom-shell'
const customShellKey = 'custom-shell'
const branchPresetScriptKey = 'branch-preset-script'

export const underlineLinksKey = 'underline-links'
export const underlineLinksDefault = true

export const showDiffCheckMarksDefault = true
export const showDiffCheckMarksKey = 'diff-check-marks-visible'

const commitMessageGenerationDisclaimerLastSeenKey =
  'commit-message-generation-disclaimer-last-seen'

const commitMessageGenerationButtonClickedKey =
  'commit-message-generation-button-clicked'

const copilotConflictResolutionDisclaimerLastSeenKey =
  'copilot-conflict-resolution-disclaimer-last-seen'

const copilotConflictResolutionClickCountKey =
  'copilot-conflict-resolution-button-clicked'

const alwaysUseCopilotForConflictResolutionKey =
  'always-use-copilot-for-conflict-resolution'

export const showChangesFilterKey = 'show-changes-filter'

const selectedCopilotModelsKey = 'selected-copilot-models'
export const showChangesFilterDefault = true

export class AppStore extends TypedBaseStore<IAppState> {
  private readonly gitStoreCache: GitStoreCache

  private accounts: ReadonlyArray<Account> = new Array<Account>()
  private repositories: ReadonlyArray<Repository> = new Array<Repository>()
  private recentRepositories: ReadonlyArray<number> = new Array<number>()

  private selectedRepository: Repository | CloningRepository | null = null
  private automationSettings: IAutomationSettingsState =
    loadAutomationSettings()

  /** The background fetcher for the currently selected repository. */
  private currentBackgroundFetcher: BackgroundFetcher | null = null
  private currentAutomationScheduler: AutomationScheduler | null = null
  private readonly mergeAllControllers = new Map<number, AbortController>()

  /**
   * The abort controller for each repository's in-flight automatic cheap-LFS
   * materialize. Its presence is also the re-entrancy guard: a second detect
   * hook for the same repository returns early instead of starting a second run.
   */
  private readonly cheapLfsMaterializeControllers = new Map<
    number,
    AbortController
  >()

  private currentBranchPruner: BranchPruner | null = null

  private readonly repositoryIndicatorUpdater: RepositoryIndicatorUpdater

  private showWelcomeFlow = false
  private focusCommitMessage = false
  private currentFoldout: Foldout | null = null
  private currentBanner: Banner | null = null
  private emitQueued = false

  private readonly localRepositoryStateLookup = new Map<
    number,
    ILocalRepositoryState
  >()

  /** Map from shortcut (e.g., :+1:) to on disk URL. */
  private emoji = new Map<string, Emoji>()

  /**
   * The Application menu as an AppMenu instance or null if
   * the main process has not yet provided the renderer with
   * a copy of the application menu structure.
   */
  private appMenu: AppMenu | null = null

  /**
   * Used to highlight access keys throughout the app when the
   * Alt key is pressed. Only applicable on non-macOS platforms.
   */
  private highlightAccessKeys: boolean = false

  /**
   * A value indicating whether or not the current application
   * window has focus.
   */
  private appIsFocused: boolean = false

  private sidebarWidth = constrain(defaultSidebarWidth)
  private commitSummaryWidth = constrain(defaultCommitSummaryWidth)
  private stashedFilesWidth = constrain(defaultStashedFilesWidth)
  private pullRequestFileListWidth = constrain(defaultPullRequestFileListWidth)
  private branchDropdownWidth = constrain(defaultBranchDropdownWidth)
  private worktreeDropdownWidth = constrain(defaultWorktreeDropdownWidth)
  private pushPullButtonWidth = constrain(defaultPushPullButtonWidth)

  private windowState: WindowState | null = null

  /** The applied effective zoom (base × auto-fit multiplier, clamped). */
  private windowZoomFactor: number = 1
  /** The user's chosen scale base (slider value, persisted to 'zoom-factor'). */
  private zoomBaseFactor: number = 1
  /** Whether the auto-fit-to-window multiplier is applied. Default ON. */
  private autoFitZoomEnabled: boolean = true
  /** The current auto-fit shrink multiplier (≤ 1). Never persisted. */
  private autoFitMultiplier: number = 1
  /** Pending debounced resize recompute timer id, if any. */
  private zoomResizeDebounceId: number | null = null

  private resizablePaneActive = false
  private isUpdateAvailableBannerVisible: boolean = false
  private isUpdateShowcaseVisible: boolean = false

  private askToMoveToApplicationsFolderSetting: boolean =
    askToMoveToApplicationsFolderDefault
  private useExternalCredentialHelper: boolean =
    useExternalCredentialHelperDefault
  private askForConfirmationOnRepositoryRemoval: boolean =
    confirmRepoRemovalDefault
  private confirmDiscardChanges: boolean = confirmDiscardChangesDefault
  private confirmDiscardChangesPermanently: boolean =
    confirmDiscardChangesPermanentlyDefault
  private confirmDiscardStash: boolean = confirmDiscardStashDefault
  private confirmCheckoutCommit: boolean = confirmCheckoutCommitDefault
  private askForConfirmationOnForcePush = askForConfirmationOnForcePushDefault
  private confirmUndoCommit: boolean = confirmUndoCommitDefault
  private confirmCommitFilteredChanges: boolean =
    confirmCommitFilteredChangesDefault
  private confirmCommitMessageOverride: boolean =
    confirmCommitMessageOverrideDefault
  private confirmWorktreeRemoval: boolean = confirmWorktreeRemovalDefault
  private autoSwitchAccountToRepositoryOwner: boolean =
    autoSwitchAccountToRepositoryOwnerDefault
  private imageDiffType: ImageDiffType = imageDiffTypeDefault
  private hideWhitespaceInChangesDiff: boolean =
    hideWhitespaceInChangesDiffDefault
  private hideWhitespaceInHistoryDiff: boolean =
    hideWhitespaceInHistoryDiffDefault
  private hideWhitespaceInPullRequestDiff: boolean =
    hideWhitespaceInPullRequestDiffDefault
  /** Whether or not the spellchecker is enabled for commit summary and description */
  private commitSpellcheckEnabled: boolean = commitSpellcheckEnabledDefault
  private showSideBySideDiff: boolean = ShowSideBySideDiffDefault

  private uncommittedChangesStrategy = defaultUncommittedChangesStrategy

  private selectedExternalEditor: string | null = null

  private resolvedExternalEditor: string | null = null

  /** The user's preferred shell. */
  private selectedShell: Shell = DefaultShell

  /** The current repository filter text */
  private repositoryFilterText: string = ''

  private currentMergeTreePromise: Promise<void> | null = null

  /** The function to resolve the current Open in Desktop flow. */
  private resolveOpenInDesktop:
    | ((repository: Repository | null) => void)
    | null = null

  private selectedCloneRepositoryTab = CloneRepositoryTab.DotCom

  private selectedBranchesTab = BranchesTab.Branches
  private selectedTheme = ApplicationTheme.System
  private currentTheme: ApplicableTheme = ApplicationTheme.Light
  private appearanceCustomization = getAppearanceCustomization()
  private appearanceCustomizationMutationVersion = 0
  private repositoryAppearanceOverrides: IRepositoryAppearanceOverrides = {}
  private selectedTabSize = tabSizeDefault
  private showRecentRepositories = true
  private showBranchNameInRepoList = defaultShowBranchNameInRepoListSetting

  private useWindowsOpenSSH: boolean = false

  /** Whether debug-level lines reach the log file and the log history. */
  private verboseLogging: boolean = false

  private showCommitLengthWarning: boolean = showCommitLengthWarningDefault

  private hasUserViewedStash = false

  private repositoryIndicatorsEnabled: boolean

  /** Which step the user needs to complete next in the onboarding tutorial */
  private currentOnboardingTutorialStep = TutorialStep.NotApplicable
  private readonly tutorialAssessor: OnboardingTutorialAssessor

  private currentDragElement: DragElement | null = null
  private lastThankYou: ILastThankYou | undefined

  private useCustomEditor: boolean = false
  private customEditor: ICustomIntegration | null = null

  private useCustomShell: boolean = false
  private customShell: ICustomIntegration | null = null
  private branchPresetScript: ICustomIntegration | null = null

  private showCIStatusPopover: boolean = false

  /** A service for managing the stack of open popups */
  private popupManager = new PopupManager()

  private pullRequestSuggestedNextAction:
    | PullRequestSuggestedNextAction
    | undefined = undefined

  private showDiffCheckMarks: boolean = showDiffCheckMarksDefault

  private preferAbsoluteDates: boolean = false
  private branchSortOrder = DefaultBranchSortOrder

  private cachedRepoRulesets = new Map<number, IAPIRepoRuleset>()

  private underlineLinks: boolean = underlineLinksDefault

  private commitMessageGenerationDisclaimerLastSeen: number | null = null
  private commitMessageGenerationButtonClicked: boolean = false

  private copilotConflictResolutionDisclaimerLastSeen: number | null = null
  private copilotConflictResolutionClickCount: number = 0

  private alwaysUseCopilotForConflictResolution: boolean = false

  private showChangesFilter: boolean = false

  private selectedCopilotModels: CopilotModelSelections = {}
  private copilotModels: ReadonlyArray<Model> | null = null
  private byokProviders: ReadonlyArray<IBYOKProvider> = []

  /** Mirror of the notification centre store's state (see NotificationCentreStore). */
  private notifications: ReadonlyArray<INotificationEntry> = []
  private unreadNotificationCount = 0
  private isNotificationCentreOpen = false

  /** Non-modal acknowledgement-only errors, newest at the bottom of the stack. */
  private errorNotices: ReadonlyArray<IErrorNotice> = []
  private errorPresentationStyle = getErrorPresentationStyle()
  private readonly repositoryLockRemovalInFlight = new Set<number>()

  /** Coordinates cloning many repositories at once (see BatchCloneStore). */
  private readonly batchCloneStore: BatchCloneStore
  private batchCloneState: IBatchCloneState | null = null
  private readonly autoCloneStore: AutoCloneStore

  /** Account-bound Releases coordinator backing the cheap-LFS delegations. */
  private readonly githubReleasesStore: GitHubReleasesStore

  /** Accounts already audited for missing OAuth scopes this session. */
  private readonly scopeAuditedAccounts = new Set<string>()

  public constructor(
    private readonly gitHubUserStore: GitHubUserStore,
    private readonly cloningRepositoriesStore: CloningRepositoriesStore,
    private readonly issuesStore: IssuesStore,
    private readonly statsStore: StatsStore,
    private readonly signInStore: SignInStore,
    private readonly accountsStore: AccountsStore,
    private readonly repositoriesStore: RepositoriesStore,
    private readonly pullRequestCoordinator: PullRequestCoordinator,
    private readonly repositoryStateCache: RepositoryStateCache,
    private readonly apiRepositoriesStore: ApiRepositoriesStore,
    private readonly notificationsStore: NotificationsStore,
    private readonly copilotStore: CopilotStore,
    private readonly notificationCentreStore: NotificationCentreStore,
    private readonly notificationAutomationStore: NotificationAutomationStore,
    private readonly logStore: LogStore,
    private readonly elementAppearanceCoordinator?: ElementAppearanceCoordinator
  ) {
    super()

    // Fire user-defined automations for genuinely new notifications. The trigger
    // is installed here (rather than inside the Electron-free notification store)
    // because running an action requires rule storage and main-process IPC.
    this.notificationCentreStore.setAutomationTrigger(entry =>
      this.runNotificationAutomations(entry)
    )

    this.batchCloneStore = new BatchCloneStore(
      this.cloningRepositoriesStore,
      undefined,
      undefined,
      new FileBatchCloneStagingManager()
    )
    this.githubReleasesStore = new GitHubReleasesStore(this.accountsStore)
    this.autoCloneStore = new AutoCloneStore({
      getAccounts: () => this.accounts,
      getApiRepositories: () => this.apiRepositoriesStore.getState(),
      isRepositoryTracked: this.isAutoCloneRepositoryTracked,
      refreshRepositories: account =>
        this.apiRepositoriesStore.loadAll(account),
      startBackgroundBatch: this.startBackgroundAutoCloneBatch,
      notify: (title, body) =>
        this.postNotification({ kind: 'clone-batch', title, body }),
    })

    this.showWelcomeFlow = !hasShownWelcomeFlow()

    if (__WIN32__) {
      const useWindowsOpenSSH = getBoolean(UseWindowsOpenSSHKey)

      // If the user never selected whether to use Windows OpenSSH or not, use it
      // by default if we have to show the welcome flow (i.e. if it's a new install)
      if (useWindowsOpenSSH === undefined) {
        this._setUseWindowsOpenSSH(this.showWelcomeFlow)
      } else {
        this.useWindowsOpenSSH = useWindowsOpenSSH
      }
    }

    this.verboseLogging = getBoolean(verboseLoggingKey, false)
    this.applyVerboseLogging()

    this.gitStoreCache = new GitStoreCache(
      shell,
      this.statsStore,
      (repo, store) => this.onGitStoreUpdated(repo, store),
      error => this.emitError(error)
    )

    window.addEventListener('resize', () => {
      this.updateResizableConstraints()
      this.emitUpdate()

      // Debounce the auto-fit recompute so dragging a window edge doesn't
      // thrash the zoom. The epsilon guard inside applyEffectiveZoom prevents
      // oscillation once we do recompute.
      if (this.zoomResizeDebounceId !== null) {
        window.clearTimeout(this.zoomResizeDebounceId)
      }
      this.zoomResizeDebounceId = window.setTimeout(() => {
        this.zoomResizeDebounceId = null
        this.recomputeAutoFit()
      }, AutoFitDebounceMs)
    })

    this.initializeWindowState()
    this.initializeZoomFactor()
    this.wireupIpcEventHandlers()
    this.wireupStoreEventHandlers()
    getAppMenu()
    this.tutorialAssessor = new OnboardingTutorialAssessor(
      this.getResolvedExternalEditor
    )

    // We're considering flipping the default value and have new users
    // start off with repository indicators disabled. As such we'll start
    // persisting the current default to localstorage right away so we
    // can change the default in the future without affecting current
    // users.
    if (getBoolean(repositoryIndicatorsEnabledKey) === undefined) {
      setBoolean(repositoryIndicatorsEnabledKey, true)
    }

    this.repositoryIndicatorsEnabled =
      getBoolean(repositoryIndicatorsEnabledKey) ?? true
    this.showRecentRepositories = getBoolean(showRecentRepositoriesKey) ?? true
    this.showBranchNameInRepoList =
      getEnum(showBranchNameInRepoListKey, ShowBranchNameInRepoListSetting) ??
      defaultShowBranchNameInRepoListSetting

    this.repositoryIndicatorUpdater = new RepositoryIndicatorUpdater(
      this.getRepositoriesForIndicatorRefresh,
      this.refreshIndicatorForRepository
    )

    window.setTimeout(() => {
      if (this.repositoryIndicatorsEnabled) {
        this.repositoryIndicatorUpdater.start()
      }
    }, InitialRepositoryIndicatorTimeout)

    API.onTokenInvalidated(this.onTokenInvalidated)

    this.notificationsStore.onChecksFailedNotification(
      this.onChecksFailedNotification
    )

    this.notificationsStore.onPullRequestReviewSubmitNotification(
      this.onPullRequestReviewSubmitNotification
    )

    this.notificationsStore.onPullRequestCommentNotification(
      this.onPullRequestCommentNotification
    )

    onShowInstallingUpdate(this.onShowInstallingUpdate)
  }

  private initializeWindowState = async () => {
    const currentWindowState = await getCurrentWindowState()
    if (currentWindowState === undefined) {
      return
    }

    this.windowState = currentWindowState
  }

  private initializeZoomFactor = async () => {
    // Recover the user's chosen scale as the *base*. On WIN32 after an update
    // chromium resets zoomFactor to 1, so getWindowZoomFactor restores the
    // locally stored value; we treat whatever we get as the base (free
    // migration — the old applied-zoom value becomes the new base).
    const recovered = await this.getWindowZoomFactor()
    this.zoomBaseFactor = clampZoom(
      getFloatNumber('zoom-factor', recovered ?? 1)
    )
    this.autoFitZoomEnabled = getBoolean('zoom-auto-fit-enabled', true)

    // Seed the applied value with the base so the first auto-fit computation has
    // a sensible currently-applied zoom to reconstruct DIPs from.
    this.windowZoomFactor = this.zoomBaseFactor

    // Compute the initial auto-fit multiplier from the current window size, then
    // force-apply the effective zoom once (bypassing the epsilon guard) so the
    // saved base and any shrink take effect on startup regardless of chromium's
    // current zoom state.
    if (this.autoFitZoomEnabled) {
      const dipW = window.innerWidth * this.windowZoomFactor
      const dipH = window.innerHeight * this.windowZoomFactor
      this.autoFitMultiplier = computeAutoFitMultiplier(
        dipW,
        dipH,
        this.zoomBaseFactor
      )
    } else {
      this.autoFitMultiplier = 1
    }

    const effective = this.computeEffectiveZoom()
    this.windowZoomFactor = effective
    setWindowZoomFactor(effective)
    this.updateResizableConstraints()
    this.emitUpdate()
  }

  /** The effective zoom = base × (auto-fit multiplier when enabled), clamped. */
  private computeEffectiveZoom(): number {
    const multiplier = this.autoFitZoomEnabled ? this.autoFitMultiplier : 1
    return clampZoom(this.zoomBaseFactor * multiplier)
  }

  /**
   * Push the current effective zoom into the single sink (webContents via
   * setWindowZoomFactor). No-ops when the change is within the epsilon to avoid
   * oscillation. Does NOT persist — only the base is persisted, when it changes.
   */
  private applyEffectiveZoom() {
    const next = this.computeEffectiveZoom()
    if (Math.abs(next - this.windowZoomFactor) <= EffectiveZoomEpsilon) {
      return
    }
    this.windowZoomFactor = next
    setWindowZoomFactor(next)
    this.updateResizableConstraints()
    this.emitUpdate()
  }

  /**
   * Recompute the auto-fit multiplier from the current window size and apply the
   * resulting effective zoom. The DIP input is reconstructed as
   * `innerWidth × appliedEffectiveZoom` so applying a zoom doesn't move the
   * input (a fixed point) — this is the feedback-loop guard.
   */
  private recomputeAutoFit() {
    if (!this.autoFitZoomEnabled) {
      this.autoFitMultiplier = 1
      this.applyEffectiveZoom()
      return
    }

    const applied = this.windowZoomFactor
    const dipW = window.innerWidth * applied
    const dipH = window.innerHeight * applied
    this.autoFitMultiplier = computeAutoFitMultiplier(
      dipW,
      dipH,
      this.zoomBaseFactor
    )
    this.applyEffectiveZoom()
  }

  /** Step the scale base up one notch on the zoom ladder. */
  public _zoomIn = () => {
    this._setZoomBaseFactor(stepZoom(this.zoomBaseFactor, 'in'))
  }

  /** Step the scale base down one notch on the zoom ladder. */
  public _zoomOut = () => {
    this._setZoomBaseFactor(stepZoom(this.zoomBaseFactor, 'out'))
  }

  /** Reset the scale base to 100%. */
  public _zoomReset = () => {
    this._setZoomBaseFactor(1)
  }

  /** Set the scale base (slider value), persist it, and re-derive the applied zoom. */
  public _setZoomBaseFactor = (factor: number) => {
    const base = clampZoom(factor)
    if (base === this.zoomBaseFactor) {
      return
    }
    this.zoomBaseFactor = base
    setNumber('zoom-factor', base)
    // Re-derive the multiplier against the new base, then apply.
    this.recomputeAutoFit()
    // Always emit so the (controlled) scale slider reflects the new base even
    // when the applied effective zoom didn't cross the epsilon (e.g. auto-fit
    // floor is already clamping).
    this.emitUpdate()
  }

  /** Toggle whether auto-fit is applied, persist it, and re-derive. */
  public _setAutoFitZoomEnabled = (enabled: boolean) => {
    if (enabled === this.autoFitZoomEnabled) {
      return
    }
    this.autoFitZoomEnabled = enabled
    setBoolean('zoom-auto-fit-enabled', enabled)
    this.recomputeAutoFit()
    // Always emit so the auto-fit checkbox reflects the new value even when the
    // applied effective zoom didn't change.
    this.emitUpdate()
  }

  /**
   * On Windows OS, whenever a user toggles their zoom factor, chromium stores it
   * in their `%AppData%/Roaming/GitHub Desktop/Preferences.js` denoted by the
   * file path to the application. That file path contains the apps version.
   * Thus, on every update, the users set zoom level gets reset as there is not
   * defined value for the current app version.
   * */
  private async getWindowZoomFactor() {
    const zoomFactor = await getCurrentWindowZoomFactor()
    // One is the default value, we only care about checking the locally stored
    // value if it is one because that is the default value after an
    // update
    if (zoomFactor !== 1 || !__WIN32__) {
      return zoomFactor
    }

    const locallyStoredZoomFactor = getFloatNumber('zoom-factor')
    if (
      locallyStoredZoomFactor !== undefined &&
      locallyStoredZoomFactor !== zoomFactor
    ) {
      setWindowZoomFactor(locallyStoredZoomFactor)
      return locallyStoredZoomFactor
    }

    return zoomFactor
  }

  private onTokenInvalidated = (endpoint: string, token: string) => {
    const account = getAccountForEndpoint(this.accounts, endpoint)

    if (account === null) {
      return
    }

    // If we have a token for the account but it doesn't match the token that
    // was invalidated that likely means that someone held onto an account for
    // longer than they should have which is bad but what's even worse is if we
    // invalidate an active account.
    if (account.token && account.token !== token) {
      log.error(`Token for ${endpoint} invalidated but token mismatch`)
      return
    }

    // If the token was invalidated for an account, sign out from that account
    this._removeAccount(account)

    this._showPopup({
      type: PopupType.InvalidatedToken,
      account,
    })
  }

  private onShowInstallingUpdate = () => {
    this._showPopup({
      type: PopupType.InstallingUpdate,
    })
  }

  /** Figure out what step of the tutorial the user needs to do next */
  private async updateCurrentTutorialStep(
    repository: Repository
  ): Promise<void> {
    const currentStep = await this.tutorialAssessor.getCurrentStep(
      repository.isTutorialRepository,
      this.repositoryStateCache.get(repository)
    )
    // only emit an update if its changed
    if (currentStep !== this.currentOnboardingTutorialStep) {
      this.currentOnboardingTutorialStep = currentStep
      log.info(`Current tutorial step is now ${currentStep}`)
      this.recordTutorialStepCompleted(currentStep)
      this.emitUpdate()
    }
  }

  private recordTutorialStepCompleted(step: TutorialStep): void {
    if (!isValidTutorialStep(step)) {
      return
    }

    this.statsStore.recordHighestTutorialStepCompleted(
      orderedTutorialSteps.indexOf(step)
    )

    switch (step) {
      case TutorialStep.PickEditor:
        // don't need to record anything for the first step
        break
      case TutorialStep.CreateBranch:
        this.statsStore.recordTutorialEditorInstalled()
        break
      case TutorialStep.EditFile:
        this.statsStore.recordTutorialBranchCreated()
        break
      case TutorialStep.MakeCommit:
        this.statsStore.recordTutorialFileEdited()
        break
      case TutorialStep.PushBranch:
        this.statsStore.recordTutorialCommitCreated()
        break
      case TutorialStep.OpenPullRequest:
        this.statsStore.recordTutorialBranchPushed()
        break
      case TutorialStep.AllDone:
        this.statsStore.recordTutorialPrCreated()
        this.statsStore.recordTutorialCompleted()
        break
      case TutorialStep.Announced:
        // don't need to record anything for announcment
        break
      default:
        assertNever(step, 'Unaccounted for step type')
    }
  }

  public async _resumeTutorial(repository: Repository) {
    this.tutorialAssessor.resumeTutorial()
    await this.updateCurrentTutorialStep(repository)
  }

  public async _pauseTutorial(repository: Repository) {
    this.tutorialAssessor.pauseTutorial()
    await this.updateCurrentTutorialStep(repository)
  }

  /** Call via `Dispatcher` when the user opts to skip the pick editor step of the onboarding tutorial */
  public async _skipPickEditorTutorialStep(repository: Repository) {
    this.tutorialAssessor.skipPickEditor()
    await this.updateCurrentTutorialStep(repository)
  }

  /**
   * Call  via `Dispatcher` when the user has either created a pull request or opts to
   * skip the create pull request step of the onboarding tutorial
   */
  public async _markPullRequestTutorialStepAsComplete(repository: Repository) {
    this.tutorialAssessor.markPullRequestTutorialStepAsComplete()
    await this.updateCurrentTutorialStep(repository)
  }

  public async _markTutorialCompletionAsAnnounced(repository: Repository) {
    this.tutorialAssessor.markTutorialCompletionAsAnnounced()
    await this.updateCurrentTutorialStep(repository)
  }

  private wireupIpcEventHandlers() {
    ipcRenderer.on('accounts-changed', () => {
      this.accountsStore
        .reloadFromStore()
        .catch(error =>
          log.error('Failed to reload accounts from another window', error)
        )
    })

    ipcRenderer.on('window-state-changed', (_, windowState) => {
      this.windowState = windowState
      this.emitUpdate()
    })

    ipcRenderer.on('zoom-factor-changed', (event: any, zoomFactor: number) => {
      this.onWindowZoomFactorChanged(zoomFactor)
    })

    ipcRenderer.on('app-menu', (_, menu) => this.setAppMenu(menu))
  }

  private wireupStoreEventHandlers() {
    this.elementAppearanceCoordinator?.onDidUpdate(state => {
      this.appearanceCustomization = state.appearance
      this.emitUpdate()
    })
    this.elementAppearanceCoordinator?.onDidError(error =>
      this.emitError(error)
    )

    this.gitHubUserStore.onDidUpdate(() => {
      this.emitUpdate()
    })

    this.notificationCentreStore.onDidUpdate(state => {
      this.notifications = state.entries
      this.unreadNotificationCount = state.unreadCount
      this.isNotificationCentreOpen = state.isOpen
      this.emitUpdate()
    })

    this.cloningRepositoriesStore.onDidUpdate(() => {
      this.autoCloneStore.dataChanged()
      this.emitUpdate()
    })

    this.cloningRepositoriesStore.onDidError(e => this.emitError(e))

    this.batchCloneStore.onDidUpdate(state => {
      this.batchCloneState = state
      this.autoCloneStore.dataChanged()
      this.emitUpdate()
    })
    this.batchCloneStore.onDidError(error => this.emitError(error))

    this.signInStore.onDidAuthenticate(account => this._addAccount(account))
    this.signInStore.onDidUpdate(() => this.emitUpdate())
    this.signInStore.onDidError(error => this.emitError(error))

    this.accountsStore.onDidUpdate(accounts => {
      this.accounts = accounts
      this.syncCopilotModelsFromCache()
      this.updateCopilotModelsForCurrentAccount()
      const endpointTokens = accounts.map<EndpointToken>(
        ({ endpoint, token }) => ({ endpoint, token })
      )

      updateAccounts(endpointTokens)

      this.refreshSelectedRepositoryAfterAccountChange()
      this.autoCloneStore.dataChanged()

      this.emitUpdate()
    })
    this.accountsStore.onDidError(error => this.emitError(error))

    this.repositoriesStore.onDidUpdate(updateRepositories => {
      this.repositories = updateRepositories
      this.updateRepositorySelectionAfterRepositoriesChanged()
      this.autoCloneStore.dataChanged()
      this.emitUpdate()
    })

    this.pullRequestCoordinator.onPullRequestsChanged((repo, pullRequests) =>
      this.onPullRequestChanged(repo, pullRequests)
    )
    this.pullRequestCoordinator.onIsLoadingPullRequests(
      (repository, isLoadingPullRequests) => {
        this.repositoryStateCache.updateBranchesState(repository, () => {
          return { isLoadingPullRequests }
        })
        this.emitUpdate()
      }
    )

    this.apiRepositoriesStore.onDidUpdate(() => {
      this.autoCloneStore.dataChanged()
      this.emitUpdate()
    })
    this.apiRepositoriesStore.onDidError(error => this.emitError(error))

    // updateStore is a global, App.tsx handles most of it but we carry the
    // UpdateState in the AppState so we need to emit whenever it updates.
    updateStore.onDidChange(() => this.emitUpdate())

    this.copilotStore.onDidUpdate(() => {
      this.syncCopilotModelsFromCache()
      this.emitUpdate()
    })
  }

  private getCopilotModelsAccount(): Account | undefined {
    return this.accounts.find(
      account =>
        !isGHES(account.endpoint) &&
        enableCopilotSdkCommitMessageGeneration(account) &&
        account.isCopilotDesktopEnabled
    )
  }

  private syncCopilotModelsFromCache(): void {
    const account = this.getCopilotModelsAccount()

    if (account === undefined) {
      this.copilotModels = null
      return
    }

    this.copilotModels = this.copilotStore.getCachedModelList(account)
  }

  private updateCopilotModelsForCurrentAccount(): void {
    const account = this.getCopilotModelsAccount()

    if (
      account === undefined ||
      this.copilotStore.getCachedModelList(account) !== null
    ) {
      return
    }

    this.fetchCopilotModelsForCurrentAccount().catch(e => {
      log.warn(
        'AppStore: Failed to fetch Copilot models after account update',
        e
      )
    })
  }

  /** Load the emoji from disk. */
  public async loadEmoji() {
    const rootDir = await getAppPath()
    readEmoji(rootDir)
      .then(emoji => {
        this.emoji = emoji
        this.emitUpdate()
      })
      .catch(err => {
        log.warn(`Unexpected issue when trying to read emoji into memory`, err)
      })
  }

  protected emitUpdate() {
    // If the window is hidden then we won't get an animation frame, but there
    // may still be work we wanna do in response to the state change. So
    // immediately emit the update.
    if (this.windowState === 'hidden') {
      this.emitUpdateNow()
      return
    }

    if (this.emitQueued) {
      return
    }

    this.emitQueued = true

    window.requestAnimationFrame(() => {
      this.emitUpdateNow()
    })
  }

  private emitUpdateNow() {
    this.emitQueued = false
    const state = this.getState()

    super.emitUpdate(state)
    updateMenuState(state, this.appMenu)
  }

  /**
   * Called when an *external* zoom change is reported (e.g. a pinch gesture on
   * platforms that surface it). AppStore is the single owner of the applied
   * zoom, so we treat such a change as a change to the user's scale base and
   * re-derive the effective zoom from there. Changes that match our currently
   * applied value (within the epsilon) are ignored to avoid re-entrancy from
   * our own setWindowZoomFactor writes.
   */
  private onWindowZoomFactorChanged(zoomFactor: number) {
    if (Math.abs(zoomFactor - this.windowZoomFactor) <= EffectiveZoomEpsilon) {
      return
    }
    this._setZoomBaseFactor(zoomFactor)
  }

  private getSelectedState(): PossibleSelections | null {
    const repository = this.selectedRepository
    if (!repository) {
      return null
    }

    if (repository instanceof CloningRepository) {
      const progress =
        this.cloningRepositoriesStore.getRepositoryState(repository)
      if (!progress) {
        return null
      }

      return {
        type: SelectionType.CloningRepository,
        repository,
        progress,
      }
    }

    if (repository.missing) {
      return { type: SelectionType.MissingRepository, repository }
    }

    return {
      type: SelectionType.Repository,
      repository,
      state: this.repositoryStateCache.get(repository),
    }
  }

  public getState(): IAppState {
    const repositories = [
      ...this.repositories,
      ...this.cloningRepositoriesStore.repositories,
    ]

    return {
      accounts: this.accounts,
      automationSettings: this.automationSettings,
      repositories,
      recentRepositories: this.recentRepositories,
      localRepositoryStateLookup: this.localRepositoryStateLookup,
      windowState: this.windowState,
      windowZoomFactor: this.windowZoomFactor,
      zoomBaseFactor: this.zoomBaseFactor,
      autoFitZoomEnabled: this.autoFitZoomEnabled,
      appIsFocused: this.appIsFocused,
      selectedState: this.getSelectedState(),
      signInState: this.signInStore.getState(),
      currentPopup: this.popupManager.currentPopup,
      allPopups: this.popupManager.allPopups,
      currentFoldout: this.currentFoldout,
      errorCount: this.popupManager.getPopupsOfType(PopupType.Error).length,
      showWelcomeFlow: this.showWelcomeFlow,
      focusCommitMessage: this.focusCommitMessage,
      emoji: this.emoji,
      sidebarWidth: this.sidebarWidth,
      branchDropdownWidth: this.branchDropdownWidth,
      worktreeDropdownWidth: this.worktreeDropdownWidth,
      pushPullButtonWidth: this.pushPullButtonWidth,
      commitSummaryWidth: this.commitSummaryWidth,
      stashedFilesWidth: this.stashedFilesWidth,
      pullRequestFilesListWidth: this.pullRequestFileListWidth,
      appMenuState: this.appMenu ? this.appMenu.openMenus : [],
      highlightAccessKeys: this.highlightAccessKeys,
      isUpdateAvailableBannerVisible: this.isUpdateAvailableBannerVisible,
      isUpdateShowcaseVisible: this.isUpdateShowcaseVisible,
      currentBanner: this.currentBanner,
      askToMoveToApplicationsFolderSetting:
        this.askToMoveToApplicationsFolderSetting,
      useExternalCredentialHelper: this.useExternalCredentialHelper,
      askForConfirmationOnRepositoryRemoval:
        this.askForConfirmationOnRepositoryRemoval,
      askForConfirmationOnDiscardChanges: this.confirmDiscardChanges,
      askForConfirmationOnDiscardChangesPermanently:
        this.confirmDiscardChangesPermanently,
      askForConfirmationOnDiscardStash: this.confirmDiscardStash,
      askForConfirmationOnCheckoutCommit: this.confirmCheckoutCommit,
      askForConfirmationOnForcePush: this.askForConfirmationOnForcePush,
      askForConfirmationOnUndoCommit: this.confirmUndoCommit,
      askForConfirmationOnCommitFilteredChanges:
        this.confirmCommitFilteredChanges,
      askForConfirmationOnCommitMessageOverride:
        this.confirmCommitMessageOverride,
      askForConfirmationOnWorktreeRemoval: this.confirmWorktreeRemoval,
      autoSwitchAccountToRepositoryOwner:
        this.autoSwitchAccountToRepositoryOwner,
      uncommittedChangesStrategy: this.uncommittedChangesStrategy,
      selectedExternalEditor: this.selectedExternalEditor,
      imageDiffType: this.imageDiffType,
      hideWhitespaceInChangesDiff: this.hideWhitespaceInChangesDiff,
      hideWhitespaceInHistoryDiff: this.hideWhitespaceInHistoryDiff,
      hideWhitespaceInPullRequestDiff: this.hideWhitespaceInPullRequestDiff,
      showSideBySideDiff: this.showSideBySideDiff,
      selectedShell: this.selectedShell,
      repositoryFilterText: this.repositoryFilterText,
      resolvedExternalEditor: this.resolvedExternalEditor,
      selectedCloneRepositoryTab: this.selectedCloneRepositoryTab,
      selectedBranchesTab: this.selectedBranchesTab,
      selectedTheme: this.selectedTheme,
      currentTheme: this.currentTheme,
      appearanceCustomization: this.appearanceCustomization,
      repositoryAppearanceOverrides: this.repositoryAppearanceOverrides,
      selectedTabSize: this.selectedTabSize,
      showRecentRepositories: this.showRecentRepositories,
      showBranchNameInRepoList: this.showBranchNameInRepoList,
      apiRepositories: this.apiRepositoriesStore.getState(),
      useWindowsOpenSSH: this.useWindowsOpenSSH,
      verboseLogging: this.verboseLogging,
      showCommitLengthWarning: this.showCommitLengthWarning,
      optOutOfUsageTracking: this.statsStore.getOptOut(),
      currentOnboardingTutorialStep: this.currentOnboardingTutorialStep,
      repositoryIndicatorsEnabled: this.repositoryIndicatorsEnabled,
      commitSpellcheckEnabled: this.commitSpellcheckEnabled,
      currentDragElement: this.currentDragElement,
      lastThankYou: this.lastThankYou,
      useCustomEditor: this.useCustomEditor,
      customEditor: this.customEditor,
      useCustomShell: this.useCustomShell,
      customShell: this.customShell,
      branchPresetScript: this.branchPresetScript,
      showCIStatusPopover: this.showCIStatusPopover,
      notificationsEnabled: getNotificationsEnabled(),
      errorPresentationStyle: this.errorPresentationStyle,
      errorNotices: this.errorNotices,
      pullRequestSuggestedNextAction: this.pullRequestSuggestedNextAction,
      resizablePaneActive: this.resizablePaneActive,
      cachedRepoRulesets: this.cachedRepoRulesets,
      underlineLinks: this.underlineLinks,
      showDiffCheckMarks: this.showDiffCheckMarks,
      preferAbsoluteDates: this.preferAbsoluteDates,
      branchSortOrder: this.branchSortOrder,
      updateState: updateStore.state,
      commitMessageGenerationDisclaimerLastSeen:
        this.commitMessageGenerationDisclaimerLastSeen,
      commitMessageGenerationButtonClicked:
        this.commitMessageGenerationButtonClicked,
      copilotConflictResolutionDisclaimerLastSeen:
        this.copilotConflictResolutionDisclaimerLastSeen,
      copilotConflictResolutionClickCount:
        this.copilotConflictResolutionClickCount,
      alwaysUseCopilotForConflictResolution:
        this.alwaysUseCopilotForConflictResolution,
      showChangesFilter: this.showChangesFilter,
      selectedCopilotModels: this.selectedCopilotModels,
      copilotModels: this.copilotModels,
      byokProviders: this.byokProviders,
      notifications: this.notifications,
      unreadNotificationCount: this.unreadNotificationCount,
      isNotificationCentreOpen: this.isNotificationCentreOpen,
      batchCloneState: this.batchCloneState,
    }
  }

  private onGitStoreUpdated(repository: Repository, gitStore: GitStore) {
    // A removed GitStore can finish an in-flight command after Back has
    // disposed a temporary workspace. Never let that completion recreate its
    // cache state or drive global menu/sidebar updates.
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }

    const prevRepositoryState = this.repositoryStateCache.get(repository)

    this.repositoryStateCache.updateBranchesState(repository, state => {
      let { currentPullRequest } = state
      const { tip, currentRemote: remote } = gitStore

      // If the tip has changed we need to re-evaluate whether or not the
      // current pull request is still valid. Note that we're not using
      // updateCurrentPullRequest here because we know for certain that
      // the list of open pull requests haven't changed so we can find
      // a happy path where the tip has changed but the current PR is
      // still valid which doesn't require us to iterate through the
      // list of open PRs.
      if (
        !tipEquals(state.tip, tip) ||
        !remoteEquals(prevRepositoryState.remote, remote)
      ) {
        if (tip.kind !== TipState.Valid || remote === null) {
          // The tip isn't a branch so or the current branch doesn't have a remote
          // so there can't be a current pull request.
          currentPullRequest = null
        } else {
          const { branch } = tip

          if (
            !currentPullRequest ||
            !isPullRequestAssociatedWithBranch(
              branch,
              currentPullRequest,
              remote
            )
          ) {
            // Either we don't have a current pull request or the current pull
            // request no longer matches the tip, let's go hunting for a new one.
            const prs = state.openPullRequests
            currentPullRequest = findAssociatedPullRequest(branch, prs, remote)
          }

          if (
            tip.kind === TipState.Valid &&
            state.tip.kind === TipState.Valid &&
            tip.branch.name !== state.tip.branch.name
          ) {
            this.refreshBranchProtectionState(repository)
          }
        }
      }

      return {
        tip: gitStore.tip,
        defaultBranch: gitStore.defaultBranch,
        upstreamDefaultBranch: gitStore.upstreamDefaultBranch,
        allBranches: gitStore.allBranches,
        recentBranches: gitStore.recentBranches,
        pullWithRebase: gitStore.pullWithRebase,
        currentPullRequest,
      }
    })

    let selectWorkingDirectory = false
    let selectStashEntry = false

    this.repositoryStateCache.updateChangesState(repository, state => {
      const stashEntries = gitStore.currentBranchStashEntries
      const allStashEntries = gitStore.allStashEntries

      // Figure out what selection changes we need to make as a result of this
      // change.
      if (state.selection.kind === ChangesSelectionKind.Stash) {
        const selectedStashSha = state.selection.selectedStashEntry?.stashSha
        if (state.allStashEntries.length > 0) {
          if (allStashEntries.length === 0) {
            // We're showing a stash and all entries have disappeared,
            // so we need to switch back over to the working directory.
            selectWorkingDirectory = true
          } else if (
            selectedStashSha !== undefined &&
            !allStashEntries.some(entry => entry.stashSha === selectedStashSha)
          ) {
            // The selected stash disappeared, so select the next newest one.
            selectStashEntry = true
          } else if (
            state.selection.selectedStashEntry !==
            allStashEntries.find(entry => entry.stashSha === selectedStashSha)
          ) {
            // File metadata is loaded asynchronously and replaces the entry
            // object. Re-select it so the diff viewer observes the loaded copy.
            selectStashEntry = true
          }
        }
      }

      return {
        commitMessage: gitStore.commitMessage,
        showCoAuthoredBy: gitStore.showCoAuthoredBy,
        coAuthors: gitStore.coAuthors,
        stashEntries,
        allStashEntries,
        foreignStashEntryCount: gitStore.foreignStashEntryCount,
        stashInventoryTruncated: gitStore.stashInventoryTruncated,
      }
    })

    this.repositoryStateCache.update(repository, () => ({
      commitLookup: gitStore.commitLookup,
      localCommitSHAs: gitStore.localCommitSHAs,
      localTags: gitStore.localTags,
      aheadBehind: gitStore.aheadBehind,
      tagsToPush: gitStore.tagsToPush,
      remote: gitStore.currentRemote,
      lastFetched: gitStore.lastFetched,
    }))

    // _selectWorkingDirectoryFiles and _selectStashedFile will
    // emit updates by themselves.
    if (selectWorkingDirectory) {
      this._selectWorkingDirectoryFiles(repository)
    } else if (selectStashEntry) {
      this._selectStashedFile(repository, undefined, undefined, true)
    } else {
      this.emitUpdate()
    }
  }

  private clearBranchProtectionState(repository: Repository) {
    this.repositoryStateCache.updateChangesState(repository, () => ({
      currentBranchProtected: false,
      currentRepoRulesInfo: new RepoRulesInfo(),
    }))
    this.emitUpdate()
  }

  private async refreshBranchProtectionState(repository: Repository) {
    const { tip, currentRemote } = this.gitStoreCache.get(repository)

    if (tip.kind !== TipState.Valid || repository.gitHubRepository === null) {
      return
    }

    const gitHubRepo = repository.gitHubRepository
    const branchName = findRemoteBranchName(tip, currentRemote, gitHubRepo)

    if (branchName !== null) {
      const account = getAccountForEndpoint(this.accounts, gitHubRepo.endpoint)

      if (account === null) {
        return
      }

      // If the user doesn't have write access to the repository
      // it doesn't matter if the branch is protected or not and
      // we can avoid the API call. See the `showNoWriteAccess`
      // prop in the `CommitMessage` component where we specifically
      // test for this scenario and show a message specifically
      // about write access before showing a branch protection
      // warning.
      if (!hasWritePermission(gitHubRepo)) {
        this.repositoryStateCache.updateChangesState(repository, () => ({
          currentBranchProtected: false,
          currentRepoRulesInfo: new RepoRulesInfo(),
        }))
        this.emitUpdate()
        return
      }

      const name = gitHubRepo.name
      const owner = gitHubRepo.owner.login
      const api = API.fromAccount(account)

      const pushControl = await api.fetchPushControl(owner, name, branchName)
      const currentBranchProtected = !isBranchPushable(pushControl)

      let currentRepoRulesInfo = new RepoRulesInfo()
      if (useRepoRulesLogic(account, repository)) {
        const slimRulesets = await api.fetchAllRepoRulesets(owner, name)

        // ultimate goal here is to fetch all rulesets that apply to the repo
        // so they're already cached when needed later on
        if (slimRulesets?.length) {
          const rulesetIds = slimRulesets.map(r => r.id)

          const calls: Promise<IAPIRepoRuleset | null>[] = []
          for (const id of rulesetIds) {
            // check the cache and don't re-query any that are already in there
            if (!this.cachedRepoRulesets.has(id)) {
              calls.push(api.fetchRepoRuleset(owner, name, id))
            }
          }

          if (calls.length > 0) {
            const rulesets = await Promise.all(calls)
            this._updateCachedRepoRulesets(rulesets)
          }
        }

        const branchRules = await api.fetchRepoRulesForBranch(
          owner,
          name,
          branchName
        )

        if (branchRules.length > 0) {
          currentRepoRulesInfo = await parseRepoRules(
            branchRules,
            this.cachedRepoRulesets,
            repository
          )
        }
      }

      this.repositoryStateCache.updateChangesState(repository, () => ({
        currentBranchProtected,
        currentRepoRulesInfo,
      }))
      this.emitUpdate()
    }
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _updateCachedRepoRulesets(rulesets: Array<IAPIRepoRuleset | null>) {
    for (const rs of rulesets) {
      if (rs !== null) {
        this.cachedRepoRulesets.set(rs.id, rs)
      }
    }
  }

  private clearSelectedCommit(repository: Repository) {
    this.repositoryStateCache.updateCommitSelection(repository, () => ({
      shas: [],
      file: null,
      changesetData: { files: [], linesAdded: 0, linesDeleted: 0 },
      diff: null,
    }))
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _changeCommitSelection(
    repository: Repository,
    shas: ReadonlyArray<string>,
    isContiguous: boolean
  ): void {
    const { commitSelection, commitLookup, compareState } =
      this.repositoryStateCache.get(repository)

    if (
      commitSelection.shas.length === shas.length &&
      commitSelection.shas.every((sha, i) => sha === shas[i])
    ) {
      return
    }

    const shasInDiff = this.getShasInDiff(
      this.orderShasByHistory(repository, shas),
      isContiguous,
      commitLookup
    )

    if (shas.length > 1 && isContiguous) {
      this.recordMultiCommitDiff(shas, shasInDiff, compareState)
    }

    this.repositoryStateCache.updateCommitSelection(repository, () => ({
      shas,
      shasInDiff,
      isContiguous,
      file: null,
      changesetData: { files: [], linesAdded: 0, linesDeleted: 0 },
      diff: null,
    }))

    this.emitUpdate()
  }

  private recordMultiCommitDiff(
    shas: ReadonlyArray<string>,
    shasInDiff: ReadonlyArray<string>,
    compareState: ICompareState
  ) {
    const isHistoryTab = compareState.formState.kind === HistoryTabMode.History

    if (isHistoryTab) {
      this.statsStore.increment('multiCommitDiffFromHistoryCount')
    } else {
      this.statsStore.increment('multiCommitDiffFromCompareCount')
    }

    const hasUnreachableCommitWarning = !shas.every(s => shasInDiff.includes(s))

    if (hasUnreachableCommitWarning) {
      this.statsStore.increment(
        'multiCommitDiffWithUnreachableCommitWarningCount'
      )
    }
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _updateShasToHighlight(
    repository: Repository,
    shasToHighlight: ReadonlyArray<string>
  ) {
    this.repositoryStateCache.updateCompareState(repository, () => ({
      shasToHighlight,
    }))
    this.emitUpdate()
  }

  /**
   * When multiple commits are selected, the diff is created using the rev range
   * of firstSha^..lastSha in the selected shas. Thus comparing the trees of the
   * the lastSha and the first parent of the first sha. However, our history
   * list shows commits in chronological order. Thus, when a branch is merged,
   * the commits from that branch are injected in their chronological order into
   * the history list. Therefore, given a branch history of A, B, C, D,
   * MergeCommit where B and C are from the merged branch, diffing on the
   * selection of A through D would not have the changes from B an C.
   *
   * This method traverses the ancestral path from the last commit in the
   * selection back to the first commit via checking the parents. The
   * commits on this path are the commits whose changes will be seen in the
   * diff. This is equivalent to doing `git rev-list firstSha^..lastSha`.
   */
  private getShasInDiff(
    selectedShas: ReadonlyArray<string>,
    isContiguous: boolean,
    commitLookup: Map<string, Commit>
  ) {
    if (selectedShas.length <= 1 || !isContiguous) {
      return selectedShas
    }

    const shasInDiff = new Set<string>()
    const selected = new Set(selectedShas)
    const shasToTraverse = [selectedShas.at(-1)]
    let sha

    while ((sha = shasToTraverse.pop()) !== undefined) {
      if (!shasInDiff.has(sha)) {
        shasInDiff.add(sha)

        commitLookup.get(sha)?.parentSHAs?.forEach(parentSha => {
          if (selected.has(parentSha) && !shasInDiff.has(parentSha)) {
            shasToTraverse.push(parentSha)
          }
        })
      }
    }

    return Array.from(shasInDiff)
  }

  private updateOrSelectFirstCommit(
    repository: Repository,
    commitSHAs: ReadonlyArray<string>
  ) {
    const state = this.repositoryStateCache.get(repository)
    let selectedSHA =
      state.commitSelection.shas.length > 0
        ? state.commitSelection.shas[0]
        : null

    if (selectedSHA != null) {
      const index = commitSHAs.findIndex(sha => sha === selectedSHA)
      if (index < 0) {
        // selected SHA is not in this list
        // -> clear the selection in the app state
        selectedSHA = null
        this.clearSelectedCommit(repository)
      }
    }

    if (selectedSHA === null && commitSHAs.length > 0) {
      this._changeCommitSelection(repository, [commitSHAs[0]], true)
      this._loadChangedFilesForCurrentSelection(repository)
    }
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _initializeCompare(
    repository: Repository,
    initialAction?: CompareAction
  ) {
    const state = this.repositoryStateCache.get(repository)

    const { branchesState, compareState } = state
    const { tip } = branchesState
    const currentBranch = tip.kind === TipState.Valid ? tip.branch : null

    const branches = branchesState.allBranches.filter(
      b => b.name !== currentBranch?.name && !b.isDesktopForkRemoteBranch
    )
    const recentBranches = currentBranch
      ? branchesState.recentBranches.filter(b => b.name !== currentBranch.name)
      : branchesState.recentBranches

    const cachedDefaultBranch = branchesState.defaultBranch

    // only include the default branch when comparing if the user is not on the default branch
    // and it also exists in the repository
    const defaultBranch =
      currentBranch != null &&
      cachedDefaultBranch != null &&
      currentBranch.name !== cachedDefaultBranch.name
        ? cachedDefaultBranch
        : null

    this.repositoryStateCache.updateCompareState(repository, () => ({
      branches,
      recentBranches,
      defaultBranch,
    }))

    const cachedState = compareState.formState
    const action =
      initialAction != null ? initialAction : getInitialAction(cachedState)
    this._executeCompare(repository, action)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _executeCompare(
    repository: Repository,
    action: CompareAction
  ): Promise<void> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const gitStore = this.gitStoreCache.get(repository)
    const kind = action.kind

    if (action.kind === HistoryTabMode.History) {
      const { tip } = gitStore

      let currentSha: string | null = null

      if (tip.kind === TipState.Valid) {
        currentSha = tip.branch.tip.sha
      } else if (tip.kind === TipState.Detached) {
        currentSha = tip.currentSha
      }

      const { compareState } = this.repositoryStateCache.get(repository)
      const { formState, commitSHAs, historyScope } = compareState
      const previousTip = compareState.tip

      const tipIsUnchanged =
        currentSha !== null &&
        previousTip !== null &&
        currentSha === previousTip

      if (
        tipIsUnchanged &&
        historyScope === HistoryScope.CurrentBranch &&
        formState.kind === HistoryTabMode.History &&
        commitSHAs.length > 0
      ) {
        // don't refresh the history view here because we know nothing important
        // has changed and we don't want to rebuild this state
        return
      }

      // load initial group of commits for current branch
      const commits = await gitStore.loadHistoryBatch(historyScope, 0)

      if (commits === null || !this.isTemporaryRepositoryActive(repository)) {
        return
      }

      const newState: IDisplayHistory = {
        kind: HistoryTabMode.History,
      }

      this.repositoryStateCache.updateCompareState(repository, () => ({
        tip: currentSha,
        formState: newState,
        commitSHAs: commits,
        filterText: '',
        showBranchList: false,
      }))
      this.updateOrSelectFirstCommit(repository, commits)

      return this.emitUpdate()
    }

    if (action.kind === HistoryTabMode.Compare) {
      return this.updateCompareToBranch(repository, action)
    }

    return assertNever(action, `Unknown action: ${kind}`)
  }

  /** Switch the normal History view between the current branch and all refs. */
  public async _setHistoryScope(
    repository: Repository,
    historyScope: HistoryScope
  ): Promise<void> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }

    const current = this.repositoryStateCache.get(repository).compareState
    if (
      current.formState.kind === HistoryTabMode.History &&
      current.historyScope === historyScope &&
      current.commitSHAs.length > 0
    ) {
      return
    }

    const gitStore = this.gitStoreCache.get(repository)
    const tip = gitStore.tip
    const currentSha =
      tip.kind === TipState.Valid
        ? tip.branch.tip.sha
        : tip.kind === TipState.Detached
        ? tip.currentSha
        : null

    this.repositoryStateCache.updateCompareState(repository, () => ({
      formState: { kind: HistoryTabMode.History },
      historyScope,
      tip: currentSha,
      commitSHAs: [],
      filterText: '',
      showBranchList: false,
    }))
    this.emitUpdate()

    const commits = await gitStore.loadHistoryBatch(historyScope, 0)
    if (!this.isTemporaryRepositoryActive(repository) || commits === null) {
      return
    }

    const latest = this.repositoryStateCache.get(repository).compareState
    if (
      latest.formState.kind !== HistoryTabMode.History ||
      latest.historyScope !== historyScope
    ) {
      return
    }

    this.repositoryStateCache.updateCompareState(repository, () => ({
      commitSHAs: commits,
    }))
    this.updateOrSelectFirstCommit(repository, commits)
    this.emitUpdate()
  }

  private async updateCompareToBranch(
    repository: Repository,
    action: ICompareToBranch
  ) {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const gitStore = this.gitStoreCache.get(repository)

    const comparisonBranch = action.branch
    const compare = await gitStore.getCompareCommits(
      comparisonBranch,
      action.comparisonMode
    )

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    this.statsStore.increment('branchComparisons')
    const { branchesState } = this.repositoryStateCache.get(repository)

    if (
      branchesState.defaultBranch !== null &&
      comparisonBranch.name === branchesState.defaultBranch.name
    ) {
      this.statsStore.increment('defaultBranchComparisons')
    }

    if (compare == null) {
      return
    }

    const { ahead, behind } = compare
    const aheadBehind = { ahead, behind }

    const commitSHAs = compare.commits.map(commit => commit.sha)

    const newState: ICompareBranch = {
      kind: HistoryTabMode.Compare,
      comparisonBranch,
      comparisonMode: action.comparisonMode,
      aheadBehind,
    }

    this.repositoryStateCache.updateCompareState(repository, () => ({
      formState: newState,
      filterText: comparisonBranch.name,
      commitSHAs,
    }))

    const tip = gitStore.tip

    const loadingMerge: MergeTreeResult = {
      kind: ComputedAction.Loading,
    }

    this.repositoryStateCache.updateCompareState(repository, () => ({
      mergeStatus: loadingMerge,
    }))

    this.emitUpdate()

    this.updateOrSelectFirstCommit(repository, commitSHAs)

    if (this.currentMergeTreePromise != null) {
      return this.currentMergeTreePromise
    }

    if (tip.kind === TipState.Valid && aheadBehind.behind > 0) {
      this.currentMergeTreePromise = this.setupMergabilityPromise(
        repository,
        tip.branch,
        action.branch
      )
        .then(mergeStatus => {
          if (!this.isTemporaryRepositoryActive(repository)) {
            return
          }
          this.repositoryStateCache.updateCompareState(repository, () => ({
            mergeStatus,
          }))

          this.emitUpdate()
        })
        .finally(() => {
          this.currentMergeTreePromise = null
        })

      return this.currentMergeTreePromise
    } else {
      this.repositoryStateCache.updateCompareState(repository, () => ({
        mergeStatus: null,
      }))

      return this.emitUpdate()
    }
  }

  private setupMergabilityPromise(
    repository: Repository,
    baseBranch: Branch,
    compareBranch: Branch
  ) {
    return promiseWithMinimumTimeout(
      () => determineMergeability(repository, baseBranch, compareBranch),
      500
    ).catch(err => {
      log.warn(
        `Error occurred while trying to merge ${baseBranch.name} (${baseBranch.tip.sha}) and ${compareBranch.name} (${compareBranch.tip.sha})`,
        err
      )
      return null
    })
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _updateCompareForm<K extends keyof ICompareFormUpdate>(
    repository: Repository,
    newState: Pick<ICompareFormUpdate, K>
  ) {
    this.repositoryStateCache.updateCompareState(repository, state => {
      return merge(state, newState)
    })

    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _loadNextCommitBatch(repository: Repository): Promise<number> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return 0
    }
    const gitStore = this.gitStoreCache.get(repository)

    const state = this.repositoryStateCache.get(repository)
    const { formState } = state.compareState
    if (formState.kind === HistoryTabMode.History) {
      const commits = state.compareState.commitSHAs

      const tip = state.branchesState.tip

      let newCommits: string[] | null = null

      // Prioritize pulling from the local commits if the last one we pulled is local
      if (
        state.compareState.historyScope === HistoryScope.CurrentBranch &&
        commits.length > 0 &&
        tip.kind === TipState.Valid &&
        gitStore.localCommitSHAs.includes(commits[commits.length - 1])
      ) {
        newCommits = await gitStore.loadLocalCommits(tip.branch, commits.length)
        if (!this.isTemporaryRepositoryActive(repository)) {
          return 0
        }
      }

      if (!newCommits || newCommits.length === 0) {
        newCommits = await gitStore.loadHistoryBatch(
          state.compareState.historyScope,
          commits.length
        )
      }

      if (!newCommits || !this.isTemporaryRepositoryActive(repository)) {
        return 0
      }

      this.repositoryStateCache.updateCompareState(repository, () => ({
        commitSHAs: commits.concat(newCommits),
      }))
      this.emitUpdate()
      return newCommits.length
    }
    return 0
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _loadChangedFilesForCurrentSelection(
    repository: Repository
  ): Promise<void> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const state = this.repositoryStateCache.get(repository)
    const { commitSelection } = state
    const { shas: currentSHAs, isContiguous } = commitSelection
    if (currentSHAs.length === 0 || (currentSHAs.length > 1 && !isContiguous)) {
      return
    }

    const gitStore = this.gitStoreCache.get(repository)
    const changesetData = await gitStore.performFailableOperation(() =>
      currentSHAs.length > 1
        ? getCommitRangeChangedFiles(
            repository,
            this.orderShasByHistory(repository, currentSHAs)
          )
        : getChangedFiles(repository, currentSHAs[0])
    )
    if (!changesetData || !this.isTemporaryRepositoryActive(repository)) {
      return
    }

    // The selection could have changed between when we started loading the
    // changed files and we finished. We might wanna store the changed files per
    // SHA/path.
    if (
      commitSelection.shas.length !== currentSHAs.length ||
      !commitSelection.shas.every((sha, i) => sha === currentSHAs[i])
    ) {
      return
    }

    // if we're selecting a commit for the first time, we should select the
    // first file in the commit and render the diff immediately

    const noFileSelected = commitSelection.file === null

    const firstFileOrDefault =
      noFileSelected && changesetData.files.length
        ? changesetData.files[0]
        : commitSelection.file

    this.repositoryStateCache.updateCommitSelection(repository, () => ({
      file: firstFileOrDefault,
      changesetData,
      diff: null,
    }))

    this.emitUpdate()

    if (firstFileOrDefault !== null) {
      this._changeFileSelection(repository, firstFileOrDefault)
    }
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _setRepositoryFilterText(text: string): Promise<void> {
    this.repositoryFilterText = text
    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _changeFileSelection(
    repository: Repository,
    file: CommittedFileChange
  ): Promise<void> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    this.repositoryStateCache.updateCommitSelection(repository, () => ({
      file,
      diff: null,
    }))
    this.emitUpdate()

    const stateBeforeLoad = this.repositoryStateCache.get(repository)
    const { shas, isContiguous } = stateBeforeLoad.commitSelection

    if (shas.length === 0) {
      if (__DEV__) {
        throw new Error(
          "No currently selected sha yet we've been asked to switch file selection"
        )
      } else {
        return
      }
    }

    if (shas.length > 1 && !isContiguous) {
      return
    }

    const diff =
      shas.length > 1
        ? await getCommitRangeDiff(
            repository,
            file,
            this.orderShasByHistory(repository, shas),
            this.hideWhitespaceInHistoryDiff
          )
        : await getCommitDiff(
            repository,
            file,
            shas[0],
            this.hideWhitespaceInHistoryDiff
          )

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const stateAfterLoad = this.repositoryStateCache.get(repository)
    const { shas: shasAfter } = stateAfterLoad.commitSelection
    // A whole bunch of things could have happened since we initiated the diff load
    if (
      shasAfter.length !== shas.length ||
      !shas.every((sha, i) => sha === shasAfter[i])
    ) {
      return
    }

    if (!stateAfterLoad.commitSelection.file) {
      return
    }
    if (stateAfterLoad.commitSelection.file.id !== file.id) {
      return
    }

    this.repositoryStateCache.updateCommitSelection(repository, () => ({
      diff,
    }))

    this.emitUpdate()
  }

  private getCurrentSubmoduleParent(
    repository: SubmoduleRepository
  ): Repository | null {
    const parent = repository.parentRepository
    const normalizedParentPath = Path.normalize(Path.resolve(parent.path))

    return (
      this.repositories.find(candidate => {
        if (candidate.id !== parent.id) {
          return false
        }

        const normalizedCandidatePath = Path.normalize(
          Path.resolve(candidate.path)
        )
        return __WIN32__
          ? normalizedCandidatePath.toLocaleLowerCase() ===
              normalizedParentPath.toLocaleLowerCase()
          : normalizedCandidatePath === normalizedParentPath
      }) ?? null
    )
  }

  private disposeTemporaryRepositoryState(
    repository: SubmoduleRepository
  ): void {
    const state = this.repositoryStateCache.getIfPresent?.(repository)
    state?.commitMessageGenerationAbortController?.abort()
    state?.multiCommitOperationState?.copilotResolutionAbortController?.abort()

    this.mergeAllControllers?.get(repository.id)?.abort()
    this.mergeAllControllers?.delete(repository.id)
    this.cheapLfsMaterializeControllers?.get(repository.id)?.abort()
    this.cheapLfsMaterializeControllers?.delete(repository.id)

    this.gitStoreCache.remove(repository)
    this.repositoryStateCache.remove(repository)
    this.localRepositoryStateLookup.delete(repository.id)
  }

  private async assertTemporaryRepositoryIsSafe(
    repository: Repository
  ): Promise<void> {
    if (!isSubmoduleRepository(repository)) {
      return
    }

    try {
      await revalidateSubmoduleRepository(repository)
    } catch (error) {
      if (this.selectedRepository === repository) {
        const parent = this.getCurrentSubmoduleParent(repository)
        const fallback = parent ?? this.repositories[0] ?? null
        await this._selectRepository(fallback, false).catch(selectionError =>
          log.error(
            'Unable to leave an invalid temporary submodule workspace',
            selectionError
          )
        )
      }
      this.disposeTemporaryRepositoryState(repository)
      throw new Error(
        t('submodule.workspaceUnsafe', {
          parent: repository.parentRepository.name,
          error: String(error),
        })
      )
    }
  }

  /**
   * Revalidate a temporary child at the last asynchronous boundary before a
   * Git mutation. Normal repositories intentionally take the direct path.
   */
  private async withTemporaryRepositoryMutationGuard<T>(
    repository: Repository,
    mutation: () => Promise<T>
  ): Promise<T> {
    if (isSubmoduleRepository(repository)) {
      await this.assertTemporaryRepositoryIsSafe(repository)
      if (this.selectedRepository !== repository) {
        throw new Error(
          'The temporary submodule workspace is no longer selected.'
        )
      }
    }

    return mutation()
  }

  private isTemporaryRepositoryActive(repository: Repository): boolean {
    return (
      !isSubmoduleRepository(repository) ||
      this.selectedRepository === repository
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _selectRepository(
    repository: Repository | CloningRepository | null,
    persistSelection: boolean = true,
    allowSubmoduleRepository: boolean = false
  ): Promise<Repository | null> {
    if (isSubmoduleRepository(repository) && !allowSubmoduleRepository) {
      const parent = this.getCurrentSubmoduleParent(repository)
      if (parent === null) {
        throw new Error(
          'The parent repository for this temporary submodule is no longer available.'
        )
      }
      repository = parent
    }

    const previouslySelectedRepository = this.selectedRepository

    // do this quick check to see if we have a tutorial repository
    // cause if its not we can quickly hide the tutorial pane
    // in the first `emitUpdate` below
    const previouslyInTutorial =
      this.currentOnboardingTutorialStep !== TutorialStep.NotApplicable
    if (
      previouslyInTutorial &&
      (!(repository instanceof Repository) || !repository.isTutorialRepository)
    ) {
      this.currentOnboardingTutorialStep = TutorialStep.NotApplicable
    }

    this.selectedRepository = repository
    if (!isSubmoduleRepository(repository)) {
      this.maybePromoteAccountForRepository(repository)
    }
    // Never display the previous workspace's appearance while the newly
    // selected repository's local config is loading.
    this.repositoryAppearanceOverrides = {}

    this.emitUpdate()
    this.stopBackgroundFetching()
    this.stopAutomationScheduler()
    this.stopPullRequestUpdater()
    this._clearBanner()
    this.stopBackgroundPruner()

    if (
      isSubmoduleRepository(previouslySelectedRepository) &&
      previouslySelectedRepository !== repository
    ) {
      this.disposeTemporaryRepositoryState(previouslySelectedRepository)
    }

    if (repository == null) {
      return Promise.resolve(null)
    }

    if (!(repository instanceof Repository)) {
      return Promise.resolve(null)
    }

    if (persistSelection && !isSubmoduleRepository(repository)) {
      setNumber(LastSelectedRepositoryIDKey, repository.id)
    }

    if (!isSubmoduleRepository(repository)) {
      const previousRepositoryId = isSubmoduleRepository(
        previouslySelectedRepository
      )
        ? previouslySelectedRepository.parentRepository.id
        : previouslySelectedRepository
        ? previouslySelectedRepository.id
        : null

      this.updateRecentRepositories(previousRepositoryId, repository.id)
    }

    // if repository might be marked missing, try checking if it has been restored
    const refreshedRepository = await this.recoverMissingRepository(repository)
    if (refreshedRepository.missing) {
      // as the repository is no longer found on disk, cleaning this up
      // ensures we don't accidentally run any Git operations against the
      // wrong location if the user then relocates the `.git` folder elsewhere
      this.gitStoreCache.remove(repository)
      return Promise.resolve(null)
    }

    try {
      const overrides = await getRepositoryAppearanceOverrides(
        refreshedRepository
      )
      // Repository selection is re-entrant. Discard an async config result if
      // the user moved to another repository while Git was reading it.
      if (this.selectedRepository !== repository) {
        return null
      }
      this.repositoryAppearanceOverrides = overrides
      this.emitUpdate()
    } catch (error) {
      log.warn(
        `Unable to load appearance customization for ${refreshedRepository.path}`,
        error
      )
    }

    // The appearance read can also reject after a re-entrant selection. Keep
    // the same stale-selection fence on that path before notifications or any
    // repository refresh work can observe the old temporary workspace.
    if (this.selectedRepository !== repository) {
      return null
    }

    // This is now purely for metrics collection for `commitsToRepositoryWithBranchProtections`
    // Understanding how many users actually contribute to repos with branch protections gives us
    // insight into who our users are and what kinds of work they do
    if (!isSubmoduleRepository(repository)) {
      this.updateBranchProtectionsFromAPI(repository)
    }

    this.notificationsStore.selectRepository(repository)

    return this._selectRepositoryRefreshTasks(
      refreshedRepository,
      previouslySelectedRepository
    )
  }

  // update the stored list of recently opened repositories
  private updateRecentRepositories(
    previousRepositoryId: number | null,
    currentRepositoryId: number
  ) {
    // No need to update the recent repositories if the selected repository is
    // the same as the old one (this could happen when the alias of the selected
    // repository is changed).
    if (previousRepositoryId === currentRepositoryId) {
      return
    }

    const recentRepositories = getNumberArray(RecentRepositoriesKey).filter(
      el => el !== currentRepositoryId && el !== previousRepositoryId
    )
    if (previousRepositoryId !== null) {
      recentRepositories.unshift(previousRepositoryId)
    }
    const slicedRecentRepositories = recentRepositories.slice(
      0,
      RecentRepositoriesLength
    )
    setNumberArray(RecentRepositoriesKey, slicedRecentRepositories)
    this.recentRepositories = slicedRecentRepositories
    this.notificationsStore.setRecentRepositories(
      this.repositories.filter(r => this.recentRepositories.includes(r.id))
    )
    this.emitUpdate()
  }

  // finish `_selectRepository`s refresh tasks
  private async _selectRepositoryRefreshTasks(
    repository: Repository,
    previouslySelectedRepository: Repository | CloningRepository | null
  ): Promise<Repository | null> {
    // Temporary submodule workspaces intentionally have no database record or
    // remote association. A foreground refresh is enough; starting persistent
    // automation, API matching, pruning, or cheap-LFS work with their negative
    // IDs could leak the temporary model into repository-backed state. Await
    // the initial refresh so Back cannot dispose the workspace while refresh
    // tasks still hold its store and state references.
    if (isSubmoduleRepository(repository)) {
      await this._refreshRepository(repository)
      return this.selectedRepository === repository ? repository : null
    }

    this._refreshRepository(repository)

    if (isRepositoryWithGitHubRepository(repository)) {
      // Load issues from the upstream or fork depending
      // on workflow preferences.
      const ghRepo = getNonForkGitHubRepository(repository)

      this._refreshIssues(ghRepo)
      this.refreshMentionables(ghRepo)

      this.pullRequestCoordinator.getAllPullRequests(repository).then(prs => {
        this.onPullRequestChanged(repository, prs)
      })
    }

    // The selected repository could have changed while we were refreshing.
    if (this.selectedRepository !== repository) {
      return null
    }

    // "Clone in Desktop" from a cold start can trigger this twice, and
    // for edge cases where _selectRepository is re-entract, calling this here
    // ensures we clean up the existing background fetcher correctly (if set)
    this.stopBackgroundFetching()
    this.stopAutomationScheduler()
    this.stopPullRequestUpdater()
    this.stopBackgroundPruner()

    this.startBackgroundFetching(repository, !previouslySelectedRepository)
    this.startAutomationScheduler(repository)
    this.startPullRequestUpdater(repository)

    this.startBackgroundPruner(repository)

    this.addUpstreamRemoteIfNeeded(repository)

    // Detect point: opening a repository may reveal committed cheap-LFS
    // pointers to auto-materialize. Re-entrant, so re-check the selection.
    void this.maybeAutoMaterializeCheapLfs(repository, {
      requireSelected: true,
    })

    return this.repositoryWithRefreshedGitHubRepository(repository)
  }

  private stopBackgroundPruner() {
    const pruner = this.currentBranchPruner

    if (pruner !== null) {
      pruner.stop()
      this.currentBranchPruner = null
    }
  }

  private startBackgroundPruner(repository: Repository) {
    if (this.currentBranchPruner !== null) {
      fatalError(
        `A branch pruner is already active and cannot start updating on ${repository.name}`
      )
    }

    const pruner = new BranchPruner(
      repository,
      this.gitStoreCache,
      this.repositoriesStore,
      this.repositoryStateCache,
      repository => this._refreshRepository(repository)
    )
    this.currentBranchPruner = pruner
    this.currentBranchPruner.start()
  }

  public async _refreshIssues(repository: GitHubRepository) {
    const user = getAccountForEndpoint(this.accounts, repository.endpoint)
    if (!user) {
      return
    }

    try {
      await this.issuesStore.refreshIssues(repository, user)
    } catch (e) {
      log.warn(`Unable to fetch issues for ${repository.fullName}`, e)
    }
  }

  private stopBackgroundFetching() {
    const backgroundFetcher = this.currentBackgroundFetcher
    if (backgroundFetcher) {
      backgroundFetcher.stop()
      this.currentBackgroundFetcher = null
    }
  }

  private stopAutomationScheduler(): void {
    this.currentAutomationScheduler?.stop()
    this.currentAutomationScheduler = null
  }

  private restartAutomationScheduler(): void {
    this.stopAutomationScheduler()
    if (
      this.selectedRepository instanceof Repository &&
      !isSubmoduleRepository(this.selectedRepository)
    ) {
      this.startAutomationScheduler(this.selectedRepository)
    }
  }

  private startAutomationScheduler(repository: Repository): void {
    this.stopAutomationScheduler()
    if (isSubmoduleRepository(repository)) {
      return
    }
    const repositoryAccount = getAccountForRepository(this.accounts, repository)
    const accountKey =
      repository.accountKey ??
      (repositoryAccount === null ? null : getAccountKey(repositoryAccount))
    this.currentAutomationScheduler = new AutomationScheduler(
      () =>
        resolveAutomationSettings(
          this.automationSettings,
          accountKey,
          loadRepositoryAutomationOverrides(repository.id)
        ),
      () => this.runScheduledCommitPush(repository),
      () => this.runScheduledPull(repository),
      (operation, error) => {
        const normalizedError =
          error instanceof Error ? error : new Error(String(error))
        log.error(`Scheduled automation ${operation} failed`, normalizedError)
        this.postNotification({
          kind: operation === 'pull' ? 'auto-pull' : 'auto-commit',
          title:
            operation === 'pull'
              ? 'Automatic pull failed'
              : 'Automatic commit failed',
          body: normalizedError.message,
          repositoryId: repository.id,
          action: { kind: 'open-repository', repositoryId: repository.id },
        })
      }
    )
    this.currentAutomationScheduler.start()
  }

  private async runScheduledCommitPush(repository: Repository): Promise<void> {
    if (this.selectedRepository !== repository) {
      return
    }
    await this._refreshRepository(repository)
    const guard = canAutoCommitPush(this.getAutomationGuardState(repository))
    if (!guard.safe) {
      log.info(`Automatic commit and push skipped: ${guard.reason}`)
      return
    }
    await this.performScheduledCommitPush(repository)
  }

  private async runScheduledPull(repository: Repository): Promise<void> {
    if (this.selectedRepository !== repository) {
      return
    }
    await this._refreshRepository(repository)
    const mergeHeadSet = await isMergeHeadSet(repository)
    const guard = canAutoPull(
      this.getAutomationGuardState(repository, mergeHeadSet)
    )
    if (!guard.safe) {
      log.info(`Automatic pull skipped: ${guard.reason}`)
      return
    }

    await this.performScheduledPull(repository)
    this.postNotification({
      kind: 'auto-pull',
      title: 'Automatic pull completed',
      body: `Updated ${repository.name}.`,
      repositoryId: repository.id,
      action: { kind: 'open-repository', repositoryId: repository.id },
    })
  }

  private async performScheduledCommitPush(
    repository: Repository
  ): Promise<void> {
    const initial = this.repositoryStateCache.get(repository)
    const files = initial.changesState.workingDirectory.files
    let context = buildFallbackCommitMessage(files, new Date())

    try {
      this.setOneClickCommitPushPhase(repository, 'generating')
      context =
        (await this.generateAutomationCommitMessage(repository, files)) ??
        context
      await this._changeIncludeAllFiles(repository, true)
      this.setOneClickCommitPushPhase(repository, 'committing')
      // Keep scheduled commits on the same path as the commit composer. Besides
      // preserving hook and selection behavior, this is where oversized files
      // are replaced with cheap-LFS pointers before Git creates the commit.
      const committed = await this._commitIncludedChanges(repository, context)
      if (!committed) {
        throw new Error('The automatic commit did not complete.')
      }
      await this._refreshRepository(repository)

      this.setOneClickCommitPushPhase(repository, 'pushing')
      await this.performScheduledPush(repository)
      this.postNotification({
        kind: 'auto-commit',
        title: 'Automatic commit and push completed',
        body: context.summary,
        repositoryId: repository.id,
        action: { kind: 'open-repository', repositoryId: repository.id },
      })
    } finally {
      this.setOneClickCommitPushPhase(repository, null)
    }
  }

  private async performScheduledPush(repository: Repository): Promise<void> {
    const state = this.repositoryStateCache.get(repository)
    const remote = state.remote
    const tip = state.branchesState.tip
    if (remote === null || tip.kind !== TipState.Valid) {
      throw new Error('The current branch has no push remote.')
    }
    if (state.isPushPullFetchInProgress) {
      throw new Error('Another network operation is already in progress.')
    }
    const remoteName = tip.branch.upstreamRemoteName ?? remote.name
    const pushedBranchName = tip.branch.upstreamWithoutRemote ?? tip.branch.name
    const safeRemote: IRemote = { name: remoteName, url: remote.url }
    const gitStore = this.gitStoreCache.get(repository)

    await this.withPushPullFetch(repository, async () => {
      await pushRepo(
        repository,
        safeRemote,
        tip.branch.name,
        tip.branch.upstreamWithoutRemote,
        gitStore.tagsToPush,
        { onHookFailure: async () => 'abort' }
      )
      gitStore.clearTagsToPush()
      await this._refreshRepository(repository)
      await this.deployDockerAfterPush(repository, remoteName, pushedBranchName)
    })
  }

  private async performScheduledPull(repository: Repository): Promise<void> {
    const state = this.repositoryStateCache.get(repository)
    const remote = state.remote
    if (remote === null) {
      throw new Error('The current branch has no pull remote.')
    }
    if (state.isPushPullFetchInProgress) {
      throw new Error('Another network operation is already in progress.')
    }

    await this.withPushPullFetch(repository, async () => {
      // This path deliberately bypasses performFailableOperation: scheduler
      // failures are logged and posted to the notification centre, never
      // promoted to an interrupting error dialog.
      await pullRepo(repository, remote)
      await updateRemoteHEAD(repository, remote, false).catch(error =>
        log.error(
          'Failed updating remote HEAD after automatic pull',
          error instanceof Error ? error : new Error(String(error))
        )
      )
      await this._refreshRepository(repository)
    })
  }

  private refreshMentionables(repository: GitHubRepository) {
    const account = getAccountForEndpoint(this.accounts, repository.endpoint)
    if (!account) {
      return
    }

    this.gitHubUserStore.updateMentionables(repository, account)
  }

  private startPullRequestUpdater(repository: Repository) {
    // We don't want to run the pull request updater when the app is in
    // the background.
    if (this.appIsFocused && isRepositoryWithGitHubRepository(repository)) {
      const account = getAccountForRepository(this.accounts, repository)
      if (account !== null) {
        return this.pullRequestCoordinator.startPullRequestUpdater(
          repository,
          account
        )
      }
    }
    // we always want to stop the current one, to be safe
    this.pullRequestCoordinator.stopPullRequestUpdater()
  }

  private stopPullRequestUpdater() {
    this.pullRequestCoordinator.stopPullRequestUpdater()
  }

  public async fetchPullRequest(repoUrl: string, pr: string) {
    const account = await findAccountForRemoteURL(repoUrl, this.accounts)

    if (account) {
      const api = API.fromAccount(account)
      const remoteUrl = parseRemote(repoUrl)
      if (remoteUrl && remoteUrl.owner && remoteUrl.name) {
        return await api.fetchPullRequest(remoteUrl.owner, remoteUrl.name, pr)
      }
    }
    return null
  }

  private async shouldBackgroundFetch(
    repository: Repository,
    lastPush: Date | null
  ): Promise<boolean> {
    const gitStore = this.gitStoreCache.get(repository)
    const lastFetched = await gitStore.updateLastFetched()

    if (lastFetched === null) {
      return true
    }

    const now = new Date()
    const timeSinceFetch = now.getTime() - lastFetched.getTime()
    const repoName = nameOf(repository)
    if (timeSinceFetch < BackgroundFetchMinimumInterval) {
      const timeInSeconds = Math.floor(timeSinceFetch / 1000)

      log.debug(
        `Skipping background fetch as '${repoName}' was fetched ${timeInSeconds}s ago`
      )
      return false
    }

    if (lastPush === null) {
      return true
    }

    // we should fetch if the last push happened after the last fetch
    if (lastFetched < lastPush) {
      return true
    }

    log.debug(
      `Skipping background fetch since nothing has been pushed to '${repoName}' since the last fetch at ${lastFetched}`
    )

    return false
  }

  private startBackgroundFetching(
    repository: Repository,
    withInitialSkew: boolean
  ) {
    if (this.currentBackgroundFetcher) {
      fatalError(
        `We should only have on background fetcher active at once, but we're trying to start background fetching on ${repository.name} while another background fetcher is still active!`
      )
    }

    if (!repository.gitHubRepository) {
      return
    }

    // Todo: add logic to background checker to check the API before fetching
    // similar to what's being done in `refreshAllIndicators`
    const fetcher = new BackgroundFetcher(
      repository,
      this.accountsStore,
      r => this._fetch(r, FetchType.BackgroundTask),
      r => this.shouldBackgroundFetch(r, null)
    )
    fetcher.start(withInitialSkew)
    this.currentBackgroundFetcher = fetcher
  }

  /** Load the initial state for the app. */
  public async loadInitialState() {
    const [accounts, repositories] = await Promise.all([
      this.accountsStore.getAll(),
      this.repositoriesStore.getAll(),
    ])

    log.info(
      `[AppStore] loading ${repositories.length} repositories from store`
    )
    accounts.forEach(a => {
      log.info(`[AppStore] found account: ${a.login} (${a.name})`)
    })

    this.accounts = accounts
    this.repositories = repositories

    this.updateRepositorySelectionAfterRepositoriesChanged()

    this.sidebarWidth = constrain(
      getNumber(sidebarWidthConfigKey, defaultSidebarWidth)
    )
    this.commitSummaryWidth = constrain(
      getNumber(commitSummaryWidthConfigKey, defaultCommitSummaryWidth)
    )
    this.stashedFilesWidth = constrain(
      getNumber(stashedFilesWidthConfigKey, defaultStashedFilesWidth)
    )
    this.pullRequestFileListWidth = constrain(
      getNumber(pullRequestFileListConfigKey, defaultPullRequestFileListWidth)
    )
    this.branchDropdownWidth = constrain(
      getNumber(branchDropdownWidthConfigKey, defaultBranchDropdownWidth)
    )
    this.worktreeDropdownWidth = constrain(
      getNumber(worktreeDropdownWidthConfigKey, defaultWorktreeDropdownWidth)
    )
    this.pushPullButtonWidth = constrain(
      getNumber(pushPullButtonWidthConfigKey, defaultPushPullButtonWidth)
    )

    this.updateResizableConstraints()
    // TODO: Initiliaze here for now... maybe move to dialog mounting
    this.updatePullRequestResizableConstraints()

    this.askToMoveToApplicationsFolderSetting = getBoolean(
      askToMoveToApplicationsFolderKey,
      askToMoveToApplicationsFolderDefault
    )

    this.useExternalCredentialHelper = useExternalCredentialHelper()

    this.askForConfirmationOnRepositoryRemoval = getBoolean(
      confirmRepoRemovalKey,
      confirmRepoRemovalDefault
    )

    // We're planning to flip the default value to false. As such we'll
    // start persisting the current behavior to localstorage, so we
    // can change the default in the future without affecting current
    // users by removing this if statement.
    if (getBoolean(showCommitLengthWarningKey) === undefined) {
      setBoolean(showCommitLengthWarningKey, true)
    }

    this.showCommitLengthWarning = getBoolean(
      showCommitLengthWarningKey,
      showCommitLengthWarningDefault
    )

    this.confirmDiscardChanges = getBoolean(
      confirmDiscardChangesKey,
      confirmDiscardChangesDefault
    )

    this.confirmDiscardChangesPermanently = getBoolean(
      confirmDiscardChangesPermanentlyKey,
      confirmDiscardChangesPermanentlyDefault
    )

    this.confirmDiscardStash = getBoolean(
      confirmDiscardStashKey,
      confirmDiscardStashDefault
    )

    this.confirmCheckoutCommit = getBoolean(
      confirmCheckoutCommitKey,
      confirmCheckoutCommitDefault
    )

    this.askForConfirmationOnForcePush = getBoolean(
      confirmForcePushKey,
      askForConfirmationOnForcePushDefault
    )

    this.confirmUndoCommit = getBoolean(
      confirmUndoCommitKey,
      confirmUndoCommitDefault
    )

    this.confirmCommitFilteredChanges = getBoolean(
      confirmCommitFilteredChangesKey,
      confirmCommitFilteredChangesDefault
    )

    this.confirmCommitMessageOverride = getBoolean(
      confirmCommitMessageOverrideKey,
      confirmCommitMessageOverrideDefault
    )

    this.confirmWorktreeRemoval = getBoolean(
      confirmWorktreeRemovalKey,
      confirmWorktreeRemovalDefault
    )

    this.autoSwitchAccountToRepositoryOwner = getBoolean(
      autoSwitchAccountToRepositoryOwnerKey,
      autoSwitchAccountToRepositoryOwnerDefault
    )

    this.errorPresentationStyle = getErrorPresentationStyle()

    this.uncommittedChangesStrategy =
      getEnum(uncommittedChangesStrategyKey, UncommittedChangesStrategy) ??
      defaultUncommittedChangesStrategy

    this.updateSelectedExternalEditor(
      await this.lookupSelectedExternalEditor()
    ).catch(e => log.error('Failed resolving current editor at startup', e))

    const shellValue = localStorage.getItem(shellKey)
    this.selectedShell = shellValue ? parseShell(shellValue) : DefaultShell

    this.updateMenuLabelsForSelectedRepository()

    const imageDiffTypeValue = localStorage.getItem(imageDiffTypeKey)
    this.imageDiffType =
      imageDiffTypeValue === null
        ? imageDiffTypeDefault
        : parseInt(imageDiffTypeValue)

    this.hideWhitespaceInChangesDiff = getBoolean(
      hideWhitespaceInChangesDiffKey,
      false
    )
    this.hideWhitespaceInHistoryDiff = getBoolean(
      hideWhitespaceInHistoryDiffKey,
      false
    )
    this.hideWhitespaceInPullRequestDiff = getBoolean(
      hideWhitespaceInPullRequestDiffKey,
      false
    )
    this.commitSpellcheckEnabled = getBoolean(
      commitSpellcheckEnabledKey,
      commitSpellcheckEnabledDefault
    )
    this.showSideBySideDiff = getShowSideBySideDiff()

    this.selectedTheme = getPersistedThemeName()
    // Make sure the persisted theme is applied
    setPersistedTheme(this.selectedTheme)

    this.currentTheme = await getCurrentlyAppliedTheme()

    this.selectedTabSize = getNumber(tabSizeKey, tabSizeDefault)

    themeChangeMonitor.onThemeChanged(theme => {
      this.currentTheme = theme
      this.emitUpdate()
    })

    this.lastThankYou = getObject<ILastThankYou>(lastThankYouKey)

    this.useCustomEditor =
      enableCustomIntegration() && getBoolean(useCustomEditorKey, false)
    this.customEditor = getObject<ICustomIntegration>(customEditorKey) ?? null

    this.useCustomShell =
      enableCustomIntegration() && getBoolean(useCustomShellKey, false)
    this.customShell = getObject<ICustomIntegration>(customShellKey) ?? null
    this.branchPresetScript =
      getObject<ICustomIntegration>(branchPresetScriptKey) ?? null

    // Migrate custom editor and shell to the new format if needed. This
    // will persist the new format to local storage.
    // Hopefully we can remove this migration in the future.
    const migratedCustomEditor = migratedCustomIntegration(this.customEditor)
    if (migratedCustomEditor !== null) {
      this._setCustomEditor(migratedCustomEditor)
    }
    const migratedCustomShell = migratedCustomIntegration(this.customShell)
    if (migratedCustomShell !== null) {
      this._setCustomShell(migratedCustomShell)
    }

    this.pullRequestSuggestedNextAction =
      getEnum(
        pullRequestSuggestedNextActionKey,
        PullRequestSuggestedNextAction
      ) ?? defaultPullRequestSuggestedNextAction

    // Always false if the feature flag is disabled.
    this.underlineLinks = getBoolean(underlineLinksKey, underlineLinksDefault)

    this.showDiffCheckMarks = getBoolean(
      showDiffCheckMarksKey,
      showDiffCheckMarksDefault
    )

    this.preferAbsoluteDates = getPreferAbsoluteDates()
    this.branchSortOrder =
      getEnum(branchSortOrderKey, BranchSortOrder) ?? DefaultBranchSortOrder

    this.commitMessageGenerationDisclaimerLastSeen =
      getNumber(commitMessageGenerationDisclaimerLastSeenKey) ?? null

    this.commitMessageGenerationButtonClicked = getBoolean(
      commitMessageGenerationButtonClickedKey,
      false
    )

    this.copilotConflictResolutionDisclaimerLastSeen =
      getNumber(copilotConflictResolutionDisclaimerLastSeenKey) ?? null

    // The key was originally a boolean; migrate old `true` values to 1.
    const rawClickCount = localStorage.getItem(
      copilotConflictResolutionClickCountKey
    )
    if (rawClickCount === 'true' || rawClickCount === '1') {
      this.copilotConflictResolutionClickCount = 1
      setNumber(copilotConflictResolutionClickCountKey, 1)
    } else {
      this.copilotConflictResolutionClickCount =
        getNumber(copilotConflictResolutionClickCountKey) ?? 0
    }

    this.alwaysUseCopilotForConflictResolution = getBoolean(
      alwaysUseCopilotForConflictResolutionKey,
      false
    )

    this.showChangesFilter = getBoolean(
      showChangesFilterKey,
      showChangesFilterDefault
    )

    this.selectedCopilotModels = this.loadCopilotModelSelections()
    this.byokProviders = loadBYOKProviders()

    await this.batchCloneStore.initialize()
    await this.finalizeBatchClone()
    const recoveredBatch = this.batchCloneStore.getState()
    if (recoveredBatch?.isPaused === true) {
      const interrupted = recoveredBatch.items.filter(item => {
        const kind = recoveredBatch.statuses.get(item.path)?.kind
        return kind === 'interrupted' || kind === 'pending'
      }).length
      this.postNotification({
        kind: 'clone-batch',
        title: 'Clone queue recovered',
        body: `${interrupted} ${
          interrupted === 1 ? 'repository needs' : 'repositories need'
        } to be resumed after the previous app session ended. Existing destination data will be inspected, never deleted.`,
      })
      if (recoveredBatch.source === 'manual') {
        void this._showPopup({ type: PopupType.BatchCloneProgress })
      }
    }
    this.autoCloneStore.start()

    this.emitUpdateNow()

    this.accountsStore.refresh()
    void this.auditAccountOAuthScopes()

    this.updateMenuLabelsForSelectedRepository()
  }

  /**
   * Detect signed-in GitHub accounts whose tokens predate the scopes the
   * app's current features need (e.g. Releases requires the full `repo`
   * grant) and offer a re-authorization once per account per session.
   */
  private async auditAccountOAuthScopes(): Promise<void> {
    const accounts = await this.accountsStore.getAll()

    for (const account of accounts) {
      if (account.provider !== undefined && account.provider !== 'github') {
        continue
      }
      const key = getAccountKey(account)
      if (this.scopeAuditedAccounts.has(key)) {
        continue
      }
      this.scopeAuditedAccounts.add(key)

      try {
        const api = API.fromAccount(account)
        const header = await api.fetchGrantedOAuthScopes()
        if (header === null || header.length === 0) {
          // Fine-grained tokens and some proxies report no scopes; there is
          // nothing reliable to compare against.
          continue
        }
        const missing = missingRequiredScopes(parseGrantedScopes(header))
        if (missing.length > 0) {
          this._showPopup({
            type: PopupType.InsufficientOAuthScopes,
            account,
            missingScopes: missing,
          })
          return
        }
      } catch (e) {
        log.debug(
          `Scope audit for ${account.login} failed; skipping until next launch`,
          e
        )
      }
    }
  }

  /**
   * Determine whether the worktree dropdown is currently shown in the toolbar.
   *
   * This mirrors the render condition in `App.renderWorktreeToolbarButton`: the
   * dropdown is shown when worktree support is enabled and either the selected
   * repository has at least one linked worktree (i.e. more than just the main
   * worktree) or the worktree foldout is currently open (which lets the user
   * create their first worktree from the toolbar).
   */
  private isWorktreeDropdownVisible(): boolean {
    if (!enableWorktreeSupport()) {
      return false
    }

    if (this.currentFoldout?.type === FoldoutType.Worktree) {
      return true
    }

    const repository = this.selectedRepository
    const worktreeCount =
      repository instanceof Repository
        ? this.repositoryStateCache.get(repository).worktrees.length
        : 0
    return worktreeCount > 1
  }

  /**
   * Calculate the constraints of our resizable panes whenever the window
   * dimensions change.
   */
  private updateResizableConstraints() {
    const showWorktreeDropdown = this.isWorktreeDropdownVisible()

    // The combined width of the toolbar buttons (worktree, branch, push/pull).
    // Since the repository list toolbar button width is tied to the width of
    // the sidebar we can't let it push these buttons off screen.
    const toolbarButtonsMinWidth =
      defaultPushPullButtonWidth +
      defaultBranchDropdownWidth +
      (showWorktreeDropdown ? defaultWorktreeDropdownWidth : 0)
    const numButtons = 2 + (showWorktreeDropdown ? 1 : 0)

    // Start with all the available width
    let available = window.innerWidth

    // // The tutorial currently has a fixed-width sidebar which we have to account
    // // for so it makes sense to limit the width of the file list in order to
    // // give the tutorial enough space to show its content.
    const tutorialMinWidth =
      this.currentOnboardingTutorialStep === TutorialStep.NotApplicable
        ? 0
        : 650

    // Working our way from left to right (i.e. giving priority to the leftmost
    // pane when we need to constrain the width)
    //
    // 220 was determined as the minimum value since it is the smallest width
    // that will still fit the placeholder text in the branch selector textbox
    // of the history tab
    const maxSidebarWidth =
      available - Math.max(toolbarButtonsMinWidth, tutorialMinWidth)
    this.sidebarWidth = constrain(this.sidebarWidth, 220, maxSidebarWidth)

    // Now calculate the width we have left to distribute for the other panes
    available -= clamp(this.sidebarWidth)

    // This is a pretty silly width for a diff but it will fit ~9 chars per line
    // in unified mode after subtracting the width of the unified gutter and ~4
    // chars per side in split diff mode. No one would want to use it this way
    // but it doesn't break the layout and it allows users to temporarily
    // maximize the width of the file list to see long path names.
    const diffPaneMinWidth = 150
    const filesMax = available - diffPaneMinWidth

    this.commitSummaryWidth = constrain(this.commitSummaryWidth, 100, filesMax)
    this.stashedFilesWidth = constrain(this.stashedFilesWidth, 100, filesMax)

    // Allocate worktree first (highest priority), then branch, then
    // push-pull. The foldouts are laid out in this order, so the width
    // constraints should follow the same order. Each subsequent allocation
    // uses the clamped value of the previous to prevent the total from
    // exceeding the available space.
    const worktreeDropdownMax =
      available - defaultBranchDropdownWidth - defaultPushPullButtonWidth
    this.worktreeDropdownWidth = constrain(
      this.worktreeDropdownWidth,
      Math.min(available / numButtons - 10, 170),
      worktreeDropdownMax
    )

    const branchDropdownMax =
      available -
      (showWorktreeDropdown ? clamp(this.worktreeDropdownWidth) : 0) -
      defaultPushPullButtonWidth
    const minimumBranchDropdownWidth =
      defaultBranchDropdownWidth > available / numButtons
        ? available / numButtons - 10
        : defaultBranchDropdownWidth
    this.branchDropdownWidth = constrain(
      this.branchDropdownWidth,
      minimumBranchDropdownWidth,
      branchDropdownMax
    )

    const pushPullButtonMaxWidth =
      available -
      clamp(this.branchDropdownWidth) -
      (showWorktreeDropdown ? clamp(this.worktreeDropdownWidth) : 0)
    const minimumPushPullToolBarWidth =
      defaultPushPullButtonWidth > available / numButtons
        ? available / numButtons
        : defaultPushPullButtonWidth
    this.pushPullButtonWidth = constrain(
      this.pushPullButtonWidth,
      minimumPushPullToolBarWidth,
      pushPullButtonMaxWidth
    )
  }

  /**
   * Calculate the constraints of the resizable pane in the pull request dialog
   * whenever the window dimensions change.
   */
  private updatePullRequestResizableConstraints() {
    // TODO: Get width of PR dialog -> determine if we will have default width
    // for pr dialog. The goal is for it expand to fill some percent of
    // available window so it will change on window resize. We may have some max
    // value and min value of where to derive a default is we cannot obtain the
    // width for some reason (like initialization nad no pr dialog is open)
    // Thoughts -> ß
    // 1. Use dialog id to grab dialog if exists, else use default
    // 2. Pass dialog width up when and call this contrainst on dialog mounting
    //    to initialize and subscribe to window resize inside dialog to be able
    //    to pass up dialog width on window resize.

    // Get the width of the dialog
    const available = 850
    const dialogPadding = 20

    // This is a pretty silly width for a diff but it will fit ~9 chars per line
    // in unified mode after subtracting the width of the unified gutter and ~4
    // chars per side in split diff mode. No one would want to use it this way
    // but it doesn't break the layout and it allows users to temporarily
    // maximize the width of the file list to see long path names.
    const diffPaneMinWidth = 150
    const filesListMax = available - dialogPadding - diffPaneMinWidth

    this.pullRequestFileListWidth = constrain(
      this.pullRequestFileListWidth,
      100,
      filesListMax
    )
  }

  private updateSelectedExternalEditor(
    selectedEditor: string | null
  ): Promise<void> {
    this.selectedExternalEditor = selectedEditor

    // Make sure we keep the resolved (cached) editor
    // in sync when the user changes their editor choice.
    return this._resolveCurrentEditor()
  }

  private async lookupSelectedExternalEditor(): Promise<string | null> {
    const editors = (await getAvailableEditors()).map(found => found.editor)

    const value = localStorage.getItem(externalEditorKey)
    // ensure editor is still installed
    if (value && editors.includes(value)) {
      return value
    }

    if (editors.length) {
      const value = editors[0]
      // store this value to avoid the lookup next time
      localStorage.setItem(externalEditorKey, value)
      return value
    }

    return null
  }

  /**
   * Update menu labels for the selected repository.
   *
   * If selected repository type is a `CloningRepository` or
   * `MissingRepository`, the menu labels will be updated but they will lack
   * the expected `IRepositoryState` and revert to the default values.
   */
  private updateMenuLabelsForSelectedRepository() {
    const { selectedState } = this.getState()

    if (
      selectedState !== null &&
      selectedState.type === SelectionType.Repository
    ) {
      this.updateMenuItemLabels(selectedState.state)
    } else {
      this.updateMenuItemLabels(null)
    }
  }

  /**
   * Update the menus in the main process using the provided repository state
   *
   * @param state the current repository state, or `null` if the repository is
   *              being cloned or is missing
   */
  private updateMenuItemLabels(state: IRepositoryState | null) {
    const {
      useCustomShell,
      selectedShell,
      selectedRepository,
      askForConfirmationOnRepositoryRemoval,
      askForConfirmationOnForcePush,
    } = this

    const editorOverride =
      selectedRepository instanceof Repository &&
      selectedRepository.customEditorOverride !== null
        ? selectedRepository.customEditorOverride
        : null
    const editorUsesCustom =
      editorOverride?.useCustomEditor ?? this.useCustomEditor
    const editorName = editorOverride
      ? editorOverride.selectedExternalEditor
      : this.selectedExternalEditor

    const labels: MenuLabelsEvent = {
      selectedShell: useCustomShell ? null : selectedShell,
      selectedExternalEditor: editorUsesCustom ? null : editorName,
      askForConfirmationOnRepositoryRemoval,
      askForConfirmationOnForcePush,
    }

    if (state === null) {
      updatePreferredAppMenuItemLabels(labels)
      return
    }

    const { changesState, branchesState, aheadBehind } = state
    const { currentPullRequest } = branchesState

    let contributionTargetDefaultBranch: string | undefined
    if (selectedRepository instanceof Repository) {
      contributionTargetDefaultBranch =
        findContributionTargetDefaultBranch(selectedRepository, branchesState)
          ?.name ?? undefined
    }

    // From the menu, we'll offer to force-push whenever it's possible, regardless
    // of whether or not the user performed any action we know would be followed
    // by a force-push.
    const isForcePushForCurrentRepository =
      getCurrentBranchForcePushState(branchesState, aheadBehind) !==
      ForcePushBranchState.NotAvailable

    const isStashedChangesVisible =
      changesState.selection.kind === ChangesSelectionKind.Stash

    // Multiple stashes are additive, so creating another never needs an
    // overwrite warning.
    const askForConfirmationWhenStashingAllChanges = false

    updatePreferredAppMenuItemLabels({
      ...labels,
      contributionTargetDefaultBranch,
      isForcePushForCurrentRepository,
      isStashedChangesVisible,
      hasCurrentPullRequest: currentPullRequest !== null,
      askForConfirmationWhenStashingAllChanges,
      isChangesFilterVisible: this.showChangesFilter,
    })
  }

  private updateRepositorySelectionAfterRepositoriesChanged() {
    const selectedRepository = this.selectedRepository
    let newSelectedRepository: Repository | CloningRepository | null =
      this.selectedRepository
    if (selectedRepository) {
      const r = isSubmoduleRepository(selectedRepository)
        ? this.getCurrentSubmoduleParent(selectedRepository) === null
          ? null
          : selectedRepository
        : this.repositories.find(
            r =>
              r.constructor === selectedRepository.constructor &&
              r.id === selectedRepository.id
          ) || null

      newSelectedRepository = r
    }

    if (newSelectedRepository === null && this.repositories.length > 0) {
      const lastSelectedID = getNumber(LastSelectedRepositoryIDKey, 0)
      if (lastSelectedID > 0) {
        newSelectedRepository =
          this.repositories.find(r => r.id === lastSelectedID) || null
      }

      if (!newSelectedRepository) {
        newSelectedRepository = this.repositories[0]
      }
    }

    const repositoryChanged =
      (selectedRepository &&
        newSelectedRepository &&
        selectedRepository.hash !== newSelectedRepository.hash) ||
      (selectedRepository && !newSelectedRepository) ||
      (!selectedRepository && newSelectedRepository)
    if (repositoryChanged) {
      this._selectRepository(newSelectedRepository)
      this.emitUpdate()
    }
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _loadStatus(
    repository: Repository,
    clearPartialState: boolean = false
  ): Promise<IStatusResult | null> {
    const gitStore = this.gitStoreCache.get(repository)
    const status = await gitStore.loadStatus()

    if (status === null || !this.isTemporaryRepositoryActive(repository)) {
      return null
    }

    this.repositoryStateCache.updateChangesState(repository, state =>
      updateChangedFiles(state, status, clearPartialState)
    )

    this.repositoryStateCache.updateChangesState(repository, state => ({
      conflictState: updateConflictState(state, status, this.statsStore),
    }))

    this.updateMultiCommitOperationConflictsIfFound(repository)
    await this.initializeMultiCommitOperationIfConflictsFound(
      repository,
      status
    )

    if (!this.isTemporaryRepositoryActive(repository)) {
      return null
    }

    if (this.selectedRepository === repository) {
      this._triggerConflictsFlow(repository, status)
    }

    this.emitUpdate()

    // A commit can spend time hashing and uploading a large cheap-LFS file.
    // Status refreshes during those pre-Git phases must not repeatedly spawn a
    // full-file `git diff` against the original multi-gigabyte binary. Once the
    // real Git commit starts, refresh the diff normally so the post-commit
    // selection cannot retain stale content.
    const commitState = this.repositoryStateCache.get(repository)
    if (
      !commitState.isCommitting ||
      commitState.commitOperationPhase?.kind === 'git-commit'
    ) {
      this.updateChangesWorkingDirectoryDiff(repository)
    }

    return status
  }

  /**
   * This method is to initialize a multi commit operation state on app load
   * if conflicts are found but not multi commmit operation exists.
   */
  private async initializeMultiCommitOperationIfConflictsFound(
    repository: Repository,
    status: IStatusResult
  ) {
    const state = this.repositoryStateCache.get(repository)
    const {
      changesState: { conflictState },
      multiCommitOperationState,
      branchesState,
    } = state

    if (conflictState === null) {
      this.clearConflictsFlowVisuals(state)
      return
    }

    if (multiCommitOperationState !== null) {
      return
    }

    let operationDetail: MultiCommitOperationDetail
    let targetBranch: Branch | null = null
    let commits: ReadonlyArray<Commit | CommitOneLine> = []
    let originalBranchTip: string | null = ''
    let progress: IMultiCommitOperationProgress | undefined = undefined

    if (branchesState.tip.kind === TipState.Valid) {
      targetBranch = branchesState.tip.branch
      originalBranchTip = targetBranch.tip.sha
    }

    if (isMergeConflictState(conflictState)) {
      operationDetail = {
        kind: MultiCommitOperationKind.Merge,
        isSquash: status.squashMsgFound,
        sourceBranch: null,
      }
      originalBranchTip = targetBranch !== null ? targetBranch.tip.sha : null
    } else if (isRebaseConflictState(conflictState)) {
      const snapshot = await getRebaseSnapshot(repository)
      const rebaseState = await getRebaseInternalState(repository)
      if (snapshot === null || rebaseState === null) {
        return
      }

      originalBranchTip = rebaseState.originalBranchTip
      commits = snapshot.commits
      progress = snapshot.progress
      operationDetail = {
        kind: MultiCommitOperationKind.Rebase,
        sourceBranch: null,
        commits,
        currentTip: rebaseState.baseBranchTip,
      }

      const commit = await getCommit(repository, rebaseState.originalBranchTip)

      if (commit !== null) {
        targetBranch = new Branch(
          rebaseState.targetBranch,
          null,
          commit,
          BranchType.Local,
          `refs/heads/${rebaseState.targetBranch}`
        )
      }
    } else if (isCherryPickConflictState(conflictState)) {
      const snapshot = await getCherryPickSnapshot(repository)
      if (snapshot === null || !this.isTemporaryRepositoryActive(repository)) {
        return
      }

      originalBranchTip = null
      commits = snapshot.commits
      progress = snapshot.progress
      operationDetail = {
        kind: MultiCommitOperationKind.CherryPick,
        sourceBranch: null,
        branchCreated: false,
        commits,
      }

      this.repositoryStateCache.updateMultiCommitOperationUndoState(
        repository,
        () => ({
          undoSha: snapshot.targetBranchUndoSha,
          branchName: '',
        })
      )
    } else {
      assertNever(conflictState, `Unsupported conflict kind`)
    }

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }

    this._initializeMultiCommitOperation(
      repository,
      operationDetail,
      targetBranch,
      commits,
      originalBranchTip,
      false
    )

    if (progress === undefined) {
      return
    }

    this.repositoryStateCache.updateMultiCommitOperationState(
      repository,
      () => ({
        progress: progress as IMultiCommitOperationProgress,
      })
    )
  }
  /**
   * Push changes from latest conflicts into current multi step operation step, if needed
   *  - i.e. - multiple instance of running in to conflicts
   */
  private updateMultiCommitOperationConflictsIfFound(repository: Repository) {
    const state = this.repositoryStateCache.get(repository)
    const { changesState, multiCommitOperationState } =
      this.repositoryStateCache.get(repository)
    const { conflictState } = changesState

    if (conflictState === null || multiCommitOperationState === null) {
      this.clearConflictsFlowVisuals(state)
      return
    }

    const { step, operationDetail } = multiCommitOperationState
    if (
      step.kind !== MultiCommitOperationStepKind.ShowConflicts &&
      step.kind !== MultiCommitOperationStepKind.ShowCopilotConflicts
    ) {
      return
    }

    const { manualResolutions } = conflictState

    this.repositoryStateCache.updateMultiCommitOperationState(
      repository,
      () => ({
        step: {
          ...step,
          conflictState: { ...step.conflictState, manualResolutions },
        },
      })
    )

    if (isRebaseConflictState(conflictState)) {
      const { currentTip } = conflictState
      this.repositoryStateCache.updateMultiCommitOperationState(
        repository,
        () => ({ operationDetail: { ...operationDetail, currentTip } })
      )
    }
  }

  private async _triggerConflictsFlow(
    repository: Repository,
    status: IStatusResult
  ) {
    const state = this.repositoryStateCache.get(repository)
    const {
      changesState: { conflictState },
      multiCommitOperationState,
    } = state

    if (conflictState === null) {
      this.clearConflictsFlowVisuals(state)
      return
    }

    if (multiCommitOperationState === null) {
      return
    }

    const displayingBanner =
      this.currentBanner !== null &&
      this.currentBanner.type === BannerType.ConflictsFound

    if (
      displayingBanner ||
      isConflictsFlow(
        this.popupManager.areTherePopupsOfType(PopupType.MultiCommitOperation),
        multiCommitOperationState
      )
    ) {
      return
    }

    const { manualResolutions } = conflictState
    let ourBranch, theirBranch

    if (isMergeConflictState(conflictState)) {
      theirBranch = await this.getMergeConflictsTheirBranch(
        repository,
        status.squashMsgFound,
        multiCommitOperationState
      )
      ourBranch = conflictState.currentBranch
    } else if (isRebaseConflictState(conflictState)) {
      theirBranch = conflictState.targetBranch
      ourBranch = conflictState.baseBranch
    } else if (isCherryPickConflictState(conflictState)) {
      if (
        multiCommitOperationState !== null &&
        multiCommitOperationState.operationDetail.kind ===
          MultiCommitOperationKind.CherryPick &&
        multiCommitOperationState.operationDetail.sourceBranch !== null
      ) {
        theirBranch =
          multiCommitOperationState.operationDetail.sourceBranch.name
      }
      ourBranch = conflictState.targetBranchName
    } else {
      assertNever(conflictState, `Unsupported conflict kind`)
    }

    this.statsStore.increment('mergeConflictFromExplicitMergeCount')

    const mcoConflictState = {
      kind: 'multiCommitOperation' as const,
      manualResolutions,
      ourBranch,
      theirBranch,
    }

    const useCopilot = multiCommitOperationState.useCopilotConflictResolution
    const autoRoute =
      !useCopilot && this.shouldAutoRouteToCopilotConflictResolution(repository)

    if (autoRoute && this.isCopilotConflictDisclaimerFresh()) {
      // Global pref is on and disclaimer is fresh — go straight to Copilot.
      this._setMultiCommitOperationStepWithCopilotResolution(
        repository,
        {
          kind: MultiCommitOperationStepKind.ShowCopilotConflictsLoading,
          conflictState: mcoConflictState,
        },
        true
      )

      this._showPopup({
        type: PopupType.MultiCommitOperation,
        repository,
      })

      await this._startCopilotConflictResolution(repository)
    } else if (useCopilot) {
      this._setMultiCommitOperationStep(repository, {
        kind: MultiCommitOperationStepKind.ShowCopilotConflictsLoading,
        conflictState: mcoConflictState,
      })

      this._showPopup({
        type: PopupType.MultiCommitOperation,
        repository,
      })

      // Auto-route to Copilot: the user previously opted into Copilot
      // resolution during this operation, so skip the manual dialog.
      await this._startCopilotConflictResolution(repository)
    } else {
      this._setMultiCommitOperationStep(repository, {
        kind: MultiCommitOperationStepKind.ShowConflicts,
        conflictState: mcoConflictState,
      })

      this._showPopup({
        type: PopupType.MultiCommitOperation,
        repository,
      })

      if (autoRoute) {
        // Global pref is on but disclaimer is stale — show conflicts first
        // and then trigger the attempt which will show the disclaimer popup.
        await this._attemptCopilotConflictResolution(repository)
      }
    }
  }

  private async getMergeConflictsTheirBranch(
    repository: Repository,
    isSquash: boolean,
    multiCommitOperationState: IMultiCommitOperationState | null
  ): Promise<string | undefined> {
    let theirBranch: string | undefined
    if (
      multiCommitOperationState !== null &&
      multiCommitOperationState.operationDetail.kind ===
        MultiCommitOperationKind.Merge &&
      multiCommitOperationState.operationDetail.sourceBranch !== null
    ) {
      theirBranch = multiCommitOperationState.operationDetail.sourceBranch.name
    }

    if (theirBranch === undefined && !isSquash) {
      const possibleTheirsBranches = await getBranchesPointedAt(
        repository,
        'MERGE_HEAD'
      )

      // null means we encountered an error
      if (possibleTheirsBranches === null) {
        return
      }

      theirBranch =
        possibleTheirsBranches.length === 1
          ? possibleTheirsBranches[0]
          : undefined
    }
    return theirBranch
  }

  /**
   * Cleanup any related UI related to conflicts if still in use.
   */
  private clearConflictsFlowVisuals(state: IRepositoryState) {
    const { multiCommitOperationState } = state
    if (
      userIsStartingMultiCommitOperation(
        this.popupManager.currentPopup,
        multiCommitOperationState
      )
    ) {
      return
    }

    this._closePopup(PopupType.MultiCommitOperation)
    this._clearBanner(BannerType.ConflictsFound)
    this._clearBanner(BannerType.MergeConflictsFound)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _changeRepositorySection(
    repository: Repository,
    selectedSection: RepositorySectionTab,
    forceButtonFocus: boolean = false
  ): Promise<void> {
    this.repositoryStateCache.update(repository, state => {
      if (state.selectedSection !== selectedSection) {
        this.statsStore.increment('repositoryViewChangeCount')
      }
      return { selectedSection }
    })
    this.emitUpdate()

    if (selectedSection === RepositorySectionTab.History) {
      await this.refreshHistorySection(repository)
    } else if (selectedSection === RepositorySectionTab.Changes) {
      await this.refreshChangesSection(repository, {
        includingStatus: true,
        clearPartialState: false,
      })
    } else if (
      selectedSection !== RepositorySectionTab.Actions &&
      selectedSection !== RepositorySectionTab.Releases &&
      selectedSection !== RepositorySectionTab.Issues &&
      selectedSection !== RepositorySectionTab.GitHubAPI &&
      selectedSection !== RepositorySectionTab.Triage &&
      selectedSection !== RepositorySectionTab.RepositoryTools
    ) {
      return assertNever(selectedSection, `Unknown section: ${selectedSection}`)
    }

    if (forceButtonFocus) {
      const repoSideBar = document.getElementById('repository-sidebar')
      const button = repoSideBar?.querySelector(
        '.tab-bar-item.selected'
      ) as HTMLButtonElement
      button?.focus()
    }
  }

  /**
   * Changes the selection in the changes view to the working directory and
   * optionally selects one or more files from the working directory.
   *
   *  @param files An array of files to select when showing the working directory.
   *               If undefined this method will preserve the previously selected
   *               files or pick the first changed file if no selection exists.
   *
   * Note: This shouldn't be called directly. See `Dispatcher`.
   */
  public async _selectWorkingDirectoryFiles(
    repository: Repository,
    files?: ReadonlyArray<WorkingDirectoryFileChange>
  ): Promise<void> {
    this.repositoryStateCache.updateChangesState(repository, state =>
      selectWorkingDirectoryFiles(state, files)
    )

    this.updateMenuLabelsForSelectedRepository()
    this.emitUpdate()
    this.updateChangesWorkingDirectoryDiff(repository)
  }

  /**
   * Loads or re-loads (refreshes) the diff for the currently selected file
   * in the working directory. This operation is a noop if there's no currently
   * selected file.
   */
  private async updateChangesWorkingDirectoryDiff(
    repository: Repository
  ): Promise<void> {
    const stateBeforeLoad = this.repositoryStateCache.get(repository)
    const changesStateBeforeLoad = stateBeforeLoad.changesState

    if (
      changesStateBeforeLoad.selection.kind !==
      ChangesSelectionKind.WorkingDirectory
    ) {
      return
    }

    const selectionBeforeLoad = changesStateBeforeLoad.selection
    const selectedFileIDsBeforeLoad = selectionBeforeLoad.selectedFileIDs

    // We only render diffs when a single file is selected.
    if (selectedFileIDsBeforeLoad.length !== 1) {
      if (selectionBeforeLoad.diff !== null) {
        this.repositoryStateCache.updateChangesState(repository, () => ({
          selection: {
            ...selectionBeforeLoad,
            diff: null,
          },
        }))
        this.emitUpdate()
      }
      return
    }

    const selectedFileIdBeforeLoad = selectedFileIDsBeforeLoad[0]
    const selectedFileBeforeLoad =
      changesStateBeforeLoad.workingDirectory.findFileWithID(
        selectedFileIdBeforeLoad
      )

    if (selectedFileBeforeLoad === null) {
      return
    }

    const diff = await getWorkingDirectoryDiff(
      repository,
      selectedFileBeforeLoad,
      this.hideWhitespaceInChangesDiff
    )

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }

    const stateAfterLoad = this.repositoryStateCache.get(repository)
    const changesState = stateAfterLoad.changesState

    // A different file (or files) could have been selected while we were
    // loading the diff in which case we no longer care about the diff we
    // just loaded.
    if (
      changesState.selection.kind !== ChangesSelectionKind.WorkingDirectory ||
      !arrayEquals(
        changesState.selection.selectedFileIDs,
        selectedFileIDsBeforeLoad
      )
    ) {
      return
    }

    const selectedFileID = changesState.selection.selectedFileIDs[0]

    if (selectedFileID !== selectedFileIdBeforeLoad) {
      return
    }

    const currentlySelectedFile =
      changesState.workingDirectory.findFileWithID(selectedFileID)
    if (currentlySelectedFile === null) {
      return
    }

    const selectableLines = new Set<number>()
    if (diff.kind === DiffType.Text || diff.kind === DiffType.LargeText) {
      // The diff might have changed dramatically since last we loaded it.
      // Ideally we would be more clever about validating that any partial
      // selection state is still valid by ensuring that selected lines still
      // exist but for now we'll settle on just updating the selectable lines
      // such that any previously selected line which now no longer exists or
      // has been turned into a context line isn't still selected.
      diff.hunks.forEach(h => {
        h.lines.forEach((line, index) => {
          if (line.isIncludeableLine()) {
            selectableLines.add(h.unifiedDiffStart + index)
          }
        })
      })
    }

    const newSelection =
      currentlySelectedFile.selection.withSelectableLines(selectableLines)
    const selectedFile = currentlySelectedFile.withSelection(newSelection)
    const updatedFiles = changesState.workingDirectory.files.map(f =>
      f.id === selectedFile.id ? selectedFile : f
    )
    const workingDirectory = WorkingDirectoryStatus.fromFiles(updatedFiles)

    const selection: ChangesWorkingDirectorySelection = {
      ...changesState.selection,
      diff,
    }

    this.repositoryStateCache.updateChangesState(repository, () => ({
      selection,
      workingDirectory,
    }))
    this.emitUpdate()
  }

  public _hideStashedChanges(repository: Repository) {
    const { changesState } = this.repositoryStateCache.get(repository)

    // makes this safe to call even when the stash ui is not visible
    if (changesState.selection.kind !== ChangesSelectionKind.Stash) {
      return
    }

    this.repositoryStateCache.updateChangesState(repository, state => {
      const files = state.workingDirectory.files
      const selectedFileIds = files
        .filter(f => f.selection.getSelectionType() !== DiffSelectionType.None)
        .map(f => f.id)

      return {
        selection: {
          kind: ChangesSelectionKind.WorkingDirectory,
          diff: null,
          selectedFileIDs: selectedFileIds,
        },
      }
    })
    this.emitUpdate()

    this.updateMenuLabelsForSelectedRepository()
  }

  /**
   * Changes the selection in the changes view to the stash entry view and
   * optionally selects a particular file from the current stash entry.
   *
   *  @param file  A file to select when showing the stash entry.
   *               If undefined this method will preserve the previously selected
   *               file or pick the first changed file if no selection exists.
   *  @param preserveSelectedSection Keep a non-Changes section active when an
   *                                 internal Git-store refresh replaces stash
   *                                 metadata for the existing selection.
   *
   * Note: This shouldn't be called directly. See `Dispatcher`.
   */
  public async _selectStashedFile(
    repository: Repository,
    stashEntry?: IStashEntry,
    file?: CommittedFileChange | null,
    preserveSelectedSection: boolean = false
  ): Promise<void> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    let reviewedStashEntry = stashEntry
    if (
      reviewedStashEntry !== undefined &&
      reviewedStashEntry.files.kind === StashedChangesLoadStates.NotLoaded
    ) {
      reviewedStashEntry =
        (await this.gitStoreCache
          .get(repository)
          .loadFilesForStashEntry(reviewedStashEntry)) ?? reviewedStashEntry
    }

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    if (!preserveSelectedSection) {
      this.repositoryStateCache.update(repository, () => ({
        selectedSection: RepositorySectionTab.Changes,
      }))
    }
    this.repositoryStateCache.updateChangesState(repository, state => {
      let selectedStashedFile: CommittedFileChange | null = null
      const { selection } = state
      const targetStashEntry =
        reviewedStashEntry ?? this.getSelectedStashEntry(state)

      const currentlySelectedFile =
        selection.kind === ChangesSelectionKind.Stash
          ? selection.selectedStashedFile
          : null

      const currentFiles =
        targetStashEntry !== null &&
        targetStashEntry.files.kind === StashedChangesLoadStates.Loaded
          ? targetStashEntry.files.files
          : []

      if (file === undefined) {
        if (currentlySelectedFile !== null) {
          // Ensure the requested file exists in the stash entry and
          // that we can use reference equality to figure out which file
          // is selected in the list. If we can't find it we'll pick the
          // first file available or null if no files have been loaded.
          selectedStashedFile =
            currentFiles.find(x => x.id === currentlySelectedFile.id) ||
            currentFiles[0] ||
            null
        } else {
          // No current selection, let's just pick the first file available
          // or null if no files have been loaded.
          selectedStashedFile = currentFiles[0] || null
        }
      } else if (file !== null) {
        // Look up the selected file in the stash entry, it's possible that
        // the stash entry or file list has changed since the consumer called
        // us. The working directory selection handles this by using IDs rather
        // than references.
        selectedStashedFile = currentFiles.find(x => x.id === file.id) || null
      }

      return {
        selection: {
          kind: ChangesSelectionKind.Stash,
          selectedStashEntry: targetStashEntry,
          selectedStashedFile,
          selectedStashedFileDiff: null,
        },
      }
    })

    this.updateMenuLabelsForSelectedRepository()
    this.emitUpdate()
    this.updateChangesStashDiff(repository)

    if (!this.hasUserViewedStash) {
      // `hasUserViewedStash` is reset to false on every branch checkout
      // so we increment the metric before setting `hasUserViewedStash` to true
      // to make sure we only increment on the first view after checkout
      this.statsStore.increment('stashViewedAfterCheckoutCount')
      this.hasUserViewedStash = true
    }
  }

  private getSelectedStashEntry(state: IChangesState): IStashEntry | null {
    const selectedSha =
      state.selection.kind === ChangesSelectionKind.Stash
        ? state.selection.selectedStashEntry?.stashSha
        : undefined
    return (
      state.allStashEntries.find(entry => entry.stashSha === selectedSha) ??
      state.stashEntries[0] ??
      state.allStashEntries[0] ??
      null
    )
  }

  private async updateChangesStashDiff(repository: Repository) {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const stateBeforeLoad = this.repositoryStateCache.get(repository)
    const changesStateBeforeLoad = stateBeforeLoad.changesState
    const selectionBeforeLoad = changesStateBeforeLoad.selection

    if (selectionBeforeLoad.kind !== ChangesSelectionKind.Stash) {
      return
    }

    const stashEntry = selectionBeforeLoad.selectedStashEntry

    if (stashEntry === null) {
      return
    }

    let file = selectionBeforeLoad.selectedStashedFile

    if (file === null) {
      if (stashEntry.files.kind === StashedChangesLoadStates.Loaded) {
        if (stashEntry.files.files.length > 0) {
          file = stashEntry.files.files[0]
        }
      }
    }

    if (file === null) {
      this.repositoryStateCache.updateChangesState(repository, () => ({
        selection: {
          kind: ChangesSelectionKind.Stash,
          selectedStashEntry: stashEntry,
          selectedStashedFile: null,
          selectedStashedFileDiff: null,
        },
      }))
      this.emitUpdate()
      return
    }

    const diff = await getCommitDiff(repository, file, file.commitish)

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const stateAfterLoad = this.repositoryStateCache.get(repository)
    const changesStateAfterLoad = stateAfterLoad.changesState

    // Something has changed during our async getCommitDiff, bail
    if (
      changesStateAfterLoad.selection.kind !== ChangesSelectionKind.Stash ||
      changesStateAfterLoad.selection.selectedStashEntry?.stashSha !==
        stashEntry.stashSha ||
      changesStateAfterLoad.selection.selectedStashedFile?.id !==
        selectionBeforeLoad.selectedStashedFile?.id
    ) {
      return
    }

    this.repositoryStateCache.updateChangesState(repository, () => ({
      selection: {
        kind: ChangesSelectionKind.Stash,
        selectedStashEntry: stashEntry,
        selectedStashedFile: file,
        selectedStashedFileDiff: diff,
      },
    }))
    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _commitIncludedChanges(
    repository: Repository,
    context: ICommitContext,
    // Forces the large-file auto-pin even when the per-repo preference is off,
    // used by the oversized-files warning's "Pin to release" action; the
    // Releases-availability gate still applies.
    forceAutoPinLargeFiles: boolean = false
  ): Promise<boolean> {
    await this.assertTemporaryRepositoryIsSafe(repository)
    if (!this.isTemporaryRepositoryActive(repository)) {
      return false
    }
    const state = this.repositoryStateCache.get(repository)
    const files = state.changesState.workingDirectory.files
    let selectedFiles = files.filter(file => {
      return file.selection.getSelectionType() !== DiffSelectionType.None
    })

    const gitStore = this.gitStoreCache.get(repository)

    let refreshAfterAutoPinFailure = false
    const result = await this.withIsCommitting(repository, async () => {
      // Auto-pin any selected file too large to push to a GitHub Release before
      // committing, so the tree holds a committable pointer instead of an
      // unpushable binary. A pin failure aborts the commit — a half-pinned tree
      // must never become a commit.
      let pinned: ReadonlyArray<ICheapLfsAutoPinnedFile>
      try {
        pinned = await this.autoPinLargeFilesBeforeCommit(
          repository,
          selectedFiles,
          forceAutoPinLargeFiles
        )
      } catch (error) {
        if (!this.isTemporaryRepositoryActive(repository)) {
          return false
        }
        this.emitError(
          error instanceof Error ? error : new Error(String(error))
        )
        // A prior file in this batch might already have been replaced by its
        // pointer. Defer the refresh until `withIsCommitting` clears the
        // cheap-LFS phase; refreshing here would intentionally suppress the
        // selected-file diff and leave the original large-file diff visible.
        refreshAfterAutoPinFailure = true
        return false
      }

      if (pinned.length > 0) {
        // Re-read status so the just-written pointer content — not the original
        // binary — is what gets staged and committed for each pinned file.
        await this._loadStatus(repository)
        if (!this.isTemporaryRepositoryActive(repository)) {
          return false
        }
        const pinnedPaths = new Set(pinned.map(file => file.relativePath))
        const originalSelectedPaths = new Set(selectedFiles.map(f => f.path))
        const refreshedFiles =
          this.repositoryStateCache.get(repository).changesState
            .workingDirectory.files
        selectedFiles = refreshedFiles
          .filter(file => originalSelectedPaths.has(file.path))
          .map(file =>
            pinnedPaths.has(file.path) ? file.withIncludeAll(true) : file
          )
          .filter(
            file => file.selection.getSelectionType() !== DiffSelectionType.None
          )
        this.postCheapLfsPinNotification(repository, pinned)
      }

      this.repositoryStateCache.update(repository, () => ({
        commitOperationPhase: {
          kind: 'git-commit',
          cheapLfsPointerCount: pinned.length,
        },
      }))
      this.emitUpdate()

      const result = await gitStore.performFailableOperation(
        async () => {
          const message = await formatCommitMessage(repository, context)
          let aborted = false
          return this.withTemporaryRepositoryMutationGuard(repository, () =>
            createCommit(repository, message, selectedFiles, {
              amend: context.amend,
              onHookProgress: this.onHookProgress(repository),
              onHookFailure: this.onHookFailure(() => (aborted = true)),
              onTerminalOutputAvailable: subscribeToCommitOutput => {
                if (!this.isTemporaryRepositoryActive(repository)) {
                  return
                }
                this.repositoryStateCache.update(repository, state => ({
                  ...state,
                  subscribeToCommitOutput,
                }))
              },
              noVerify: state.skipCommitHooks,
              signOff: state.signOffCommits,
              allowEmpty: state.allowEmptyCommit,
            }).catch(err => (aborted ? undefined : Promise.reject(err)))
          )
        },
        { gitContext: { kind: 'commit' }, repository }
      )

      if (!this.isTemporaryRepositoryActive(repository)) {
        return false
      }
      if (result !== undefined) {
        await this._recordCommitStats(
          gitStore,
          repository,
          state,
          context,
          selectedFiles,
          context.amend === true
        )

        if (!this.isTemporaryRepositoryActive(repository)) {
          return false
        }
        this.repositoryStateCache.update(repository, () => {
          return {
            commitToAmend: null,
            allowEmptyCommit: false,
          }
        })

        // Clear the commit message in the git store so that if the user
        // switched away from the Changes tab while the commit was in progress,
        // the persisted message (saved on unmount) doesn't reappear when they
        // return to the Changes tab.
        await gitStore.setCommitMessage(DefaultCommitMessage)
        if (!this.isTemporaryRepositoryActive(repository)) {
          return false
        }

        await this.refreshChangesSection(repository, {
          includingStatus: true,
          clearPartialState: true,
        })
        if (!this.isTemporaryRepositoryActive(repository)) {
          return false
        }

        // Do not await for refreshing the repository, otherwise this will block
        // the commit button unnecessarily for a long time in big repos.
        this._refreshRepositoryAfterCommit(
          repository,
          result,
          state.commitToAmend
        )
      } else {
        // The commit failed, but we should still refresh to ensure we
        // accurately reflect the repository state post failure. See
        // https://github.com/desktop/desktop/issues/21229
        this._refreshRepository(repository)
      }

      return result !== undefined
    })

    if (
      refreshAfterAutoPinFailure &&
      this.isTemporaryRepositoryActive(repository)
    ) {
      await this._refreshRepository(repository)
    }

    return result
  }

  private async _refreshRepositoryAfterCommit(
    repository: Repository,
    newCommitSha: string,
    amendedCommit: Commit | null
  ) {
    await this._refreshRepository(repository)
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }

    const amendedCommitSha = amendedCommit?.sha

    if (amendedCommitSha !== undefined && newCommitSha !== amendedCommitSha) {
      const newState = this.repositoryStateCache.get(repository)
      const newTip = newState.branchesState.tip
      if (newTip.kind === TipState.Valid) {
        this._addBranchToForcePushList(repository, newTip, amendedCommitSha)
      }
    }
  }

  private async _recordCommitStats(
    gitStore: GitStore,
    repository: Repository,
    repositoryState: IRepositoryState,
    context: ICommitContext,
    selectedFiles: readonly WorkingDirectoryFileChange[],
    isAmend: boolean
  ) {
    this.statsStore.recordCommit()

    const includedPartialSelections = selectedFiles.some(
      file => file.selection.getSelectionType() === DiffSelectionType.Partial
    )
    if (includedPartialSelections) {
      this.statsStore.increment('partialCommits')
    }

    if (context.messageGeneratedByCopilot === true) {
      this.statsStore.increment('generateCommitMessageUsedVerbatimCount')
    }

    if (isAmend) {
      this.statsStore.recordAmendCommitSuccessful(selectedFiles.length > 0)
    }

    const { trailers } = context
    if (trailers !== undefined && trailers.some(isCoAuthoredByTrailer)) {
      this.statsStore.increment('coAuthoredCommits')
    }

    const account = getAccountForRepository(this.accounts, repository)
    if (repository.gitHubRepository !== null) {
      if (account !== null) {
        if (isDotComAccount(account)) {
          this.statsStore.increment('dotcomCommits')
        } else {
          this.statsStore.increment('enterpriseCommits')
        }

        const { commitAuthor } = repositoryState
        if (commitAuthor !== null) {
          if (!isAttributableEmailFor(account, commitAuthor.email)) {
            this.statsStore.increment('unattributedCommits')
          }
        }
      }

      const branchProtectionsFound =
        await this.repositoriesStore.hasBranchProtectionsConfigured(
          repository.gitHubRepository
        )

      if (branchProtectionsFound) {
        this.statsStore.increment('commitsToRepositoryWithBranchProtections')
      }

      const branchName = findRemoteBranchName(
        gitStore.tip,
        gitStore.currentRemote,
        repository.gitHubRepository
      )

      if (branchName !== null) {
        const { changesState } = this.repositoryStateCache.get(repository)
        if (changesState.currentBranchProtected) {
          this.statsStore.increment('commitsToProtectedBranch')
        }
      }

      if (
        repository.gitHubRepository !== null &&
        !hasWritePermission(repository.gitHubRepository)
      ) {
        this.statsStore.increment('commitsToRepositoryWithoutWriteAccess')
        this.statsStore.recordRepositoryCommitedInWithoutWriteAccess(
          repository.gitHubRepository.dbID
        )
      }
    }
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _changeFileIncluded(
    repository: Repository,
    file:
      | WorkingDirectoryFileChange
      | ReadonlyArray<WorkingDirectoryFileChange>,
    include: boolean
  ): Promise<void> {
    const files = Array.isArray(file) ? file : [file]
    const modifiedIds = new Set<string>(files.map(f => f.id))

    this.repositoryStateCache.updateChangesState(repository, state => {
      const workingDirectory = WorkingDirectoryStatus.fromFiles(
        state.workingDirectory.files.map(f =>
          modifiedIds.has(f.id) ? f.withIncludeAll(include) : f
        )
      )

      return { workingDirectory }
    })

    this.emitUpdate()
    return Promise.resolve()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _changeFileLineSelection(
    repository: Repository,
    file: WorkingDirectoryFileChange,
    diffSelection: DiffSelection
  ): Promise<void> {
    this.updateWorkingDirectoryFileSelection(repository, file, diffSelection)
    return Promise.resolve()
  }

  /**
   * Updates the selection for the given file in the working directory state and
   * emits an update event.
   */
  private updateWorkingDirectoryFileSelection(
    repository: Repository,
    file: WorkingDirectoryFileChange,
    selection: DiffSelection
  ) {
    this.repositoryStateCache.updateChangesState(repository, state => {
      const newFiles = state.workingDirectory.files.map(f =>
        f.id === file.id ? f.withSelection(selection) : f
      )

      const workingDirectory = WorkingDirectoryStatus.fromFiles(newFiles)

      return { workingDirectory }
    })

    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _changeIncludeAllFiles(
    repository: Repository,
    includeAll: boolean
  ): Promise<void> {
    this.repositoryStateCache.updateChangesState(repository, state => {
      const workingDirectory =
        state.workingDirectory.withIncludeAllFiles(includeAll)
      return { workingDirectory }
    })

    this.emitUpdate()

    return Promise.resolve()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _refreshOrRecoverRepository(
    repository: Repository
  ): Promise<void> {
    // if repository is missing, try checking if it has been restored
    if (repository.missing) {
      const updatedRepository = await this.recoverMissingRepository(repository)
      if (!updatedRepository.missing) {
        // repository has been restored, attempt to refresh it now.
        return this._refreshRepository(updatedRepository)
      }
    } else {
      return this._refreshRepository(repository)
    }
  }

  private async recoverMissingRepository(
    repository: Repository
  ): Promise<Repository> {
    if (!repository.missing) {
      return repository
    }

    const type = await getRepositoryType(repository.path)

    const foundRepository =
      type.kind === 'regular' && (await this._loadStatus(repository)) !== null

    if (foundRepository) {
      let recovered = await this._updateRepositoryMissing(repository, false)
      if (type.kind === 'regular' && recovered.gitDir !== type.gitDir) {
        recovered = await this.repositoriesStore.updateRepositoryGitDir(
          recovered,
          type.gitDir
        )
      }
      return recovered
    }

    const recoveredWorktree = await this.recoverMissingWorktree(repository)
    if (recoveredWorktree !== null) {
      return recoveredWorktree
    }

    return repository
  }

  private async recoverMissingWorktree(
    repository: Repository
  ): Promise<Repository | null> {
    if (repository.gitDir === undefined) {
      return null
    }

    const worktrees = await listWorktreesFromGitDir(repository.gitDir).catch(
      e => {
        log.error('Could not list worktrees from git dir', e)
        return []
      }
    )
    const mainWorktree = worktrees.find(wt => wt.type === 'main')

    if (mainWorktree === undefined || mainWorktree.path === repository.path) {
      return null
    }

    const type = await getRepositoryType(mainWorktree.path).catch(e => {
      log.error('Could not determine main worktree repository type', e)
      return { kind: 'missing' } as RepositoryType
    })

    if (type.kind !== 'regular') {
      return null
    }

    const result = await this.repositoriesStore.switchWorktree(
      repository,
      type.topLevelWorkingDirectory,
      false,
      type.gitDir
    )

    if (!result.existingRepository) {
      this.repositoryStateCache.seedFromWorktree(
        result.repository,
        repository,
        mainWorktree
      )
    }

    return result.repository
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _refreshRepository(repository: Repository): Promise<void> {
    if (repository.missing) {
      return
    }

    try {
      await this.assertTemporaryRepositoryIsSafe(repository)
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)))
      return
    }

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }

    // if the repository path doesn't exist on disk,
    // set the flag and don't try anything Git-related
    const exists = await pathExists(repository.path)
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    if (!exists) {
      if (isSubmoduleRepository(repository)) {
        this.gitStoreCache.remove(repository)
        if (this.selectedRepository === repository) {
          await this._returnToParentRepository(repository).catch(error =>
            this.emitError(error)
          )
        }
        return
      }

      const recoveredWorktree = await this.recoverMissingWorktree(repository)

      if (recoveredWorktree !== null) {
        if (
          this.selectedRepository instanceof Repository &&
          this.selectedRepository.id === repository.id
        ) {
          await this._selectRepository(recoveredWorktree)
        } else {
          await this._refreshRepository(recoveredWorktree)
        }

        return
      }

      this._updateRepositoryMissing(repository, true)
      return
    }

    // Populate gitDir for repositories that don't have it yet
    if (repository.gitDir === undefined) {
      const repositoryBeforeGitDirUpdate = repository
      const type = await getRepositoryType(repository.path)
      if (!this.isTemporaryRepositoryActive(repositoryBeforeGitDirUpdate)) {
        return
      }
      if (type.kind === 'regular') {
        repository = await this.repositoriesStore.updateRepositoryGitDir(
          repository,
          type.gitDir
        )
        if (!this.isTemporaryRepositoryActive(repositoryBeforeGitDirUpdate)) {
          return
        }
      }
    }

    const state = this.repositoryStateCache.get(repository)
    const gitStore = this.gitStoreCache.get(repository)

    // if we cannot get a valid status it's a good indicator that the repository
    // is in a bad state - let's mark it as missing here and give up on the
    // further work
    const status = await this._loadStatus(repository)
    if (status === null) {
      if (isSubmoduleRepository(repository)) {
        this.gitStoreCache.remove(repository)
        if (this.selectedRepository === repository) {
          await this._returnToParentRepository(repository).catch(error =>
            this.emitError(error)
          )
        }
        return
      }

      await this._updateRepositoryMissing(repository, true)
      return
    }

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }

    // loadBranches needs the default remote to determine the default branch
    await gitStore.loadRemotes()
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    await gitStore.loadBranches()
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    this.updateSidebarIndicator(
      repository,
      status,
      gitStore.defaultBranch?.name
    )

    const section = state.selectedSection
    let refreshSectionPromise: Promise<void>

    if (section === RepositorySectionTab.History) {
      refreshSectionPromise = this.refreshHistorySection(repository)
    } else if (section === RepositorySectionTab.Changes) {
      refreshSectionPromise = this.refreshChangesSection(repository, {
        includingStatus: false,
        clearPartialState: false,
      })
    } else if (
      section === RepositorySectionTab.Actions ||
      section === RepositorySectionTab.Releases ||
      section === RepositorySectionTab.Issues ||
      section === RepositorySectionTab.GitHubAPI ||
      section === RepositorySectionTab.Triage ||
      section === RepositorySectionTab.RepositoryTools
    ) {
      refreshSectionPromise = Promise.resolve()
    } else {
      return assertNever(section, `Unknown section: ${section}`)
    }

    await Promise.all([
      gitStore.updateLastFetched(),
      gitStore.loadStashEntries(),
      this._refreshAuthor(repository),
      this._refreshWorktrees(repository),
      refreshSectionPromise,
    ])

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }

    await gitStore.refreshTags()

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }

    // this promise is fire-and-forget, so no need to await it
    if (!isSubmoduleRepository(repository)) {
      this.updateStashEntryCountMetric(
        repository,
        gitStore.desktopStashEntryCount,
        gitStore.stashEntryCount
      )
    }
    this.updateCurrentPullRequest(repository)

    const latestState = this.repositoryStateCache.get(repository)
    this.updateMenuItemLabels(latestState)

    this._initializeCompare(repository)

    if (!isSubmoduleRepository(repository)) {
      this.updateCurrentTutorialStep(repository)
    }
  }

  private async updateStashEntryCountMetric(
    repository: Repository,
    desktopStashEntryCount: number,
    stashEntryCount: number
  ) {
    const lastStashEntryCheck =
      await this.repositoriesStore.getLastStashCheckDate(repository)
    const threshold = offsetFromNow(-24, 'hours')
    // `lastStashEntryCheck` being equal to `null` means
    // we've never checked for the given repo
    if (lastStashEntryCheck == null || threshold > lastStashEntryCheck) {
      await this.repositoriesStore.updateLastStashCheckDate(repository)
      const numEntriesCreatedOutsideDesktop =
        stashEntryCount - desktopStashEntryCount
      this.statsStore.addStashEntriesCreatedOutsideDesktop(
        numEntriesCreatedOutsideDesktop
      )
    }
  }

  /**
   * Update the repository sidebar indicator for the repository
   */
  private async updateSidebarIndicator(
    repository: Repository,
    status: IStatusResult | null,
    defaultBranchName: string | null = repository.defaultBranch
  ): Promise<void> {
    const lookup = this.localRepositoryStateLookup

    if (repository.missing) {
      lookup.delete(repository.id)
      return
    }

    if (status === null) {
      lookup.delete(repository.id)
      return
    }

    lookup.set(repository.id, {
      aheadBehind: status.branchAheadBehind || null,
      changedFilesCount: status.workingDirectory.files.length,
      branchName: status.currentBranch ?? null,
      defaultBranchName,
    })
  }
  /**
   * Refresh indicator in repository list for a specific repository
   */
  private refreshIndicatorForRepository = async (repository: Repository) => {
    const lookup = this.localRepositoryStateLookup

    if (repository.missing) {
      lookup.delete(repository.id)
      return
    }

    const exists = await pathExists(repository.path)
    if (!exists) {
      lookup.delete(repository.id)
      return
    }

    const gitStore = this.gitStoreCache.get(repository)
    const status = await gitStore.loadStatus()
    if (status === null) {
      lookup.delete(repository.id)
      return
    }

    await gitStore.loadRemotes()
    await gitStore.loadBranches()
    this.updateSidebarIndicator(
      repository,
      status,
      gitStore.defaultBranch?.name
    )
    this.emitUpdate()

    const lastPush = await inferLastPushForRepository(
      this.accounts,
      gitStore,
      repository
    )

    if (await this.shouldBackgroundFetch(repository, lastPush)) {
      const aheadBehind = await this.fetchForRepositoryIndicator(repository)

      const existing = lookup.get(repository.id)
      lookup.set(repository.id, {
        aheadBehind: aheadBehind,
        // We don't need to update changedFilesCount here since it was already
        // set when calling `updateSidebarIndicator()` with the status object.
        changedFilesCount: existing?.changedFilesCount ?? 0,
        branchName: existing?.branchName ?? null,
        defaultBranchName:
          existing?.defaultBranchName ?? repository.defaultBranch,
      })
      this.emitUpdate()
    }
  }

  private getRepositoriesForIndicatorRefresh = () => {
    // The currently selected repository will get refreshed by both the
    // BackgroundFetcher and the refreshRepository call from the
    // focus event. No point in having the RepositoryIndicatorUpdater do
    // it as well.
    //
    // Note that this method should never leak the actual repositories
    // instance since that's a mutable array. We should always return
    // a copy.
    return this.repositories.filter(x => x !== this.selectedRepository)
  }

  /**
   * A slimmed down version of performFetch which is only used when fetching
   * the repository in order to compute the repository indicator status.
   *
   * As opposed to `performFetch` this method will not perform a full refresh
   * of the repository after fetching, nor will it refresh issues, branch
   * protection information etc. It's intention is to only do the bare minimum
   * amount of work required to calculate an up-to-date ahead/behind status
   * of the current branch to its upstream tracking branch.
   */
  private fetchForRepositoryIndicator(repo: Repository) {
    return this.withRefreshedGitHubRepository(repo, async repo => {
      const isBackgroundTask = true
      const gitStore = this.gitStoreCache.get(repo)

      await this.withPushPullFetch(repo, () =>
        gitStore.fetch(isBackgroundTask, progress =>
          this.updatePushPullFetchProgress(repo, progress)
        )
      )
      this.updatePushPullFetchProgress(repo, null)

      return gitStore.aheadBehind
    })
  }

  public _setRepositoryIndicatorsEnabled(repositoryIndicatorsEnabled: boolean) {
    if (this.repositoryIndicatorsEnabled === repositoryIndicatorsEnabled) {
      return
    }

    setBoolean(repositoryIndicatorsEnabledKey, repositoryIndicatorsEnabled)
    this.repositoryIndicatorsEnabled = repositoryIndicatorsEnabled
    if (repositoryIndicatorsEnabled) {
      this.repositoryIndicatorUpdater.start()
    } else {
      this.repositoryIndicatorUpdater.stop()
    }

    this.emitUpdate()
  }

  public _setShowRecentRepositories(showRecentRepositories: boolean) {
    if (this.showRecentRepositories === showRecentRepositories) {
      return
    }

    setBoolean(showRecentRepositoriesKey, showRecentRepositories)
    this.showRecentRepositories = showRecentRepositories
    this.emitUpdate()
  }

  public _setShowBranchNameInRepoList(
    setting: ShowBranchNameInRepoListSetting
  ) {
    if (this.showBranchNameInRepoList === setting) {
      return
    }

    localStorage.setItem(showBranchNameInRepoListKey, setting)
    this.showBranchNameInRepoList = setting
    this.emitUpdate()
  }

  public _setCommitSpellcheckEnabled(commitSpellcheckEnabled: boolean) {
    if (this.commitSpellcheckEnabled === commitSpellcheckEnabled) {
      return
    }

    setBoolean(commitSpellcheckEnabledKey, commitSpellcheckEnabled)
    this.commitSpellcheckEnabled = commitSpellcheckEnabled

    this.emitUpdate()
  }

  public _setUseWindowsOpenSSH(useWindowsOpenSSH: boolean) {
    setBoolean(UseWindowsOpenSSHKey, useWindowsOpenSSH)
    this.useWindowsOpenSSH = useWindowsOpenSSH

    this.emitUpdate()
  }

  public _setVerboseLogging(verboseLogging: boolean) {
    setBoolean(verboseLoggingKey, verboseLogging)
    this.verboseLogging = verboseLogging
    this.applyVerboseLogging()

    this.emitUpdate()
  }

  /** Sync the shim tee and the main-process file transport with the setting. */
  private applyVerboseLogging() {
    setLogSinkVerbose(this.verboseLogging)
    sendVerboseLoggingEnabled(this.verboseLogging)
  }

  public _setShowCommitLengthWarning(showCommitLengthWarning: boolean) {
    setBoolean(showCommitLengthWarningKey, showCommitLengthWarning)
    this.showCommitLengthWarning = showCommitLengthWarning
    this.emitUpdate()
  }

  public _setNotificationsEnabled(notificationsEnabled: boolean) {
    this.notificationsStore.setNotificationsEnabled(notificationsEnabled)
    this.emitUpdate()
  }

  public _setErrorPresentationStyle(style: ErrorPresentationStyle): void {
    if (this.errorPresentationStyle === style) {
      return
    }

    setErrorPresentationStyle(style)
    this.errorPresentationStyle = style
    this.emitUpdate()
  }

  public _dismissErrorNotice(id: string): void {
    const next = dismissErrorNotice(this.errorNotices, id)
    if (next === this.errorNotices) {
      return
    }

    this.errorNotices = next
    this.emitUpdate()
  }

  /** Remove a verified stale index lock for one idle repository. */
  public async _removeRepositoryLock(
    repositoryId: number,
    noticeId: string,
    confirmed: boolean = false
  ): Promise<void> {
    if (!confirmed) {
      this.emitError(
        new Error(
          'Confirm that all Git and IDE processes are stopped before removing the repository lock.'
        )
      )
      return
    }
    if (this.repositoryLockRemovalInFlight.has(repositoryId)) {
      return
    }
    const repository =
      (this.selectedRepository instanceof Repository &&
      this.selectedRepository.id === repositoryId
        ? this.selectedRepository
        : this.repositories.find(candidate => candidate.id === repositoryId)) ??
      null
    if (repository === null) {
      this.emitError(
        new Error('The repository for this lock no longer exists.')
      )
      return
    }

    const state = this.repositoryStateCache.get(repository)
    if (
      state.isCommitting ||
      state.isGeneratingCommitMessage ||
      state.isPushPullFetchInProgress ||
      state.checkoutProgress !== null ||
      state.multiCommitOperationState !== null ||
      state.oneClickCommitPushPhase !== null ||
      state.revertProgress !== null ||
      (state.mergeAllState?.phase !== undefined &&
        state.mergeAllState.phase !== 'complete' &&
        state.mergeAllState.phase !== 'cancelled')
    ) {
      this.emitError(
        new Error(
          'Desktop is still running a Git operation for this repository. Wait for it to finish before removing the lock.'
        )
      )
      return
    }

    this.repositoryLockRemovalInFlight.add(repositoryId)
    try {
      const removedPath = await removeStaleRepositoryLock(repository)
      this._dismissErrorNotice(noticeId)
      await this._refreshRepository(repository)
      this.postNotification({
        kind: 'info',
        title:
          removedPath === null
            ? 'Repository lock already gone'
            : 'Repository lock removed',
        body:
          removedPath === null
            ? `${repository.name} no longer has an index lock.`
            : `Removed the stale index lock from ${repository.name}.`,
        repositoryId: repository.id,
        action: { kind: 'open-repository', repositoryId: repository.id },
      })
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.repositoryLockRemovalInFlight.delete(repositoryId)
    }
  }

  /**
   * Refresh all the data for the Changes section.
   *
   * This will be called automatically when appropriate.
   */
  private async refreshChangesSection(
    repository: Repository,
    options: {
      includingStatus: boolean
      clearPartialState: boolean
    }
  ): Promise<void> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    if (options.includingStatus) {
      await this._loadStatus(repository, options.clearPartialState)
      if (!this.isTemporaryRepositoryActive(repository)) {
        return
      }
    }

    const gitStore = this.gitStoreCache.get(repository)
    const state = this.repositoryStateCache.get(repository)

    if (state.branchesState.tip.kind === TipState.Valid) {
      const currentBranch = state.branchesState.tip.branch
      await gitStore.loadLocalCommits(currentBranch)
    } else if (state.branchesState.tip.kind === TipState.Unborn) {
      await gitStore.loadLocalCommits(null)
    }
  }

  /**
   * Refresh all the data for the History section.
   *
   * This will be called automatically when appropriate.
   */
  private async refreshHistorySection(repository: Repository): Promise<void> {
    const gitStore = this.gitStoreCache.get(repository)
    const state = this.repositoryStateCache.get(repository)
    const tip = state.branchesState.tip

    if (tip.kind === TipState.Valid) {
      await gitStore.loadLocalCommits(tip.branch)
    }

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }

    return this.updateOrSelectFirstCommit(
      repository,
      state.compareState.commitSHAs
    )
  }

  public async _refreshAuthor(repository: Repository): Promise<void> {
    const gitStore = this.gitStoreCache.get(repository)
    const commitAuthor =
      (await gitStore.performFailableOperation(() =>
        getAuthorIdentity(repository)
      )) || null

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }

    this.repositoryStateCache.update(repository, () => ({
      commitAuthor,
    }))
    this.emitUpdate()
  }

  private async _refreshWorktrees(repository: Repository): Promise<void> {
    try {
      const worktrees = await listWorktrees(repository)
      if (!this.isTemporaryRepositoryActive(repository)) {
        return
      }
      this.repositoryStateCache.update(repository, () => ({ worktrees }))
      this.statsStore.recordWorktreeCount(worktrees.length)

      // The presence of linked worktrees determines whether the worktree
      // dropdown is shown, which changes how the toolbar width is allocated.
      this.updateResizableConstraints()

      this.emitUpdate()
    } catch (e) {
      log.error('Failed to refresh worktrees', e)
    }
  }

  public _updateCommitOptions(
    repository: Repository,
    commitOptions: Partial<CommitOptions>
  ): void {
    this.repositoryStateCache.update(repository, state => ({
      skipCommitHooks: state.skipCommitHooks,
      signOffCommits: state.signOffCommits,
      allowEmptyCommit: state.allowEmptyCommit,
      ...commitOptions,
    }))
    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _showPopup(popup: Popup): Promise<void> {
    // Always close the app menu when showing a pop up. This is only
    // applicable on Windows where we draw a custom app menu.
    this._closeFoldout(FoldoutType.AppMenu)

    this.popupManager.addPopup(popup)
    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _closePopup(popupType?: PopupType) {
    const currentPopup = this.popupManager.currentPopup
    if (currentPopup === null) {
      return
    }

    if (popupType === undefined) {
      this.popupManager.removePopup(currentPopup)
    } else {
      if (currentPopup.type !== popupType) {
        return
      }

      if (currentPopup.type === PopupType.CloneRepository) {
        this._completeOpenInDesktop(() => Promise.resolve(null))
      }

      this.popupManager.removePopupByType(popupType)
    }

    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _closePopupById(popupId: number) {
    if (this.popupManager.currentPopup === null) {
      return
    }

    this.popupManager.removePopupById(popupId)
    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _bringPopupToFront(popupId: number) {
    if (this.popupManager.currentPopup?.id === popupId) {
      return
    }

    this.popupManager.bringToFront(popupId)
    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _showFoldout(foldout: Foldout): Promise<void> {
    this.currentFoldout = foldout

    // Showing the worktree foldout makes the worktree dropdown visible even
    // when there are no linked worktrees, so the toolbar width allocation has
    // to be recalculated to reserve space for it.
    if (foldout.type === FoldoutType.Worktree) {
      this.updateResizableConstraints()
    }

    this.emitUpdate()

    // If the user is opening the repository list and we haven't yet
    // started to refresh the repository indicators let's do so.
    if (
      foldout.type === FoldoutType.Repository &&
      this.repositoryIndicatorsEnabled
    ) {
      // N.B: RepositoryIndicatorUpdater.prototype.start is
      // idempotent.
      this.repositoryIndicatorUpdater.start()
    }
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _closeCurrentFoldout(): Promise<void> {
    if (this.currentFoldout == null) {
      return
    }

    const wasWorktreeFoldout = this.currentFoldout.type === FoldoutType.Worktree

    this.currentFoldout = null

    if (wasWorktreeFoldout) {
      this.updateResizableConstraints()
    }

    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _closeFoldout(foldout: FoldoutType): Promise<void> {
    if (this.currentFoldout == null) {
      return
    }

    if (foldout !== undefined && this.currentFoldout.type !== foldout) {
      return
    }

    const wasWorktreeFoldout = this.currentFoldout.type === FoldoutType.Worktree

    this.currentFoldout = null

    if (wasWorktreeFoldout) {
      this.updateResizableConstraints()
    }

    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _createBranch(
    repository: Repository,
    name: string,
    startPoint: string | null,
    noTrackOption: boolean = false,
    checkoutBranch: boolean = true
  ): Promise<Branch | undefined> {
    const gitStore = this.gitStoreCache.get(repository)
    const branch = await this.withTemporaryRepositoryMutationGuard(
      repository,
      () => gitStore.createBranch(name, startPoint, noTrackOption)
    )

    if (branch !== undefined && checkoutBranch) {
      await this._checkoutBranch(repository, branch)
    }

    return branch
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _createTag(repository: Repository, name: string, sha: string) {
    const gitStore = this.gitStoreCache.get(repository)
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      gitStore.createTag(name, sha)
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _deleteTag(repository: Repository, name: string) {
    const gitStore = this.gitStoreCache.get(repository)
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      gitStore.deleteTag(name)
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _getTagLifecycleInventory(
    repository: Repository,
    includeRemote: boolean
  ): Promise<ITagLifecycleInventory> {
    return this.gitStoreCache
      .get(repository)
      .getTagLifecycleInventory(includeRemote)
  }

  private withTagLifecycleMutationGuard<T>(
    repository: Repository,
    mutation: () => Promise<T>
  ): Promise<T> {
    if (isSubmoduleRepository(repository)) {
      throw new Error(
        t('submodule.temporaryToolsReadOnly', {
          parent: repository.parentRepository.name,
        })
      )
    }
    return this.withTemporaryRepositoryMutationGuard(repository, mutation)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _createLifecycleTag(
    repository: Repository,
    options: ICreateTagLifecycleOptions
  ): Promise<boolean> {
    const gitStore = this.gitStoreCache.get(repository)
    return this.withTagLifecycleMutationGuard(repository, () =>
      gitStore.createLifecycleTag(options)
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _moveLifecycleTag(
    repository: Repository,
    options: IMoveTagLifecycleOptions
  ): Promise<boolean> {
    const gitStore = this.gitStoreCache.get(repository)
    return this.withTagLifecycleMutationGuard(repository, () =>
      gitStore.moveLifecycleTag(options)
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _deleteReviewedLifecycleTag(
    repository: Repository,
    review: ITagRefReview
  ): Promise<boolean> {
    const gitStore = this.gitStoreCache.get(repository)
    return this.withTagLifecycleMutationGuard(repository, () =>
      gitStore.deleteReviewedLifecycleTag(review)
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _pushLifecycleTags(
    repository: Repository,
    reviews: ReadonlyArray<ITagPushReview>
  ): Promise<boolean> {
    const gitStore = this.gitStoreCache.get(repository)
    return this.withTagLifecycleMutationGuard(repository, () =>
      gitStore.pushLifecycleTags(reviews)
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _fetchLifecycleTags(
    repository: Repository,
    prune: boolean,
    reviewedLocalTags: ReadonlyArray<ITagRefReview>
  ): Promise<boolean> {
    const gitStore = this.gitStoreCache.get(repository)
    return this.withTagLifecycleMutationGuard(repository, () =>
      gitStore.fetchLifecycleTags(prune, reviewedLocalTags)
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _deleteRemoteLifecycleTag(
    repository: Repository,
    review: IRemoteTagDeletionReview
  ): Promise<boolean> {
    const gitStore = this.gitStoreCache.get(repository)
    return this.withTagLifecycleMutationGuard(repository, () =>
      gitStore.deleteRemoteLifecycleTag(review)
    )
  }

  private updateCheckoutProgress(
    repository: Repository,
    checkoutProgress: ICheckoutProgress | null
  ) {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    this.repositoryStateCache.update(repository, () => ({
      checkoutProgress,
    }))

    if (
      this.selectedRepository instanceof Repository &&
      this.selectedRepository.id === repository.id
    ) {
      this.emitUpdate()
    }
  }

  /**
   * Checkout the given branch, using given stashing strategy or the default.
   *
   * When `explicitStrategy` is undefined we'll use the default strategy
   * configurable by the user in preferences. Without an explicit strategy
   * this method will take care of presenting the user with any necessary
   * confirmation dialogs and choices depending on the state of their
   * repository.
   *
   * When provided with an explicit strategy other than `AskForConfirmation`
   * we assume the user has been informed of any risks of overwritten stashes
   * and such. In other words the only consumers who should pass an explicit
   * strategy are dialogs and other confirmation constructs where the user
   * has made an explicit choice about how to proceed.
   *
   * Note: This shouldn't be called directly. See `Dispatcher`.
   */
  public async _checkoutBranch(
    repository: Repository,
    branch: Branch,
    explicitStrategy?: UncommittedChangesStrategy
  ): Promise<Repository> {
    const repositoryState = this.repositoryStateCache.get(repository)
    const { changesState, branchesState } = repositoryState
    const { currentBranchProtected } = changesState
    const { tip } = branchesState
    const hasChanges = changesState.workingDirectory.files.length > 0

    // No point in checking out the currently checked out branch.
    if (tip.kind === TipState.Valid && tip.branch.name === branch.name) {
      return repository
    }

    // If the branch is checked out in another worktree, switch to that worktree
    // instead of checking out the branch in the current worktree.
    const wt = repositoryState.worktrees.find(wt => wt.branch === branch.ref)

    if (wt) {
      return this._switchWorktree(repository, wt)
    }

    let strategy = explicitStrategy ?? this.uncommittedChangesStrategy

    // Always move changes to new branch if we're on a detached head, unborn
    // branch, or a protected branch.
    if (tip.kind !== TipState.Valid || currentBranchProtected) {
      strategy = UncommittedChangesStrategy.MoveToNewBranch
    }

    if (strategy === UncommittedChangesStrategy.AskForConfirmation) {
      if (hasChanges) {
        const type = PopupType.StashAndSwitchBranch
        this._showPopup({ type, branchToCheckout: branch, repository })
        return repository
      }
    }

    return this.withRefreshedGitHubRepository(repository, repository => {
      // We always want to end with refreshing the repository regardless of
      // whether the checkout succeeded or not in order to present the most
      // up-to-date information to the user.
      return this.checkoutImplementation(repository, branch, strategy)
        .then(() => this.onSuccessfulCheckout(repository, branch))
        .catch(async e => {
          this.emitError(new CheckoutError(e, repository, branch))
        })
        .then(() => this.refreshAfterCheckout(repository, branch.name))
        .finally(() => this.updateCheckoutProgress(repository, null))
    })
  }

  /** Invoke the best checkout implementation for the selected strategy */
  private checkoutImplementation(
    repository: Repository,
    branch: Branch,
    strategy: UncommittedChangesStrategy
  ) {
    const { currentRemote } = this.gitStoreCache.get(repository)

    if (strategy === UncommittedChangesStrategy.StashOnCurrentBranch) {
      return this.checkoutAndLeaveChanges(repository, branch, currentRemote)
    } else if (strategy === UncommittedChangesStrategy.MoveToNewBranch) {
      return this.checkoutAndBringChanges(repository, branch, currentRemote)
    } else {
      return this.checkoutIgnoringChanges(repository, branch, currentRemote)
    }
  }

  /** Checkout the given branch without taking local changes into account */
  private async checkoutIgnoringChanges(
    repository: Repository,
    branch: Branch,
    currentRemote: IRemote | null
  ) {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      checkoutBranch(repository, branch, currentRemote, progress => {
        this.updateCheckoutProgress(repository, progress)
      })
    )
  }

  /**
   * Checkout the given branch and leave any local changes on the current branch
   *
   * Existing stashes are preserved as older entries.
   */
  private async checkoutAndLeaveChanges(
    repository: Repository,
    branch: Branch,
    currentRemote: IRemote | null
  ) {
    const repositoryState = this.repositoryStateCache.get(repository)
    const { workingDirectory } = repositoryState.changesState
    const { tip } = repositoryState.branchesState

    if (tip.kind === TipState.Valid && workingDirectory.files.length > 0) {
      await this.createStashEntryForBranch(repository, tip.branch)
      this.statsStore.increment('stashCreatedOnCurrentBranchCount')
    }

    return this.checkoutIgnoringChanges(repository, branch, currentRemote)
  }

  /**
   * Checkout the given branch and move any local changes along.
   *
   * Will attempt to simply check out the branch and if that fails due to
   * local changes risking being overwritten it'll create a transient stash
   * entry, switch branches, and pop said stash entry.
   *
   * Note that the transient stash entry will not overwrite any current stash
   * entry for the target branch.
   */
  private async checkoutAndBringChanges(
    repository: Repository,
    branch: Branch,
    currentRemote: IRemote | null
  ) {
    try {
      await this.checkoutIgnoringChanges(repository, branch, currentRemote)
    } catch (checkoutError) {
      if (!isLocalChangesOverwrittenError(checkoutError)) {
        throw checkoutError
      }

      const stash = (await this.createStashEntry(repository, branch))
        ? await getLastDesktopStashEntryForBranch(repository, branch)
        : null

      // Failing to stash the changes when we know that there are changes
      // preventing a checkout is very likely due to assume-unchanged or
      // skip-worktree. So instead of showing a "could not create stash" error
      // we'll show the checkout error to the user and let them figure it out.
      if (stash === null) {
        throw checkoutError
      }

      await this.checkoutIgnoringChanges(repository, branch, currentRemote)
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        popStashEntry(repository, stash.stashSha)
      )

      this.statsStore.increment('changesTakenToNewBranchCount')
    }
  }

  private async onSuccessfulCheckout(repository: Repository, branch: Branch) {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const repositoryState = this.repositoryStateCache.get(repository)
    const { stashEntries } = repositoryState.changesState
    const { defaultBranch } = repositoryState.branchesState

    this.clearBranchProtectionState(repository)

    // Make sure changes or suggested next step are visible after branch checkout
    await this._selectWorkingDirectoryFiles(repository)
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }

    this._initializeCompare(repository, { kind: HistoryTabMode.History })

    if (defaultBranch !== null && branch.name !== defaultBranch.name) {
      this.statsStore.recordNonDefaultBranchCheckout()
    }

    if (stashEntries.length > 0 && !this.hasUserViewedStash) {
      this.statsStore.increment('stashNotViewedAfterCheckoutCount')
    }

    this.hasUserViewedStash = false
  }

  /**
   * @param commitish A branch name or a commit hash
   */
  private async refreshAfterCheckout(
    repository: Repository,
    commitish: string
  ) {
    this.updateCheckoutProgress(repository, {
      kind: 'checkout',
      title: `Refreshing ${__DARWIN__ ? 'Repository' : 'repository'}`,
      description: 'Checking out',
      value: 1,
      target: commitish,
    })

    await this._refreshRepository(repository)
    return repository
  }

  /**
   * Checkout the given commit, ignoring any local changes.
   *
   * Note: This shouldn't be called directly. See `Dispatcher`.
   */
  public async _checkoutCommit(
    repository: Repository,
    commit: CommitOneLine
  ): Promise<Repository> {
    const repositoryState = this.repositoryStateCache.get(repository)
    const { branchesState } = repositoryState
    const { tip } = branchesState
    const { currentRemote } = this.gitStoreCache.get(repository)

    // No point in checking out the currently checked out commit.
    if (
      (tip.kind === TipState.Valid && tip.branch.tip.sha === commit.sha) ||
      (tip.kind === TipState.Detached && tip.currentSha === commit.sha)
    ) {
      return repository
    }

    return this.withRefreshedGitHubRepository(repository, repository => {
      // We always want to end with refreshing the repository regardless of
      // whether the checkout succeeded or not in order to present the most
      // up-to-date information to the user.
      return this.checkoutCommitDefaultBehaviour(
        repository,
        commit,
        currentRemote
      )
        .catch(e => this.emitError(new Error(e)))
        .then(() =>
          this.refreshAfterCheckout(repository, shortenSHA(commit.sha))
        )
        .finally(() => this.updateCheckoutProgress(repository, null))
    })
  }

  private async checkoutCommitDefaultBehaviour(
    repository: Repository,
    commit: CommitOneLine,
    currentRemote: IRemote | null
  ) {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      checkoutCommit(repository, commit, currentRemote, progress => {
        this.updateCheckoutProgress(repository, progress)
      })
    )
  }

  /**
   * Creates a stash associated to the current checked out branch.
   * Each invocation appends a new entry instead of overwriting an older stash.
   */
  public async _createStashForCurrentBranch(
    repository: Repository
  ): Promise<boolean> {
    const repositoryState = this.repositoryStateCache.get(repository)
    const tip = repositoryState.branchesState.tip
    const currentBranch = tip.kind === TipState.Valid ? tip.branch : null

    if (currentBranch === null) {
      return false
    }

    if (await this.createStashEntryForBranch(repository, currentBranch)) {
      this.statsStore.increment('stashCreatedOnCurrentBranchCount')
      await this._refreshRepository(repository)
      return true
    }

    return false
  }

  /** Create a reviewed named stash from all changes or an exact selected set. */
  public async _createManagedStash(
    repository: Repository,
    request: ICreateManagedStashRequest,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return false
    }
    let state = this.repositoryStateCache.get(repository)
    const tip = state.branchesState.tip
    if (tip.kind !== TipState.Valid) {
      throw new StashManagerError(
        'stale-entry',
        'Check out a local branch before creating a managed stash.'
      )
    }

    let selectedPaths: ReadonlyArray<string> | null = null
    if (request.scope === 'selected') {
      if (request.selectedPaths.length === 0) {
        throw new StashManagerError(
          'invalid-input',
          'Select at least one changed file, or choose all changes.'
        )
      }

      // A path-scoped stash would otherwise include unrelated staged changes.
      // Match the existing selected-stash behavior, then re-read status and
      // verify every reviewed path at the mutation boundary.
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        unstageAll(repository)
      )
      await this._loadStatus(repository)
      if (!this.isTemporaryRepositoryActive(repository)) {
        return false
      }
      state = this.repositoryStateCache.get(repository)
      if (
        state.branchesState.tip.kind !== TipState.Valid ||
        state.branchesState.tip.branch.name !== tip.branch.name
      ) {
        throw new StashManagerError(
          'stale-entry',
          'The checked-out branch changed during review. Nothing was stashed.'
        )
      }
      const currentFiles = new Map(
        state.changesState.workingDirectory.files.map(file => [file.path, file])
      )
      if (request.selectedPaths.some(path => !currentFiles.has(path))) {
        throw new StashManagerError(
          'stale-entry',
          'The selected changes changed during review. Refresh and choose them again.'
        )
      }
      selectedPaths = request.selectedPaths.filter(
        path =>
          request.includeUntracked ||
          currentFiles.get(path)?.status.kind !== AppFileStatusKind.Untracked
      )
      if (selectedPaths.length === 0) {
        throw new StashManagerError(
          'invalid-input',
          'The selection contains only untracked files. Enable Include untracked or choose tracked changes.'
        )
      }
    }

    try {
      const created = await this.withTemporaryRepositoryMutationGuard(
        repository,
        () =>
          createNamedDesktopStashEntry(
            repository,
            tip.branch,
            request.displayName,
            selectedPaths,
            request.includeUntracked,
            signal
          )
      )
      if (created) {
        this.statsStore.increment('stashCreatedOnCurrentBranchCount')
      }
      return created
    } finally {
      await this._refreshRepository(repository)
    }
  }

  /** Apply a reviewed stash while retaining its recovery entry. */
  public async _applyStashKeepingEntry(
    repository: Repository,
    stashEntry: IStashEntry,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        applyDesktopStashEntry(repository, stashEntry.stashSha, signal)
      )
    } finally {
      await this._refreshRepository(repository)
    }
  }

  /** Rename and/or move the branch association for a reviewed stash. */
  public async _updateManagedStash(
    repository: Repository,
    stashEntry: IStashEntry,
    request: IUpdateManagedStashRequest,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        updateDesktopStashEntry(
          repository,
          stashEntry.stashSha,
          request.branchName,
          request.displayName,
          signal
        )
      )
    } finally {
      if (this.isTemporaryRepositoryActive(repository)) {
        await this.gitStoreCache.get(repository).loadStashEntries()
      }
    }
  }

  /** Create and check out a validated local branch from a reviewed stash. */
  public async _createBranchFromManagedStash(
    repository: Repository,
    stashEntry: IStashEntry,
    branchName: string,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        createBranchFromDesktopStash(
          repository,
          stashEntry.stashSha,
          branchName,
          signal
        )
      )
    } finally {
      await this._refreshRepository(repository)
    }
  }

  /** Clear only the exact Desktop-managed entries reviewed in the UI. */
  public async _clearReviewedManagedStashes(
    repository: Repository,
    stashShas: ReadonlyArray<string>,
    signal?: AbortSignal
  ): Promise<number> {
    try {
      return await this.withTemporaryRepositoryMutationGuard(repository, () =>
        clearReviewedDesktopStashes(repository, stashShas, signal)
      )
    } finally {
      if (this.isTemporaryRepositoryActive(repository)) {
        await this.gitStoreCache.get(repository).loadStashEntries()
      }
    }
  }

  /**
   * refetches the associated GitHub remote repository, if possible
   *
   * if refetching fails, will return the given `repository` with
   * the same info it was passed in with
   *
   * @param repository
   * @returns repository model (hopefully with fresh `gitHubRepository` info)
   */
  private async repositoryWithRefreshedGitHubRepository(
    repository: Repository
  ): Promise<Repository> {
    if (isSubmoduleRepository(repository)) {
      return repository
    }

    const repoStore = this.repositoriesStore
    const match = await this.matchGitHubRepository(repository)

    // TODO: We currently never clear GitHub repository associations (see
    // https://github.com/desktop/desktop/issues/1144). So we can bail early at
    // this point.
    if (!match) {
      return repository
    }

    const { account, owner, name } = match
    const { endpoint } = account
    const api = API.fromAccount(account)
    const apiRepo = await api.fetchRepository(owner, name)

    if (apiRepo === null) {
      // If the request fails, we want to preserve the existing GitHub
      // repository info. But if we didn't have a GitHub repository already or
      // the endpoint changed, the skeleton repository is better than nothing.
      if (endpoint !== repository.gitHubRepository?.endpoint) {
        const ghRepo = await repoStore.upsertGitHubRepositoryFromMatch(match)
        return repoStore.setGitHubRepository(repository, ghRepo)
      }

      return repository
    }

    if (repository.gitHubRepository) {
      const gitStore = this.gitStoreCache.get(repository)
      await updateRemoteUrl(gitStore, repository.gitHubRepository, apiRepo)
    }

    const ghRepo = await repoStore.upsertGitHubRepository(endpoint, apiRepo)
    const freshRepo = await repoStore.setGitHubRepository(repository, ghRepo)

    await this.refreshBranchProtectionState(freshRepo)
    return freshRepo
  }

  /**
   * When enabled, make the selected repository's owning account the active
   * identity so the visible account indicator (positional `accounts[0]`) and
   * any unbound endpoint-fallback actions follow the repo owner. Bound actions
   * already resolve per-repo via `getAccountForRepository`, so this only moves
   * the positional "active" identity — it never changes tokens or re-auths, and
   * it never writes `repository.accountKey` (auto-binding stays a
   * settings/triage responsibility).
   *
   * The reorder is deliberately fire-and-forget (no `await`): `_selectRepository`
   * is re-entrant, and `promoteAccount`'s async `save()` only emits an update —
   * it never recurses back into repository selection. Because
   * `getRepositoryOwnerAccountToPromote` returns `null` when the owner is
   * already active, a promotion (and the API refresh it triggers via the
   * accounts `onDidUpdate` handler) only fires when the active identity actually
   * changes, not on every selection.
   */
  private maybePromoteAccountForRepository(
    repository: Repository | CloningRepository | null
  ) {
    if (
      repository === null ||
      !(repository instanceof Repository) ||
      !isRepositoryWithGitHubRepository(repository)
    ) {
      return
    }

    const owner = getRepositoryOwnerAccountToPromote(
      this.accounts,
      repository,
      this.autoSwitchAccountToRepositoryOwner
    )

    if (owner === null) {
      return
    }

    // Reorder via the AccountsStore directly (a pure array reorder + save; no
    // token re-fetch). NOTE: GitHub.com accounts always sort ahead of
    // Enterprise accounts, so an Enterprise-owned repo cannot become
    // `accounts[0]` while any GitHub.com account is signed in.
    this.accountsStore.promoteAccount(owner)
  }

  /**
   * Refreshes the GitHub repository information for the currently selected
   * repository when the active account changes. This ensures that permission
   * information is updated after signing in/out.
   */
  private async refreshSelectedRepositoryAfterAccountChange() {
    const repository = this.selectedRepository

    if (repository === null || repository instanceof CloningRepository) {
      return
    }

    if (!isRepositoryWithGitHubRepository(repository)) {
      return
    }

    await this.repositoryWithRefreshedGitHubRepository(repository)
  }

  private async updateBranchProtectionsFromAPI(repository: Repository) {
    if (repository.gitHubRepository === null) {
      return
    }

    const { owner, name } = repository.gitHubRepository

    const account = getAccountForEndpoint(
      this.accounts,
      repository.gitHubRepository.endpoint
    )

    if (account === null) {
      return
    }

    const api = API.fromAccount(account)

    const branches = await api.fetchProtectedBranches(owner.login, name)

    await this.repositoriesStore.updateBranchProtections(
      repository.gitHubRepository,
      branches
    )
  }

  private async matchGitHubRepository(
    repository: Repository
  ): Promise<IMatchedGitHubRepository | null> {
    const gitStore = this.gitStoreCache.get(repository)

    if (!gitStore.defaultRemote) {
      await gitStore.loadRemotes()
    }

    const remote = gitStore.defaultRemote
    return remote !== null
      ? matchGitHubRepository(this.accounts, remote.url, repository.accountKey)
      : null
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _pushError(error: Error): Promise<void> {
    const presentation = getAppErrorPresentation(error)

    if (shouldPresentErrorAsNotice(error, this.errorPresentationStyle)) {
      const underlying =
        error instanceof ErrorWithMetadata ? error.underlyingError : error
      const repository =
        error instanceof ErrorWithMetadata &&
        error.metadata.repository instanceof Repository
          ? error.metadata.repository
          : null
      const action =
        underlying instanceof GitError &&
        underlying.result.gitError === DugiteError.LockFileAlreadyExists &&
        repository !== null &&
        gitErrorReferencesRepositoryIndexLock(underlying, repository)
          ? {
              kind: 'remove-repository-lock' as const,
              repositoryId: repository.id,
            }
          : undefined
      this.errorNotices = enqueueErrorNotice(this.errorNotices, {
        title: presentation.title,
        message: presentation.message,
        details: presentation.details,
        ...(action === undefined
          ? {}
          : { dedupeKey: `repository-index-lock:${action.repositoryId}` }),
        ...(action === undefined ? {} : { action }),
      }).notices
    } else {
      this.popupManager.addErrorPopup(error)
    }

    this.postNotification({
      kind: 'app-error',
      title: presentation.title,
      body: presentation.message,
    })
    this.emitUpdate()

    return Promise.resolve()
  }

  /**
   * Record an in-app notification. Public entry point for the dispatcher and for
   * other orchestrators (clone-batch, auto-commit, merge-all, auto-pull) that
   * post their summaries to the notification centre. Never throws.
   */
  public postNotification(input: INotificationInput): void {
    const referencedRepositoryId =
      input.repositoryId ??
      (input.action?.kind === 'open-repository'
        ? input.action.repositoryId
        : undefined)
    if (referencedRepositoryId !== undefined && referencedRepositoryId < 0) {
      const selected = this.selectedRepository
      const parent =
        isSubmoduleRepository(selected) &&
        selected.id === referencedRepositoryId
          ? this.getCurrentSubmoduleParent(selected)
          : null
      input = {
        kind: input.kind,
        title: input.title,
        body: input.body,
        ...(input.accountKey !== undefined
          ? { accountKey: input.accountKey }
          : {}),
        ...(parent !== null
          ? {
              repositoryId: parent.id,
              action: {
                kind: 'open-repository' as const,
                repositoryId: parent.id,
              },
            }
          : {}),
      }
    }
    this.notificationCentreStore
      .post(input)
      .catch(err => log.error('Failed to record notification', err))
  }

  public _setGlobalAutomationSettings(
    settings: IAutomationSettingsState['global']
  ): void {
    this.automationSettings = { ...this.automationSettings, global: settings }
    saveAutomationSettings(this.automationSettings)
    this.emitUpdate()
    this.restartAutomationScheduler()
  }

  public _setAccountAutomationOverrides(
    accountKey: string,
    overrides: IAutomationSettingsOverrides
  ): void {
    this.automationSettings = {
      ...this.automationSettings,
      accounts: {
        ...this.automationSettings.accounts,
        [accountKey]: overrides,
      },
    }
    saveAutomationSettings(this.automationSettings)
    this.emitUpdate()
    this.restartAutomationScheduler()
  }

  public _setAutomationSettings(settings: IAutomationSettingsState): void {
    this.automationSettings = settings
    saveAutomationSettings(settings)
    this.emitUpdate()
    this.restartAutomationScheduler()
  }

  public _setRepositoryAutomationOverrides(
    repositoryId: number,
    overrides: IAutomationSettingsOverrides
  ): void {
    if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
      return
    }
    saveRepositoryAutomationOverrides(repositoryId, overrides)
    this.emitUpdate()
    if (
      this.selectedRepository instanceof Repository &&
      this.selectedRepository.id === repositoryId
    ) {
      this.restartAutomationScheduler()
    }
  }

  private setOneClickCommitPushPhase(
    repository: Repository,
    phase: OneClickCommitPushPhase
  ): void {
    this.repositoryStateCache.update(repository, () => ({
      oneClickCommitPushPhase: phase,
    }))
    this.emitUpdate()
  }

  private getAutomationGuardState(
    repository: Repository,
    mergeHeadSet: boolean = false
  ): IAutomationGuardState {
    const state = this.repositoryStateCache.get(repository)
    const { tip } = state.branchesState
    const message = state.changesState.commitMessage
    return {
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
      mergeHeadSet,
    }
  }

  public async _oneClickCommitAndPush(repository: Repository): Promise<void> {
    const guard = canAutoCommitPush(this.getAutomationGuardState(repository))
    if (!guard.safe) {
      this.postNotification({
        kind: 'info',
        title: 'Commit and push skipped',
        body: guard.reason,
        repositoryId: repository.id,
        action: { kind: 'open-repository', repositoryId: repository.id },
      })
      return
    }

    const files =
      this.repositoryStateCache.get(repository).changesState.workingDirectory
        .files
    let context: ICommitContext = buildFallbackCommitMessage(files, new Date())

    try {
      this.setOneClickCommitPushPhase(repository, 'generating')
      context =
        (await this.generateAutomationCommitMessage(repository, files)) ??
        context

      await this._changeIncludeAllFiles(repository, true)
      this.setOneClickCommitPushPhase(repository, 'committing')
      const committed = await this._commitIncludedChanges(repository, context)
      if (!committed) {
        throw new Error('The commit did not complete.')
      }

      this.setOneClickCommitPushPhase(repository, 'pushing')
      await this._push(repository)
      this.postNotification({
        kind: 'auto-commit',
        title: 'Committed and pushed',
        body: context.summary,
        repositoryId: repository.id,
        action: { kind: 'open-repository', repositoryId: repository.id },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('One-click commit and push failed', error)
      this.postNotification({
        kind: 'auto-commit',
        title: 'Commit and push failed',
        body: message,
        repositoryId: repository.id,
        action: { kind: 'open-repository', repositoryId: repository.id },
      })
    } finally {
      this.setOneClickCommitPushPhase(repository, null)
    }
  }

  private async generateAutomationCommitMessage(
    repository: Repository,
    files: ReadonlyArray<WorkingDirectoryFileChange>
  ): Promise<ICommitContext | null> {
    const account = getAccountForCommitMessageGeneration(
      this.accounts,
      repository
    )
    const disclaimerFresh =
      this.commitMessageGenerationDisclaimerLastSeen !== null &&
      offsetFromNow(-30, 'days') <=
        this.commitMessageGenerationDisclaimerLastSeen
    if (!account || !disclaimerFresh) {
      return null
    }

    let context: ICommitContext | null = null
    await this.withIsGeneratingCommitMessage(repository, async signal => {
      try {
        const diff = await getFilesDiffText(repository, files)
        if (!diff) {
          return false
        }
        const response = enableCopilotSdkCommitMessageGeneration(account)
          ? await this.copilotStore.generateCommitMessage(
              account,
              diff,
              repository.path,
              await this.resolveCopilotModelRequest(
                this.selectedCopilotModels['commit-message-generation'] ?? null
              ),
              this.repositoryStateCache
                .get(repository)
                .changesState.currentRepoRulesInfo?.commitMessagePatterns.getRules() ??
                [],
              signal
            )
          : await API.fromAccount(account).getDiffChangesCommitMessage(diff)
        context = {
          summary: response.title,
          description: response.description,
          messageGeneratedByCopilot: true,
        }
        this.statsStore.increment('generateCommitMessageCount')
        return true
      } catch (error) {
        log.warn(
          'Automation commit-message generation failed; using fallback',
          error
        )
        return false
      }
    })
    return context
  }

  private updateMergeAllState(
    repository: Repository,
    update: Partial<IMergeAllState>
  ): void {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const current = this.repositoryStateCache.get(repository).mergeAllState
    if (current === null) {
      return
    }
    this.repositoryStateCache.update(repository, () => ({
      mergeAllState: { ...current, ...update },
    }))
    this.emitUpdate()
  }

  public _cancelMergeAll(repository: Repository): void {
    this.mergeAllControllers.get(repository.id)?.abort()
  }

  public async _mergeAllIntoDefaultBranch(
    repository: Repository,
    mode: MergeAllMode
  ): Promise<void> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    if (this.mergeAllControllers.has(repository.id)) {
      return
    }

    const controller = new AbortController()
    this.mergeAllControllers.set(repository.id, controller)
    this.stopAutomationScheduler()
    this.repositoryStateCache.update(repository, () => ({
      mergeAllState: {
        phase: 'preparing',
        mode,
        currentBranch: null,
        copilotProgress: null,
        results: [],
        pushed: false,
      },
    }))
    this.emitUpdate()

    try {
      await this.performMergeAll(repository, mode, controller.signal)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (this.isTemporaryRepositoryActive(repository)) {
        const current = this.repositoryStateCache.get(repository).mergeAllState
        this.updateMergeAllState(repository, {
          phase: controller.signal.aborted ? 'cancelled' : 'complete',
          currentBranch: null,
          results: [
            ...(current?.results ?? []),
            {
              branch: 'Merge all',
              status: controller.signal.aborted ? 'skipped' : 'failed',
              detail: controller.signal.aborted ? 'Cancelled.' : message,
            },
          ],
        })
      }
      log.error(
        'Merge-all operation stopped',
        error instanceof Error ? error : new Error(message)
      )
    } finally {
      if (this.mergeAllControllers.get(repository.id) === controller) {
        this.mergeAllControllers.delete(repository.id)
      }
      if (this.isTemporaryRepositoryActive(repository)) {
        const state = this.repositoryStateCache.get(repository).mergeAllState
        const results = state?.results ?? []
        this.postNotification({
          kind: 'merge-all',
          title: `Merge all ${
            state?.phase === 'cancelled' ? 'cancelled' : 'complete'
          }`,
          body: `${results.filter(r => r.status === 'merged').length} merged, ${
            results.filter(r => r.status === 'up-to-date').length
          } up to date, ${
            results.filter(r => r.status === 'skipped').length
          } skipped, ${
            results.filter(r => r.status === 'failed').length
          } failed.`,
          repositoryId: repository.id,
          action: { kind: 'open-repository', repositoryId: repository.id },
        })
        if (this.selectedRepository === repository) {
          this.restartAutomationScheduler()
        }
      }
    }
  }

  private async performMergeAll(
    repository: Repository,
    mode: MergeAllMode,
    signal: AbortSignal
  ): Promise<void> {
    await this._refreshRepository(repository)
    if (signal.aborted || !this.isTemporaryRepositoryActive(repository)) {
      throw new Error('Merge all cancelled.')
    }
    const initial = this.repositoryStateCache.get(repository)
    const defaultBranch = initial.branchesState.defaultBranch
    if (defaultBranch === null) {
      throw new Error('No default branch is configured.')
    }
    if (
      initial.changesState.workingDirectory.files.length > 0 ||
      initial.changesState.conflictState !== null ||
      initial.multiCommitOperationState !== null ||
      initial.isPushPullFetchInProgress ||
      initial.isCommitting ||
      initial.isGeneratingCommitMessage ||
      initial.oneClickCommitPushPhase !== null ||
      initial.checkoutProgress !== null
    ) {
      throw new Error('The repository must be clean and idle before merging.')
    }

    const worktrees = await listWorktrees(repository)
    if (
      worktrees.some(
        worktree =>
          worktree.path !== repository.path &&
          worktree.branch === defaultBranch.ref
      )
    ) {
      throw new Error('The default branch is checked out in another worktree.')
    }

    if (
      initial.branchesState.tip.kind !== TipState.Valid ||
      initial.branchesState.tip.branch.name !== defaultBranch.name
    ) {
      await this._checkoutBranch(repository, defaultBranch)
      await this._refreshRepository(repository)
    }

    if (signal.aborted || !this.isTemporaryRepositoryActive(repository)) {
      throw new Error('Merge all cancelled.')
    }
    const refreshed = this.repositoryStateCache.get(repository)
    if (
      refreshed.branchesState.tip.kind !== TipState.Valid ||
      refreshed.branchesState.tip.branch.name !== defaultBranch.name
    ) {
      throw new Error('Could not check out the default branch.')
    }
    let candidates: ReadonlyArray<IMergeAllCandidate>
    let results: ReadonlyArray<IMergeAllResult> = []
    if (mode === 'branches') {
      candidates = selectBranchCandidates(
        refreshed.branchesState.allBranches,
        defaultBranch.name,
        new Set(
          worktrees.map(worktree => worktree.branch).filter(Boolean) as string[]
        )
      )
    } else {
      const selection = selectWorktreeCandidates(
        worktrees,
        refreshed.branchesState.allBranches
      )
      candidates = selection.candidates
      results = selection.skipped
    }
    this.updateMergeAllState(repository, { results })

    let mergedAny = false
    for (const candidate of candidates) {
      if (signal.aborted || !this.isTemporaryRepositoryActive(repository)) {
        throw new Error('Merge all cancelled.')
      }
      this.updateMergeAllState(repository, {
        phase: 'merging',
        currentBranch: candidate.branch.name,
        copilotProgress: null,
      })

      const outcome = await this.mergeAllCandidate(
        repository,
        candidate,
        signal
      )
      if (signal.aborted || !this.isTemporaryRepositoryActive(repository)) {
        throw new Error('Merge all cancelled.')
      }
      mergedAny ||= outcome.status === 'merged'
      results = [...results, outcome]
      this.updateMergeAllState(repository, { results })
    }

    if (
      mergedAny &&
      !signal.aborted &&
      this.isTemporaryRepositoryActive(repository)
    ) {
      this.updateMergeAllState(repository, {
        phase: 'pushing',
        currentBranch: null,
      })
      await this._push(repository)
      this.updateMergeAllState(repository, { pushed: true })
    }

    this.updateMergeAllState(repository, {
      phase: signal.aborted ? 'cancelled' : 'complete',
      currentBranch: null,
      copilotProgress: null,
    })
    await this._refreshRepository(repository)
  }

  private async mergeAllCandidate(
    repository: Repository,
    candidate: IMergeAllCandidate,
    signal: AbortSignal
  ): Promise<IMergeAllResult> {
    const base = {
      branch: candidate.branch.name,
      ...(candidate.worktree ? { path: candidate.worktree.path } : {}),
    }
    let completedStatus: 'merged' | 'up-to-date' | null = null
    try {
      if (candidate.worktree !== undefined) {
        const status = await git(
          ['status', '--porcelain'],
          candidate.worktree.path,
          'mergeAllWorktreeStatus'
        )
        if (status.stdout.trim().length > 0) {
          return {
            ...base,
            status: 'skipped',
            detail: 'Worktree has uncommitted changes.',
          }
        }
      }

      const gitStore = this.gitStoreCache.get(repository)
      const mergeResult = await this.withTemporaryRepositoryMutationGuard(
        repository,
        () => gitStore.merge(candidate.branch)
      )
      let status: IMergeAllResult['status']
      if (mergeResult === MergeResult.Success) {
        status = 'merged'
      } else if (mergeResult === MergeResult.AlreadyUpToDate) {
        status = 'up-to-date'
      } else if (await isMergeHeadSet(repository)) {
        await this._refreshRepository(repository)
        this.updateMergeAllState(repository, {
          phase: 'resolving',
          currentBranch: candidate.branch.name,
        })
        const resolution = await this._resolveConflictsWithCopilot(
          repository,
          progress =>
            this.updateMergeAllState(repository, {
              copilotProgress:
                progress.reasoningSnippet ??
                `Resolved ${progress.filesResolved} of ${progress.filesTotal} files`,
            }),
          signal
        )
        if (resolution === null || signal.aborted) {
          await this.withTemporaryRepositoryMutationGuard(repository, () =>
            abortMerge(repository)
          )
          await this._refreshRepository(repository)
          return {
            ...base,
            status: 'skipped',
            detail: signal.aborted
              ? 'Cancelled during conflict resolution.'
              : 'Copilot could not resolve the conflicts.',
          }
        }
        await this.withTemporaryRepositoryMutationGuard(repository, () =>
          this.applyCopilotResolutionsToDisk(
            repository,
            resolution.resolutions,
            new Map<string, ManualConflictResolution>()
          )
        )
        const conflictState = this.repositoryStateCache.get(repository)
        const commit = await this._finishConflictedMerge(
          repository,
          conflictState.changesState.workingDirectory,
          new Map<string, ManualConflictResolution>()
        )
        if (commit === undefined || (await isMergeHeadSet(repository))) {
          await this.withTemporaryRepositoryMutationGuard(repository, () =>
            abortMerge(repository)
          )
          await this._refreshRepository(repository)
          return {
            ...base,
            status: 'skipped',
            detail: 'The resolved merge could not be committed.',
          }
        }
        status = 'merged'
      } else {
        return {
          ...base,
          status: 'skipped',
          detail: 'Git could not merge this branch.',
        }
      }
      completedStatus = status

      this.updateMergeAllState(repository, {
        phase: 'cleaning',
        currentBranch: candidate.branch.name,
      })
      if (candidate.worktree !== undefined) {
        await this.withTemporaryRepositoryMutationGuard(repository, () =>
          removeWorktree(repository.path, candidate.worktree!.path, false)
        )
        await this._refreshWorktrees(repository)
      }
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        deleteLocalBranch(repository, candidate.branch.name)
      )
      return {
        ...base,
        status,
        detail:
          status === 'merged'
            ? 'Merged, cleaned up, and deleted.'
            : 'Already up to date; cleaned up and deleted.',
      }
    } catch (error) {
      if (await isMergeHeadSet(repository)) {
        // If aborting itself fails, stop the entire run rather than carrying a
        // poisoned merge state into the next candidate.
        await this.withTemporaryRepositoryMutationGuard(repository, () =>
          abortMerge(repository)
        )
        await this._refreshRepository(repository)
      }
      if (completedStatus !== null) {
        return {
          ...base,
          status: completedStatus,
          detail: `Merge completed, but cleanup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }
      }
      return {
        ...base,
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** Open or close the notification centre side sheet. */
  public _setNotificationCentreOpen(open: boolean): void {
    this.notificationCentreStore.setOpen(open)
  }

  /** Mark a single notification read. */
  public _markNotificationRead(id: string): Promise<void> {
    return this.notificationCentreStore.markRead(id)
  }

  /** Mark a single notification unread. */
  public _markNotificationUnread(id: string): Promise<void> {
    return this.notificationCentreStore.markUnread(id)
  }

  /** Delete a single notification. */
  public _deleteNotification(id: string): Promise<void> {
    return this.notificationCentreStore.delete(id)
  }

  /** Set the read state of an explicit notification selection atomically. */
  public _setNotificationsRead(
    ids: ReadonlyArray<string>,
    read: boolean
  ): Promise<void> {
    return this.notificationCentreStore.setReadMany(ids, read)
  }

  /** Delete an explicit notification selection atomically. */
  public _deleteNotifications(ids: ReadonlyArray<string>): Promise<void> {
    return this.notificationCentreStore.deleteMany(ids)
  }

  /** Mark every notification read. */
  public _markAllNotificationsRead(): Promise<void> {
    return this.notificationCentreStore.markAllRead()
  }

  /** Remove every notification. */
  public _clearAllNotifications(): Promise<void> {
    return this.notificationCentreStore.clearAll()
  }

  /** Load a page of notification history commits. */
  public getNotificationHistory(
    skip?: number,
    limit?: number
  ): Promise<IProfileHistoryPage> {
    return this.notificationCentreStore.getHistory(skip, limit)
  }

  /** Load the paths changed by a notification-history commit. */
  public getNotificationHistoryFiles(
    sha: string
  ): Promise<ReadonlyArray<string>> {
    return this.notificationCentreStore.getHistoryFiles(sha)
  }

  /** Load a unified notification-history diff, optionally narrowed to a file. */
  public getNotificationHistoryDiff(
    sha: string,
    file?: string
  ): Promise<string> {
    return this.notificationCentreStore.getHistoryDiff(sha, file)
  }

  /** Undo the latest notification change and re-read the log from disk. */
  public undoLastNotificationChange(): Promise<void> {
    return this.notificationCentreStore.undoLastChange()
  }

  /** Redo the latest notification undo and re-read the log from disk. */
  public redoLastNotificationChange(): Promise<void> {
    return this.notificationCentreStore.redoLastChange()
  }

  /** Restore the notification log to a prior commit and re-read from disk. */
  public restoreNotificationsTo(sha: string): Promise<void> {
    return this.notificationCentreStore.restoreTo(sha)
  }

  // --- Notification automations ----------------------------------------------

  /**
   * The current automation rules. Every rule loads disarmed (enabled: false);
   * arming is a deliberate per-session `_setNotificationAutomationRuleEnabled`
   * call (see NotificationAutomationStore for the untrusted-on-load rationale).
   */
  public getNotificationAutomationRules(): Promise<
    ReadonlyArray<INotificationAutomationRule>
  > {
    return this.notificationAutomationStore.getRules()
  }

  /** Create or replace an automation rule. */
  public _saveNotificationAutomationRule(
    rule: INotificationAutomationRule
  ): Promise<void> {
    return this.notificationAutomationStore.saveRule(rule)
  }

  /** Remove an automation rule. */
  public _removeNotificationAutomationRule(id: string): Promise<void> {
    return this.notificationAutomationStore.removeRule(id)
  }

  /** Arm or disarm an automation rule for the current session. */
  public _setNotificationAutomationRuleEnabled(
    id: string,
    enabled: boolean
  ): Promise<void> {
    return this.notificationAutomationStore.setRuleEnabled(id, enabled)
  }

  /** Load a page of automation-history commits. */
  public getNotificationAutomationHistory(
    skip?: number,
    limit?: number
  ): Promise<IProfileHistoryPage> {
    return this.notificationAutomationStore.getHistory(skip, limit)
  }

  /** Undo the latest automation change and re-read the rules from disk. */
  public undoLastNotificationAutomationChange(): Promise<void> {
    return this.notificationAutomationStore.undoLastChange()
  }

  /** Redo the latest automation undo and re-read the rules from disk. */
  public redoLastNotificationAutomationChange(): Promise<void> {
    return this.notificationAutomationStore.redoLastChange()
  }

  /** Restore the automation rules to a prior commit and re-read from disk. */
  public restoreNotificationAutomationsTo(sha: string): Promise<void> {
    return this.notificationAutomationStore.restoreTo(sha)
  }

  /**
   * Evaluate the armed rules against a freshly inserted notification and run the
   * matching actions in the main process. Never throws into the post path
   * (mirrors the automation scheduler discipline): every failure is logged and,
   * where possible, surfaced as a receipt notification.
   *
   * The loop guard lives in {@link evaluateNotificationAutomations}, which
   * returns nothing for an automation receipt, so a run can never trigger on the
   * `info` notification a previous run posted.
   */
  private runNotificationAutomations(entry: INotificationEntry): void {
    this.notificationAutomationStore
      .getRules()
      .then(async rules => {
        const matches = evaluateNotificationAutomations(rules, entry)
        for (const rule of matches) {
          // Re-check the armed flag at fire time; rules can be disarmed between
          // load and dispatch.
          if (!rule.enabled) {
            continue
          }
          await this.runNotificationAutomation(rule, entry)
        }
      })
      .catch(err =>
        log.error('Failed to evaluate notification automations', err)
      )
  }

  private async runNotificationAutomation(
    rule: INotificationAutomationRule,
    entry: INotificationEntry
  ): Promise<void> {
    try {
      if (rule.action.type === 'webhook') {
        const result = await runNotificationAutomationWebhook({ rule, entry })
        this.postAutomationReceipt(
          rule,
          result.ok
            ? `Webhook responded ${result.status ?? ''}`.trim()
            : `Webhook failed: ${result.reason ?? `status ${result.status}`}`
        )
      } else {
        const result = await runNotificationAutomationCommand({ rule, entry })
        this.postAutomationReceipt(
          rule,
          result.ok
            ? `Command exited ${result.code ?? 0}`
            : `Command failed: ${result.reason ?? `exit ${result.code}`}`
        )
      }
    } catch (err) {
      log.error(`Notification automation "${rule.name}" failed to run`, err)
      this.postAutomationReceipt(
        rule,
        `Could not run: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  /**
   * Record what an automation did as an `info` notification. The
   * {@link NotificationAutomationReceiptPrefix} title marks it as a receipt so
   * the evaluator skips it and never fires an automation on it.
   */
  private postAutomationReceipt(
    rule: INotificationAutomationRule,
    body: string
  ): void {
    this.postNotification({
      kind: 'info',
      title: `${NotificationAutomationReceiptPrefix}${rule.name}`,
      body,
    })
  }

  /** Load a page of log-history commits. */
  public getLogHistory(
    skip?: number,
    limit?: number
  ): Promise<IProfileHistoryPage> {
    return this.logStore.getHistory(skip, limit)
  }

  /** Load the paths changed by a log-history commit. */
  public getLogHistoryFiles(sha: string): Promise<ReadonlyArray<string>> {
    return this.logStore.getHistoryFiles(sha)
  }

  /** Load a unified log-history diff, optionally narrowed to a file. */
  public getLogHistoryDiff(sha: string, file?: string): Promise<string> {
    return this.logStore.getHistoryDiff(sha, file)
  }

  /** Undo the latest log change and re-read the log from disk. */
  public undoLastLogChange(): Promise<void> {
    return this.logStore.undoLastChange()
  }

  /** Redo the latest log undo and re-read the log from disk. */
  public redoLastLogChange(): Promise<void> {
    return this.logStore.redoLastChange()
  }

  /** Restore the log file to a prior commit and re-read from disk. */
  public restoreLogsTo(sha: string): Promise<void> {
    return this.logStore.restoreTo(sha)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _changeRepositoryAlias(
    repository: Repository,
    newAlias: string | null
  ): Promise<void> {
    return this.repositoriesStore.updateRepositoryAlias(repository, newAlias)
  }

  public async _changeRepositoryGroupName(
    repository: Repository,
    newGroupName: string | null
  ): Promise<void> {
    return this.repositoriesStore.updateRepositoryGroupName(
      [repository],
      newGroupName
    )
  }

  public async _updateRepositoryDefaultBranch(
    repository: Repository,
    defaultBranch: string | null
  ): Promise<void> {
    const updated = await this.repositoriesStore.updateRepositoryDefaultBranch(
      repository,
      defaultBranch
    )
    await this._refreshRepository(updated)
  }

  public async _updateRepositoryEditorOverride(
    repository: Repository,
    editorOverride: import('../../models/editor-override').EditorOverride | null
  ): Promise<void> {
    await this.repositoriesStore.updateRepositoryEditorOverride(
      repository,
      editorOverride
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _renameBranch(
    repository: Repository,
    branch: Branch,
    newName: string
  ): Promise<void> {
    const gitStore = this.gitStoreCache.get(repository)
    await gitStore.performFailableOperation(async () => {
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        renameBranch(repository, branch, newName)
      )

      const stashEntries = gitStore.desktopStashEntries.get(branch.name) ?? []

      for (const stashEntry of stashEntries) {
        await this.withTemporaryRepositoryMutationGuard(repository, () =>
          moveStashEntry(repository, stashEntry, newName)
        )
      }
    })

    return this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _deleteBranch(
    repository: Repository,
    branch: Branch,
    includeUpstream?: boolean,
    toCheckout?: Branch | null
  ): Promise<void> {
    return this.withRefreshedGitHubRepository(repository, async repository => {
      const gitStore = this.gitStoreCache.get(repository)

      // If solely a remote branch, there is no need to checkout a branch.
      if (branch.type === BranchType.Remote) {
        const { remoteName, tip, nameWithoutRemote } = branch
        if (remoteName === null) {
          // This is based on the branches ref. It should not be null for a
          // remote branch
          throw new Error(
            `Could not determine remote name from: ${branch.ref}.`
          )
        }

        const remote =
          gitStore.remotes.find(r => r.name === remoteName) ??
          (await getRemoteURL(repository, remoteName)
            .then(url => (url ? { name: remoteName, url } : undefined))
            .catch(e => log.debug(`Could not get remote URL`, e)))

        if (remote === undefined) {
          throw new Error(`Could not determine remote url from: ${branch.ref}.`)
        }

        await gitStore.performFailableOperation(() =>
          this.withTemporaryRepositoryMutationGuard(repository, () =>
            deleteRemoteBranch(repository, remote, nameWithoutRemote)
          )
        )

        // We log the remote branch's sha so that the user can recover it.
        log.info(
          `Deleted branch ${branch.upstreamWithoutRemote} (was ${tip.sha})`
        )

        return this._refreshRepository(repository)
      }

      // If a local branch, user may have the branch to delete checked out and
      // we need to switch to a different branch (default or recent).
      const branchToCheckout =
        toCheckout ?? this.getBranchToCheckoutAfterDelete(branch, repository)

      if (branchToCheckout !== null) {
        await gitStore.performFailableOperation(() =>
          this.withTemporaryRepositoryMutationGuard(repository, () =>
            checkoutBranch(repository, branchToCheckout, gitStore.currentRemote)
          )
        )
      }

      await gitStore.performFailableOperation(() => {
        return this.withTemporaryRepositoryMutationGuard(repository, () =>
          this.deleteLocalBranchAndUpstreamBranch(
            repository,
            branch,
            includeUpstream
          )
        )
      })

      return this._refreshRepository(repository)
    })
  }

  /** Delete only exact reviewed local branch tips, never current/default. */
  public async _deleteReviewedBranches(
    repository: Repository,
    reviewedBranches: ReadonlyArray<IReviewedBranchDeletion>
  ): Promise<ReadonlyArray<IReviewedBranchDeletionResult>> {
    const state = this.repositoryStateCache.get(repository).branchesState
    const protectedNames = new Set<string>()
    if (state.tip.kind === TipState.Valid) {
      protectedNames.add(state.tip.branch.name)
    }
    if (state.defaultBranch !== null) {
      protectedNames.add(state.defaultBranch.name)
    }
    if (reviewedBranches.some(branch => protectedNames.has(branch.name))) {
      throw new Error(
        'The current and default branches cannot be bulk deleted.'
      )
    }

    try {
      return await this.withTemporaryRepositoryMutationGuard(repository, () =>
        deleteReviewedLocalBranches(repository, reviewedBranches)
      )
    } finally {
      await this._refreshRepository(repository)
    }
  }

  /**
   * Deletes the local branch. If the parameter `includeUpstream` is true, the
   * upstream branch will be deleted also.
   */
  private async deleteLocalBranchAndUpstreamBranch(
    repository: Repository,
    branch: Branch,
    includeUpstream?: boolean
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      deleteLocalBranch(repository, branch.name)
    )

    if (
      includeUpstream === true &&
      branch.upstreamRemoteName !== null &&
      branch.upstreamWithoutRemote !== null
    ) {
      const gitStore = this.gitStoreCache.get(repository)
      const remoteName = branch.upstreamRemoteName
      const upstreamWithoutRemote = branch.upstreamWithoutRemote

      const remote =
        gitStore.remotes.find(r => r.name === remoteName) ??
        (await getRemoteURL(repository, remoteName)
          .then(url => (url ? { name: remoteName, url } : undefined))
          .catch(e => log.debug(`Could not get remote URL`, e)))

      if (!remote) {
        throw new Error(`Could not determine remote url from: ${branch.ref}.`)
      }

      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        deleteRemoteBranch(repository, remote, upstreamWithoutRemote)
      )
    }
    return
  }

  private getBranchToCheckoutAfterDelete(
    branchToDelete: Branch,
    repository: Repository
  ): Branch | null {
    const { branchesState } = this.repositoryStateCache.get(repository)
    const tip = branchesState.tip
    const currentBranch = tip.kind === TipState.Valid ? tip.branch : null
    // if current branch is not the branch being deleted, no need to switch
    // branches
    if (currentBranch !== null && branchToDelete.name !== currentBranch.name) {
      return null
    }

    // If the default branch is null, use the most recent branch excluding the branch
    // the branch to delete as the branch to checkout.
    const branchToCheckout =
      branchesState.defaultBranch ??
      branchesState.recentBranches.find(x => x.name !== branchToDelete.name)

    if (branchToCheckout === undefined) {
      throw new Error(
        `It's not possible to delete the only existing branch in a repository.`
      )
    }

    return branchToCheckout
  }

  private updatePushPullFetchProgress(
    repository: Repository,
    pushPullFetchProgress: Progress | null
  ) {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    this.repositoryStateCache.update(repository, () => ({
      pushPullFetchProgress,
    }))
    if (this.selectedRepository === repository) {
      this.emitUpdate()
    }
  }

  public async _push(
    repository: Repository,
    options?: PushOptions
  ): Promise<void> {
    return this.withRefreshedGitHubRepository(repository, repository => {
      return this.performPush(repository, options)
    })
  }

  private getBranchToPush(
    repository: Repository,
    options?: PushOptions
  ): Branch | undefined {
    if (options?.branch !== undefined) {
      return options?.branch
    }

    const state = this.repositoryStateCache.get(repository)

    const { tip } = state.branchesState

    if (tip.kind === TipState.Unborn) {
      throw new Error('The current branch is unborn.')
    }

    if (tip.kind === TipState.Detached) {
      throw new Error('The current repository is in a detached HEAD state.')
    }

    if (tip.kind === TipState.Valid) {
      return tip.branch
    }

    return
  }

  private async performPush(
    repository: Repository,
    options?: PushOptions
  ): Promise<void> {
    const state = this.repositoryStateCache.get(repository)
    const { remote } = state
    if (remote === null) {
      this._showPopup({
        type: PopupType.PublishRepository,
        repository,
      })

      return
    }

    return this.withPushPullFetch(repository, async () => {
      const branch = this.getBranchToPush(repository, options)

      if (branch === undefined) {
        return
      }

      const remoteName = branch.upstreamRemoteName || remote.name
      const pushedBranchName = branch.upstreamWithoutRemote ?? branch.name

      const pushTitle = `Pushing to ${remoteName}`

      // Emit an initial progress even before our push begins
      // since we're doing some work to get remotes up front.
      this.updatePushPullFetchProgress(repository, {
        kind: 'push',
        title: pushTitle,
        value: 0,
        remote: remoteName,
        branch: branch.name,
      })

      // Let's say that a push takes roughly twice as long as a fetch,
      // this is of course highly inaccurate.
      let pushWeight = 2.5
      let fetchWeight = 1

      // Let's leave 10% at the end for refreshing
      const refreshWeight = 0.1

      // Scale pull and fetch weights to be between 0 and 0.9.
      const scale = (1 / (pushWeight + fetchWeight)) * (1 - refreshWeight)

      pushWeight *= scale
      fetchWeight *= scale

      const retryAction: RetryAction = {
        type: RetryActionType.Push,
        repository,
      }

      // This is most likely not necessary and is only here out of
      // an abundance of caution. We're introducing support for
      // automatically configuring Git proxies based on system
      // proxy settings and therefore need to pass along the remote
      // url to functions such as push, pull, fetch etc.
      //
      // Prior to this we relied primarily on the `branch.remote`
      // property and used the `remote.name` as a fallback in case the
      // branch object didn't have a remote name (i.e. if it's not
      // published yet).
      //
      // The remote.name is derived from the current tip first and falls
      // back to using the defaultRemote if the current tip isn't valid
      // or if the current branch isn't published. There's however no
      // guarantee that they'll be refreshed at the exact same time so
      // there's a theoretical possibility that `branch.remote` and
      // `remote.name` could be out of sync. I have no reason to suspect
      // that's the case and if it is then we already have problems as
      // the `fetchRemotes` call after the push already relies on the
      // `remote` and not the `branch.remote`. All that said this is
      // a critical path in the app and somehow breaking pushing would
      // be near unforgivable so I'm introducing this `safeRemote`
      // temporarily to ensure that there's no risk of us using an
      // out of sync remote name while still providing envForRemoteOperation
      // with an url to use when resolving proxies.
      //
      // I'm also adding a non fatal exception if this ever happens
      // so that we can confidently remove this safeguard in a future
      // release.
      const safeRemote: IRemote = { name: remoteName, url: remote.url }

      if (safeRemote.name !== remote.name) {
        sendNonFatalException(
          'remoteNameMismatch',
          new Error('The current remote name differs from the branch remote')
        )
      }

      const gitStore = this.gitStoreCache.get(repository)
      const repositoryAccount = getAccountForRepository(
        this.accounts,
        repository
      )
      const accountKey =
        repositoryAccount === null
          ? undefined
          : getAccountKey(repositoryAccount)
      await gitStore.performFailableOperation(
        async () => {
          let aborted = false
          await this.withTemporaryRepositoryMutationGuard(repository, () =>
            pushRepo(
              repository,
              safeRemote,
              branch.name,
              branch.upstreamWithoutRemote,
              gitStore.tagsToPush,
              {
                onHookFailure: this.onHookFailure(() => (aborted = true)),
                accountKey,
                ...options,
              },
              progress => {
                this.updatePushPullFetchProgress(repository, {
                  ...progress,
                  title: pushTitle,
                  value: pushWeight * progress.value,
                })
              }
            )
          ).catch(err => (aborted ? undefined : Promise.reject(err)))

          if (aborted) {
            return
          }

          gitStore.clearTagsToPush()

          await this.withTemporaryRepositoryMutationGuard(repository, () =>
            gitStore.fetchRemotes([safeRemote], false, fetchProgress => {
              this.updatePushPullFetchProgress(repository, {
                ...fetchProgress,
                value: pushWeight + fetchProgress.value * fetchWeight,
              })
            })
          )

          const refreshTitle = __DARWIN__
            ? 'Refreshing Repository'
            : 'Refreshing repository'
          const refreshStartProgress = pushWeight + fetchWeight

          this.updatePushPullFetchProgress(repository, {
            kind: 'generic',
            title: refreshTitle,
            description: 'Fast-forwarding branches',
            value: refreshStartProgress,
          })

          await this.fastForwardBranches(repository)

          this.updatePushPullFetchProgress(repository, {
            kind: 'generic',
            title: refreshTitle,
            value: refreshStartProgress + refreshWeight * 0.5,
          })

          // manually refresh branch protections after the push, to ensure
          // any new branch will immediately report as protected
          await this.refreshBranchProtectionState(repository)

          await this._refreshRepository(repository)

          await this.deployDockerAfterPush(
            repository,
            remoteName,
            pushedBranchName
          )
        },
        { retryAction }
      )

      this.updatePushPullFetchProgress(repository, null)

      this.updateMenuLabelsForSelectedRepository()

      // Note that we're using `getAccountForRepository` here instead
      // of the `account` instance we've got and that's because recordPush
      // needs to be able to differentiate between a GHES account and a
      // generic account and it can't do that only based on the endpoint.
      this.statsStore.recordPush(
        getAccountForRepository(this.accounts, repository),
        options
      )
    })
  }

  /**
   * Run only explicitly enabled Docker deployments whose saved SSH checkout
   * follows the remote that was just pushed. A deployment failure is reported
   * independently and never rewrites a successful Git push as a push failure.
   */
  private async deployDockerAfterPush(
    repository: Repository,
    remoteName: string,
    branchName: string
  ): Promise<void> {
    const deployments = loadSSHDockerDeploymentsForPush(
      repository.path,
      remoteName
    )
    let pushedRemoteUrl: string | null = null
    let remoteUrlError: Error | null = null

    if (deployments.length > 0) {
      try {
        pushedRemoteUrl = await getRemotePushURL(repository, remoteName)
        if (pushedRemoteUrl === null) {
          remoteUrlError = new Error(
            'The pushed remote URL could not be resolved for deployment.'
          )
        }
      } catch {
        remoteUrlError = new Error(
          'The pushed remote URL could not be resolved for deployment.'
        )
      }
    }

    for (const deployment of deployments) {
      this.updatePushPullFetchProgress(repository, {
        kind: 'generic',
        title: `Deploying Docker to ${deployment.label}`,
        description: `Fast-forwarding ${branchName} over SSH`,
        value: 1,
      })

      try {
        if (remoteUrlError !== null || pushedRemoteUrl === null) {
          throw (
            remoteUrlError ??
            new Error(
              'The pushed remote URL could not be resolved for deployment.'
            )
          )
        }
        await runSSHWorkingCopyAction(
          repository.path,
          deployment,
          'deploy',
          pushedRemoteUrl,
          undefined,
          branchName
        )
        this.postNotification({
          kind: 'info',
          title: 'Docker deployment complete',
          body: `${repository.name} deployed to ${deployment.label} after pushing ${branchName}.`,
          repositoryId: repository.id,
          action: { kind: 'open-repository', repositoryId: repository.id },
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'SSH deployment failed.'
        log.error(
          `Docker deployment to ${deployment.label} failed after push`,
          new Error(message)
        )
        this.postNotification({
          kind: 'app-error',
          title: 'Docker deployment failed',
          body: `${deployment.label}: ${message.slice(0, 600)}`,
          repositoryId: repository.id,
          action: { kind: 'open-repository', repositoryId: repository.id },
        })
      }
    }
  }

  private async withIsCommitting(
    repository: Repository,
    fn: () => Promise<boolean>
  ): Promise<boolean> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      throw new Error(
        'The temporary submodule workspace is no longer selected.'
      )
    }
    const state = this.repositoryStateCache.get(repository)
    // ensure the user doesn't try and commit again
    if (state.isCommitting) {
      return false
    }

    this.repositoryStateCache.update(repository, () => ({
      isCommitting: true,
      commitOperationPhase: { kind: 'preparing' },
      hookProgress: null,
      subscribeToCommitOutput: null,
    }))
    this.emitUpdate()

    try {
      return await fn()
    } finally {
      if (this.isTemporaryRepositoryActive(repository)) {
        this.repositoryStateCache.update(repository, () => ({
          isCommitting: false,
          commitOperationPhase: null,
          hookProgress: null,
          subscribeToCommitOutput: null,
        }))
        this.emitUpdate()
      }
    }
  }

  private async withIsGeneratingCommitMessage(
    repository: Repository,
    fn: (signal: AbortSignal) => Promise<boolean>
  ): Promise<boolean> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      throw new Error(
        'The temporary submodule workspace is no longer selected.'
      )
    }
    const state = this.repositoryStateCache.get(repository)
    // ensure the user doesn't try and commit again
    if (state.isGeneratingCommitMessage) {
      return false
    }

    const abortController = new AbortController()

    this.repositoryStateCache.update(repository, () => ({
      isGeneratingCommitMessage: true,
      commitMessageGenerationAbortController: abortController,
    }))
    this.emitUpdate()

    try {
      return await fn(abortController.signal)
    } finally {
      if (this.isTemporaryRepositoryActive(repository)) {
        const currentState = this.repositoryStateCache.get(repository)
        if (
          currentState.commitMessageGenerationAbortController ===
          abortController
        ) {
          this.repositoryStateCache.update(repository, () => ({
            isGeneratingCommitMessage: false,
            commitMessageGenerationAbortController: null,
          }))
          this.emitUpdate()
        }
      }
    }
  }

  private async withPushPullFetch(
    repository: Repository,
    fn: () => Promise<void>
  ): Promise<void> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      throw new Error(
        'The temporary submodule workspace is no longer selected.'
      )
    }
    const state = this.repositoryStateCache.get(repository)
    // Don't allow concurrent network operations.
    if (state.isPushPullFetchInProgress) {
      return
    }

    this.repositoryStateCache.update(repository, () => ({
      isPushPullFetchInProgress: true,
    }))
    this.emitUpdate()

    try {
      await this.withTemporaryRepositoryMutationGuard(repository, fn)
    } finally {
      if (this.isTemporaryRepositoryActive(repository)) {
        this.repositoryStateCache.update(repository, () => ({
          isPushPullFetchInProgress: false,
        }))
        this.emitUpdate()
      }
    }
  }

  public async _fetchRepositoryShallowHistory(
    repository: Repository,
    request: IRepositoryShallowHistoryFetchRequest,
    signal?: AbortSignal
  ): Promise<{ readonly usedFallbackAccount: boolean }> {
    if (signal?.aborted) {
      throw new Error('History fetch cancelled.')
    }
    if (this.repositoryStateCache.get(repository).isPushPullFetchInProgress) {
      throw new Error('Another network operation is already in progress.')
    }

    let result: { readonly usedFallbackAccount: boolean } | undefined
    await this.withPushPullFetch(repository, async () => {
      const remotes = await getRemotes(repository)
      const remote = remotes.find(
        candidate => candidate.name === request.remote
      )
      if (remote === undefined) {
        throw new Error('The selected fetch remote changed after review.')
      }

      result = await fetchShallowHistoryWithAccountFallback(
        remote.url,
        this.accounts,
        repository.accountKey,
        accountKey =>
          this.withTemporaryRepositoryMutationGuard(repository, () =>
            fetchRepositoryShallowHistory(repository, remote, request, {
              accountKey,
              signal,
            })
          )
      )
    })

    if (result === undefined) {
      throw new Error('Another network operation is already in progress.')
    }
    return result
  }

  public async _pull(repository: Repository): Promise<void> {
    return this.withRefreshedGitHubRepository(repository, repository => {
      return this.performPull(repository)
    })
  }

  /** Pull every available repository with bounded network concurrency. */
  public async _pullAllRepositories(
    onProgress?: PullAllProgressListener
  ): Promise<ReadonlyArray<IPullAllResult>> {
    const repositories = await this.repositoriesStore.getAll()
    const repositoriesById = new Map(repositories.map(repo => [repo.id, repo]))

    return runBoundedPullAll(
      repositories.map(repository => ({
        id: repository.id,
        name: repository.name,
      })),
      async (candidate, reportProgress) => {
        const repository = repositoriesById.get(candidate.id)
        if (repository === undefined) {
          return { status: 'skipped', detail: 'Repository was removed.' }
        }
        return this.performPullAllRepository(repository, reportProgress)
      },
      3,
      onProgress
    )
  }

  /** Return the current persisted repositories for a reviewed batch sync. */
  public async _getRepositorySyncCandidates(): Promise<
    ReadonlyArray<IPullAllCandidate>
  > {
    const repositories = await this.repositoriesStore.getAll()
    return repositories.map(repository => ({
      id: repository.id,
      name: repository.name,
    }))
  }

  /** Pull or fetch only the exact repository IDs reviewed in the dialog. */
  public async _syncRepositories(
    request: IRepositorySyncRequest,
    onProgress?: PullAllProgressListener
  ): Promise<ReadonlyArray<IPullAllResult>> {
    if (request.operation !== 'pull' && request.operation !== 'fetch') {
      throw new Error('Choose pull or fetch for the repository batch.')
    }

    const repositoryIds = [...new Set(request.repositoryIds)]
    if (
      repositoryIds.length === 0 ||
      repositoryIds.length > 500 ||
      repositoryIds.some(id => !Number.isSafeInteger(id) || id < 0)
    ) {
      throw new Error('Review between 1 and 500 repositories for this batch.')
    }

    const repositories = await this.repositoriesStore.getAll()
    const selected = new Set(repositoryIds)
    const candidates = repositories.filter(repository =>
      selected.has(repository.id)
    )
    if (candidates.length !== repositoryIds.length) {
      throw new Error(
        'The reviewed repository list changed. Refresh it before starting.'
      )
    }
    const repositoriesById = new Map(
      candidates.map(repository => [repository.id, repository])
    )

    return runBoundedPullAll(
      candidates.map(repository => ({
        id: repository.id,
        name: repository.name,
      })),
      async (candidate, reportProgress) => {
        const repository = repositoriesById.get(candidate.id)
        if (repository === undefined) {
          return { status: 'skipped', detail: 'Repository was removed.' }
        }
        return request.operation === 'pull'
          ? this.performPullAllRepository(repository, reportProgress)
          : this.performFetchAllRepository(repository, reportProgress)
      },
      3,
      onProgress,
      request.operation === 'pull' ? 'pulling' : 'fetching'
    )
  }

  private async performFetchAllRepository(
    repository: Repository,
    reportProgress: (detail: string) => void
  ) {
    if (repository.missing) {
      return { status: 'skipped' as const, detail: 'Repository is missing.' }
    }

    reportProgress('Refreshing repository state.')
    await this._refreshRepository(repository)
    const state = this.repositoryStateCache.get(repository)
    if (state.isPushPullFetchInProgress) {
      return {
        status: 'skipped' as const,
        detail: 'Another network operation is in progress.',
      }
    }
    if ((await getRemotes(repository)).length === 0) {
      return { status: 'skipped' as const, detail: 'No fetch remote.' }
    }

    reportProgress('Fetching relevant remotes without changing the worktree.')
    await this.performFetch(repository, FetchType.UserInitiatedTask)
    return { status: 'fetched' as const, detail: 'Fetch completed.' }
  }

  private async performPullAllRepository(
    repository: Repository,
    reportProgress: (detail: string) => void
  ) {
    if (repository.missing) {
      return { status: 'skipped' as const, detail: 'Repository is missing.' }
    }

    reportProgress('Refreshing repository state.')
    await this._refreshRepository(repository)
    reportProgress('Checking the pull remote and active branch.')
    const gitStore = this.gitStoreCache.get(repository)
    const remote = gitStore.currentRemote
    if (remote === null) {
      return { status: 'skipped' as const, detail: 'No pull remote.' }
    }

    const tip = gitStore.tip
    if (tip.kind !== TipState.Valid) {
      return {
        status: 'skipped' as const,
        detail:
          tip.kind === TipState.Detached
            ? 'Detached HEAD.'
            : 'No active branch.',
      }
    }
    if (tip.branch.upstream === null) {
      return {
        status: 'skipped' as const,
        detail: `Branch ${tip.branch.name} has no upstream.`,
      }
    }

    const state = this.repositoryStateCache.get(repository)
    if (state.isPushPullFetchInProgress) {
      return {
        status: 'skipped' as const,
        detail: 'Another network operation is in progress.',
      }
    }

    let usedFallbackAccount = false
    reportProgress(
      `Pulling ${tip.branch.name} from ${remote.name} and checking for updates.`
    )
    await this.withPushPullFetch(repository, async () => {
      const result = await pullWithAccountFallback(
        remote.url,
        this.accounts,
        repository.accountKey,
        accountKey => pullRepo(repository, remote, { accountKey })
      )
      usedFallbackAccount = result.usedFallbackAccount
      reportProgress(`Updating ${remote.name} remote HEAD metadata.`)
      await updateRemoteHEAD(repository, remote, false).catch(error =>
        log.error('Failed updating remote HEAD after Pull all', error)
      )
      reportProgress('Refreshing the final repository state.')
      await this._refreshRepository(repository)
    })

    return {
      status: 'pulled' as const,
      detail: usedFallbackAccount
        ? PullAllFallbackSuccessDetail
        : 'Pull completed.',
    }
  }

  /**
   * Commit and push every repository that has local work, pulling first. Clean
   * repositories are skipped, and each repository's failure is isolated so a
   * single conflict or network error never aborts the whole batch. The user's
   * commit identity, signing, and hooks are used — never the automation
   * bot-author path — and pushes are never forced.
   */
  public async _commitAndPushAllRepositories(
    message: string,
    onProgress?: CommitPushAllProgressListener
  ): Promise<ReadonlyArray<ICommitPushAllResult>> {
    const summary = message.trim()
    if (summary.length === 0) {
      throw new Error(
        'A commit message is required to commit and push all repositories.'
      )
    }

    const repositories = await this.repositoriesStore.getAll()
    const repositoriesById = new Map(repositories.map(repo => [repo.id, repo]))

    return runBoundedCommitPushAll(
      repositories.map(repository => ({
        id: repository.id,
        name: repository.name,
      })),
      async (candidate, reportProgress) => {
        const repository = repositoriesById.get(candidate.id)
        if (repository === undefined) {
          return { status: 'skipped', detail: 'Repository was removed.' }
        }
        if (repository.missing) {
          return { status: 'skipped', detail: 'Repository is missing.' }
        }
        return commitPushAllRepository(
          this.buildCommitPushAllActions(repository, summary),
          reportProgress
        )
      },
      3,
      onProgress
    )
  }

  private buildCommitPushAllActions(
    repository: Repository,
    summary: string
  ): ICommitPushAllRepositoryActions {
    return {
      isClean: () => {
        const state = this.localRepositoryStateLookup.get(repository.id)
        return isCommitPushAllRepositoryClean(
          state === undefined
            ? undefined
            : {
                changedFilesCount: state.changedFilesCount,
                ahead: state.aheadBehind?.ahead ?? 0,
                behind: state.aheadBehind?.behind ?? 0,
              }
        )
      },
      // Reuse the conflict-safe Pull all pull, which throws (isolated as a
      // failure) on a merge conflict so a conflicted tree is never committed.
      pull: async report => {
        await this.performPullAllRepository(repository, report)
      },
      commitAll: report =>
        this.commitAllChangesForCommitPushAll(repository, summary, report),
      push: report => this.pushForCommitPushAll(repository, report),
    }
  }

  private async commitAllChangesForCommitPushAll(
    repository: Repository,
    summary: string,
    report: (detail: string) => void
  ): Promise<boolean> {
    report('Reading the working directory.')
    await this._refreshRepository(repository)

    const state = this.repositoryStateCache.get(repository)
    if (hasConflictedFiles(state.changesState.workingDirectory)) {
      throw new Error(
        'Repository has merge conflicts. Resolve them before committing.'
      )
    }

    const files = state.changesState.workingDirectory.files
    if (files.length === 0) {
      return false
    }

    await this._changeIncludeAllFiles(repository, true)
    const context: ICommitContext = { summary, description: null }

    report(`Committing ${files.length} change${files.length === 1 ? '' : 's'}.`)
    // Reuse the guarded commit path so commit-and-push-all cannot bypass
    // automatic cheap-LFS pinning for files over the GitHub receive limit.
    const committed = await this._commitIncludedChanges(repository, context)

    if (!committed) {
      throw new Error('The commit did not complete.')
    }

    await this._refreshRepository(repository)
    return true
  }

  private async pushForCommitPushAll(
    repository: Repository,
    report: (detail: string) => void
  ): Promise<void> {
    report('Pushing to the upstream remote.')
    // Reuse the scheduler push: raw pushRepo (no force, user identity/hooks)
    // that throws on failure so a push error is isolated per repository instead
    // of raising a global error dialog or publishing an unpublished repo.
    await this.performScheduledPush(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  private async performPull(repository: Repository): Promise<void> {
    return this.withPushPullFetch(repository, async () => {
      const gitStore = this.gitStoreCache.get(repository)
      const remote = gitStore.currentRemote

      if (!remote) {
        throw new Error('The repository has no remotes.')
      }

      const state = this.repositoryStateCache.get(repository)
      const tip = state.branchesState.tip

      if (tip.kind === TipState.Unborn) {
        throw new Error('The current branch is unborn.')
      }

      if (tip.kind === TipState.Detached) {
        throw new Error('The current repository is in a detached HEAD state.')
      }

      if (tip.kind === TipState.Valid) {
        let mergeBase: string | null = null
        let gitContext: GitErrorContext | undefined = undefined

        if (tip.branch.upstream !== null) {
          mergeBase = await getMergeBase(
            repository,
            tip.branch.name,
            tip.branch.upstream
          )

          gitContext = {
            kind: 'pull',
            theirBranch: tip.branch.upstream,
            currentBranch: tip.branch.name,
          }
        }

        const title = `Pulling ${remote.name}`
        const kind = 'pull'
        this.updatePushPullFetchProgress(repository, {
          kind,
          title,
          value: 0,
          remote: remote.name,
        })

        try {
          // Let's say that a pull takes twice as long as a fetch,
          // this is of course highly inaccurate.
          let pullWeight = 2
          let fetchWeight = 1

          // Let's leave 10% at the end for refreshing
          const refreshWeight = 0.1

          // Scale pull and fetch weights to be between 0 and 0.9.
          const scale = (1 / (pullWeight + fetchWeight)) * (1 - refreshWeight)

          pullWeight *= scale
          fetchWeight *= scale

          const retryAction: RetryAction = {
            type: RetryActionType.Pull,
            repository,
          }

          if (gitStore.pullWithRebase) {
            this.statsStore.increment('pullWithRebaseCount')
          } else {
            this.statsStore.increment('pullWithDefaultSettingCount')
          }

          let aborted = false
          const pullSucceeded = await gitStore
            .performFailableOperation(
              async () => {
                await this.withTemporaryRepositoryMutationGuard(
                  repository,
                  () =>
                    pullRepo(repository, remote, {
                      progressCallback: progress => {
                        this.updatePushPullFetchProgress(repository, {
                          ...progress,
                          value: progress.value * pullWeight,
                        })
                      },
                      onHookFailure: (hookName, terminalOutput) =>
                        new Promise(resolve => {
                          this._showPopup({
                            type: PopupType.HookFailed,
                            hookName,
                            terminalOutput,
                            resolve: resolution => {
                              if (resolution === 'abort') {
                                aborted = true
                              }
                              resolve(resolution)
                            },
                          })
                        }),
                    })
                )
                return true
              },
              { gitContext, retryAction }
            )
            .catch(err => (aborted ? false : Promise.reject(err)))

          // If the pull failed we shouldn't try to update the remote HEAD
          // because there's a decent chance that it failed either because we
          // didn't have the correct credentials (which we won't this time
          // either) or because there's a network error which likely will
          // persist for the next operation as well.
          if (pullSucceeded) {
            // Updating the local HEAD symref isn't critical so we don't want
            // to show an error message to the user and have them retry the
            // entire pull operation if it fails.
            try {
              await this.withTemporaryRepositoryMutationGuard(repository, () =>
                updateRemoteHEAD(repository, remote, false)
              )
            } catch (e) {
              if (!this.isTemporaryRepositoryActive(repository)) {
                throw e
              }
              log.error('Failed updating remote HEAD', e)
            }
          }

          const refreshStartProgress = pullWeight + fetchWeight
          const refreshTitle = __DARWIN__
            ? 'Refreshing Repository'
            : 'Refreshing repository'

          this.updatePushPullFetchProgress(repository, {
            kind: 'generic',
            title: refreshTitle,
            description: 'Fast-forwarding branches',
            value: refreshStartProgress,
          })

          await this.fastForwardBranches(repository)

          this.updatePushPullFetchProgress(repository, {
            kind: 'generic',
            title: refreshTitle,
            value: refreshStartProgress + refreshWeight * 0.5,
          })

          if (mergeBase) {
            await gitStore.reconcileHistory(mergeBase)
          }

          // manually refresh branch protections after the push, to ensure
          // any new branch will immediately report as protected
          await this.refreshBranchProtectionState(repository)

          await this._refreshRepository(repository)

          // Detect point: a pull that brought new commits may have added
          // cheap-LFS pointers to the working tree; the detector scans cheaply
          // and no-ops when there are none.
          void this.maybeAutoMaterializeCheapLfs(repository)
        } finally {
          this.updatePushPullFetchProgress(repository, null)
        }
      }
    })
  }

  private async fastForwardBranches(repository: Repository) {
    try {
      const eligibleBranches = await getBranchesDifferingFromUpstream(
        repository
      )

      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        fastForwardBranches(repository, eligibleBranches)
      )
    } catch (e) {
      if (!this.isTemporaryRepositoryActive(repository)) {
        throw e
      }
      log.error('Branch fast-forwarding failed', e)
    }
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _publishRepository(
    repository: Repository,
    name: string,
    description: string,
    private_: boolean,
    account: Account,
    org: IAPIOrganization | null
  ): Promise<Repository> {
    if (isSubmoduleRepository(repository)) {
      throw new Error(
        'Publishing is unavailable while a submodule is open temporarily. Return to the parent repository first.'
      )
    }

    const api = API.fromAccount(account)
    const apiRepository = await api.createRepository(
      org,
      name,
      description,
      private_
    )

    const gitStore = this.gitStoreCache.get(repository)
    await gitStore.performFailableOperation(() =>
      this.withTemporaryRepositoryMutationGuard(repository, () =>
        addRemote(repository, 'origin', apiRepository.clone_url)
      )
    )
    await gitStore.loadRemotes()

    // skip pushing if the current branch is a detached HEAD or the repository
    // is unborn
    if (gitStore.tip.kind === TipState.Valid) {
      if (
        gitStore.defaultBranch !== null &&
        gitStore.tip.branch.name !== gitStore.defaultBranch.name
      ) {
        await this.performPush(repository, {
          branch: gitStore.defaultBranch,
          forceWithLease: false,
        })
      }
      await this.performPush(repository)
    }

    await gitStore.refreshDefaultBranch()

    return this.repositoryWithRefreshedGitHubRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _clone(
    url: string,
    path: string,
    options: CloneOptions = {}
  ): {
    promise: Promise<boolean>
    repository: CloningRepository
  } {
    const promise = this.cloningRepositoriesStore.clone(url, path, options)
    const repository = this.cloningRepositoriesStore.repositories.find(
      r => r.url === url && r.path === path
    )!

    promise.then(success => {
      if (success) {
        this.statsStore.recordCloneRepository()
      }
    })

    return { promise, repository }
  }

  public _removeCloningRepository(repository: CloningRepository) {
    this.cloningRepositoriesStore.remove(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _cloneBatch(
    items: ReadonlyArray<IBatchCloneItem>,
    mode: BatchCloneMode,
    source: BatchCloneSource = 'manual'
  ): Promise<void> {
    await this.batchCloneStore.startBatch(items, mode, source)
    await this.finalizeBatchClone()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _retryBatchCloneFailed(): Promise<void> {
    await this.batchCloneStore.retryFailed()
    await this.finalizeBatchClone()
  }

  /** Retry adding completed clone paths which were temporarily unavailable. */
  public async _retryBatchCloneRegistration(): Promise<void> {
    await this.finalizeBatchClone()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _dismissBatchClone(): Promise<boolean> {
    return this.batchCloneStore.dismiss()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _cancelBatchClone(): Promise<void> {
    return this.batchCloneStore.requestCancel()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _pauseBatchClone(): Promise<void> {
    return this.batchCloneStore.requestPause()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _resumeBatchClone(): Promise<void> {
    await this.batchCloneStore.resume()
    await this.finalizeBatchClone()
  }

  /** Skip a single unresolved batch item so the queue can finish. */
  public async _skipBatchCloneItem(path: string): Promise<void> {
    await this.batchCloneStore.skipItem(path)
    await this.finalizeBatchClone()
  }

  /** Adopt the existing folder at a review item when it already matches. */
  public async _adoptBatchCloneItem(path: string): Promise<void> {
    await this.batchCloneStore.adoptExistingItem(path)
    await this.finalizeBatchClone()
  }

  /** Configure account-scoped automatic clone without tying it to a dialog. */
  public _configureAutoClone(
    account: Account,
    baseDirectory: string,
    mode: BatchCloneMode,
    enabled: boolean
  ): void {
    this.autoCloneStore.configure(account, baseDirectory, mode, enabled)
  }

  /**
   * Add every successfully-cloned repository from the current batch to the
   * repository list and post a summary notification.
   */
  private async finalizeBatchClone(): Promise<void> {
    const state = this.batchCloneState
    if (state === null || !state.isDone) {
      return
    }

    const clonedItems = state.items.filter(
      item => state.statuses.get(item.path)?.kind === 'done'
    )
    const clonedPaths = clonedItems.map(item => item.path)
    const unfinalizedItems = clonedItems.filter(
      item => state.statuses.get(item.path)?.finalized !== true
    )
    const unfinalizedPaths = unfinalizedItems.map(item => item.path)
    let registrationComplete = true

    const accountKeysByPath = new Map<string, string>()
    for (const item of unfinalizedItems) {
      const accountKey = state.statuses.get(item.path)?.accountKey
      if (accountKey !== undefined) {
        accountKeysByPath.set(item.path, accountKey)
      }
    }

    if (unfinalizedPaths.length > 0) {
      const addedRepositories = await this._addRepositories(
        unfinalizedPaths,
        accountKeysByPath
      )
      const finalizedPaths = selectRegisteredBatchClonePaths(
        unfinalizedPaths,
        addedRepositories
      )
      await this.batchCloneStore.markFinalized(finalizedPaths)
      registrationComplete = finalizedPaths.length === unfinalizedPaths.length
      // Mark registration durably before recording analytics. A crash between
      // these steps may omit one statistic, but can never count one clone batch
      // twice after recovery.
      if (registrationComplete) {
        this.statsStore.recordCloneRepository()
      }

      // Detect point: each freshly-registered clone may carry committed
      // cheap-LFS pointers to auto-materialize. Fire-and-forget per repository.
      for (const registered of addedRepositories) {
        void this.maybeAutoMaterializeCheapLfs(registered)
      }
    }

    // A completed clone can be temporarily unavailable (for example, on a
    // disconnected external drive). Keep its journal and completion summary
    // pending until the repository list actually accepts every successful
    // path, so the visible retry action can recover it later.
    if (!registrationComplete) {
      return
    }

    if (!this.batchCloneStore.completionNotificationPending) {
      return
    }
    await this.batchCloneStore.markCompletionNotified()

    const failed = state.items.filter(
      item => state.statuses.get(item.path)?.kind === 'failed'
    ).length
    const review = state.items.filter(
      item => state.statuses.get(item.path)?.kind === 'review'
    ).length

    const body =
      failed > 0 || review > 0
        ? `Cloned ${clonedPaths.length} of ${state.items.length} repositories (${failed} failed, ${review} require review).`
        : `Cloned ${clonedPaths.length} ${
            clonedPaths.length === 1 ? 'repository' : 'repositories'
          }.`

    this.postNotification({
      kind: 'clone-batch',
      title:
        state.source === 'auto'
          ? 'Automatic clone finished'
          : 'Batch clone finished',
      body,
    })
  }

  private startBackgroundAutoCloneBatch = (
    inputs: ReadonlyArray<IBatchCloneInput>,
    baseDirectory: string,
    mode: BatchCloneMode
  ): boolean => {
    if (this.batchCloneStore.requiresAttention || inputs.length === 0) {
      return false
    }
    let items: ReadonlyArray<IBatchCloneItem>
    try {
      items = buildBatchCloneItems(inputs, baseDirectory)
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)))
      return false
    }
    void this._cloneBatch(items, mode, 'auto').catch(error =>
      this.emitError(error instanceof Error ? error : new Error(String(error)))
    )
    return true
  }

  private isAutoCloneRepositoryTracked = (cloneURL: string): boolean => {
    if (
      this.cloningRepositoriesStore.repositories.some(repository =>
        urlsMatch(repository.url, cloneURL)
      )
    ) {
      return true
    }
    return this.repositories.some(repository => {
      if (!isRepositoryWithGitHubRepository(repository)) {
        return false
      }
      return (
        urlMatchesCloneURL(cloneURL, repository.gitHubRepository) ||
        urlsMatch(repository.gitHubRepository.htmlURL ?? '', cloneURL)
      )
    })
  }

  public async _discardChanges(
    repository: Repository,
    files: ReadonlyArray<WorkingDirectoryFileChange>,
    moveToTrash: boolean = true,
    cleanUntracked: boolean = false
  ) {
    const gitStore = this.gitStoreCache.get(repository)

    const { askForConfirmationOnDiscardChangesPermanently } = this.getState()

    try {
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        gitStore.discardChanges(
          files,
          moveToTrash,
          askForConfirmationOnDiscardChangesPermanently,
          cleanUntracked
        )
      )
    } catch (error) {
      if (!(error instanceof DiscardChangesError)) {
        log.error('Failed discarding changes', error)
      }

      this.emitError(error)
      return
    }

    return this._refreshRepository(repository)
  }

  /** Stash only the chosen working-directory files as a new branch entry. */
  public async _stashChanges(
    repository: Repository,
    files: ReadonlyArray<WorkingDirectoryFileChange>
  ): Promise<void> {
    try {
      const { branchesState } = this.repositoryStateCache.get(repository)
      if (branchesState.tip.kind !== TipState.Valid || files.length === 0) {
        return
      }
      await this.createSelectedFilesStash(
        repository,
        branchesState.tip.branch,
        files
      )
    } catch (error) {
      const wrapped =
        error instanceof StashChangesError
          ? error
          : new StashChangesError(
              error instanceof Error ? error : new Error(String(error)),
              repository,
              files
            )
      log.error('Failed stashing selected changes', wrapped)
      this.emitError(wrapped)
      return
    }

    await this._refreshRepository(repository)
  }

  public async _discardChangesFromSelection(
    repository: Repository,
    filePath: string,
    diff: ITextDiff,
    selection: DiffSelection
  ) {
    const gitStore = this.gitStoreCache.get(repository)
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      gitStore.discardChangesFromSelection(filePath, diff, selection)
    )

    return this._refreshRepository(repository)
  }

  public async _startAmendingRepository(
    repository: Repository,
    commit: Commit,
    isLocalCommit: boolean,
    continueWithForcePush: boolean = false
  ) {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const repositoryState = this.repositoryStateCache.get(repository)
    const { tip } = repositoryState.branchesState
    const { askForConfirmationOnForcePush } = this.getState()

    if (
      askForConfirmationOnForcePush &&
      !continueWithForcePush &&
      !isLocalCommit &&
      tip.kind === TipState.Valid
    ) {
      return this._showPopup({
        type: PopupType.WarnForcePush,
        operation: 'Amend',
        onBegin: () => {
          this._startAmendingRepository(repository, commit, isLocalCommit, true)
        },
      })
    }

    await this._changeRepositorySection(
      repository,
      RepositorySectionTab.Changes
    )

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const gitStore = this.gitStoreCache.get(repository)
    await gitStore.prepareToAmendCommit(commit)

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    this.setRepositoryCommitToAmend(repository, commit)

    this.statsStore.increment('amendCommitStartedCount')
  }

  public async _stopAmendingRepository(repository: Repository) {
    this.setRepositoryCommitToAmend(repository, null)
  }

  private setRepositoryCommitToAmend(
    repository: Repository,
    commit: Commit | null
  ) {
    this.repositoryStateCache.update(repository, () => {
      return {
        commitToAmend: commit,
      }
    })

    this.emitUpdate()
  }

  public async _undoCommit(
    repository: Repository,
    commit: Commit,
    showConfirmationDialog: boolean
  ): Promise<void> {
    const gitStore = this.gitStoreCache.get(repository)
    const repositoryState = this.repositoryStateCache.get(repository)
    const { changesState, localCommitSHAs } = repositoryState
    const isWorkingDirectoryClean =
      changesState.workingDirectory.files.length === 0

    if (showConfirmationDialog && !localCommitSHAs.includes(commit.sha)) {
      return this._showPopup({
        type: PopupType.WarnUndoPushedCommit,
        repository,
        commit,
      })
    }

    // Warn the user if there are changes in the working directory
    // This warning can be disabled, except when the user tries to undo
    // a merge commit.
    if (
      showConfirmationDialog &&
      ((this.confirmUndoCommit && !isWorkingDirectoryClean) ||
        commit.isMergeCommit)
    ) {
      return this._showPopup({
        type: PopupType.WarnLocalChangesBeforeUndo,
        repository,
        commit,
        isWorkingDirectoryClean,
      })
    }

    // Make sure we show the changes after undoing the commit
    await this._changeRepositorySection(
      repository,
      RepositorySectionTab.Changes,
      true
    )

    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      gitStore.undoCommit(commit)
    )

    this.statsStore.recordCommitUndone(isWorkingDirectoryClean)

    return this._refreshRepository(repository)
  }

  public async _resetToCommit(
    repository: Repository,
    commit: Commit,
    showConfirmationDialog: boolean
  ): Promise<void> {
    const gitStore = this.gitStoreCache.get(repository)
    const repositoryState = this.repositoryStateCache.get(repository)
    const { changesState, localCommitSHAs } = repositoryState
    const isWorkingDirectoryClean =
      changesState.workingDirectory.files.length === 0

    if (showConfirmationDialog && !localCommitSHAs.includes(commit.sha)) {
      return this._showPopup({
        type: PopupType.WarnResetToPushedCommit,
        repository,
        commit,
      })
    }

    // Warn the user if there are changes in the working directory
    if (showConfirmationDialog && !isWorkingDirectoryClean) {
      return this._showPopup({
        type: PopupType.WarningBeforeReset,
        repository,
        commit,
      })
    }

    // Make sure we show the changes after resetting to the commit
    await this._changeRepositorySection(
      repository,
      RepositorySectionTab.Changes
    )

    await gitStore.performFailableOperation(() =>
      this.withTemporaryRepositoryMutationGuard(repository, () =>
        reset(repository, GitResetMode.Mixed, commit.sha)
      )
    )

    // this.statsStore.recordCommitUndone(isWorkingDirectoryClean)

    return this._refreshRepository(repository)
  }

  /**
   * Fetch a specific refspec for the repository.
   *
   * As this action is required to complete when viewing a Pull Request from
   * a fork, it does not opt-in to checks that prevent multiple concurrent
   * network actions. This might require some rework in the future to chain
   * these actions.
   *
   */
  public async _fetchRefspec(
    repository: Repository,
    refspec: string
  ): Promise<void> {
    return this.withRefreshedGitHubRepository(repository, async repository => {
      const gitStore = this.gitStoreCache.get(repository)
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        gitStore.fetchRefspec(refspec)
      )

      return this._refreshRepository(repository)
    })
  }

  /**
   * Fetch all relevant remotes in the the repository.
   *
   * See gitStore.fetch for more details.
   *
   * Note that this method will not perform the fetch of the specified remote
   * if _any_ fetches or pulls are currently in-progress.
   */
  public _fetch(repository: Repository, fetchType: FetchType): Promise<void> {
    return this.withRefreshedGitHubRepository(repository, repository => {
      return this.performFetch(repository, fetchType)
    })
  }

  /**
   * Fetch a particular remote in a repository.
   *
   * Note that this method will not perform the fetch of the specified remote
   * if _any_ fetches or pulls are currently in-progress.
   */
  private _fetchRemote(
    repository: Repository,
    remote: IRemote,
    fetchType: FetchType
  ): Promise<void> {
    return this.withRefreshedGitHubRepository(repository, repository => {
      return this.performFetch(repository, fetchType, [remote])
    })
  }

  /**
   * Fetch all relevant remotes or one or more given remotes in the repository.
   *
   * @param remotes Optional, one or more remotes to fetch if undefined all
   *                relevant remotes will be fetched. See gitStore.fetch for
   *                more detail on what constitutes a relevant remote.
   */
  private async performFetch(
    repository: Repository,
    fetchType: FetchType,
    remotes?: IRemote[]
  ): Promise<void> {
    await this.withPushPullFetch(repository, async () => {
      const gitStore = this.gitStoreCache.get(repository)

      try {
        const fetchWeight = 0.9
        const refreshWeight = 0.1
        const isBackgroundTask = fetchType === FetchType.BackgroundTask

        const progressCallback = (progress: IFetchProgress) => {
          this.updatePushPullFetchProgress(repository, {
            ...progress,
            value: progress.value * fetchWeight,
          })
        }

        if (remotes === undefined) {
          await this.withTemporaryRepositoryMutationGuard(repository, () =>
            gitStore.fetch(isBackgroundTask, progressCallback)
          )
        } else {
          await this.withTemporaryRepositoryMutationGuard(repository, () =>
            gitStore.fetchRemotes(remotes, isBackgroundTask, progressCallback)
          )
        }

        const refreshTitle = __DARWIN__
          ? 'Refreshing Repository'
          : 'Refreshing repository'

        this.updatePushPullFetchProgress(repository, {
          kind: 'generic',
          title: refreshTitle,
          description: 'Fast-forwarding branches',
          value: fetchWeight,
        })

        await this.fastForwardBranches(repository)

        this.updatePushPullFetchProgress(repository, {
          kind: 'generic',
          title: refreshTitle,
          value: fetchWeight + refreshWeight * 0.5,
        })

        // manually refresh branch protections after the push, to ensure
        // any new branch will immediately report as protected
        await this.refreshBranchProtectionState(repository)

        await this._refreshRepository(repository)
      } finally {
        this.updatePushPullFetchProgress(repository, null)

        if (fetchType === FetchType.UserInitiatedTask) {
          if (repository.gitHubRepository != null) {
            this._refreshIssues(repository.gitHubRepository)
          }
          // Detect point: a user-initiated fetch that refreshed the working
          // tree may have surfaced new cheap-LFS pointers. The detector's cheap
          // scan is the "only if new pointers appeared" guard.
          void this.maybeAutoMaterializeCheapLfs(repository)
        }
      }
    })
  }

  public _endWelcomeFlow(): Promise<void> {
    this.showWelcomeFlow = false
    this.emitUpdate()

    markWelcomeFlowComplete()

    this.statsStore.recordWelcomeWizardTerminated()

    return Promise.resolve()
  }

  public _setCommitMessageFocus(focus: boolean) {
    if (this.focusCommitMessage !== focus) {
      this.focusCommitMessage = focus
      this.emitUpdate()
    }
  }

  public _setSidebarWidth(width: number): Promise<void> {
    this.sidebarWidth = { ...this.sidebarWidth, value: width }
    setNumber(sidebarWidthConfigKey, width)
    this.updateResizableConstraints()
    this.emitUpdate()

    return Promise.resolve()
  }

  public _resetSidebarWidth(): Promise<void> {
    this.sidebarWidth = { ...this.sidebarWidth, value: defaultSidebarWidth }
    localStorage.removeItem(sidebarWidthConfigKey)
    this.updateResizableConstraints()
    this.emitUpdate()

    return Promise.resolve()
  }

  public _setBranchDropdownWidth(width: number): Promise<void> {
    this.branchDropdownWidth = { ...this.branchDropdownWidth, value: width }
    setNumber(branchDropdownWidthConfigKey, width)
    this.updateResizableConstraints()
    this.emitUpdate()

    return Promise.resolve()
  }

  public _resetBranchDropdownWidth(): Promise<void> {
    this.branchDropdownWidth = {
      ...this.branchDropdownWidth,
      value: defaultBranchDropdownWidth,
    }
    localStorage.removeItem(branchDropdownWidthConfigKey)
    this.updateResizableConstraints()
    this.emitUpdate()

    return Promise.resolve()
  }

  /**
   * Switch the repository to a different worktree. This shouldn't be called
   * directly. See `Dispatcher`.
   *
   * If the target worktree path is already registered as a separate repository,
   * that repository is selected instead of modifying the current one.
   */
  public async _switchWorktree(
    repository: Repository,
    worktree: WorktreeEntry,
    persistSelection: boolean = true
  ): Promise<Repository> {
    if (isSubmoduleRepository(repository)) {
      throw new Error(
        'Switching the active worktree is unavailable while a submodule is open temporarily.'
      )
    }

    const type = await getRepositoryType(worktree.path).catch(e => {
      log.error('Could not determine repository type', e)
      return { kind: 'missing' } as RepositoryType
    })

    if (type.kind !== 'regular' && type.kind !== 'unsafe') {
      throw new Error(
        `The worktree path '${worktree.path}' does not appear to be a valid Git repository.`
      )
    }

    // If the repository path isn't trusted we'll mark the repository as
    // missing. The missing repository view knows how to add a path to the
    // allow list.
    const missing = type.kind === 'unsafe'
    const gitDir = type.kind === 'regular' ? type.gitDir : undefined

    const result = await this.repositoriesStore.switchWorktree(
      repository,
      worktree.path,
      missing,
      gitDir
    )

    this.repositoryStateCache.seedFromWorktree(
      result.repository,
      repository,
      worktree
    )

    await this._selectRepository(result.repository, persistSelection)

    this.statsStore.increment('worktreeSwitchCount')

    return result.repository
  }

  /** This shouldn't be called directly. See 'Dispatcher'. */
  public _addWorktree(
    repository: Repository,
    worktreePath: string,
    options: {
      readonly createBranch?: string
      readonly commitish?: string
    }
  ): Promise<void> {
    return this.withTemporaryRepositoryMutationGuard(repository, () =>
      addWorktree(repository, worktreePath, options)
    )
  }

  /** This shouldn't be called directly. See 'Dispatcher'. */
  public _requestDeleteWorktree(
    repository: Repository,
    worktreePath: string
  ): void {
    if (this.confirmWorktreeRemoval) {
      this._showPopup({
        type: PopupType.DeleteWorktree,
        repository,
        worktreePath,
      })
    } else {
      this._deleteWorktree(repository, worktreePath).catch(e =>
        this.emitError(e)
      )
    }
  }

  /** This shouldn't be called directly. See 'Dispatcher'. */
  public async _deleteWorktree(
    repository: Repository,
    worktreePath: string,
    force?: boolean
  ): Promise<void> {
    const isDeletingCurrentWorktree = repository.path === worktreePath
    let originalWorktree: WorktreeEntry | null = null

    if (isDeletingCurrentWorktree) {
      const worktrees = await listWorktrees(repository)
      const main = worktrees.find(wt => wt.type === 'main')
      originalWorktree =
        worktrees.find(wt => wt.path === repository.path) ?? null

      if (main === undefined) {
        throw new Error('Could not find main worktree')
      }

      // Switch to the main worktree before deleting the current one since the
      // current worktree path will be deleted after the switch. Use the
      // resulting repository (with the updated path) for the subsequent
      // remove and refresh calls.
      repository = await this._switchWorktree(repository, main)
    }

    try {
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        removeWorktree(repository.path, worktreePath, force)
      )
    } catch (e) {
      this._closePopup(PopupType.DeleteWorktree)
      this._closePopup(PopupType.DeleteWorktreeFailed)
      this._showPopup({
        type: PopupType.DeleteWorktreeFailed,
        repository,
        worktreePath,
        error: e,
        originalWorktree,
      })
      return
    }

    await this._refreshWorktrees(repository)
    this.statsStore.increment('worktreeDeletedCount')
  }

  /** This shouldn't be called directly. See 'Dispatcher'. */
  public async _moveWorktree(
    repository: Repository,
    worktreePath: string,
    newPath: string
  ): Promise<void> {
    if (
      isSubmoduleRepository(repository) &&
      worktreePathsEqual(repository.path, worktreePath)
    ) {
      throw new Error(
        'Moving the active worktree is unavailable while a submodule is open temporarily.'
      )
    }

    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      moveWorktree(repository, worktreePath, newPath)
    )

    // If the worktree being renamed is the currently selected one, switch to
    // its new path so that the subsequent refresh (and any further git calls)
    // operate on the renamed directory rather than the now non-existing one.
    if (repository.path === worktreePath) {
      const result = await this.repositoriesStore.switchWorktree(
        repository,
        newPath
      )

      // Renaming changes the repository's path and therefore its hash, which
      // is the key used by the state cache. Carry the existing state over to
      // the new identity so we don't reset the UI (e.g. a typed commit
      // message) just because the worktree was renamed.
      this.repositoryStateCache.transferState(repository, result.repository)

      await this._selectRepository(result.repository)
      await this._refreshWorktrees(result.repository)
    } else {
      await this._refreshWorktrees(repository)
    }
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _setWorktreeLocked(
    repository: Repository,
    worktreePath: string,
    locked: boolean
  ): Promise<void> {
    const worktrees = await listWorktrees(repository)
    const worktree = worktrees.find(candidate =>
      worktreePathsEqual(candidate.path, worktreePath)
    )
    if (worktree === undefined || worktree.type === 'main') {
      throw new Error('Only a registered linked worktree can be locked.')
    }
    if (worktree.isLocked === locked) {
      return
    }

    if (locked) {
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        lockWorktree(repository, worktree.path)
      )
    } else {
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        unlockWorktree(repository, worktree.path)
      )
    }
    await this._refreshWorktrees(repository)
  }

  /** Build a bounded maintenance preview without exposing worktree paths. */
  public async _previewWorktreeMaintenance(
    repository: Repository,
    operation: WorktreeMaintenanceOperation
  ): Promise<IWorktreeMaintenancePreview> {
    if (operation === 'prune') {
      return {
        operation,
        affectedCount: await pruneWorktrees(repository, true),
      }
    }
    if (operation === 'repair') {
      const paths = validateWorktreeRepairPaths(
        (await listWorktrees(repository)).map(worktree => worktree.path)
      )
      return {
        operation,
        affectedCount: paths.length,
      }
    }
    return assertNever(operation, `Unknown worktree maintenance: ${operation}`)
  }

  /** Revalidate and execute one reviewed worktree maintenance operation. */
  public async _runWorktreeMaintenance(
    repository: Repository,
    operation: WorktreeMaintenanceOperation
  ): Promise<IWorktreeMaintenancePreview> {
    let affectedCount = 0
    if (operation === 'prune') {
      affectedCount = await this.withTemporaryRepositoryMutationGuard(
        repository,
        () => pruneWorktrees(repository, true)
      )
      if (affectedCount > 0) {
        await this.withTemporaryRepositoryMutationGuard(repository, () =>
          pruneWorktrees(repository, false)
        )
      }
    } else if (operation === 'repair') {
      const worktrees = await listWorktrees(repository)
      const paths = validateWorktreeRepairPaths(
        worktrees.map(worktree => worktree.path)
      )
      affectedCount = paths.length
      if (affectedCount > 0) {
        await this.withTemporaryRepositoryMutationGuard(repository, () =>
          repairWorktrees(repository, paths)
        )
      }
    } else {
      return assertNever(
        operation,
        `Unknown worktree maintenance: ${operation}`
      )
    }
    await this._refreshWorktrees(repository)
    return { operation, affectedCount }
  }

  public _setWorktreeDropdownWidth(width: number): Promise<void> {
    this.worktreeDropdownWidth = {
      ...this.worktreeDropdownWidth,
      value: width,
    }
    setNumber(worktreeDropdownWidthConfigKey, width)
    this.updateResizableConstraints()
    this.emitUpdate()

    return Promise.resolve()
  }

  public _resetWorktreeDropdownWidth(): Promise<void> {
    this.worktreeDropdownWidth = {
      ...this.worktreeDropdownWidth,
      value: defaultWorktreeDropdownWidth,
    }
    localStorage.removeItem(worktreeDropdownWidthConfigKey)
    this.updateResizableConstraints()
    this.emitUpdate()

    return Promise.resolve()
  }

  public _setPushPullButtonWidth(width: number): Promise<void> {
    this.pushPullButtonWidth = { ...this.pushPullButtonWidth, value: width }
    setNumber(pushPullButtonWidthConfigKey, width)
    this.updateResizableConstraints()
    this.emitUpdate()

    return Promise.resolve()
  }

  public _resetPushPullButtonWidth(): Promise<void> {
    this.pushPullButtonWidth = {
      ...this.pushPullButtonWidth,
      value: defaultPushPullButtonWidth,
    }
    localStorage.removeItem(pushPullButtonWidthConfigKey)
    this.updateResizableConstraints()
    this.emitUpdate()

    return Promise.resolve()
  }

  public _setCommitSummaryWidth(width: number): Promise<void> {
    this.commitSummaryWidth = { ...this.commitSummaryWidth, value: width }
    setNumber(commitSummaryWidthConfigKey, width)
    this.updateResizableConstraints()
    this.emitUpdate()

    return Promise.resolve()
  }

  public _resetCommitSummaryWidth(): Promise<void> {
    this.commitSummaryWidth = {
      ...this.commitSummaryWidth,
      value: defaultCommitSummaryWidth,
    }
    localStorage.removeItem(commitSummaryWidthConfigKey)
    this.updateResizableConstraints()
    this.emitUpdate()

    return Promise.resolve()
  }

  public _setCommitMessage(
    repository: Repository,
    message: ICommitMessage
  ): Promise<void> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return Promise.resolve()
    }
    const gitStore = this.gitStoreCache.get(repository)
    return gitStore.setCommitMessage(message)
  }

  public async _promptOverrideWithGeneratedCommitMessage(
    repository: Repository,
    filesSelected: ReadonlyArray<WorkingDirectoryFileChange>
  ): Promise<void> {
    if (!this.confirmCommitMessageOverride) {
      // If user has disabled the confirmation, directly generate commit message
      await this._generateCommitMessage(repository, filesSelected)
      return
    }

    return this._showPopup({
      type: PopupType.GenerateCommitMessageOverrideWarning,
      repository,
      filesSelected,
    })
  }

  public _updateCommitMessageGenerationDisclaimerLastSeen(): void {
    this.commitMessageGenerationDisclaimerLastSeen = Date.now()
    setNumber(
      commitMessageGenerationDisclaimerLastSeenKey,
      this.commitMessageGenerationDisclaimerLastSeen
    )
    this.emitUpdate()
  }

  public _setCommitMessageGenerationButtonClicked(): void {
    if (!this.commitMessageGenerationButtonClicked) {
      this.commitMessageGenerationButtonClicked = true
      setBoolean(commitMessageGenerationButtonClickedKey, true)
      this.emitUpdate()
    }
  }

  public _updateCopilotConflictResolutionDisclaimerLastSeen(): void {
    this.copilotConflictResolutionDisclaimerLastSeen = Date.now()
    setNumber(
      copilotConflictResolutionDisclaimerLastSeenKey,
      this.copilotConflictResolutionDisclaimerLastSeen
    )
    this.emitUpdate()
  }

  public _incrementCopilotConflictResolutionClickCount(): void {
    this.copilotConflictResolutionClickCount++
    setNumber(
      copilotConflictResolutionClickCountKey,
      this.copilotConflictResolutionClickCount
    )
    this.emitUpdate()
  }

  public _setAlwaysUseCopilotForConflictResolution(value: boolean): void {
    this.alwaysUseCopilotForConflictResolution = value
    setBoolean(alwaysUseCopilotForConflictResolutionKey, value)
    this.emitUpdate()
  }

  private shouldAutoRouteToCopilotConflictResolution(
    repository: Repository
  ): boolean {
    return (
      this.alwaysUseCopilotForConflictResolution &&
      enableCopilotConflictResolution() &&
      getAccountForCopilotConflictResolution(this.accounts, repository) !== null
    )
  }

  private isCopilotConflictDisclaimerFresh(): boolean {
    return (
      this.copilotConflictResolutionDisclaimerLastSeen !== null &&
      offsetFromNow(-30, 'days') <=
        this.copilotConflictResolutionDisclaimerLastSeen
    )
  }

  public async _generateCommitMessage(
    repository: Repository,
    filesSelected: ReadonlyArray<WorkingDirectoryFileChange>
  ): Promise<boolean> {
    const account = getAccountForCommitMessageGeneration(
      this.accounts,
      repository
    )

    if (!account) {
      return false
    }

    this._setCommitMessageGenerationButtonClicked()

    if (
      !this.commitMessageGenerationDisclaimerLastSeen ||
      offsetFromNow(-30, 'days') >
        this.commitMessageGenerationDisclaimerLastSeen
    ) {
      await this._showPopup({
        type: PopupType.GenerateCommitMessageDisclaimer,
        repository,
        filesSelected,
      })
      return false
    }

    return this.withIsGeneratingCommitMessage(repository, async signal => {
      try {
        // If user is amending a commit, we want to use the commit
        // to amend as the base for the commit message generation.
        const commitToAmend =
          this.repositoryStateCache.get(repository)?.commitToAmend?.sha ??
          undefined
        const diff = await getFilesDiffText(
          repository,
          filesSelected,
          commitToAmend ? `${commitToAmend}^` : undefined
        )
        if (!diff || !this.isTemporaryRepositoryActive(repository)) {
          return false
        }

        let response: { readonly title: string; readonly description: string }
        if (enableCopilotSdkCommitMessageGeneration(account)) {
          const modelRequest = await this.resolveCopilotModelRequest(
            this.selectedCopilotModels['commit-message-generation'] ?? null
          )
          if (!this.isTemporaryRepositoryActive(repository)) {
            return false
          }
          const rules =
            this.repositoryStateCache
              .get(repository)
              ?.changesState.currentRepoRulesInfo?.commitMessagePatterns.getRules() ??
            []
          response = await this.copilotStore.generateCommitMessage(
            account,
            diff,
            repository.path,
            modelRequest,
            rules,
            signal
          )
        } else {
          response = await API.fromAccount(account).getDiffChangesCommitMessage(
            diff
          )
        }

        if (!this.isTemporaryRepositoryActive(repository)) {
          return false
        }

        await this._setCommitMessage(repository, {
          summary: response.title,
          description: response.description,
          timestamp: Date.now(),
          generatedByCopilot: true,
        })

        this.statsStore.increment('generateCommitMessageCount')
      } catch (e) {
        if (e instanceof CommitMessageGenerationCancelledError) {
          return false
        }

        this.emitError(
          new ErrorWithMetadata(e, {
            repository,
          })
        )
        return false
      }

      return true
    })
  }

  /** This shouldn't be called directly. See 'Dispatcher'. */
  public async _cancelGenerateCommitMessage(
    repository: Repository
  ): Promise<void> {
    const state = this.repositoryStateCache.get(repository)
    const abortController = state.commitMessageGenerationAbortController
    if (!state.isGeneratingCommitMessage || abortController === null) {
      return
    }

    abortController.abort()
  }

  /**
   * Extract display labels and git refs for both sides of a conflict.
   */
  private async getConflictLabelsAndRefs(
    repository: Repository,
    conflictState: ConflictState,
    multiCommitOperationState: IMultiCommitOperationState | null
  ): Promise<{
    readonly ourLabel: string
    readonly theirLabel: string
    readonly ourRef: string | undefined
    readonly theirRef: string | undefined
  }> {
    if (isMergeConflictState(conflictState)) {
      const theirBranch = await this.getMergeConflictsTheirBranch(
        repository,
        false,
        multiCommitOperationState
      )
      return {
        ourLabel: conflictState.currentBranch,
        ourRef: conflictState.currentBranch,
        theirLabel: theirBranch ?? 'incoming branch',
        theirRef: theirBranch,
      }
    }

    if (isRebaseConflictState(conflictState)) {
      return {
        ourLabel: conflictState.baseBranch ?? 'current branch',
        ourRef: conflictState.baseBranch,
        theirLabel: conflictState.targetBranch,
        theirRef: conflictState.targetBranch,
      }
    }

    if (isCherryPickConflictState(conflictState)) {
      const sourceBranch =
        multiCommitOperationState !== null &&
        multiCommitOperationState.operationDetail.kind ===
          MultiCommitOperationKind.CherryPick &&
        multiCommitOperationState.operationDetail.sourceBranch !== null
          ? multiCommitOperationState.operationDetail.sourceBranch.name
          : undefined

      return {
        ourLabel: conflictState.targetBranchName,
        ourRef: conflictState.targetBranchName,
        theirLabel: sourceBranch ?? 'cherry-picked commit',
        theirRef: sourceBranch,
      }
    }

    return assertNever(conflictState, 'Unsupported conflict kind')
  }

  /** This shouldn't be called directly. See 'Dispatcher'. */
  public async _resolveConflictsWithCopilot(
    repository: Repository,
    onProgress?: (progress: IConflictResolutionProgress) => void,
    signal?: AbortSignal
  ): Promise<{
    readonly resolutions: ReadonlyArray<IFileResolution>
    readonly summary: ICopilotResolutionSummary
  } | null> {
    if (
      !enableCopilotConflictResolution() ||
      signal?.aborted ||
      !this.isTemporaryRepositoryActive(repository)
    ) {
      return null
    }

    const account = getAccountForCopilotConflictResolution(
      this.accounts,
      repository
    )

    if (!account) {
      return null
    }

    const totalTimer = startTimer('resolve conflicts with Copilot', repository)

    try {
      const state = this.repositoryStateCache.get(repository)
      const { conflictState } = state.changesState

      if (conflictState === null) {
        log.warn(
          'AppStore: resolveConflictsWithCopilot called with no active conflict state'
        )
        return null
      }

      const labelsTimer = startTimer('gather conflict labels', repository)
      const labels = await this.getConflictLabelsAndRefs(
        repository,
        conflictState,
        state.multiCommitOperationState
      )
      labelsTimer.done()
      if (signal?.aborted || !this.isTemporaryRepositoryActive(repository)) {
        return null
      }

      const conflictedFiles = getConflictedFiles(
        state.changesState.workingDirectory,
        conflictState.manualResolutions
      )

      if (conflictedFiles.length === 0) {
        log.warn(
          'AppStore: resolveConflictsWithCopilot called with no conflicted files'
        )
        return null
      }

      log.info(
        `[Timing] resolving ${conflictedFiles.length} conflicted file(s)`
      )

      const context = await this.gatherConflictResolutionContext(
        repository,
        labels,
        conflictedFiles,
        state,
        signal
      )
      if (signal?.aborted || !this.isTemporaryRepositoryActive(repository)) {
        return null
      }

      const resolveTimer = startTimer(
        'copilotStore.resolveConflicts',
        repository
      )
      const modelRequest = await this.resolveCopilotModelRequest(
        this.selectedCopilotModels['conflict-resolution'] ?? null
      )
      if (signal?.aborted || !this.isTemporaryRepositoryActive(repository)) {
        return null
      }
      try {
        const result = await this.copilotStore.resolveConflicts(
          account,
          context,
          repository.path,
          modelRequest,
          onProgress,
          signal
        )
        if (signal?.aborted || !this.isTemporaryRepositoryActive(repository)) {
          return null
        }

        // The model can only cite data we placed in the prompt, so resolving
        // its references is a simple lookup against the gathered context —
        // no re-fetching or re-hydration required. When the model cites
        // nothing, fall back to the most informative item we gathered so the
        // "Context" list always traces the conflict to at least one source.
        const cited = selectReferencedContext(result.references, context)
        const references =
          cited.length > 0 ? cited : fallbackReferencedContext(context)

        return {
          resolutions: result.resolutions,
          summary: {
            markdown: result.summary,
            ourLabel: labels.ourLabel,
            theirLabel: labels.theirLabel,
            references,
          },
        }
      } finally {
        resolveTimer.done()
      }
    } catch (e) {
      // A user-initiated cancellation isn't a failure — don't log it as one.
      if (signal?.aborted) {
        log.info('AppStore: Copilot conflict resolution aborted by user')
        return null
      }
      log.warn('AppStore: Copilot conflict resolution failed', e)
      return null
    } finally {
      totalTimer.done()
    }
  }

  /**
   * Gather the full, display-ready context for a Copilot conflict
   * resolution in a single pass: the conflicted file hunks, the recent
   * commits from both sides (with remote-reachability and github.com
   * links), and the pull requests we can associate with each side.
   *
   * This is the one place context is collected. The same object feeds the
   * Copilot prompt *and* the dialog's summary card, so there's no second
   * pass to re-hydrate the model's cited references.
   *
   * Pull requests are resolved local-cache-first; only numbers we can't
   * find locally are fetched from the API (capped, best-effort) so a
   * merged PR's title and body still reach the prompt.
   */
  private async gatherConflictResolutionContext(
    repository: Repository,
    labels: {
      readonly ourLabel: string
      readonly theirLabel: string
      readonly ourRef: string | undefined
      readonly theirRef: string | undefined
    },
    conflictedFiles: ReadonlyArray<{ readonly path: string }>,
    state: IRepositoryState,
    signal?: AbortSignal
  ): Promise<IConflictResolutionContext> {
    const contextTimer = startTimer('build conflict context', repository)
    const fileContext = await buildConflictContext(
      labels.ourLabel,
      labels.theirLabel,
      repository.path,
      conflictedFiles
    )
    contextTimer.done()
    if (signal?.aborted || !this.isTemporaryRepositoryActive(repository)) {
      throw new Error('Copilot conflict resolution cancelled.')
    }

    // Best-effort enrichment — never block resolution on these.
    const commitContextTimer = startTimer('gather commit context', repository)
    const commitContext =
      labels.ourRef && labels.theirRef
        ? await gatherCommitContext(
            repository,
            labels.ourRef,
            labels.theirRef
          ).catch(() => null)
        : null
    commitContextTimer.done()
    if (signal?.aborted || !this.isTemporaryRepositoryActive(repository)) {
      throw new Error('Copilot conflict resolution cancelled.')
    }

    const ghRepo = isRepositoryWithGitHubRepository(repository)
      ? repository.gitHubRepository
      : null

    // Treat a commit as "on the remote" when it isn't in the git store's
    // local-only set. localCommitSHAs tracks current-branch commits that
    // haven't been pushed yet, so anything else (most notably theirs-side
    // commits that arrived via fetch) is safe to link to github.com.
    const localShas = new Set(
      this.gitStoreCache.get(repository).localCommitSHAs
    )
    const toContextCommit = (commit: Commit): IConflictContextCommit => ({
      sha: commit.sha,
      shortSha: commit.shortSha,
      summary: commit.summary,
      isOnRemote: !localShas.has(commit.sha),
    })

    const currentPullRequest = state.branchesState.currentPullRequest
    const seededPullRequests = new Map<number, IConflictContextPullRequest>()
    if (currentPullRequest !== null) {
      // The current branch's own PR is authoritative from app state and may
      // be merged/closed (and thus absent from the open-PR cache), so seed
      // it directly rather than looking it up.
      seededPullRequests.set(currentPullRequest.pullRequestNumber, {
        number: currentPullRequest.pullRequestNumber,
        title: currentPullRequest.title,
        body: currentPullRequest.body,
      })
    }

    // Mine PR references from *both* sides' commits. Ours-vs-theirs is not a
    // reliable proxy for "which side carries the PRs" — a rebase, for
    // instance, makes ours the branch you're landing onto — so we gather
    // symmetrically and let the model decide what's material.
    const allPrNumbers = new Set<number>([
      ...seededPullRequests.keys(),
      ...extractPullRequestNumbersFromCommits(commitContext?.ourCommits ?? []),
      ...extractPullRequestNumbersFromCommits(
        commitContext?.theirCommits ?? []
      ),
    ])

    const resolved = await this.resolvePullRequestContexts(
      repository,
      ghRepo,
      [...allPrNumbers],
      seededPullRequests
    )
    if (signal?.aborted || !this.isTemporaryRepositoryActive(repository)) {
      throw new Error('Copilot conflict resolution cancelled.')
    }

    // Build a deterministic flat list from the input number order.
    const pullRequests = [...allPrNumbers]
      .map(n => resolved.get(n))
      .filter((pr): pr is IConflictContextPullRequest => pr !== undefined)

    return {
      ...fileContext,
      pullRequests,
      ourCommits: (commitContext?.ourCommits ?? []).map(toContextCommit),
      theirCommits: (commitContext?.theirCommits ?? []).map(toContextCommit),
    }
  }

  /**
   * Resolve a set of pull-request numbers into display-ready context,
   * preferring the local cache and falling back to the API for any missing
   * (e.g. merged PRs no longer in the open-PR cache). Capped and
   * best-effort: failures are logged or skipped. `seeded` entries are
   * treated as already resolved and never re-fetched.
   */
  private async resolvePullRequestContexts(
    repository: Repository,
    ghRepo: GitHubRepository | null,
    numbers: ReadonlyArray<number>,
    seeded: ReadonlyMap<number, IConflictContextPullRequest>
  ): Promise<Map<number, IConflictContextPullRequest>> {
    const byNumber = new Map<number, IConflictContextPullRequest>(seeded)

    const lookups = numbers
      .filter(n => !byNumber.has(n))
      .slice(0, MaxPullRequestLookups)
    if (lookups.length === 0 || !isRepositoryWithGitHubRepository(repository)) {
      return byNumber
    }

    try {
      const allPRs = await this.pullRequestCoordinator.getAllPullRequests(
        repository
      )
      for (const pr of findPullRequestsByNumbers(lookups, allPRs)) {
        byNumber.set(pr.pullRequestNumber, {
          number: pr.pullRequestNumber,
          title: pr.title,
          body: pr.body,
        })
      }
    } catch (e) {
      log.warn('AppStore: failed to read conflict-side PRs from local cache', e)
    }

    // Fetch anything still missing from the API so merged PRs (no longer in
    // the open-PR cache) still contribute their title and body.
    const missing = lookups.filter(n => !byNumber.has(n))
    if (missing.length > 0 && ghRepo) {
      const account = getAccountForRepository(this.accounts, repository)
      if (account !== null) {
        const api = API.fromAccount(account)
        await Promise.all(
          missing.map(async prNumber => {
            try {
              const apiPr = await api.fetchPullRequest(
                ghRepo.owner.login,
                ghRepo.name,
                String(prNumber)
              )
              if (apiPr) {
                byNumber.set(prNumber, {
                  number: prNumber,
                  title: apiPr.title,
                  body: apiPr.body,
                })
              }
            } catch {
              // Best-effort — skip PRs we can't fetch.
            }
          })
        )
      }
    }

    return byNumber
  }

  /**
   * Pre-flight entry point for Copilot conflict resolution invoked from
   * the manual conflicts dialog's "Resolve with Copilot" button.
   *
   * Verifies a Copilot-enabled account exists, sets the first-click flag,
   * and gates on the AI-tool disclaimer (shown on first use and again
   * every 30 days). On clean pass, transitions the multi-commit-operation
   * step to the loading interstitial and kicks off
   * `_startCopilotConflictResolution`.
   *
   * This shouldn't be called directly. See `Dispatcher`.
   */
  public async _attemptCopilotConflictResolution(
    repository: Repository
  ): Promise<void> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const state = this.repositoryStateCache.get(repository)
    const { multiCommitOperationState } = state
    if (multiCommitOperationState === null) {
      return
    }

    const { step } = multiCommitOperationState
    if (step.kind !== MultiCommitOperationStepKind.ShowConflicts) {
      return
    }

    const account = getAccountForCopilotConflictResolution(
      this.accounts,
      repository
    )

    if (!account) {
      return
    }

    // Track that the user has clicked the entry point so we can hide the
    // "New" call-to-action bubble and nudge after 5 uses.
    this._incrementCopilotConflictResolutionClickCount()

    // First-use disclaimer + periodic re-confirmation. Mirrors the
    // commit-message-generation pattern.
    if (
      !this.copilotConflictResolutionDisclaimerLastSeen ||
      offsetFromNow(-30, 'days') >
        this.copilotConflictResolutionDisclaimerLastSeen
    ) {
      await this._showPopup({
        type: PopupType.CopilotConflictResolutionDisclaimer,
        repository,
      })
      if (!this.isTemporaryRepositoryActive(repository)) {
        return
      }
      return
    }

    // Nudge the user to enable "always use Copilot" after 5 clicks.
    if (
      !this.alwaysUseCopilotForConflictResolution &&
      this.copilotConflictResolutionClickCount === 5
    ) {
      await this._showPopup({
        type: PopupType.CopilotConflictResolutionAlwaysNudge,
        repository,
      })
      if (!this.isTemporaryRepositoryActive(repository)) {
        return
      }
      return
    }

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    // Transition to the loading interstitial and start the resolution.
    const { conflictState } = step
    this.repositoryStateCache.updateMultiCommitOperationState(
      repository,
      () => ({
        step: {
          kind: MultiCommitOperationStepKind.ShowCopilotConflictsLoading,
          conflictState,
        },
        useCopilotConflictResolution: true,
      })
    )
    this.emitUpdate()

    return this._startCopilotConflictResolution(repository)
  }

  /**
   * Orchestrate Copilot conflict resolution: call the API, emit progress
   * updates, and transition to the result dialog on success. File writes are
   * deferred until the user confirms (see _applyCopilotConflictResolutions).
   *
   * This shouldn't be called directly. See `Dispatcher`.
   */
  public async _startCopilotConflictResolution(
    repository: Repository
  ): Promise<void> {
    const state = this.repositoryStateCache.get(repository)
    const { multiCommitOperationState } = state
    if (multiCommitOperationState === null) {
      return
    }

    const { step } = multiCommitOperationState
    if (
      step.kind !== MultiCommitOperationStepKind.ShowCopilotConflictsLoading
    ) {
      return
    }

    const { conflictState } = step

    // Controller used to actually cancel the in-flight SDK turn when the user
    // clicks "Stop" (see _abortCopilotConflictResolution).
    const abortController = new AbortController()
    const copilotResolutionModel = getConflictResolutionModelDisplay(
      this.selectedCopilotModels['conflict-resolution'] ?? null,
      this.copilotModels,
      this.byokProviders
    )
    this.repositoryStateCache.updateMultiCommitOperationState(
      repository,
      () => ({
        copilotResolutionAbortController: abortController,
        copilotResolutionModel,
      })
    )

    // Only the run that owns this controller may mutate Copilot resolution
    // state. Guards against a stale run (still unwinding after the user
    // cancelled and restarted) clobbering the controller, progress, or result
    // of the newer run.
    const ownsCurrentRun = () =>
      this.isTemporaryRepositoryActive(repository) &&
      this.repositoryStateCache.get(repository).multiCommitOperationState
        ?.copilotResolutionAbortController === abortController

    this.statsStore.increment('initiateResolveConflictsWithCopilotCount')
    const resolveStartTime = performance.now()

    try {
      const result = await this._resolveConflictsWithCopilot(
        repository,
        progress => {
          // Bail if user cancelled while the request was in-flight, or if a
          // newer run has taken over.
          if (!this.isTemporaryRepositoryActive(repository)) {
            return
          }
          const current = this.repositoryStateCache.get(repository)
          const mcoState = current.multiCommitOperationState
          if (
            mcoState === null ||
            mcoState.step.kind !==
              MultiCommitOperationStepKind.ShowCopilotConflictsLoading ||
            !ownsCurrentRun()
          ) {
            return
          }
          if (__DEV__ && progress.reasoningSnippet !== undefined) {
            log.info(
              `[Copilot SDK] app-store progress snippet: ${progress.reasoningSnippet}`
            )
          }
          this.repositoryStateCache.updateMultiCommitOperationState(
            repository,
            () => ({ copilotResolutionProgress: progress })
          )
          this.emitUpdate()
        },
        abortController.signal
      )

      // The user stopped the resolution. The loading dialog has already
      // navigated back to the conflicts list, so just clear the in-flight
      // state without surfacing an error.
      if (abortController.signal.aborted) {
        if (ownsCurrentRun()) {
          this.repositoryStateCache.updateMultiCommitOperationState(
            repository,
            () => ({
              copilotResolutionProgress: null,
              copilotResolutionAbortController: null,
            })
          )
          this.emitUpdate()
        }
        return
      }

      // A newer run took over while we were awaiting — let it own the outcome.
      if (!ownsCurrentRun()) {
        return
      }

      // Re-check state: user may have cancelled during the await
      const currentState = this.repositoryStateCache.get(repository)
      const currentMco = currentState.multiCommitOperationState
      if (currentMco === null) {
        return
      }

      // The user can navigate to ConfirmAbort while we're awaiting the
      // resolution. If they came from the loading step, we still want
      // the resolution to be available when they click "Return to
      // conflicts" — store the result and rewrite the return target
      // so they land on the result dialog rather than an empty
      // ShowCopilotConflicts step.
      const currentStep = currentMco.step
      const isStillLoading =
        currentStep.kind ===
        MultiCommitOperationStepKind.ShowCopilotConflictsLoading
      const isConfirmAbortFromLoading =
        currentStep.kind === MultiCommitOperationStepKind.ConfirmAbort &&
        currentStep.returnToStepKind ===
          MultiCommitOperationStepKind.ShowCopilotConflictsLoading

      if (!isStillLoading && !isConfirmAbortFromLoading) {
        return
      }

      if (result === null) {
        throw new Error('Copilot conflict resolution returned no results')
      }

      if (isConfirmAbortFromLoading) {
        // Stash the result and update the return target so the user
        // lands on the result dialog if they cancel the abort.
        this.repositoryStateCache.updateMultiCommitOperationState(
          repository,
          () => ({
            step: {
              kind: MultiCommitOperationStepKind.ConfirmAbort,
              conflictState,
              returnToStepKind:
                MultiCommitOperationStepKind.ShowCopilotConflicts,
            },
            copilotResolutions: result.resolutions,
            copilotResolutionSummary: result.summary,
            copilotResolutionProgress: null,
            copilotResolutionAbortController: null,
          })
        )

        this.emitUpdate()
        return
      }

      // Store resolutions and transition to the result dialog.
      // Files are NOT written to disk yet — that happens when the user
      // clicks "Continue Merge" (see _applyCopilotConflictResolutions).
      this.repositoryStateCache.updateMultiCommitOperationState(
        repository,
        () => ({
          step: {
            kind: MultiCommitOperationStepKind.ShowCopilotConflicts,
            conflictState,
          },
          copilotResolutions: result.resolutions,
          copilotResolutionSummary: result.summary,
          copilotResolutionProgress: null,
          copilotResolutionAbortController: null,
        })
      )

      this.emitUpdate()

      // Record resolution timing buckets
      const elapsedSeconds = (performance.now() - resolveStartTime) / 1000
      if (elapsedSeconds > 15) {
        this.statsStore.increment('copilotConflictResolutionOver15sCount')
      }
      if (elapsedSeconds > 30) {
        this.statsStore.increment('copilotConflictResolutionOver30sCount')
      }
      if (elapsedSeconds > 60) {
        this.statsStore.increment('copilotConflictResolutionOver60sCount')
      }
      if (elapsedSeconds > 120) {
        this.statsStore.increment('copilotConflictResolutionOver120sCount')
      }
    } catch (e) {
      log.warn('AppStore: Copilot conflict resolution flow failed', e)

      // A stale run shouldn't surface errors or reset a newer run's state.
      if (!ownsCurrentRun()) {
        return
      }

      this.statsStore.increment('copilotConflictResolutionErrorCount')

      // Surface the error to the user so they understand why they were
      // routed back to manual conflict resolution. Mirrors the pattern
      // used by `_generateCommitMessage`.
      this.emitError(new ErrorWithMetadata(e, { repository }))

      // Transition back to manual conflict resolution
      this.repositoryStateCache.updateMultiCommitOperationState(
        repository,
        () => ({
          step: {
            kind: MultiCommitOperationStepKind.ShowConflicts,
            conflictState,
          },
          useCopilotConflictResolution: false,
          copilotResolutions: null,
          copilotResolutionSummary: null,
          copilotResolutionProgress: null,
          copilotResolutionAbortController: null,
        })
      )

      this.emitUpdate()
    }
  }

  /**
   * Cancel the in-flight Copilot conflict resolution for the given repository,
   * if one is running. Fires the stored AbortController so the underlying SDK
   * turn is torn down immediately rather than running to completion in the
   * background.
   *
   * This shouldn't be called directly. See `Dispatcher`.
   */
  public _abortCopilotConflictResolution(repository: Repository): void {
    const state = this.repositoryStateCache.get(repository)
    const controller =
      state.multiCommitOperationState?.copilotResolutionAbortController ?? null

    if (controller !== null) {
      controller.abort()
      this.statsStore.increment('copilotConflictResolutionStoppedCount')
    }
  }

  /**
   * Write Copilot-resolved file contents to disk and stage them.
   * Called when the user clicks "Continue Merge" from the Copilot conflicts
   * result dialog.
   *
   * This shouldn't be called directly. See `Dispatcher`.
   */
  public async _applyCopilotConflictResolutions(
    repository: Repository
  ): Promise<void> {
    const state = this.repositoryStateCache.get(repository)
    const { multiCommitOperationState } = state
    if (multiCommitOperationState === null) {
      return
    }

    const { copilotResolutions, step } = multiCommitOperationState
    if (copilotResolutions === null || copilotResolutions.length === 0) {
      return
    }

    // Respect any manual overrides the user chose in the result dialog
    const manualResolutions =
      step.kind === MultiCommitOperationStepKind.ShowCopilotConflicts
        ? step.conflictState.manualResolutions
        : new Map<string, ManualConflictResolution>()

    this.statsStore.increment('copilotConflictResolutionAcceptedCount')
    if (manualResolutions.size > 0) {
      this.statsStore.increment('copilotConflictResolutionWithOverridesCount')
    }

    await this.applyCopilotResolutionsToDisk(
      repository,
      copilotResolutions,
      manualResolutions
    )
  }

  private async applyCopilotResolutionsToDisk(
    repository: Repository,
    resolutions: ReadonlyArray<IFileResolution>,
    manualResolutions: ReadonlyMap<string, ManualConflictResolution>
  ): Promise<void> {
    const pathsToStage: string[] = []
    for (const resolution of resolutions) {
      if (manualResolutions.has(resolution.path)) {
        continue
      }
      const absolutePath = await resolveWithin(repository.path, resolution.path)
      if (absolutePath === null) {
        log.warn(
          `Copilot resolution skipped: path outside repository: ${resolution.path}`
        )
        continue
      }
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        writeFile(absolutePath, resolution.resolvedContent, 'utf8')
      )
      pathsToStage.push(resolution.path)
    }
    if (pathsToStage.length > 0) {
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        git(
          ['add', '--', ...pathsToStage],
          repository.path,
          'copilotConflictResolution'
        )
      )
    }
  }

  /**
   * Set the global application menu.
   *
   * This is called in response to the main process emitting an event signalling
   * that the application menu has changed in some way like an item being
   * added/removed or an item having its visibility toggled.
   *
   * This method should not be called by the renderer in any other circumstance
   * than as a directly result of the main-process event.
   *
   */
  private setAppMenu(menu: IMenu): Promise<void> {
    if (this.appMenu) {
      this.appMenu = this.appMenu.withMenu(menu)
    } else {
      this.appMenu = AppMenu.fromMenu(menu)
    }

    this.emitUpdate()
    return Promise.resolve()
  }

  public _setAppMenuState(
    update: (appMenu: AppMenu) => AppMenu
  ): Promise<void> {
    if (this.appMenu) {
      this.appMenu = update(this.appMenu)
      this.emitUpdate()
    }
    return Promise.resolve()
  }

  public _setAccessKeyHighlightState(highlight: boolean): Promise<void> {
    if (this.highlightAccessKeys !== highlight) {
      this.highlightAccessKeys = highlight
      this.emitUpdate()
    }

    return Promise.resolve()
  }

  private onHookProgress = (respository: Repository) => {
    return (hookProgress: HookProgress) => {
      if (!this.isTemporaryRepositoryActive(respository)) {
        return
      }
      this.repositoryStateCache.update(respository, () => ({ hookProgress }))
      this.emitUpdate()
    }
  }

  private onHookFailure = (onAborted: () => void) => {
    return (hookName: string, terminalOutput: TerminalOutput) =>
      new Promise<'abort' | 'ignore'>(resolve => {
        this._showPopup({
          type: PopupType.HookFailed,
          hookName,
          terminalOutput,
          resolve: resolution => {
            if (resolution === 'abort') {
              onAborted()
            }
            resolve(resolution)
          },
        })
      })
  }

  public async _mergeBranch(
    repository: Repository,
    sourceBranch: Branch,
    mergeStatus: MergeTreeResult | null,
    isSquash: boolean = false
  ): Promise<void> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const { multiCommitOperationState: opState } =
      this.repositoryStateCache.get(repository)

    if (
      opState === null ||
      opState.operationDetail.kind !== MultiCommitOperationKind.Merge
    ) {
      log.error('[mergeBranch] - Not in merge operation state')
      return
    }

    this.repositoryStateCache.updateMultiCommitOperationState(
      repository,
      () => ({
        operationDetail: { ...opState.operationDetail, sourceBranch },
      })
    )

    const gitStore = this.gitStoreCache.get(repository)

    if (isSquash) {
      this.statsStore.increment('squashMergeInvokedCount')
    }

    if (mergeStatus !== null) {
      if (mergeStatus.kind === ComputedAction.Clean) {
        this.statsStore.increment('mergedWithCleanMergeHintCount')
      } else if (mergeStatus.kind === ComputedAction.Conflicts) {
        this.statsStore.increment('mergedWithConflictWarningHintCount')
      } else if (mergeStatus.kind === ComputedAction.Loading) {
        this.statsStore.increment('mergedWithLoadingHintCount')
      }
    }

    let aborted = false
    const mergeResult = await this.withTemporaryRepositoryMutationGuard(
      repository,
      () =>
        gitStore.merge(sourceBranch, {
          squash: isSquash,
          onHookFailure: this.onHookFailure(() => (aborted = true)),
        })
    )

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    if (aborted) {
      return this._refreshRepository(repository)
    }

    const { tip } = gitStore

    if (mergeResult === MergeResult.Success && tip.kind === TipState.Valid) {
      this._setBanner({
        type: BannerType.SuccessfulMerge,
        ourBranch: tip.branch.name,
        theirBranch: sourceBranch.name,
      })
      if (isSquash) {
        // This code will only run when there are no conflicts.
        // Thus recordSquashMergeSuccessful is done here and when merge finishes
        // successfully after conflicts in `dispatcher.finishConflictedMerge`.
        this.statsStore.increment('squashMergeSuccessfulCount')
      }
      this._endMultiCommitOperation(repository)
    } else if (
      mergeResult === MergeResult.AlreadyUpToDate &&
      tip.kind === TipState.Valid
    ) {
      this._setBanner({
        type: BannerType.BranchAlreadyUpToDate,
        ourBranch: tip.branch.name,
        theirBranch: sourceBranch.name,
      })
      this._endMultiCommitOperation(repository)
    }

    return this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _setConflictsResolved(repository: Repository) {
    const { multiCommitOperationState } =
      this.repositoryStateCache.get(repository)

    // the operation has already completed.
    if (multiCommitOperationState === null) {
      return
    }

    // an update is not emitted here because there is no need
    // to trigger a re-render at this point

    this.repositoryStateCache.updateMultiCommitOperationState(
      repository,
      () => ({
        userHasResolvedConflicts: true,
      })
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _rebase(
    repository: Repository,
    baseBranch: Branch,
    targetBranch: Branch
  ): Promise<RebaseResult> {
    const progressCallback =
      this.getMultiCommitOperationProgressCallBack(repository)
    const gitStore = this.gitStoreCache.get(repository)
    const result = await gitStore.performFailableOperation(
      () =>
        this.withTemporaryRepositoryMutationGuard(repository, () =>
          rebase(repository, baseBranch, targetBranch, progressCallback)
        ),
      {
        retryAction: {
          type: RetryActionType.Rebase,
          repository,
          baseBranch,
          targetBranch,
        },
      }
    )

    return result || RebaseResult.Error
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _abortRebase(repository: Repository) {
    const gitStore = this.gitStoreCache.get(repository)
    return await gitStore.performFailableOperation(() =>
      this.withTemporaryRepositoryMutationGuard(repository, () =>
        abortRebase(repository)
      )
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _continueRebase(
    repository: Repository,
    workingDirectory: WorkingDirectoryStatus,
    manualResolutions: ReadonlyMap<string, ManualConflictResolution>
  ): Promise<RebaseResult> {
    const progressCallback =
      this.getMultiCommitOperationProgressCallBack(repository)

    const gitStore = this.gitStoreCache.get(repository)
    const result = await gitStore.performFailableOperation(() =>
      this.withTemporaryRepositoryMutationGuard(repository, () =>
        continueRebase(repository, workingDirectory.files, manualResolutions, {
          progressCallback,
        })
      )
    )

    return result || RebaseResult.Error
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _abortMerge(repository: Repository): Promise<void> {
    const gitStore = this.gitStoreCache.get(repository)
    return await gitStore.performFailableOperation(() =>
      this.withTemporaryRepositoryMutationGuard(repository, () =>
        abortMerge(repository)
      )
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _abortSquashMerge(repository: Repository): Promise<void> {
    const gitStore = this.gitStoreCache.get(repository)
    const {
      branchesState,
      changesState: { workingDirectory },
    } = this.repositoryStateCache.get(repository)

    const commitResult = await this._finishConflictedMerge(
      repository,
      workingDirectory,
      new Map<string, ManualConflictResolution>()
    )

    // By committing, we clear out the SQUASH_MSG (and anything else git would
    // choose to store for the --squash merge operation)
    if (commitResult === undefined) {
      log.error(
        `[_abortSquashMerge] - Could not abort squash merge - commiting squash msg failed`
      )
      return
    }

    // Since we have not reloaded the status, this tip is the tip before the
    // squash commit above.
    const { tip } = branchesState
    if (tip.kind !== TipState.Valid) {
      log.error(
        `[_abortSquashMerge] - Could not abort squash merge - tip was invalid`
      )
      return
    }

    await gitStore.performFailableOperation(() =>
      this.withTemporaryRepositoryMutationGuard(repository, () =>
        reset(repository, GitResetMode.Hard, tip.branch.tip.sha)
      )
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`.
   *  This method only used in the Merge Conflicts dialog flow,
   *  not committing a conflicted merge via the "Changes" pane.
   */
  public async _finishConflictedMerge(
    repository: Repository,
    workingDirectory: WorkingDirectoryStatus,
    manualResolutions: Map<string, ManualConflictResolution>
  ): Promise<string | undefined> {
    /**
     *  The assumption made here is that all other files that were part of this merge
     *  have already been staged by git automatically (or manually by the user via CLI).
     *  When the user executes a merge and there are conflicts,
     *  git stages all files that are part of the merge that _don't_ have conflicts
     *  This means that we only need to stage the conflicted files
     *  (whether they are manual or markered) to get all changes related to
     *  this merge staged. This also means that any uncommitted changes in the index
     *  that were in place before the merge was started will _not_ be included, unless
     *  the user stages them manually via CLI.
     *
     *  Its also worth noting this method only used in the Merge Conflicts dialog flow, not committing a conflicted merge via the "Changes" pane.
     *
     *  *TLDR we only stage conflicts here because git will have already staged the rest of the changes related to this merge.*
     */
    const conflictedFiles = workingDirectory.files.filter(f => {
      return f.status.kind === AppFileStatusKind.Conflicted
    })
    const gitStore = this.gitStoreCache.get(repository)
    return await gitStore.performFailableOperation(() =>
      this.withTemporaryRepositoryMutationGuard(repository, () =>
        createMergeCommit(repository, conflictedFiles, manualResolutions)
      )
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _setRemoteURL(
    repository: Repository,
    name: string,
    url: string
  ): Promise<void> {
    const gitStore = this.gitStoreCache.get(repository)
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      gitStore.setRemoteURL(name, url)
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _addRemote(
    repository: Repository,
    name: string,
    url: string
  ): Promise<void> {
    const gitStore = this.gitStoreCache.get(repository)
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      gitStore.addRemote(name, url)
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _removeRemote(
    repository: Repository,
    name: string
  ): Promise<void> {
    const gitStore = this.gitStoreCache.get(repository)
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      gitStore.removeRemote(name)
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _applyRemoteManagementPlan(
    repository: Repository,
    plan: IRemoteManagementPlan,
    options: IRemoteManagementApplyOptions
  ): Promise<IRemoteManagementSnapshot> {
    const gitStore = this.gitStoreCache.get(repository)
    return this.withTemporaryRepositoryMutationGuard(repository, () =>
      gitStore.applyRemoteManagementPlan(plan, options)
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _openShell(path: string) {
    this.statsStore.increment('openShellCount')
    const { useCustomShell, customShell } = this.getState()

    try {
      if (useCustomShell && customShell) {
        await launchCustomShell(customShell, path, error =>
          this._pushError(error)
        )
      } else {
        const match = await findShellOrDefault(this.selectedShell)
        await launchShell(match, path, error => this._pushError(error))
      }
    } catch (error) {
      this.emitError(error)
    }
  }

  /** Takes a URL and opens it using the system default application */
  public _openInBrowser(url: string): Promise<boolean> {
    return shell.openExternal(url)
  }

  public async _editGlobalGitConfig() {
    await getGlobalConfigPath()
      .then(p => this._openInExternalEditor(p))
      .catch(e => log.error('Could not open global Git config for editing', e))
  }

  public async _getBranchNamePresets(
    repositoryPath: string
  ): Promise<ReadonlyArray<IBranchNamePreset>> {
    if (this.branchPresetScript?.path.trim() === '') {
      return []
    }
    if (this.branchPresetScript === null) {
      return []
    }

    const stdout = await launchAndReturnStdout(
      repositoryPath,
      this.branchPresetScript
    )
    return parseBranchNamePresets(stdout)
  }

  /** Open a path to a repository or file using the user's configured editor */
  public async _openInExternalEditor(
    fullPath: string,
    repository: Repository | null = null
  ): Promise<void> {
    const globalSettings = this.getState()
    const { selectedExternalEditor, useCustomEditor, customEditor } =
      repository?.customEditorOverride ?? globalSettings

    try {
      if (useCustomEditor && customEditor) {
        await launchCustomExternalEditor(fullPath, customEditor)
      } else {
        const match = await findEditorOrDefault(selectedExternalEditor)
        if (match === null) {
          this.emitError(
            new ExternalEditorError(
              `No suitable editors installed for GitHub Desktop to launch. Install ${suggestedExternalEditor.name} for your platform and restart GitHub Desktop to try again.`,
              { suggestDefaultEditor: true }
            )
          )
          return
        }

        await launchExternalEditor(fullPath, match)
      }
    } catch (error) {
      this.emitError(error)
    }
  }

  /** Open a path using a selected editor without changing preferences. */
  public async _openInSelectedExternalEditor(
    fullPath: string,
    selectedEditor: string | null,
    customEditor: ICustomIntegration | null
  ): Promise<void> {
    try {
      if (customEditor && customEditor.path) {
        await launchCustomExternalEditor(fullPath, customEditor)
        return
      }

      if (!selectedEditor) {
        return
      }

      const match = await findEditorOrDefault(selectedEditor)
      if (match === null) {
        this.emitError(
          new ExternalEditorError(
            `No suitable editors installed for GitHub Desktop to launch. Install ${suggestedExternalEditor.name} for your platform and restart GitHub Desktop to try again.`,
            { suggestDefaultEditor: true }
          )
        )
        return
      }

      await launchExternalEditor(fullPath, match)
    } catch (error) {
      this.emitError(error)
    }
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _saveGitIgnore(
    repository: Repository,
    text: string
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      saveGitIgnore(repository, text)
    )
    return this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _getSubmodules(
    repository: Repository
  ): Promise<ReadonlyArray<IManagedSubmodule>> {
    return getSubmodules(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _openSubmoduleAsRepository(
    parentRepository: Repository,
    submodule: IManagedSubmodule
  ): Promise<SubmoduleRepository> {
    // Repository metadata writes (such as resolving a legacy gitDir) replace
    // the persisted model instance without changing its stable id or hash.
    // A mounted manager can therefore hold the previous instance while it is
    // still showing that exact selected workspace. Rebind that one harmless
    // identity refresh before applying the strict selection boundary below.
    if (!isSubmoduleRepository(parentRepository)) {
      const persistedParent =
        this.repositories.find(
          repository =>
            repository.constructor === parentRepository.constructor &&
            repository.id === parentRepository.id
        ) ?? null
      if (persistedParent === null) {
        throw new Error('The parent repository is no longer available.')
      }

      const selectedRepository = this.selectedRepository
      const selectedIsEquivalentPersistedParent =
        selectedRepository instanceof Repository &&
        !isSubmoduleRepository(selectedRepository) &&
        selectedRepository.constructor === persistedParent.constructor &&
        selectedRepository.id === persistedParent.id
      if (!selectedIsEquivalentPersistedParent) {
        throw new Error(
          'The repository selection changed before the submodule could be opened.'
        )
      }

      if (selectedRepository !== persistedParent) {
        await this._selectRepository(persistedParent, false)
      }
      parentRepository = persistedParent
    }

    if (this.selectedRepository !== parentRepository) {
      throw new Error(
        'The repository selection changed before the submodule could be opened.'
      )
    }

    const persistedParent = isSubmoduleRepository(parentRepository)
      ? this.getCurrentSubmoduleParent(parentRepository)
      : this.repositories.find(repository => repository === parentRepository) ??
        null
    if (persistedParent === null) {
      throw new Error('The parent repository is no longer available.')
    }

    const repository = await createSubmoduleRepository(
      parentRepository,
      submodule
    )
    if (
      this.selectedRepository !== parentRepository ||
      (isSubmoduleRepository(parentRepository)
        ? this.getCurrentSubmoduleParent(parentRepository) !== persistedParent
        : !this.repositories.includes(parentRepository))
    ) {
      throw new Error(
        'The repository selection changed before the submodule could be opened.'
      )
    }

    await this._selectRepository(repository, false, true)
    if (this.selectedRepository !== repository) {
      throw new Error(
        'The repository selection changed while the submodule was opening.'
      )
    }

    return repository
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _returnToParentRepository(
    repository: SubmoduleRepository
  ): Promise<Repository> {
    if (this.selectedRepository !== repository) {
      throw new Error('The temporary submodule is no longer selected.')
    }

    const parentRepository = this.getCurrentSubmoduleParent(repository)
    if (parentRepository === null) {
      throw new Error(
        'The parent repository for this temporary submodule is no longer available.'
      )
    }

    await this._selectRepository(parentRepository, false)
    if (this.selectedRepository !== parentRepository) {
      throw new Error(
        'The repository selection changed while returning to the parent.'
      )
    }

    return parentRepository
  }

  private requireCheapLfsAccount(repository: Repository): Account {
    const account = getGitHubReleasesAccount(repository, this.accounts)
    if (account === null) {
      throw new GitHubReleasesError(
        'authentication',
        'Sign in with the account selected for this repository to use cheap LFS.'
      )
    }
    return account
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _getReleaseByTag(
    repository: Repository,
    tag: string
  ): Promise<IGitHubRelease | null> {
    return this.githubReleasesStore.getReleaseByTag(repository, tag)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _pinFileToRelease(
    repository: Repository,
    options: ICheapLfsPinOptions,
    signal?: AbortSignal,
    onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
  ): Promise<ICheapLfsPinResult> {
    const account = this.requireCheapLfsAccount(repository)
    const result = await this.withTemporaryRepositoryMutationGuard(
      repository,
      () =>
        pinFileToRelease(
          this.githubReleasesStore,
          repository,
          account,
          options,
          signal,
          onProgress
        )
    )
    await this._refreshRepository(repository)
    return result
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _materializeCheapLfsPointer(
    repository: Repository,
    trackedRelativePath: string,
    signal?: AbortSignal,
    onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
  ): Promise<ICheapLfsMaterializeResult> {
    const account = this.requireCheapLfsAccount(repository)
    const result = await this.withTemporaryRepositoryMutationGuard(
      repository,
      () =>
        materializePointer(
          this.githubReleasesStore,
          repository,
          account,
          trackedRelativePath,
          signal,
          onProgress
        )
    )
    await this._refreshRepository(repository)
    return result
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _listCheapLfsPointers(
    repository: Repository
  ): Promise<ReadonlyArray<ICheapLfsPointerEntry>> {
    return listCheapLfsPointers(repository)
  }

  /**
   * Detect and download committed cheap-LFS pointers back into their real bytes
   * after a clone, pull, fetch, or repository open. Runs only when the per-repo
   * preference is enabled (default on) and a Releases-capable account is
   * selected; skips silently otherwise. The batch is cancelable, reports
   * cumulative progress that survives navigation (the run is keyed by repository
   * id), and posts a summary notification. Fire-and-forget: this never throws.
   *
   * @param options.requireSelected  Re-check `selectedRepository` before running
   *   (the repository-open detect point is re-entrant and may fire after the
   *   selection has already moved on).
   */
  public async maybeAutoMaterializeCheapLfs(
    repository: Repository,
    options: { readonly requireSelected?: boolean } = {}
  ): Promise<void> {
    try {
      if (isSubmoduleRepository(repository)) {
        return
      }
      const prefs = repository.buildRunPreferences ?? defaultBuildRunPreferences
      const account = getGitHubReleasesAccount(repository, this.accounts)
      if (
        !shouldAutoMaterializeCheapLfs(
          prefs.autoMaterializeCheapLfs !== false,
          account
        )
      ) {
        return
      }
      // Re-entrancy guard: never run two batches for the same repository at once.
      if (this.cheapLfsMaterializeControllers.has(repository.id)) {
        return
      }
      const entries = await listCheapLfsPointers(repository)
      if (entries.length === 0) {
        return
      }
      if (options.requireSelected && this.selectedRepository !== repository) {
        return
      }
      await this.runCheapLfsMaterialize(repository, entries)
    } catch (error) {
      log.error('Automatic cheap LFS materialize failed', error)
    }
  }

  /**
   * Materialize an explicit set of pointers under one shared, cancelable abort
   * controller keyed by repository id (so a concurrent auto-run and this manual
   * run cannot collide), refresh the repository once at the end, and post a
   * summary notification. Shared by the automatic detector and the "Materialize
   * all" control in the Large files & storage panel.
   */
  private async runCheapLfsMaterialize(
    repository: Repository,
    entries: ReadonlyArray<ICheapLfsPointerEntry>
  ): Promise<void> {
    if (this.cheapLfsMaterializeControllers.has(repository.id)) {
      return
    }
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const controller = new AbortController()
    this.cheapLfsMaterializeControllers.set(repository.id, controller)
    try {
      const summary = await materializeCheapLfsPointers(
        entries,
        (relativePath, signal, onProgress) =>
          this.withTemporaryRepositoryMutationGuard(repository, () =>
            materializePointer(
              this.githubReleasesStore,
              repository,
              this.requireCheapLfsAccount(repository),
              relativePath,
              signal,
              onProgress
            )
          ),
        controller.signal
      )
      await this._refreshRepository(repository)
      if (this.isTemporaryRepositoryActive(repository)) {
        this.postCheapLfsMaterializeNotification(repository, summary)
      }
    } finally {
      if (
        this.cheapLfsMaterializeControllers.get(repository.id) === controller
      ) {
        this.cheapLfsMaterializeControllers.delete(repository.id)
      }
    }
  }

  /** Post a notification summarising a batch materialize's count and bytes. */
  private postCheapLfsMaterializeNotification(
    repository: Repository,
    summary: {
      readonly materialized: ReadonlyArray<ICheapLfsMaterializeResult>
      readonly failures: ReadonlyArray<{ readonly relativePath: string }>
      readonly canceled: boolean
    }
  ): void {
    if (summary.materialized.length === 0 && summary.failures.length === 0) {
      return
    }
    const bytes = summary.materialized.reduce((sum, r) => sum + r.bytes, 0)
    const files = summary.materialized.length
    const failed = summary.failures.length
    const megabytes = (bytes / (1024 * 1024)).toFixed(1)
    const canceledSuffix = summary.canceled ? ' (canceled)' : ''
    const failedSuffix =
      failed > 0
        ? ` ${failed} ${
            failed === 1 ? 'file' : 'files'
          } failed and were left as pointers.`
        : ''
    this.postNotification({
      kind: 'cheap-lfs',
      title: __DARWIN__ ? 'Large Files Downloaded' : 'Large files downloaded',
      body: `Materialized ${files} ${
        files === 1 ? 'file' : 'files'
      } (${megabytes} MiB)${canceledSuffix} in ${
        repository.name
      }.${failedSuffix}`,
      repositoryId: repository.id,
      action: { kind: 'open-repository', repositoryId: repository.id },
    })
  }

  /**
   * This shouldn't be called directly. See `Dispatcher`.
   *
   * Materialize every committed pointer in the working tree as one cancelable
   * batch — the manual "Materialize all" control. Returns the batch summary so
   * the panel can report the result.
   */
  public async _materializeAllCheapLfsPointers(
    repository: Repository
  ): Promise<void> {
    const entries = await listCheapLfsPointers(repository)
    if (entries.length === 0) {
      return
    }
    await this.runCheapLfsMaterialize(repository, entries)
  }

  /**
   * This shouldn't be called directly. See `Dispatcher`.
   *
   * Cancel an in-flight automatic (or manual) cheap-LFS materialize for a
   * repository. A no-op when nothing is running.
   */
  public _cancelAutoMaterializeCheapLfs(repository: Repository): void {
    this.cheapLfsMaterializeControllers.get(repository.id)?.abort()
  }

  /**
   * Pin every selected file over the push-size threshold to a GitHub Release
   * before a commit, replacing it in the working tree with a small pointer.
   * Runs when the per-repo preference is enabled (default on) — or when
   * `forceAutoPin` overrides a disabled preference (the oversized-files
   * warning's "Pin to release" action) — and a Releases-capable account is
   * selected. The FIRST pin failure re-throws so `_commitIncludedChanges` can
   * abort the commit without a half-pinned tree; returns the files it pinned
   * otherwise (empty when none qualified).
   */
  private autoPinLargeFilesBeforeCommit(
    repository: Repository,
    selectedFiles: ReadonlyArray<WorkingDirectoryFileChange>,
    forceAutoPin: boolean = false
  ): Promise<ReadonlyArray<ICheapLfsAutoPinnedFile>> {
    if (isSubmoduleRepository(repository)) {
      return Promise.resolve([])
    }
    const prefs = repository.buildRunPreferences ?? defaultBuildRunPreferences
    const availability = getGitHubReleasesAvailability(
      repository,
      this.accounts
    )
    if (
      !shouldAutoPinLargeFilesOnCommit(
        forceAutoPin || prefs.autoPinLargeFilesOnCommit !== false,
        availability
      )
    ) {
      return Promise.resolve([])
    }
    return autoPinLargeFilesForCommit(
      repository,
      selectedFiles.map(file => file.path),
      CheapLfsPinThresholdBytes,
      {
        statSize: defaultCheapLfsFileSystem.statSize,
        readPointerText: defaultCheapLfsFileSystem.readPointerText,
        pin: (target, signal, onProgress) =>
          pinFileToRelease(
            this.githubReleasesStore,
            repository,
            this.requireCheapLfsAccount(repository),
            {
              absoluteFilePath: target.absolutePath,
              trackedRelativePath: target.relativePath,
              // The manual pin control defaults to this tag too, so automatic
              // and manual pins share one release per repository.
              releaseTag: 'assets',
            },
            signal,
            onProgress
          ),
      },
      undefined,
      progress => {
        if (!this.isTemporaryRepositoryActive(repository)) {
          return
        }
        const state = this.repositoryStateCache.get(repository)
        if (!state.isCommitting) {
          return
        }
        this.repositoryStateCache.update(repository, () => ({
          commitOperationPhase: { kind: 'cheap-lfs', progress },
        }))
        this.emitUpdate()
      }
    )
  }

  /** Post a notification listing the files auto-pinned before a commit. */
  private postCheapLfsPinNotification(
    repository: Repository,
    pinned: ReadonlyArray<ICheapLfsAutoPinnedFile>
  ): void {
    if (pinned.length === 0) {
      return
    }
    const bytes = pinned.reduce((sum, file) => sum + file.sizeInBytes, 0)
    const megabytes = (bytes / (1024 * 1024)).toFixed(1)
    const names = pinned.map(file => file.relativePath).join(', ')
    this.postNotification({
      kind: 'cheap-lfs',
      title: __DARWIN__ ? 'Large Files Pinned' : 'Large files pinned',
      body: `Pinned ${pinned.length} ${
        pinned.length === 1 ? 'file' : 'files'
      } (${megabytes} MiB) to a release before committing: ${names}.`,
      repositoryId: repository.id,
      action: { kind: 'open-repository', repositoryId: repository.id },
    })
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _addSubmodule(
    repository: Repository,
    url: string,
    path: string,
    branch?: string | null,
    options?: IAddSubmoduleOptions
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      addSubmodule(repository, url, path, branch, options)
    )
    await this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _updateSubmodules(
    repository: Repository,
    paths?: ReadonlyArray<string>,
    onProgress?: (line: string, percent: number) => void
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      updateSubmodules(repository, paths, onProgress)
    )
    await this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _syncSubmodules(
    repository: Repository,
    paths?: ReadonlyArray<string>
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      syncSubmodules(repository, paths)
    )
    await this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _removeSubmodule(
    repository: Repository,
    path: string,
    name?: string
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      removeSubmodule(repository, path, name)
    )
    await this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _setSubmoduleUrl(
    repository: Repository,
    path: string,
    url: string
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      setSubmoduleUrl(repository, path, url)
    )
    await this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _setSubmoduleBranch(
    repository: Repository,
    path: string,
    branch: string | null
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      setSubmoduleBranch(repository, path, branch)
    )
    await this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _setSubmoduleConfigKey(
    repository: Repository,
    name: string,
    key: SubmoduleConfigKey,
    value: string | null
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      setSubmoduleConfigKey(repository, name, key, value)
    )
    await this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _initSubmodule(
    repository: Repository,
    path: string
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      initSubmodule(repository, path)
    )
    await this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _deinitSubmodule(
    repository: Repository,
    path: string,
    force: boolean
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      deinitSubmodule(repository, path, force)
    )
    await this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _isSubtreeAvailable(): Promise<boolean> {
    return isSubtreeAvailable()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _getSubtrees(
    repository: Repository
  ): Promise<ReadonlyArray<IManagedSubtree>> {
    return discoverSubtrees(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _addSubtree(
    repository: Repository,
    prefix: string,
    source: string,
    ref: string,
    options?: ISubtreeMergeOptions
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      addSubtree(repository, prefix, source, ref, options)
    )
    await this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _pullSubtree(
    repository: Repository,
    prefix: string,
    source: string,
    ref: string,
    options?: ISubtreeMergeOptions
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      pullSubtree(repository, prefix, source, ref, options)
    )
    await this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _pushSubtree(
    repository: Repository,
    prefix: string,
    source: string,
    ref: string,
    options?: ISubtreeRemoteOptions
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      pushSubtree(repository, prefix, source, ref, options)
    )
    await this._refreshRepository(repository)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _splitSubtree(
    repository: Repository,
    prefix: string,
    options?: ISubtreeSplitOptions
  ): Promise<string> {
    const sha = await this.withTemporaryRepositoryMutationGuard(
      repository,
      () => splitSubtree(repository, prefix, options)
    )
    await this._refreshRepository(repository)
    return sha
  }

  /** Set whether the user has opted out of stats reporting. */
  public async setStatsOptOut(
    optOut: boolean,
    userViewedPrompt: boolean
  ): Promise<void> {
    await this.statsStore.setOptOut(optOut, userViewedPrompt)

    this.emitUpdate()
  }

  public _setUseExternalCredentialHelper(value: boolean) {
    setUseExternalCredentialHelper(value)
    this.useExternalCredentialHelper = value
    this.emitUpdate()
  }

  public _setAskToMoveToApplicationsFolderSetting(
    value: boolean
  ): Promise<void> {
    this.askToMoveToApplicationsFolderSetting = value

    setBoolean(askToMoveToApplicationsFolderKey, value)
    this.emitUpdate()

    return Promise.resolve()
  }

  public _setConfirmRepositoryRemovalSetting(
    confirmRepoRemoval: boolean
  ): Promise<void> {
    this.askForConfirmationOnRepositoryRemoval = confirmRepoRemoval
    setBoolean(confirmRepoRemovalKey, confirmRepoRemoval)

    this.updateMenuLabelsForSelectedRepository()

    this.emitUpdate()

    return Promise.resolve()
  }

  public _setConfirmDiscardChangesSetting(value: boolean): Promise<void> {
    this.confirmDiscardChanges = value

    setBoolean(confirmDiscardChangesKey, value)
    this.emitUpdate()

    return Promise.resolve()
  }

  public _setConfirmDiscardChangesPermanentlySetting(
    value: boolean
  ): Promise<void> {
    this.confirmDiscardChangesPermanently = value

    setBoolean(confirmDiscardChangesPermanentlyKey, value)
    this.emitUpdate()

    return Promise.resolve()
  }

  public _setConfirmDiscardStashSetting(value: boolean): Promise<void> {
    this.confirmDiscardStash = value

    setBoolean(confirmDiscardStashKey, value)
    this.emitUpdate()

    return Promise.resolve()
  }

  public _setConfirmCheckoutCommitSetting(value: boolean): Promise<void> {
    this.confirmCheckoutCommit = value

    setBoolean(confirmCheckoutCommitKey, value)
    this.emitUpdate()

    return Promise.resolve()
  }

  public _setConfirmForcePushSetting(value: boolean): Promise<void> {
    this.askForConfirmationOnForcePush = value
    setBoolean(confirmForcePushKey, value)

    this.updateMenuLabelsForSelectedRepository()

    this.emitUpdate()

    return Promise.resolve()
  }

  public _setConfirmUndoCommitSetting(value: boolean): Promise<void> {
    this.confirmUndoCommit = value
    setBoolean(confirmUndoCommitKey, value)

    this.emitUpdate()

    return Promise.resolve()
  }

  public _setConfirmCommitFilteredChanges(value: boolean): Promise<void> {
    this.confirmCommitFilteredChanges = value
    setBoolean(confirmCommitFilteredChangesKey, value)

    this.emitUpdate()

    return Promise.resolve()
  }

  public _setConfirmCommitMessageOverrideSetting(
    value: boolean
  ): Promise<void> {
    this.confirmCommitMessageOverride = value
    setBoolean(confirmCommitMessageOverrideKey, value)

    this.emitUpdate()

    return Promise.resolve()
  }

  public _setConfirmWorktreeRemovalSetting(value: boolean): Promise<void> {
    this.confirmWorktreeRemoval = value
    setBoolean(confirmWorktreeRemovalKey, value)

    this.emitUpdate()

    return Promise.resolve()
  }

  public _setAutoSwitchAccountToRepositoryOwnerSetting(
    value: boolean
  ): Promise<void> {
    this.autoSwitchAccountToRepositoryOwner = value
    setBoolean(autoSwitchAccountToRepositoryOwnerKey, value)

    this.emitUpdate()

    return Promise.resolve()
  }

  public _setUncommittedChangesStrategySetting(
    value: UncommittedChangesStrategy
  ): Promise<void> {
    this.uncommittedChangesStrategy = value

    localStorage.setItem(uncommittedChangesStrategyKey, value)

    this.emitUpdate()
    return Promise.resolve()
  }

  public _setExternalEditor(selectedEditor: string) {
    const promise = this.updateSelectedExternalEditor(selectedEditor)
    localStorage.setItem(externalEditorKey, selectedEditor)
    this.emitUpdate()

    this.updateMenuLabelsForSelectedRepository()
    return promise
  }

  public _setShell(shell: Shell): Promise<void> {
    this.selectedShell = shell
    localStorage.setItem(shellKey, shell)
    this.emitUpdate()

    this.updateMenuLabelsForSelectedRepository()

    return Promise.resolve()
  }

  public _changeImageDiffType(type: ImageDiffType): Promise<void> {
    this.imageDiffType = type
    localStorage.setItem(imageDiffTypeKey, JSON.stringify(this.imageDiffType))
    this.emitUpdate()

    return Promise.resolve()
  }

  public _setHideWhitespaceInChangesDiff(
    hideWhitespaceInDiff: boolean,
    repository: Repository
  ): Promise<void> {
    setBoolean(hideWhitespaceInChangesDiffKey, hideWhitespaceInDiff)
    this.hideWhitespaceInChangesDiff = hideWhitespaceInDiff

    return this.refreshChangesSection(repository, {
      includingStatus: true,
      clearPartialState: true,
    })
  }

  public _setHideWhitespaceInHistoryDiff(
    hideWhitespaceInDiff: boolean,
    repository: Repository,
    file: CommittedFileChange | null
  ): Promise<void> {
    setBoolean(hideWhitespaceInHistoryDiffKey, hideWhitespaceInDiff)
    this.hideWhitespaceInHistoryDiff = hideWhitespaceInDiff

    if (file === null) {
      return this.updateChangesWorkingDirectoryDiff(repository)
    } else {
      return this._changeFileSelection(repository, file)
    }
  }

  public _setHideWhitespaceInPullRequestDiff(
    hideWhitespaceInDiff: boolean,
    repository: Repository,
    file: CommittedFileChange | null
  ) {
    setBoolean(hideWhitespaceInPullRequestDiffKey, hideWhitespaceInDiff)
    this.hideWhitespaceInPullRequestDiff = hideWhitespaceInDiff

    if (file !== null) {
      this._changePullRequestFileSelection(repository, file)
    }
  }

  public _setShowSideBySideDiff(showSideBySideDiff: boolean) {
    if (showSideBySideDiff !== this.showSideBySideDiff) {
      setShowSideBySideDiff(showSideBySideDiff)
      this.showSideBySideDiff = showSideBySideDiff
      this.statsStore.increment('diffModeChangeCount')
      this.emitUpdate()
    }
  }

  public _setUpdateBannerVisibility(visibility: boolean) {
    this.isUpdateAvailableBannerVisible = visibility

    this.emitUpdate()
  }

  public _setUpdateShowCaseVisibility(visibility: boolean) {
    this.isUpdateShowcaseVisible = visibility

    this.emitUpdate()
  }

  public _setBanner(state: Banner) {
    this.currentBanner = state
    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _clearBanner(bannerType?: BannerType) {
    const { currentBanner } = this
    if (currentBanner === null) {
      return
    }

    if (bannerType !== undefined && currentBanner.type !== bannerType) {
      return
    }

    this.currentBanner = null
    this.emitUpdate()
  }

  public _reportStats() {
    return this.statsStore.reportStats(this.accounts, this.repositories)
  }

  public _recordLaunchStats(stats: ILaunchStats): Promise<void> {
    return this.statsStore.recordLaunchStats(stats)
  }

  public async _appendIgnoreRule(
    repository: Repository,
    pattern: string | string[]
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      appendIgnoreRule(repository, pattern)
    )
    return this._refreshRepository(repository)
  }

  public async _appendIgnoreFile(
    repository: Repository,
    filePath: string | string[]
  ): Promise<void> {
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      appendIgnoreFile(repository, filePath)
    )
    return this._refreshRepository(repository)
  }

  public _resolveOAuthRequest(action: IOAuthAction) {
    return this.signInStore.resolveOAuthRequest(action)
  }

  public _resetSignInState(): Promise<void> {
    this.signInStore.reset()
    return Promise.resolve()
  }

  public _beginDotComSignIn(resultCallback?: (result: SignInResult) => void) {
    return this.signInStore.beginDotComSignIn(resultCallback)
  }

  public _beginEnterpriseSignIn(
    resultCallback?: (result: SignInResult) => void
  ) {
    return this.signInStore.beginEnterpriseSignIn(resultCallback)
  }

  public _authenticateProviderWithToken(
    provider: 'gitlab' | 'bitbucket',
    endpoint: string,
    token: string
  ) {
    return this.signInStore.authenticateProviderWithToken(
      provider,
      endpoint,
      token
    )
  }

  public _setSignInEndpoint(url: string): Promise<void> {
    return this.signInStore.setEndpoint(url)
  }

  public _requestBrowserAuthentication() {
    this.signInStore.authenticateWithBrowser()
  }

  public async _setAppFocusState(isFocused: boolean): Promise<void> {
    if (this.appIsFocused !== isFocused) {
      this.appIsFocused = isFocused
      this.emitUpdate()
    }

    if (this.appIsFocused) {
      this.repositoryIndicatorUpdater.resume()
      if (this.selectedRepository instanceof Repository) {
        this.startPullRequestUpdater(this.selectedRepository)
        // if we're in the tutorial and we don't have an editor yet, check for one!
        if (this.currentOnboardingTutorialStep === TutorialStep.PickEditor) {
          await this._resolveCurrentEditor()
        }
      }
    } else {
      this.repositoryIndicatorUpdater.pause()
      this.stopPullRequestUpdater()
    }
  }

  /**
   * Start an Open in Desktop flow. This will return a new promise which will
   * resolve when `_completeOpenInDesktop` is called.
   */
  public _startOpenInDesktop(fn: () => void): Promise<Repository | null> {
    const p = new Promise<Repository | null>(
      resolve => (this.resolveOpenInDesktop = resolve)
    )
    fn()
    return p
  }

  /**
   * Complete any active Open in Desktop flow with the repository returned by
   * the given function.
   */
  public async _completeOpenInDesktop(
    fn: () => Promise<Repository | null>
  ): Promise<Repository | null> {
    const resolve = this.resolveOpenInDesktop
    this.resolveOpenInDesktop = null

    const result = await fn()
    if (resolve) {
      resolve(result)
    }

    return result
  }

  public async _removeAccount(account: Account) {
    log.info(
      `[AppStore] removing account ${account.login} (${account.name}) from store`
    )
    await this.accountsStore.removeAccount(account)
    await deleteToken(account)
  }

  /** Make the given signed-in account the active identity. */
  public async _promoteAccount(account: Account) {
    log.info(
      `[AppStore] promoting account ${account.login} to the active identity`
    )
    await this.accountsStore.promoteAccount(account)
  }

  private async _addAccount(account: Account): Promise<void> {
    log.info(
      `[AppStore] adding account ${account.login} (${account.name}) to store`
    )
    const storedAccount = await this.accountsStore.addAccount(account)

    // If we're in the welcome flow and a user signs in we want to trigger
    // a refresh of the repositories available for cloning straight away
    // in order to have the list of repositories ready for them when they
    // get to the blankslate.
    if (this.showWelcomeFlow && storedAccount !== null) {
      this.apiRepositoriesStore.loadAll(storedAccount)
    }
  }

  public _updateRepositoryMissing(
    repository: Repository,
    missing: boolean
  ): Promise<Repository> {
    return this.repositoriesStore.updateRepositoryMissing(repository, missing)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _updateRepositoryWorkflowPreferences(
    repository: Repository,
    workflowPreferences: WorkflowPreferences
  ): Promise<void> {
    await this.repositoriesStore.updateRepositoryWorkflowPreferences(
      repository,
      workflowPreferences
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _updateRepositoryBuildRunPreferences(
    repository: Repository,
    buildRunPreferences: IBuildRunPreferences
  ): Promise<void> {
    await this.repositoriesStore.updateRepositoryBuildRunPreferences(
      repository,
      buildRunPreferences
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _updateRepositoryAccount(
    repository: Repository,
    accountKey: string | null
  ): Promise<Repository> {
    const updatedRepository =
      await this.repositoriesStore.updateRepositoryAccount(
        repository,
        accountKey
      )

    // Account binding participates in Repository.hash. Rekey the shared state
    // so the rebound identity keeps the current surface and operation locks,
    // while older operations can still settle through their original identity.
    this.repositoryStateCache.rekeyStateForAccountBinding(
      repository,
      updatedRepository
    )

    return updatedRepository
  }

  /**
   * Add a tutorial repository.
   *
   * This method differs from the `_addRepositories` method in that it
   * requires that the repository has been created on the remote and
   * set up to track it. Given that tutorial repositories are created
   * from the no-repositories blank slate it shouldn't be possible for
   * another repository with the same path to exist in the repositories
   * table but in case that hangs in the future this method will set
   * the tutorial flag on the existing repository at the given path.
   */
  public async _addTutorialRepository(
    path: string,
    endpoint: string,
    apiRepository: IAPIFullRepository
  ) {
    const type = await getRepositoryType(path)
    if (type.kind === 'regular') {
      const validatedPath = type.topLevelWorkingDirectory
      log.info(
        `[AppStore] adding tutorial repository at ${validatedPath} to store`
      )

      await this.repositoriesStore.addTutorialRepository(
        validatedPath,
        endpoint,
        apiRepository,
        type.gitDir
      )
      this.tutorialAssessor.onNewTutorialRepository()
    } else {
      const error = new Error(`${path} isn't a git repository.`)
      this.emitError(error)
    }
  }

  public async _addRepositories(
    paths: ReadonlyArray<string>,
    accountKeysByPath: ReadonlyMap<string, string> = new Map()
  ): Promise<ReadonlyArray<Repository>> {
    const addedRepositories = new Array<Repository>()
    const lfsRepositories = new Array<Repository>()
    const invalidPaths = new Array<string>()

    for (const path of paths) {
      const repositoryType = await getRepositoryType(path).catch(e => {
        log.error('Could not determine repository type', e)
        return { kind: 'missing' } as RepositoryType
      })

      if (repositoryType.kind === 'unsafe') {
        const repository = await this.repositoriesStore.addRepository(
          path,
          undefined,
          { missing: true }
        )

        addedRepositories.push(repository)
        continue
      }

      if (repositoryType.kind === 'regular') {
        const validatedPath = repositoryType.topLevelWorkingDirectory
        log.info(`[AppStore] adding repository at ${validatedPath} to store`)

        const repositories = this.repositories
        const existing = matchExistingRepository(repositories, validatedPath)

        // We don't have to worry about repositoryWithRefreshedGitHubRepository
        // and isUsingLFS if the repo already exists in the app.
        if (existing !== undefined) {
          addedRepositories.push(existing)
          continue
        }

        const addedRepo = await this.repositoriesStore.addRepository(
          validatedPath,
          repositoryType.gitDir,
          {
            accountKey:
              accountKeysByPath.get(path) ??
              accountKeysByPath.get(validatedPath) ??
              null,
          }
        )

        // initialize the remotes for this new repository to ensure it can fetch
        // it's GitHub-related details using the GitHub API (if applicable)
        const gitStore = this.gitStoreCache.get(addedRepo)
        await gitStore.loadRemotes()

        const [refreshedRepo, usingLFS] = await Promise.all([
          this.repositoryWithRefreshedGitHubRepository(addedRepo),
          this.isUsingLFS(addedRepo),
        ])
        addedRepositories.push(refreshedRepo)

        if (usingLFS) {
          lfsRepositories.push(refreshedRepo)
        }
      } else {
        invalidPaths.push(path)
      }
    }

    if (invalidPaths.length > 0) {
      this.emitError(new Error(this.getInvalidRepoPathsMessage(invalidPaths)))
    }

    if (lfsRepositories.length > 0) {
      this._showPopup({
        type: PopupType.InitializeLFS,
        repositories: lfsRepositories,
      })
    }

    return addedRepositories
  }

  public async _relocateRepository(repository: Repository): Promise<void> {
    const path = await showOpenDialog({ properties: ['openDirectory'] })

    if (path === null) {
      return
    }

    const rt = await getRepositoryType(path)

    if (rt.kind === 'regular') {
      await this.repositoriesStore.updateRepositoryPath(
        repository,
        rt.topLevelWorkingDirectory,
        rt.gitDir
      )
    } else if (rt.kind === 'unsafe') {
      await this.repositoriesStore.updateRepositoryPath(
        repository,
        path,
        undefined,
        true
      )
    } else {
      this.emitError(new Error(this.getInvalidRepoPathsMessage([path])))
    }
  }

  public async _removeRepository(
    repository: Repository | CloningRepository,
    moveToTrash: boolean
  ): Promise<void> {
    if (isSubmoduleRepository(repository)) {
      this.emitError(
        new Error(
          'This submodule is open temporarily and is not in the repository list. Return to the main repository to remove or deinitialize it.'
        )
      )
      return
    }

    try {
      if (moveToTrash) {
        try {
          await shell.moveItemToTrash(repository.path)
        } catch (error) {
          log.error('Failed moving repository to trash', error)

          this.emitError(
            new Error(
              `Failed to move the repository directory to ${TrashNameLabel}.\n\nA common reason for this is that the directory or one of its files is open in another program.`
            )
          )
          return
        }
      }

      if (repository instanceof CloningRepository) {
        this._removeCloningRepository(repository)
      } else {
        await this.repositoriesStore.removeRepository(repository)
      }
    } catch (err) {
      this.emitError(err)
      return
    }

    const allRepositories = await this.repositoriesStore.getAll()
    if (allRepositories.length === 0) {
      this._closeFoldout(FoldoutType.Repository)
    } else {
      this._showFoldout({ type: FoldoutType.Repository })
    }
  }

  public async _cloneAgain(
    url: string,
    path: string,
    accountKey: string | null = null
  ): Promise<void> {
    const { promise, repository } = this._clone(url, path, {
      ...(accountKey !== null ? { accountKey } : {}),
    })
    await this._selectRepository(repository)
    const success = await promise
    if (!success) {
      return
    }

    const repositories = this.repositories
    const found = repositories.find(r => r.path === path)

    if (found) {
      const accountBoundRepository =
        repository.accountKey === null
          ? found
          : await this.repositoriesStore.updateRepositoryAccount(
              found,
              repository.accountKey
            )
      const updatedRepository = await this._updateRepositoryMissing(
        accountBoundRepository,
        false
      )
      await this._selectRepository(updatedRepository)
    }
  }

  private getInvalidRepoPathsMessage(
    invalidPaths: ReadonlyArray<string>
  ): string {
    if (invalidPaths.length === 1) {
      return `${invalidPaths} isn't a Git repository.`
    }

    return `The following paths aren't Git repositories:\n\n${invalidPaths
      .slice(0, MaxInvalidFoldersToDisplay)
      .map(path => `- ${path}`)
      .join('\n')}${
      invalidPaths.length > MaxInvalidFoldersToDisplay
        ? `\n\n(and ${invalidPaths.length - MaxInvalidFoldersToDisplay} more)`
        : ''
    }`
  }

  private async withRefreshedGitHubRepository<T>(
    repository: Repository,
    fn: (repository: Repository) => Promise<T>
  ): Promise<T> {
    if (isSubmoduleRepository(repository)) {
      await this.assertTemporaryRepositoryIsSafe(repository)
      if (!this.isTemporaryRepositoryActive(repository)) {
        throw new Error(
          'The temporary submodule workspace is no longer selected.'
        )
      }
      return fn(repository)
    }

    let updatedRepository = repository
    const account: Account | null = getAccountForRepository(
      this.accounts,
      updatedRepository
    )

    // If we don't have a user association, it might be because we haven't yet
    // tried to associate the repository with a GitHub repository, or that
    // association is out of date. So try again before we bail on providing an
    // authenticating user.
    if (!account) {
      updatedRepository = await this.repositoryWithRefreshedGitHubRepository(
        repository
      )
    }

    return fn(updatedRepository)
  }

  private updateRevertProgress(
    repository: Repository,
    progress: IRevertProgress | null
  ) {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    this.repositoryStateCache.update(repository, () => ({
      revertProgress: progress,
    }))

    if (this.selectedRepository === repository) {
      this.emitUpdate()
    }
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _revertCommit(
    repository: Repository,
    commit: Commit
  ): Promise<void> {
    return this.withRefreshedGitHubRepository(repository, async repository => {
      const gitStore = this.gitStoreCache.get(repository)

      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        gitStore.revertCommit(repository, commit, progress => {
          this.updateRevertProgress(repository, progress)
        })
      )

      this.updateRevertProgress(repository, null)
      await this._refreshRepository(repository)
    })
  }

  public async _installGlobalLFSFilters(force: boolean): Promise<void> {
    try {
      await installGlobalLFSFilters(force)
    } catch (error) {
      this.emitError(error)
    }
  }

  private async isUsingLFS(repository: Repository): Promise<boolean> {
    try {
      return await isUsingLFS(repository)
    } catch (error) {
      return false
    }
  }

  public async _installLFSHooks(
    repositories: ReadonlyArray<Repository>
  ): Promise<void> {
    for (const repo of repositories) {
      try {
        // At this point we've asked the user if we should install them, so
        // force installation.
        await installLFSHooks(repo, true)
      } catch (error) {
        this.emitError(error)
      }
    }
  }

  public _changeCloneRepositoriesTab(tab: CloneRepositoryTab): Promise<void> {
    this.selectedCloneRepositoryTab = tab

    this.emitUpdate()

    return Promise.resolve()
  }

  /**
   * Request a refresh of the list of repositories that
   * the provided account has explicit permissions to access.
   * See ApiRepositoriesStore for more details.
   */
  public _refreshApiRepositories(account: Account) {
    return this.apiRepositoriesStore.loadAll(account)
  }

  public _refreshApiOrganizationRepositories(
    account: Account,
    organization: IAPIOrganization
  ) {
    return this.apiRepositoriesStore.loadOrganizationRepositories(
      account,
      organization
    )
  }

  public _changeBranchesTab(tab: BranchesTab): Promise<void> {
    this.selectedBranchesTab = tab

    this.emitUpdate()

    return Promise.resolve()
  }

  public async _showGitHubExplore(repository: Repository): Promise<void> {
    const { gitHubRepository } = repository
    if (!gitHubRepository || gitHubRepository.htmlURL === null) {
      return
    }

    const url = new URL(gitHubRepository.htmlURL)
    url.pathname = '/explore'

    await this._openInBrowser(url.toString())
  }

  public async _createPullRequest(
    repository: Repository,
    baseBranch?: Branch
  ): Promise<void> {
    const gitHubRepository = repository.gitHubRepository
    if (!gitHubRepository) {
      return
    }

    const state = this.repositoryStateCache.get(repository)
    const tip = state.branchesState.tip

    if (tip.kind !== TipState.Valid) {
      return
    }

    const compareBranch = tip.branch
    const aheadBehind = state.aheadBehind

    if (aheadBehind == null) {
      this._showPopup({
        type: PopupType.PushBranchCommits,
        repository,
        branch: compareBranch,
        baseBranch,
      })
    } else if (aheadBehind.ahead > 0) {
      this._showPopup({
        type: PopupType.PushBranchCommits,
        repository,
        branch: compareBranch,
        unPushedCommits: aheadBehind.ahead,
        baseBranch,
      })
    } else {
      this._showCreateGitHubPullRequest(repository, compareBranch, baseBranch)
    }
  }

  /**
   * Open the native pull request composer for an already published branch.
   * Target repositories and base branches are derived from the exact remotes
   * Desktop uses for self and parent-fork contribution flows.
   */
  public _showCreateGitHubPullRequest(
    repository: Repository,
    requestedBranch: Branch,
    initialBaseBranch?: Branch
  ): void {
    if (
      !isRepositoryWithGitHubRepository(repository) ||
      this.popupManager.areTherePopupsOfType(PopupType.CreateGitHubPullRequest)
    ) {
      return
    }

    const repositoryState = this.repositoryStateCache.get(repository)
    const { branchesState } = repositoryState
    const refreshedBranch = resolveRefreshedGitHubPullRequestBranch(
      requestedBranch,
      branchesState.tip.kind === TipState.Valid
        ? branchesState.tip.branch
        : null
    )
    if (refreshedBranch === null) {
      return
    }

    const { allBranches, defaultBranch, upstreamDefaultBranch } = branchesState
    const sourceRemote = repositoryState.remote
    const source = repository.gitHubRepository
    const targets = buildGitHubPullRequestTargets(
      source,
      allBranches,
      defaultBranch,
      upstreamDefaultBranch,
      sourceRemote?.name ?? null,
      UpstreamRemoteName
    )

    const configuredTarget = getNonForkGitHubRepository(repository)
    const configuredTargetRemoteName =
      configuredTarget.hash === source.hash
        ? sourceRemote?.name ?? null
        : configuredTarget.hash === source.parent?.hash
        ? UpstreamRemoteName
        : null
    this._showPopup({
      type: PopupType.CreateGitHubPullRequest,
      repository,
      currentBranch: refreshedBranch,
      sourceRemote,
      providerHTMLURL: getHTMLURL(source.endpoint),
      targets,
      initialTargetHash: configuredTarget.hash,
      initialBaseBranchName:
        initialBaseBranch === undefined || configuredTargetRemoteName === null
          ? null
          : getGitHubPullRequestBaseBranchName(
              initialBaseBranch,
              configuredTargetRemoteName
            ),
      contextVersion: getGitHubPullRequestContextVersion(
        repository,
        refreshedBranch,
        sourceRemote
      ),
    })
  }

  /** Reject stale non-modal PR composers after repository or tip changes. */
  public _isGitHubPullRequestContextCurrent(
    repository: Repository,
    contextVersion: string
  ): boolean {
    const selected = this.selectedRepository
    if (
      !(selected instanceof Repository) ||
      selected.id !== repository.id ||
      selected.hash !== repository.hash
    ) {
      return false
    }

    const { branchesState, remote: sourceRemote } =
      this.repositoryStateCache.get(selected)
    const { tip } = branchesState
    return (
      tip.kind === TipState.Valid &&
      getGitHubPullRequestContextVersion(selected, tip.branch, sourceRemote) ===
        contextVersion
    )
  }

  public _showGitHubPullRequestLifecycle(
    repository: Repository,
    pullRequest: PullRequest
  ): void {
    if (
      !isRepositoryWithGitHubRepository(repository) ||
      this.popupManager.areTherePopupsOfType(
        PopupType.GitHubPullRequestLifecycle
      )
    ) {
      return
    }
    const target = pullRequest.base.gitHubRepository
    if (getNonForkGitHubRepository(repository).hash !== target.hash) {
      return
    }
    const repositoryState = this.repositoryStateCache.get(repository)
    const source = repository.gitHubRepository
    const remoteName =
      target.hash === source.hash
        ? repositoryState.remote?.name ?? null
        : target.hash === source.parent?.hash
        ? UpstreamRemoteName
        : null
    const names = new Set<string>([pullRequest.base.ref])
    if (remoteName !== null) {
      for (const branch of repositoryState.branchesState.allBranches) {
        const name = getGitHubPullRequestBaseBranchName(branch, remoteName)
        if (name !== null) {
          names.add(name)
        }
      }
    }
    this._showPopup({
      type: PopupType.GitHubPullRequestLifecycle,
      repository,
      pullRequest,
      baseBranchNames: [...names],
    })
  }

  public async _showPullRequest(repository: Repository): Promise<void> {
    // no pull requests from non github repos
    if (repository.gitHubRepository === null) {
      return
    }

    const currentPullRequest =
      this.repositoryStateCache.get(repository).branchesState.currentPullRequest

    if (currentPullRequest === null) {
      return
    }

    return this._showPullRequestByPR(currentPullRequest)
  }

  public async _showPullRequestByPR(pr: PullRequest): Promise<void> {
    const { htmlURL: baseRepoUrl } = pr.base.gitHubRepository

    if (baseRepoUrl === null) {
      return
    }

    const showPrUrl = `${baseRepoUrl}/pull/${pr.pullRequestNumber}`

    await this._openInBrowser(showPrUrl)
  }

  public async _refreshPullRequests(repository: Repository): Promise<void> {
    if (isRepositoryWithGitHubRepository(repository)) {
      const account = getAccountForRepository(this.accounts, repository)
      if (account !== null) {
        await this.pullRequestCoordinator.refreshPullRequests(
          repository,
          account
        )
      }
    }
  }

  private async onPullRequestChanged(
    repository: Repository,
    openPullRequests: ReadonlyArray<PullRequest>
  ) {
    this.repositoryStateCache.updateBranchesState(repository, () => {
      return { openPullRequests }
    })

    this.updateCurrentPullRequest(repository)
    this.gitStoreCache.get(repository).pruneForkedRemotes(openPullRequests)

    const selectedState = this.getSelectedState()

    // Update menu labels if the currently selected repository is the
    // repository for which we received an update.
    if (selectedState && selectedState.type === SelectionType.Repository) {
      if (selectedState.repository.id === repository.id) {
        this.updateMenuLabelsForSelectedRepository()
      }
    }
    this.emitUpdate()
  }

  private updateCurrentPullRequest(repository: Repository) {
    const gitHubRepository = repository.gitHubRepository

    if (!gitHubRepository) {
      return
    }

    this.repositoryStateCache.updateBranchesState(repository, state => {
      let currentPullRequest: PullRequest | null = null

      const { remote } = this.repositoryStateCache.get(repository)

      if (state.tip.kind === TipState.Valid && remote) {
        currentPullRequest = findAssociatedPullRequest(
          state.tip.branch,
          state.openPullRequests,
          remote
        )
      }

      return { currentPullRequest }
    })

    this.emitUpdate()
  }

  public async _openCreatePullRequestInBrowser(
    repository: Repository,
    compareBranch: Branch,
    sourceRemote: IRemote | null,
    baseBranchName?: string,
    targetOverride?: GitHubRepository
  ): Promise<boolean> {
    if (
      !isRepositoryWithGitHubRepository(repository) ||
      repository.gitHubRepository.htmlURL === null
    ) {
      return false
    }

    const gitHubRepository = repository.gitHubRepository
    const target = targetOverride ?? getNonForkGitHubRepository(repository)
    const targetIsAllowed =
      target.hash === gitHubRepository.hash ||
      target.hash === gitHubRepository.parent?.hash
    if (
      !targetIsAllowed ||
      target.endpoint !== gitHubRepository.endpoint ||
      target.htmlURL === null ||
      !remoteEquals(
        this.repositoryStateCache.get(repository).remote,
        sourceRemote
      )
    ) {
      return false
    }
    const url = getGitHubPullRequestCreationURL(
      gitHubRepository,
      target,
      compareBranch,
      sourceRemote,
      getHTMLURL(target.endpoint),
      baseBranchName
    )
    return url === null ? false : this._openInBrowser(url)
  }

  public async _updateExistingUpstreamRemote(
    repository: Repository
  ): Promise<void> {
    const gitStore = this.gitStoreCache.get(repository)
    await gitStore.updateExistingUpstreamRemote()

    return this._refreshRepository(repository)
  }

  private getIgnoreExistingUpstreamRemoteKey(repository: Repository): string {
    return `repository/${repository.id}/ignoreExistingUpstreamRemote`
  }

  public _ignoreExistingUpstreamRemote(repository: Repository): Promise<void> {
    const key = this.getIgnoreExistingUpstreamRemoteKey(repository)
    setBoolean(key, true)

    return Promise.resolve()
  }

  private getIgnoreExistingUpstreamRemote(
    repository: Repository
  ): Promise<boolean> {
    const key = this.getIgnoreExistingUpstreamRemoteKey(repository)
    return Promise.resolve(getBoolean(key, false))
  }

  private async addUpstreamRemoteIfNeeded(repository: Repository) {
    const gitStore = this.gitStoreCache.get(repository)
    const ignored = await this.getIgnoreExistingUpstreamRemote(repository)
    if (ignored) {
      return
    }

    return gitStore.addUpstreamRemoteIfNeeded()
  }

  private assertForkNetworkRepositoryContext(repository: Repository): void {
    const selected = this.selectedRepository
    if (
      !(selected instanceof Repository) ||
      selected.id !== repository.id ||
      selected.path !== repository.path ||
      getForkNetworkRepositoryIdentity(selected) !==
        getForkNetworkRepositoryIdentity(repository)
    ) {
      throw new ForkBranchCheckoutError('repository-context-changed')
    }
  }

  private getForkNetworkAPI(repository: Repository): API {
    if (!isRepositoryWithGitHubRepository(repository)) {
      throw new ForkBranchCheckoutError('unsupported-repository')
    }
    const account = getAccountForRepository(this.accounts, repository)
    if (
      account === null ||
      account.provider !== 'github' ||
      account.token.length === 0
    ) {
      throw new ForkBranchCheckoutError('sign-in-required')
    }
    return API.fromAccount(account)
  }

  private async wrapForkNetworkRequest<T>(
    request: () => Promise<T>
  ): Promise<T> {
    try {
      return await request()
    } catch (error) {
      if (
        error instanceof ForkBranchCheckoutError ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw error
      }
      throw new ForkBranchCheckoutError('network-or-permission')
    }
  }

  /** Load the first bounded, authenticated fork-network review stage. */
  public async _loadForkNetworkRepositories(
    repository: Repository,
    signal?: AbortSignal
  ): Promise<IForkNetworkCatalog> {
    this.assertForkNetworkRepositoryContext(repository)
    if (!isRepositoryWithGitHubRepository(repository)) {
      throw new ForkBranchCheckoutError('unsupported-repository')
    }
    const root =
      repository.gitHubRepository.parent ?? repository.gitHubRepository
    const page = await this.wrapForkNetworkRequest(() =>
      this.getForkNetworkAPI(repository).fetchForkNetworkRepositories(
        root.owner.login,
        root.name,
        signal
      )
    )
    this.assertForkNetworkRepositoryContext(repository)
    return createForkNetworkCatalog(repository, page)
  }

  /** Load and verify branches only for the exact fork selected in stage one. */
  public async _loadForkNetworkBranches(
    repository: Repository,
    catalog: IForkNetworkCatalog,
    fork: IForkNetworkRepository,
    signal?: AbortSignal
  ): Promise<IForkNetworkBranchCatalog> {
    this.assertForkNetworkRepositoryContext(repository)
    if (
      catalog.repositoryIdentity !==
        getForkNetworkRepositoryIdentity(repository) ||
      !catalog.forks.some(
        candidate =>
          candidate.id === fork.id && candidate.cloneURL === fork.cloneURL
      )
    ) {
      throw new ForkBranchCheckoutError('stale-review')
    }
    const api = this.getForkNetworkAPI(repository)
    const [liveFork, branches] = await this.wrapForkNetworkRequest(() =>
      Promise.all([
        api.fetchForkNetworkRepository(fork.owner, fork.name, signal),
        api.fetchForkNetworkBranches(fork.owner, fork.name, signal),
      ])
    )
    this.assertForkNetworkRepositoryContext(repository)
    return createForkNetworkBranchCatalog(repository, fork, liveFork, branches)
  }

  /** Capture remotes and local-ref absence for the confirmation surface. */
  public async _reviewForkBranchCheckout(
    repository: Repository,
    catalog: IForkNetworkBranchCatalog,
    branch: IForkNetworkBranch,
    localBranchName: string
  ): Promise<IForkBranchCheckoutPlan> {
    this.assertForkNetworkRepositoryContext(repository)
    return reviewForkBranchCheckout(
      repository,
      catalog,
      branch,
      localBranchName
    )
  }

  /** Revalidate GitHub, atomically prepare exact refs, and start checkout. */
  public async _checkoutReviewedForkBranch(
    repository: Repository,
    plan: IForkBranchCheckoutPlan
  ): Promise<IForkBranchCheckoutResult> {
    this.assertForkNetworkRepositoryContext(repository)
    const api = this.getForkNetworkAPI(repository)
    const [liveFork, liveBranch] = await this.wrapForkNetworkRequest(() =>
      Promise.all([
        api.fetchForkNetworkRepository(plan.fork.owner, plan.fork.name),
        api.fetchForkNetworkBranch(
          plan.fork.owner,
          plan.fork.name,
          plan.branch.name
        ),
      ])
    )
    this.assertForkNetworkRepositoryContext(repository)
    assertCheckoutPlanSelection(repository, plan, liveFork, liveBranch)

    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      applyForkBranchCheckoutPlan(repository, plan)
    )
    const gitStore = this.gitStoreCache.get(repository)
    await gitStore.loadBranches()
    const localBranch = gitStore.allBranches.find(
      branch =>
        branch.type === BranchType.Local &&
        branch.name === plan.localBranchName &&
        branch.tip.sha.toLowerCase() === plan.branch.headSha
    )
    if (localBranch === undefined) {
      throw new ForkBranchCheckoutError('git-failed')
    }
    await this._checkoutBranch(repository, localBranch)
    return {
      localBranchName: plan.localBranchName,
      remoteName: plan.remoteName,
      headSha: plan.branch.headSha,
      checkoutStarted: true,
    }
  }

  public async _checkoutPullRequest(
    repository: RepositoryWithGitHubRepository,
    prNumber: number,
    headRepoOwner: string,
    headCloneUrl: string,
    headRefName: string
  ): Promise<void> {
    const prBranch = await this._findPullRequestBranch(
      repository,
      prNumber,
      headRepoOwner,
      headCloneUrl,
      headRefName
    )
    if (prBranch !== undefined) {
      await this._checkoutBranch(repository, prBranch)
      this.statsStore.increment('prBranchCheckouts')
    }
  }

  public async _findPullRequestBranch(
    repository: RepositoryWithGitHubRepository,
    prNumber: number,
    headRepoOwner: string,
    headCloneUrl: string,
    headRefName: string
  ): Promise<Branch | undefined> {
    const gitStore = this.gitStoreCache.get(repository)
    const remotes = await getRemotes(repository)

    // Find an existing remote (regardless if set up by us or outside of
    // Desktop).
    let remote = remotes.find(r => urlMatchesRemote(headCloneUrl, r))

    // If we can't find one we'll create a Desktop fork remote.
    if (remote === undefined) {
      try {
        const forkRemoteName = forkPullRequestRemoteName(headRepoOwner)
        remote = await addRemote(repository, forkRemoteName, headCloneUrl)
      } catch (e) {
        this.emitError(
          new Error(
            `Couldn't find PR branch, adding remote failed: ${e.message}`
          )
        )
        return
      }
    }

    const remoteRef = `${remote.name}/${headRefName}`

    // Start by trying to find a local branch that is tracking the remote ref.
    let existingBranch = gitStore.allBranches.find(
      x => x.type === BranchType.Local && x.upstream === remoteRef
    )

    // If we found one, let's check it out and get out of here, quick
    if (existingBranch !== undefined) {
      return existingBranch
    }

    const findRemoteBranch = (name: string) =>
      gitStore.allBranches.find(
        x => x.type === BranchType.Remote && x.name === name
      )

    // No such luck, let's see if we can at least find the remote branch then
    existingBranch = findRemoteBranch(remoteRef)

    // It's quite possible that the PR was created after our last fetch of the
    // remote so let's fetch it and then try again.
    if (existingBranch === undefined) {
      try {
        await this._fetchRemote(repository, remote, FetchType.UserInitiatedTask)
        existingBranch = findRemoteBranch(remoteRef)
      } catch (e) {
        log.error(`Failed fetching remote ${remote?.name}`, e)
      }
    }

    if (existingBranch === undefined) {
      this.emitError(
        new Error(
          `Couldn't find branch '${headRefName}' in remote '${remote.name}'. ` +
            `A common reason for this is that the PR author has deleted their ` +
            `branch or their forked repository.`
        )
      )
      return
    }

    // For fork remotes we checkout the ref as pr/[123] instead of using the
    // head ref name since many PRs from forks are created from their default
    // branch so we'll have a very high likelihood of a conflicting local branch
    const isForkRemote =
      remote.name !== gitStore.defaultRemote?.name &&
      remote.name !== gitStore.upstreamRemote?.name

    if (isForkRemote) {
      return await this._createBranch(
        repository,
        `pr/${prNumber}`,
        remoteRef,
        false
      )
    }

    return existingBranch
  }

  /**
   * Set whether the user has chosen to hide or show the
   * co-authors field in the commit message component
   */
  public _setShowCoAuthoredBy(
    repository: Repository,
    showCoAuthoredBy: boolean
  ) {
    this.gitStoreCache.get(repository).setShowCoAuthoredBy(showCoAuthoredBy)
    return Promise.resolve()
  }

  /**
   * Update the per-repository co-authors list
   *
   * @param repository Co-author settings are per-repository
   * @param coAuthors  Zero or more authors
   */
  public _setCoAuthors(
    repository: Repository,
    coAuthors: ReadonlyArray<Author>
  ) {
    this.gitStoreCache.get(repository).setCoAuthors(coAuthors)
    return Promise.resolve()
  }

  /**
   * Re-read every setting managed by the active profile from localStorage.
   *
   * Profile history operations restore the allowlisted settings.json snapshot
   * first, then call this method so the running renderer reflects that snapshot
   * immediately without requiring a window reload. Keep this list aligned with
   * profile-settings-registry.ts.
   */
  public async _reloadProfileBackedSettings(): Promise<void> {
    const previousHideWhitespaceInChangesDiff = this.hideWhitespaceInChangesDiff
    const previousHideWhitespaceInHistoryDiff = this.hideWhitespaceInHistoryDiff
    const previousHideWhitespaceInPullRequestDiff =
      this.hideWhitespaceInPullRequestDiff

    this.sidebarWidth = constrain(
      getNumber(sidebarWidthConfigKey, defaultSidebarWidth)
    )
    this.commitSummaryWidth = constrain(
      getNumber(commitSummaryWidthConfigKey, defaultCommitSummaryWidth)
    )
    this.stashedFilesWidth = constrain(
      getNumber(stashedFilesWidthConfigKey, defaultStashedFilesWidth)
    )
    this.pullRequestFileListWidth = constrain(
      getNumber(pullRequestFileListConfigKey, defaultPullRequestFileListWidth)
    )
    this.branchDropdownWidth = constrain(
      getNumber(branchDropdownWidthConfigKey, defaultBranchDropdownWidth)
    )
    this.worktreeDropdownWidth = constrain(
      getNumber(worktreeDropdownWidthConfigKey, defaultWorktreeDropdownWidth)
    )
    this.pushPullButtonWidth = constrain(
      getNumber(pushPullButtonWidthConfigKey, defaultPushPullButtonWidth)
    )
    this.updateResizableConstraints()
    this.updatePullRequestResizableConstraints()

    this.askToMoveToApplicationsFolderSetting = getBoolean(
      askToMoveToApplicationsFolderKey,
      askToMoveToApplicationsFolderDefault
    )
    this.askForConfirmationOnRepositoryRemoval = getBoolean(
      confirmRepoRemovalKey,
      confirmRepoRemovalDefault
    )
    this.showCommitLengthWarning = getBoolean(
      showCommitLengthWarningKey,
      showCommitLengthWarningDefault
    )
    this.confirmDiscardChanges = getBoolean(
      confirmDiscardChangesKey,
      confirmDiscardChangesDefault
    )
    this.confirmDiscardChangesPermanently = getBoolean(
      confirmDiscardChangesPermanentlyKey,
      confirmDiscardChangesPermanentlyDefault
    )
    this.confirmDiscardStash = getBoolean(
      confirmDiscardStashKey,
      confirmDiscardStashDefault
    )
    this.confirmCheckoutCommit = getBoolean(
      confirmCheckoutCommitKey,
      confirmCheckoutCommitDefault
    )
    this.askForConfirmationOnForcePush = getBoolean(
      confirmForcePushKey,
      askForConfirmationOnForcePushDefault
    )
    this.confirmUndoCommit = getBoolean(
      confirmUndoCommitKey,
      confirmUndoCommitDefault
    )
    this.confirmCommitFilteredChanges = getBoolean(
      confirmCommitFilteredChangesKey,
      confirmCommitFilteredChangesDefault
    )
    this.confirmCommitMessageOverride = getBoolean(
      confirmCommitMessageOverrideKey,
      confirmCommitMessageOverrideDefault
    )
    this.confirmWorktreeRemoval = getBoolean(
      confirmWorktreeRemovalKey,
      confirmWorktreeRemovalDefault
    )
    this.autoSwitchAccountToRepositoryOwner = getBoolean(
      autoSwitchAccountToRepositoryOwnerKey,
      autoSwitchAccountToRepositoryOwnerDefault
    )
    this.errorPresentationStyle = getErrorPresentationStyle()

    const imageDiffTypeValue = localStorage.getItem(imageDiffTypeKey)
    this.imageDiffType =
      imageDiffTypeValue === null
        ? imageDiffTypeDefault
        : parseInt(imageDiffTypeValue)
    this.hideWhitespaceInChangesDiff = getBoolean(
      hideWhitespaceInChangesDiffKey,
      false
    )
    this.hideWhitespaceInHistoryDiff = getBoolean(
      hideWhitespaceInHistoryDiffKey,
      false
    )
    this.hideWhitespaceInPullRequestDiff = getBoolean(
      hideWhitespaceInPullRequestDiffKey,
      false
    )
    this.commitSpellcheckEnabled = getBoolean(
      commitSpellcheckEnabledKey,
      commitSpellcheckEnabledDefault
    )
    this.showSideBySideDiff = getShowSideBySideDiff()

    this.selectedTheme = getPersistedThemeName()
    setPersistedTheme(this.selectedTheme)
    this.currentTheme = await getCurrentlyAppliedTheme()
    const elementAppearanceState = this.elementAppearanceCoordinator?.getState()
    this.appearanceCustomization =
      elementAppearanceState?.initialized === true
        ? elementAppearanceState.appearance
        : getAppearanceCustomization()
    this.selectedTabSize = getNumber(tabSizeKey, tabSizeDefault)
    this.zoomBaseFactor = clampZoom(getFloatNumber('zoom-factor', 1))
    this.autoFitZoomEnabled = getBoolean('zoom-auto-fit-enabled', true)
    this.recomputeAutoFit()
    this.showRecentRepositories = getBoolean(showRecentRepositoriesKey) ?? true
    this.showBranchNameInRepoList =
      getEnum(showBranchNameInRepoListKey, ShowBranchNameInRepoListSetting) ??
      defaultShowBranchNameInRepoListSetting
    this.branchSortOrder =
      getEnum(branchSortOrderKey, BranchSortOrder) ?? DefaultBranchSortOrder
    this.preferAbsoluteDates = getPreferAbsoluteDates()

    const repositoryIndicatorsEnabled =
      getBoolean(repositoryIndicatorsEnabledKey) ?? true
    if (repositoryIndicatorsEnabled !== this.repositoryIndicatorsEnabled) {
      this.repositoryIndicatorsEnabled = repositoryIndicatorsEnabled
      if (repositoryIndicatorsEnabled) {
        this.repositoryIndicatorUpdater.start()
      } else {
        this.repositoryIndicatorUpdater.stop()
      }
    }

    this.pullRequestSuggestedNextAction =
      getEnum(
        pullRequestSuggestedNextActionKey,
        PullRequestSuggestedNextAction
      ) ?? defaultPullRequestSuggestedNextAction
    this.underlineLinks = getBoolean(underlineLinksKey, underlineLinksDefault)
    this.showDiffCheckMarks = getBoolean(
      showDiffCheckMarksKey,
      showDiffCheckMarksDefault
    )

    const repository = this.selectedRepository
    if (repository instanceof Repository) {
      const state = this.repositoryStateCache.get(repository)
      const refreshes = new Array<Promise<unknown>>()

      if (
        previousHideWhitespaceInChangesDiff !== this.hideWhitespaceInChangesDiff
      ) {
        refreshes.push(
          this.refreshChangesSection(repository, {
            includingStatus: true,
            clearPartialState: true,
          })
        )
      }

      if (
        previousHideWhitespaceInHistoryDiff !== this.hideWhitespaceInHistoryDiff
      ) {
        const file = state.commitSelection.file
        refreshes.push(
          file === null
            ? this.updateChangesWorkingDirectoryDiff(repository)
            : this._changeFileSelection(repository, file)
        )
      }

      if (
        previousHideWhitespaceInPullRequestDiff !==
        this.hideWhitespaceInPullRequestDiff
      ) {
        const file = state.pullRequestState?.commitSelection?.file ?? null
        if (file !== null) {
          refreshes.push(
            Promise.resolve(
              this._changePullRequestFileSelection(repository, file)
            )
          )
        }
      }

      await Promise.all(
        refreshes.map(refresh =>
          refresh.catch(error =>
            log.error('Failed to refresh a restored profile diff', error)
          )
        )
      )
    }

    this.emitUpdate()
  }

  /**
   * Set the application-wide theme
   */
  public _setSelectedTheme(theme: ApplicationTheme) {
    setPersistedTheme(theme)
    this.selectedTheme = theme
    this.emitUpdate()

    return Promise.resolve()
  }

  /** Set the application-wide appearance customization. */
  public async _setAppearanceCustomization(
    customization: IAppearanceCustomization
  ): Promise<void> {
    if (this.elementAppearanceCoordinator === undefined) {
      this.appearanceCustomization = setAppearanceCustomization(customization)
      this.emitUpdate()
      return
    }

    const version = ++this.appearanceCustomizationMutationVersion
    this.appearanceCustomization =
      normalizeAppearanceCustomization(customization)
    this.emitUpdate()

    try {
      const persisted =
        await this.elementAppearanceCoordinator.setAppearanceProjection(
          this.appearanceCustomization
        )
      if (version === this.appearanceCustomizationMutationVersion) {
        this.appearanceCustomization = persisted
        this.emitUpdate()
      }
    } catch (error) {
      if (version === this.appearanceCustomizationMutationVersion) {
        const state = this.elementAppearanceCoordinator.getState()
        this.appearanceCustomization = state.appearance
        this.emitUpdate()
      }
      const appearanceError =
        error instanceof Error ? error : new Error(String(error))
      this.emitError(appearanceError)
      throw appearanceError
    }
  }

  /** Persist appearance overrides in a repository's local Git config. */
  public async _setRepositoryAppearanceOverrides(
    repository: Repository,
    overrides: IRepositoryAppearanceOverrides
  ): Promise<void> {
    const normalized = await this.withTemporaryRepositoryMutationGuard(
      repository,
      () => setRepositoryAppearanceOverrides(repository, overrides)
    )
    if (this.selectedRepository === repository) {
      this.repositoryAppearanceOverrides = normalized
      this.emitUpdate()
    }
  }

  /**
   * Set the application-wide tab indentation
   */
  public _setSelectedTabSize(tabSize: number) {
    if (!isNaN(tabSize)) {
      this.selectedTabSize = tabSize
      setNumber(tabSizeKey, tabSize)
      this.emitUpdate()
    }

    return Promise.resolve()
  }

  public async _resolveCurrentEditor() {
    const match = await findEditorOrDefault(this.selectedExternalEditor)
    const resolvedExternalEditor = match != null ? match.editor : null
    if (this.resolvedExternalEditor !== resolvedExternalEditor) {
      this.resolvedExternalEditor = resolvedExternalEditor

      // Make sure we let the tutorial assessor know that we have a new editor
      // in case it's stuck waiting for one to be selected.
      if (this.currentOnboardingTutorialStep === TutorialStep.PickEditor) {
        if (this.selectedRepository instanceof Repository) {
          this.updateCurrentTutorialStep(this.selectedRepository)
        }
      }

      this.emitUpdate()
    }
  }

  public getResolvedExternalEditor = () => {
    return this.resolvedExternalEditor
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _updateManualConflictResolution(
    repository: Repository,
    path: string,
    manualResolution: ManualConflictResolution | null
  ) {
    this.repositoryStateCache.updateChangesState(repository, state => {
      const { conflictState } = state

      if (conflictState === null) {
        // not currently in a conflict, whatever
        return { conflictState }
      }

      const updatedManualResolutions = new Map(conflictState.manualResolutions)

      if (manualResolution !== null) {
        updatedManualResolutions.set(path, manualResolution)
      } else {
        updatedManualResolutions.delete(path)
      }

      return {
        conflictState: {
          ...conflictState,
          manualResolutions: updatedManualResolutions,
        },
      }
    })

    this.updateMultiCommitOperationStateAfterManualResolution(repository)

    this.emitUpdate()
  }

  /**
   * Updates the multi commit operation conflict step state as the manual
   * resolutions have been changed.
   */
  private updateMultiCommitOperationStateAfterManualResolution(
    repository: Repository
  ): void {
    const currentState = this.repositoryStateCache.get(repository)

    const { changesState, multiCommitOperationState } = currentState

    if (
      changesState.conflictState === null ||
      multiCommitOperationState === null ||
      (multiCommitOperationState.step.kind !==
        MultiCommitOperationStepKind.ShowConflicts &&
        multiCommitOperationState.step.kind !==
          MultiCommitOperationStepKind.ShowCopilotConflicts)
    ) {
      return
    }
    const { step } = multiCommitOperationState

    const { manualResolutions } = changesState.conflictState
    const conflictState = { ...step.conflictState, manualResolutions }
    this.repositoryStateCache.updateMultiCommitOperationState(
      repository,
      () => ({
        step: { ...step, conflictState },
      })
    )
  }

  private async createStashEntryForBranch(
    repository: Repository,
    branch: Branch
  ) {
    const gitStore = this.gitStoreCache.get(repository)

    const createdStash = await gitStore.performFailableOperation(() =>
      this.createStashEntry(repository, branch)
    )

    return createdStash === true
  }

  private async createStashEntry(repository: Repository, branch: Branch) {
    const { changesState } = this.repositoryStateCache.get(repository)
    const { workingDirectory } = changesState
    const untrackedFiles = getUntrackedFiles(workingDirectory)

    return this.withTemporaryRepositoryMutationGuard(repository, () =>
      createDesktopStashEntry(repository, branch, untrackedFiles, null)
    )
  }

  private async createSelectedFilesStash(
    repository: Repository,
    branch: Branch,
    files: ReadonlyArray<WorkingDirectoryFileChange>
  ): Promise<boolean> {
    // Git stash includes staged changes even when pathspecs are present. Reset
    // the index first, then refresh so deleted paths and untracked files are
    // represented accurately before passing an explicit pathspec.
    await this.withTemporaryRepositoryMutationGuard(repository, () =>
      unstageAll(repository)
    )
    await this._loadStatus(repository)

    if (!this.isTemporaryRepositoryActive(repository)) {
      return false
    }
    const { workingDirectory } =
      this.repositoryStateCache.get(repository).changesState
    const selectedPaths = files.map(file => file.path)
    return this.withTemporaryRepositoryMutationGuard(repository, () =>
      createDesktopStashEntry(
        repository,
        branch,
        getUntrackedFiles(workingDirectory),
        selectedPaths
      )
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _popStashEntry(
    repository: Repository,
    stashEntry: IStashEntry,
    signal?: AbortSignal
  ) {
    try {
      await this.withTemporaryRepositoryMutationGuard(repository, () =>
        popStashEntry(repository, stashEntry.stashSha, signal)
      )
      log.info(
        `[AppStore. _popStashEntry] popped stash with commit id ${stashEntry.stashSha}`
      )
      this.statsStore.increment('stashRestoreCount')
    } finally {
      // A failed apply may have left conflicts to resolve. Always refresh the
      // exact repository while retaining the stash as recovery material.
      await this._refreshRepository(repository)
    }
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _dropStashEntry(
    repository: Repository,
    stashEntry: IStashEntry
  ) {
    const gitStore = this.gitStoreCache.get(repository)
    await gitStore.performFailableOperation(() => {
      return this.withTemporaryRepositoryMutationGuard(repository, () =>
        clearReviewedDesktopStashes(repository, [stashEntry.stashSha]).then(
          () => undefined
        )
      )
    })
    log.info(
      `[AppStore. _dropStashEntry] dropped stash with commit id ${stashEntry.stashSha}`
    )

    this.statsStore.increment('stashDiscardCount')
    await gitStore.loadStashEntries()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _setStashedFilesWidth(width: number): Promise<void> {
    this.stashedFilesWidth = { ...this.stashedFilesWidth, value: width }
    setNumber(stashedFilesWidthConfigKey, width)
    this.updateResizableConstraints()
    this.emitUpdate()

    return Promise.resolve()
  }

  public _resetStashedFilesWidth(): Promise<void> {
    this.stashedFilesWidth = {
      ...this.stashedFilesWidth,
      value: defaultStashedFilesWidth,
    }
    localStorage.removeItem(stashedFilesWidthConfigKey)
    this.updateResizableConstraints()
    this.emitUpdate()

    return Promise.resolve()
  }

  public async _testPruneBranches() {
    if (this.currentBranchPruner === null) {
      return
    }

    await this.currentBranchPruner.testPrune()
  }

  public async _showCreateForkDialog(
    repository: RepositoryWithGitHubRepository
  ) {
    const eligibility = getForkRepositoryEligibility(this.accounts, repository)
    if (!eligibility.canFork) {
      log.warn(
        `Create fork dialog suppressed because the repository is not eligible: ${eligibility.reason}`
      )
      return
    }
    await this._showPopup({
      type: PopupType.CreateFork,
      repository: eligibility.repository,
      account: eligibility.account,
    })
  }

  /**
   * Converts a local repository to use the given fork
   * as its default remote and associated `GitHubRepository`.
   */
  public async _convertRepositoryToFork(
    repository: RepositoryWithGitHubRepository,
    fork: IAPIFullRepository
  ): Promise<Repository> {
    const gitStore = this.gitStoreCache.get(repository)
    const defaultRemoteName = gitStore.defaultRemote?.name
    const remoteUrl = gitStore.defaultRemote?.url
    const { endpoint } = repository.gitHubRepository

    // make sure there is a default remote (there should be)
    if (defaultRemoteName !== undefined && remoteUrl !== undefined) {
      // update default remote
      if (await gitStore.setRemoteURL(defaultRemoteName, fork.clone_url)) {
        await gitStore.ensureUpstreamRemoteURL(remoteUrl)
        // update associated github repo
        return this.repositoriesStore.setGitHubRepository(
          repository,
          await this.repositoriesStore.upsertGitHubRepository(endpoint, fork)
        )
      }
    }
    return repository
  }

  /**
   * Create a tutorial repository using the given account. The account
   * determines which host (i.e. GitHub.com or a GHES instance) that
   * the tutorial repository should be created on.
   *
   * @param account The account (and thereby the GitHub host) under
   *                which the repository is to be created created
   */
  public async _createTutorialRepository(account: Account) {
    try {
      await this.statsStore.recordTutorialStarted()

      const name = 'desktop-tutorial'
      const path = Path.resolve(await getDefaultDir(), name)

      const apiRepository = await createTutorialRepository(
        account,
        name,
        path,
        (title, value, description) => {
          if (
            this.popupManager.currentPopup?.type ===
            PopupType.CreateTutorialRepository
          ) {
            this.popupManager.updatePopup({
              ...this.popupManager.currentPopup,
              progress: { kind: 'generic', title, value, description },
            })
            this.emitUpdate()
          }
        }
      )

      await this._addTutorialRepository(path, account.endpoint, apiRepository)
      await this.statsStore.recordTutorialRepoCreated()
    } catch (err) {
      sendNonFatalException('tutorialRepoCreation', err)

      if (err instanceof GitError) {
        this.emitError(err)
      } else {
        this.emitError(
          new Error(
            `Failed creating the tutorial repository.\n\n${err.message}`
          )
        )
      }
    } finally {
      this._closePopup(PopupType.CreateTutorialRepository)
    }
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _initializeCherryPickProgress(
    repository: Repository,
    commits: ReadonlyArray<CommitOneLine>
  ) {
    // This shouldn't happen... but in case throw error.
    const lastCommit = forceUnwrap(
      'Unable to initialize cherry-pick progress. No commits provided.',
      commits.at(-1)
    )

    this.repositoryStateCache.updateMultiCommitOperationState(
      repository,
      () => ({
        progress: {
          kind: 'multiCommitOperation',
          value: 0,
          position: 1,
          totalCommitCount: commits.length,
          currentCommitSummary: lastCommit.summary,
        },
      })
    )

    this.emitUpdate()
  }

  private getMultiCommitOperationProgressCallBack(repository: Repository) {
    return (progress: IMultiCommitOperationProgress) => {
      if (!this.isTemporaryRepositoryActive(repository)) {
        return
      }
      this.repositoryStateCache.updateMultiCommitOperationState(
        repository,
        () => ({
          progress,
        })
      )
      this.emitUpdate()
    }
  }

  /**
   * Multi selection on the commit list can give an order of 1, 5, 3 if that is
   * how the user selected them. However, we want to main chronological ordering
   * of the commits to reduce the chance of conflicts during interact rebasing.
   * Thus, assuming 1 is the first commit made by the user and 5 is the last. We
   * want the order to be, 1, 3, 5.
   */
  private orderCommitsByHistory(
    repository: Repository,
    commits: ReadonlyArray<CommitOneLine>
  ) {
    const { compareState } = this.repositoryStateCache.get(repository)
    const { commitSHAs } = compareState
    const commitIndexBySha = new Map(commitSHAs.map((sha, i) => [sha, i]))

    return commits.toSorted((a, b) =>
      compare(commitIndexBySha.get(b.sha), commitIndexBySha.get(a.sha))
    )
  }

  /**
   * Multi selection on the commit list can give an order of 1, 5, 3 if that is
   * how the user selected them. However, sometimes we want them in
   * chronological ordering of the commits such as when get a range files
   * changed. Thus, assuming 1 is the first commit made by the user and 5 is the
   * last. We want the order to be, 1, 3, 5.
   */
  private orderShasByHistory(
    repository: Repository,
    commits: ReadonlyArray<string>
  ) {
    const { compareState } = this.repositoryStateCache.get(repository)
    const { commitSHAs } = compareState
    const commitIndexBySha = new Map(commitSHAs.map((sha, i) => [sha, i]))

    return commits.toSorted((a, b) =>
      compare(commitIndexBySha.get(b), commitIndexBySha.get(a))
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _cherryPick(
    repository: Repository,
    commits: ReadonlyArray<CommitOneLine>
  ): Promise<CherryPickResult> {
    if (commits.length === 0) {
      log.error('[_cherryPick] - Unable to cherry-pick. No commits provided.')
      return CherryPickResult.UnableToStart
    }

    const orderedCommits = this.orderCommitsByHistory(repository, commits)

    await this._refreshRepository(repository)
    if (!this.isTemporaryRepositoryActive(repository)) {
      return CherryPickResult.UnableToStart
    }

    const progressCallback =
      this.getMultiCommitOperationProgressCallBack(repository)
    const gitStore = this.gitStoreCache.get(repository)
    const result = await gitStore.performFailableOperation(() =>
      this.withTemporaryRepositoryMutationGuard(repository, () =>
        cherryPick(repository, orderedCommits, progressCallback)
      )
    )

    return result || CherryPickResult.Error
  }

  /**
   * Checks for uncommitted changes
   *
   * If uncommitted changes exist, ask user to stash, retry provided retry
   * action and return true.
   *
   * If no uncommitted changes, return false.
   *
   * This shouldn't be called directly. See `Dispatcher`.
   */
  public _checkForUncommittedChanges(
    repository: Repository,
    retryAction: RetryAction
  ): boolean {
    const { changesState } = this.repositoryStateCache.get(repository)
    const hasChanges = changesState.workingDirectory.files.length > 0
    if (!hasChanges) {
      return false
    }

    this._showPopup({
      type: PopupType.LocalChangesOverwritten,
      repository,
      retryAction,
      files: changesState.workingDirectory.files.map(f => f.path),
    })

    return true
  }

  /**
   * Attempts to checkout target branch and return it's name after checkout.
   * This is useful if you want the local name when checking out a potentially
   * remote branch during an operation.
   *
   * Note: This does not do any existing changes checking like _checkout does.
   *
   * This shouldn't be called directly. See `Dispatcher`.
   */
  public async _checkoutBranchReturnName(
    repository: Repository,
    targetBranch: Branch
  ): Promise<string | undefined> {
    const gitStore = this.gitStoreCache.get(repository)

    const checkoutSuccessful = await this.withRefreshedGitHubRepository(
      repository,
      repository => {
        return gitStore.performFailableOperation(() =>
          this.withTemporaryRepositoryMutationGuard(repository, () =>
            checkoutBranch(repository, targetBranch, gitStore.currentRemote)
          )
        )
      }
    )

    if (checkoutSuccessful !== true) {
      return
    }

    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const status = await gitStore.loadStatus()
    return status?.currentBranch
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _abortCherryPick(
    repository: Repository,
    sourceBranch: Branch | null
  ): Promise<void> {
    const gitStore = this.gitStoreCache.get(repository)

    await gitStore.performFailableOperation(() =>
      this.withTemporaryRepositoryMutationGuard(repository, () =>
        abortCherryPick(repository)
      )
    )

    await this.checkoutBranchIfNotNull(repository, sourceBranch)
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _setCherryPickBranchCreated(
    repository: Repository,
    branchCreated: boolean
  ): void {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return
    }
    const { multiCommitOperationState: opState } =
      this.repositoryStateCache.get(repository)

    if (
      opState === null ||
      opState.operationDetail.kind !== MultiCommitOperationKind.CherryPick
    ) {
      log.error(
        '[setCherryPickBranchCreated] - Not in cherry-pick operation state'
      )
      return
    }

    // An update is not emitted here because there is no need
    // to trigger a re-render at this point. (storing for later)
    this.repositoryStateCache.updateMultiCommitOperationState(
      repository,
      () => ({
        operationDetail: { ...opState.operationDetail, branchCreated },
      })
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _continueCherryPick(
    repository: Repository,
    files: ReadonlyArray<WorkingDirectoryFileChange>,
    manualResolutions: ReadonlyMap<string, ManualConflictResolution>
  ): Promise<CherryPickResult> {
    const progressCallback =
      this.getMultiCommitOperationProgressCallBack(repository)

    const gitStore = this.gitStoreCache.get(repository)
    const result = await gitStore.performFailableOperation(() =>
      this.withTemporaryRepositoryMutationGuard(repository, () =>
        continueCherryPick(
          repository,
          files,
          manualResolutions,
          progressCallback
        )
      )
    )

    return result || CherryPickResult.Error
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _setCherryPickProgressFromState(repository: Repository) {
    const snapshot = await getCherryPickSnapshot(repository)
    if (snapshot === null || !this.isTemporaryRepositoryActive(repository)) {
      return
    }

    this.repositoryStateCache.updateMultiCommitOperationState(
      repository,
      () => ({
        progress: snapshot.progress,
      })
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _clearCherryPickingHead(
    repository: Repository,
    sourceBranch: Branch | null
  ): Promise<void> {
    if (!isCherryPickHeadFound(repository)) {
      return
    }

    const gitStore = this.gitStoreCache.get(repository)
    await gitStore.performFailableOperation(() =>
      this.withTemporaryRepositoryMutationGuard(repository, () =>
        abortCherryPick(repository)
      )
    )

    await this.checkoutBranchIfNotNull(repository, sourceBranch)

    return this._refreshRepository(repository)
  }

  private async checkoutBranchIfNotNull(
    repository: Repository,
    sourceBranch: Branch | null
  ) {
    if (sourceBranch === null) {
      return
    }

    const gitStore = this.gitStoreCache.get(repository)
    await this.withRefreshedGitHubRepository(repository, async repository => {
      await gitStore.performFailableOperation(() =>
        this.withTemporaryRepositoryMutationGuard(repository, () =>
          checkoutBranch(repository, sourceBranch, gitStore.currentRemote)
        )
      )
    })
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _setDragElement(dragElement: DragElement | null): Promise<void> {
    this.currentDragElement = dragElement
    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _getBranchAheadBehind(
    repository: Repository,
    branch: Branch
  ): Promise<IAheadBehind | null> {
    return getBranchAheadBehind(repository, branch)
  }

  public _setLastThankYou(lastThankYou: ILastThankYou) {
    // don't update if same length and same version (assumption
    // is that update will be either adding a user or updating version)
    const sameVersion =
      this.lastThankYou !== undefined &&
      this.lastThankYou.version === lastThankYou.version

    const sameNumCheckedUsers =
      this.lastThankYou !== undefined &&
      this.lastThankYou.checkedUsers.length === lastThankYou.checkedUsers.length

    if (sameVersion && sameNumCheckedUsers) {
      return
    }

    setObject(lastThankYouKey, lastThankYou)
    this.lastThankYou = lastThankYou

    this.emitUpdate()
  }

  public _setUseCustomEditor(useCustomEditor: boolean) {
    setBoolean(useCustomEditorKey, useCustomEditor)
    this.useCustomEditor = useCustomEditor
    this.emitUpdate()
  }

  public _setCustomEditor(customEditor: ICustomIntegration) {
    setObject(customEditorKey, customEditor)
    this.customEditor = customEditor
    this.emitUpdate()
  }

  public _setUseCustomShell(useCustomShell: boolean) {
    setBoolean(useCustomShellKey, useCustomShell)
    this.useCustomShell = useCustomShell
    this.emitUpdate()
  }

  public _setCustomShell(customShell: ICustomIntegration) {
    setObject(customShellKey, customShell)
    this.customShell = customShell
    this.emitUpdate()
  }

  public _setBranchPresetScript(branchPresetScript: ICustomIntegration) {
    setObject(branchPresetScriptKey, branchPresetScript)
    this.branchPresetScript = branchPresetScript
    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _reorderCommits(
    repository: Repository,
    commitsToReorder: ReadonlyArray<Commit>,
    beforeCommit: Commit | null,
    lastRetainedCommitRef: string | null
  ): Promise<RebaseResult> {
    if (commitsToReorder.length === 0) {
      log.error('[_reorder] - Unable to reorder. No commits provided.')
      return RebaseResult.Error
    }

    const progressCallback =
      this.getMultiCommitOperationProgressCallBack(repository)
    const gitStore = this.gitStoreCache.get(repository)
    const result = await gitStore.performFailableOperation(() =>
      this.withTemporaryRepositoryMutationGuard(repository, () =>
        reorder(
          repository,
          commitsToReorder,
          beforeCommit,
          lastRetainedCommitRef,
          progressCallback
        )
      )
    )

    return result || RebaseResult.Error
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _squash(
    repository: Repository,
    toSquash: ReadonlyArray<Commit>,
    squashOnto: Commit,
    lastRetainedCommitRef: string | null,
    commitContext: ICommitContext
  ): Promise<RebaseResult> {
    if (toSquash.length === 0) {
      log.error('[_squash] - Unable to squash. No commits provided.')
      return RebaseResult.Error
    }

    const progressCallback =
      this.getMultiCommitOperationProgressCallBack(repository)
    const commitMessage = await formatCommitMessage(repository, commitContext)
    if (!this.isTemporaryRepositoryActive(repository)) {
      return RebaseResult.Error
    }
    const gitStore = this.gitStoreCache.get(repository)
    const result = await gitStore.performFailableOperation(() =>
      this.withTemporaryRepositoryMutationGuard(repository, () =>
        squash(
          repository,
          toSquash,
          squashOnto,
          lastRetainedCommitRef,
          commitMessage,
          progressCallback
        )
      )
    )

    return result || RebaseResult.Error
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _undoMultiCommitOperation(
    mcos: IMultiCommitOperationState,
    repository: Repository,
    commitsCount: number
  ): Promise<boolean> {
    if (!this.isTemporaryRepositoryActive(repository)) {
      return false
    }
    const {
      branchesState,
      multiCommitOperationUndoState,
      changesState: { workingDirectory },
    } = this.repositoryStateCache.get(repository)
    const { operationDetail } = mcos
    const { kind } = operationDetail

    if (multiCommitOperationUndoState === null) {
      log.error(
        `[_undoMultiCommitOperation] - Could not undo ${kind}. There is no undo info available.`
      )
      return false
    }

    const { undoSha, branchName } = multiCommitOperationUndoState

    if (workingDirectory.files.length > 0) {
      log.error(
        `[_undoMultiCommitOperation] - Could not undo ${kind}. This would delete the local changes that exist on the branch.`
      )
      return false
    }

    const { tip } = branchesState
    if (tip.kind !== TipState.Valid || tip.branch.name !== branchName) {
      log.error(
        `[_undoMultiCommitOperation] - Could not undo ${kind}.  User no longer on branch the ${kind} occurred on.`
      )
      return false
    }

    if (undoSha === null) {
      log.error('[_undoMultiCommitOperation] - Could not determine undo sha')
      return false
    }

    // If a new branch is created as part of the cherry-pick,
    // We just want to delete it, no need to reset it.
    if (
      operationDetail.kind === MultiCommitOperationKind.CherryPick &&
      operationDetail.branchCreated
    ) {
      this._deleteBranch(
        repository,
        tip.branch,
        false,
        operationDetail.sourceBranch
      )
      return true
    }

    const gitStore = this.gitStoreCache.get(repository)
    const result = await gitStore.performFailableOperation(() =>
      this.withTemporaryRepositoryMutationGuard(repository, () =>
        reset(repository, GitResetMode.Hard, undoSha)
      )
    )

    if (result !== true || !this.isTemporaryRepositoryActive(repository)) {
      return false
    }

    let banner: Banner

    switch (kind) {
      case MultiCommitOperationKind.Squash:
        banner = {
          type: BannerType.SquashUndone,
          commitsCount,
        }
        break
      case MultiCommitOperationKind.Reorder:
        banner = {
          type: BannerType.ReorderUndone,
          commitsCount,
        }
        break
      case MultiCommitOperationKind.CherryPick:
        const sourceBranch =
          operationDetail.kind === MultiCommitOperationKind.CherryPick
            ? operationDetail.sourceBranch
            : null
        await this.checkoutBranchIfNotNull(repository, sourceBranch)
        if (!this.isTemporaryRepositoryActive(repository)) {
          return false
        }
        banner = {
          type: BannerType.CherryPickUndone,
          targetBranchName: branchName,
          countCherryPicked: commitsCount,
        }
        break
      case MultiCommitOperationKind.Rebase:
      case MultiCommitOperationKind.Merge:
        throw new Error(
          `Unexpected multi commit operation kind to undo ${kind}`
        )
      default:
        assertNever(kind, `Unsupported multi operation kind to undo ${kind}`)
    }

    this._setBanner(banner)

    await this._loadStatus(repository)

    if (!this.isTemporaryRepositoryActive(repository)) {
      return false
    }
    const stateAfter = this.repositoryStateCache.get(repository)
    // Cherry-pick doesn't require a force push but squash and reorder may. (rebase, merge not supported)
    if (
      stateAfter.branchesState.tip.kind === TipState.Valid &&
      kind !== MultiCommitOperationKind.CherryPick
    ) {
      this._addBranchToForcePushList(
        repository,
        stateAfter.branchesState.tip,
        tip.branch.tip.sha
      )
    }

    await this._refreshRepository(repository)

    return true
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _addBranchToForcePushList = (
    repository: Repository,
    tipWithBranch: IValidBranch,
    beforeChangeSha: string
  ) => {
    // if the commit id of the branch is unchanged, it can be excluded from
    // this list
    if (tipWithBranch.branch.tip.sha === beforeChangeSha) {
      return
    }

    const currentState = this.repositoryStateCache.get(repository)
    const { forcePushBranches } = currentState.branchesState

    const updatedMap = new Map<string, string>(forcePushBranches)
    updatedMap.set(
      tipWithBranch.branch.nameWithoutRemote,
      tipWithBranch.branch.tip.sha
    )

    this.repositoryStateCache.updateBranchesState(repository, () => ({
      forcePushBranches: updatedMap,
    }))
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _setMultiCommitOperationUndoState(
    repository: Repository,
    tip: IValidBranch
  ): void {
    // An update is not emitted here because there is no need
    // to trigger a re-render at this point. (storing for later)
    this.repositoryStateCache.updateMultiCommitOperationUndoState(
      repository,
      () => ({
        undoSha: getTipSha(tip),
        branchName: tip.branch.name,
      })
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _handleConflictsDetectedOnError(
    repository: Repository,
    currentBranch: string,
    theirBranch: string
  ): Promise<void> {
    const { multiCommitOperationState } =
      this.repositoryStateCache.get(repository)

    if (multiCommitOperationState === null) {
      const gitStore = this.gitStoreCache.get(repository)

      const targetBranch = gitStore.allBranches.find(
        branch => branch.name === currentBranch
      )

      if (targetBranch === undefined) {
        return
      }

      const sourceBranch = gitStore.allBranches.find(
        branch => branch.name === theirBranch
      )

      this._initializeMultiCommitOperation(
        repository,
        {
          kind: MultiCommitOperationKind.Merge,
          isSquash: false,
          sourceBranch: sourceBranch ?? null,
        },
        targetBranch,
        [],
        targetBranch.tip.sha
      )
    }

    this._setMultiCommitOperationStep(repository, {
      kind: MultiCommitOperationStepKind.ShowConflicts,
      conflictState: {
        kind: 'multiCommitOperation',
        manualResolutions: new Map<string, ManualConflictResolution>(),
        ourBranch: currentBranch,
        theirBranch,
      },
    })

    return this._showPopup({
      type: PopupType.MultiCommitOperation,
      repository,
    })
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public async _setMultiCommitOperationStep(
    repository: Repository,
    step: MultiCommitOperationStep
  ): Promise<void> {
    this.repositoryStateCache.updateMultiCommitOperationState(
      repository,
      () => ({
        step,
      })
    )

    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _setMultiCommitOperationStepWithCopilotResolution(
    repository: Repository,
    step: MultiCommitOperationStep,
    useCopilotConflictResolution: boolean
  ): void {
    if (!useCopilotConflictResolution) {
      this.statsStore.increment('copilotConflictResolutionSwitchToManualCount')
    }

    this.repositoryStateCache.updateMultiCommitOperationState(
      repository,
      () => ({
        step,
        useCopilotConflictResolution,
      })
    )

    this.emitUpdate()
  }

  public _setMultiCommitOperationTargetBranch(
    repository: Repository,
    targetBranch: Branch
  ): void {
    this.repositoryStateCache.updateMultiCommitOperationState(
      repository,
      () => ({
        targetBranch,
      })
    )
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _endMultiCommitOperation(repository: Repository): void {
    this.repositoryStateCache.clearMultiCommitOperationState(repository)
    this.emitUpdate()
  }

  /** This shouldn't be called directly. See `Dispatcher`. */
  public _initializeMultiCommitOperation(
    repository: Repository,
    operationDetail: MultiCommitOperationDetail,
    targetBranch: Branch | null,
    commits: ReadonlyArray<Commit | CommitOneLine>,
    originalBranchTip: string | null,
    emitUpdate: boolean = true
  ): void {
    this.repositoryStateCache.initializeMultiCommitOperationState(repository, {
      step: {
        kind: MultiCommitOperationStepKind.ShowProgress,
      },
      operationDetail,
      progress: {
        kind: 'multiCommitOperation',
        currentCommitSummary: commits.length > 0 ? commits[0].summary : '',
        position: 1,
        totalCommitCount: commits.length,
        value: 0,
      },
      userHasResolvedConflicts: false,
      useCopilotConflictResolution: false,
      copilotResolutions: null,
      copilotResolutionSummary: null,
      copilotResolutionProgress: null,
      copilotResolutionAbortController: null,
      copilotResolutionModel: null,
      originalBranchTip,
      targetBranch,
    })

    if (!emitUpdate) {
      return
    }

    this.emitUpdate()
  }

  public _setShowCIStatusPopover(showCIStatusPopover: boolean) {
    if (this.showCIStatusPopover !== showCIStatusPopover) {
      this.showCIStatusPopover = showCIStatusPopover
      this.emitUpdate()
    }
  }

  public _toggleCIStatusPopover() {
    this.showCIStatusPopover = !this.showCIStatusPopover
    this.emitUpdate()
  }

  public onChecksFailedNotification = async (
    repository: RepositoryWithGitHubRepository,
    pullRequest: PullRequest,
    checks: ReadonlyArray<IRefCheck>
  ) => {
    this.postNotification({
      kind: 'pr-checks-failed',
      title: `Checks failed on #${pullRequest.pullRequestNumber}`,
      body: `${checks.length} check${
        checks.length === 1 ? '' : 's'
      } failed on "${pullRequest.title}".`,
      repositoryId: repository.id,
    })

    const selectedRepository =
      this.selectedRepository ?? (await this._selectRepository(repository))

    const popup: Popup = {
      type: PopupType.PullRequestChecksFailed,
      pullRequest,
      repository,
      shouldChangeRepository: true,
      checks,
    }

    // If the repository doesn't match the one from the notification, just show
    // the popup which will suggest to switch to that repo.
    if (
      selectedRepository === null ||
      selectedRepository.hash !== repository.hash
    ) {
      this.statsStore.increment('checksFailedDialogOpenCount')
      return this._showPopup(popup)
    }

    const state = this.repositoryStateCache.get(repository)

    const { branchesState } = state
    const { tip } = branchesState
    const currentBranch = tip.kind === TipState.Valid ? tip.branch : null

    if (currentBranch !== null && currentBranch.name === pullRequest.head.ref) {
      // If it's the same branch, just show the existing CI check run popover
      this._setShowCIStatusPopover(true)
    } else {
      this.statsStore.increment('checksFailedDialogOpenCount')

      // If there is no current branch or it's different than the PR branch,
      // show the checks failed dialog, but it won't offer to switch to the
      // repository.
      return this._showPopup({
        ...popup,
        shouldChangeRepository: false,
      })
    }
  }

  private onPullRequestReviewSubmitNotification = async (
    repository: RepositoryWithGitHubRepository,
    pullRequest: PullRequest,
    review: ValidNotificationPullRequestReview
  ) => {
    this.postNotification({
      kind: 'pr-review-submit',
      title: `New review on #${pullRequest.pullRequestNumber}`,
      body: `${review.user.login} reviewed "${pullRequest.title}".`,
      repositoryId: repository.id,
    })

    const selectedRepository =
      this.selectedRepository ?? (await this._selectRepository(repository))

    const state = this.repositoryStateCache.get(repository)

    const { branchesState } = state
    const { tip } = branchesState
    const currentBranch = tip.kind === TipState.Valid ? tip.branch : null

    return this._showPopup({
      type: PopupType.PullRequestReview,
      shouldCheckoutBranch:
        currentBranch !== null && currentBranch.name !== pullRequest.head.ref,
      shouldChangeRepository:
        selectedRepository === null ||
        selectedRepository.hash !== repository.hash,
      review,
      pullRequest,
      repository,
    })
  }

  private onPullRequestCommentNotification = async (
    repository: RepositoryWithGitHubRepository,
    pullRequest: PullRequest,
    comment: IAPIComment
  ) => {
    this.postNotification({
      kind: 'pr-comment',
      title: `New comment on #${pullRequest.pullRequestNumber}`,
      body: `${comment.user.login} commented on "${pullRequest.title}".`,
      repositoryId: repository.id,
    })

    const selectedRepository =
      this.selectedRepository ?? (await this._selectRepository(repository))

    const state = this.repositoryStateCache.get(repository)

    const { branchesState } = state
    const { tip } = branchesState
    const currentBranch = tip.kind === TipState.Valid ? tip.branch : null

    return this._showPopup({
      type: PopupType.PullRequestComment,
      shouldCheckoutBranch:
        currentBranch !== null && currentBranch.name !== pullRequest.head.ref,
      shouldChangeRepository:
        selectedRepository === null ||
        selectedRepository.hash !== repository.hash,
      comment,
      pullRequest,
      repository,
    })
  }

  public async _startPullRequest(repository: Repository) {
    const { tip, defaultBranch } =
      this.repositoryStateCache.get(repository).branchesState

    if (tip.kind !== TipState.Valid) {
      // Shouldn't even be able to get here if so - just a type check
      return
    }

    const currentBranch = tip.branch
    this._initializePullRequestPreview(repository, defaultBranch, currentBranch)
  }

  private async _initializePullRequestPreview(
    repository: Repository,
    baseBranch: Branch | null,
    currentBranch: Branch
  ) {
    if (baseBranch === null) {
      this.showPullRequestPopupNoBaseBranch(repository, currentBranch)
      return
    }

    const gitStore = this.gitStoreCache.get(repository)

    const pullRequestCommits = await gitStore.getCommitsBetweenBranches(
      baseBranch,
      currentBranch
    )

    const commitsBetweenBranches = pullRequestCommits.map(c => c.sha)

    // A user may compare two branches with no changes between them.
    const emptyChangeSet = { files: [], linesAdded: 0, linesDeleted: 0 }
    const changesetData =
      commitsBetweenBranches.length > 0
        ? await gitStore.performFailableOperation(() =>
            getBranchMergeBaseChangedFiles(
              repository,
              baseBranch.name,
              currentBranch.name,
              commitsBetweenBranches[0]
            )
          )
        : emptyChangeSet

    if (changesetData === undefined) {
      return
    }

    const hasMergeBase = changesetData !== null
    // We don't care how many commits exist on the unrelated history that
    // can't be merged.
    const commitSHAs = hasMergeBase ? commitsBetweenBranches : []

    this.repositoryStateCache.initializePullRequestState(repository, {
      baseBranch,
      commitSHAs,
      commitSelection: {
        shas: commitSHAs,
        shasInDiff: commitSHAs,
        isContiguous: true,
        changesetData: changesetData ?? emptyChangeSet,
        file: null,
        diff: null,
      },
      mergeStatus:
        commitSHAs.length > 0 || !hasMergeBase
          ? {
              kind: hasMergeBase
                ? ComputedAction.Loading
                : ComputedAction.Invalid,
            }
          : null,
    })

    this.emitUpdate()

    if (commitSHAs.length > 0) {
      this.setupPRMergeTreePromise(repository, baseBranch, currentBranch)
    }

    if (changesetData !== null && changesetData.files.length > 0) {
      await this._changePullRequestFileSelection(
        repository,
        changesetData.files[0]
      )
    }

    this.showPullRequestPopup(repository, currentBranch, commitSHAs)
  }

  public showPullRequestPopupNoBaseBranch(
    repository: Repository,
    currentBranch: Branch
  ) {
    this.repositoryStateCache.initializePullRequestState(repository, {
      baseBranch: null,
      commitSHAs: null,
      commitSelection: null,
      mergeStatus: null,
    })

    this.emitUpdate()

    this.showPullRequestPopup(repository, currentBranch, [])
  }

  public showPullRequestPopup(
    repository: Repository,
    currentBranch: Branch,
    commitSHAs: ReadonlyArray<string>
  ) {
    if (this.popupManager.areTherePopupsOfType(PopupType.StartPullRequest)) {
      return
    }

    this.statsStore.increment('previewedPullRequestCount')

    const { branchesState, localCommitSHAs } =
      this.repositoryStateCache.get(repository)
    const { allBranches, recentBranches, defaultBranch, currentPullRequest } =
      branchesState
    const gitStore = this.gitStoreCache.get(repository)
    /*  We only want branches that are also on dotcom such that, when we ask a
     *  user to create a pull request, the base branch also exists on dotcom.
     */
    const remote = isForkedRepositoryContributingToParent(repository)
      ? UpstreamRemoteName
      : gitStore.defaultRemote?.name
    const prBaseBranches = allBranches.filter(
      b => b.upstreamRemoteName === remote || b.remoteName === remote
    )
    const prRecentBaseBranches = recentBranches.filter(
      b => b.upstreamRemoteName === remote || b.remoteName === remote
    )
    const { imageDiffType, selectedExternalEditor, showSideBySideDiff } =
      this.getState()

    const nonLocalCommitSHA =
      commitSHAs.length > 0 && !localCommitSHAs.includes(commitSHAs[0])
        ? commitSHAs[0]
        : null

    this._showPopup({
      type: PopupType.StartPullRequest,
      prBaseBranches,
      prRecentBaseBranches,
      currentBranch,
      defaultBranch,
      imageDiffType,
      repository,
      externalEditorLabel: selectedExternalEditor ?? undefined,
      nonLocalCommitSHA,
      showSideBySideDiff,
      currentBranchHasPullRequest: currentPullRequest !== null,
    })
  }

  public async _changePullRequestFileSelection(
    repository: Repository,
    file: CommittedFileChange
  ): Promise<void> {
    const { branchesState, pullRequestState } =
      this.repositoryStateCache.get(repository)

    if (
      branchesState.tip.kind !== TipState.Valid ||
      pullRequestState === null
    ) {
      return
    }

    const currentBranch = branchesState.tip.branch
    const { baseBranch, commitSHAs } = pullRequestState
    if (commitSHAs === null || baseBranch === null) {
      return
    }

    this.repositoryStateCache.updatePullRequestCommitSelection(
      repository,
      () => ({
        file,
        diff: null,
      })
    )

    this.emitUpdate()

    if (commitSHAs.length === 0) {
      // Shouldn't happen at this point, but if so moving forward doesn't
      // make sense
      return
    }

    const diff =
      (await this.gitStoreCache
        .get(repository)
        .performFailableOperation(() =>
          getBranchMergeBaseDiff(
            repository,
            file,
            baseBranch.name,
            currentBranch.name,
            this.hideWhitespaceInPullRequestDiff,
            commitSHAs[0]
          )
        )) ?? null

    const { pullRequestState: stateAfterLoad } =
      this.repositoryStateCache.get(repository)
    const selectedFileAfterDiffLoad = stateAfterLoad?.commitSelection?.file

    if (selectedFileAfterDiffLoad?.id !== file.id) {
      // this means user has clicked on another file since loading the diff
      return
    }

    this.repositoryStateCache.updatePullRequestCommitSelection(
      repository,
      () => ({
        diff,
      })
    )

    this.emitUpdate()
  }

  public _setPullRequestFileListWidth(width: number): Promise<void> {
    this.pullRequestFileListWidth = {
      ...this.pullRequestFileListWidth,
      value: width,
    }
    setNumber(pullRequestFileListConfigKey, width)
    this.updatePullRequestResizableConstraints()
    this.emitUpdate()

    return Promise.resolve()
  }

  public _resetPullRequestFileListWidth(): Promise<void> {
    this.pullRequestFileListWidth = {
      ...this.pullRequestFileListWidth,
      value: defaultPullRequestFileListWidth,
    }
    localStorage.removeItem(pullRequestFileListConfigKey)
    this.updatePullRequestResizableConstraints()
    this.emitUpdate()

    return Promise.resolve()
  }

  public _updatePullRequestBaseBranch(
    repository: Repository,
    baseBranch: Branch
  ) {
    const { branchesState, pullRequestState } =
      this.repositoryStateCache.get(repository)
    const { tip } = branchesState

    if (tip.kind !== TipState.Valid) {
      return
    }

    if (pullRequestState === null) {
      // This would mean the user submitted PR after requesting base branch
      // update.
      return
    }

    this._initializePullRequestPreview(repository, baseBranch, tip.branch)
  }

  private setupPRMergeTreePromise(
    repository: Repository,
    baseBranch: Branch,
    compareBranch: Branch
  ) {
    this.setupMergabilityPromise(repository, baseBranch, compareBranch).then(
      (mergeStatus: MergeTreeResult | null) => {
        this.repositoryStateCache.updatePullRequestState(repository, () => ({
          mergeStatus,
        }))
        this.emitUpdate()
      }
    )
  }

  /** Stop background producers and durably drain this store's clone journal. */
  public async flushForShutdown(): Promise<void> {
    this.autoCloneStore.stop()
    // A renderer-owned Git child must not outlive the renderer. Persist the
    // paused/interrupted transition and await process-tree teardown before the
    // final journal drain; recovery can then restart only app-owned staging.
    await this.batchCloneStore.requestPause()
    await this.batchCloneStore.flush()
  }

  public async _quitApp(evenIfUpdating: boolean): Promise<void> {
    await runAfterRendererShutdown(() => {
      if (evenIfUpdating) {
        sendWillQuitEvenIfUpdatingSync()
      }

      quitApp()
    })
  }

  public _cancelQuittingApp() {
    resetRendererShutdown()
    this.autoCloneStore.start()
    sendCancelQuittingSync()
  }

  public _setPullRequestSuggestedNextAction(
    value: PullRequestSuggestedNextAction
  ) {
    this.pullRequestSuggestedNextAction = value

    localStorage.setItem(pullRequestSuggestedNextActionKey, value)

    this.emitUpdate()
  }

  private isResizePaneActive() {
    if (document.activeElement === null) {
      return false
    }

    const appMenuBar = document.getElementById('app-menu-bar')

    // Don't track windows menu items as focused elements for keeping
    // track of recently focused elements we want to act upon
    if (appMenuBar?.contains(document.activeElement)) {
      return this.resizablePaneActive
    }

    return (
      document.activeElement.closest(`.${resizableComponentClass}`) !== null
    )
  }

  public _appFocusedElementChanged() {
    const resizablePaneActive = this.isResizePaneActive()

    if (resizablePaneActive !== this.resizablePaneActive) {
      this.resizablePaneActive = resizablePaneActive
      this.emitUpdate()
    }
  }

  public _updateUnderlineLinks(underlineLinks: boolean) {
    if (underlineLinks !== this.underlineLinks) {
      this.underlineLinks = underlineLinks
      setBoolean(underlineLinksKey, underlineLinks)
      this.emitUpdate()
    }
  }

  public _updateShowDiffCheckMarks(showDiffCheckMarks: boolean) {
    if (showDiffCheckMarks !== this.showDiffCheckMarks) {
      this.showDiffCheckMarks = showDiffCheckMarks
      setBoolean(showDiffCheckMarksKey, showDiffCheckMarks)
      this.emitUpdate()
    }
  }

  /** This shouldn't be called directly. See 'Dispatcher'. */
  public _setSelectedCopilotModel(
    feature: CopilotFeature,
    model: string | null
  ) {
    const current = this.selectedCopilotModels[feature] ?? null
    if (model !== current) {
      if (model === null) {
        const updated = { ...this.selectedCopilotModels }
        delete updated[feature]
        this.selectedCopilotModels = updated
      } else {
        this.selectedCopilotModels = {
          ...this.selectedCopilotModels,
          [feature]: model,
        }
      }
      this.saveCopilotModelSelections()
    }
  }

  private loadCopilotModelSelections(): CopilotModelSelections {
    const raw = localStorage.getItem(selectedCopilotModelsKey)
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed as CopilotModelSelections
        }
      } catch {
        // fall through to migration
      }
    }

    // Migrate from the old single-model key
    const legacy = localStorage.getItem('selected-copilot-model')
    if (legacy !== null) {
      localStorage.removeItem('selected-copilot-model')
      const selections: CopilotModelSelections = {
        'commit-message-generation': legacy,
      }
      localStorage.setItem(selectedCopilotModelsKey, JSON.stringify(selections))
      return selections
    }

    return {}
  }

  private saveCopilotModelSelections() {
    const keys = Object.keys(this.selectedCopilotModels)
    if (keys.length === 0) {
      localStorage.removeItem(selectedCopilotModelsKey)
    } else {
      localStorage.setItem(
        selectedCopilotModelsKey,
        JSON.stringify(this.selectedCopilotModels)
      )
    }
  }

  /** This shouldn't be called directly. See 'Dispatcher'. */
  public _setSelectedCopilotModels(models: CopilotModelSelections) {
    this.selectedCopilotModels = { ...models }
    // The Preferences dialog keeps its own copy of the selections in
    // component state. If the user deletes/edits a BYOK provider through
    // the popup stack while the dialog is open, that local copy can still
    // reference a model that no longer exists; scrub on save so we never
    // resurrect a stale selection.
    this.scrubMissingCopilotModelSelections()
    this.saveCopilotModelSelections()
  }

  /**
   * Resolves a stored Copilot model selection (the composite key persisted in
   * `selectedCopilotModels`) into a {@link CopilotModelRequest} suitable for
   * {@link CopilotStore.generateCommitMessage}. BYOK provider secrets are
   * read from the OS keychain at call time.
   */
  private async resolveCopilotModelRequest(
    selection: string | null
  ): Promise<CopilotModelRequest> {
    if (selection === null) {
      return { kind: 'copilot', modelId: null }
    }

    const key = parseModelKey(selection)
    if (key.kind === 'copilot') {
      return {
        kind: 'copilot',
        modelId: key.modelId === '' ? null : key.modelId,
      }
    }

    const provider = this.byokProviders.find(p => p.id === key.providerId)
    const model = provider?.models.find(m => m.id === key.modelId)
    if (provider === undefined || model === undefined) {
      // Selection points at a deleted provider/model; fall back to default.
      return { kind: 'copilot', modelId: null }
    }

    let secret: string | null = null
    if (provider.authKind !== 'none') {
      try {
        secret = await getBYOKSecret(provider.id)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        throw new Error(
          `Could not read the credential for the custom Copilot provider ` +
            `'${provider.name}' from the OS keychain: ${message}`
        )
      }
    }

    if (provider.authKind !== 'none' && (secret === null || secret === '')) {
      throw new Error(
        `No ${
          provider.authKind === 'bearer' ? 'bearer token' : 'API key'
        } is stored for the custom Copilot provider '${provider.name}'. ` +
          `Open Settings → Copilot → Providers and re-enter the credential.`
      )
    }

    const providerConfig: CopilotProviderConfig = {
      type: provider.type,
      baseUrl: provider.baseUrl,
      ...(provider.wireApi ? { wireApi: provider.wireApi } : {}),
      ...(provider.type === 'azure' && provider.azureApiVersion
        ? { azure: { apiVersion: provider.azureApiVersion } }
        : {}),
      ...(secret !== null && provider.authKind === 'apiKey'
        ? { apiKey: secret }
        : {}),
      ...(secret !== null && provider.authKind === 'bearer'
        ? { bearerToken: secret }
        : {}),
    }

    return {
      kind: 'byok',
      modelId: model.id,
      provider: providerConfig,
      ...(model.reasoningEffort !== undefined
        ? { reasoningEffort: model.reasoningEffort }
        : {}),
      ...(provider.requestTimeoutSeconds !== undefined &&
      provider.requestTimeoutSeconds > 0
        ? { timeoutMs: provider.requestTimeoutSeconds * 1000 }
        : {}),
    }
  }

  /** This shouldn't be called directly. See 'Dispatcher'. */
  public async _addCopilotBYOKProvider(
    provider: IBYOKProvider,
    secret: string | null
  ): Promise<void> {
    // Write the secret first so a keychain failure doesn't leave a provider
    // in localStorage without its credentials.
    if (secret !== null && secret.length > 0) {
      await setBYOKSecret(provider.id, secret)
    }

    this.byokProviders = [...this.byokProviders, provider]
    saveBYOKProviders(this.byokProviders)

    this.emitUpdate()
  }

  /**
   * Updates a BYOK provider in place. Pass `secret = undefined` to leave the
   * stored secret untouched, `null` to clear it, or a string to overwrite it.
   *
   * This shouldn't be called directly. See 'Dispatcher'.
   */
  public async _updateCopilotBYOKProvider(
    provider: IBYOKProvider,
    secret: string | null | undefined
  ): Promise<void> {
    const idx = this.byokProviders.findIndex(p => p.id === provider.id)
    if (idx === -1) {
      // Treat as add to keep the call idempotent from the UI's perspective.
      return this._addCopilotBYOKProvider(provider, secret ?? null)
    }

    // Apply the keychain change first; if it throws, the persisted provider
    // and its in-memory copy stay consistent with the existing secret.
    if (secret === null) {
      await deleteBYOKSecret(provider.id)
    } else if (secret !== undefined && secret.length > 0) {
      await setBYOKSecret(provider.id, secret)
    }

    const updated = [...this.byokProviders]
    updated[idx] = provider
    saveBYOKProviders(updated)
    this.byokProviders = updated

    // If the user removed the model that was selected for any feature, fall
    // back to the default for that feature.
    this.scrubMissingCopilotModelSelections()

    this.emitUpdate()
  }

  /** This shouldn't be called directly. See 'Dispatcher'. */
  public async _deleteCopilotBYOKProvider(id: string): Promise<void> {
    if (!this.byokProviders.some(p => p.id === id)) {
      return
    }

    // Purge the secret first; on failure we keep the provider visible so the
    // user can retry rather than ending up with an orphaned keychain entry
    // and no UI to manage it.
    await deleteBYOKSecret(id)

    this.byokProviders = this.byokProviders.filter(p => p.id !== id)
    saveBYOKProviders(this.byokProviders)

    this.scrubMissingCopilotModelSelections()

    this.emitUpdate()
  }

  /**
   * Drops any per-feature model selection that points at a BYOK
   * provider/model that no longer exists, or at a Copilot model that is
   * no longer offered by the loaded model list. Copilot selections are
   * only scrubbed once we have a definitive model list (i.e. the list has
   * been fetched at least once); while still loading we leave them alone
   * so a transient empty list doesn't downgrade valid selections.
   */
  private scrubMissingCopilotModelSelections(): void {
    const updated: CopilotModelSelections = {}
    let changed = false
    const copilotModels = this.copilotModels
    for (const [feature, raw] of Object.entries(this.selectedCopilotModels)) {
      if (raw === undefined) {
        continue
      }
      const key = parseModelKey(raw)
      if (key.kind === 'byok') {
        const provider = this.byokProviders.find(p => p.id === key.providerId)
        if (
          provider === undefined ||
          !provider.models.some(m => m.id === key.modelId)
        ) {
          changed = true
          continue
        }
      } else if (
        key.kind === 'copilot' &&
        key.modelId !== '' &&
        copilotModels !== null &&
        !copilotModels.some(m => m.id === key.modelId)
      ) {
        changed = true
        continue
      }
      updated[feature as CopilotFeature] = raw
    }

    if (changed) {
      this.selectedCopilotModels = updated
      this.saveCopilotModelSelections()
    }
  }

  /** This shouldn't be called directly. See 'Dispatcher'. */
  public async _fetchCopilotModels(): Promise<void> {
    return this.fetchCopilotModelsForCurrentAccount()
  }

  private async fetchCopilotModelsForCurrentAccount(): Promise<void> {
    const account = this.getCopilotModelsAccount()
    if (account === undefined) {
      this.copilotModels = null
      this.emitUpdate()
      return
    }

    const models = await this.copilotStore.listModels(account)
    // Only overwrite the cached model list when we actually got a list back.
    // listModels() returns null when the result is unknown (the selected
    // account cannot use the SDK or an SDK failure has no prior cache);
    // treating that as an empty list would scrub the user's Copilot model
    // selections.
    if (models !== null) {
      this.copilotModels = [...models]
      this.scrubMissingCopilotModelSelections()
    } else {
      this.syncCopilotModelsFromCache()
    }
    this.emitUpdate()
  }

  public _setPreferAbsoluteDates(value: boolean) {
    if (value !== this.preferAbsoluteDates) {
      this.preferAbsoluteDates = value
      setPreferAbsoluteDates(value)
      this.emitUpdate()
    }
  }

  public _setBranchSortOrder(branchSortOrder: BranchSortOrder) {
    if (branchSortOrder === this.branchSortOrder) {
      return
    }

    this.branchSortOrder = branchSortOrder
    localStorage.setItem(branchSortOrderKey, branchSortOrder)
    this.emitUpdate()
  }

  public _updateFileListFilter(
    repository: Repository,
    filterUpdate: Partial<IFileListFilterState>
  ) {
    this.repositoryStateCache.updateChangesState(repository, state => ({
      fileListFilter: {
        ...state.fileListFilter,
        ...filterUpdate,
      },
    }))
    this.emitUpdate()
  }

  public _setChangesListFilterText(repository: Repository, filterText: string) {
    this._updateFileListFilter(repository, { filterText })
  }

  public _setIncludedChangesInCommitFilter(
    repository: Repository,
    isIncludedInCommit: boolean
  ) {
    this._updateFileListFilter(repository, { isIncludedInCommit })
  }

  public _setFilterNewFiles(repository: Repository, isNewFile: boolean) {
    this._updateFileListFilter(repository, { isNewFile })
  }

  public _setFilterModifiedFiles(
    repository: Repository,
    isModifiedFile: boolean
  ) {
    this._updateFileListFilter(repository, { isModifiedFile })
  }

  public _setFilterDeletedFiles(
    repository: Repository,
    isDeletedFile: boolean
  ) {
    this._updateFileListFilter(repository, { isDeletedFile })
  }

  public _setFilterExcludedFiles(
    repository: Repository,
    isExcludedFromCommit: boolean
  ) {
    this._updateFileListFilter(repository, { isExcludedFromCommit })
  }

  public async _createPushProtectionBypass(
    reason: BypassReasonType,
    placeholderId: string,
    bypassURL: string
  ): Promise<IAPICreatePushProtectionBypassResponse | null> {
    const repository = this.selectedRepository
    if (
      repository === null ||
      repository instanceof CloningRepository ||
      isRepositoryWithGitHubRepository(repository) === false
    ) {
      log.error('[_createPushProtectionBypass] - No GitHub repository selected')
      return null
    }

    const { endpoint, name, owner } = repository.gitHubRepository

    const account = getAccountForEndpoint(this.accounts, endpoint)

    if (account === null) {
      log.error(
        `[_createPushProtectionBypass] - No account found for endpoint - ${endpoint}`
      )
      return null
    }

    const api = API.fromAccount(account)

    return api.createPushProtectionBypass(
      owner.login,
      name,
      reason,
      placeholderId,
      bypassURL
    )
  }

  public _toggleChangesFilterVisibility() {
    this.showChangesFilter = !this.showChangesFilter
    setBoolean(showChangesFilterKey, this.showChangesFilter)
    this.updateMenuLabelsForSelectedRepository()
    this.emitUpdate()
  }
}

/**
 * Map the cached state of the compare view to an action
 * to perform which is then used to compute the compare
 * view contents.
 */
function getInitialAction(
  cachedState: IDisplayHistory | ICompareBranch
): CompareAction {
  if (cachedState.kind === HistoryTabMode.History) {
    return {
      kind: HistoryTabMode.History,
    }
  }

  const { comparisonMode, comparisonBranch } = cachedState

  return {
    kind: HistoryTabMode.Compare,
    comparisonMode,
    branch: comparisonBranch,
  }
}

function userIsStartingMultiCommitOperation(
  currentPopup: Popup | null,
  state: IMultiCommitOperationState | null
) {
  if (currentPopup === null || state === null) {
    return false
  }

  if (currentPopup.type !== PopupType.MultiCommitOperation) {
    return false
  }

  if (
    state.step.kind === MultiCommitOperationStepKind.ChooseBranch ||
    state.step.kind === MultiCommitOperationStepKind.WarnForcePush ||
    state.step.kind === MultiCommitOperationStepKind.ShowProgress
  ) {
    return true
  }

  return false
}

function isLocalChangesOverwrittenError(error: Error): boolean {
  if (error instanceof ErrorWithMetadata) {
    return isLocalChangesOverwrittenError(error.underlyingError)
  }

  return (
    error instanceof GitError &&
    error.result.gitError === DugiteError.LocalChangesOverwritten
  )
}

function worktreePathsEqual(left: string, right: string): boolean {
  const normalizedLeft = Path.resolve(left)
  const normalizedRight = Path.resolve(right)
  return __WIN32__
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function constrain(
  value: IConstrainedValue | number,
  min = -Infinity,
  max = Infinity
): IConstrainedValue {
  // Match CSS's behavior where min-width takes precedence over max-width
  // See https://stackoverflow.com/a/16063871
  const constrainedMax = max < min ? min : max
  return {
    value: typeof value === 'number' ? value : value.value,
    min,
    max: constrainedMax,
  }
}
