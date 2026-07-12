export interface IAutomationGuardState {
  readonly tipIsValid: boolean
  readonly hasChanges: boolean
  readonly hasConflict: boolean
  readonly hasMultiCommitOperation: boolean
  readonly isCommitting: boolean
  readonly isGeneratingCommitMessage: boolean
  readonly isPushPullFetchInProgress: boolean
  readonly isCheckingOut: boolean
  readonly hasDraftCommitMessage: boolean
  readonly hasUpstream: boolean
  readonly mergeHeadSet: boolean
}

export type AutomationGuardResult =
  | { readonly safe: true }
  | { readonly safe: false; readonly reason: string }

export function canAutoCommitPush(
  state: IAutomationGuardState
): AutomationGuardResult {
  if (!state.tipIsValid) {
    return blocked('A local branch must be checked out.')
  }
  if (!state.hasChanges) {
    return blocked('There are no changes to commit.')
  }
  if (state.hasDraftCommitMessage) {
    return blocked('A draft commit message is present.')
  }
  return commonGuard(state)
}

export function canAutoPull(
  state: IAutomationGuardState
): AutomationGuardResult {
  if (!state.tipIsValid || !state.hasUpstream) {
    return blocked('The current branch has no upstream.')
  }
  if (state.hasChanges) {
    return blocked('The worktree is not clean.')
  }
  if (state.mergeHeadSet) {
    return blocked('A merge is already in progress.')
  }
  return commonGuard(state)
}

function commonGuard(state: IAutomationGuardState): AutomationGuardResult {
  if (state.hasConflict || state.hasMultiCommitOperation) {
    return blocked('A conflict or multi-commit operation is in progress.')
  }
  if (
    state.isCommitting ||
    state.isGeneratingCommitMessage ||
    state.isPushPullFetchInProgress ||
    state.isCheckingOut
  ) {
    return blocked('Another Git operation is in progress.')
  }
  return { safe: true }
}

function blocked(reason: string): AutomationGuardResult {
  return { safe: false, reason }
}
