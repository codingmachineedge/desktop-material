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

  it('preserves only durable view state when account binding changes identity', () => {
    const repository = new Repository('/something/path', 1, null, false)
    const reboundRepository = new Repository(
      repository.path,
      repository.id,
      repository.gitHubRepository,
      repository.missing,
      repository.alias,
      repository.workflowPreferences,
      repository.isTutorialRepository,
      repository.gitDir,
      'https://api.github.com#42'
    )
    const cache = new RepositoryStateCache(new TestStatsStore())

    cache.update(repository, () => ({
      selectedSection: RepositorySectionTab.Triage,
      isPushPullFetchInProgress: true,
    }))
    const sourceState = cache.get(repository)

    cache.preserveAccountBindingState(repository, reboundRepository)

    const reboundState = cache.get(reboundRepository)

    assert.notEqual(repository.hash, reboundRepository.hash)
    assert.strictEqual(cache.getIfPresent(repository), sourceState)
    assert.notStrictEqual(reboundState, sourceState)
    assert.equal(reboundState.selectedSection, RepositorySectionTab.Triage)
    assert.equal(reboundState.isPushPullFetchInProgress, false)
    assert.equal(sourceState.isPushPullFetchInProgress, true)
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
