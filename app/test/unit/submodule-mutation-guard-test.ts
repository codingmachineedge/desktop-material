import assert from 'node:assert'
import { readFile } from 'fs/promises'
import { describe, it } from 'node:test'
import { join } from 'path'

function getMethodBody(source: string, methodName: string): string {
  const declaration = new RegExp(
    `^  (?:public|private)(?: async)? ${methodName}(?:<[^\\n]+>)?(?: =)?\\s*\\(`,
    'm'
  ).exec(source)
  assert.ok(declaration !== null, `Expected ${methodName} to exist`)
  const methodStart = declaration.index
  const parametersStart = source.indexOf('(', methodStart)
  let parameterDepth = 0
  let parametersEnd = -1
  for (let index = parametersStart; index < source.length; index++) {
    if (source[index] === '(') {
      parameterDepth += 1
    } else if (source[index] === ')') {
      parameterDepth -= 1
      if (parameterDepth === 0) {
        parametersEnd = index
        break
      }
    }
  }
  assert.notEqual(parametersEnd, -1, `Expected ${methodName} parameters to end`)

  let angleDepth = 0
  let bodyStart = -1
  for (let index = parametersEnd + 1; index < source.length; index++) {
    if (source[index] === '<') {
      angleDepth += 1
    } else if (source[index] === '>' && source[index - 1] !== '=') {
      angleDepth = Math.max(0, angleDepth - 1)
    } else if (source[index] === '{' && angleDepth === 0) {
      bodyStart = index
      break
    }
  }
  assert.notEqual(bodyStart, -1, `Expected ${methodName} to have a body`)

  let depth = 0
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') {
      depth += 1
    } else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(bodyStart, index + 1)
      }
    }
  }

  assert.fail(`Expected ${methodName} body to terminate`)
}

describe('temporary submodule mutation guard contract', () => {
  it('guards branch, tag, discard, stash, reset, merge, and rebase mutations', async () => {
    const source = await readFile(
      join(__dirname, '../../src/lib/stores/app-store.ts'),
      'utf8'
    )
    const methodsBySurface = {
      branch: ['_createBranch', '_renameBranch'],
      tag: ['_createTag', '_deleteTag'],
      discard: ['_discardChanges', '_discardChangesFromSelection'],
      stash: [
        '_createManagedStash',
        '_applyStashKeepingEntry',
        '_updateManagedStash',
        '_createBranchFromManagedStash',
        '_clearReviewedManagedStashes',
        'createStashEntry',
        'createSelectedFilesStash',
        '_popStashEntry',
        '_dropStashEntry',
      ],
      reset: ['_resetToCommit', '_undoMultiCommitOperation'],
      merge: ['_mergeBranch', '_abortMerge', '_finishConflictedMerge'],
      rebase: [
        '_rebase',
        '_abortRebase',
        '_continueRebase',
        '_reorderCommits',
        '_squash',
      ],
      remote: [
        '_setRemoteURL',
        '_addRemote',
        '_removeRemote',
        '_applyRemoteManagementPlan',
      ],
      revert: ['_revertCommit'],
      cherryPick: [
        '_cherryPick',
        '_checkoutBranchReturnName',
        '_abortCherryPick',
        '_continueCherryPick',
        '_clearCherryPickingHead',
        'checkoutBranchIfNotNull',
      ],
      appearance: ['_setRepositoryAppearanceOverrides'],
    } as const

    for (const [surface, methods] of Object.entries(methodsBySurface)) {
      for (const method of methods) {
        assert.match(
          getMethodBody(source, method),
          /withTemporaryRepositoryMutationGuard/,
          `${surface} mutation ${method} must use the last-boundary guard`
        )
      }
    }
  })

  it('guards every submodule and subtree mutator', async () => {
    const source = await readFile(
      join(__dirname, '../../src/lib/stores/app-store.ts'),
      'utf8'
    )
    const methods = [
      '_addSubmodule',
      '_updateSubmodules',
      '_syncSubmodules',
      '_removeSubmodule',
      '_setSubmoduleUrl',
      '_setSubmoduleBranch',
      '_setSubmoduleConfigKey',
      '_initSubmodule',
      '_deinitSubmodule',
      '_addSubtree',
      '_pullSubtree',
      '_pushSubtree',
      '_splitSubtree',
    ]

    for (const method of methods) {
      assert.match(
        getMethodBody(source, method),
        /withTemporaryRepositoryMutationGuard/,
        `${method} must use the last-boundary guard`
      )
    }
  })

  it('rejects temporary publishing before any hosted repository is created', async () => {
    const source = await readFile(
      join(__dirname, '../../src/lib/stores/app-store.ts'),
      'utf8'
    )
    const body = getMethodBody(source, '_publishRepository')
    const rejection = body.indexOf('isSubmoduleRepository(repository)')
    const hostedCreation = body.indexOf('api.createRepository(')

    assert.ok(rejection >= 0, 'publish must identify temporary repositories')
    assert.ok(hostedCreation >= 0, 'publish must retain hosted creation')
    assert.ok(
      rejection < hostedCreation,
      'temporary rejection must happen before hosted repository creation'
    )
    assert.match(body, /withTemporaryRepositoryMutationGuard/)
  })

  it('fences post-await cache and store writes after Back', async () => {
    const source = await readFile(
      join(__dirname, '../../src/lib/stores/app-store.ts'),
      'utf8'
    )
    for (const method of [
      'updateChangesWorkingDirectoryDiff',
      'withIsCommitting',
      'withIsGeneratingCommitMessage',
      'withPushPullFetch',
      '_updateManagedStash',
      '_clearReviewedManagedStashes',
      '_setCherryPickProgressFromState',
      '_executeCompare',
      'updateCompareToBranch',
      '_loadNextCommitBatch',
      '_loadChangedFilesForCurrentSelection',
      '_changeFileSelection',
      '_selectStashedFile',
      'updateChangesStashDiff',
      'refreshChangesSection',
      '_commitIncludedChanges',
      '_refreshRepositoryAfterCommit',
      '_generateCommitMessage',
      '_resolveConflictsWithCopilot',
      'gatherConflictResolutionContext',
      '_attemptCopilotConflictResolution',
      '_createManagedStash',
      'createSelectedFilesStash',
      '_startAmendingRepository',
      'onSuccessfulCheckout',
      'withRefreshedGitHubRepository',
      'onHookProgress',
      '_cherryPick',
      '_checkoutBranchReturnName',
      '_squash',
      '_undoMultiCommitOperation',
      '_mergeBranch',
    ]) {
      assert.match(
        getMethodBody(source, method),
        /isTemporaryRepositoryActive/,
        `${method} must fence stale temporary completions`
      )
    }
  })

  it('revalidates every network and direct worktree mutation boundary', async () => {
    const source = await readFile(
      join(__dirname, '../../src/lib/stores/app-store.ts'),
      'utf8'
    )
    const minimumGuardCalls = new Map<string, number>([
      ['performPush', 2],
      ['performPull', 2],
      ['performFetch', 2],
      ['fastForwardBranches', 1],
      ['_fetchRepositoryShallowHistory', 1],
      ['_fetchRefspec', 1],
      ['_addWorktree', 1],
      ['_pinFileToRelease', 1],
      ['_materializeCheapLfsPointer', 1],
      ['runCheapLfsMaterialize', 1],
    ])

    for (const [method, minimum] of minimumGuardCalls) {
      const guardCalls =
        getMethodBody(source, method).match(
          /withTemporaryRepositoryMutationGuard/g
        )?.length ?? 0
      assert.ok(
        guardCalls >= minimum,
        `${method} must retain at least ${minimum} last-boundary guard call(s)`
      )
    }
  })

  it('aborts temporary controllers and fences merge-all teardown', async () => {
    const source = await readFile(
      join(__dirname, '../../src/lib/stores/app-store.ts'),
      'utf8'
    )
    const dispose = getMethodBody(source, 'disposeTemporaryRepositoryState')
    assert.match(dispose, /commitMessageGenerationAbortController\?\.abort/)
    assert.match(dispose, /copilotResolutionAbortController\?\.abort/)
    assert.match(dispose, /mergeAllControllers\?\.get/)
    assert.match(dispose, /cheapLfsMaterializeControllers\?\.get/)

    assert.match(
      getMethodBody(source, 'updateMergeAllState'),
      /isTemporaryRepositoryActive/
    )
    assert.match(
      getMethodBody(source, '_mergeAllIntoDefaultBranch'),
      /isTemporaryRepositoryActive/
    )
  })

  it('closes temporary child side-effect escape surfaces', async () => {
    const [app, dispatcher, addWorktreeDialog, sparseCheckout] =
      await Promise.all([
        readFile(join(__dirname, '../../src/ui/app.tsx'), 'utf8'),
        readFile(
          join(__dirname, '../../src/ui/dispatcher/dispatcher.ts'),
          'utf8'
        ),
        readFile(
          join(__dirname, '../../src/ui/worktrees/add-worktree-dialog.tsx'),
          'utf8'
        ),
        readFile(
          join(__dirname, '../../src/ui/sparse-checkout/sparse-checkout.tsx'),
          'utf8'
        ),
      ])

    for (const method of [
      'showCreateWorktree',
      'showSparseCheckout',
      'buildAndRun',
      'openRepositoryInNewWindow',
      'openInShell',
      'openInExternalEditor',
      'renderBuildRunToolbarButton',
      'renderBuildRunPanel',
    ]) {
      assert.match(
        getMethodBody(app, method),
        /SubmoduleRepository/,
        `${method} must reject temporary repositories`
      )
    }

    for (const method of [
      'startBuildRun',
      'runOpencodeFix',
      'runOpencodePrompt',
    ]) {
      assert.match(
        getMethodBody(dispatcher, method),
        /SubmoduleRepository/,
        `${method} must reject temporary repositories`
      )
    }
    assert.match(addWorktreeDialog, /dispatcher\.addWorktree/)
    assert.doesNotMatch(addWorktreeDialog, /await addWorktree\(/)
    assert.match(sparseCheckout, /repository instanceof SubmoduleRepository/)
  })
})
