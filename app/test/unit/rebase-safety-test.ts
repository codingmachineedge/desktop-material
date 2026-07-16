import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  getRebaseLaunchBlockingReason,
  getRebaseStartBlockingReason,
} from '../../src/lib/rebase'
import { IRepositoryState } from '../../src/lib/app-state'
import { Branch, BranchType } from '../../src/models/branch'
import {
  MultiCommitOperationKind,
  MultiCommitOperationStepKind,
} from '../../src/models/multi-commit-operation'
import { TipState } from '../../src/models/tip'

const currentBranch = new Branch(
  'feature',
  'origin/feature',
  { sha: 'current-sha' },
  BranchType.Local,
  'refs/heads/feature'
)
const baseBranch = new Branch(
  'main',
  'origin/main',
  { sha: 'base-sha' },
  BranchType.Local,
  'refs/heads/main'
)

function state(
  overrides: {
    readonly files?: ReadonlyArray<unknown>
    readonly conflictState?: unknown
    readonly tip?: unknown
    readonly allBranches?: ReadonlyArray<Branch>
    readonly operationStep?: MultiCommitOperationStepKind | null
    readonly operationTarget?: Branch | null
    readonly operationBase?: Branch | null
    readonly originalBranchTip?: string | null
    readonly isPushPullFetchInProgress?: boolean
    readonly isGeneratingCommitMessage?: boolean
    readonly oneClickCommitPushPhase?: 'generating' | 'committing' | 'pushing'
    readonly revertProgress?: unknown
    readonly mergeAllPhase?: 'preparing' | 'complete' | 'cancelled'
  } = {}
): IRepositoryState {
  const operationStep =
    overrides.operationStep === undefined
      ? MultiCommitOperationStepKind.ChooseBranch
      : overrides.operationStep
  return {
    branchesState: {
      tip: overrides.tip ?? { kind: TipState.Valid, branch: currentBranch },
      allBranches: overrides.allBranches ?? [currentBranch, baseBranch],
    },
    changesState: {
      workingDirectory: { files: overrides.files ?? [] },
      conflictState: overrides.conflictState ?? null,
    },
    multiCommitOperationState:
      operationStep === null
        ? null
        : {
            operationDetail: {
              kind: MultiCommitOperationKind.Rebase,
              sourceBranch:
                operationStep === MultiCommitOperationStepKind.WarnForcePush
                  ? overrides.operationBase ?? baseBranch
                  : null,
            },
            step: { kind: operationStep },
            targetBranch:
              overrides.operationTarget === undefined
                ? currentBranch
                : overrides.operationTarget,
            originalBranchTip:
              overrides.originalBranchTip === undefined
                ? currentBranch.tip.sha
                : overrides.originalBranchTip,
          },
    isPushPullFetchInProgress: overrides.isPushPullFetchInProgress ?? false,
    checkoutProgress: null,
    isCommitting: false,
    isGeneratingCommitMessage: overrides.isGeneratingCommitMessage ?? false,
    oneClickCommitPushPhase: overrides.oneClickCommitPushPhase ?? null,
    revertProgress: overrides.revertProgress ?? null,
    mergeAllState:
      overrides.mergeAllPhase === undefined
        ? null
        : { phase: overrides.mergeAllPhase },
  } as unknown as IRepositoryState
}

describe('rebase safety validation', () => {
  it('allows a clean branch-choice flow and exact unchanged refs', () => {
    const snapshot = state()
    assert.equal(getRebaseLaunchBlockingReason(snapshot), null)
    assert.equal(
      getRebaseStartBlockingReason(snapshot, currentBranch, baseBranch),
      null
    )
  })

  it('blocks unsafe dirty state and in-progress operations', () => {
    assert.match(
      getRebaseLaunchBlockingReason(state({ files: [{}] })) ?? '',
      /clean working directory/i
    )
    assert.match(
      getRebaseLaunchBlockingReason(
        state({ operationStep: MultiCommitOperationStepKind.ShowProgress })
      ) ?? '',
      /operation is still in progress/i
    )
    assert.match(
      getRebaseLaunchBlockingReason(
        state({ conflictState: { kind: 'rebase' } })
      ) ?? '',
      /operation is still in progress/i
    )
    assert.match(
      getRebaseLaunchBlockingReason(
        state({ isPushPullFetchInProgress: true })
      ) ?? '',
      /current repository task/i
    )

    for (const busyState of [
      state({ isGeneratingCommitMessage: true }),
      state({ oneClickCommitPushPhase: 'pushing' }),
      state({ revertProgress: {} }),
      state({ mergeAllPhase: 'preparing' }),
    ]) {
      assert.match(
        getRebaseLaunchBlockingReason(busyState) ?? '',
        /current repository task/i
      )
    }

    assert.equal(
      getRebaseLaunchBlockingReason(state({ mergeAllPhase: 'complete' })),
      null
    )
  })

  it('rejects a current branch that changed after preview', () => {
    const changed = new Branch(
      currentBranch.name,
      currentBranch.upstream,
      { sha: 'new-current-sha' },
      currentBranch.type,
      currentBranch.ref
    )
    const reason = getRebaseStartBlockingReason(
      state({ tip: { kind: TipState.Valid, branch: changed } }),
      currentBranch,
      baseBranch
    )
    assert.match(reason ?? '', /current branch changed/i)
  })

  it('rejects changed upstream and reviewed-target identities', () => {
    const changedUpstream = new Branch(
      currentBranch.name,
      'different/current-upstream',
      currentBranch.tip,
      currentBranch.type,
      currentBranch.ref
    )
    assert.match(
      getRebaseStartBlockingReason(
        state({ tip: { kind: TipState.Valid, branch: changedUpstream } }),
        currentBranch,
        baseBranch
      ) ?? '',
      /current branch changed/i
    )

    assert.match(
      getRebaseStartBlockingReason(
        state({ operationTarget: baseBranch }),
        currentBranch,
        baseBranch
      ) ?? '',
      /current branch changed/i
    )
  })

  it('rejects a base branch that moved or disappeared after preview', () => {
    const changedBase = new Branch(
      baseBranch.name,
      baseBranch.upstream,
      { sha: 'new-base-sha' },
      baseBranch.type,
      baseBranch.ref
    )
    const reason = getRebaseStartBlockingReason(
      state({ allBranches: [currentBranch, changedBase] }),
      currentBranch,
      baseBranch
    )
    assert.match(reason ?? '', /selected base branch changed/i)
  })

  it('requires the reviewed rebase operation identity at submit time', () => {
    const reason = getRebaseStartBlockingReason(
      state({ operationStep: null }),
      currentBranch,
      baseBranch
    )
    assert.match(reason ?? '', /operation is still in progress/i)

    const unrelatedBase = new Branch(
      'release',
      'origin/release',
      { sha: 'release-sha' },
      BranchType.Local,
      'refs/heads/release'
    )
    const warningReason = getRebaseStartBlockingReason(
      state({
        operationStep: MultiCommitOperationStepKind.WarnForcePush,
        operationBase: unrelatedBase,
      }),
      currentBranch,
      baseBranch
    )
    assert.match(warningReason ?? '', /selected base branch changed/i)
  })
})
