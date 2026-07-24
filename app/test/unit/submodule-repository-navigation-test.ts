import assert from 'node:assert'
import { beforeEach, describe, it } from 'node:test'
import { join, normalize, resolve } from 'node:path'

import { AppStore } from '../../src/lib/stores/app-store'
import {
  Repository,
  SubmoduleRepository,
  isSubmoduleRepository,
} from '../../src/models/repository'
import { TutorialStep } from '../../src/models/tutorial-step'
import { defaultBuildRunPreferences } from '../../src/models/build-run-preferences'
import { getSubmodules } from '../../src/lib/git'
import {
  getTagsToPush,
  storeTagsToPush,
} from '../../src/lib/stores/helpers/tags-to-push-storage'
import { setupFixtureRepository } from '../helpers/repositories'

const LastSelectedRepositoryIDKey = 'last-selected-repository-id'
const RecentRepositoriesKey = 'recently-selected-repositories'

function managedSubmodule(path: string, name = path) {
  return {
    name,
    path,
    url: 'https://example.invalid/child.git',
    branch: null,
    update: null,
    ignore: null,
    shallow: null,
    fetchRecurseSubmodules: null,
    sha: '0123456789012345678901234567890123456789',
    describe: null,
    topology: 'valid' as const,
    status: 'up-to-date' as const,
  }
}

function createSelectionStore(parent: Repository): AppStore {
  const store = Object.create(AppStore.prototype) as AppStore
  Object.assign(store, {
    repositories: [parent],
    selectedRepository: parent,
    currentOnboardingTutorialStep: TutorialStep.NotApplicable,
    repositoryAppearanceOverrides: {},
    localRepositoryStateLookup: new Map<number, unknown>(),
    gitStoreCache: { remove: () => undefined },
    repositoryStateCache: { remove: () => undefined },
    notificationsStore: {
      selectRepository: () => undefined,
      setRecentRepositories: () => undefined,
    },
    maybePromoteAccountForRepository: () => undefined,
    emitUpdate: () => undefined,
    emitError: () => undefined,
    stopBackgroundFetching: () => undefined,
    stopAutomationScheduler: () => undefined,
    stopPullRequestUpdater: () => undefined,
    stopBackgroundPruner: () => undefined,
    _clearBanner: () => undefined,
    recoverMissingRepository: async (repository: Repository) => repository,
    updateBranchProtectionsFromAPI: () => undefined,
    _selectRepositoryRefreshTasks: async (repository: Repository) => repository,
  })
  return store
}

function selectedRepository(store: AppStore): Repository | null {
  return Reflect.get(store, 'selectedRepository') as Repository | null
}

describe('temporary submodule repository navigation', () => {
  beforeEach(() => localStorage.clear())

  it('keeps nested Back navigation anchored to the persisted root', () => {
    const root = new Repository('C:/work/main', 17, null, false)
    const first = new SubmoduleRepository(
      'C:/work/main/vendor/first',
      'C:/work/main/.git/modules/vendor/first',
      root,
      managedSubmodule('vendor/first')
    )
    const nested = new SubmoduleRepository(
      'C:/work/main/vendor/first/vendor/second',
      'C:/work/main/.git/modules/vendor/first/modules/vendor/second',
      first,
      managedSubmodule('vendor/second')
    )

    assert.ok(isSubmoduleRepository(first))
    assert.ok(isSubmoduleRepository(nested))
    assert.equal(nested.containingRepository, first)
    assert.equal(nested.parentRepository, root)
    assert.notEqual(nested.id, first.id)
    assert.ok(nested.id < 0)
  })

  it('does not inherit automatic, elevated, or overridden build commands', () => {
    const root = new Repository(
      'C:/work/main',
      117,
      null,
      false,
      null,
      {},
      false,
      undefined,
      null,
      {
        elevated: true,
        autoRunAfterBuild: true,
        autoIgnoreBuildOutputs: true,
        autoBuildOnPull: true,
        opencodeAutoApprove: true,
        overrides: {
          custom: { build: 'parent-only-command --unsafe-for-child' },
        },
      }
    )
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )

    assert.deepEqual(temporary.buildRunPreferences, defaultBuildRunPreferences)
    assert.notEqual(temporary.buildRunPreferences, root.buildRunPreferences)
  })

  it('opens without adding or persisting the temporary repository', async t => {
    const rootPath = await setupFixtureRepository(t, 'submodule-basic-setup')
    const root = new Repository(rootPath, 18, null, false)
    const [submodule] = await getSubmodules(root)
    const store = createSelectionStore(root)
    localStorage.setItem(LastSelectedRepositoryIDKey, String(root.id))
    localStorage.setItem(RecentRepositoriesKey, '91,92')

    const opened = await store._openSubmoduleAsRepository(root, submodule)

    assert.ok(opened instanceof SubmoduleRepository)
    assert.equal(selectedRepository(store), opened)
    assert.deepEqual(Reflect.get(store, 'repositories'), [root])
    assert.equal(localStorage.getItem(LastSelectedRepositoryIDKey), '18')
    assert.equal(localStorage.getItem(RecentRepositoriesKey), '91,92')
  })

  it('opens an absolute diff path through the temporary viewer boundary', async t => {
    const rootPath = await setupFixtureRepository(t, 'submodule-basic-setup')
    const root = new Repository(rootPath, 180, null, false)
    const [submodule] = await getSubmodules(root)
    const store = createSelectionStore(root)
    localStorage.setItem(LastSelectedRepositoryIDKey, String(root.id))
    localStorage.setItem(RecentRepositoriesKey, '81,82')

    const opened = await store._openSubmodulePathAsRepository(
      root,
      join(rootPath, submodule.path)
    )

    assert.ok(opened instanceof SubmoduleRepository)
    assert.equal(selectedRepository(store), opened)
    assert.deepEqual(Reflect.get(store, 'repositories'), [root])
    assert.equal(localStorage.getItem(LastSelectedRepositoryIDKey), '180')
    assert.equal(localStorage.getItem(RecentRepositoriesKey), '81,82')
  })

  it('rejects relative and unrelated diff paths before temporary navigation', async t => {
    const rootPath = await setupFixtureRepository(t, 'submodule-basic-setup')
    const root = new Repository(rootPath, 182, null, false)
    const store = createSelectionStore(root)

    await assert.rejects(
      store._openSubmodulePathAsRepository(root, 'relative/submodule'),
      /not absolute/
    )
    await assert.rejects(
      store._openSubmodulePathAsRepository(
        root,
        join(rootPath, 'not-declared')
      ),
      /no longer a declared submodule/
    )
    assert.equal(selectedRepository(store), root)
    assert.deepEqual(Reflect.get(store, 'repositories'), [root])
  })

  it('rebinds a metadata-refreshed selected parent without persisting a child', async t => {
    const rootPath = await setupFixtureRepository(t, 'submodule-basic-setup')
    const staleParent = new Repository(rootPath, 181, null, false)
    const refreshedParent = new Repository(
      rootPath,
      181,
      null,
      false,
      null,
      {},
      false,
      join(rootPath, '.git')
    )
    const [submodule] = await getSubmodules(staleParent)
    const store = createSelectionStore(staleParent)
    Reflect.set(store, 'repositories', [refreshedParent])

    const opened = await store._openSubmoduleAsRepository(
      staleParent,
      submodule
    )

    assert.ok(opened instanceof SubmoduleRepository)
    assert.equal(opened.parentRepository, refreshedParent)
    assert.equal(selectedRepository(store), opened)
    assert.deepEqual(Reflect.get(store, 'repositories'), [refreshedParent])
  })

  it('ordinary selection and Back both resolve to the saved root', async () => {
    const root = new Repository('C:/work/main', 19, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )
    const store = createSelectionStore(root)
    localStorage.setItem(LastSelectedRepositoryIDKey, String(root.id))
    localStorage.setItem(RecentRepositoriesKey, '93')

    await store._selectRepository(temporary, true, true)
    assert.equal(selectedRepository(store), temporary)
    assert.equal(localStorage.getItem(LastSelectedRepositoryIDKey), '19')
    assert.equal(localStorage.getItem(RecentRepositoriesKey), '93')

    const returned = await store._returnToParentRepository(temporary)
    assert.equal(returned, root)
    assert.equal(selectedRepository(store), root)
    assert.equal(localStorage.getItem(LastSelectedRepositoryIDKey), '19')
    assert.equal(localStorage.getItem(RecentRepositoriesKey), '93')

    await store._selectRepository(temporary)
    assert.equal(selectedRepository(store), root)
    assert.equal(localStorage.getItem(LastSelectedRepositoryIDKey), '19')
    assert.equal(localStorage.getItem(RecentRepositoriesKey), '93')
  })

  it('stays in the child when saved-repository metadata updates', () => {
    const root = new Repository('C:/work/main', 119, null, false)
    const refreshedRoot = new Repository('C:/work/main', 119, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )
    const store = createSelectionStore(root)
    Reflect.set(store, 'selectedRepository', temporary)
    Reflect.set(store, 'repositories', [refreshedRoot])

    const updateSelection = Reflect.get(
      store,
      'updateRepositorySelectionAfterRepositoriesChanged'
    ) as () => void
    updateSelection.call(store)

    assert.equal(selectedRepository(store), temporary)
  })

  it('clears temporary caches on repository-dropdown style exits', async () => {
    const root = new Repository('C:/work/main', 124, null, false)
    const other = new Repository('C:/work/other', 125, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )
    const store = createSelectionStore(root)
    const gitRemoved = new Array<Repository>()
    const stateRemoved = new Array<Repository>()
    const localState = new Map<number, unknown>([[temporary.id, {}]])
    Object.assign(store, {
      repositories: [root, other],
      selectedRepository: temporary,
      localRepositoryStateLookup: localState,
      gitStoreCache: {
        remove: (repository: Repository) => gitRemoved.push(repository),
      },
      repositoryStateCache: {
        remove: (repository: Repository) => stateRemoved.push(repository),
      },
    })

    await store._selectRepository(other)

    assert.deepEqual(gitRemoved, [temporary])
    assert.deepEqual(stateRemoved, [temporary])
    assert.equal(localState.has(temporary.id), false)
  })

  it('bypasses hosted association refreshes for temporary repositories', async () => {
    const root = new Repository('C:/work/main', 120, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )
    const store = createSelectionStore(root)
    Reflect.set(store, 'selectedRepository', temporary)
    let refreshCalls = 0
    Reflect.set(store, 'repositoryWithRefreshedGitHubRepository', async () => {
      refreshCalls += 1
      return root
    })
    Reflect.set(store, 'assertTemporaryRepositoryIsSafe', async () => undefined)
    const run = Reflect.get(store, 'withRefreshedGitHubRepository') as <T>(
      repository: Repository,
      fn: (repository: Repository) => Promise<T>
    ) => Promise<T>

    const result = await run.call(
      store,
      temporary,
      async repository => repository
    )

    assert.equal(result, temporary)
    assert.equal(refreshCalls, 0)
  })

  it('revalidates and requires selection at the mutation boundary', async () => {
    const root = new Repository('C:/work/main', 127, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )
    const store = createSelectionStore(root)
    Reflect.set(store, 'selectedRepository', temporary)
    let validations = 0
    let mutations = 0
    Reflect.set(store, 'assertTemporaryRepositoryIsSafe', async () => {
      validations += 1
      Reflect.set(store, 'selectedRepository', root)
    })
    const mutate = Reflect.get(
      store,
      'withTemporaryRepositoryMutationGuard'
    ) as <T>(repository: Repository, mutation: () => Promise<T>) => Promise<T>

    await assert.rejects(
      mutate.call(store, temporary, async () => ++mutations),
      /no longer selected/
    )
    assert.equal(validations, 1)
    assert.equal(mutations, 0)

    const result = await mutate.call(store, root, async () => ++mutations)
    assert.equal(result, 1)
    assert.equal(validations, 1)
  })

  it('awaits the temporary initial refresh and observes a concurrent Back', async () => {
    const root = new Repository('C:/work/main', 128, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )
    const store = createSelectionStore(root)
    Reflect.set(store, 'selectedRepository', temporary)
    let releaseRefresh: (() => void) | undefined
    let settled = false
    Reflect.set(
      store,
      '_refreshRepository',
      () =>
        new Promise<void>(resolve => {
          releaseRefresh = resolve
        })
    )
    const refreshSelection = Reflect.get(
      AppStore.prototype,
      '_selectRepositoryRefreshTasks'
    ) as (
      repository: Repository,
      previous: Repository | null
    ) => Promise<Repository | null>

    const result = refreshSelection.call(store, temporary, root).then(value => {
      settled = true
      return value
    })
    await Promise.resolve()
    assert.equal(settled, false)

    Reflect.set(store, 'selectedRepository', root)
    assert.ok(releaseRefresh !== undefined)
    releaseRefresh()

    assert.equal(await result, null)
    assert.equal(settled, true)
  })

  it('ignores late GitStore updates after the temporary selection exits', () => {
    const root = new Repository('C:/work/main', 129, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )
    const reopened = new SubmoduleRepository(
      temporary.path,
      temporary.resolvedGitDir,
      root,
      temporary.submodule
    )
    const store = createSelectionStore(root)
    Reflect.set(store, 'selectedRepository', reopened)
    let stateReads = 0
    Reflect.set(store, 'repositoryStateCache', {
      get: () => {
        stateReads += 1
        throw new Error('A stale temporary update read repository state')
      },
    })
    const onGitStoreUpdated = Reflect.get(store, 'onGitStoreUpdated') as (
      repository: Repository,
      gitStore: unknown
    ) => void

    onGitStoreUpdated.call(store, temporary, {})

    assert.equal(stateReads, 0)
  })

  it('does not recreate disposed state from async finally paths after Back', async () => {
    const root = new Repository('C:/work/main', 130, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )
    const store = createSelectionStore(root)
    Reflect.set(store, 'selectedRepository', temporary)
    let updates = 0
    Reflect.set(store, 'repositoryStateCache', {
      get: () => ({
        isCommitting: false,
        isPushPullFetchInProgress: false,
      }),
      update: () => {
        updates += 1
      },
    })

    let finishCommit: ((value: boolean) => void) | undefined
    const withIsCommitting = Reflect.get(store, 'withIsCommitting') as (
      repository: Repository,
      action: () => Promise<boolean>
    ) => Promise<boolean>
    const committing = withIsCommitting.call(
      store,
      temporary,
      () =>
        new Promise<boolean>(resolve => {
          finishCommit = resolve
        })
    )
    await Promise.resolve()
    assert.equal(updates, 1)
    Reflect.set(store, 'selectedRepository', root)
    assert.ok(finishCommit !== undefined)
    finishCommit(true)
    assert.equal(await committing, true)
    assert.equal(updates, 1)

    Reflect.set(store, 'selectedRepository', temporary)
    Reflect.set(
      store,
      'withTemporaryRepositoryMutationGuard',
      async <T>(_repository: Repository, action: () => Promise<T>) => action()
    )
    let finishNetwork: (() => void) | undefined
    const withPushPullFetch = Reflect.get(store, 'withPushPullFetch') as (
      repository: Repository,
      action: () => Promise<void>
    ) => Promise<void>
    const network = withPushPullFetch.call(
      store,
      temporary,
      () =>
        new Promise<void>(resolve => {
          finishNetwork = resolve
        })
    )
    await Promise.resolve()
    assert.equal(updates, 2)
    Reflect.set(store, 'selectedRepository', root)
    assert.ok(finishNetwork !== undefined)
    finishNetwork()
    await network
    assert.equal(updates, 2)

    let recreatedStores = 0
    Reflect.set(store, 'selectedRepository', temporary)
    Reflect.set(store, 'gitStoreCache', {
      get: () => {
        recreatedStores += 1
        throw new Error('Disposed GitStore was recreated')
      },
    })
    Reflect.set(store, 'withTemporaryRepositoryMutationGuard', async <T>() => {
      Reflect.set(store, 'selectedRepository', root)
      return 1 as T
    })

    assert.equal(
      await store._clearReviewedManagedStashes(temporary, ['a'.repeat(40)]),
      1
    )
    assert.equal(recreatedStores, 0)
  })

  it('aborts temporary operations and ignores late merge-all state', () => {
    const root = new Repository('C:/work/main', 131, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )
    const store = createSelectionStore(root)
    Reflect.set(store, 'selectedRepository', temporary)
    const commitMessage = new AbortController()
    const copilot = new AbortController()
    const mergeAll = new AbortController()
    const cheapLfs = new AbortController()
    let stateReads = 0
    Reflect.set(store, 'repositoryStateCache', {
      getIfPresent: () => ({
        commitMessageGenerationAbortController: commitMessage,
        multiCommitOperationState: {
          copilotResolutionAbortController: copilot,
        },
      }),
      get: () => {
        stateReads += 1
        throw new Error('Disposed merge-all state was recreated')
      },
      remove: () => undefined,
    })
    Reflect.set(
      store,
      'mergeAllControllers',
      new Map([[temporary.id, mergeAll]])
    )
    // Owners are keyed by the canonical checkout path and hold owner records,
    // matching disposeTemporaryRepositoryState's real lookup.
    const cheapLfsKey =
      process.platform === 'win32'
        ? normalize(resolve(temporary.path)).toLowerCase()
        : normalize(resolve(temporary.path))
    Reflect.set(
      store,
      'cheapLfsMaterializeOwners',
      new Map([
        [
          cheapLfsKey,
          new Set([{ controller: cheapLfs, requestSignal: undefined }]),
        ],
      ])
    )

    const dispose = Reflect.get(store, 'disposeTemporaryRepositoryState') as (
      repository: SubmoduleRepository
    ) => void
    dispose.call(store, temporary)

    assert.equal(commitMessage.signal.aborted, true)
    assert.equal(copilot.signal.aborted, true)
    assert.equal(mergeAll.signal.aborted, true)
    assert.equal(cheapLfs.signal.aborted, true)
    assert.equal(
      (Reflect.get(store, 'mergeAllControllers') as Map<number, unknown>).size,
      0
    )
    assert.equal(
      (Reflect.get(store, 'cheapLfsMaterializeOwners') as Map<string, unknown>)
        .size,
      0
    )

    Reflect.set(store, 'selectedRepository', root)
    const updateMergeAllState = Reflect.get(store, 'updateMergeAllState') as (
      repository: Repository,
      update: unknown
    ) => void
    updateMergeAllState.call(store, temporary, { phase: 'cancelled' })
    assert.equal(stateReads, 0)
  })

  it('rejects persisted worktree navigation before filesystem mutation', async () => {
    const root = new Repository('C:/work/main', 121, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )
    const store = createSelectionStore(root)

    await assert.rejects(
      store._switchWorktree(temporary, {
        path: temporary.path,
        head: '0123456789012345678901234567890123456789',
        branch: 'refs/heads/main',
        isDetached: false,
        type: 'main',
        isLocked: false,
        isPrunable: false,
      }),
      /unavailable while a submodule is open temporarily/
    )
    await assert.rejects(
      store._moveWorktree(
        temporary,
        temporary.path,
        'C:/work/main/vendor/moved-child'
      ),
      /unavailable while a submodule is open temporarily/
    )
  })

  it('maps persisted notification actions back to the saved root', () => {
    const root = new Repository('C:/work/main', 122, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )
    const posted = new Array<unknown>()
    const store = createSelectionStore(root)
    Reflect.set(store, 'selectedRepository', temporary)
    Reflect.set(store, 'notificationCentreStore', {
      post: async (input: unknown) => {
        posted.push(input)
      },
    })

    store.postNotification({
      kind: 'info',
      title: 'Child operation complete',
      body: 'The child remains temporary.',
      repositoryId: temporary.id,
      action: { kind: 'open-repository', repositoryId: temporary.id },
    })

    assert.deepEqual(posted, [
      {
        kind: 'info',
        title: 'Child operation complete',
        body: 'The child remains temporary.',
        repositoryId: root.id,
        action: { kind: 'open-repository', repositoryId: root.id },
      },
    ])
  })

  it('keeps pending tag state out of localStorage', () => {
    const root = new Repository('C:/work/main', 123, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )

    storeTagsToPush(temporary, ['v1.0.0'])

    assert.deepEqual(getTagsToPush(temporary), [])
    assert.equal(localStorage.length, 0)
  })

  it('never restarts background automation for a temporary child', () => {
    const root = new Repository('C:/work/main', 126, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )
    const store = createSelectionStore(root)
    Reflect.set(store, 'selectedRepository', temporary)
    let starts = 0
    Reflect.set(store, 'startAutomationScheduler', () => {
      starts += 1
    })
    const restart = Reflect.get(
      store,
      'restartAutomationScheduler'
    ) as () => void

    restart.call(store)

    assert.equal(starts, 0)
  })

  it('rejects stale open and Back requests', async () => {
    const root = new Repository('C:/work/main', 20, null, false)
    const other = new Repository('C:/work/other', 21, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )
    const store = createSelectionStore(root)
    Reflect.set(store, 'selectedRepository', other)

    await assert.rejects(
      store._openSubmoduleAsRepository(root, temporary.submodule),
      /selection changed/
    )
    await assert.rejects(
      store._returnToParentRepository(temporary),
      /no longer selected/
    )
  })

  it('blocks removal before a temporary checkout can be trashed', async () => {
    const root = new Repository('C:/work/main', 22, null, false)
    const temporary = new SubmoduleRepository(
      'C:/work/main/vendor/child',
      'C:/work/main/.git/modules/vendor/child',
      root,
      managedSubmodule('vendor/child')
    )
    const errors = new Array<Error>()
    let removeCalls = 0
    const store = createSelectionStore(root)
    Object.assign(store, {
      emitError: (error: Error) => errors.push(error),
      repositoriesStore: {
        removeRepository: () => {
          removeCalls += 1
        },
      },
    })

    await store._removeRepository(temporary, true)

    assert.equal(removeCalls, 0)
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /open temporarily/)
  })
})
