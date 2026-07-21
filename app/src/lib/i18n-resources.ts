export type TranslationKey =
  | 'ci.status'
  | 'ci.successful'
  | 'ci.failed'
  | 'ci.inProgress'
  | 'ci.timedOut'
  | 'ci.actionRequired'
  | 'ci.neutral'
  | 'ci.cancelled'
  | 'ci.skipped'
  | 'ci.stale'
  | 'update.downloadingLabel'
  | 'update.downloadingValue'
  | 'appearance.updateProgressColor'
  | 'appearance.useAccentColor'
  | 'appearance.languageMode'
  | 'appearance.languageModeDescription'
  | 'appearance.languageAndNavigation'
  | 'appearance.submoduleBackStyle'
  | 'appearance.submoduleBackLabel'
  | 'appearance.toolbarEditorTitle'
  | 'appearance.toolbarEditorDescription'
  | 'appearance.repositoryToolbarEditorTitle'
  | 'appearance.repositoryToolbarEditorDescription'
  | 'appearance.toolbarTypographyHeading'
  | 'appearance.toolbarTypographyProfile'
  | 'appearance.toolbarTypographyRepositoryInherited'
  | 'appearance.toolbarTypographyRepositoryOverride'
  | 'appearance.toolbarTypographyThemeDefaults'
  | 'appearance.toolbarTypographyInheritProfile'
  | 'appearance.toolbarTypographyPreview'
  | 'appearance.toolbarTypographyPreviewTitle'
  | 'appearance.toolbarTypographyPreviewDescription'
  | 'appearance.toolbarFontStyle'
  | 'appearance.toolbarBold'
  | 'appearance.toolbarItalic'
  | 'appearance.toolbarUnderline'
  | 'appearance.toolbarStrikethrough'
  | 'appearance.toolbarAlignment'
  | 'appearance.toolbarAlignLeft'
  | 'appearance.toolbarAlignCenter'
  | 'appearance.toolbarAlignRight'
  | 'appearance.toolbarFont'
  | 'appearance.toolbarThemeFont'
  | 'appearance.toolbarInheritFont'
  | 'appearance.toolbarSize'
  | 'appearance.toolbarThemeSize'
  | 'appearance.toolbarInheritSize'
  | 'appearance.toolbarLetterCase'
  | 'appearance.toolbarNormalCase'
  | 'appearance.toolbarUppercase'
  | 'appearance.toolbarLowercase'
  | 'appearance.toolbarCapitalize'
  | 'appearance.toolbarSmallCaps'
  | 'appearance.toolbarSpacing'
  | 'appearance.toolbarThemeSpacing'
  | 'appearance.toolbarInheritSpacing'
  | 'appearance.toolbarTextEffect'
  | 'appearance.toolbarNoEffect'
  | 'appearance.toolbarSoftShadow'
  | 'appearance.toolbarStrongShadow'
  | 'appearance.toolbarTextColor'
  | 'appearance.toolbarThemeColor'
  | 'appearance.toolbarInheritColor'
  | 'appearance.toolbarCustomColor'
  | 'tabs.appearanceLoading'
  | 'tabs.settingsCommitSaved'
  | 'tabs.settingsCommitCommitted'
  | 'tabs.settingsCommitTitle'
  | 'tabs.settingsHistory'
  | 'tabs.undoSettingsChange'
  | 'tabs.redoSettingsChange'
  | 'tabs.settingsChangeUndone'
  | 'tabs.settingsChangeRedone'
  | 'language.english'
  | 'language.cantonese'
  | 'language.bilingual'
  | 'submodule.backStyleTonal'
  | 'submodule.backStyleFilled'
  | 'submodule.backStyleOutlined'
  | 'submodule.backLabelFull'
  | 'submodule.backLabelParent'
  | 'submodule.backLabelIcon'
  | 'submodule.openAsRepository'
  | 'submodule.temporaryOpenDescription'
  | 'submodule.appearanceHeading'
  | 'submodule.appearanceDescription'
  | 'submodule.appearancePreview'
  | 'submodule.openUnavailable'
  | 'submodule.openFailed'
  | 'submodule.returnFailed'
  | 'submodule.workspaceUnsafe'
  | 'submodule.temporaryRemovalUnavailable'
  | 'submodule.temporarySettingsUnavailable'
  | 'submodule.navigation'
  | 'submodule.backToParent'
  | 'submodule.viewingContext'
  | 'submodule.managerTitle'
  | 'submodule.managerClose'
  | 'submodule.title'
  | 'submodule.addAction'
  | 'submodule.addTooltip'
  | 'submodule.updateAllAction'
  | 'submodule.updateAllTooltip'
  | 'submodule.syncAction'
  | 'submodule.syncTooltip'
  | 'submodule.configureAction'
  | 'submodule.configureTooltip'
  | 'submodule.removeAction'
  | 'submodule.removeTooltip'
  | 'submodule.listFailed'
  | 'submodule.updateAllFailed'
  | 'submodule.updateFailed'
  | 'submodule.syncFailed'
  | 'submodule.removeFailed'
  | 'submodule.temporaryToolsReadOnly'
  | 'submodule.summarySingle'
  | 'submodule.summaryMultiple'
  | 'submodule.summaryCloned'
  | 'submodule.summaryNotCloned'
  | 'submodule.statusUninitialized'
  | 'submodule.statusUpToDate'
  | 'submodule.statusOutOfDate'
  | 'submodule.statusConflicted'
  | 'submodule.searchPlaceholder'
  | 'submodule.searchAriaLabel'
  | 'submodule.filterByStatus'
  | 'submodule.filterAll'
  | 'submodule.filterCloned'
  | 'submodule.filterNotCloned'
  | 'submodule.filterOutOfDate'
  | 'submodule.filterConflicted'
  | 'submodule.loading'
  | 'submodule.none'
  | 'submodule.noMatches'
  | 'submodule.cloneAction'
  | 'submodule.cloneTooltip'
  | 'submodule.updateAction'
  | 'submodule.updateTooltip'
  | 'submodule.addDialogTitle'
  | 'submodule.addSubmitAction'
  | 'submodule.addCancelAction'
  | 'submodule.addCancelOperationAction'
  | 'submodule.addDoneAction'
  | 'submodule.addSignInAction'
  | 'submodule.addDotComSignInGuidance'
  | 'submodule.addEnterpriseSignInGuidance'
  | 'submodule.addProviderAccountAction'
  | 'submodule.addProviderSignInGuidance'
  | 'submodule.addCreateRemoteTab'
  | 'submodule.addCreateAndAddAction'
  | 'submodule.addCreateRemoteSignInGuidance'
  | 'submodule.addRemoteCreatedHeading'
  | 'submodule.addRemoteCreatedRetryHelp'
  | 'submodule.addRemoteOwnerLabel'
  | 'submodule.addRemoteNameLabel'
  | 'submodule.addRemoteDescriptionLabel'
  | 'submodule.addRemotePrivateLabel'
  | 'submodule.addRemoteNameHelp'
  | 'submodule.addRemoteDescriptionHelp'
  | 'submodule.addRemoteInitializeHelp'
  | 'submodule.addRemoteAccountRequiredError'
  | 'submodule.addRemoteOwnerUnavailableError'
  | 'submodule.addRemoteNameRequiredError'
  | 'submodule.addRemoteNameLengthError'
  | 'submodule.addRemoteNameCharactersError'
  | 'submodule.addRemoteDescriptionLengthError'
  | 'submodule.addRemoteDescriptionCharactersError'
  | 'submodule.addCreatingRemoteProgress'
  | 'submodule.addRemoteCreatedProgress'
  | 'submodule.addRemoteCreatedButAddFailed'
  | 'submodule.addRemoteCreateFailed'
  | 'submodule.addRemoteCreateCancelledUncertain'
  | 'submodule.addOrganizationLoadFailed'
  | 'submodule.addTryAgainAction'
  | 'submodule.addRepositoryListLabel'
  | 'submodule.addRepositoryFilterPlaceholder'
  | 'submodule.addRepositoryUrlLabel'
  | 'submodule.addRepositoryUrlHelp'
  | 'submodule.addPathLabel'
  | 'submodule.addBranchLabel'
  | 'submodule.addRemoteDefaultBranchPlaceholder'
  | 'submodule.addPathChecking'
  | 'submodule.addPathHelp'
  | 'submodule.addBranchHelp'
  | 'submodule.addReviewLabel'
  | 'submodule.addReviewHeading'
  | 'submodule.addReviewRepositoryLabel'
  | 'submodule.addReviewChooseSource'
  | 'submodule.addReviewSuperprojectLabel'
  | 'submodule.addReviewCheckoutPathLabel'
  | 'submodule.addReviewNotSet'
  | 'submodule.addReviewTrackedBranchLabel'
  | 'submodule.addReviewRemoteDefault'
  | 'submodule.addProgressHeading'
  | 'submodule.addProgressLabel'
  | 'submodule.addSuccessHeading'
  | 'submodule.addSuccessDescription'
  | 'submodule.addAddingProgress'
  | 'submodule.addCancellingProgress'
  | 'submodule.addCheckingProgress'
  | 'submodule.addAddedProgress'
  | 'submodule.addCancelledError'
  | 'submodule.addFailed'
  | 'submodule.addPathValidationFailed'
  | 'submodule.addPathRequiredError'
  | 'submodule.addPathRelativeError'
  | 'submodule.addPathSegmentsError'
  | 'submodule.addPathGitMetadataError'
  | 'submodule.addPathDuplicateError'
  | 'submodule.addBranchInvalidError'
  | 'submodule.addSourceRequiredError'
  | 'submodule.addSourceControlCharacterError'
  | 'submodule.addPathUnreadableError'
  | 'submodule.addPathNotEmptyError'
  | 'submodule.addPathIsFileError'
  | 'submodule.configTitle'
  | 'submodule.configUrlRequired'
  | 'submodule.configSetUrlFailed'
  | 'submodule.configSetBranchFailed'
  | 'submodule.configSetKeyFailed'
  | 'submodule.configSyncFailed'
  | 'submodule.configInitFailed'
  | 'submodule.configDeinitFailed'
  | 'submodule.configRemoteUrlLabel'
  | 'submodule.configBranchLabel'
  | 'submodule.configUpdateStrategyLabel'
  | 'submodule.configUseDefaultCheckout'
  | 'submodule.configCheckoutOption'
  | 'submodule.configRebaseOption'
  | 'submodule.configMergeOption'
  | 'submodule.configNoneOption'
  | 'submodule.configIgnoreDirtyLabel'
  | 'submodule.configUseDefaultNone'
  | 'submodule.configUntrackedOption'
  | 'submodule.configDirtyOption'
  | 'submodule.configAllOption'
  | 'submodule.configFetchRecurseLabel'
  | 'submodule.configUseDefaultOnDemand'
  | 'submodule.configYesOption'
  | 'submodule.configOnDemandOption'
  | 'submodule.configNoOption'
  | 'submodule.configShallowCloneLabel'
  | 'submodule.configUseDefaultAction'
  | 'submodule.configUrlHelp'
  | 'submodule.configBranchHelp'
  | 'submodule.configShallowHelp'
  | 'submodule.configActionsLabel'
  | 'submodule.configInitAction'
  | 'submodule.configInitTooltip'
  | 'submodule.configDeinitRequestAction'
  | 'submodule.configDeinitAction'
  | 'submodule.configDeinitTooltip'
  | 'submodule.configSaveAction'
  | 'submodule.configCancelAction'
  | 'submodule.configDeinitConfirmation'
  | 'fileList.viewMode'
  | 'fileList.flat'
  | 'fileList.tree'
  | 'fileList.directory'
  | 'diff.context.legend'
  | 'diff.context.autoExpand'
  | 'diff.context.autoExpandHelp'
  | 'diff.context.stepLegend'
  | 'diff.context.lines'
  | 'history.scope'
  | 'history.scope.currentBranch'
  | 'history.scope.allRefs'
  | 'diff.structured.viewSwitcher'
  | 'diff.structured.code'
  | 'diff.structured.table'
  | 'diff.structured.csvCaption'
  | 'diff.structured.tsvCaption'
  | 'diff.structured.rowNumber'
  | 'diff.structured.column'
  | 'diff.structured.rowAdded'
  | 'diff.structured.rowRemoved'
  | 'diff.structured.rowChanged'
  | 'diff.structured.cellAdded'
  | 'diff.structured.cellRemoved'
  | 'diff.structured.cellChanged'
  | 'diff.structured.selectionHint'
  | 'prCreate.title'
  | 'prCreate.reviewTitle'
  | 'prCreate.successTitle'
  | 'prCreate.targetRepository'
  | 'prCreate.account'
  | 'prCreate.baseBranch'
  | 'prCreate.headBranch'
  | 'prCreate.currentBranch'
  | 'prCreate.template'
  | 'prCreate.noTemplate'
  | 'prCreate.loadingOptions'
  | 'prCreate.optionalWarning'
  | 'prCreate.titleField'
  | 'prCreate.descriptionField'
  | 'prCreate.charactersRemaining'
  | 'prCreate.markdownSupported'
  | 'prCreate.draftAction'
  | 'prCreate.reviewers'
  | 'prCreate.assignees'
  | 'prCreate.labels'
  | 'prCreate.milestone'
  | 'prCreate.none'
  | 'prCreate.choiceUnavailable'
  | 'prCreate.choiceCapped'
  | 'prCreate.cancel'
  | 'prCreate.close'
  | 'prCreate.reviewAction'
  | 'prCreate.backToEdit'
  | 'prCreate.createAction'
  | 'prCreate.createDraftAction'
  | 'prCreate.creating'
  | 'prCreate.waitingFor'
  | 'prCreate.cancelRequest'
  | 'prCreate.canceling'
  | 'prCreate.readyStatus'
  | 'prCreate.draftStatus'
  | 'prCreate.description'
  | 'prCreate.noDescription'
  | 'prCreate.metadataSummary'
  | 'prCreate.confirmation'
  | 'prCreate.created'
  | 'prCreate.draftCreated'
  | 'prCreate.done'
  | 'prCreate.openOnGitHub'
  | 'prCreate.partialSuccess'
  | 'prCreate.templateNotice'
  | 'mrEditor.createTitle'
  | 'mrEditor.editTitle'
  | 'mrEditor.description'
  | 'mrEditor.project'
  | 'mrEditor.boundAccount'
  | 'mrEditor.routeAria'
  | 'mrEditor.formAria'
  | 'mrEditor.sourceBranch'
  | 'mrEditor.sourceEditLocked'
  | 'mrEditor.targetBranch'
  | 'mrEditor.titleField'
  | 'mrEditor.descriptionField'
  | 'mrEditor.charactersRemaining'
  | 'mrEditor.markdownSupported'
  | 'mrEditor.draftAction'
  | 'mrEditor.reviewers'
  | 'mrEditor.assignees'
  | 'mrEditor.reviewersUnavailable'
  | 'mrEditor.assigneesUnavailable'
  | 'mrEditor.noneAvailable'
  | 'mrEditor.keyboardHint'
  | 'mrEditor.cancel'
  | 'mrEditor.refresh'
  | 'mrEditor.createAction'
  | 'mrEditor.saveAction'
  | 'mrEditor.creating'
  | 'mrEditor.saving'
  | 'mrEditor.created'
  | 'mrEditor.saved'
  | 'mrEditor.canceled'
  | 'mrEditor.loading'
  | 'mrEditor.emptyBranches'
  | 'mrEditor.emptySource'
  | 'mrEditor.emptyTarget'
  | 'mrEditor.emptyDescription'
  | 'mrEditor.errorTitle'
  | 'mrEditor.errorAuthentication'
  | 'mrEditor.errorPermission'
  | 'mrEditor.errorNetwork'
  | 'mrEditor.errorUnsupported'
  | 'mrEditor.errorInvalidResponse'
  | 'mrEditor.errorUnknown'
  | 'mrEditor.staleTitle'
  | 'mrEditor.staleDescription'
  | 'mrEditor.partialTitle'
  | 'mrEditor.partialUnavailable'
  | 'mrEditor.partialCapped'
  | 'mrEditor.readinessLabel'
  | 'mrEditor.readinessChecking'
  | 'mrEditor.readinessReady'
  | 'mrEditor.readinessBlocked'
  | 'mrEditor.readinessUnknown'
  | 'mrEditor.blockerStatus'
  | 'mrEditor.blockerCiMustPass'
  | 'mrEditor.blockerCiRunning'
  | 'mrEditor.blockerConflict'
  | 'mrEditor.blockerDiscussions'
  | 'mrEditor.blockerDraft'
  | 'mrEditor.blockerExternalChecks'
  | 'mrEditor.blockerJira'
  | 'mrEditor.blockerRebase'
  | 'mrEditor.blockerApproval'
  | 'mrEditor.blockerNotOpen'
  | 'mrEditor.blockerPolicy'
  | 'mrEditor.blockerCommitsStatus'
  | 'mrEditor.blockerRequestBlocked'
  | 'mrEditor.blockerMergeTime'
  | 'mrEditor.blockerRequestedChanges'
  | 'mrEditor.blockerSecurityPipeline'
  | 'mrEditor.blockerSecurityViolation'
  | 'mrEditor.blockerStatusChecks'
  | 'mrEditor.blockerLockedPaths'
  | 'mrEditor.blockerLockedLfs'
  | 'mrEditor.blockerTitleRegex'
  | 'mrEditor.validationTitle'
  | 'mrEditor.validationSource'
  | 'mrEditor.validationTarget'
  | 'mrEditor.validationBranchesDiffer'
  | 'mrEditor.validationTitleRequired'
  | 'mrEditor.validationTitleLength'
  | 'mrEditor.validationTitleInvalid'
  | 'mrEditor.validationBodyLength'
  | 'mrEditor.validationBodyInvalid'
  | 'mrEditor.validationReviewerLimit'
  | 'mrEditor.validationAssigneeLimit'
  | 'mrEditor.validationReviewerDuplicate'
  | 'mrEditor.validationAssigneeDuplicate'
  | 'mrEditor.validationReviewerInvalid'
  | 'mrEditor.validationAssigneeInvalid'
  | 'mrEditor.submitRejected'
  | 'mrEditor.submitNetwork'
  | 'mrEditor.submitStale'
  | 'mrEditor.submitInvalidResponse'
  | 'mrEditor.submitUnknown'
  | 'mrLifecycle.title'
  | 'mrLifecycle.loading'
  | 'mrLifecycle.empty'
  | 'mrLifecycle.emptyDescription'
  | 'mrLifecycle.unavailable'
  | 'mrLifecycle.unavailableDescription'
  | 'mrLifecycle.stale'
  | 'mrLifecycle.staleDescription'
  | 'mrLifecycle.partial'
  | 'mrLifecycle.summaryAria'
  | 'mrLifecycle.state'
  | 'mrLifecycle.stateOpened'
  | 'mrLifecycle.stateClosed'
  | 'mrLifecycle.stateMerged'
  | 'mrLifecycle.stateLocked'
  | 'mrLifecycle.draft'
  | 'mrLifecycle.author'
  | 'mrLifecycle.reviewers'
  | 'mrLifecycle.assignees'
  | 'mrLifecycle.none'
  | 'mrLifecycle.approval'
  | 'mrLifecycle.approvalUnavailable'
  | 'mrLifecycle.approvalComplete'
  | 'mrLifecycle.approvalProgress'
  | 'mrLifecycle.approvedBy'
  | 'mrLifecycle.pipeline'
  | 'mrLifecycle.pipelineUnavailable'
  | 'mrLifecycle.pipelineNone'
  | 'mrLifecycle.pipelinePending'
  | 'mrLifecycle.pipelineRunning'
  | 'mrLifecycle.pipelinePassed'
  | 'mrLifecycle.pipelineFailed'
  | 'mrLifecycle.pipelineCanceled'
  | 'mrLifecycle.pipelineSkipped'
  | 'mrLifecycle.pipelineUnknown'
  | 'mrLifecycle.readiness'
  | 'mrLifecycle.updated'
  | 'mrLifecycle.timeUnavailable'
  | 'mrLifecycle.close'
  | 'mrLifecycle.reopen'
  | 'mrLifecycle.approve'
  | 'mrLifecycle.unapprove'
  | 'mrLifecycle.refresh'
  | 'mrLifecycle.openCanonical'
  | 'mrLifecycle.operationRunning'
  | 'mrLifecycle.operationSuccess'
  | 'mrLifecycle.operationCanceled'
  | 'mrLifecycle.operationError'
  | 'forkCheckout.action'
  | 'forkCheckout.title'
  | 'forkCheckout.description'
  | 'forkCheckout.close'
  | 'forkCheckout.loadingForks'
  | 'forkCheckout.forkLabel'
  | 'forkCheckout.chooseFork'
  | 'forkCheckout.filterForks'
  | 'forkCheckout.loadingBranches'
  | 'forkCheckout.branchLabel'
  | 'forkCheckout.chooseBranch'
  | 'forkCheckout.filterBranches'
  | 'forkCheckout.localBranchLabel'
  | 'forkCheckout.review'
  | 'forkCheckout.reviewing'
  | 'forkCheckout.confirmHeading'
  | 'forkCheckout.source'
  | 'forkCheckout.head'
  | 'forkCheckout.local'
  | 'forkCheckout.remote'
  | 'forkCheckout.remoteNew'
  | 'forkCheckout.remoteReuse'
  | 'forkCheckout.remoteRef'
  | 'forkCheckout.staleGuard'
  | 'forkCheckout.confirm'
  | 'forkCheckout.checkingOut'
  | 'forkCheckout.success'
  | 'forkCheckout.limitNotice'
  | 'forkCheckout.rejectedNotice'
  | 'forkCheckout.emptyForks'
  | 'forkCheckout.emptyBranches'
  | 'forkCheckout.useSuggestion'
  | 'forkCheckout.errorUnsupported'
  | 'forkCheckout.errorSignIn'
  | 'forkCheckout.errorMalformed'
  | 'forkCheckout.errorStale'
  | 'forkCheckout.errorContext'
  | 'forkCheckout.errorInvalid'
  | 'forkCheckout.errorCollision'
  | 'forkCheckout.errorRemoteCollision'
  | 'forkCheckout.errorNetwork'
  | 'forkCheckout.errorMoved'
  | 'forkCheckout.errorGit'
  | 'forkCheckout.errorUnknown'
  | 'projects.title'
  | 'projects.description'
  | 'projects.refresh'
  | 'projects.sourceLive'
  | 'projects.sourceCached'
  | 'projects.sourceUnavailable'
  | 'projects.updatedAt'
  | 'projects.stale'
  | 'projects.refreshing'
  | 'projects.readOnly'
  | 'projects.errorSignedOut'
  | 'projects.errorAuthentication'
  | 'projects.errorPermission'
  | 'projects.errorRateLimit'
  | 'projects.errorNotFound'
  | 'projects.errorUnsupported'
  | 'projects.errorService'
  | 'projects.errorNetwork'
  | 'projects.errorInvalidResponse'
  | 'projects.cacheRecovery'
  | 'projects.partialTitle'
  | 'projects.partialProjects'
  | 'projects.partialItems'
  | 'projects.partialViews'
  | 'projects.partialClassic'
  | 'projects.listAria'
  | 'projects.itemCount'
  | 'projects.stateOpen'
  | 'projects.stateClosed'
  | 'projects.openOnGitHub'
  | 'projects.viewsAria'
  | 'projects.noItems'
  | 'projects.emptyTitle'
  | 'projects.emptyDescription'
  | 'projects.kindIssue'
  | 'projects.kindPullRequest'
  | 'projects.kindDraftIssue'
  | 'projects.kindNote'
  | 'projects.kindUnavailable'
  | 'projects.loading'
  | 'reviewRequest.manage'
  | 'reviewRequest.openInBrowser'
  | 'reviewRequest.reviewRequested'
  | 'reviewRequest.statusDraft'
  | 'reviewRequest.statusOpen'
  | 'reviewRequest.noDescription'
  | 'reviewRequest.markdownBodyAriaLabel'
  | 'reviewRequest.quickViewAriaLabel'
  | 'globalIgnore.title'
  | 'globalIgnore.description'
  | 'globalIgnore.pathLabel'
  | 'globalIgnore.loading'
  | 'globalIgnore.configuredExisting'
  | 'globalIgnore.configuredNew'
  | 'globalIgnore.notConfigured'
  | 'globalIgnore.starterRules'
  | 'globalIgnore.addEditorFiles'
  | 'globalIgnore.addOSFiles'
  | 'globalIgnore.rulesAria'
  | 'globalIgnore.patternPlaceholder'
  | 'globalIgnore.reload'
  | 'globalIgnore.savingAction'
  | 'globalIgnore.saveAction'
  | 'globalIgnore.savingStatus'
  | 'globalIgnore.savedStatus'
  | 'globalIgnore.loadError'
  | 'globalIgnore.saveError'
  | 'customGit.title'
  | 'customGit.description'
  | 'customGit.savedPreset'
  | 'customGit.newUnsavedPreset'
  | 'customGit.newAction'
  | 'customGit.name'
  | 'customGit.subcommand'
  | 'customGit.arguments'
  | 'customGit.warning'
  | 'customGit.saveAction'
  | 'customGit.reviewAction'
  | 'customGit.deleteAction'
  | 'customGit.cancelRun'
  | 'customGit.confirmRunTitle'
  | 'customGit.confirmRunWarning'
  | 'customGit.runReviewed'
  | 'customGit.goBack'
  | 'customGit.confirmDeleteTitle'
  | 'customGit.confirmDeleteDescription'
  | 'customGit.keepPreset'
  | 'customGit.outputAria'
  | 'customGit.initialStatus'
  | 'customGit.repositoryChangedStatus'
  | 'customGit.invalidNameError'
  | 'customGit.savedStatus'
  | 'customGit.saveError'
  | 'customGit.removedStatus'
  | 'customGit.reviewError'
  | 'customGit.runningStatus'
  | 'customGit.startError'
  | 'customGit.completedStatus'
  | 'customGit.cancelledStatus'
  | 'customGit.failedStatus'
  | 'customGit.exitCodeError'
  | 'editor.wslDisplayName'
  | 'editor.wslDistributionMismatch'
  | 'editor.wslInvalidDistributionPath'
  | 'editor.wslTranslateFailed'
  | 'editor.wslInvalidTranslatedPath'
  | 'editor.wslInvalidTarget'
  | 'networkRepository.unavailable'
  | 'networkRepository.reconnect'
  | 'networkRepository.unavailableAria'
  | 'networkRepository.mappedDrive'
  | 'networkRepository.wslShare'
  | 'networkRepository.uncShare'
  | 'networkRepository.detected'
  | 'batchSync.title'
  | 'batchSync.loadingChoices'
  | 'batchSync.reviewAria'
  | 'batchSync.operation'
  | 'batchSync.pullActive'
  | 'batchSync.fetchOnly'
  | 'batchSync.chooseRepositories'
  | 'batchSync.selectAll'
  | 'batchSync.selectNone'
  | 'batchSync.noRepositories'
  | 'batchSync.candidatesAria'
  | 'batchSync.reviewSingle'
  | 'batchSync.reviewMultiple'
  | 'batchSync.cancel'
  | 'batchSync.startPull'
  | 'batchSync.startFetch'
  | 'batchSync.progressAria'
  | 'batchSync.stopped'
  | 'batchSync.pullComplete'
  | 'batchSync.fetchComplete'
  | 'batchSync.liveProgress'
  | 'batchSync.couldNotFinish'
  | 'batchSync.allProcessed'
  | 'batchSync.pullingRepositories'
  | 'batchSync.fetchingRepositories'
  | 'batchSync.completedOf'
  | 'batchSync.synchronizedAria'
  | 'batchSync.metricComplete'
  | 'batchSync.metricActive'
  | 'batchSync.metricWaiting'
  | 'batchSync.finalResult'
  | 'batchSync.nowPulling'
  | 'batchSync.nowFetching'
  | 'batchSync.waitingNext'
  | 'batchSync.backgroundNote'
  | 'batchSync.summaryPull'
  | 'batchSync.summaryFetch'
  | 'batchSync.noneToPull'
  | 'batchSync.resultsAria'
  | 'batchSync.repository'
  | 'batchSync.status'
  | 'batchSync.detail'
  | 'batchSync.runBackground'
  | 'batchSync.done'
  | 'batchSync.statusWaiting'
  | 'batchSync.statusPulling'
  | 'batchSync.statusFetching'
  | 'batchSync.statusPulled'
  | 'batchSync.statusFetched'
  | 'batchSync.statusSkipped'
  | 'batchSync.statusFailed'
  | 'repositoryPicker.status'
  | 'repositoryPicker.all'
  | 'repositoryPicker.clean'
  | 'repositoryPicker.changed'
  | 'repositoryPicker.ahead'
  | 'repositoryPicker.behind'
  | 'repositoryPicker.missingOrCloning'
  | 'repositoryPicker.hideHiddenAria'
  | 'repositoryPicker.showHiddenAria'
  | 'repositoryPicker.showingHidden'
  | 'repositoryPicker.showHidden'
  | 'repositoryPicker.hidden'
  | 'repositoryPicker.itemHiddenAria'
  | 'repositoryPicker.hideMenu'
  | 'repositoryPicker.unhideMenu'
  | 'repositoryPicker.customizeNameMenu'
  | 'repositoryPicker.customizeLogoMenu'
  | 'removeRepository.trashFailedMessage'
  | 'removeRepository.trashFailedWarning'
  | 'removeRepository.forceDeleteButton'
  | 'patchSeries.initialStatus'
  | 'patchSeries.runningExport'
  | 'patchSeries.runningImport'
  | 'patchSeries.runningContinue'
  | 'patchSeries.runningSkip'
  | 'patchSeries.runningAbort'
  | 'patchSeries.operation'
  | 'patchSeries.chooseExportTitle'
  | 'patchSeries.reviewExportStatus'
  | 'patchSeries.prepareExportError'
  | 'patchSeries.prepareExportFailed'
  | 'patchSeries.chooseImportTitle'
  | 'patchSeries.patchFileFilter'
  | 'patchSeries.reviewImportStatus'
  | 'patchSeries.prepareImportError'
  | 'patchSeries.prepareImportFailed'
  | 'patchSeries.runningStatus'
  | 'patchSeries.startError'
  | 'patchSeries.cancelledStatus'
  | 'patchSeries.failedStatus'
  | 'patchSeries.gitFailed'
  | 'patchSeries.gitFailedWithCode'
  | 'patchSeries.refreshingStatus'
  | 'patchSeries.exportedStatus'
  | 'patchSeries.abortedStatus'
  | 'patchSeries.completedStatus'
  | 'patchSeries.refreshFailedStatus'
  | 'patchSeries.refreshRequiredError'
  | 'patchSeries.exportConfirmTitle'
  | 'patchSeries.exportConfirmDescription'
  | 'patchSeries.exportAction'
  | 'patchSeries.goBack'
  | 'patchSeries.importConfirmTitle'
  | 'patchSeries.importConfirmDescription'
  | 'patchSeries.additionalPatches'
  | 'patchSeries.importAction'
  | 'patchSeries.recoveryAria'
  | 'patchSeries.recoveryDescription'
  | 'patchSeries.continueAction'
  | 'patchSeries.skipAction'
  | 'patchSeries.abortAction'
  | 'patchSeries.title'
  | 'patchSeries.heading'
  | 'patchSeries.description'
  | 'patchSeries.chooseExportAction'
  | 'patchSeries.chooseImportAction'
  | 'patchSeries.cancelAction'
  | 'patchSeries.resultsAria'
  | 'bulkBranchDelete.aria'
  | 'bulkBranchDelete.closeAction'
  | 'bulkBranchDelete.openAction'
  | 'bulkBranchDelete.reviewTitle'
  | 'bulkBranchDelete.protectedDescription'
  | 'bulkBranchDelete.selectAll'
  | 'bulkBranchDelete.selectNone'
  | 'bulkBranchDelete.empty'
  | 'bulkBranchDelete.listAria'
  | 'bulkBranchDelete.reviewDeletion'
  | 'bulkBranchDelete.confirmSingular'
  | 'bulkBranchDelete.confirmPlural'
  | 'bulkBranchDelete.remoteUnaffected'
  | 'bulkBranchDelete.deleteReviewed'
  | 'bulkBranchDelete.goBack'
  | 'bulkBranchDelete.deleting'
  | 'bulkBranchDelete.limitError'
  | 'bulkBranchDelete.reviewChangedError'
  | 'bulkBranchDelete.deleteError'
  | 'bulkBranchDelete.resultsAria'
  | 'stashManager.timeUnavailable'
  | 'stashManager.timestamp'
  | 'stashManager.operationCancelled'
  | 'stashManager.operationFailed'
  | 'stashManager.repositoryChangedStatus'
  | 'stashManager.operationProgress'
  | 'stashManager.cancellingStatus'
  | 'stashManager.createOperation'
  | 'stashManager.createSuccess'
  | 'stashManager.applyOperation'
  | 'stashManager.applySuccess'
  | 'stashManager.saveDetailsOperation'
  | 'stashManager.saveDetailsSuccess'
  | 'stashManager.clearOperation'
  | 'stashManager.clearSuccessSingular'
  | 'stashManager.clearSuccessPlural'
  | 'stashManager.stashChangedError'
  | 'stashManager.restoreOperation'
  | 'stashManager.restoreSuccess'
  | 'stashManager.discardOperation'
  | 'stashManager.discardSuccess'
  | 'stashManager.createBranchOperation'
  | 'stashManager.createBranchSuccess'
  | 'stashManager.createHeading'
  | 'stashManager.nameLabel'
  | 'stashManager.createPlaceholder'
  | 'stashManager.changesToSave'
  | 'stashManager.allTrackedChanges'
  | 'stashManager.selectedFileSingular'
  | 'stashManager.selectedFilePlural'
  | 'stashManager.includeUntracked'
  | 'stashManager.selectedScopeCaption'
  | 'stashManager.untrackedWarning'
  | 'stashManager.conflictsWarning'
  | 'stashManager.createAction'
  | 'stashManager.fileCountSingular'
  | 'stashManager.fileCountPlural'
  | 'stashManager.filesLoadWhenOpened'
  | 'stashManager.reviewStashAria'
  | 'stashManager.externalLabel'
  | 'stashManager.selectedActionsAria'
  | 'stashManager.workingChangesWarningSingular'
  | 'stashManager.workingChangesWarningPlural'
  | 'stashManager.applyAction'
  | 'stashManager.restoreAction'
  | 'stashManager.renameMoveAction'
  | 'stashManager.newBranchAction'
  | 'stashManager.discardAction'
  | 'stashManager.editStashAria'
  | 'stashManager.branchAssociation'
  | 'stashManager.metadataCaption'
  | 'stashManager.saveDetailsAction'
  | 'stashManager.cancelAction'
  | 'stashManager.branchFromAria'
  | 'stashManager.newLocalBranch'
  | 'stashManager.branchCaption'
  | 'stashManager.reviewBranchAction'
  | 'stashManager.confirmRestore'
  | 'stashManager.confirmDiscard'
  | 'stashManager.confirmBranch'
  | 'stashManager.confirmClearSingular'
  | 'stashManager.confirmClearPlural'
  | 'stashManager.createBranchAction'
  | 'stashManager.confirmAction'
  | 'stashManager.inventoryHeading'
  | 'stashManager.clearReviewedAction'
  | 'stashManager.emptyInventory'
  | 'stashManager.currentLabel'
  | 'stashManager.managedOnlyCaption'
  | 'stashManager.externalCaptionSingular'
  | 'stashManager.externalCaptionPlural'
  | 'stashManager.truncatedCaption'
  | 'stashManager.managerAria'
  | 'stashManager.repositoryStashSingular'
  | 'stashManager.repositoryStashPlural'
  | 'stashManager.checkoutBranchCaption'
  | 'stashManager.onBranchCaption'
  | 'stashManager.closeAction'
  | 'stashManager.manageAction'
  | 'stashManager.controlsAria'
  | 'stashManager.cancelOperationAction'
  | 'tagLifecycle.rejectedError'
  | 'tagLifecycle.operationFailedError'
  | 'tagLifecycle.createdStatus'
  | 'tagLifecycle.movedStatus'
  | 'tagLifecycle.deletedLocalStatus'
  | 'tagLifecycle.pushedStatus'
  | 'tagLifecycle.pushedAllStatus'
  | 'tagLifecycle.fetchedPrunedStatus'
  | 'tagLifecycle.deletedRemoteStatus'
  | 'tagLifecycle.confirmMove'
  | 'tagLifecycle.confirmDeleteLocal'
  | 'tagLifecycle.confirmPushNew'
  | 'tagLifecycle.confirmPushReplace'
  | 'tagLifecycle.confirmPushAll'
  | 'tagLifecycle.confirmFetchPrune'
  | 'tagLifecycle.confirmDeleteRemote'
  | 'tagLifecycle.createHeading'
  | 'tagLifecycle.nameLabel'
  | 'tagLifecycle.targetLabel'
  | 'tagLifecycle.targetPlaceholder'
  | 'tagLifecycle.typeLabel'
  | 'tagLifecycle.annotated'
  | 'tagLifecycle.lightweight'
  | 'tagLifecycle.messageLabel'
  | 'tagLifecycle.signConfigured'
  | 'tagLifecycle.signingConfigured'
  | 'tagLifecycle.signingNotConfigured'
  | 'tagLifecycle.createAction'
  | 'tagLifecycle.moveAria'
  | 'tagLifecycle.moveHeading'
  | 'tagLifecycle.reviewedObject'
  | 'tagLifecycle.newTargetLabel'
  | 'tagLifecycle.recreatedTypeLabel'
  | 'tagLifecycle.signRecreated'
  | 'tagLifecycle.reviewMoveAction'
  | 'tagLifecycle.cancelAction'
  | 'tagLifecycle.remoteNotLoaded'
  | 'tagLifecycle.localOnly'
  | 'tagLifecycle.pushed'
  | 'tagLifecycle.differentRemotely'
  | 'tagLifecycle.annotatedLower'
  | 'tagLifecycle.lightweightLower'
  | 'tagLifecycle.localTagMeta'
  | 'tagLifecycle.signedSuffix'
  | 'tagLifecycle.moveAction'
  | 'tagLifecycle.pushAction'
  | 'tagLifecycle.deleteRemoteAction'
  | 'tagLifecycle.deleteLocalAction'
  | 'tagLifecycle.remoteOnlyMeta'
  | 'tagLifecycle.confirmHeading'
  | 'tagLifecycle.typeToConfirm'
  | 'tagLifecycle.confirmAction'
  | 'tagLifecycle.managerAria'
  | 'tagLifecycle.title'
  | 'tagLifecycle.description'
  | 'tagLifecycle.refreshLocalAction'
  | 'tagLifecycle.loadRemoteAction'
  | 'tagLifecycle.readOnlyNotice'
  | 'tagLifecycle.loading'
  | 'tagLifecycle.filterLabel'
  | 'tagLifecycle.fetchedStatus'
  | 'tagLifecycle.fetchAction'
  | 'tagLifecycle.fetchPruneAction'
  | 'tagLifecycle.pushAllAction'
  | 'tagLifecycle.localTagsHeading'
  | 'tagLifecycle.noLocalMatches'
  | 'tagLifecycle.localTruncated'
  | 'tagLifecycle.remoteOnlyHeading'
  | 'tagLifecycle.noRemoteMatches'
  | 'tagLifecycle.remoteTruncated'
  | 'ollama.providerType'
  | 'ollama.authenticationHeading'
  | 'ollama.authenticationDescription'
  | 'ollama.modelsSyncDescription'
  | 'ollama.modelsEmpty'
  | 'ollama.manager.openAction'
  | 'ollama.manager.backAction'
  | 'ollama.manager.title'
  | 'ollama.manager.subtitle'
  | 'ollama.manager.endpoint'
  | 'ollama.manager.configuredEndpoint'
  | 'ollama.manager.connected'
  | 'ollama.manager.unavailable'
  | 'ollama.manager.checking'
  | 'ollama.manager.partial'
  | 'ollama.manager.version'
  | 'ollama.manager.installed'
  | 'ollama.manager.running'
  | 'ollama.manager.refresh'
  | 'ollama.manager.refreshing'
  | 'ollama.manager.searchLabel'
  | 'ollama.manager.searchPlaceholder'
  | 'ollama.manager.scopeLabel'
  | 'ollama.manager.allModels'
  | 'ollama.manager.runningModels'
  | 'ollama.manager.inventoryLabel'
  | 'ollama.manager.loadingInventory'
  | 'ollama.manager.unavailableInventory'
  | 'ollama.manager.emptyInventory'
  | 'ollama.manager.emptyFilter'
  | 'ollama.manager.modelDetails'
  | 'ollama.manager.selectModel'
  | 'ollama.manager.loadingDetails'
  | 'ollama.manager.runningBadge'
  | 'ollama.manager.size'
  | 'ollama.manager.modified'
  | 'ollama.manager.digest'
  | 'ollama.manager.family'
  | 'ollama.manager.format'
  | 'ollama.manager.parameters'
  | 'ollama.manager.quantization'
  | 'ollama.manager.capabilities'
  | 'ollama.manager.license'
  | 'ollama.manager.noneReported'
  | 'ollama.manager.runtime'
  | 'ollama.manager.vram'
  | 'ollama.manager.context'
  | 'ollama.manager.expires'
  | 'ollama.manager.notRunning'
  | 'ollama.manager.pullTitle'
  | 'ollama.manager.pullHint'
  | 'ollama.manager.modelName'
  | 'ollama.manager.pullPlaceholder'
  | 'ollama.manager.pull'
  | 'ollama.manager.pulling'
  | 'ollama.manager.cancel'
  | 'ollama.manager.receiving'
  | 'ollama.manager.copyTitle'
  | 'ollama.manager.copyHint'
  | 'ollama.manager.copyDestination'
  | 'ollama.manager.copy'
  | 'ollama.manager.renameTitle'
  | 'ollama.manager.renameHint'
  | 'ollama.manager.renameDestination'
  | 'ollama.manager.rename'
  | 'ollama.manager.load'
  | 'ollama.manager.unload'
  | 'ollama.manager.delete'
  | 'ollama.manager.deleteTitle'
  | 'ollama.manager.deleteConfirm'
  | 'ollama.manager.invalidName'
  | 'ollama.manager.duplicateName'
  | 'ollama.manager.operationError'
  | 'ollama.manager.refreshError'
  | 'ollama.manager.detailsError'
  | 'ollama.manager.configurationPartial'
  | 'ollama.manager.renamePartial'
  | 'ollama.manager.pullCancelled'
  | 'ollama.manager.chatTitle'
  | 'ollama.manager.chatHint'
  | 'ollama.manager.chatModelLabel'
  | 'ollama.manager.chatPlaceholder'
  | 'ollama.manager.chatSend'
  | 'ollama.manager.chatStop'
  | 'ollama.manager.chatClear'
  | 'ollama.manager.chatStreaming'
  | 'ollama.manager.chatEmpty'
  | 'ollama.manager.chatNoModel'
  | 'ollama.manager.chatUnsupported'
  | 'ollama.manager.chatError'
  | 'ollama.manager.chatYou'
  | 'ollama.manager.chatAssistant'
  | 'ollama.manager.chatMessageLabel'
  | 'ollama.manager.unknown'
  | 'ollama.manager.never'
  | 'ollama.manager.showing'
  | 'ollama.manager.selectedModel'
  | 'ollama.manager.moreCapabilities'
  | 'ollama.manager.pullProgress'
  | 'ollama.manager.pullSucceeded'
  | 'ollama.manager.copySucceeded'
  | 'ollama.manager.renameSucceeded'
  | 'ollama.manager.loadSucceeded'
  | 'ollama.manager.unloadSucceeded'
  | 'ollama.manager.deleteSucceeded'
  | 'ollama.manager.confirmDelete'
  | 'subtree.title'
  | 'color.blue'
  | 'color.violet'
  | 'color.teal'
  | 'color.green'
  | 'color.amber'
  | 'color.rose'
  | 'settings.notificationsEnableTitle'
  | 'settings.notificationsEnableDescription'
  | 'settings.automationAutoCommitPushTitle'
  | 'settings.automationAutoCommitPushDescription'
  | 'settings.automationAutoPullTitle'
  | 'settings.automationAutoPullDescription'
  | 'settings.automationIntervalEvery'
  | 'settings.automationIntervalMinutes'
  | 'settings.automationIntervalGroupLabel'
  | 'settings.advancedUsageStatsTitle'
  | 'settings.advancedUsageStatsDescription'
  | 'settings.advancedCredentialStorageTitle'
  | 'settings.advancedCredentialStorageDescription'
  | 'settings.integrationsExternalEditorTitle'
  | 'settings.integrationsExternalEditorSubtitle'
  | 'settings.integrationsShellTitle'
  | 'settings.integrationsShellSubtitle'
  | 'settings.integrationsChooseEditor'
  | 'settings.integrationsChooseShell'
  | 'settings.integrationsCustomEditorChoice'
  | 'settings.integrationsCustomShellChoice'
  | 'settings.integrationsCustomEditorLabel'
  | 'settings.integrationsCustomShellLabel'
  | 'settings.integrationsSelectEditor'
  | 'push.ghCliFallbackSuccessTitle'
  | 'push.ghCliFallbackSuccessBody'
  | 'clone.visibilityPublic'
  | 'clone.visibilityPrivate'
  | 'clone.noDescription'
  | 'clone.starsLabel'
  | 'clone.forksLabel'
  | 'clone.sizeLabel'
  | 'clone.defaultBranchLabel'
  | 'clone.updatedLabel'
  | 'clone.languageLabel'
  | 'clone.languageFilterLabel'
  | 'clone.languageFilterAria'
  | 'clone.orgScopeMissing'
  | 'clone.orgReconnect'
  | 'clone.orgRestrictionNote'
  | 'clone.orgReviewAccess'
  | 'palette.selectAll'
  | 'palette.toggleTheme'
  | 'palette.preferencesAccounts'
  | 'palette.preferencesAppearance'
  | 'palette.preferencesIntegrations'
  | 'palette.preferencesAutomation'
  | 'palette.preferencesAdvanced'
  | 'palette.preferencesNotifications'
  | 'palette.preferencesGit'
  | 'palette.preferencesAccessibility'
  | 'palette.notificationHistory'
  | 'palette.notificationAutomations'
  | 'palette.copyRepoPath'
  | 'palette.copyBranchName'
  | 'palette.copyCommitSha'
  | 'buildRun.closeDisabledRunning'
  | 'buildRun.fixingWithOpencode'
  | 'buildRun.stopConfirmTitle'
  | 'buildRun.stopConfirmBody'
  | 'buildRun.stopConfirmConfirm'
  | 'buildRun.stopConfirmCancel'
  | 'buildRun.sendToOpencode'
  | 'buildRun.sendIntro'
  | 'buildRun.sendPromptLabel'
  | 'buildRun.sendPromptPlaceholder'
  | 'buildRun.sendEmptyError'
  | 'buildRun.sendSubmit'
  | 'buildRun.sendAutoApproveLabel'
  | 'buildRun.sendAutoApproveWarning'
  | 'buildRun.sendAutoApproveNote'
  | 'buildRun.sendRunningTitle'
  | 'workflowDispatch.searchPlaceholder'
  | 'workflowDispatch.searchAriaLabel'
  | 'workflowDispatch.listAriaLabel'
  | 'workflowDispatch.empty'
  | 'workflowDispatch.noMatches'
  | 'workflowDispatch.stateActive'
  | 'workflowDispatch.stateDisabled'

/** Complete base catalog. Every missing locale entry falls back to this. */
export const englishTranslations: Readonly<Record<TranslationKey, string>> = {
  'ci.status': 'CI checks: {status}',
  'ci.successful': 'successful',
  'ci.failed': 'failed',
  'ci.inProgress': 'in progress',
  'ci.timedOut': 'timed out',
  'ci.actionRequired': 'action required',
  'ci.neutral': 'neutral',
  'ci.cancelled': 'cancelled',
  'ci.skipped': 'skipped',
  'ci.stale': 'stale',
  'update.downloadingLabel': 'Downloading app update',
  'update.downloadingValue': 'Downloading',
  'appearance.updateProgressColor': 'Update progress color',
  'appearance.useAccentColor': 'Use accent color',
  'appearance.languageMode': 'Language',
  'appearance.languageModeDescription':
    'Choose English, playful Hong Kong Cantonese, or a compact bilingual view.',
  'appearance.languageAndNavigation': 'Language',
  'appearance.submoduleBackStyle': 'Submodule Back button style',
  'appearance.submoduleBackLabel': 'Submodule Back button label',
  'appearance.toolbarEditorTitle': 'Toolbar appearance',
  'appearance.toolbarEditorDescription':
    'Customize toolbar labels, spacing, text color, and typography.',
  'appearance.repositoryToolbarEditorTitle': 'Repository toolbar appearance',
  'appearance.repositoryToolbarEditorDescription':
    'Override labels, spacing, text color, and typography while this repository is active.',
  'appearance.toolbarTypographyHeading': 'Toolbar typography',
  'appearance.toolbarTypographyProfile': 'Profile customization',
  'appearance.toolbarTypographyRepositoryInherited':
    'Inheriting profile typography',
  'appearance.toolbarTypographyRepositoryOverride': 'Repository override',
  'appearance.toolbarTypographyThemeDefaults': 'Use theme defaults',
  'appearance.toolbarTypographyInheritProfile': 'Inherit profile',
  'appearance.toolbarTypographyPreview': 'Live toolbar preview',
  'appearance.toolbarTypographyPreviewTitle': 'Current repository',
  'appearance.toolbarTypographyPreviewDescription': 'Current branch',
  'appearance.toolbarFontStyle': 'Font style',
  'appearance.toolbarBold': 'Bold',
  'appearance.toolbarItalic': 'Italic',
  'appearance.toolbarUnderline': 'Underline',
  'appearance.toolbarStrikethrough': 'Strikethrough',
  'appearance.toolbarAlignment': 'Text alignment',
  'appearance.toolbarAlignLeft': 'Align left',
  'appearance.toolbarAlignCenter': 'Align center',
  'appearance.toolbarAlignRight': 'Align right',
  'appearance.toolbarFont': 'Font family',
  'appearance.toolbarThemeFont': 'Use theme font',
  'appearance.toolbarInheritFont': 'Inherit profile font',
  'appearance.toolbarSize': 'Font size',
  'appearance.toolbarThemeSize': 'Use theme size',
  'appearance.toolbarInheritSize': 'Inherit profile size',
  'appearance.toolbarLetterCase': 'Letter case',
  'appearance.toolbarNormalCase': 'Normal case',
  'appearance.toolbarUppercase': 'Uppercase',
  'appearance.toolbarLowercase': 'Lowercase',
  'appearance.toolbarCapitalize': 'Capitalize words',
  'appearance.toolbarSmallCaps': 'Small caps',
  'appearance.toolbarSpacing': 'Character spacing',
  'appearance.toolbarThemeSpacing': 'Use theme spacing',
  'appearance.toolbarInheritSpacing': 'Inherit profile spacing',
  'appearance.toolbarTextEffect': 'Text effect',
  'appearance.toolbarNoEffect': 'No text effect',
  'appearance.toolbarSoftShadow': 'Soft shadow',
  'appearance.toolbarStrongShadow': 'Strong shadow',
  'appearance.toolbarTextColor': 'Text color',
  'appearance.toolbarThemeColor': 'Use theme color',
  'appearance.toolbarInheritColor': 'Inherit profile color',
  'appearance.toolbarCustomColor': 'Custom text color',
  'tabs.appearanceLoading': 'Tab appearance is still loading. Try again.',
  'tabs.settingsCommitSaved': 'Saved · {sha}',
  'tabs.settingsCommitCommitted': 'Committed {sha}',
  'tabs.settingsCommitTitle':
    "Every tab and settings change commits to this account's local settings repo.",
  'tabs.settingsHistory': 'Settings history',
  'tabs.undoSettingsChange': 'Undo last settings change',
  'tabs.redoSettingsChange': 'Redo settings change',
  'tabs.settingsChangeUndone': 'Settings change undone.',
  'tabs.settingsChangeRedone': 'Settings change redone.',
  'language.english': 'English',
  'language.cantonese': 'Playful Hong Kong Cantonese',
  'language.bilingual': 'Bilingual',
  'submodule.backStyleTonal': 'Tonal',
  'submodule.backStyleFilled': 'Filled accent',
  'submodule.backStyleOutlined': 'Outlined',
  'submodule.backLabelFull': 'Back to parent',
  'submodule.backLabelParent': 'Parent name',
  'submodule.backLabelIcon': 'Icon only',
  'submodule.openAsRepository': 'Open & manage',
  'submodule.temporaryOpenDescription':
    'Opens the submodule temporarily in this workspace. It is never added to your repository list.',
  'submodule.appearanceHeading': 'Back button appearance',
  'submodule.appearanceDescription':
    'Right-click the preview Back button to open its editor beside the button. Save applies this to the active profile.',
  'submodule.appearancePreview': 'Preview',
  'submodule.openUnavailable': 'Clone this submodule before opening it',
  'submodule.openFailed': 'Could not open {child} as a repository: {error}',
  'submodule.returnFailed': 'Could not return to {parent}: {error}',
  'submodule.workspaceUnsafe':
    'This temporary submodule workspace is no longer safe to use. Returned to {parent}. Details: {error}',
  'submodule.temporaryRemovalUnavailable':
    'This submodule is open temporarily. Return to {parent} to manage or remove it.',
  'submodule.temporarySettingsUnavailable':
    'Repository settings are saved only for repositories in your list. Return to {parent} to manage persisted settings.',
  'submodule.navigation': 'Temporary submodule repository navigation',
  'submodule.backToParent': 'Back to {parent}',
  'submodule.viewingContext':
    'Viewing submodule {child} inside {parent}. It is not added to your repository list.',
  'submodule.managerTitle': 'Submodule manager',
  'submodule.managerClose': 'Close',
  'submodule.title': 'Submodules',
  'submodule.addAction': 'Add submodule…',
  'submodule.addTooltip': 'Choose a hosted repository or URL to add',
  'submodule.updateAllAction': 'Update all',
  'submodule.updateAllTooltip': 'Initialize and update every submodule',
  'submodule.syncAction': 'Sync',
  'submodule.syncTooltip': 'Sync the remote URL from .gitmodules',
  'submodule.configureAction': 'Configure',
  'submodule.configureTooltip': "Edit this submodule's configuration",
  'submodule.removeAction': 'Remove',
  'submodule.removeTooltip': 'Deinitialize and remove this submodule',
  'submodule.listFailed': 'Could not list submodules: {error}',
  'submodule.updateAllFailed': 'Failed updating submodules: {error}',
  'submodule.updateFailed': 'Failed updating {path}: {error}',
  'submodule.syncFailed': 'Failed syncing {path}: {error}',
  'submodule.removeFailed': 'Failed removing {path}: {error}',
  'submodule.temporaryToolsReadOnly':
    'Temporary submodule workspaces allow read-only repository tools only. Return to {parent} before running a tool that changes this checkout.',
  'submodule.summarySingle': '{count} submodule',
  'submodule.summaryMultiple': '{count} submodules',
  'submodule.summaryCloned': '{count} cloned',
  'submodule.summaryNotCloned': '{count} not cloned',
  'submodule.statusUninitialized': 'Not initialized',
  'submodule.statusUpToDate': 'Up to date',
  'submodule.statusOutOfDate': 'Out of date',
  'submodule.statusConflicted': 'Conflicted',
  'submodule.searchPlaceholder': 'Search submodules by name, path, or URL',
  'submodule.searchAriaLabel': 'Search submodules',
  'submodule.filterByStatus': 'Filter submodules by status',
  'submodule.filterAll': 'All',
  'submodule.filterCloned': 'Cloned',
  'submodule.filterNotCloned': 'Not cloned',
  'submodule.filterOutOfDate': 'Out of date',
  'submodule.filterConflicted': 'Conflicted',
  'submodule.loading': 'Loading submodules…',
  'submodule.none': 'This repository has no submodules yet.',
  'submodule.noMatches':
    'No submodules match the current search and status filter.',
  'submodule.cloneAction': 'Clone',
  'submodule.cloneTooltip': 'Clone this submodule into the working tree',
  'submodule.updateAction': 'Update',
  'submodule.updateTooltip': 'Initialize and update this submodule',
  'submodule.addDialogTitle': 'Add a submodule',
  'submodule.addSubmitAction': 'Add submodule',
  'submodule.addCancelAction': 'Cancel',
  'submodule.addCancelOperationAction': 'Cancel operation',
  'submodule.addDoneAction': 'Done',
  'submodule.addSignInAction': 'Sign in',
  'submodule.addDotComSignInGuidance':
    'Sign in to GitHub.com to browse repositories for this submodule.',
  'submodule.addEnterpriseSignInGuidance':
    'Sign in to GitHub Enterprise to browse repositories for this submodule.',
  'submodule.addProviderAccountAction': 'Add provider account',
  'submodule.addProviderSignInGuidance':
    'Add a GitLab or Bitbucket account in Settings to browse its repositories.',
  'submodule.addCreateRemoteTab': 'Create remote',
  'submodule.addCreateAndAddAction': 'Create and add submodule',
  'submodule.addCreateRemoteSignInGuidance':
    'Sign in to GitHub.com or GitHub Enterprise to create a remote repository for this submodule.',
  'submodule.addRemoteCreatedHeading': 'Remote repository created',
  'submodule.addRemoteCreatedRetryHelp':
    'The remote is ready. Retry to add that existing remote without creating it again.',
  'submodule.addRemoteOwnerLabel': 'Owner',
  'submodule.addRemoteNameLabel': 'Repository name',
  'submodule.addRemoteDescriptionLabel': 'Description (optional)',
  'submodule.addRemotePrivateLabel': 'Keep this repository private',
  'submodule.addRemoteNameHelp':
    'Use the exact name to create on the selected GitHub host.',
  'submodule.addRemoteDescriptionHelp':
    'A short description for the new remote repository.',
  'submodule.addRemoteInitializeHelp':
    'Desktop initializes the remote with a first commit so Git can track it as a submodule immediately.',
  'submodule.addRemoteAccountRequiredError':
    'Choose an authenticated GitHub account before creating the remote repository.',
  'submodule.addRemoteOwnerUnavailableError':
    'The selected organization is no longer available for this account. Choose an owner again.',
  'submodule.addRemoteNameRequiredError':
    'Enter a name for the new remote repository.',
  'submodule.addRemoteNameLengthError':
    'Repository names must be 100 characters or fewer.',
  'submodule.addRemoteNameCharactersError':
    'Use only letters, numbers, periods, hyphens, and underscores in the repository name.',
  'submodule.addRemoteDescriptionLengthError':
    'Repository descriptions must be 350 characters or fewer.',
  'submodule.addRemoteDescriptionCharactersError':
    'The repository description contains unsupported control characters.',
  'submodule.addCreatingRemoteProgress': 'Creating the remote repositoryâ€¦',
  'submodule.addRemoteCreatedProgress':
    'Remote created. Adding it as a submoduleâ€¦',
  'submodule.addRemoteCreatedButAddFailed':
    'The remote repository was created at {repository}, but Desktop could not add it as a submodule: {error}. Retry to use the existing remote.',
  'submodule.addRemoteCreateFailed':
    'Desktop could not create the remote repository: {error}',
  'submodule.addRemoteCreateCancelledUncertain':
    'The creation request ended before Desktop received a result. The remote host may still have created the repository. Check it before retrying to avoid a duplicate.',
  'submodule.addOrganizationLoadFailed':
    "Desktop couldn't load every organization repository.",
  'submodule.addTryAgainAction': 'Try again',
  'submodule.addRepositoryListLabel': 'Choose a repository for the submodule',
  'submodule.addRepositoryFilterPlaceholder':
    'Filter repositories for this submodule',
  'submodule.addRepositoryUrlLabel': 'Repository URL',
  'submodule.addRepositoryUrlHelp':
    'HTTPS, SSH, and local Git remote URLs are supported.',
  'submodule.addPathLabel': 'Path inside repository',
  'submodule.addBranchLabel': 'Branch (optional)',
  'submodule.addRemoteDefaultBranchPlaceholder': 'Remote default branch',
  'submodule.addPathChecking':
    'Checking that the destination is safe and empty…',
  'submodule.addPathHelp':
    'A relative checkout path; the final segment becomes the default submodule name.',
  'submodule.addBranchHelp':
    'Leave empty to follow the repository’s remote default branch.',
  'submodule.addReviewLabel': 'Submodule review',
  'submodule.addReviewHeading': 'Review',
  'submodule.addReviewRepositoryLabel': 'Repository',
  'submodule.addReviewChooseSource': 'Choose a source above',
  'submodule.addReviewSuperprojectLabel': 'Superproject',
  'submodule.addReviewCheckoutPathLabel': 'Checkout path',
  'submodule.addReviewNotSet': 'Not set',
  'submodule.addReviewTrackedBranchLabel': 'Tracked branch',
  'submodule.addReviewRemoteDefault': 'Remote default',
  'submodule.addProgressHeading': 'Adding submodule',
  'submodule.addProgressLabel': 'Add submodule progress',
  'submodule.addSuccessHeading': 'Submodule added',
  'submodule.addSuccessDescription':
    'Git updated .gitmodules and checked out the repository at {path}.',
  'submodule.addAddingProgress': 'Adding the submodule…',
  'submodule.addCancellingProgress': 'Cancelling the Git operation…',
  'submodule.addCheckingProgress': 'Checking the repository and destination…',
  'submodule.addAddedProgress': 'Submodule added.',
  'submodule.addCancelledError':
    'Adding the submodule was cancelled. No further Git work is running.',
  'submodule.addFailed': 'Desktop could not add this submodule: {error}',
  'submodule.addPathValidationFailed':
    'Desktop could not validate this submodule path: {error}',
  'submodule.addPathRequiredError': 'Enter a path inside this repository.',
  'submodule.addPathRelativeError':
    'Choose a relative path inside this repository.',
  'submodule.addPathSegmentsError':
    'The path cannot contain empty, current-directory, or parent-directory segments.',
  'submodule.addPathGitMetadataError':
    'The path cannot use Git metadata directories.',
  'submodule.addPathDuplicateError': 'A submodule already uses this path.',
  'submodule.addBranchInvalidError':
    'Enter a valid branch name, or leave the branch empty to use the remote default.',
  'submodule.addSourceRequiredError': 'Choose a repository or enter its URL.',
  'submodule.addSourceControlCharacterError':
    'The repository URL contains unsupported control characters.',
  'submodule.addPathUnreadableError':
    'Unable to read the path on disk. Check the path and try again.',
  'submodule.addPathNotEmptyError':
    'This folder contains files. Git can only clone to empty folders.',
  'submodule.addPathIsFileError':
    'A file already uses this name. Git can only clone to a folder.',
  'submodule.configTitle': 'Configure {name}',
  'submodule.configUrlRequired':
    'Enter a remote URL, or use Deinit to retire this submodule instead.',
  'submodule.configSetUrlFailed': 'Failed setting the URL for {path}: {error}',
  'submodule.configSetBranchFailed':
    'Failed setting the branch for {path}: {error}',
  'submodule.configSetKeyFailed': 'Failed setting {setting}: {error}',
  'submodule.configSyncFailed': 'Failed syncing {path}: {error}',
  'submodule.configInitFailed': 'Failed initializing {path}: {error}',
  'submodule.configDeinitFailed': 'Failed deinitializing {path}: {error}',
  'submodule.configRemoteUrlLabel': 'Remote URL',
  'submodule.configBranchLabel': 'Branch',
  'submodule.configUpdateStrategyLabel': 'Update strategy',
  'submodule.configUseDefaultCheckout': 'Use default (checkout)',
  'submodule.configCheckoutOption': 'Checkout',
  'submodule.configRebaseOption': 'Rebase',
  'submodule.configMergeOption': 'Merge',
  'submodule.configNoneOption': 'None',
  'submodule.configIgnoreDirtyLabel': 'Ignore dirty state',
  'submodule.configUseDefaultNone': 'Use default (none)',
  'submodule.configUntrackedOption': 'Untracked',
  'submodule.configDirtyOption': 'Dirty',
  'submodule.configAllOption': 'All',
  'submodule.configFetchRecurseLabel': 'Fetch recurse submodules',
  'submodule.configUseDefaultOnDemand': 'Use default (on-demand)',
  'submodule.configYesOption': 'Yes',
  'submodule.configOnDemandOption': 'On demand',
  'submodule.configNoOption': 'No',
  'submodule.configShallowCloneLabel': 'Shallow clone',
  'submodule.configUseDefaultAction': 'Use default',
  'submodule.configUrlHelp':
    'Saving a new URL also syncs it into the checked-out submodule.',
  'submodule.configBranchHelp': 'Leave empty to track the remote HEAD.',
  'submodule.configShallowHelp':
    "When neither checked nor unchecked, Git's default (full history) applies.",
  'submodule.configActionsLabel': 'Submodule actions',
  'submodule.configInitAction': 'Init',
  'submodule.configInitTooltip':
    'Register this submodule in the local configuration',
  'submodule.configDeinitRequestAction': 'Deinit…',
  'submodule.configDeinitAction': 'Deinit',
  'submodule.configDeinitTooltip':
    'Unregister this submodule and clear its working tree',
  'submodule.configSaveAction': 'Save changes',
  'submodule.configCancelAction': 'Cancel',
  'submodule.configDeinitConfirmation':
    'Are you sure you want to deinit {path}? This unregisters the submodule and clears its working tree, discarding any local changes inside it.',
  'fileList.viewMode': 'Changed-files layout',
  'fileList.flat': 'Flat',
  'fileList.tree': 'Tree',
  'fileList.directory': 'Directory {path}',
  'diff.context.legend': 'Diff context',
  'diff.context.autoExpand': 'Automatically expand whole-file context',
  'diff.context.autoExpandHelp':
    'Small files open fully; large or partial files stay safely collapsed.',
  'diff.context.stepLegend': 'Context expansion step',
  'diff.context.lines': '{count} lines',
  'history.scope': 'History scope',
  'history.scope.currentBranch': 'Current branch',
  'history.scope.allRefs': 'All branches & tags',
  'diff.structured.viewSwitcher': 'Structured diff view',
  'diff.structured.code': 'Code',
  'diff.structured.table': 'Table',
  'diff.structured.csvCaption': 'CSV table diff',
  'diff.structured.tsvCaption': 'TSV table diff',
  'diff.structured.rowNumber': 'Row number',
  'diff.structured.column': 'Column {number}',
  'diff.structured.rowAdded': 'Added row',
  'diff.structured.rowRemoved': 'Removed row',
  'diff.structured.rowChanged': 'Changed row',
  'diff.structured.cellAdded': 'Added cell',
  'diff.structured.cellRemoved': 'Removed cell',
  'diff.structured.cellChanged': 'Changed cell',
  'diff.structured.selectionHint':
    'Switch to Code to select or discard individual lines.',
  'prCreate.title': 'Create GitHub pull request',
  'prCreate.reviewTitle': 'Review GitHub pull request',
  'prCreate.successTitle': 'GitHub pull request created',
  'prCreate.targetRepository': 'Target repository',
  'prCreate.account': 'Account',
  'prCreate.baseBranch': 'Base branch',
  'prCreate.headBranch': 'Head branch',
  'prCreate.currentBranch': 'Local branch: {branch}',
  'prCreate.template': 'Pull request template',
  'prCreate.noTemplate': 'Blank pull request',
  'prCreate.loadingOptions': 'Loading templates and repository choices…',
  'prCreate.optionalWarning':
    'Some optional choices are unavailable. You can still create the pull request.',
  'prCreate.titleField': 'Title',
  'prCreate.descriptionField': 'Description (optional)',
  'prCreate.charactersRemaining': '{count} characters remaining',
  'prCreate.markdownSupported': 'Markdown supported',
  'prCreate.draftAction': 'Create as draft pull request',
  'prCreate.reviewers': 'Reviewers',
  'prCreate.assignees': 'Assignees',
  'prCreate.labels': 'Labels',
  'prCreate.milestone': 'Milestone',
  'prCreate.none': 'None',
  'prCreate.choiceUnavailable': 'Suggestions unavailable for this account',
  'prCreate.choiceCapped': 'Showing the first bounded set of choices',
  'prCreate.cancel': 'Cancel',
  'prCreate.close': 'Close',
  'prCreate.reviewAction': 'Review pull request',
  'prCreate.backToEdit': 'Back to edit',
  'prCreate.createAction': 'Create pull request',
  'prCreate.createDraftAction': 'Create draft pull request',
  'prCreate.creating': 'Creating pull request…',
  'prCreate.waitingFor': 'Waiting for {target}',
  'prCreate.cancelRequest': 'Cancel request',
  'prCreate.canceling': 'Canceling…',
  'prCreate.readyStatus': 'Ready for review',
  'prCreate.draftStatus': 'Draft',
  'prCreate.description': 'Description',
  'prCreate.noDescription': 'No description',
  'prCreate.metadataSummary':
    'Reviewers: {reviewers}; assignees: {assignees}; labels: {labels}; milestone: {milestone}',
  'prCreate.confirmation':
    'Confirming will create this {status} pull request in {target} as {account}. A canceled request may still have reached GitHub.',
  'prCreate.created': 'Pull request #{number} created',
  'prCreate.draftCreated': 'Draft pull request #{number} created',
  'prCreate.done': 'Done',
  'prCreate.openOnGitHub': 'Open on GitHub',
  'prCreate.partialSuccess':
    'The pull request was created, with follow-up notices:',
  'prCreate.templateNotice': 'Template notice: {notice}',
  'mrEditor.createTitle': 'Create merge request',
  'mrEditor.editTitle': 'Edit merge request',
  'mrEditor.description':
    'Prepare bounded merge-request details for this repository-bound GitLab account.',
  'mrEditor.project': 'Project',
  'mrEditor.boundAccount': 'Repository account',
  'mrEditor.routeAria': 'Exact GitLab project and repository account',
  'mrEditor.formAria': 'Merge request details',
  'mrEditor.sourceBranch': 'Source branch',
  'mrEditor.sourceEditLocked':
    'GitLab does not support changing the source branch after creation.',
  'mrEditor.targetBranch': 'Target branch',
  'mrEditor.titleField': 'Title',
  'mrEditor.descriptionField': 'Description (optional)',
  'mrEditor.charactersRemaining': '{count} characters remaining',
  'mrEditor.markdownSupported': 'Markdown supported',
  'mrEditor.draftAction': 'Draft merge request',
  'mrEditor.reviewers': 'Reviewers',
  'mrEditor.assignees': 'Assignees',
  'mrEditor.reviewersUnavailable':
    'Reviewer choices are unavailable. Other fields remain editable.',
  'mrEditor.assigneesUnavailable':
    'Assignee choices are unavailable. Other fields remain editable.',
  'mrEditor.noneAvailable': 'No choices are available.',
  'mrEditor.keyboardHint':
    'Press Enter in Title or Ctrl+Enter in Description to submit.',
  'mrEditor.cancel': 'Cancel',
  'mrEditor.refresh': 'Refresh merge-request context',
  'mrEditor.createAction': 'Create merge request',
  'mrEditor.saveAction': 'Save merge request',
  'mrEditor.creating': 'Creating merge request…',
  'mrEditor.saving': 'Saving merge request…',
  'mrEditor.created': 'Merge request created.',
  'mrEditor.saved': 'Merge request saved.',
  'mrEditor.canceled': 'The merge-request operation was canceled.',
  'mrEditor.loading': 'Loading bounded merge-request choices…',
  'mrEditor.emptyBranches': 'No branches are available for a merge request.',
  'mrEditor.emptySource': 'No source branches are available.',
  'mrEditor.emptyTarget': 'No target branches are available.',
  'mrEditor.emptyDescription':
    'Refresh after the repository and its GitLab project have branches.',
  'mrEditor.errorTitle': 'Merge-request choices are unavailable',
  'mrEditor.errorAuthentication':
    'The repository-bound GitLab account could not be authenticated.',
  'mrEditor.errorPermission':
    'The repository-bound GitLab account cannot read this project.',
  'mrEditor.errorNetwork':
    'GitLab could not be reached. Check the network and retry.',
  'mrEditor.errorUnsupported':
    'This GitLab server does not expose the required merge-request API.',
  'mrEditor.errorInvalidResponse':
    'GitLab returned data that could not be safely validated.',
  'mrEditor.errorUnknown':
    'The merge-request context could not be loaded. Refresh and try again.',
  'mrEditor.staleTitle': 'Repository or account context changed',
  'mrEditor.staleDescription':
    'This editor is bound to an older repository, account, endpoint, or request version. Refresh before submitting.',
  'mrEditor.partialTitle': 'Some optional choices are incomplete',
  'mrEditor.partialUnavailable':
    'Unavailable reviewer or assignee fields are disabled; required fields remain usable.',
  'mrEditor.partialCapped':
    'One or more choice lists reached a safety limit or contained rejected entries.',
  'mrEditor.readinessLabel': 'Merge readiness',
  'mrEditor.readinessChecking': 'GitLab is still checking merge readiness…',
  'mrEditor.readinessReady': 'Ready to merge',
  'mrEditor.readinessBlocked': 'Blocked: {reason}',
  'mrEditor.readinessUnknown': 'Merge readiness is not available yet.',
  'mrEditor.blockerStatus': 'project policy or merge checks',
  'mrEditor.blockerCiMustPass': 'the pipeline must pass',
  'mrEditor.blockerCiRunning': 'the pipeline is still running',
  'mrEditor.blockerConflict': 'source and target have conflicts',
  'mrEditor.blockerDiscussions': 'review discussions remain unresolved',
  'mrEditor.blockerDraft': 'the merge request is still a draft',
  'mrEditor.blockerExternalChecks': 'external status checks are incomplete',
  'mrEditor.blockerJira': 'a required Jira association is missing',
  'mrEditor.blockerRebase': 'the source branch needs a rebase',
  'mrEditor.blockerApproval': 'required approvals are missing',
  'mrEditor.blockerNotOpen': 'the merge request is not open',
  'mrEditor.blockerPolicy': 'a merge policy denied this request',
  'mrEditor.blockerCommitsStatus': 'one or more commit statuses are blocking',
  'mrEditor.blockerRequestBlocked':
    'another merge-request condition is blocking',
  'mrEditor.blockerMergeTime': 'the scheduled merge time has not arrived',
  'mrEditor.blockerRequestedChanges': 'a reviewer requested changes',
  'mrEditor.blockerSecurityPipeline':
    'the security-policy pipeline check is incomplete',
  'mrEditor.blockerSecurityViolation': 'a security policy has violations',
  'mrEditor.blockerStatusChecks': 'required status checks must pass',
  'mrEditor.blockerLockedPaths': 'one or more changed paths are locked',
  'mrEditor.blockerLockedLfs': 'one or more changed LFS files are locked',
  'mrEditor.blockerTitleRegex': 'the title does not match project policy',
  'mrEditor.validationTitle': 'Fix these merge-request details:',
  'mrEditor.validationSource': 'Choose a valid source branch.',
  'mrEditor.validationTarget': 'Choose a valid target branch.',
  'mrEditor.validationBranchesDiffer':
    'Source and target branches must be different.',
  'mrEditor.validationTitleRequired': 'Enter a merge-request title.',
  'mrEditor.validationTitleLength':
    'The title exceeds the 255-character safety limit.',
  'mrEditor.validationTitleInvalid':
    'Remove surrounding whitespace or unsupported control characters from the title.',
  'mrEditor.validationBodyLength':
    'The description exceeds the 128 KiB safety limit.',
  'mrEditor.validationBodyInvalid':
    'The description contains an unsupported null character.',
  'mrEditor.validationReviewerLimit': 'Select at most 20 reviewers.',
  'mrEditor.validationAssigneeLimit': 'Select at most 20 assignees.',
  'mrEditor.validationReviewerDuplicate':
    'Each reviewer may be selected only once.',
  'mrEditor.validationAssigneeDuplicate':
    'Each assignee may be selected only once.',
  'mrEditor.validationReviewerInvalid':
    'A selected reviewer is not in the current bounded choices.',
  'mrEditor.validationAssigneeInvalid':
    'A selected assignee is not in the current bounded choices.',
  'mrEditor.submitRejected':
    'GitLab rejected the merge-request update. Refresh and review the current state.',
  'mrEditor.submitNetwork':
    'The merge-request update could not reach GitLab. Check the network and retry.',
  'mrEditor.submitStale':
    'The repository, account, merge request, or HEAD changed before the update completed.',
  'mrEditor.submitInvalidResponse':
    'GitLab returned an update result that could not be safely validated.',
  'mrEditor.submitUnknown':
    'The merge-request update did not complete. Refresh before retrying.',
  'mrLifecycle.title': 'Merge request lifecycle',
  'mrLifecycle.loading': 'Loading the merge-request lifecycle…',
  'mrLifecycle.empty': 'No merge request is selected',
  'mrLifecycle.emptyDescription':
    'Create or select a merge request to manage its lifecycle.',
  'mrLifecycle.unavailable': 'Merge-request lifecycle is unavailable',
  'mrLifecycle.unavailableDescription':
    'Refresh the repository-bound GitLab context and try again.',
  'mrLifecycle.stale': 'Merge-request lifecycle context changed',
  'mrLifecycle.staleDescription':
    'Repository, account, merge request, or HEAD details changed. Refresh before acting.',
  'mrLifecycle.partial':
    'Some lifecycle details are unavailable; available actions remain bounded.',
  'mrLifecycle.summaryAria': 'Merge request lifecycle summary',
  'mrLifecycle.state': 'State',
  'mrLifecycle.stateOpened': 'Open',
  'mrLifecycle.stateClosed': 'Closed',
  'mrLifecycle.stateMerged': 'Merged',
  'mrLifecycle.stateLocked': 'Locked',
  'mrLifecycle.draft': 'Draft',
  'mrLifecycle.author': 'Author',
  'mrLifecycle.reviewers': 'Reviewers',
  'mrLifecycle.assignees': 'Assignees',
  'mrLifecycle.none': 'None',
  'mrLifecycle.approval': 'Approval progress',
  'mrLifecycle.approvalUnavailable': 'Approval state is unavailable.',
  'mrLifecycle.approvalComplete': 'Required approvals complete',
  'mrLifecycle.approvalProgress': '{approved} of {required} required approvals',
  'mrLifecycle.approvedBy': 'Approved by {names}',
  'mrLifecycle.pipeline': 'Pipeline',
  'mrLifecycle.pipelineUnavailable': 'Pipeline state is unavailable.',
  'mrLifecycle.pipelineNone': 'No pipeline reported',
  'mrLifecycle.pipelinePending': 'Pending',
  'mrLifecycle.pipelineRunning': 'Running',
  'mrLifecycle.pipelinePassed': 'Passed',
  'mrLifecycle.pipelineFailed': 'Failed',
  'mrLifecycle.pipelineCanceled': 'Canceled',
  'mrLifecycle.pipelineSkipped': 'Skipped',
  'mrLifecycle.pipelineUnknown': 'Unknown',
  'mrLifecycle.readiness': 'Merge readiness',
  'mrLifecycle.updated': 'Updated',
  'mrLifecycle.timeUnavailable': 'Time unavailable',
  'mrLifecycle.close': 'Close merge request',
  'mrLifecycle.reopen': 'Reopen merge request',
  'mrLifecycle.approve': 'Approve current HEAD',
  'mrLifecycle.unapprove': 'Remove approval',
  'mrLifecycle.refresh': 'Refresh lifecycle',
  'mrLifecycle.openCanonical': 'Open on GitLab',
  'mrLifecycle.operationRunning': '{action}…',
  'mrLifecycle.operationSuccess': '{action} completed.',
  'mrLifecycle.operationCanceled': 'The lifecycle operation was canceled.',
  'mrLifecycle.operationError':
    'The lifecycle operation did not complete. Refresh before retrying.',
  'forkCheckout.action': 'Checkout from another fork…',
  'forkCheckout.title': 'Checkout a branch from another fork',
  'forkCheckout.description':
    'Choose an exact fork and branch head, review the managed refs, then checkout safely.',
  'forkCheckout.close': 'Close fork branch checkout',
  'forkCheckout.loadingForks': 'Loading repository network…',
  'forkCheckout.forkLabel': 'Fork repository',
  'forkCheckout.chooseFork': 'Choose a fork',
  'forkCheckout.filterForks': 'Filter forks by owner or repository',
  'forkCheckout.loadingBranches': 'Loading exact branch heads…',
  'forkCheckout.branchLabel': 'Fork branch',
  'forkCheckout.chooseBranch': 'Choose a branch',
  'forkCheckout.filterBranches': 'Filter fork branches',
  'forkCheckout.localBranchLabel': 'New local branch',
  'forkCheckout.review': 'Review checkout',
  'forkCheckout.reviewing': 'Reviewing local refs…',
  'forkCheckout.confirmHeading': 'Confirm exact checkout',
  'forkCheckout.source': 'Source',
  'forkCheckout.head': 'Reviewed head',
  'forkCheckout.local': 'Local branch',
  'forkCheckout.remote': 'Managed remote',
  'forkCheckout.remoteNew': '{remote} (will be created)',
  'forkCheckout.remoteReuse': '{remote} (existing Desktop remote)',
  'forkCheckout.remoteRef': 'Managed remote ref',
  'forkCheckout.staleGuard':
    'Confirmation rechecks the repository, fork, branch head, remotes, and local branch before changing Git.',
  'forkCheckout.confirm': 'Fetch and checkout',
  'forkCheckout.checkingOut': 'Revalidating, fetching, and preparing checkout…',
  'forkCheckout.success':
    'Prepared {branch} at {sha}. If local changes need attention, finish Desktop’s checkout prompt.',
  'forkCheckout.limitNotice':
    'This list reached its safety cap. Filter the visible results or refresh after narrowing the network on GitHub.',
  'forkCheckout.rejectedNotice':
    '{count} malformed or unsafe API item(s) were ignored.',
  'forkCheckout.emptyForks':
    'No other visible forks were found for this network.',
  'forkCheckout.emptyBranches': 'No valid branches were found in this fork.',
  'forkCheckout.useSuggestion': 'Use suggested branch {branch}',
  'forkCheckout.errorUnsupported':
    'This workflow is available only for a GitHub repository.',
  'forkCheckout.errorSignIn':
    'Sign in with the account assigned to this repository, then try again.',
  'forkCheckout.errorMalformed':
    'GitHub returned repository-network data that could not be safely used.',
  'forkCheckout.errorStale':
    'The reviewed fork, branch, or local remote state changed. Refresh and review again.',
  'forkCheckout.errorContext':
    'The selected repository changed. Reopen its Branches panel and review again.',
  'forkCheckout.errorInvalid':
    'Choose a valid fork branch and a valid new local branch name.',
  'forkCheckout.errorCollision':
    'That local branch already exists. Choose a different local branch name.',
  'forkCheckout.errorRemoteCollision':
    'Desktop could not reserve a managed fork remote without overwriting an existing remote.',
  'forkCheckout.errorNetwork':
    'GitHub or Git could not read this fork. Check the network, account access, and repository permission, then retry.',
  'forkCheckout.errorMoved':
    'The fork branch moved after review. Reload its branches and review the new head.',
  'forkCheckout.errorGit':
    'Git could not prepare the reviewed refs. No existing local branch was overwritten.',
  'forkCheckout.errorUnknown':
    'The fork branch checkout could not be completed. Refresh and try again.',
  'projects.title': 'GitHub Projects',
  'projects.description':
    'Browse a bounded, read-only snapshot of this repository’s project views, items, and status fields.',
  'projects.refresh': 'Refresh Projects',
  'projects.sourceLive': 'Live from GitHub',
  'projects.sourceCached': 'Offline cache',
  'projects.sourceUnavailable': 'No snapshot',
  'projects.updatedAt': 'Snapshot from {timestamp}',
  'projects.stale': 'Cached more than 24 hours ago',
  'projects.refreshing': 'Refreshing…',
  'projects.readOnly':
    'Read-only: this workspace never edits Projects, fields, views, or items.',
  'projects.errorSignedOut':
    'Sign in with the GitHub account selected for this repository to refresh Projects.',
  'projects.errorAuthentication':
    'GitHub could not authenticate the selected account. Sign in again, then retry.',
  'projects.errorPermission':
    'GitHub denied access to Projects. Check this account’s repository and Projects permissions.',
  'projects.errorRateLimit':
    'The GitHub API rate limit was reached. Keep using the cache and retry after it resets.',
  'projects.errorNotFound':
    'GitHub could not find this repository or its Projects for the selected account.',
  'projects.errorUnsupported':
    'This GitHub server does not expose a supported Projects read API.',
  'projects.errorService':
    'GitHub Projects is temporarily unavailable. Retry in a moment.',
  'projects.errorNetwork':
    'GitHub Projects could not be reached. Check the network and retry.',
  'projects.errorInvalidResponse':
    'GitHub returned Projects data the app could not safely validate.',
  'projects.cacheRecovery': 'Showing the last validated offline snapshot.',
  'projects.partialTitle': 'Partial snapshot',
  'projects.partialProjects':
    'The project safety limit was reached; additional projects are not shown.',
  'projects.partialItems':
    'The item safety limit was reached; additional items are not shown.',
  'projects.partialViews':
    'The view safety limit was reached; additional views are not shown.',
  'projects.partialClassic':
    'Projects v2 is unavailable on this server, so this snapshot uses the read-only classic API fallback.',
  'projects.listAria': 'Repository Projects',
  'projects.itemCount': '{count} loaded items',
  'projects.stateOpen': 'Open',
  'projects.stateClosed': 'Closed',
  'projects.openOnGitHub': 'Open on GitHub',
  'projects.viewsAria': 'Project views',
  'projects.noItems': 'No items were returned for this project.',
  'projects.emptyTitle': 'No Projects returned',
  'projects.emptyDescription':
    'This repository has no visible Projects, or the selected account cannot see them.',
  'projects.kindIssue': 'Issue',
  'projects.kindPullRequest': 'Pull request',
  'projects.kindDraftIssue': 'Draft issue',
  'projects.kindNote': 'Note',
  'projects.kindUnavailable': 'Unavailable item',
  'projects.loading': 'Loading a bounded Projects snapshot…',
  'reviewRequest.manage': 'Manage review request…',
  'reviewRequest.openInBrowser': 'Open review request in browser',
  'reviewRequest.reviewRequested': 'Review requested',
  'reviewRequest.statusDraft': 'Draft',
  'reviewRequest.statusOpen': 'Open',
  'reviewRequest.noDescription': 'No description provided.',
  'reviewRequest.markdownBodyAriaLabel': 'Review request markdown body',
  'reviewRequest.quickViewAriaLabel': 'Review request #{number} quick view',
  'globalIgnore.title': 'Global ignore rules',
  'globalIgnore.description':
    "These rules apply to every local repository through Git's core.excludesFile. Repository .gitignore files remain separate and can add repository-specific rules.",
  'globalIgnore.pathLabel': 'Ignore file',
  'globalIgnore.loading': 'Loading the effective Git configuration…',
  'globalIgnore.configuredExisting':
    'Git is configured to use this existing file.',
  'globalIgnore.configuredNew': 'Git is configured to use this new file.',
  'globalIgnore.notConfigured':
    'Saving will create this file and configure Git to use it.',
  'globalIgnore.starterRules': 'Starter rules',
  'globalIgnore.addEditorFiles': 'Add editor files',
  'globalIgnore.addOSFiles': 'Add OS files',
  'globalIgnore.rulesAria': 'Global ignore rules',
  'globalIgnore.patternPlaceholder': 'One gitignore pattern per line',
  'globalIgnore.reload': 'Reload',
  'globalIgnore.savingAction': 'Saving…',
  'globalIgnore.saveAction': 'Save global rules',
  'globalIgnore.savingStatus': 'Saving global ignore rules…',
  'globalIgnore.savedStatus': 'Global ignore rules saved and activated.',
  'globalIgnore.loadError': 'Global ignore rules could not be loaded: {error}',
  'globalIgnore.saveError': 'Global ignore rules were not changed: {error}',
  'customGit.title': 'Custom Git command presets',
  'customGit.description':
    'Save local, non-shell Git argument presets. Every run is reviewed and bound to the currently selected repository.',
  'customGit.savedPreset': 'Saved preset',
  'customGit.newUnsavedPreset': 'New unsaved preset',
  'customGit.newAction': 'New',
  'customGit.name': 'Name',
  'customGit.subcommand': 'Git subcommand',
  'customGit.arguments': 'Arguments',
  'customGit.warning':
    'Do not put passwords or tokens in presets. Interactive commands are unsupported because standard input is closed.',
  'customGit.saveAction': 'Save preset',
  'customGit.reviewAction': 'Review run',
  'customGit.deleteAction': 'Delete preset',
  'customGit.cancelRun': 'Cancel run',
  'customGit.confirmRunTitle': 'Run this command in the selected repository?',
  'customGit.confirmRunWarning':
    'Git built-ins can change files, refs, remotes, and published history. Review the complete preset before continuing.',
  'customGit.runReviewed': 'Run reviewed command',
  'customGit.goBack': 'Go back',
  'customGit.confirmDeleteTitle': 'Delete this local preset?',
  'customGit.confirmDeleteDescription': 'The repository is not changed.',
  'customGit.keepPreset': 'Keep preset',
  'customGit.outputAria': 'Custom Git command output',
  'customGit.initialStatus': 'Create or select a local command preset.',
  'customGit.repositoryChangedStatus':
    'Repository changed. Review the preset again.',
  'customGit.invalidNameError':
    'Preset names must be 1–80 printable characters.',
  'customGit.savedStatus': 'Preset saved on this device.',
  'customGit.saveError': 'Unable to save the preset.',
  'customGit.removedStatus': 'Preset removed from this device.',
  'customGit.reviewError': 'Unable to review command.',
  'customGit.runningStatus': 'Running reviewed Git preset…',
  'customGit.startError': 'The preset could not start.',
  'customGit.completedStatus': 'Custom Git preset completed.',
  'customGit.cancelledStatus': 'Custom Git preset cancelled.',
  'customGit.failedStatus': 'Custom Git preset failed.',
  'customGit.exitCodeError': 'Git exited with code {code}.',
  'editor.wslDisplayName': '{editor} — WSL: {distribution}',
  'editor.wslDistributionMismatch':
    'This path belongs to WSL distribution “{distribution}”. Choose its matching WSL editor entry.',
  'editor.wslInvalidDistributionPath':
    'Choose a valid WSL distribution and path.',
  'editor.wslTranslateFailed':
    'WSL could not translate this path. Check that the selected distribution is running and try again.',
  'editor.wslInvalidTranslatedPath': 'WSL returned an invalid translated path.',
  'editor.wslInvalidTarget': 'Choose a valid WSL editor target.',
  'networkRepository.unavailable':
    'This network location is unavailable or does not appear to be a Git repository.',
  'networkRepository.reconnect':
    'Reconnect the share, mapped drive, VPN, or WSL distribution and try again.',
  'networkRepository.unavailableAria':
    'This network location is unavailable or is not a Git repository. Reconnect it and try again.',
  'networkRepository.mappedDrive': 'mapped network drive',
  'networkRepository.wslShare': 'WSL share',
  'networkRepository.uncShare': 'UNC network share',
  'networkRepository.detected':
    'Detected a {location}. Desktop Material keeps its exact path; reconnect it before Git operations if the location goes offline.',
  'batchSync.title': 'Sync repositories',
  'batchSync.loadingChoices': 'Loading repository choices…',
  'batchSync.reviewAria': 'Repository batch review',
  'batchSync.operation': 'Operation',
  'batchSync.pullActive': 'Pull active branches',
  'batchSync.fetchOnly': 'Fetch only (leave worktrees unchanged)',
  'batchSync.chooseRepositories': 'Choose repositories',
  'batchSync.selectAll': 'Select all',
  'batchSync.selectNone': 'Select none',
  'batchSync.noRepositories': 'No repositories are available.',
  'batchSync.candidatesAria': 'Repositories to synchronize',
  'batchSync.reviewSingle':
    'Up to three repositories run at once. Each repository keeps an isolated result, and only this {count} reviewed repository is included.',
  'batchSync.reviewMultiple':
    'Up to three repositories run at once. Each repository keeps an isolated result, and only these {count} reviewed repositories are included.',
  'batchSync.cancel': 'Cancel',
  'batchSync.startPull': 'Start pull',
  'batchSync.startFetch': 'Start fetch',
  'batchSync.progressAria': 'Sync progress',
  'batchSync.stopped': 'Sync stopped',
  'batchSync.pullComplete': 'Pull complete',
  'batchSync.fetchComplete': 'Fetch complete',
  'batchSync.liveProgress': 'Live progress',
  'batchSync.couldNotFinish': 'Repository sync could not finish',
  'batchSync.allProcessed': 'All repositories processed',
  'batchSync.pullingRepositories': 'Pulling repositories',
  'batchSync.fetchingRepositories': 'Fetching repositories',
  'batchSync.completedOf': '{completed} of {total} repositories complete',
  'batchSync.synchronizedAria': 'Repositories synchronized',
  'batchSync.metricComplete': '{count} complete',
  'batchSync.metricActive': '{count} active',
  'batchSync.metricWaiting': '{count} waiting',
  'batchSync.finalResult': 'Every repository has a final result.',
  'batchSync.nowPulling': 'Now pulling: {repositories}',
  'batchSync.nowFetching': 'Now fetching: {repositories}',
  'batchSync.waitingNext': 'Waiting for the next repository to start.',
  'batchSync.backgroundNote':
    'Up to three repositories are synchronized at a time. You can run this in the background while the work continues.',
  'batchSync.summaryPull':
    '{completed} pulled, {skipped} skipped, {failed} failed.',
  'batchSync.summaryFetch':
    '{completed} fetched, {skipped} skipped, {failed} failed.',
  'batchSync.noneToPull': 'There were no repositories to pull.',
  'batchSync.resultsAria': 'Repository sync progress',
  'batchSync.repository': 'Repository',
  'batchSync.status': 'Status',
  'batchSync.detail': 'Current operation or result',
  'batchSync.runBackground': 'Run in background',
  'batchSync.done': 'Done',
  'batchSync.statusWaiting': 'Waiting',
  'batchSync.statusPulling': 'Pulling',
  'batchSync.statusFetching': 'Fetching',
  'batchSync.statusPulled': 'Pulled',
  'batchSync.statusFetched': 'Fetched',
  'batchSync.statusSkipped': 'Skipped',
  'batchSync.statusFailed': 'Failed',
  'repositoryPicker.status': 'Repository status',
  'repositoryPicker.all': 'All',
  'repositoryPicker.clean': 'Clean',
  'repositoryPicker.changed': 'Changed',
  'repositoryPicker.ahead': 'Ahead',
  'repositoryPicker.behind': 'Behind',
  'repositoryPicker.missingOrCloning': 'Missing / cloning',
  'repositoryPicker.hideHiddenAria': 'Hide hidden repositories',
  'repositoryPicker.showHiddenAria': 'Show hidden repositories ({count})',
  'repositoryPicker.showingHidden': 'Showing hidden ({count})',
  'repositoryPicker.showHidden': 'Show hidden ({count})',
  'repositoryPicker.hidden': 'Hidden',
  'repositoryPicker.itemHiddenAria': '{repository}, hidden',
  'repositoryPicker.hideMenu': 'Hide repository',
  'repositoryPicker.unhideMenu': 'Unhide repository',
  'repositoryPicker.customizeNameMenu': 'Customize name appearance',
  'repositoryPicker.customizeLogoMenu': 'Customize logo appearance',
  'removeRepository.trashFailedMessage':
    "The repository couldn't be moved to {trash}. A file may be open in another program, or the location (such as a network or removable drive) may not support {trash}.",
  'removeRepository.trashFailedWarning':
    'Force delete permanently removes the folder and all of its contents from your disk. This cannot be undone.',
  'removeRepository.forceDeleteButton': 'Force delete permanently',
  'patchSeries.initialStatus': 'Choose an export or import operation.',
  'patchSeries.runningExport':
    'Exporting commits ahead of the configured upstream',
  'patchSeries.runningImport': 'Applying the reviewed patch series',
  'patchSeries.runningContinue': 'Continuing the current patch session',
  'patchSeries.runningSkip': 'Skipping the current patch',
  'patchSeries.runningAbort': 'Aborting the current patch session',
  'patchSeries.operation': 'Patch-series operation',
  'patchSeries.chooseExportTitle': 'Choose a new patch-series folder',
  'patchSeries.reviewExportStatus': 'Review the new export folder.',
  'patchSeries.prepareExportError':
    'Unable to prepare the patch-series export.',
  'patchSeries.prepareExportFailed': 'Patch export preparation failed.',
  'patchSeries.chooseImportTitle': 'Choose patch files in apply order',
  'patchSeries.patchFileFilter': 'Git patch series',
  'patchSeries.reviewImportStatus': 'Review the selected patch order.',
  'patchSeries.prepareImportError':
    'Unable to prepare the patch-series import.',
  'patchSeries.prepareImportFailed': 'Patch import preparation failed.',
  'patchSeries.runningStatus': '{operation}…',
  'patchSeries.startError': 'Unable to start the patch-series operation.',
  'patchSeries.cancelledStatus': 'Patch-series operation cancelled.',
  'patchSeries.failedStatus': '{operation} failed.',
  'patchSeries.gitFailed': 'Git could not complete this operation.',
  'patchSeries.gitFailedWithCode':
    'Git could not complete this operation (exit {code}).',
  'patchSeries.refreshingStatus': 'Refreshing repository…',
  'patchSeries.exportedStatus': 'Patch series exported to a new folder.',
  'patchSeries.abortedStatus':
    'Patch session aborted and repository state restored.',
  'patchSeries.completedStatus': 'Patch-series operation completed.',
  'patchSeries.refreshFailedStatus':
    'The patch operation completed, but refresh failed.',
  'patchSeries.refreshRequiredError':
    'Refresh the repository before starting another operation.',
  'patchSeries.exportConfirmTitle': 'Export commits ahead of upstream?',
  'patchSeries.exportConfirmDescription':
    'Git will create a new numbered patch-series folder at {destination}. Existing destinations are never replaced.',
  'patchSeries.exportAction': 'Export patch series',
  'patchSeries.goBack': 'Go back',
  'patchSeries.importConfirmTitle': 'Apply {count} patches in this order?',
  'patchSeries.importConfirmDescription':
    'Git will create commits with three-way fallback. Resolve any conflict in Changes, then continue, skip, or abort here.',
  'patchSeries.additionalPatches': '{count} additional patches selected.',
  'patchSeries.importAction': 'Apply patch series',
  'patchSeries.recoveryAria': 'Patch conflict recovery',
  'patchSeries.recoveryDescription':
    'After resolving files in Changes, continue this patch, skip it, or abort the complete import.',
  'patchSeries.continueAction': 'Continue',
  'patchSeries.skipAction': 'Skip patch',
  'patchSeries.abortAction': 'Abort import',
  'patchSeries.title': 'Patch series',
  'patchSeries.heading': 'Exchange reviewable commit series',
  'patchSeries.description':
    'Export commits ahead of the configured upstream, or apply a native-picker selection of numbered patches in reviewed order.',
  'patchSeries.chooseExportAction': 'Choose export destination',
  'patchSeries.chooseImportAction': 'Choose patch files',
  'patchSeries.cancelAction': 'Cancel',
  'patchSeries.resultsAria': 'Patch-series results',
  'bulkBranchDelete.aria': 'Bulk branch deletion',
  'bulkBranchDelete.closeAction': 'Close branch cleanup',
  'bulkBranchDelete.openAction': 'Delete branches…',
  'bulkBranchDelete.reviewTitle': 'Review local branches',
  'bulkBranchDelete.protectedDescription':
    'Current and default branches are protected.',
  'bulkBranchDelete.selectAll': 'Select all',
  'bulkBranchDelete.selectNone': 'Select none',
  'bulkBranchDelete.empty': 'No other local branches can be deleted.',
  'bulkBranchDelete.listAria': 'Local branches to delete',
  'bulkBranchDelete.reviewDeletion': 'Review deletion ({count})',
  'bulkBranchDelete.confirmSingular':
    'Permanently delete {count} exact local branch?',
  'bulkBranchDelete.confirmPlural':
    'Permanently delete {count} exact local branches?',
  'bulkBranchDelete.remoteUnaffected':
    'Remote branches are not changed. Each local tip is rechecked before deletion and logged for recovery.',
  'bulkBranchDelete.deleteReviewed': 'Delete reviewed branches',
  'bulkBranchDelete.goBack': 'Go back',
  'bulkBranchDelete.deleting': 'Deleting branches…',
  'bulkBranchDelete.limitError': 'Review at most {count} branches at a time.',
  'bulkBranchDelete.reviewChangedError': 'The reviewed branch list changed.',
  'bulkBranchDelete.deleteError': 'The reviewed branches could not be deleted.',
  'bulkBranchDelete.resultsAria': 'Deletion results',
  'stashManager.timeUnavailable': 'Time unavailable',
  'stashManager.timestamp': '{timestamp}',
  'stashManager.operationCancelled':
    '{operation} cancelled. The repository was refreshed.',
  'stashManager.operationFailed':
    '{operation} could not finish. Git may have left working-tree conflicts; the stash was kept whenever restore was not clean. Review Changes and try again.',
  'stashManager.repositoryChangedStatus':
    'Repository changed. The stash manager was reset.',
  'stashManager.operationProgress': '{operation}…',
  'stashManager.cancellingStatus': 'Cancelling…',
  'stashManager.createOperation': 'Creating named stash',
  'stashManager.createSuccess':
    'Named stash created. It is available under its recorded branch.',
  'stashManager.applyOperation': 'Applying stash copy',
  'stashManager.applySuccess':
    'Stashed changes were applied. The stash was kept for recovery.',
  'stashManager.saveDetailsOperation': 'Saving stash details',
  'stashManager.saveDetailsSuccess':
    'Stash name and branch association updated.',
  'stashManager.clearOperation': 'Clearing reviewed stashes',
  'stashManager.clearSuccessSingular':
    '{count} reviewed Desktop-managed stash cleared. Other Git stashes were not touched.',
  'stashManager.clearSuccessPlural':
    '{count} reviewed Desktop-managed stashes cleared. Other Git stashes were not touched.',
  'stashManager.stashChangedError':
    'That stash changed. Refresh and review the current list.',
  'stashManager.restoreOperation': 'Restoring stash',
  'stashManager.restoreSuccess':
    'Stash restored and removed. Resolve any Changes conflicts before continuing.',
  'stashManager.discardOperation': 'Discarding stash',
  'stashManager.discardSuccess': 'Reviewed Desktop-managed stash discarded.',
  'stashManager.createBranchOperation': 'Creating branch from stash',
  'stashManager.createBranchSuccess':
    'New branch created and checked out. The stash was consumed only after a clean restore.',
  'stashManager.createHeading': 'Create a named stash',
  'stashManager.nameLabel': 'Name',
  'stashManager.createPlaceholder': 'What are you saving?',
  'stashManager.changesToSave': 'Changes to save',
  'stashManager.allTrackedChanges': 'All tracked changes',
  'stashManager.selectedFileSingular': '{count} selected file',
  'stashManager.selectedFilePlural': '{count} selected files',
  'stashManager.includeUntracked': 'Include untracked files in this scope',
  'stashManager.selectedScopeCaption':
    'Selected scope saves whole files and rechecks the selected paths before Git runs. Partial-hunk staging is left in Changes.',
  'stashManager.untrackedWarning':
    'Selected untracked files stay in Changes unless Include untracked is checked.',
  'stashManager.conflictsWarning':
    'Resolve the current working-tree conflicts before creating another stash.',
  'stashManager.createAction': 'Create named stash',
  'stashManager.fileCountSingular': '{count} file',
  'stashManager.fileCountPlural': '{count} files',
  'stashManager.filesLoadWhenOpened': 'Files load when opened',
  'stashManager.reviewStashAria': 'Review {name} for stash clear',
  'stashManager.externalLabel': 'External',
  'stashManager.selectedActionsAria': 'Selected stash actions',
  'stashManager.workingChangesWarningSingular':
    'Changes already contains {count} file. Apply or restore may conflict; a failed restore keeps the stash.',
  'stashManager.workingChangesWarningPlural':
    'Changes already contains {count} files. Apply or restore may conflict; a failed restore keeps the stash.',
  'stashManager.applyAction': 'Apply copy',
  'stashManager.restoreAction': 'Restore',
  'stashManager.renameMoveAction': 'Rename or move',
  'stashManager.newBranchAction': 'New branch',
  'stashManager.discardAction': 'Discard',
  'stashManager.editStashAria': 'Edit {name}',
  'stashManager.branchAssociation': 'Branch association',
  'stashManager.metadataCaption':
    'This changes Desktop Material’s grouping only; it does not switch branches or modify the saved files.',
  'stashManager.saveDetailsAction': 'Save details',
  'stashManager.cancelAction': 'Cancel',
  'stashManager.branchFromAria': 'Branch from {name}',
  'stashManager.newLocalBranch': 'New local branch',
  'stashManager.branchCaption':
    'Git validates that the branch is new, checks it out, and consumes the stash only after its changes apply cleanly.',
  'stashManager.reviewBranchAction': 'Review branch creation',
  'stashManager.confirmRestore':
    'Restore applies these changes and removes the stash only if Git finishes cleanly.',
  'stashManager.confirmDiscard':
    'Discard permanently removes this reviewed repository stash.',
  'stashManager.confirmBranch':
    'Create and check out “{name}” from this stash?',
  'stashManager.confirmClearSingular':
    'Permanently clear {count} reviewed repository stash? Only the exact checked identities are included.',
  'stashManager.confirmClearPlural':
    'Permanently clear {count} reviewed repository stashes? Only the exact checked identities are included.',
  'stashManager.createBranchAction': 'Create branch',
  'stashManager.confirmAction': 'Confirm',
  'stashManager.inventoryHeading': 'Repository stash inventory',
  'stashManager.clearReviewedAction': 'Clear reviewed ({count})',
  'stashManager.emptyInventory': 'No stashes in this repository.',
  'stashManager.currentLabel': 'Current',
  'stashManager.managedOnlyCaption':
    'All listed stashes were created by Desktop Material.',
  'stashManager.externalCaptionSingular':
    '{count} external Git stash is shown. Apply, restore, branch, and exact reviewed discard are supported; external metadata stays unchanged.',
  'stashManager.externalCaptionPlural':
    '{count} external Git stashes are shown. Apply, restore, branch, and exact reviewed discard are supported; external metadata stays unchanged.',
  'stashManager.truncatedCaption':
    ' The inventory is limited to the newest 500 entries; refresh after clearing a reviewed batch.',
  'stashManager.managerAria': 'Stash manager',
  'stashManager.repositoryStashSingular': '{count} repository stash',
  'stashManager.repositoryStashPlural': '{count} repository stashes',
  'stashManager.checkoutBranchCaption': 'Check out a branch to create one',
  'stashManager.onBranchCaption': '{count} on {branch}',
  'stashManager.closeAction': 'Close',
  'stashManager.manageAction': 'Manage',
  'stashManager.controlsAria': 'Managed stash controls',
  'stashManager.cancelOperationAction': 'Cancel operation',
  'tagLifecycle.rejectedError':
    'Git rejected the tag operation. Review the application error for details.',
  'tagLifecycle.operationFailedError': 'The tag operation failed.',
  'tagLifecycle.createdStatus': 'Created local tag {name}.',
  'tagLifecycle.movedStatus': 'Moved local tag {name}.',
  'tagLifecycle.deletedLocalStatus': 'Deleted local tag {name}.',
  'tagLifecycle.pushedStatus': 'Pushed tag {name}.',
  'tagLifecycle.pushedAllStatus': 'Pushed {count} local tags.',
  'tagLifecycle.fetchedPrunedStatus': 'Fetched and pruned tags from {remote}.',
  'tagLifecycle.deletedRemoteStatus': 'Deleted remote tag {name}.',
  'tagLifecycle.confirmMove': 'Recreate {name} at {target} as a {kind} tag.',
  'tagLifecycle.confirmDeleteLocal':
    'Delete local tag {name}. This does not delete the remote tag.',
  'tagLifecycle.confirmPushNew': 'Push new remote tag {name}.',
  'tagLifecycle.confirmPushReplace':
    'Push {name}, replacing only the exact reviewed remote tag object if it differs.',
  'tagLifecycle.confirmPushAll':
    'Push all {count} reviewed local tags, replacing only exact reviewed remote objects where needed.',
  'tagLifecycle.confirmFetchPrune':
    'Fetch tags from {remote} and delete reviewed local tags that the remote no longer advertises.',
  'tagLifecycle.confirmDeleteRemote':
    'Delete {name} from the default remote after revalidating object {object}.',
  'tagLifecycle.createHeading': 'Create tag',
  'tagLifecycle.nameLabel': 'Name',
  'tagLifecycle.targetLabel': 'Target',
  'tagLifecycle.targetPlaceholder': 'HEAD, branch, or object ID',
  'tagLifecycle.typeLabel': 'Type',
  'tagLifecycle.annotated': 'Annotated',
  'tagLifecycle.lightweight': 'Lightweight',
  'tagLifecycle.messageLabel': 'Message',
  'tagLifecycle.signConfigured': "Sign using Git's configured {format} signer",
  'tagLifecycle.signingConfigured':
    'Git reports an explicit signing key for this repository.',
  'tagLifecycle.signingNotConfigured':
    'No explicit user.signingkey is set; Git may use a default signer or report that signing is unavailable.',
  'tagLifecycle.createAction': 'Create local tag',
  'tagLifecycle.moveAria': 'Move {name}',
  'tagLifecycle.moveHeading': 'Move or recreate {name}',
  'tagLifecycle.reviewedObject':
    'The reviewed object is {object}. Git will reject this operation if the tag changes before confirmation.',
  'tagLifecycle.newTargetLabel': 'New target',
  'tagLifecycle.recreatedTypeLabel': 'Recreated type',
  'tagLifecycle.signRecreated': 'Sign recreated tag',
  'tagLifecycle.reviewMoveAction': 'Review move',
  'tagLifecycle.cancelAction': 'Cancel',
  'tagLifecycle.remoteNotLoaded': 'Remote not loaded',
  'tagLifecycle.localOnly': 'Local only',
  'tagLifecycle.pushed': 'Pushed',
  'tagLifecycle.differentRemotely': 'Different remotely',
  'tagLifecycle.annotatedLower': 'annotated',
  'tagLifecycle.lightweightLower': 'lightweight',
  'tagLifecycle.localTagMeta': '{kind} · {target} · {remoteStatus}{signed}',
  'tagLifecycle.signedSuffix': ' · signed',
  'tagLifecycle.moveAction': 'Move',
  'tagLifecycle.pushAction': 'Push',
  'tagLifecycle.deleteRemoteAction': 'Delete remote',
  'tagLifecycle.deleteLocalAction': 'Delete local',
  'tagLifecycle.remoteOnlyMeta': 'remote only · {target}',
  'tagLifecycle.confirmHeading': 'Confirm tag operation',
  'tagLifecycle.typeToConfirm': 'Type {phrase} to confirm',
  'tagLifecycle.confirmAction': 'Confirm',
  'tagLifecycle.managerAria': 'Tag lifecycle manager',
  'tagLifecycle.title': 'Tag lifecycle',
  'tagLifecycle.description':
    'Inventory, create, move, sign, push, fetch, prune, and delete tags through bounded Git operations.',
  'tagLifecycle.refreshLocalAction': 'Refresh local',
  'tagLifecycle.loadRemoteAction': 'Load remote',
  'tagLifecycle.readOnlyNotice':
    'Temporary submodule workspaces are read-only in Repository tools.',
  'tagLifecycle.loading': 'Loading tag inventory…',
  'tagLifecycle.filterLabel': 'Filter tags',
  'tagLifecycle.fetchedStatus': 'Fetched tags from {remote}.',
  'tagLifecycle.fetchAction': 'Fetch tags',
  'tagLifecycle.fetchPruneAction': 'Fetch and prune',
  'tagLifecycle.pushAllAction': 'Push all',
  'tagLifecycle.localTagsHeading': 'Local tags ({count})',
  'tagLifecycle.noLocalMatches': 'No local tags match this filter.',
  'tagLifecycle.localTruncated':
    'Showing the first 500 local tags. Narrow the repository tag set before bulk operations.',
  'tagLifecycle.remoteOnlyHeading': 'Remote-only tags ({count}) on {remote}',
  'tagLifecycle.noRemoteMatches': 'No remote-only tags match this filter.',
  'tagLifecycle.remoteTruncated':
    'Showing the first 500 remote tags. Remote deletion is disabled for undisplayed tags, and bulk push/prune stay unavailable until the inventory is complete.',
  'ollama.providerType': 'Ollama (local)',
  'ollama.authenticationHeading': 'Authentication',
  'ollama.authenticationDescription':
    "Ollama runs locally without an API key. Desktop Material will only use its native management API at this provider's configured URL.",
  'ollama.modelsSyncDescription':
    'Installed Ollama models will be synchronized from the model manager after you add this provider.',
  'ollama.modelsEmpty':
    'No models synchronized yet. Add this provider, then open its model manager.',
  'ollama.manager.openAction': 'Manage models',
  'ollama.manager.backAction': 'Back to providers',
  'ollama.manager.title': 'Ollama model manager',
  'ollama.manager.subtitle':
    'Install, inspect, and control models on this Ollama provider.',
  'ollama.manager.endpoint': 'Endpoint',
  'ollama.manager.configuredEndpoint': 'Configured endpoint',
  'ollama.manager.connected': 'Connected',
  'ollama.manager.unavailable': 'Unavailable',
  'ollama.manager.checking': 'Checking…',
  'ollama.manager.partial': 'Some model information could not be loaded.',
  'ollama.manager.version': 'Version',
  'ollama.manager.installed': 'Installed',
  'ollama.manager.running': 'Running',
  'ollama.manager.refresh': 'Refresh',
  'ollama.manager.refreshing': 'Refreshing…',
  'ollama.manager.searchLabel': 'Search installed models',
  'ollama.manager.searchPlaceholder': 'Search by name, family, or capability…',
  'ollama.manager.scopeLabel': 'Model inventory filter',
  'ollama.manager.allModels': 'All models',
  'ollama.manager.runningModels': 'Running only',
  'ollama.manager.inventoryLabel': 'Installed Ollama models',
  'ollama.manager.loadingInventory': 'Loading models…',
  'ollama.manager.unavailableInventory': 'The model inventory is unavailable.',
  'ollama.manager.emptyInventory': 'No models are installed on this endpoint.',
  'ollama.manager.emptyFilter': 'No models match the current filters.',
  'ollama.manager.modelDetails': 'Model details',
  'ollama.manager.selectModel':
    'Select an installed model to inspect and manage it.',
  'ollama.manager.loadingDetails': 'Loading model details…',
  'ollama.manager.runningBadge': 'Running',
  'ollama.manager.size': 'Size',
  'ollama.manager.modified': 'Modified',
  'ollama.manager.digest': 'Digest',
  'ollama.manager.family': 'Family',
  'ollama.manager.format': 'Format',
  'ollama.manager.parameters': 'Parameters',
  'ollama.manager.quantization': 'Quantization',
  'ollama.manager.capabilities': 'Capabilities',
  'ollama.manager.license': 'License summary',
  'ollama.manager.noneReported': 'Not reported',
  'ollama.manager.runtime': 'Runtime',
  'ollama.manager.vram': 'VRAM',
  'ollama.manager.context': 'Context length',
  'ollama.manager.expires': 'Expires',
  'ollama.manager.notRunning': 'This model is not currently loaded.',
  'ollama.manager.pullTitle': 'Install a model',
  'ollama.manager.pullHint':
    'Enter an Ollama model name. The configured endpoint is used as-is.',
  'ollama.manager.modelName': 'Model name',
  'ollama.manager.pullPlaceholder': 'llama3.2:latest',
  'ollama.manager.pull': 'Pull and install',
  'ollama.manager.pulling': 'Installing…',
  'ollama.manager.cancel': 'Cancel',
  'ollama.manager.receiving': 'Receiving model data…',
  'ollama.manager.copyTitle': 'Copy model',
  'ollama.manager.copyHint':
    'Create another local model name from the selected model.',
  'ollama.manager.copyDestination': 'Copy destination',
  'ollama.manager.copy': 'Copy',
  'ollama.manager.renameTitle': 'Rename model',
  'ollama.manager.renameHint':
    'Copy to the new name, then remove the original.',
  'ollama.manager.renameDestination': 'New model name',
  'ollama.manager.rename': 'Rename',
  'ollama.manager.load': 'Load / start',
  'ollama.manager.unload': 'Unload / stop',
  'ollama.manager.delete': 'Delete',
  'ollama.manager.deleteTitle': 'Delete model?',
  'ollama.manager.deleteConfirm': 'Delete model',
  'ollama.manager.invalidName': 'Enter a model name.',
  'ollama.manager.duplicateName': 'Choose a different model name.',
  'ollama.manager.operationError':
    'The model operation could not be completed.',
  'ollama.manager.refreshError':
    'Ollama could not be reached at this provider endpoint.',
  'ollama.manager.detailsError':
    'Extended details could not be loaded for this model.',
  'ollama.manager.configurationPartial':
    'The Ollama operation succeeded, but the configured model list could not be updated.',
  'ollama.manager.renamePartial':
    'The copy succeeded, but the original model could not be removed.',
  'ollama.manager.pullCancelled': 'Model installation canceled.',
  'ollama.manager.chatTitle': 'Chat',
  'ollama.manager.chatHint':
    'Send a prompt to a model on this endpoint and stream the reply.',
  'ollama.manager.chatModelLabel': 'Chat model',
  'ollama.manager.chatPlaceholder': 'Send a message…',
  'ollama.manager.chatSend': 'Send',
  'ollama.manager.chatStop': 'Stop',
  'ollama.manager.chatClear': 'Clear chat',
  'ollama.manager.chatStreaming': 'Generating a reply…',
  'ollama.manager.chatEmpty': 'Start a conversation with the selected model.',
  'ollama.manager.chatNoModel': 'Install a model to start chatting.',
  'ollama.manager.chatUnsupported': 'Chat is unavailable for this provider.',
  'ollama.manager.chatError': 'The chat request could not be completed.',
  'ollama.manager.chatYou': 'You',
  'ollama.manager.chatAssistant': 'Assistant',
  'ollama.manager.chatMessageLabel': 'Message',
  'ollama.manager.unknown': 'Unknown',
  'ollama.manager.never': 'Never',
  'ollama.manager.showing': 'Showing {visible} of {total} models',
  'ollama.manager.selectedModel': 'Select {name}',
  'ollama.manager.moreCapabilities': '+{count} more',
  'ollama.manager.pullProgress': '{percent}% complete',
  'ollama.manager.pullSucceeded': 'Installed {name}.',
  'ollama.manager.copySucceeded': 'Copied {source} to {destination}.',
  'ollama.manager.renameSucceeded': 'Renamed {source} to {destination}.',
  'ollama.manager.loadSucceeded': 'Loaded {name}.',
  'ollama.manager.unloadSucceeded': 'Unloaded {name}.',
  'ollama.manager.deleteSucceeded': 'Deleted {name}.',
  'ollama.manager.confirmDelete':
    'Delete {name} from this Ollama endpoint? This cannot be undone.',
  'subtree.title': 'Subtrees',
  'color.blue': 'Blue',
  'color.violet': 'Violet',
  'color.teal': 'Teal',
  'color.green': 'Green',
  'color.amber': 'Amber',
  'color.rose': 'Rose',
  'settings.notificationsEnableTitle': 'Enable notifications',
  'settings.notificationsEnableDescription':
    'Allows the display of notifications when high-signal events take place in the current repository.',
  'settings.automationAutoCommitPushTitle': 'Automatically commit and push',
  'settings.automationAutoCommitPushDescription':
    'Copilot writes the commit message; skipped while you have a draft message or an operation in flight.',
  'settings.automationAutoPullTitle': 'Automatically pull',
  'settings.automationAutoPullDescription':
    'Pulls when the working tree is clean and an upstream is set.',
  'settings.automationIntervalEvery': 'Every',
  'settings.automationIntervalMinutes': '{minutes} min',
  'settings.automationIntervalGroupLabel': '{title} interval',
  'settings.advancedUsageStatsTitle': 'Usage stats',
  'settings.advancedUsageStatsDescription':
    'Submit anonymized usage data to help improve Desktop Material.',
  'settings.advancedCredentialStorageTitle': 'Credential storage',
  'settings.advancedCredentialStorageDescription':
    'Tokens are kept in the operating-system credential store and are never written to repository configuration.',
  'settings.integrationsExternalEditorTitle': 'External editor',
  'settings.integrationsExternalEditorSubtitle':
    'Used when opening files or repositories in your editor',
  'settings.integrationsShellTitle': 'Shell',
  'settings.integrationsShellSubtitle':
    'Used when opening a repository in the command line',
  'settings.integrationsChooseEditor': 'Choose external editor',
  'settings.integrationsChooseShell': 'Choose shell',
  'settings.integrationsCustomEditorChoice': 'Configure custom editor…',
  'settings.integrationsCustomShellChoice': 'Configure custom shell…',
  'settings.integrationsCustomEditorLabel': 'Custom editor',
  'settings.integrationsCustomShellLabel': 'Custom shell',
  'settings.integrationsSelectEditor': 'Select editor',
  'push.ghCliFallbackSuccessTitle': 'Pushed using GitHub CLI credentials',
  'push.ghCliFallbackSuccessBody':
    'The push to {remote} was rejected, so Desktop Material retried it with your GitHub CLI login and it succeeded.',
  'clone.visibilityPublic': 'Public',
  'clone.visibilityPrivate': 'Private',
  'clone.noDescription': 'No description provided',
  'clone.starsLabel': '{count} stars',
  'clone.forksLabel': '{count} forks',
  'clone.sizeLabel': 'Repository size {size}',
  'clone.defaultBranchLabel': 'Default branch {branch}',
  'clone.updatedLabel': 'Updated {time}',
  'clone.languageLabel': 'Language: {language}',
  'clone.languageFilterLabel': 'Language',
  'clone.languageFilterAria': 'Filter repositories by language',
  'clone.orgScopeMissing':
    "We couldn't see any organizations. This sign-in may be missing organization access.",
  'clone.orgReconnect': 'Reconnect to load organizations',
  'clone.orgRestrictionNote':
    'Organizations that restrict third-party access must approve this app before they appear here.',
  'clone.orgReviewAccess': 'Review OAuth app access',
  'palette.selectAll': 'Select all',
  'palette.toggleTheme': 'Toggle light/dark theme',
  'palette.preferencesAccounts': 'Preferences: Accounts',
  'palette.preferencesAppearance': 'Preferences: Appearance',
  'palette.preferencesIntegrations': 'Preferences: Integrations',
  'palette.preferencesAutomation': 'Preferences: Automation',
  'palette.preferencesAdvanced': 'Preferences: Advanced',
  'palette.preferencesNotifications': 'Preferences: Notifications',
  'palette.preferencesGit': 'Preferences: Git',
  'palette.preferencesAccessibility': 'Preferences: Accessibility',
  'palette.notificationHistory': 'Open notification centre',
  'palette.notificationAutomations': 'Notification automations',
  'palette.copyRepoPath': 'Copy repository path',
  'palette.copyBranchName': 'Copy current branch name',
  'palette.copyCommitSha': 'Copy current commit SHA',
  'buildRun.closeDisabledRunning':
    'A task is running — stop it before closing the panel',
  'buildRun.fixingWithOpencode': 'Fixing with OpenCode…',
  'buildRun.stopConfirmTitle': 'Stop the running task?',
  'buildRun.stopConfirmBody':
    'The in-progress build and any OpenCode work will be terminated. This cannot be undone.',
  'buildRun.stopConfirmConfirm': 'Stop',
  'buildRun.stopConfirmCancel': 'Cancel',
  'buildRun.sendToOpencode': 'Send to opencode',
  'buildRun.sendIntro':
    'opencode is an AI coding agent. Type a request and it will work in this repository, running entirely on your machine.',
  'buildRun.sendPromptLabel': 'What should opencode do?',
  'buildRun.sendPromptPlaceholder':
    'Describe what you want opencode to do in this repository…',
  'buildRun.sendEmptyError': 'Type a request before sending it to opencode.',
  'buildRun.sendSubmit': 'Send to opencode',
  'buildRun.sendAutoApproveLabel':
    "Auto-approve opencode's edits and commands for this run (yolo)",
  'buildRun.sendAutoApproveWarning':
    'opencode will edit files and run shell commands in this repository without asking for confirmation. It is scoped to this repository — it cannot touch files outside it.',
  'buildRun.sendAutoApproveNote':
    'opencode will ask before editing files or running commands. Turn on auto-approve above to let it work unattended in this repository.',
  'buildRun.sendRunningTitle': 'opencode is working on your request…',
  'workflowDispatch.searchPlaceholder': 'Filter workflows by name or file…',
  'workflowDispatch.searchAriaLabel': 'Filter workflows',
  'workflowDispatch.listAriaLabel': 'Workflows',
  'workflowDispatch.empty': 'No workflows available.',
  'workflowDispatch.noMatches': 'No workflows match the current filter.',
  'workflowDispatch.stateActive': 'Active',
  'workflowDispatch.stateDisabled': 'Disabled',
}

/** Hong Kong Cantonese catalog. Missing entries deliberately use English. */
export const cantoneseTranslations: Readonly<
  Partial<Record<TranslationKey, string>>
> = {
  'ci.status': 'CI 檢查：{status}',
  'ci.successful': '成功，掂晒',
  'ci.failed': '失敗',
  'ci.inProgress': '做緊',
  'ci.timedOut': '等太耐，已逾時',
  'ci.actionRequired': '要你處理',
  'ci.neutral': '中性',
  'ci.cancelled': '已取消',
  'ci.skipped': '已略過',
  'ci.stale': '資料舊咗',
  'update.downloadingLabel': '下載緊應用程式更新',
  'update.downloadingValue': '下載緊',
  'appearance.updateProgressColor': '更新進度列顏色',
  'appearance.useAccentColor': '跟強調色',
  'appearance.languageMode': '語言',
  'appearance.languageModeDescription':
    '揀英文、玩味港式廣東話，或者慳位雙語模式。',
  'appearance.languageAndNavigation': '語言',
  'appearance.submoduleBackStyle': '子模組返回掣款式',
  'appearance.submoduleBackLabel': '子模組返回掣文字',
  'appearance.toolbarEditorTitle': '工具列外觀',
  'appearance.toolbarEditorDescription':
    '自訂工具列標籤、間距、文字顏色同字款。',
  'appearance.repositoryToolbarEditorTitle': 'Repo 工具列外觀',
  'appearance.repositoryToolbarEditorDescription':
    '只喺呢個 repo 啟用嗰陣覆寫標籤、間距、文字顏色同字款。',
  'appearance.toolbarTypographyHeading': '工具列字款',
  'appearance.toolbarTypographyProfile': 'Profile 自訂款式',
  'appearance.toolbarTypographyRepositoryInherited': '沿用 profile 字款',
  'appearance.toolbarTypographyRepositoryOverride': 'Repo 專用覆寫',
  'appearance.toolbarTypographyThemeDefaults': '用返主題預設',
  'appearance.toolbarTypographyInheritProfile': '沿用 profile',
  'appearance.toolbarTypographyPreview': '工具列即時預覽',
  'appearance.toolbarTypographyPreviewTitle': '目前 repo',
  'appearance.toolbarTypographyPreviewDescription': '目前分支',
  'appearance.toolbarFontStyle': '字款樣式',
  'appearance.toolbarBold': '粗體',
  'appearance.toolbarItalic': '斜體',
  'appearance.toolbarUnderline': '底線',
  'appearance.toolbarStrikethrough': '刪除線',
  'appearance.toolbarAlignment': '文字對齊',
  'appearance.toolbarAlignLeft': '靠左',
  'appearance.toolbarAlignCenter': '置中',
  'appearance.toolbarAlignRight': '靠右',
  'appearance.toolbarFont': '字型',
  'appearance.toolbarThemeFont': '用主題字型',
  'appearance.toolbarInheritFont': '沿用 profile 字型',
  'appearance.toolbarSize': '字體大小',
  'appearance.toolbarThemeSize': '用主題大小',
  'appearance.toolbarInheritSize': '沿用 profile 大小',
  'appearance.toolbarLetterCase': '英文字母大小寫',
  'appearance.toolbarNormalCase': '一般大小寫',
  'appearance.toolbarUppercase': '全大寫',
  'appearance.toolbarLowercase': '全小寫',
  'appearance.toolbarCapitalize': '每字首大寫',
  'appearance.toolbarSmallCaps': '小型大寫字母',
  'appearance.toolbarSpacing': '字元間距',
  'appearance.toolbarThemeSpacing': '用主題間距',
  'appearance.toolbarInheritSpacing': '沿用 profile 間距',
  'appearance.toolbarTextEffect': '文字效果',
  'appearance.toolbarNoEffect': '無文字效果',
  'appearance.toolbarSoftShadow': '柔和陰影',
  'appearance.toolbarStrongShadow': '明顯陰影',
  'appearance.toolbarTextColor': '文字顏色',
  'appearance.toolbarThemeColor': '用主題顏色',
  'appearance.toolbarInheritColor': '沿用 profile 顏色',
  'appearance.toolbarCustomColor': '自訂文字顏色',
  'tabs.appearanceLoading': '分頁外觀仲載入緊，等陣再試。',
  'tabs.settingsCommitSaved': '已存 · {sha}',
  'tabs.settingsCommitCommitted': '啱啱存 {sha}',
  'tabs.settingsCommitTitle':
    '每次改分頁或設定，都會即刻 commit 落呢個帳戶嘅本機設定 repo。',
  'tabs.settingsHistory': '設定歷史',
  'tabs.undoSettingsChange': '復原上一個設定改動',
  'tabs.redoSettingsChange': '重做設定改動',
  'tabs.settingsChangeUndone': '已復原設定改動。',
  'tabs.settingsChangeRedone': '已重做設定改動。',
  'language.english': '英文',
  'language.cantonese': '玩味港式廣東話',
  'language.bilingual': '雙語',
  'submodule.backStyleTonal': '柔和色調',
  'submodule.backStyleFilled': '實色強調',
  'submodule.backStyleOutlined': '外框',
  'submodule.backLabelFull': '返去主 repo',
  'submodule.backLabelParent': '顯示主 repo 名',
  'submodule.backLabelIcon': '淨圖示',
  'submodule.openAsRepository': '打開並管理',
  'submodule.temporaryOpenDescription':
    '會喺呢個工作區臨時打開子模組；絕對唔會加落 repo 清單。',
  'submodule.appearanceHeading': '返回掣外觀',
  'submodule.appearanceDescription':
    '右擊預覽返回掣，就會喺掣旁邊打開編輯器。按「儲存」先套用到目前 profile。',
  'submodule.appearancePreview': '預覽',
  'submodule.openUnavailable': '要先複製呢個子模組先開得',
  'submodule.openFailed': '未能將 {child} 當 repo 打開：{error}',
  'submodule.returnFailed': '未能返去 {parent}：{error}',
  'submodule.workspaceUnsafe':
    '呢個臨時子模組工作區已經唔再安全使用；已經返去 {parent}。詳情：{error}',
  'submodule.temporaryRemovalUnavailable':
    '呢個子模組只係臨時打開；請返去 {parent} 先管理或者移除。',
  'submodule.temporarySettingsUnavailable':
    'Repo 設定只會儲俾清單入面嘅 repo；請返去 {parent} 先管理要保存嘅設定。',
  'submodule.navigation': '臨時子模組 repo 導覽',
  'submodule.backToParent': '返去 {parent}',
  'submodule.viewingContext':
    '而家睇緊 {parent} 入面嘅子模組 {child}；唔會加落 repo 清單。',
  'submodule.managerTitle': '子模組管理',
  'submodule.managerClose': '關閉',
  'submodule.title': '子模組',
  'submodule.addAction': '新增子模組…',
  'submodule.addTooltip': '揀託管 repo 或者 URL 加入',
  'submodule.updateAllAction': '全部更新',
  'submodule.updateAllTooltip': '初始化兼更新全部子模組',
  'submodule.syncAction': '同步',
  'submodule.syncTooltip': '由 .gitmodules 同步遠端 URL',
  'submodule.configureAction': '設定',
  'submodule.configureTooltip': '編輯呢個子模組嘅設定',
  'submodule.removeAction': '移除',
  'submodule.removeTooltip': '取消初始化並移除呢個子模組',
  'submodule.listFailed': '未能列出子模組：{error}',
  'submodule.updateAllFailed': '未能更新子模組：{error}',
  'submodule.updateFailed': '未能更新 {path}：{error}',
  'submodule.syncFailed': '未能同步 {path}：{error}',
  'submodule.removeFailed': '未能移除 {path}：{error}',
  'submodule.temporaryToolsReadOnly':
    '臨時子模組工作區只可以用唯讀 repo 工具；執行會改動呢個 checkout 嘅工具之前，請先返去 {parent}。',
  'submodule.summarySingle': '{count} 個子模組',
  'submodule.summaryMultiple': '{count} 個子模組',
  'submodule.summaryCloned': '{count} 個已複製',
  'submodule.summaryNotCloned': '{count} 個未複製',
  'submodule.statusUninitialized': '未初始化',
  'submodule.statusUpToDate': '已經最新',
  'submodule.statusOutOfDate': '未追到最新',
  'submodule.statusConflicted': '有衝突',
  'submodule.searchPlaceholder': '用名稱、路徑或者 URL 搵子模組',
  'submodule.searchAriaLabel': '搜尋子模組',
  'submodule.filterByStatus': '按狀態篩選子模組',
  'submodule.filterAll': '全部',
  'submodule.filterCloned': '已複製',
  'submodule.filterNotCloned': '未複製',
  'submodule.filterOutOfDate': '未追到最新',
  'submodule.filterConflicted': '有衝突',
  'submodule.loading': '載入緊子模組…',
  'submodule.none': '呢個 repo 暫時未有子模組。',
  'submodule.noMatches': '而家嘅搜尋同狀態篩選搵唔到子模組。',
  'submodule.cloneAction': '複製',
  'submodule.cloneTooltip': '將呢個子模組複製入工作樹',
  'submodule.updateAction': '更新',
  'submodule.updateTooltip': '初始化兼更新呢個子模組',
  'submodule.addDialogTitle': '新增子模組',
  'submodule.addSubmitAction': '新增子模組',
  'submodule.addCancelAction': '取消',
  'submodule.addCancelOperationAction': '取消操作',
  'submodule.addDoneAction': '完成',
  'submodule.addSignInAction': '登入',
  'submodule.addDotComSignInGuidance':
    '登入 GitHub.com，就可以瀏覽今次子模組可用嘅 repo。',
  'submodule.addEnterpriseSignInGuidance':
    '登入 GitHub Enterprise，就可以瀏覽今次子模組可用嘅 repo。',
  'submodule.addProviderAccountAction': '新增供應商帳戶',
  'submodule.addProviderSignInGuidance':
    '去「設定」新增 GitLab 或 Bitbucket 帳戶，就可以瀏覽佢嘅 repo。',
  'submodule.addOrganizationLoadFailed': 'Desktop 未能載入組織嘅所有 repo。',
  'submodule.addTryAgainAction': '再試一次',
  'submodule.addRepositoryListLabel': '揀一個 repo 做子模組',
  'submodule.addRepositoryFilterPlaceholder': '篩選今次子模組可用嘅 repo',
  'submodule.addRepositoryUrlLabel': 'Repo URL',
  'submodule.addRepositoryUrlHelp': '支援 HTTPS、SSH 同本機 Git 遠端 URL。',
  'submodule.addPathLabel': 'Repo 內路徑',
  'submodule.addBranchLabel': '分支（可選）',
  'submodule.addRemoteDefaultBranchPlaceholder': '遠端預設分支',
  'submodule.addPathChecking': '檢查緊目的地係咪安全兼空白…',
  'submodule.addPathHelp':
    '請用相對 checkout 路徑；最後一段會成為預設子模組名稱。',
  'submodule.addBranchHelp': '留空就會跟 repo 嘅遠端預設分支。',
  'submodule.addReviewLabel': '子模組檢視',
  'submodule.addReviewHeading': '檢視',
  'submodule.addReviewRepositoryLabel': 'Repo',
  'submodule.addReviewChooseSource': '先喺上面揀來源',
  'submodule.addReviewSuperprojectLabel': '主 repo',
  'submodule.addReviewCheckoutPathLabel': 'Checkout 路徑',
  'submodule.addReviewNotSet': '未設定',
  'submodule.addReviewTrackedBranchLabel': '追蹤分支',
  'submodule.addReviewRemoteDefault': '遠端預設',
  'submodule.addProgressHeading': '加緊子模組',
  'submodule.addProgressLabel': '新增子模組進度',
  'submodule.addSuccessHeading': '子模組已新增',
  'submodule.addSuccessDescription':
    'Git 已更新 .gitmodules，並將 repo checkout 到 {path}。',
  'submodule.addAddingProgress': '加緊子模組…',
  'submodule.addCancellingProgress': '取消緊 Git 操作…',
  'submodule.addCheckingProgress': '檢查緊 repo 同目的地…',
  'submodule.addAddedProgress': '子模組已新增。',
  'submodule.addCancelledError': '新增子模組已取消，冇其他 Git 工作繼續運行。',
  'submodule.addFailed': 'Desktop 未能新增呢個子模組：{error}',
  'submodule.addPathValidationFailed':
    'Desktop 未能驗證呢個子模組路徑：{error}',
  'submodule.addPathRequiredError': '請輸入呢個 repo 入面嘅路徑。',
  'submodule.addPathRelativeError': '請揀呢個 repo 入面嘅相對路徑。',
  'submodule.addPathSegmentsError':
    '路徑唔可以包含空白、目前目錄或者上層目錄區段。',
  'submodule.addPathGitMetadataError': '路徑唔可以使用 Git metadata 目錄。',
  'submodule.addPathDuplicateError': '已經有子模組用緊呢條路徑。',
  'submodule.addBranchInvalidError':
    '請輸入有效分支名稱，或者留空以使用遠端預設分支。',
  'submodule.addSourceRequiredError': '請揀一個 repo，或者輸入佢嘅 URL。',
  'submodule.addSourceControlCharacterError': 'Repo URL 包含唔支援嘅控制字元。',
  'submodule.addPathUnreadableError': '讀唔到磁碟上嘅路徑；請檢查路徑再試。',
  'submodule.addPathNotEmptyError':
    '呢個資料夾有檔案；Git 只可以複製去空白資料夾。',
  'submodule.addPathIsFileError':
    '已經有檔案用緊呢個名稱；Git 只可以複製去資料夾。',
  'submodule.configTitle': '設定 {name}',
  'submodule.configUrlRequired':
    '請輸入遠端 URL；如果想停用呢個子模組，請改用「取消初始化」。',
  'submodule.configSetUrlFailed': '未能設定 {path} 嘅 URL：{error}',
  'submodule.configSetBranchFailed': '未能設定 {path} 嘅分支：{error}',
  'submodule.configSetKeyFailed': '未能設定 {setting}：{error}',
  'submodule.configSyncFailed': '未能同步 {path}：{error}',
  'submodule.configInitFailed': '未能初始化 {path}：{error}',
  'submodule.configDeinitFailed': '未能取消初始化 {path}：{error}',
  'submodule.configRemoteUrlLabel': '遠端 URL',
  'submodule.configBranchLabel': '分支',
  'submodule.configUpdateStrategyLabel': '更新策略',
  'submodule.configUseDefaultCheckout': '使用預設值（checkout）',
  'submodule.configCheckoutOption': 'Checkout',
  'submodule.configRebaseOption': 'Rebase',
  'submodule.configMergeOption': 'Merge',
  'submodule.configNoneOption': '無',
  'submodule.configIgnoreDirtyLabel': '忽略 dirty 狀態',
  'submodule.configUseDefaultNone': '使用預設值（無）',
  'submodule.configUntrackedOption': '未追蹤',
  'submodule.configDirtyOption': 'Dirty',
  'submodule.configAllOption': '全部',
  'submodule.configFetchRecurseLabel': 'Fetch 時遞迴子模組',
  'submodule.configUseDefaultOnDemand': '使用預設值（有需要先做）',
  'submodule.configYesOption': '係',
  'submodule.configOnDemandOption': '有需要先做',
  'submodule.configNoOption': '唔係',
  'submodule.configShallowCloneLabel': '淺層複製',
  'submodule.configUseDefaultAction': '使用預設值',
  'submodule.configUrlHelp': '儲存新 URL 時，亦會同步去已 checkout 嘅子模組。',
  'submodule.configBranchHelp': '留空就會追蹤遠端 HEAD。',
  'submodule.configShallowHelp':
    '冇剔選亦冇取消剔選時，會使用 Git 預設值（完整歷史）。',
  'submodule.configActionsLabel': '子模組操作',
  'submodule.configInitAction': '初始化',
  'submodule.configInitTooltip': '將呢個子模組登記入本機設定',
  'submodule.configDeinitRequestAction': '取消初始化…',
  'submodule.configDeinitAction': '取消初始化',
  'submodule.configDeinitTooltip': '取消登記呢個子模組並清空工作樹',
  'submodule.configSaveAction': '儲存變更',
  'submodule.configCancelAction': '取消',
  'submodule.configDeinitConfirmation':
    '確定要取消初始化 {path}？呢個操作會取消登記子模組並清空工作樹，入面未儲存嘅本機變更都會被丟棄。',
  'fileList.viewMode': '變更檔案排法',
  'fileList.flat': '平鋪',
  'fileList.tree': '檔案樹',
  'fileList.directory': '資料夾 {path}',
  'diff.context.legend': '差異上下文',
  'diff.context.autoExpand': '自動攤開整份檔案內容',
  'diff.context.autoExpandHelp':
    '細檔會爽快攤開；大檔或者未讀完整嘅檔案會安全收好，唔拖慢你。',
  'diff.context.stepLegend': '每次展開幾多上下文',
  'diff.context.lines': '{count} 行',
  'history.scope': '歷史範圍',
  'history.scope.currentBranch': '而家呢條分支',
  'history.scope.allRefs': '全部分支同標籤',
  'diff.structured.viewSwitcher': '結構化差異檢視',
  'diff.structured.code': '程式碼',
  'diff.structured.table': '表格',
  'diff.structured.csvCaption': 'CSV 表格差異',
  'diff.structured.tsvCaption': 'TSV 表格差異',
  'diff.structured.rowNumber': '列號',
  'diff.structured.column': '欄 {number}',
  'diff.structured.rowAdded': '新增列',
  'diff.structured.rowRemoved': '移除列',
  'diff.structured.rowChanged': '已變更列',
  'diff.structured.cellAdded': '新增儲存格',
  'diff.structured.cellRemoved': '移除儲存格',
  'diff.structured.cellChanged': '已變更儲存格',
  'diff.structured.selectionHint':
    '想逐行揀選或者丟棄變更，切返去「程式碼」就得。',
  'prCreate.title': '建立 GitHub pull request',
  'prCreate.reviewTitle': '覆核 GitHub pull request',
  'prCreate.successTitle': 'GitHub pull request 已建立',
  'prCreate.targetRepository': '目標 repo',
  'prCreate.account': '帳戶',
  'prCreate.baseBranch': '基礎分支',
  'prCreate.headBranch': '來源分支',
  'prCreate.currentBranch': '本機分支：{branch}',
  'prCreate.template': 'Pull request 範本',
  'prCreate.noTemplate': '空白 pull request',
  'prCreate.loadingOptions': '載入緊範本同 repo 選項…',
  'prCreate.optionalWarning': '有啲可選項目暫時用唔到；pull request 照樣開得。',
  'prCreate.titleField': '標題',
  'prCreate.descriptionField': '描述（可選）',
  'prCreate.charactersRemaining': '仲可以輸入 {count} 個字元',
  'prCreate.markdownSupported': '支援 Markdown',
  'prCreate.draftAction': '建立做草稿 pull request',
  'prCreate.reviewers': '覆核者',
  'prCreate.assignees': '負責人',
  'prCreate.labels': '標籤',
  'prCreate.milestone': '里程碑',
  'prCreate.none': '無',
  'prCreate.choiceUnavailable': '呢個帳戶暫時攞唔到建議',
  'prCreate.choiceCapped': '安全起見，只顯示頭一批選項',
  'prCreate.cancel': '取消',
  'prCreate.close': '關閉',
  'prCreate.reviewAction': '覆核 pull request',
  'prCreate.backToEdit': '返去編輯',
  'prCreate.createAction': '建立 pull request',
  'prCreate.createDraftAction': '建立草稿 pull request',
  'prCreate.creating': '建立緊 pull request…',
  'prCreate.waitingFor': '等緊 {target}',
  'prCreate.cancelRequest': '取消請求',
  'prCreate.canceling': '取消緊…',
  'prCreate.readyStatus': '準備好俾人覆核',
  'prCreate.draftStatus': '草稿',
  'prCreate.description': '描述',
  'prCreate.noDescription': '無描述',
  'prCreate.metadataSummary':
    '覆核者：{reviewers}；負責人：{assignees}；標籤：{labels}；里程碑：{milestone}',
  'prCreate.confirmation':
    '確認後會用 {account} 身份，喺 {target} 建立一個{status} pull request。取消咗嘅請求都有可能已經送到 GitHub。',
  'prCreate.created': 'Pull request #{number} 已建立',
  'prCreate.draftCreated': '草稿 pull request #{number} 已建立',
  'prCreate.done': '完成',
  'prCreate.openOnGitHub': '喺 GitHub 開啟',
  'prCreate.partialSuccess': 'Pull request 已建立，不過有以下跟進提示：',
  'prCreate.templateNotice': '範本提示：{notice}',
  'mrEditor.createTitle': '建立 merge request',
  'mrEditor.editTitle': '編輯 merge request',
  'mrEditor.description':
    '用呢個 repo 已綁定嘅 GitLab 帳戶，準備有安全界線嘅 merge request 資料。',
  'mrEditor.project': 'Project',
  'mrEditor.boundAccount': 'Repo 綁定帳戶',
  'mrEditor.routeAria': '指定 GitLab project 同 repo 綁定帳戶',
  'mrEditor.formAria': 'Merge request 詳情',
  'mrEditor.sourceBranch': '來源分支',
  'mrEditor.sourceEditLocked':
    'GitLab 建立 merge request 之後唔支援更改來源分支。',
  'mrEditor.targetBranch': '目標分支',
  'mrEditor.titleField': '標題',
  'mrEditor.descriptionField': '描述（可選）',
  'mrEditor.charactersRemaining': '仲可以輸入 {count} 個字元',
  'mrEditor.markdownSupported': '支援 Markdown',
  'mrEditor.draftAction': '草稿 merge request',
  'mrEditor.reviewers': '覆核者',
  'mrEditor.assignees': '負責人',
  'mrEditor.reviewersUnavailable':
    '暫時攞唔到覆核者選項；其他欄位仍然可以編輯。',
  'mrEditor.assigneesUnavailable':
    '暫時攞唔到負責人選項；其他欄位仍然可以編輯。',
  'mrEditor.noneAvailable': '暫時冇可用選項。',
  'mrEditor.keyboardHint':
    '喺「標題」按 Enter，或者喺「描述」按 Ctrl+Enter 就可以提交。',
  'mrEditor.cancel': '取消',
  'mrEditor.refresh': '重新整理 merge request 資料',
  'mrEditor.createAction': '建立 merge request',
  'mrEditor.saveAction': '儲存 merge request',
  'mrEditor.creating': '建立緊 merge request…',
  'mrEditor.saving': '儲存緊 merge request…',
  'mrEditor.created': 'Merge request 已建立。',
  'mrEditor.saved': 'Merge request 已儲存。',
  'mrEditor.canceled': 'Merge request 操作已取消。',
  'mrEditor.loading': '載入緊有安全上限嘅 merge request 選項…',
  'mrEditor.emptyBranches': '暫時冇分支可以建立 merge request。',
  'mrEditor.emptySource': '暫時冇可用來源分支。',
  'mrEditor.emptyTarget': '暫時冇可用目標分支。',
  'mrEditor.emptyDescription':
    '等 repo 同 GitLab project 有分支之後，再重新整理。',
  'mrEditor.errorTitle': '暫時攞唔到 merge request 選項',
  'mrEditor.errorAuthentication': '認證唔到呢個 repo 已綁定嘅 GitLab 帳戶。',
  'mrEditor.errorPermission':
    '呢個 repo 已綁定嘅 GitLab 帳戶冇權讀取此 project。',
  'mrEditor.errorNetwork': '連唔到 GitLab；請檢查網絡再試。',
  'mrEditor.errorUnsupported':
    '呢部 GitLab 伺服器未提供所需嘅 merge request API。',
  'mrEditor.errorInvalidResponse':
    'GitLab 回傳嘅資料未能安全驗證，所以冇使用。',
  'mrEditor.errorUnknown': '載入唔到 merge request 資料；請重新整理再試。',
  'mrEditor.staleTitle': 'Repo 或帳戶資料已經轉咗',
  'mrEditor.staleDescription':
    '呢個編輯器綁住較舊嘅 repo、帳戶、端點或者請求版本；提交之前請先重新整理。',
  'mrEditor.partialTitle': '有部分可選資料未齊',
  'mrEditor.partialUnavailable':
    '用唔到嘅覆核者或負責人欄位已停用；必填欄位仍然可以使用。',
  'mrEditor.partialCapped':
    '一個或以上選項清單已到安全上限，或者有項目未通過驗證。',
  'mrEditor.readinessLabel': 'Merge 準備狀態',
  'mrEditor.readinessChecking': 'GitLab 仲檢查緊可唔可以 merge…',
  'mrEditor.readinessReady': '可以 merge',
  'mrEditor.readinessBlocked': '暫時未可以 merge：{reason}',
  'mrEditor.readinessUnknown': '暫時未有 merge 準備狀態。',
  'mrEditor.blockerStatus': 'project 政策或者 merge 檢查',
  'mrEditor.blockerCiMustPass': 'pipeline 要先通過',
  'mrEditor.blockerCiRunning': 'pipeline 仲運行緊',
  'mrEditor.blockerConflict': '來源同目標分支有衝突',
  'mrEditor.blockerDiscussions': '仲有覆核討論未解決',
  'mrEditor.blockerDraft': 'merge request 仲係草稿',
  'mrEditor.blockerExternalChecks': '外部狀態檢查仲未完成',
  'mrEditor.blockerJira': '欠缺必要 Jira 關聯',
  'mrEditor.blockerRebase': '來源分支要先 rebase',
  'mrEditor.blockerApproval': '仲未有齊必要批准',
  'mrEditor.blockerNotOpen': 'merge request 唔係開放狀態',
  'mrEditor.blockerPolicy': 'merge 政策拒絕咗今次請求',
  'mrEditor.blockerCommitsStatus': '有一個或以上 commit 狀態阻擋緊',
  'mrEditor.blockerRequestBlocked': '有另一個 merge request 條件阻擋緊',
  'mrEditor.blockerMergeTime': '未到預定 merge 時間',
  'mrEditor.blockerRequestedChanges': '覆核者要求咗修改',
  'mrEditor.blockerSecurityPipeline': '安全政策 pipeline 檢查仲未完成',
  'mrEditor.blockerSecurityViolation': '有安全政策違規',
  'mrEditor.blockerStatusChecks': '必要狀態檢查要先通過',
  'mrEditor.blockerLockedPaths': '有一個或以上已改路徑被鎖定',
  'mrEditor.blockerLockedLfs': '有一個或以上已改 LFS 檔案被鎖定',
  'mrEditor.blockerTitleRegex': '標題唔符合 project 政策',
  'mrEditor.validationTitle': '請修正以下 merge request 資料：',
  'mrEditor.validationSource': '請揀一條有效來源分支。',
  'mrEditor.validationTarget': '請揀一條有效目標分支。',
  'mrEditor.validationBranchesDiffer': '來源同目標分支唔可以一樣。',
  'mrEditor.validationTitleRequired': '請輸入 merge request 標題。',
  'mrEditor.validationTitleLength': '標題超過 255 字元安全上限。',
  'mrEditor.validationTitleInvalid': '請移除標題前後空白或者唔支援嘅控制字元。',
  'mrEditor.validationBodyLength': '描述超過 128 KiB 安全上限。',
  'mrEditor.validationBodyInvalid': '描述包含唔支援嘅 null 字元。',
  'mrEditor.validationReviewerLimit': '最多揀 20 位覆核者。',
  'mrEditor.validationAssigneeLimit': '最多揀 20 位負責人。',
  'mrEditor.validationReviewerDuplicate': '每位覆核者只可以揀一次。',
  'mrEditor.validationAssigneeDuplicate': '每位負責人只可以揀一次。',
  'mrEditor.validationReviewerInvalid':
    '有一位已揀覆核者唔喺目前安全選項入面。',
  'mrEditor.validationAssigneeInvalid':
    '有一位已揀負責人唔喺目前安全選項入面。',
  'mrEditor.submitRejected':
    'GitLab 拒絕咗 merge request 更新；請重新整理並覆核目前狀態。',
  'mrEditor.submitNetwork': 'Merge request 更新連唔到 GitLab；請檢查網絡再試。',
  'mrEditor.submitStale':
    '更新完成之前，repo、帳戶、merge request 或 HEAD 已經轉咗。',
  'mrEditor.submitInvalidResponse': 'GitLab 回傳嘅更新結果未能安全驗證。',
  'mrEditor.submitUnknown': 'Merge request 更新未完成；再試之前請先重新整理。',
  'mrLifecycle.title': 'Merge request 生命週期',
  'mrLifecycle.loading': '載入緊 merge request 生命週期…',
  'mrLifecycle.empty': '未揀 merge request',
  'mrLifecycle.emptyDescription':
    '建立或者揀一個 merge request，先可以管理佢嘅生命週期。',
  'mrLifecycle.unavailable': '暫時用唔到 merge request 生命週期',
  'mrLifecycle.unavailableDescription':
    '請重新整理 repo 綁定嘅 GitLab 資料再試。',
  'mrLifecycle.stale': 'Merge request 生命週期資料已經轉咗',
  'mrLifecycle.staleDescription':
    'Repo、帳戶、merge request 或 HEAD 資料已經轉咗；操作之前請先重新整理。',
  'mrLifecycle.partial': '有部分生命週期資料未能提供；可用操作仍然有安全界線。',
  'mrLifecycle.summaryAria': 'Merge request 生命週期摘要',
  'mrLifecycle.state': '狀態',
  'mrLifecycle.stateOpened': '開放',
  'mrLifecycle.stateClosed': '已關閉',
  'mrLifecycle.stateMerged': '已 merge',
  'mrLifecycle.stateLocked': '已鎖定',
  'mrLifecycle.draft': '草稿',
  'mrLifecycle.author': '作者',
  'mrLifecycle.reviewers': '覆核者',
  'mrLifecycle.assignees': '負責人',
  'mrLifecycle.none': '冇',
  'mrLifecycle.approval': '批准進度',
  'mrLifecycle.approvalUnavailable': '暫時未有批准狀態。',
  'mrLifecycle.approvalComplete': '已經有齊必要批准',
  'mrLifecycle.approvalProgress': '必要批准已完成 {approved}/{required}',
  'mrLifecycle.approvedBy': '由 {names} 批准',
  'mrLifecycle.pipeline': 'Pipeline',
  'mrLifecycle.pipelineUnavailable': '暫時未有 pipeline 狀態。',
  'mrLifecycle.pipelineNone': '未有 pipeline',
  'mrLifecycle.pipelinePending': '等候中',
  'mrLifecycle.pipelineRunning': '運行緊',
  'mrLifecycle.pipelinePassed': '已通過',
  'mrLifecycle.pipelineFailed': '失敗',
  'mrLifecycle.pipelineCanceled': '已取消',
  'mrLifecycle.pipelineSkipped': '已略過',
  'mrLifecycle.pipelineUnknown': '未知',
  'mrLifecycle.readiness': 'Merge 準備狀態',
  'mrLifecycle.updated': '更新時間',
  'mrLifecycle.timeUnavailable': '暫時未有時間',
  'mrLifecycle.close': '關閉 merge request',
  'mrLifecycle.reopen': '重新開啟 merge request',
  'mrLifecycle.approve': '批准目前 HEAD',
  'mrLifecycle.unapprove': '移除批准',
  'mrLifecycle.refresh': '重新整理生命週期',
  'mrLifecycle.openCanonical': '喺 GitLab 開啟',
  'mrLifecycle.operationRunning': '{action}…',
  'mrLifecycle.operationSuccess': '{action}已完成。',
  'mrLifecycle.operationCanceled': '生命週期操作已取消。',
  'mrLifecycle.operationError': '生命週期操作未完成；再試之前請先重新整理。',
  'forkCheckout.action': '由另一個 fork checkout…',
  'forkCheckout.title': 'Checkout 另一個 fork 嘅分支',
  'forkCheckout.description':
    '揀實一個 fork 同分支 head，覆核受管 refs，之後先安全 checkout。',
  'forkCheckout.close': '關閉 fork 分支 checkout',
  'forkCheckout.loadingForks': '載入緊 repo 網絡…',
  'forkCheckout.forkLabel': 'Fork repo',
  'forkCheckout.chooseFork': '揀一個 fork',
  'forkCheckout.filterForks': '用擁有者或者 repo 名篩選 fork',
  'forkCheckout.loadingBranches': '載入緊精確分支 head…',
  'forkCheckout.branchLabel': 'Fork 分支',
  'forkCheckout.chooseBranch': '揀一條分支',
  'forkCheckout.filterBranches': '篩選 fork 分支',
  'forkCheckout.localBranchLabel': '新本機分支',
  'forkCheckout.review': '覆核 checkout',
  'forkCheckout.reviewing': '覆核緊本機 refs…',
  'forkCheckout.confirmHeading': '確認精確 checkout',
  'forkCheckout.source': '來源',
  'forkCheckout.head': '已覆核 head',
  'forkCheckout.local': '本機分支',
  'forkCheckout.remote': '受管遠端',
  'forkCheckout.remoteNew': '{remote}（會新增）',
  'forkCheckout.remoteReuse': '{remote}（現有 Desktop 遠端）',
  'forkCheckout.remoteRef': '受管遠端 ref',
  'forkCheckout.staleGuard':
    '確認時會再核對 repo、fork、分支 head、遠端同本機分支，啱晒先至改 Git。',
  'forkCheckout.confirm': 'Fetch 並 checkout',
  'forkCheckout.checkingOut': '再核對、fetch 同準備 checkout 緊…',
  'forkCheckout.success':
    '已準備 {branch}，位置係 {sha}。如果本機變更要處理，跟埋 Desktop checkout 提示就搞掂。',
  'forkCheckout.limitNotice':
    '清單去到安全上限喇。可以篩選而家嘅結果，或者去 GitHub 收窄網絡後再重新整理。',
  'forkCheckout.rejectedNotice':
    '已忽略 {count} 個格式有問題或者唔安全嘅 API 項目。',
  'forkCheckout.emptyForks': '呢個網絡搵唔到其他睇得到嘅 fork。',
  'forkCheckout.emptyBranches': '呢個 fork 搵唔到有效分支。',
  'forkCheckout.useSuggestion': '用建議分支 {branch}',
  'forkCheckout.errorUnsupported': '呢個流程只適用於 GitHub repo。',
  'forkCheckout.errorSignIn': '請用指派俾呢個 repo 嘅帳戶登入，再試一次。',
  'forkCheckout.errorMalformed':
    'GitHub 回傳嘅 repo 網絡資料唔夠安全，未能使用。',
  'forkCheckout.errorStale':
    '已覆核嘅 fork、分支或者本機遠端狀態變咗；請重新載入再覆核。',
  'forkCheckout.errorContext':
    '已揀 repo 變咗；請重新打開佢嘅「分支」面板再覆核。',
  'forkCheckout.errorInvalid': '請揀有效 fork 分支，同埋有效嘅新本機分支名。',
  'forkCheckout.errorCollision': '嗰條本機分支已經存在，請換另一個分支名。',
  'forkCheckout.errorRemoteCollision':
    'Desktop 搵唔到唔會覆寫現有遠端嘅安全受管 fork 遠端名。',
  'forkCheckout.errorNetwork':
    'GitHub 或 Git 讀唔到呢個 fork。檢查網絡、帳戶存取同 repo 權限，再試一次。',
  'forkCheckout.errorMoved': 'Fork 分支覆核之後郁咗；請重新載入並覆核新 head。',
  'forkCheckout.errorGit': 'Git 未能準備已覆核 refs；現有本機分支冇被覆寫。',
  'forkCheckout.errorUnknown': 'Fork 分支 checkout 未完成；請重新載入再試。',
  'projects.title': 'GitHub Projects',
  'projects.description':
    '用唯讀模式睇呢個 repo 嘅 Project 視圖、項目同狀態欄位；有安全上限，唔會無限拉資料。',
  'projects.refresh': '重新整理 Projects',
  'projects.sourceLive': 'GitHub 即時資料',
  'projects.sourceCached': '離線快取',
  'projects.sourceUnavailable': '未有快照',
  'projects.updatedAt': '快照時間：{timestamp}',
  'projects.stale': '快取已經超過 24 小時',
  'projects.refreshing': '更新緊…',
  'projects.readOnly':
    '唯讀保證：呢個工作區唔會改 Project、欄位、視圖或者項目。',
  'projects.errorSignedOut':
    '請用呢個 repo 所揀嘅 GitHub 帳戶登入，先可以更新 Projects。',
  'projects.errorAuthentication': 'GitHub 認證唔到所揀帳戶；請重新登入再試。',
  'projects.errorPermission':
    'GitHub 唔畀睇 Projects；請檢查帳戶嘅 repo 同 Projects 權限。',
  'projects.errorRateLimit':
    'GitHub API 配額用完；可以照睇快取，等重設之後再試。',
  'projects.errorNotFound':
    'GitHub 搵唔到呢個 repo，或者所揀帳戶睇唔到相關 Projects。',
  'projects.errorUnsupported':
    '呢部 GitHub 伺服器未提供支援嘅 Projects 唯讀 API。',
  'projects.errorService': 'GitHub Projects 暫時休息緊，等一陣再試。',
  'projects.errorNetwork': '連唔到 GitHub Projects；請檢查網絡再試。',
  'projects.errorInvalidResponse':
    'GitHub 回傳嘅 Projects 資料未能安全驗證，所以冇顯示。',
  'projects.cacheRecovery': '而家顯示上次驗證過嘅離線快照。',
  'projects.partialTitle': '部分資料快照',
  'projects.partialProjects': '已到 Project 安全上限；其餘 Project 冇載入。',
  'projects.partialItems': '已到項目安全上限；其餘項目冇載入。',
  'projects.partialViews': '已到視圖安全上限；其餘視圖冇載入。',
  'projects.partialClassic':
    '呢部伺服器冇 Projects v2，所以用唯讀 classic API 後備。',
  'projects.listAria': 'Repo Projects',
  'projects.itemCount': '已載入 {count} 個項目',
  'projects.stateOpen': '開放',
  'projects.stateClosed': '已關閉',
  'projects.openOnGitHub': '喺 GitHub 打開',
  'projects.viewsAria': 'Project 視圖',
  'projects.noItems': '呢個 Project 冇回傳任何項目。',
  'projects.emptyTitle': '未有 Project 資料',
  'projects.emptyDescription':
    '呢個 repo 冇可見 Project，或者所揀帳戶未有權限睇。',
  'projects.kindIssue': 'Issue',
  'projects.kindPullRequest': 'Pull request',
  'projects.kindDraftIssue': '草稿 issue',
  'projects.kindNote': '記事',
  'projects.kindUnavailable': '暫時睇唔到嘅項目',
  'projects.loading': '載入緊有安全上限嘅 Projects 快照…',
  'reviewRequest.manage': '管理審閱請求…',
  'reviewRequest.openInBrowser': '喺瀏覽器打開審閱請求',
  'reviewRequest.reviewRequested': '已要求審閱',
  'reviewRequest.statusDraft': '草稿',
  'reviewRequest.statusOpen': '開放',
  'reviewRequest.noDescription': '未有提供描述。',
  'reviewRequest.markdownBodyAriaLabel': '審閱請求 Markdown 內容',
  'reviewRequest.quickViewAriaLabel': '審閱請求 #{number} 快速預覽',
  'globalIgnore.title': '全域忽略規則',
  'globalIgnore.description':
    '呢啲規則會透過 Git 嘅 core.excludesFile 套用到每個本機 repo。各 repo 嘅 .gitignore 會保持獨立，可以再加專屬規則。',
  'globalIgnore.pathLabel': '忽略規則檔案',
  'globalIgnore.loading': '讀取緊有效嘅 Git 設定…',
  'globalIgnore.configuredExisting': 'Git 已設定使用呢個現有檔案。',
  'globalIgnore.configuredNew': 'Git 已設定使用呢個新檔案。',
  'globalIgnore.notConfigured': '儲存時會建立呢個檔案，並設定 Git 使用佢。',
  'globalIgnore.starterRules': '常用起步規則',
  'globalIgnore.addEditorFiles': '加入編輯器檔案',
  'globalIgnore.addOSFiles': '加入系統檔案',
  'globalIgnore.rulesAria': '全域忽略規則',
  'globalIgnore.patternPlaceholder': '每行一個 gitignore 規則',
  'globalIgnore.reload': '重新載入',
  'globalIgnore.savingAction': '儲存緊…',
  'globalIgnore.saveAction': '儲存全域規則',
  'globalIgnore.savingStatus': '儲存緊全域忽略規則…',
  'globalIgnore.savedStatus': '全域忽略規則已儲存並啟用。',
  'globalIgnore.loadError': '讀唔到全域忽略規則：{error}',
  'globalIgnore.saveError': '全域忽略規則冇更改：{error}',
  'customGit.title': '自訂 Git 指令預設',
  'customGit.description':
    '儲存本機、唔經 shell 嘅 Git 參數預設。每次執行都要先覆核，並只會套用到目前所揀 repo。',
  'customGit.savedPreset': '已儲存預設',
  'customGit.newUnsavedPreset': '未儲存嘅新預設',
  'customGit.newAction': '新增',
  'customGit.name': '名稱',
  'customGit.subcommand': 'Git 子指令',
  'customGit.arguments': '參數',
  'customGit.warning':
    '唔好喺預設放密碼或者 token。標準輸入已關閉，所以唔支援互動式指令。',
  'customGit.saveAction': '儲存預設',
  'customGit.reviewAction': '覆核執行',
  'customGit.deleteAction': '刪除預設',
  'customGit.cancelRun': '取消執行',
  'customGit.confirmRunTitle': '喺所揀 repo 執行呢條指令？',
  'customGit.confirmRunWarning':
    'Git 內建指令可以改檔案、refs、遠端同已發佈歷史。繼續之前請覆核完整預設。',
  'customGit.runReviewed': '執行已覆核指令',
  'customGit.goBack': '返回',
  'customGit.confirmDeleteTitle': '刪除呢個本機預設？',
  'customGit.confirmDeleteDescription': 'Repo 唔會有任何更改。',
  'customGit.keepPreset': '保留預設',
  'customGit.outputAria': '自訂 Git 指令輸出',
  'customGit.initialStatus': '建立或者揀一個本機指令預設。',
  'customGit.repositoryChangedStatus': 'Repo 變咗；請重新覆核預設。',
  'customGit.invalidNameError': '預設名稱要有 1 至 80 個可顯示字元。',
  'customGit.savedStatus': '預設已儲存喺呢部裝置。',
  'customGit.saveError': '儲存唔到預設。',
  'customGit.removedStatus': '預設已由呢部裝置移除。',
  'customGit.reviewError': '覆核唔到指令。',
  'customGit.runningStatus': '執行緊已覆核 Git 預設…',
  'customGit.startError': '預設未能開始執行。',
  'customGit.completedStatus': '自訂 Git 預設已完成。',
  'customGit.cancelledStatus': '自訂 Git 預設已取消。',
  'customGit.failedStatus': '自訂 Git 預設執行失敗。',
  'customGit.exitCodeError': 'Git 以代碼 {code} 結束。',
  'editor.wslDisplayName': '{editor} — WSL：{distribution}',
  'editor.wslDistributionMismatch':
    '呢個路徑屬於 WSL 發行版「{distribution}」。請揀返配對嘅 WSL 編輯器項目。',
  'editor.wslInvalidDistributionPath': '請揀有效嘅 WSL 發行版同路徑。',
  'editor.wslTranslateFailed':
    'WSL 轉換唔到呢個路徑。請檢查所揀發行版有冇運行，再試一次。',
  'editor.wslInvalidTranslatedPath': 'WSL 回傳咗無效嘅轉換路徑。',
  'editor.wslInvalidTarget': '請揀有效嘅 WSL 編輯器目標。',
  'networkRepository.unavailable':
    '呢個網絡位置而家用唔到，或者睇落唔係 Git repo。',
  'networkRepository.reconnect':
    '請重新連接共享、映射磁碟、VPN 或 WSL 發行版，再試一次。',
  'networkRepository.unavailableAria':
    '呢個網絡位置而家用唔到，或者唔係 Git repo。請重新連接再試。',
  'networkRepository.mappedDrive': '映射網絡磁碟',
  'networkRepository.wslShare': 'WSL 共享',
  'networkRepository.uncShare': 'UNC 網絡共享',
  'networkRepository.detected':
    '偵測到以下位置：{location}。Desktop Material 會保留精確路徑；如果位置離線，做 Git 操作前請先重新連接。',
  'batchSync.title': '同步 repo',
  'batchSync.loadingChoices': '載入緊 repo 選項…',
  'batchSync.reviewAria': 'Repo 批次覆核',
  'batchSync.operation': '操作',
  'batchSync.pullActive': 'Pull 使用中嘅分支',
  'batchSync.fetchOnly': '只 Fetch（唔郁 worktree）',
  'batchSync.chooseRepositories': '揀 repo',
  'batchSync.selectAll': '全部揀晒',
  'batchSync.selectNone': '全部唔揀',
  'batchSync.noRepositories': '而家冇可用 repo。',
  'batchSync.candidatesAria': '要同步嘅 repo',
  'batchSync.reviewSingle':
    '每次最多同步三個 repo。每個 repo 都有獨立結果，今次只包括呢 {count} 個已覆核 repo。',
  'batchSync.reviewMultiple':
    '每次最多同步三個 repo。每個 repo 都有獨立結果，今次只包括呢 {count} 個已覆核 repo。',
  'batchSync.cancel': '取消',
  'batchSync.startPull': '開始 Pull',
  'batchSync.startFetch': '開始 Fetch',
  'batchSync.progressAria': '同步進度',
  'batchSync.stopped': '同步已停止',
  'batchSync.pullComplete': 'Pull 完成',
  'batchSync.fetchComplete': 'Fetch 完成',
  'batchSync.liveProgress': '即時進度',
  'batchSync.couldNotFinish': 'Repo 同步未能完成',
  'batchSync.allProcessed': '所有 repo 都處理好喇',
  'batchSync.pullingRepositories': 'Pull 緊 repo',
  'batchSync.fetchingRepositories': 'Fetch 緊 repo',
  'batchSync.completedOf': '{total} 個 repo 入面已完成 {completed} 個',
  'batchSync.synchronizedAria': '已同步 repo',
  'batchSync.metricComplete': '{count} 個完成',
  'batchSync.metricActive': '{count} 個進行中',
  'batchSync.metricWaiting': '{count} 個等緊',
  'batchSync.finalResult': '每個 repo 都有最終結果。',
  'batchSync.nowPulling': '而家 Pull 緊：{repositories}',
  'batchSync.nowFetching': '而家 Fetch 緊：{repositories}',
  'batchSync.waitingNext': '等緊下一個 repo 開始。',
  'batchSync.backgroundNote':
    '每次最多同步三個 repo。工作會繼續，你可以放心放佢去背景。',
  'batchSync.summaryPull':
    'Pull 咗 {completed} 個，略過 {skipped} 個，失敗 {failed} 個。',
  'batchSync.summaryFetch':
    'Fetch 咗 {completed} 個，略過 {skipped} 個，失敗 {failed} 個。',
  'batchSync.noneToPull': '冇 repo 需要 Pull。',
  'batchSync.resultsAria': 'Repo 同步進度',
  'batchSync.repository': 'Repo',
  'batchSync.status': '狀態',
  'batchSync.detail': '目前操作或者結果',
  'batchSync.runBackground': '放去背景跑',
  'batchSync.done': '完成',
  'batchSync.statusWaiting': '等緊',
  'batchSync.statusPulling': 'Pull 緊',
  'batchSync.statusFetching': 'Fetch 緊',
  'batchSync.statusPulled': '已 Pull',
  'batchSync.statusFetched': '已 Fetch',
  'batchSync.statusSkipped': '已略過',
  'batchSync.statusFailed': '失敗',
  'repositoryPicker.status': 'Repo 狀態',
  'repositoryPicker.all': '全部',
  'repositoryPicker.clean': '乾淨',
  'repositoryPicker.changed': '有變更',
  'repositoryPicker.ahead': '領先',
  'repositoryPicker.behind': '落後',
  'repositoryPicker.missingOrCloning': '遺失／複製緊',
  'repositoryPicker.hideHiddenAria': '收埋隱藏 repo',
  'repositoryPicker.showHiddenAria': '顯示隱藏 repo（{count}）',
  'repositoryPicker.showingHidden': '顯示緊隱藏項目（{count}）',
  'repositoryPicker.showHidden': '顯示隱藏項目（{count}）',
  'repositoryPicker.hidden': '已隱藏',
  'repositoryPicker.itemHiddenAria': '{repository}，已隱藏',
  'repositoryPicker.hideMenu': '隱藏 repo',
  'repositoryPicker.unhideMenu': '取消隱藏 repo',
  'repositoryPicker.customizeNameMenu': '自訂名稱外觀',
  'repositoryPicker.customizeLogoMenu': '自訂標誌外觀',
  'removeRepository.trashFailedMessage':
    '呢個 repo 無法移去{trash}。可能有檔案喺其他程式度開住，又或者呢個位置（例如網絡磁碟或者可移除磁碟）唔支援{trash}。',
  'removeRepository.trashFailedWarning':
    '強制刪除會永久喺你嘅磁碟度移除呢個資料夾同埋入面所有內容，無法復原。',
  'removeRepository.forceDeleteButton': '強制永久刪除',
  'patchSeries.initialStatus': '揀匯出或者匯入操作。',
  'patchSeries.runningExport': '匯出緊領先上游嘅 commit',
  'patchSeries.runningImport': '套用緊已覆核嘅 patch 系列',
  'patchSeries.runningContinue': '繼續緊目前 patch 工作階段',
  'patchSeries.runningSkip': '略過緊目前 patch',
  'patchSeries.runningAbort': '中止緊目前 patch 工作階段',
  'patchSeries.operation': 'Patch 系列操作',
  'patchSeries.chooseExportTitle': '揀新 patch 系列資料夾',
  'patchSeries.reviewExportStatus': '覆核新匯出資料夾。',
  'patchSeries.prepareExportError': '準備唔到 patch 系列匯出。',
  'patchSeries.prepareExportFailed': 'Patch 匯出準備失敗。',
  'patchSeries.chooseImportTitle': '按套用次序揀 patch 檔案',
  'patchSeries.patchFileFilter': 'Git patch 系列',
  'patchSeries.reviewImportStatus': '覆核所揀 patch 次序。',
  'patchSeries.prepareImportError': '準備唔到 patch 系列匯入。',
  'patchSeries.prepareImportFailed': 'Patch 匯入準備失敗。',
  'patchSeries.runningStatus': '{operation}…',
  'patchSeries.startError': 'Patch 系列操作未能開始。',
  'patchSeries.cancelledStatus': 'Patch 系列操作已取消。',
  'patchSeries.failedStatus': '{operation}失敗。',
  'patchSeries.gitFailed': 'Git 未能完成呢個操作。',
  'patchSeries.gitFailedWithCode': 'Git 未能完成呢個操作（結束代碼 {code}）。',
  'patchSeries.refreshingStatus': '重新整理緊 repo…',
  'patchSeries.exportedStatus': 'Patch 系列已匯出到新資料夾。',
  'patchSeries.abortedStatus': 'Patch 工作階段已中止，repo 狀態已復原。',
  'patchSeries.completedStatus': 'Patch 系列操作完成。',
  'patchSeries.refreshFailedStatus': 'Patch 操作完成咗，不過重新整理失敗。',
  'patchSeries.refreshRequiredError': '開始另一個操作之前，請先重新整理 repo。',
  'patchSeries.exportConfirmTitle': '匯出領先上游嘅 commit？',
  'patchSeries.exportConfirmDescription':
    'Git 會喺 {destination} 建立有編號嘅新 patch 系列資料夾，絕對唔會取代現有目的地。',
  'patchSeries.exportAction': '匯出 patch 系列',
  'patchSeries.goBack': '返回',
  'patchSeries.importConfirmTitle': '按呢個次序套用 {count} 個 patch？',
  'patchSeries.importConfirmDescription':
    'Git 會用三方後備方式建立 commit。有衝突就先喺「變更」解決，再返嚟繼續、略過或者中止。',
  'patchSeries.additionalPatches': '另外揀咗 {count} 個 patch。',
  'patchSeries.importAction': '套用 patch 系列',
  'patchSeries.recoveryAria': 'Patch 衝突復原',
  'patchSeries.recoveryDescription':
    '喺「變更」解決檔案之後，可以繼續呢個 patch、略過佢，或者中止成個匯入。',
  'patchSeries.continueAction': '繼續',
  'patchSeries.skipAction': '略過 patch',
  'patchSeries.abortAction': '中止匯入',
  'patchSeries.title': 'Patch 系列',
  'patchSeries.heading': '交換方便覆核嘅 commit 系列',
  'patchSeries.description':
    '匯出領先已設定上游嘅 commit，或者按已覆核次序套用原生選檔器揀好嘅編號 patch。',
  'patchSeries.chooseExportAction': '揀匯出目的地',
  'patchSeries.chooseImportAction': '揀 patch 檔案',
  'patchSeries.cancelAction': '取消',
  'patchSeries.resultsAria': 'Patch 系列結果',
  'bulkBranchDelete.aria': '批次刪除分支',
  'bulkBranchDelete.closeAction': '收起分支清理',
  'bulkBranchDelete.openAction': '刪除分支…',
  'bulkBranchDelete.reviewTitle': '覆核本機分支',
  'bulkBranchDelete.protectedDescription': '目前同預設分支已受保護。',
  'bulkBranchDelete.selectAll': '全選',
  'bulkBranchDelete.selectNone': '清除選取',
  'bulkBranchDelete.empty': '冇其他本機分支可以刪除。',
  'bulkBranchDelete.listAria': '準備刪除嘅本機分支',
  'bulkBranchDelete.reviewDeletion': '覆核刪除（{count}）',
  'bulkBranchDelete.confirmSingular': '永久刪除呢 {count} 條指定本機分支？',
  'bulkBranchDelete.confirmPlural': '永久刪除呢 {count} 條指定本機分支？',
  'bulkBranchDelete.remoteUnaffected':
    '遠端分支唔會更改。刪除前會重新核對每個本機 tip，並記錄資料方便復原。',
  'bulkBranchDelete.deleteReviewed': '刪除已覆核分支',
  'bulkBranchDelete.goBack': '返回',
  'bulkBranchDelete.deleting': '刪除緊分支…',
  'bulkBranchDelete.limitError': '每次最多覆核 {count} 條分支。',
  'bulkBranchDelete.reviewChangedError': '已覆核嘅分支清單變咗。',
  'bulkBranchDelete.deleteError': '未能刪除已覆核分支。',
  'bulkBranchDelete.resultsAria': '刪除結果',
  'stashManager.timeUnavailable': '時間暫時睇唔到',
  'stashManager.timestamp': '{timestamp}',
  'stashManager.operationCancelled': '{operation}已取消。Repo 已重新整理。',
  'stashManager.operationFailed':
    '{operation}未能完成。Git 可能留低工作樹衝突；如果還原未能乾淨完成，stash 會保留。請檢查「變更」再試。',
  'stashManager.repositoryChangedStatus': 'Repo 變咗；stash 管理員已重設。',
  'stashManager.operationProgress': '{operation}緊…',
  'stashManager.cancellingStatus': '取消緊…',
  'stashManager.createOperation': '建立命名 stash',
  'stashManager.createSuccess': '命名 stash 已建立，並已放喺記錄咗嘅分支下面。',
  'stashManager.applyOperation': '套用 stash 副本',
  'stashManager.applySuccess': 'Stash 變更已套用，stash 亦保留作復原。',
  'stashManager.saveDetailsOperation': '儲存 stash 詳情',
  'stashManager.saveDetailsSuccess': 'Stash 名稱同分支關聯已更新。',
  'stashManager.clearOperation': '清除已覆核 stash',
  'stashManager.clearSuccessSingular':
    '已清除 {count} 個經 Desktop 管理同覆核嘅 stash；其他 Git stash 完全冇郁過。',
  'stashManager.clearSuccessPlural':
    '已清除 {count} 個經 Desktop 管理同覆核嘅 stash；其他 Git stash 完全冇郁過。',
  'stashManager.stashChangedError':
    '嗰個 stash 變咗；請重新整理並覆核目前清單。',
  'stashManager.restoreOperation': '還原 stash',
  'stashManager.restoreSuccess':
    'Stash 已還原並移除。繼續之前，請先處理「變更」入面嘅衝突。',
  'stashManager.discardOperation': '丟棄 stash',
  'stashManager.discardSuccess': '已丟棄經 Desktop 管理同覆核嘅 stash。',
  'stashManager.createBranchOperation': '由 stash 建立分支',
  'stashManager.createBranchSuccess':
    '新分支已建立並 checkout；只有乾淨還原之後先會消耗 stash。',
  'stashManager.createHeading': '建立命名 stash',
  'stashManager.nameLabel': '名稱',
  'stashManager.createPlaceholder': '今次想暫存啲咩？',
  'stashManager.changesToSave': '要儲存嘅變更',
  'stashManager.allTrackedChanges': '所有已追蹤變更',
  'stashManager.selectedFileSingular': '已揀 {count} 個檔案',
  'stashManager.selectedFilePlural': '已揀 {count} 個檔案',
  'stashManager.includeUntracked': '呢個範圍亦包含未追蹤檔案',
  'stashManager.selectedScopeCaption':
    '所揀範圍會儲存完整檔案，Git 執行前亦會重新核對路徑；部分 hunk staging 會留喺「變更」。',
  'stashManager.untrackedWarning':
    '如果唔剔「包含未追蹤檔案」，已揀嘅未追蹤檔案會留喺「變更」。',
  'stashManager.conflictsWarning':
    '建立另一個 stash 之前，請先處理目前工作樹衝突。',
  'stashManager.createAction': '建立命名 stash',
  'stashManager.fileCountSingular': '{count} 個檔案',
  'stashManager.fileCountPlural': '{count} 個檔案',
  'stashManager.filesLoadWhenOpened': '打開時先載入檔案',
  'stashManager.reviewStashAria': '覆核 {name} 以清除 stash',
  'stashManager.externalLabel': '外部',
  'stashManager.selectedActionsAria': '所揀 stash 操作',
  'stashManager.workingChangesWarningSingular':
    '「變更」已經有 {count} 個檔案。套用或者還原可能衝突；還原失敗會保留 stash。',
  'stashManager.workingChangesWarningPlural':
    '「變更」已經有 {count} 個檔案。套用或者還原可能衝突；還原失敗會保留 stash。',
  'stashManager.applyAction': '套用副本',
  'stashManager.restoreAction': '還原',
  'stashManager.renameMoveAction': '重新命名或移動',
  'stashManager.newBranchAction': '新分支',
  'stashManager.discardAction': '丟棄',
  'stashManager.editStashAria': '編輯 {name}',
  'stashManager.branchAssociation': '分支關聯',
  'stashManager.metadataCaption':
    '呢度只會改 Desktop Material 嘅分組；唔會切換分支，亦唔會修改已儲存檔案。',
  'stashManager.saveDetailsAction': '儲存詳情',
  'stashManager.cancelAction': '取消',
  'stashManager.branchFromAria': '由 {name} 建立分支',
  'stashManager.newLocalBranch': '新本機分支',
  'stashManager.branchCaption':
    'Git 會驗證分支係新嘅、將佢 checkout，並只會喺變更乾淨套用後先消耗 stash。',
  'stashManager.reviewBranchAction': '覆核建立分支',
  'stashManager.confirmRestore':
    '還原會套用呢啲變更，並只會喺 Git 乾淨完成時移除 stash。',
  'stashManager.confirmDiscard': '丟棄會永久移除呢個已覆核 repo stash。',
  'stashManager.confirmBranch': '由呢個 stash 建立並 checkout「{name}」？',
  'stashManager.confirmClearSingular':
    '永久清除呢 {count} 個已覆核 repo stash？只會包括已剔選嘅指定身份。',
  'stashManager.confirmClearPlural':
    '永久清除呢 {count} 個已覆核 repo stash？只會包括已剔選嘅指定身份。',
  'stashManager.createBranchAction': '建立分支',
  'stashManager.confirmAction': '確認',
  'stashManager.inventoryHeading': 'Repo stash 清單',
  'stashManager.clearReviewedAction': '清除已覆核（{count}）',
  'stashManager.emptyInventory': '呢個 repo 冇 stash。',
  'stashManager.currentLabel': '目前',
  'stashManager.managedOnlyCaption':
    '清單入面所有 stash 都係由 Desktop Material 建立。',
  'stashManager.externalCaptionSingular':
    '顯示緊 {count} 個外部 Git stash。支援套用、還原、建立分支同精確覆核後丟棄；外部 metadata 會保持不變。',
  'stashManager.externalCaptionPlural':
    '顯示緊 {count} 個外部 Git stash。支援套用、還原、建立分支同精確覆核後丟棄；外部 metadata 會保持不變。',
  'stashManager.truncatedCaption':
    ' 清單只保留最新 500 項；清除一批已覆核項目後請重新整理。',
  'stashManager.managerAria': 'Stash 管理員',
  'stashManager.repositoryStashSingular': '{count} 個 repo stash',
  'stashManager.repositoryStashPlural': '{count} 個 repo stash',
  'stashManager.checkoutBranchCaption': 'Checkout 一條分支先可以建立 stash',
  'stashManager.onBranchCaption': '{branch} 上有 {count} 個',
  'stashManager.closeAction': '關閉',
  'stashManager.manageAction': '管理',
  'stashManager.controlsAria': '受管 stash 控制',
  'stashManager.cancelOperationAction': '取消操作',
  'tagLifecycle.rejectedError': 'Git 拒絕咗標籤操作；請查看應用程式錯誤詳情。',
  'tagLifecycle.operationFailedError': '標籤操作未能完成。',
  'tagLifecycle.createdStatus': '已建立本機標籤 {name}。',
  'tagLifecycle.movedStatus': '已移動本機標籤 {name}。',
  'tagLifecycle.deletedLocalStatus': '已刪除本機標籤 {name}。',
  'tagLifecycle.pushedStatus': '已 push 標籤 {name}。',
  'tagLifecycle.pushedAllStatus': '已 push {count} 個本機標籤。',
  'tagLifecycle.fetchedPrunedStatus': '已由 {remote} fetch 並清理標籤。',
  'tagLifecycle.deletedRemoteStatus': '已刪除遠端標籤 {name}。',
  'tagLifecycle.confirmMove': '喺 {target} 重新建立 {name}，類型係{kind}標籤。',
  'tagLifecycle.confirmDeleteLocal':
    '刪除本機標籤 {name}。遠端標籤唔會被刪除。',
  'tagLifecycle.confirmPushNew': 'Push 新遠端標籤 {name}。',
  'tagLifecycle.confirmPushReplace':
    'Push {name}；如果遠端唔同，只會取代已精確覆核嘅遠端標籤物件。',
  'tagLifecycle.confirmPushAll':
    'Push 全部 {count} 個已覆核本機標籤；有需要時只會取代精確覆核過嘅遠端物件。',
  'tagLifecycle.confirmFetchPrune':
    '由 {remote} fetch 標籤，並刪除遠端已經唔再提供嘅已覆核本機標籤。',
  'tagLifecycle.confirmDeleteRemote':
    '重新驗證物件 {object} 後，由預設遠端刪除 {name}。',
  'tagLifecycle.createHeading': '建立標籤',
  'tagLifecycle.nameLabel': '名稱',
  'tagLifecycle.targetLabel': '目標',
  'tagLifecycle.targetPlaceholder': 'HEAD、分支或者物件 ID',
  'tagLifecycle.typeLabel': '類型',
  'tagLifecycle.annotated': '附註標籤',
  'tagLifecycle.lightweight': '輕量標籤',
  'tagLifecycle.messageLabel': '訊息',
  'tagLifecycle.signConfigured': '用 Git 已設定嘅 {format} 簽署器簽署',
  'tagLifecycle.signingConfigured': 'Git 顯示呢個 repo 已明確設定簽署金鑰。',
  'tagLifecycle.signingNotConfigured':
    '未明確設定 user.signingkey；Git 可能使用預設簽署器，或者回報簽署功能用唔到。',
  'tagLifecycle.createAction': '建立本機標籤',
  'tagLifecycle.moveAria': '移動 {name}',
  'tagLifecycle.moveHeading': '移動或者重新建立 {name}',
  'tagLifecycle.reviewedObject':
    '已覆核物件係 {object}。如果確認前標籤有變，Git 會拒絕今次操作。',
  'tagLifecycle.newTargetLabel': '新目標',
  'tagLifecycle.recreatedTypeLabel': '重新建立嘅類型',
  'tagLifecycle.signRecreated': '簽署重新建立嘅標籤',
  'tagLifecycle.reviewMoveAction': '覆核移動',
  'tagLifecycle.cancelAction': '取消',
  'tagLifecycle.remoteNotLoaded': '未載入遠端',
  'tagLifecycle.localOnly': '只限本機',
  'tagLifecycle.pushed': '已 push',
  'tagLifecycle.differentRemotely': '同遠端唔同',
  'tagLifecycle.annotatedLower': '附註',
  'tagLifecycle.lightweightLower': '輕量',
  'tagLifecycle.localTagMeta': '{kind} · {target} · {remoteStatus}{signed}',
  'tagLifecycle.signedSuffix': ' · 已簽署',
  'tagLifecycle.moveAction': '移動',
  'tagLifecycle.pushAction': 'Push',
  'tagLifecycle.deleteRemoteAction': '刪除遠端',
  'tagLifecycle.deleteLocalAction': '刪除本機',
  'tagLifecycle.remoteOnlyMeta': '只限遠端 · {target}',
  'tagLifecycle.confirmHeading': '確認標籤操作',
  'tagLifecycle.typeToConfirm': '輸入 {phrase} 以確認',
  'tagLifecycle.confirmAction': '確認',
  'tagLifecycle.managerAria': '標籤生命週期管理員',
  'tagLifecycle.title': '標籤生命週期',
  'tagLifecycle.description':
    '透過有安全界線嘅 Git 操作，管理標籤清單、建立、移動、簽署、push、fetch、清理同刪除。',
  'tagLifecycle.refreshLocalAction': '重新整理本機',
  'tagLifecycle.loadRemoteAction': '載入遠端',
  'tagLifecycle.readOnlyNotice': '臨時子模組工作區喺「Repo 工具」入面係唯讀。',
  'tagLifecycle.loading': '載入緊標籤清單…',
  'tagLifecycle.filterLabel': '篩選標籤',
  'tagLifecycle.fetchedStatus': '已由 {remote} fetch 標籤。',
  'tagLifecycle.fetchAction': 'Fetch 標籤',
  'tagLifecycle.fetchPruneAction': 'Fetch 並清理',
  'tagLifecycle.pushAllAction': '全部 push',
  'tagLifecycle.localTagsHeading': '本機標籤（{count}）',
  'tagLifecycle.noLocalMatches': '冇本機標籤符合呢個篩選。',
  'tagLifecycle.localTruncated':
    '只顯示頭 500 個本機標籤。做批次操作前，請先收窄 repo 標籤集合。',
  'tagLifecycle.remoteOnlyHeading': '{remote} 上只限遠端嘅標籤（{count}）',
  'tagLifecycle.noRemoteMatches': '冇只限遠端嘅標籤符合呢個篩選。',
  'tagLifecycle.remoteTruncated':
    '只顯示頭 500 個遠端標籤。未顯示嘅標籤唔可以刪除；清單完整之前，批次 push 同清理亦會保持停用。',
  'ollama.providerType': 'Ollama（本機）',
  'ollama.authenticationHeading': '驗證',
  'ollama.authenticationDescription':
    'Ollama 喺本機運行，唔需要 API key。Desktop Material 只會用呢個供應商已設定網址嘅原生管理 API。',
  'ollama.modelsSyncDescription':
    '加咗呢個供應商之後，模型管理員會同步已安裝嘅 Ollama 模型。',
  'ollama.modelsEmpty':
    '未同步任何模型。加咗呢個供應商之後，再開啟佢嘅模型管理員。',
  'ollama.manager.openAction': '管理模型',
  'ollama.manager.backAction': '返去供應商',
  'ollama.manager.title': 'Ollama 模型管理員',
  'ollama.manager.subtitle':
    '安裝、睇資料，同控制呢個 Ollama 供應商上面嘅模型。',
  'ollama.manager.endpoint': '端點',
  'ollama.manager.configuredEndpoint': '已設定嘅端點',
  'ollama.manager.connected': '已連線',
  'ollama.manager.unavailable': '暫時用唔到',
  'ollama.manager.checking': '檢查緊…',
  'ollama.manager.partial': '有部分模型資料載入唔到。',
  'ollama.manager.version': '版本',
  'ollama.manager.installed': '已安裝',
  'ollama.manager.running': '運行緊',
  'ollama.manager.refresh': '重新整理',
  'ollama.manager.refreshing': '重新整理緊…',
  'ollama.manager.searchLabel': '搜尋已安裝模型',
  'ollama.manager.searchPlaceholder': '用名稱、系列或者能力搜尋…',
  'ollama.manager.scopeLabel': '模型清單篩選',
  'ollama.manager.allModels': '全部模型',
  'ollama.manager.runningModels': '只睇運行緊',
  'ollama.manager.inventoryLabel': '已安裝嘅 Ollama 模型',
  'ollama.manager.loadingInventory': '載入緊模型…',
  'ollama.manager.unavailableInventory': '暫時攞唔到模型清單。',
  'ollama.manager.emptyInventory': '呢個端點未安裝任何模型。',
  'ollama.manager.emptyFilter': '而家嘅篩選搵唔到模型。',
  'ollama.manager.modelDetails': '模型詳情',
  'ollama.manager.selectModel': '揀一個已安裝模型嚟睇資料同管理。',
  'ollama.manager.loadingDetails': '載入緊模型詳情…',
  'ollama.manager.runningBadge': '運行緊',
  'ollama.manager.size': '大小',
  'ollama.manager.modified': '修改時間',
  'ollama.manager.digest': '雜湊摘要',
  'ollama.manager.family': '系列',
  'ollama.manager.format': '格式',
  'ollama.manager.parameters': '參數',
  'ollama.manager.quantization': '量化',
  'ollama.manager.capabilities': '能力',
  'ollama.manager.license': '授權摘要',
  'ollama.manager.noneReported': '未有資料',
  'ollama.manager.runtime': '運行狀態',
  'ollama.manager.vram': 'VRAM',
  'ollama.manager.context': 'Context 長度',
  'ollama.manager.expires': '到期時間',
  'ollama.manager.notRunning': '呢個模型而家未載入。',
  'ollama.manager.pullTitle': '安裝模型',
  'ollama.manager.pullHint': '輸入 Ollama 模型名稱；會原樣使用已設定嘅端點。',
  'ollama.manager.modelName': '模型名稱',
  'ollama.manager.pullPlaceholder': 'llama3.2:latest',
  'ollama.manager.pull': 'Pull 並安裝',
  'ollama.manager.pulling': '安裝緊…',
  'ollama.manager.cancel': '取消',
  'ollama.manager.receiving': '接收緊模型資料…',
  'ollama.manager.copyTitle': '複製模型',
  'ollama.manager.copyHint': '用所選模型建立另一個本機模型名稱。',
  'ollama.manager.copyDestination': '複製目的地',
  'ollama.manager.copy': '複製',
  'ollama.manager.renameTitle': '重新命名模型',
  'ollama.manager.renameHint': '先複製做新名稱，再移除原本嗰個。',
  'ollama.manager.renameDestination': '新模型名稱',
  'ollama.manager.rename': '重新命名',
  'ollama.manager.load': '載入 / 啟動',
  'ollama.manager.unload': '卸載 / 停止',
  'ollama.manager.delete': '刪除',
  'ollama.manager.deleteTitle': '刪除模型？',
  'ollama.manager.deleteConfirm': '刪除模型',
  'ollama.manager.invalidName': '請輸入模型名稱。',
  'ollama.manager.duplicateName': '請揀另一個模型名稱。',
  'ollama.manager.operationError': '未能完成模型操作。',
  'ollama.manager.refreshError': '呢個供應商端點暫時連唔到 Ollama。',
  'ollama.manager.detailsError': '未能載入呢個模型嘅延伸詳情。',
  'ollama.manager.configurationPartial':
    'Ollama 操作成功咗，不過未能更新已設定嘅模型清單。',
  'ollama.manager.renamePartial': '複製成功咗，不過未能移除原本模型。',
  'ollama.manager.pullCancelled': '已取消安裝模型。',
  'ollama.manager.chatTitle': '傾偈',
  'ollama.manager.chatHint': '揀個模型傾偈，佢會即時串流回覆畀你。',
  'ollama.manager.chatModelLabel': '傾偈模型',
  'ollama.manager.chatPlaceholder': '打句嘢傾下…',
  'ollama.manager.chatSend': '傳送',
  'ollama.manager.chatStop': '停',
  'ollama.manager.chatClear': '清空對話',
  'ollama.manager.chatStreaming': '回覆緊…',
  'ollama.manager.chatEmpty': '同揀咗嘅模型開始傾偈啦。',
  'ollama.manager.chatNoModel': '要先安裝一個模型先可以傾偈。',
  'ollama.manager.chatUnsupported': '呢個供應商用唔到傾偈功能。',
  'ollama.manager.chatError': '未能完成傾偈要求。',
  'ollama.manager.chatYou': '你',
  'ollama.manager.chatAssistant': '助手',
  'ollama.manager.chatMessageLabel': '訊息',
  'ollama.manager.unknown': '未知',
  'ollama.manager.never': '永不',
  'ollama.manager.showing': '顯示緊 {visible}/{total} 個模型',
  'ollama.manager.selectedModel': '揀選 {name}',
  'ollama.manager.moreCapabilities': '仲有 {count} 項',
  'ollama.manager.pullProgress': '已完成 {percent}%',
  'ollama.manager.pullSucceeded': '已安裝 {name}。',
  'ollama.manager.copySucceeded': '已由 {source} 複製去 {destination}。',
  'ollama.manager.renameSucceeded': '已由 {source} 改名做 {destination}。',
  'ollama.manager.loadSucceeded': '已載入 {name}。',
  'ollama.manager.unloadSucceeded': '已卸載 {name}。',
  'ollama.manager.deleteSucceeded': '已刪除 {name}。',
  'ollama.manager.confirmDelete':
    '要由呢個 Ollama 端點刪除 {name} 嗎？刪咗冇得返轉頭。',
  'subtree.title': '子樹',
  'color.blue': '藍色',
  'color.violet': '紫色',
  'color.teal': '藍綠色',
  'color.green': '綠色',
  'color.amber': '琥珀色',
  'color.rose': '玫瑰色',
  'settings.notificationsEnableTitle': '開啟通知',
  'settings.notificationsEnableDescription':
    '喺目前 repository 有重要事件發生嗰陣，即刻彈通知話你知。',
  'settings.automationAutoCommitPushTitle': '自動 commit 同 push',
  'settings.automationAutoCommitPushDescription':
    'Copilot 幫你寫 commit 訊息；如果你仲有草稿訊息或者有操作進行緊，就會自動跳過。',
  'settings.automationAutoPullTitle': '自動 pull',
  'settings.automationAutoPullDescription':
    '當工作區乾淨又已經設定咗上游，先至會 pull。',
  'settings.automationIntervalEvery': '每隔',
  'settings.automationIntervalMinutes': '{minutes} 分鐘',
  'settings.automationIntervalGroupLabel': '{title}間隔',
  'settings.advancedUsageStatsTitle': '使用統計',
  'settings.advancedUsageStatsDescription':
    '提交匿名使用數據，幫手改善 Desktop Material。',
  'settings.advancedCredentialStorageTitle': '憑證儲存',
  'settings.advancedCredentialStorageDescription':
    '權杖只會存喺作業系統嘅憑證庫，絕對唔會寫入 repository 嘅設定檔。',
  'settings.integrationsExternalEditorTitle': '外部編輯器',
  'settings.integrationsExternalEditorSubtitle':
    '喺編輯器打開檔案或者 repository 時會用到',
  'settings.integrationsShellTitle': '命令列 Shell',
  'settings.integrationsShellSubtitle': '喺命令列打開 repository 時會用到',
  'settings.integrationsChooseEditor': '揀外部編輯器',
  'settings.integrationsChooseShell': '揀命令列 Shell',
  'settings.integrationsCustomEditorChoice': '設定自訂編輯器…',
  'settings.integrationsCustomShellChoice': '設定自訂命令列…',
  'settings.integrationsCustomEditorLabel': '自訂編輯器',
  'settings.integrationsCustomShellLabel': '自訂命令列',
  'settings.integrationsSelectEditor': '揀編輯器',
  'push.ghCliFallbackSuccessTitle': '用咗 GitHub CLI 帳戶推送成功',
  'push.ghCliFallbackSuccessBody':
    '推送去 {remote} 一開始俾人拒絕，所以 Desktop Material 改用你嘅 GitHub CLI 登入再試一次，今次搞掂咗。',
  'clone.visibilityPublic': '公開',
  'clone.visibilityPrivate': '私人',
  'clone.noDescription': '未有描述',
  'clone.starsLabel': '{count} 個 star',
  'clone.forksLabel': '{count} 個 fork',
  'clone.sizeLabel': '倉庫大細 {size}',
  'clone.defaultBranchLabel': '預設分支 {branch}',
  'clone.updatedLabel': '{time}更新',
  'clone.languageLabel': '語言：{language}',
  'clone.languageFilterLabel': '語言',
  'clone.languageFilterAria': '按語言篩選倉庫',
  'clone.orgScopeMissing': '睇唔到任何組織，可能今次登入未攞到組織權限。',
  'clone.orgReconnect': '重新連接以載入組織',
  'clone.orgRestrictionNote':
    '有啲組織限制第三方存取，要批准咗呢個 app 先會喺度出現。',
  'clone.orgReviewAccess': '查看 OAuth app 存取權',
  'palette.selectAll': '全部揀晒',
  'palette.toggleTheme': '切換光暗主題',
  'palette.preferencesAccounts': '設定：帳戶',
  'palette.preferencesAppearance': '設定：外觀',
  'palette.preferencesIntegrations': '設定：整合',
  'palette.preferencesAutomation': '設定：自動化',
  'palette.preferencesAdvanced': '設定：進階',
  'palette.preferencesNotifications': '設定：通知',
  'palette.preferencesGit': '設定：Git',
  'palette.preferencesAccessibility': '設定：無障礙',
  'palette.notificationHistory': '打開通知中心',
  'palette.notificationAutomations': '通知自動化',
  'palette.copyRepoPath': '複製倉庫路徑',
  'palette.copyBranchName': '複製而家分支個名',
  'palette.copyCommitSha': '複製而家 commit SHA',
  'buildRun.closeDisabledRunning': '而家有任務行緊，要先停咗佢先可以閂呢個面板',
  'buildRun.fixingWithOpencode': 'OpenCode 修緊…',
  'buildRun.stopConfirmTitle': '要停咗行緊嘅任務？',
  'buildRun.stopConfirmBody':
    '行緊嘅 build 同 OpenCode 嘅工作都會即刻終止，停咗就無得返轉頭。',
  'buildRun.stopConfirmConfirm': '停止',
  'buildRun.stopConfirmCancel': '唔好',
  'buildRun.sendToOpencode': '傳去 opencode',
  'buildRun.sendIntro':
    'opencode 係個 AI 寫程式助手。你打低想做乜，佢就會喺呢個 repo 度做，全部喺你部機度行。',
  'buildRun.sendPromptLabel': '想 opencode 做啲乜？',
  'buildRun.sendPromptPlaceholder': '講低你想 opencode 喺呢個 repo 度做啲乜…',
  'buildRun.sendEmptyError': '傳去 opencode 之前，要先打低你嘅要求。',
  'buildRun.sendSubmit': '傳去 opencode',
  'buildRun.sendAutoApproveLabel': '呢次自動批准 opencode 改嘢同行指令（yolo）',
  'buildRun.sendAutoApproveWarning':
    'opencode 會喺呢個 repo 度改檔案同行 shell 指令，唔會問過你。佢淨係鎖死喺呢個 repo，掂唔到出面嘅檔案。',
  'buildRun.sendAutoApproveNote':
    'opencode 改檔案或者行指令之前會問你。撳上面嗰個自動批准，佢就可以喺呢個 repo 度自己搞掂。',
  'buildRun.sendRunningTitle': 'opencode 幫緊你搞緊個要求…',
  'workflowDispatch.searchPlaceholder': '打字搵 workflow，睇個名或者檔案…',
  'workflowDispatch.searchAriaLabel': '篩 workflow',
  'workflowDispatch.listAriaLabel': 'Workflow 清單',
  'workflowDispatch.empty': '未有任何 workflow。',
  'workflowDispatch.noMatches': '冇 workflow 啱而家嘅篩選。',
  'workflowDispatch.stateActive': '開緊',
  'workflowDispatch.stateDisabled': '停咗',
}
