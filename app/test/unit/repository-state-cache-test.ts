import { describe, it } from 'node:test'
import assert from 'node:assert'
import { RepositoryStateCache } from '../../src/lib/stores/repository-state-cache'
import { Repository } from '../../src/models/repository'
import { PullRequest } from '../../src/models/pull-request'
import { GitHubRepository } from '../../src/models/github-repository'
import {
  WorkingDirectoryStatus,
  WorkingDirectoryFileChange,
  AppFileStatusKind,
} from '../../src/models/status'
import { DiffSelection, DiffSelectionType } from '../../src/models/diff'
import {
  HistoryTabMode,
  IDisplayHistory,
  RepositorySectionTab,
} from '../../src/lib/app-state'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'
import { TestStatsStore } from '../helpers/test-stats-store'

function createSamplePullRequest(gitHubRepository: GitHubRepository) {
  return new PullRequest(
    new Date(),
    'something',
    1,
    {
      ref: 'refs/heads/master',
      sha: 'deadbeef',
      gitHubRepository,
    },
    {
      ref: 'refs/heads/my-cool-feature',
      sha: 'deadbeef',
      gitHubRepository,
    },
    'shiftkey',
    false,
    'something body'
  )
}

function withAccountKey(repository: Repository, accountKey: string | null) {
  return new Repository(
    repository.path,
    repository.id,
    repository.gitHubRepository,
    repository.missing,
    repository.alias,
    repository.workflowPreferences,
    repository.isTutorialRepository,
    repository.gitDir,
    accountKey
  )
}

describe('RepositoryStateCache', () => {
  it('can update branches state for a repository', () => {
    const repository = new Repository('/something/path', 1, null, false)
    const gitHubRepository = gitHubRepoFixture({
      name: 'desktop',
      owner: 'desktop',
    })
    const firstPullRequest = createSamplePullRequest(gitHubRepository)

    const cache = new RepositoryStateCache(new TestStatsStore())

    cache.updateBranchesState(repository, () => {
      return {
        openPullRequests: [firstPullRequest],
        isLoadingPullRequests: true,
      }
    })

    const { branchesState } = cache.get(repository)
    assert(branchesState.isLoadingPullRequests)
    assert.equal(branchesState.openPullRequests.length, 1)
  })

  it('can update changes state for a repository', () => {
    const repository = new Repository('/something/path', 1, null, false)
    const files = [
      new WorkingDirectoryFileChange(
        'README.md',
        { kind: AppFileStatusKind.New },
        DiffSelection.fromInitialSelection(DiffSelectionType.All)
      ),
    ]

    const summary = 'Hello world!'

    const cache = new RepositoryStateCache(new TestStatsStore())

    cache.updateChangesState(repository, () => {
      return {
        workingDirectory: WorkingDirectoryStatus.fromFiles(files),
        commitMessage: {
          summary,
          description: null,
          timestamp: Date.now(),
        },
        showCoAuthoredBy: true,
      }
    })

    const { changesState } = cache.get(repository)
    assert(changesState.workingDirectory.includeAll)
    assert.equal(changesState.workingDirectory.files.length, 1)
    assert(changesState.showCoAuthoredBy)
    assert.equal(changesState.commitMessage.summary, summary)
  })

  it('can update compare state for a repository', () => {
    const repository = new Repository('/something/path', 1, null, false)
    const filterText = 'my-cool-branch'

    const cache = new RepositoryStateCache(new TestStatsStore())

    cache.updateCompareState(repository, () => {
      const newState: IDisplayHistory = {
        kind: HistoryTabMode.History,
      }

      return {
        formState: newState,
        filterText,
        commitSHAs: ['deadbeef'],
      }
    })

    const { compareState } = cache.get(repository)
    assert.equal(compareState.formState.kind, HistoryTabMode.History)
    assert.equal(compareState.filterText, filterText)
    assert.equal(compareState.commitSHAs.length, 1)
  })

  it('keeps an account-rebound repository locked until the original operation settles', () => {
    const repository = new Repository('/something/path', 1, null, false)
    const reboundRepository = withAccountKey(
      repository,
      'https://api.github.com#42'
    )
    const cache = new RepositoryStateCache(new TestStatsStore())

    cache.update(repository, () => ({
      selectedSection: RepositorySectionTab.Triage,
      isPushPullFetchInProgress: true,
    }))

    cache.rekeyStateForAccountBinding(repository, reboundRepository)

    const lockedState = cache.get(reboundRepository)

    assert.notEqual(repository.hash, reboundRepository.hash)
    assert.strictEqual(cache.get(repository), lockedState)
    assert.equal(lockedState.selectedSection, RepositorySectionTab.Triage)
    assert.equal(lockedState.isPushPullFetchInProgress, true)

    cache.update(repository, () => ({
      isPushPullFetchInProgress: false,
    }))

    const settledState = cache.get(reboundRepository)
    assert.strictEqual(cache.get(repository), settledState)
    assert.equal(settledState.selectedSection, RepositorySectionTab.Triage)
    assert.equal(settledState.isPushPullFetchInProgress, false)
  })

  it('keeps one canonical state across repeated account rekeys', () => {
    const accountA = new Repository('/something/path', 1, null, false)
    const accountB = withAccountKey(accountA, 'https://api.github.com#42')
    const accountC = withAccountKey(accountA, 'https://api.github.com#84')
    const cache = new RepositoryStateCache(new TestStatsStore())

    cache.update(accountA, () => ({
      selectedSection: RepositorySectionTab.Triage,
      isCommitting: true,
    }))

    cache.rekeyStateForAccountBinding(accountA, accountB)
    cache.rekeyStateForAccountBinding(accountB, accountA)
    cache.rekeyStateForAccountBinding(accountA, accountC)

    const canonicalState = cache.get(accountC)
    assert.strictEqual(cache.get(accountA), canonicalState)
    assert.strictEqual(cache.get(accountB), canonicalState)
    assert.equal(canonicalState.selectedSection, RepositorySectionTab.Triage)
    assert.equal(canonicalState.isCommitting, true)

    cache.update(accountB, () => ({ isCommitting: false }))

    assert.strictEqual(cache.get(accountA), cache.get(accountC))
    assert.strictEqual(cache.get(accountB), cache.get(accountC))
    assert.equal(cache.get(accountC).isCommitting, false)

    cache.remove(accountC)

    assert.equal(cache.getIfPresent(accountA), undefined)
    assert.equal(cache.getIfPresent(accountB), undefined)
    assert.equal(cache.getIfPresent(accountC), undefined)
  })

  it('moves the entire cached state when a worktree path is renamed', () => {
    const repository = new Repository('/old/worktree/path', 1, null, false)
    const renamedRepository = new Repository(
      '/new/worktree/path',
      repository.id,
      repository.gitHubRepository,
      repository.missing,
      repository.alias,
      repository.workflowPreferences,
      repository.isTutorialRepository,
      repository.gitDir,
      repository.accountKey
    )
    const cache = new RepositoryStateCache(new TestStatsStore())

    cache.update(repository, () => ({
      selectedSection: RepositorySectionTab.History,
      isPushPullFetchInProgress: true,
    }))
    const sourceState = cache.get(repository)

    cache.transferState(repository, renamedRepository)

    assert.notEqual(repository.hash, renamedRepository.hash)
    assert.equal(cache.getIfPresent(repository), undefined)
    assert.strictEqual(cache.get(renamedRepository), sourceState)
    assert.equal(
      cache.get(renamedRepository).selectedSection,
      RepositorySectionTab.History
    )
    assert.equal(cache.get(renamedRepository).isPushPullFetchInProgress, true)
  })
})
