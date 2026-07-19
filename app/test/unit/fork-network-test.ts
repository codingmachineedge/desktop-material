import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  assertCheckoutPlanSelection,
  createForkNetworkBranchCatalog,
  createForkNetworkCatalog,
  ForkBranchCheckoutError,
  getForkNetworkRepositoryIdentity,
  IForkBranchCheckoutPlan,
  suggestedForkLocalBranchName,
} from '../../src/lib/fork-network'
import { IAPIForkNetworkBranch, IAPIFullRepository } from '../../src/lib/api'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { Repository } from '../../src/models/repository'
import {
  forkNetworkBranchFixture,
  forkNetworkRepositoryFixture,
  forkNetworkRootFixture,
} from '../helpers/fork-network-fixtures'

const rootAPIRepository = forkNetworkRootFixture()

function fork(
  owner: string,
  overrides: Partial<IAPIFullRepository> = {}
): IAPIFullRepository {
  return forkNetworkRepositoryFixture(owner, overrides)
}

function branch(name: string, sha = 'a'.repeat(40)): IAPIForkNetworkBranch {
  return forkNetworkBranchFixture(name, sha)
}

function repository(): Repository {
  const root = new GitHubRepository(
    'project',
    new Owner('upstream', 'https://api.github.com', 1),
    1,
    false,
    rootAPIRepository.html_url,
    rootAPIRepository.clone_url
  )
  const ownFork = new GitHubRepository(
    'project',
    new Owner('me', 'https://api.github.com', 2),
    2,
    false,
    'https://github.com/me/project',
    'https://github.com/me/project.git',
    true,
    false,
    'write',
    root
  )
  return new Repository('C:\\work\\project', 9, ownFork, false)
}

describe('fork network review models', () => {
  it('filters the current fork, duplicate identities, and unsafe API URLs', () => {
    const repo = repository()
    const catalog = createForkNetworkCatalog(repo, {
      items: [
        fork('me'),
        fork('alice'),
        fork('alice'),
        fork('mallory', {
          clone_url: 'https://user:secret@github.com/mallory/project.git',
        }),
        fork('outside', {
          clone_url: 'https://git.example.test/outside/project.git',
          html_url: 'https://git.example.test/outside/project',
        }),
      ],
      truncated: true,
    })

    assert.deepEqual(
      catalog.forks.map(item => item.id),
      ['alice/project']
    )
    assert.equal(catalog.rejectedCount, 2)
    assert.equal(catalog.truncated, true)
    assert.match(catalog.snapshotToken, /^[a-f0-9]{64}$/)
    assert.equal(
      catalog.repositoryIdentity,
      getForkNetworkRepositoryIdentity(repo)
    )
    assert.equal(JSON.stringify(catalog).includes('secret'), false)
  })

  it('bounds branch identities to safe names and full object IDs', () => {
    const repo = repository()
    const network = createForkNetworkCatalog(repo, {
      items: [fork('alice')],
      truncated: false,
    })
    const catalog = createForkNetworkBranchCatalog(
      repo,
      network.forks[0],
      fork('alice'),
      {
        items: [
          branch('feature/one'),
          branch('../unsafe'),
          branch('short-sha', 'abc'),
        ],
        truncated: false,
      }
    )

    assert.equal(catalog.branches.length, 1)
    assert.equal(catalog.branches[0].name, 'feature/one')
    assert.equal(catalog.rejectedCount, 2)
    assert.equal(
      suggestedForkLocalBranchName('alice', 'feature/one'),
      'fork/alice/feature/one'
    )
  })

  it('rejects a moved head and changed repository context before mutation', () => {
    const repo = repository()
    const network = createForkNetworkCatalog(repo, {
      items: [fork('alice')],
      truncated: false,
    })
    const branches = createForkNetworkBranchCatalog(
      repo,
      network.forks[0],
      fork('alice'),
      { items: [branch('feature')], truncated: false }
    )
    const selected = branches.branches[0]
    const plan: IForkBranchCheckoutPlan = {
      repositoryIdentity: branches.repositoryIdentity,
      rootOwner: branches.rootOwner,
      rootName: branches.rootName,
      fork: branches.fork,
      branch: selected,
      branchCatalogToken: branches.snapshotToken,
      localBranchName: 'fork/alice/feature',
      remoteName: 'github-desktop-alice',
      remoteRef: 'refs/remotes/github-desktop-alice/feature',
      expectedRemoteInventoryToken: 'b'.repeat(64),
      remoteWillBeCreated: true,
      reviewToken: 'c'.repeat(64),
    }

    assert.throws(
      () =>
        assertCheckoutPlanSelection(
          repo,
          plan,
          fork('alice'),
          branch('feature', 'd'.repeat(40))
        ),
      (error: unknown) =>
        error instanceof ForkBranchCheckoutError &&
        error.code === 'branch-moved'
    )

    const movedRepository = new Repository(
      'C:\\work\\different',
      repo.id,
      repo.gitHubRepository,
      false
    )
    assert.throws(
      () =>
        assertCheckoutPlanSelection(
          movedRepository,
          plan,
          fork('alice'),
          branch('feature')
        ),
      (error: unknown) =>
        error instanceof ForkBranchCheckoutError &&
        error.code === 'repository-context-changed'
    )
  })
})
