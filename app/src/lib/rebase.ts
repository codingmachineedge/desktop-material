import { IBranchesState, IRepositoryState } from '../lib/app-state'
import { Branch, IAheadBehind } from '../models/branch'
import {
  MultiCommitOperationKind,
  MultiCommitOperationStepKind,
} from '../models/multi-commit-operation'
import { TipState } from '../models/tip'
import { clamp } from './clamp'

/** Represents the force-push availability state of a branch. */
export enum ForcePushBranchState {
  /** The branch cannot be force-pushed (it hasn't diverged from its upstream) */
  NotAvailable,

  /**
   * The branch can be force-pushed, but the user didn't do any operation that
   * we consider should be followed by a force-push, like rebasing or amending a
   * pushed commit.
   */
  Available,

  /**
   * The branch can be force-pushed, and the user did some operation that we
   * consider should be followed by a force-push, like rebasing or amending a
   * pushed commit.
   */
  Recommended,
}

const DirtyRebaseMessage =
  'Rebase requires a clean working directory. Commit or stash your changes, then try again.'
const OngoingRebaseMessage =
  'Another repository operation is still in progress. Finish or abort it before starting a rebase.'

function getRebaseCommonSafetyReason(state: IRepositoryState): string | null {
  const { changesState, branchesState } = state
  if (branchesState.tip.kind !== TipState.Valid) {
    return 'Check out a local branch before starting a rebase.'
  }
  if (changesState.conflictState !== null) {
    return OngoingRebaseMessage
  }
  if (changesState.workingDirectory.files.length > 0) {
    return DirtyRebaseMessage
  }
  if (
    state.isPushPullFetchInProgress ||
    state.checkoutProgress !== null ||
    state.isCommitting ||
    state.isGeneratingCommitMessage ||
    state.oneClickCommitPushPhase != null ||
    state.revertProgress != null ||
    (state.mergeAllState?.phase !== undefined &&
      state.mergeAllState.phase !== 'complete' &&
      state.mergeAllState.phase !== 'cancelled')
  ) {
    return 'Wait for the current repository task to finish before starting a rebase.'
  }
  return null
}

/**
 * Validate the mutable repository state before opening the reviewed rebase
 * flow. A branch-choice step may be replaced when the user switches between
 * Merge, Squash, and Rebase in the shared dialog; an operation that has moved
 * beyond branch choice must never be overwritten.
 */
export function getRebaseLaunchBlockingReason(
  state: IRepositoryState
): string | null {
  const commonReason = getRebaseCommonSafetyReason(state)
  if (commonReason !== null) {
    return commonReason
  }
  const { multiCommitOperationState } = state
  if (
    multiCommitOperationState !== null &&
    multiCommitOperationState.step.kind !==
      MultiCommitOperationStepKind.ChooseBranch
  ) {
    return OngoingRebaseMessage
  }
  return null
}

/**
 * Revalidate the exact current and base branches immediately before Git is
 * invoked. This turns a branch switch, deletion, or new tip observed while the
 * confirmation was open into a safe retry instead of rebasing stale refs.
 */
export function getRebaseStartBlockingReason(
  state: IRepositoryState,
  expectedCurrentBranch: Branch,
  expectedBaseBranch: Branch
): string | null {
  const commonReason = getRebaseCommonSafetyReason(state)
  if (commonReason !== null) {
    return commonReason
  }

  const operation = state.multiCommitOperationState
  if (
    operation === null ||
    operation.operationDetail.kind !== MultiCommitOperationKind.Rebase ||
    (operation.step.kind !== MultiCommitOperationStepKind.ChooseBranch &&
      operation.step.kind !== MultiCommitOperationStepKind.WarnForcePush)
  ) {
    return OngoingRebaseMessage
  }

  const tip = state.branchesState.tip
  if (
    tip.kind !== TipState.Valid ||
    tip.branch.ref !== expectedCurrentBranch.ref ||
    tip.branch.tip.sha !== expectedCurrentBranch.tip.sha ||
    tip.branch.upstream !== expectedCurrentBranch.upstream ||
    operation.targetBranch === null ||
    operation.targetBranch.ref !== expectedCurrentBranch.ref ||
    operation.targetBranch.tip.sha !== expectedCurrentBranch.tip.sha ||
    operation.originalBranchTip !== expectedCurrentBranch.tip.sha
  ) {
    return 'The current branch changed while the rebase dialog was open. Review the updated branches and try again.'
  }

  const currentBase = state.branchesState.allBranches.find(
    branch => branch.ref === expectedBaseBranch.ref
  )
  if (
    currentBase === undefined ||
    currentBase.tip.sha !== expectedBaseBranch.tip.sha
  ) {
    return 'The selected base branch changed while the rebase dialog was open. Review its latest commits and try again.'
  }

  if (operation.step.kind === MultiCommitOperationStepKind.WarnForcePush) {
    const reviewedBase = operation.operationDetail.sourceBranch
    if (
      reviewedBase === null ||
      reviewedBase.ref !== expectedBaseBranch.ref ||
      reviewedBase.tip.sha !== expectedBaseBranch.tip.sha
    ) {
      return 'The selected base branch changed while the rebase dialog was open. Review its latest commits and try again.'
    }
  }

  return null
}

/**
 * Format rebase percentage to ensure it's a value between 0 and 1, but to also
 * constrain it to two significant figures, avoiding the remainder that comes
 * with floating point division.
 */
export function formatRebaseValue(value: number) {
  return Math.round(clamp(value, 0, 1) * 100) / 100
}

/**
 * Check application state to see whether the action applied to the current
 * branch should be a force push
 */
export function getCurrentBranchForcePushState(
  branchesState: IBranchesState,
  aheadBehind: IAheadBehind | null
): ForcePushBranchState {
  if (aheadBehind === null) {
    // no tracking branch found
    return ForcePushBranchState.NotAvailable
  }

  const { ahead, behind } = aheadBehind

  if (behind === 0 || ahead === 0) {
    // no a diverged branch to force push
    return ForcePushBranchState.NotAvailable
  }

  const { tip, forcePushBranches } = branchesState

  let canForcePushBranch = false
  if (tip.kind === TipState.Valid) {
    const localBranchName = tip.branch.nameWithoutRemote
    const { sha } = tip.branch.tip
    const foundEntry = forcePushBranches.get(localBranchName)
    canForcePushBranch = foundEntry === sha
  }

  return canForcePushBranch
    ? ForcePushBranchState.Recommended
    : ForcePushBranchState.Available
}
