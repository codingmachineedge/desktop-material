import {
  Repository,
  RepositoryWithGitHubRepository,
  RepositoryWithForkedGitHubRepository,
} from './repository'
import { PullRequest } from './pull-request'
import { Branch } from './branch'
import { ReleaseNote, ReleaseSummary } from './release-notes'
import { IRemote } from './remote'
import { RetryAction } from './retry-actions'
import { WorkingDirectoryFileChange } from './status'
import { PreferencesTab } from './preferences'
import { Commit, CommitOneLine, ICommitContext } from './commit'
import { IStashEntry } from './stash-entry'
import { Account } from '../models/account'
import { Progress } from './progress'
import { ITextDiff, DiffSelection, ImageDiffType } from './diff'
import { RepositorySettingsTab } from '../ui/repository-settings/repository-settings'
import { ICommitMessage } from './commit-message'
import { Author, UnknownAuthor } from './author'
import { IRefCheck } from '../lib/ci-checks/ci-checks'
import { GitHubRepository } from './github-repository'
import { ValidNotificationPullRequestReview } from '../lib/valid-notification-pull-request-review'
import { UnreachableCommitsTab } from '../ui/history/unreachable-commits-dialog'
import { IAPIComment } from '../lib/api'
import { ISecretScanResult } from '../ui/secret-scanning/push-protection-error-dialog'
import { BypassReasonType } from '../ui/secret-scanning/bypass-push-protection-dialog'
import {
  IManagedSubmodule,
  TerminalOutput,
  TerminalOutputListener,
} from '../lib/git'
import type { IBYOKModel, IBYOKProvider } from '../lib/copilot/byok'
import { WorktreeEntry } from './worktree'
import { MergeAllMode } from '../lib/automation/merge-all'
import { IGitHubPullRequestTarget } from '../lib/github-pull-request'
import { IGitModulesEntry } from '../lib/git/gitmodules'
import { BuildStageKind } from '../lib/build-run/types'
import { INotificationEntry } from './notification-centre'
import {
  IGitLabMergeRequestBranchContext,
  IGitLabMergeRequestWorkspaceRoute,
} from '../lib/gitlab-merge-request-workspace'

/**
 * The captured failure context handed to the "Fix with opencode" dialog. Built
 * by the Build & Run panel from the failed run's view state; the dialog forwards
 * it to `Dispatcher.runOpencodeFix` (which composes the prompt from it).
 */
export interface IOpencodeFixFailure {
  /** Which build stage failed (`install` / `build` / `run`). */
  readonly stageKind: BuildStageKind
  /** The failing stage's process exit code. */
  readonly exitCode: number
  /** The tail of the streamed run output, embedded (bounded) in the prompt. */
  readonly tailText: string
  /** The working directory the failed profile ran in (the agent's `--dir`). */
  readonly cwd: string
}

export enum PopupType {
  RenameBranch = 'RenameBranch',
  DeleteBranch = 'DeleteBranch',
  DeleteRemoteBranch = 'DeleteRemoteBranch',
  ConfirmDiscardChanges = 'ConfirmDiscardChanges',
  Preferences = 'Preferences',
  SettingsHistory = 'SettingsHistory',
  NotificationHistory = 'NotificationHistory',
  NotificationAutomations = 'NotificationAutomations',
  LogHistory = 'LogHistory',
  FileHistory = 'FileHistory',
  CreateGitHubIssue = 'CreateGitHubIssue',
  CreateGitHubPullRequest = 'CreateGitHubPullRequest',
  GitHubPullRequestLifecycle = 'GitHubPullRequestLifecycle',
  GitLabMergeRequest = 'GitLabMergeRequest',
  BranchRules = 'BranchRules',
  SparseCheckout = 'SparseCheckout',
  RepositorySettings = 'RepositorySettings',
  AddSubmodule = 'AddSubmodule',
  CloneableSubmodules = 'CloneableSubmodules',
  SubmoduleManager = 'SubmoduleManager',
  SubmoduleConfig = 'SubmoduleConfig',
  SubtreeManager = 'SubtreeManager',
  AddSubtree = 'AddSubtree',
  AddRepository = 'AddRepository',
  CreateRepository = 'CreateRepository',
  CloneRepository = 'CloneRepository',
  CreateBranch = 'CreateBranch',
  SignIn = 'SignIn',
  About = 'About',
  InstallGit = 'InstallGit',
  PublishRepository = 'PublishRepository',
  Acknowledgements = 'Acknowledgements',
  UntrustedCertificate = 'UntrustedCertificate',
  RemoveRepository = 'RemoveRepository',
  TermsAndConditions = 'TermsAndConditions',
  PushBranchCommits = 'PushBranchCommits',
  CLIInstalled = 'CLIInstalled',
  GenericGitAuthentication = 'GenericGitAuthentication',
  ExternalEditorFailed = 'ExternalEditorFailed',
  OpenWithExternalEditor = 'OpenWithExternalEditor',
  OpenShellFailed = 'OpenShellFailed',
  InitializeLFS = 'InitializeLFS',
  LFSAttributeMismatch = 'LFSAttributeMismatch',
  UpstreamAlreadyExists = 'UpstreamAlreadyExists',
  ReleaseNotes = 'ReleaseNotes',
  DeletePullRequest = 'DeletePullRequest',
  OversizedFiles = 'OversizedFiles',
  CommitConflictsWarning = 'CommitConflictsWarning',
  PushNeedsPull = 'PushNeedsPull',
  ConfirmForcePush = 'ConfirmForcePush',
  StashAndSwitchBranch = 'StashAndSwitchBranch',
  ConfirmDiscardStash = 'ConfirmDiscardStash',
  ConfirmCheckoutCommit = 'ConfirmCheckoutCommit',
  ConfirmDeletePushedTag = 'ConfirmDeletePushedTag',
  CreateTutorialRepository = 'CreateTutorialRepository',
  ConfirmExitTutorial = 'ConfirmExitTutorial',
  PushRejectedDueToMissingWorkflowScope = 'PushRejectedDueToMissingWorkflowScope',
  SAMLReauthRequired = 'SAMLReauthRequired',
  CreateFork = 'CreateFork',
  CreateTag = 'CreateTag',
  DeleteTag = 'DeleteTag',
  LocalChangesOverwritten = 'LocalChangesOverwritten',
  ChooseForkSettings = 'ChooseForkSettings',
  ConfirmDiscardSelection = 'ConfirmDiscardSelection',
  MoveToApplicationsFolder = 'MoveToApplicationsFolder',
  ChangeRepositoryAlias = 'ChangeRepositoryAlias',
  ChangeRepositoryGroupName = 'ChangeRepositoryGroupName',
  ThankYou = 'ThankYou',
  CommitMessage = 'CommitMessage',
  MultiCommitOperation = 'MultiCommitOperation',
  WarnLocalChangesBeforeUndo = 'WarnLocalChangesBeforeUndo',
  WarnUndoPushedCommit = 'WarnUndoPushedCommit',
  WarningBeforeReset = 'WarningBeforeReset',
  WarnResetToPushedCommit = 'WarnResetToPushedCommit',
  InvalidatedToken = 'InvalidatedToken',
  InsufficientOAuthScopes = 'InsufficientOAuthScopes',
  CommandPalette = 'CommandPalette',
  AddSSHHost = 'AddSSHHost',
  SSHKeyPassphrase = 'SSHKeyPassphrase',
  SSHUserPassword = 'SSHUserPassword',
  PullRequestChecksFailed = 'PullRequestChecksFailed',
  CICheckRunRerun = 'CICheckRunRerun',
  WarnForcePush = 'WarnForcePush',
  DiscardChangesRetry = 'DiscardChangesRetry',
  PullRequestReview = 'PullRequestReview',
  UnreachableCommits = 'UnreachableCommits',
  StartPullRequest = 'StartPullRequest',
  Error = 'Error',
  InstallingUpdate = 'InstallingUpdate',
  TestNotifications = 'TestNotifications',
  PullRequestComment = 'PullRequestComment',
  UnknownAuthors = 'UnknownAuthors',
  TestIcons = 'TestIcons',
  ConfirmCommitFilteredChanges = 'ConfirmCommitFilteredChanges',
  TestAbout = 'TestAbout',
  TestCLIAction = 'TestCLIAction',
  PushProtectionError = 'PushProtectionError',
  BypassPushProtection = 'BypassPushProtection',
  GenerateCommitMessageOverrideWarning = 'GenerateCommitMessageOverrideWarning',
  GenerateCommitMessageDisclaimer = 'GenerateCommitMessageDisclaimer',
  CopilotConflictResolutionDisclaimer = 'CopilotConflictResolutionDisclaimer',
  HookFailed = 'HookFailed',
  CommitProgress = 'CommitProgress',
  AddWorktree = 'AddWorktree',
  RenameWorktree = 'RenameWorktree',
  DeleteWorktree = 'DeleteWorktree',
  EditCopilotBYOKProvider = 'EditCopilotBYOKProvider',
  EditCopilotBYOKModel = 'EditCopilotBYOKModel',
  ConfirmDeleteCopilotBYOKProvider = 'ConfirmDeleteCopilotBYOKProvider',
  CopilotConflictResolutionAlwaysNudge = 'CopilotConflictResolutionAlwaysNudge',
  DeleteWorktreeFailed = 'DeleteWorktreeFailed',
  BatchCloneProgress = 'BatchCloneProgress',
  ExportRepositoryList = 'ExportRepositoryList',
  ImportRepositoryList = 'ImportRepositoryList',
  ExportTabSession = 'ExportTabSession',
  ImportTabSession = 'ImportTabSession',
  MergeAll = 'MergeAll',
  PullAllRepositories = 'PullAllRepositories',
  CommitAndPushAll = 'CommitAndPushAll',
  OpencodeFix = 'OpencodeFix',
}

interface IBasePopup {
  /**
   * Unique id of the popup that it receives upon adding to the stack.
   */
  readonly id?: number
}

/**
 * Narrows the settings-history viewer to a single subject instead of the whole
 * profile. Absent scope means the full-profile history (undo/redo/restore
 * enabled); a scope makes the view read-only, since those mutations act on the
 * entire profile and cannot be applied to one tab in isolation.
 */
export type SettingsHistoryScope = {
  readonly kind: 'tab'
  /** The stable tab id used to filter the profile repository's history. */
  readonly tabId: string
  /** The tab's display label, shown in the scoped dialog title. */
  readonly label: string
}

export type PopupDetail =
  | { type: PopupType.RenameBranch; repository: Repository; branch: Branch }
  | {
      type: PopupType.DeleteBranch
      repository: Repository
      branch: Branch
      existsOnRemote: boolean
    }
  | {
      type: PopupType.DeleteRemoteBranch
      repository: Repository
      branch: Branch
    }
  | {
      type: PopupType.ConfirmDiscardChanges
      repository: Repository
      files: ReadonlyArray<WorkingDirectoryFileChange>
      showDiscardChangesSetting?: boolean
      discardingAllChanges?: boolean
      permanentlyDelete?: boolean
    }
  | {
      type: PopupType.ConfirmDiscardSelection
      repository: Repository
      file: WorkingDirectoryFileChange
      diff: ITextDiff
      selection: DiffSelection
    }
  | { type: PopupType.Preferences; initialSelectedTab?: PreferencesTab }
  | { type: PopupType.SettingsHistory; scope?: SettingsHistoryScope }
  | { type: PopupType.NotificationHistory }
  | { type: PopupType.NotificationAutomations; entry?: INotificationEntry }
  | { type: PopupType.LogHistory }
  | { type: PopupType.FileHistory; repository: Repository; path: string }
  | { type: PopupType.CreateGitHubIssue; repository: Repository }
  | {
      type: PopupType.CreateGitHubPullRequest
      repository: RepositoryWithGitHubRepository
      currentBranch: Branch
      sourceRemote: IRemote | null
      providerHTMLURL: string
      targets: ReadonlyArray<IGitHubPullRequestTarget>
      initialTargetHash: string
      initialBaseBranchName: string | null
      contextVersion: string
    }
  | {
      type: PopupType.GitHubPullRequestLifecycle
      repository: RepositoryWithGitHubRepository
      pullRequest: PullRequest
      baseBranchNames: ReadonlyArray<string>
    }
  | {
      type: PopupType.GitLabMergeRequest
      repository: RepositoryWithGitHubRepository
      route: IGitLabMergeRequestWorkspaceRoute
      branchContext: IGitLabMergeRequestBranchContext
      contextVersion: string
      intent:
        | { readonly kind: 'create' }
        | { readonly kind: 'manage'; readonly mergeRequestIID: number }
    }
  | {
      type: PopupType.BranchRules
      repository: Repository
      initialBranch: string
    }
  | { type: PopupType.SparseCheckout; repository: Repository }
  | { type: PopupType.MergeAll; repository: Repository; mode: MergeAllMode }
  | { type: PopupType.PullAllRepositories }
  | { type: PopupType.CommitAndPushAll }
  | {
      type: PopupType.EditCopilotBYOKProvider
      provider: IBYOKProvider | null
    }
  | {
      type: PopupType.EditCopilotBYOKModel
      model: IBYOKModel | null
      otherModelIds: ReadonlyArray<string>
      onSave: (model: IBYOKModel) => void
    }
  | {
      type: PopupType.ConfirmDeleteCopilotBYOKProvider
      provider: IBYOKProvider
    }
  | {
      type: PopupType.RepositorySettings
      repository: Repository
      initialSelectedTab?: RepositorySettingsTab
    }
  | {
      type: PopupType.AddSubmodule
      repository: Repository
      onAdded: () => void | Promise<void>
    }
  | {
      type: PopupType.CloneableSubmodules
      /** The `owner/name` (or friendly name) of the inspected repository. */
      parentName: string
      /** The clone URL relative submodule URLs are resolved against. */
      parentCloneUrl: string
      /** The parsed `.gitmodules` entries of the inspected repository. */
      entries: ReadonlyArray<IGitModulesEntry>
      /**
       * Overrides how a per-submodule clone is launched, letting an already
       * open clone dialog take the URL instead of opening a second dialog.
       */
      onCloneUrl?: (url: string) => void
    }
  | {
      type: PopupType.SubmoduleManager
      repository: Repository
    }
  | {
      type: PopupType.SubmoduleConfig
      repository: Repository
      /** The reconciled submodule whose configuration is being edited. */
      submodule: IManagedSubmodule
    }
  | {
      type: PopupType.SubtreeManager
      repository: Repository
    }
  | {
      type: PopupType.AddSubtree
      repository: Repository
      onAdded: () => void | Promise<void>
    }
  | { type: PopupType.AddRepository; path?: string }
  | { type: PopupType.CreateRepository; path?: string }
  | {
      type: PopupType.CloneRepository
      initialURL: string | null
    }
  | {
      type: PopupType.CreateBranch
      repository: Repository
      initialName?: string
      targetCommit?: CommitOneLine
    }
  | {
      type: PopupType.SignIn
      isCredentialHelperSignIn?: boolean
      credentialHelperUrl?: string
    }
  | { type: PopupType.About }
  | { type: PopupType.InstallGit; path: string }
  | { type: PopupType.PublishRepository; repository: Repository }
  | { type: PopupType.Acknowledgements }
  | {
      type: PopupType.UntrustedCertificate
      certificate: Electron.Certificate
      url: string
    }
  | { type: PopupType.RemoveRepository; repository: Repository }
  | { type: PopupType.TermsAndConditions }
  | {
      type: PopupType.PushBranchCommits
      repository: Repository
      branch: Branch
      unPushedCommits?: number
      baseBranch?: Branch
    }
  | { type: PopupType.CLIInstalled }
  | {
      type: PopupType.GenericGitAuthentication
      remoteUrl: string
      username?: string
      onSubmit: (username: string, password: string) => void
      onDismiss: () => void
    }
  | { type: PopupType.OpenWithExternalEditor }
  | {
      type: PopupType.ExternalEditorFailed
      message: string
      suggestDefaultEditor?: boolean
      openPreferences?: boolean
    }
  | { type: PopupType.OpenShellFailed; message: string }
  | { type: PopupType.InitializeLFS; repositories: ReadonlyArray<Repository> }
  | { type: PopupType.LFSAttributeMismatch }
  | {
      type: PopupType.UpstreamAlreadyExists
      repository: Repository
      existingRemote: IRemote
    }
  | {
      type: PopupType.ReleaseNotes
      newReleases: ReadonlyArray<ReleaseSummary>
    }
  | {
      type: PopupType.DeletePullRequest
      repository: Repository
      branch: Branch
      pullRequest: PullRequest
    }
  | {
      type: PopupType.OversizedFiles
      oversizedFiles: ReadonlyArray<string>
      context: ICommitContext
      repository: Repository
    }
  | {
      type: PopupType.CommitConflictsWarning
      /** files that were selected for committing that are also conflicted */
      files: ReadonlyArray<WorkingDirectoryFileChange>
      /** repository user is committing in */
      repository: Repository
      /** information for completing the commit */
      context: ICommitContext
    }
  | {
      type: PopupType.PushNeedsPull
      repository: Repository
    }
  | {
      type: PopupType.ConfirmForcePush
      repository: Repository
      upstreamBranch: string
    }
  | {
      type: PopupType.StashAndSwitchBranch
      repository: Repository
      branchToCheckout: Branch
    }
  | {
      type: PopupType.ConfirmDiscardStash
      repository: Repository
      stash: IStashEntry
    }
  | {
      type: PopupType.ConfirmCheckoutCommit
      repository: Repository
      commit: CommitOneLine
    }
  | {
      type: PopupType.CreateTutorialRepository
      account: Account
      progress?: Progress
    }
  | {
      type: PopupType.ConfirmExitTutorial
    }
  | {
      type: PopupType.PushRejectedDueToMissingWorkflowScope
      rejectedPath: string
      repository: RepositoryWithGitHubRepository
    }
  | {
      type: PopupType.SAMLReauthRequired
      organizationName: string
      endpoint: string
      retryAction?: RetryAction
    }
  | {
      type: PopupType.CreateFork
      repository: RepositoryWithGitHubRepository
      account: Account
    }
  | {
      type: PopupType.CreateTag
      repository: Repository
      targetCommitSha: string
      initialName?: string
      localTags: Map<string, string> | null
    }
  | {
      type: PopupType.DeleteTag
      repository: Repository
      tagName: string
    }
  | {
      type: PopupType.ChooseForkSettings
      repository: RepositoryWithForkedGitHubRepository
    }
  | {
      type: PopupType.LocalChangesOverwritten
      repository: Repository
      retryAction: RetryAction
      files: ReadonlyArray<string>
    }
  | { type: PopupType.MoveToApplicationsFolder }
  | { type: PopupType.ChangeRepositoryAlias; repository: Repository }
  | { type: PopupType.ChangeRepositoryGroupName; repository: Repository }
  | {
      type: PopupType.ThankYou
      userContributions: ReadonlyArray<ReleaseNote>
      friendlyName: string
      latestVersion: string | null
    }
  | {
      type: PopupType.CommitMessage
      coAuthors: ReadonlyArray<Author>
      showCoAuthoredBy: boolean
      commitMessage: ICommitMessage | null
      dialogTitle: string
      dialogButtonText: string
      prepopulateCommitSummary: boolean
      repository: Repository
      onSubmitCommitMessage: (context: ICommitContext) => Promise<boolean>
    }
  | {
      type: PopupType.MultiCommitOperation
      repository: Repository
    }
  | {
      type: PopupType.WarnLocalChangesBeforeUndo
      repository: Repository
      commit: Commit
      isWorkingDirectoryClean: boolean
    }
  | {
      type: PopupType.WarningBeforeReset
      repository: Repository
      commit: Commit
    }
  | {
      type: PopupType.WarnUndoPushedCommit
      repository: Repository
      commit: Commit
    }
  | {
      type: PopupType.WarnResetToPushedCommit
      repository: Repository
      commit: Commit
    }
  | {
      type: PopupType.ConfirmDeletePushedTag
      repository: Repository
      tagName: string
    }
  | {
      type: PopupType.InsufficientOAuthScopes
      account: Account
      missingScopes: ReadonlyArray<string>
    }
  | { type: PopupType.CommandPalette }
  | {
      type: PopupType.InvalidatedToken
      account: Account
    }
  | {
      type: PopupType.AddSSHHost
      host: string
      ip: string
      keyType: string
      fingerprint: string
      onSubmit: (addHost: boolean) => void
    }
  | {
      type: PopupType.SSHKeyPassphrase
      keyPath: string
      onSubmit: (
        passphrase: string | undefined,
        storePassphrase: boolean
      ) => void
    }
  | {
      type: PopupType.SSHUserPassword
      username: string
      onSubmit: (password: string | undefined, storePassword: boolean) => void
    }
  | {
      type: PopupType.PullRequestChecksFailed
      repository: RepositoryWithGitHubRepository
      pullRequest: PullRequest
      shouldChangeRepository: boolean
      checks: ReadonlyArray<IRefCheck>
    }
  | {
      type: PopupType.CICheckRunRerun
      checkRuns: ReadonlyArray<IRefCheck>
      repository: GitHubRepository
      prRef: string
      failedOnly: boolean
    }
  | { type: PopupType.WarnForcePush; operation: string; onBegin: () => void }
  | {
      type: PopupType.DiscardChangesRetry
      retryAction: RetryAction
    }
  | {
      type: PopupType.PullRequestReview
      repository: RepositoryWithGitHubRepository
      pullRequest: PullRequest
      review: ValidNotificationPullRequestReview
      shouldCheckoutBranch: boolean
      shouldChangeRepository: boolean
    }
  | {
      type: PopupType.UnreachableCommits
      selectedTab: UnreachableCommitsTab
    }
  | {
      type: PopupType.StartPullRequest
      prBaseBranches: ReadonlyArray<Branch>
      currentBranch: Branch
      defaultBranch: Branch | null
      externalEditorLabel?: string
      imageDiffType: ImageDiffType
      prRecentBaseBranches: ReadonlyArray<Branch>
      repository: Repository
      nonLocalCommitSHA: string | null
      showSideBySideDiff: boolean
      currentBranchHasPullRequest: boolean
    }
  | {
      type: PopupType.Error
      error: Error
    }
  | {
      type: PopupType.InstallingUpdate
    }
  | {
      type: PopupType.TestNotifications
      repository: RepositoryWithGitHubRepository
    }
  | {
      type: PopupType.PullRequestComment
      repository: RepositoryWithGitHubRepository
      pullRequest: PullRequest
      comment: IAPIComment
      shouldCheckoutBranch: boolean
      shouldChangeRepository: boolean
    }
  | {
      type: PopupType.UnknownAuthors
      authors: ReadonlyArray<UnknownAuthor>
      onCommit: () => void
    }
  | {
      type: PopupType.TestIcons
    }
  | {
      type: PopupType.ConfirmCommitFilteredChanges
      onCommitAnyway: () => void
      showFilesToBeCommitted: () => void
    }
  | {
      type: PopupType.TestAbout
    }
  | {
      type: PopupType.TestCLIAction
    }
  | {
      type: PopupType.PushProtectionError
      secrets: ReadonlyArray<ISecretScanResult>
    }
  | {
      type: PopupType.BypassPushProtection
      secret: ISecretScanResult
      bypassPushProtection: (
        secret: ISecretScanResult,
        reason: BypassReasonType
      ) => void
      onDismissed: () => void
    }
  | {
      type: PopupType.GenerateCommitMessageOverrideWarning
      repository: Repository
      filesSelected: ReadonlyArray<WorkingDirectoryFileChange>
    }
  | {
      type: PopupType.GenerateCommitMessageDisclaimer
      // Same parameters as PopupType.GenerateCommitMessageOverrideWarning because
      // from this popup we will trigger the commit message generation too.
      repository: Repository
      filesSelected: ReadonlyArray<WorkingDirectoryFileChange>
    }
  | {
      type: PopupType.CopilotConflictResolutionDisclaimer
      repository: Repository
    }
  | {
      type: PopupType.CopilotConflictResolutionAlwaysNudge
      repository: Repository
    }
  | {
      type: PopupType.HookFailed
      hookName: string
      terminalOutput: TerminalOutput
      resolve: (value: 'abort' | 'ignore') => void
    }
  | {
      type: PopupType.CommitProgress
      subscribeToCommitOutput: TerminalOutputListener
    }
  | {
      type: PopupType.AddWorktree
      repository: Repository
      initialBranchName?: string
      initialWorktreeName?: string
      /**
       * Anchors the worktree at this commit-ish: a new branch is created at
       * it inside the new worktree (right-click a History commit → create
       * worktree from commit).
       */
      commitish?: string
    }
  | {
      type: PopupType.RenameWorktree
      repository: Repository
      worktreePath: string
    }
  | {
      type: PopupType.DeleteWorktree
      repository: Repository
      worktreePath: string
    }
  | {
      type: PopupType.DeleteWorktreeFailed
      repository: Repository
      worktreePath: string
      error: Error
      originalWorktree: WorktreeEntry | null
    }
  | {
      type: PopupType.BatchCloneProgress
    }
  | {
      type: PopupType.ExportRepositoryList
      repositories: ReadonlyArray<Repository>
    }
  | {
      type: PopupType.ImportRepositoryList
      existingRepositories: ReadonlyArray<Repository>
    }
  | {
      type: PopupType.ExportTabSession
    }
  | {
      type: PopupType.ImportTabSession
      existingRepositories: ReadonlyArray<Repository>
    }
  | {
      type: PopupType.OpencodeFix
      repository: Repository
      failure: IOpencodeFixFailure
    }
export type Popup = IBasePopup & PopupDetail

/**
 * History managers and repository utility sheets are non-modal, and background
 * progress popups stay interactive while repository work continues. Every
 * other popup still blocks global actions, even when one of these is stacked
 * above it.
 */
const nonModalHistoryPopupTypes = new Set<PopupType>([
  PopupType.SettingsHistory,
  PopupType.NotificationHistory,
  PopupType.LogHistory,
  PopupType.FileHistory,
  PopupType.BranchRules,
  PopupType.SparseCheckout,
  PopupType.BatchCloneProgress,
  PopupType.ChangeRepositoryGroupName,
  PopupType.PullAllRepositories,
])

export function hasModalPopup(popups: ReadonlyArray<Popup>): boolean {
  return popups.some(popup => !nonModalHistoryPopupTypes.has(popup.type))
}
