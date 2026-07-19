import { describe, it } from 'node:test'
import assert from 'node:assert'
import { groupRepositories } from '../../src/ui/repositories-list/group-repositories'
import { Repository, ILocalRepositoryState } from '../../src/models/repository'
import { CloningRepository } from '../../src/models/cloning-repository'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'
import {
  ShowBranchNameInRepoListSetting,
  shouldShowBranchName,
} from '../../src/models/show-branch-name-in-repo-list'
import {
  Account,
  AccountProvider,
  getAccountKey,
} from '../../src/models/account'
import {
  accountFilterFor,
  filterRepositoryGroups,
  repositoryService,
  RepositoryStatusFilter,
} from '../../src/ui/repositories-list/repository-list-filters'

const makeAccount = (
  login: string,
  endpoint: string,
  id: number,
  provider: AccountProvider
) =>
  new Account(
    login,
    endpoint,
    'token',
    [],
    '',
    id,
    '',
    'free',
    undefined,
    undefined,
    undefined,
    undefined,
    provider
  )

describe('repository list grouping', () => {
  const repositories: Array<Repository | CloningRepository> = [
    new Repository('repo1', 1, null, false),
    new Repository(
      'repo2',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'my-repo2' }),
      false
    ),
    new Repository(
      'repo3',
      3,
      gitHubRepoFixture({
        owner: '',
        name: 'my-repo3',
        endpoint: 'https://github.big-corp.com/api/v3',
      }),
      false
    ),
  ]

  const cache = new Map<number, ILocalRepositoryState>()

  it('applies the repository branch display preference', () => {
    assert.equal(
      shouldShowBranchName(
        ShowBranchNameInRepoListSetting.Always,
        'main',
        'main'
      ),
      true
    )
    assert.equal(
      shouldShowBranchName(
        ShowBranchNameInRepoListSetting.WhenNotDefault,
        'main',
        'main'
      ),
      false
    )
    assert.equal(
      shouldShowBranchName(
        ShowBranchNameInRepoListSetting.WhenNotDefault,
        'feature',
        'main'
      ),
      true
    )
    assert.equal(
      shouldShowBranchName(
        ShowBranchNameInRepoListSetting.Never,
        'feature',
        'main'
      ),
      false
    )
  })

  it('groups repositories by owners/Enterprise/Other', () => {
    const grouped = groupRepositories(repositories, cache, [])
    assert.equal(grouped.length, 3)

    assert.equal(grouped[0].identifier.kind, 'dotcom')
    assert.equal((grouped[0].identifier as any).owner.login, 'me')
    assert.equal(grouped[0].items.length, 1)

    let item = grouped[0].items[0]
    assert.equal(item.repository.path, 'repo2')

    assert.equal(grouped[1].identifier.kind, 'enterprise')
    assert.equal(grouped[1].items.length, 1)

    item = grouped[1].items[0]
    assert.equal(item.repository.path, 'repo3')

    assert.equal(grouped[2].identifier.kind, 'other')
    assert.equal(grouped[2].items.length, 1)

    item = grouped[2].items[0]
    assert.equal(item.repository.path, 'repo1')
  })

  it('sorts repositories alphabetically within each group', () => {
    const repoA = new Repository('a', 1, null, false)
    const repoB = new Repository(
      'b',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'b' }),
      false
    )
    const repoC = new Repository('c', 2, null, false)
    const repoD = new Repository(
      'd',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'd' }),
      false
    )
    const repoZ = new Repository('z', 3, null, false)

    const grouped = groupRepositories(
      [repoC, repoB, repoZ, repoD, repoA],
      cache,
      []
    )
    assert.equal(grouped.length, 2)

    assert.equal(grouped[0].identifier.kind, 'dotcom')
    assert.equal((grouped[0].identifier as any).owner.login, 'me')
    assert.equal(grouped[0].items.length, 2)

    let items = grouped[0].items
    assert.equal(items[0].repository.path, 'b')
    assert.equal(items[1].repository.path, 'd')

    assert.equal(grouped[1].identifier.kind, 'other')
    assert.equal(grouped[1].items.length, 3)

    items = grouped[1].items
    assert.equal(items[0].repository.path, 'a')
    assert.equal(items[1].repository.path, 'c')
    assert.equal(items[2].repository.path, 'z')
  })

  it('only disambiguates Enterprise repositories', () => {
    const repoA = new Repository(
      'repo',
      1,
      gitHubRepoFixture({ owner: 'user1', name: 'repo' }),
      false
    )
    const repoB = new Repository(
      'repo',
      2,
      gitHubRepoFixture({ owner: 'user2', name: 'repo' }),
      false
    )
    const repoC = new Repository(
      'enterprise-repo',
      3,
      gitHubRepoFixture({
        owner: 'business',
        name: 'enterprise-repo',
        endpoint: 'https://ghe.io/api/v3',
      }),
      false
    )
    const repoD = new Repository(
      'enterprise-repo',
      3,
      gitHubRepoFixture({
        owner: 'silliness',
        name: 'enterprise-repo',
        endpoint: 'https://ghe.io/api/v3',
      }),
      false
    )

    const grouped = groupRepositories([repoA, repoB, repoC, repoD], cache, [])
    assert.equal(grouped.length, 3)

    assert.equal(grouped[0].identifier.kind, 'dotcom')
    assert.equal((grouped[0].identifier as any).owner.login, 'user1')
    assert.equal(grouped[0].items.length, 1)

    assert.equal(grouped[1].identifier.kind, 'dotcom')
    assert.equal((grouped[1].identifier as any).owner.login, 'user2')
    assert.equal(grouped[1].items.length, 1)

    assert.equal(grouped[2].identifier.kind, 'enterprise')
    assert.equal(grouped[2].items.length, 2)

    assert.equal(grouped[0].items[0].text[0], 'repo')
    assert(!grouped[0].items[0].needsDisambiguation)

    assert.equal(grouped[1].items[0].text[0], 'repo')
    assert(!grouped[1].items[0].needsDisambiguation)

    assert.equal(grouped[2].items[0].text[0], 'enterprise-repo')
    assert(grouped[2].items[0].needsDisambiguation)

    assert.equal(grouped[2].items[1].text[0], 'enterprise-repo')
    assert(grouped[2].items[1].needsDisambiguation)
  })

  it('omits the Recent group when the preference is disabled', () => {
    const manyRepositories = Array.from(
      { length: 8 },
      (_, index) => new Repository(`repo-${index}`, index + 1, null, false)
    )

    const visible = groupRepositories(manyRepositories, cache, [1, 2], true)
    assert(visible.some(group => group.identifier.kind === 'recent'))

    const hidden = groupRepositories(manyRepositories, cache, [1, 2], false)
    assert(!hidden.some(group => group.identifier.kind === 'recent'))
  })

  it('places pinned repositories in a dedicated first group', () => {
    const pinned = groupRepositories(repositories, cache, [], true, [2])
    assert.equal(pinned[0].identifier.kind, 'pinned')
    assert.deepEqual(
      pinned[0].items.map(item => item.repository.id),
      [2]
    )
  })

  it('combines repositories from different hosts in a custom group', () => {
    const customLocal = new Repository(
      'custom-local',
      10,
      null,
      false,
      null,
      {},
      false,
      undefined,
      null,
      undefined,
      'Clients'
    )
    const customGitHub = new Repository(
      'custom-github',
      11,
      gitHubRepoFixture({ owner: 'octocat', name: 'custom-github' }),
      false,
      null,
      {},
      false,
      undefined,
      null,
      undefined,
      'Clients'
    )
    const grouped = groupRepositories([customGitHub, customLocal], cache, [])

    assert.equal(grouped.length, 1)
    assert.equal(grouped[0].identifier.kind, 'custom')
    assert.equal((grouped[0].identifier as any).name, 'Clients')
    assert.deepEqual(
      grouped[0].items.map(item => item.repository.id),
      [11, 10]
    )
  })

  it('filters grouped rows by exact account and service with AND semantics', () => {
    const endpoint = 'https://api.github.example'
    const first = makeAccount('first', endpoint, 10, 'github')
    const second = makeAccount('second', endpoint, 20, 'github')
    const gitlab = makeAccount(
      'gitlab-user',
      'https://gitlab.example/api/v4',
      30,
      'gitlab'
    )
    const firstRepo = new Repository(
      'first',
      101,
      gitHubRepoFixture({ endpoint, owner: 'team', name: 'first' }),
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(first)
    )
    const secondRepo = new Repository(
      'second',
      102,
      gitHubRepoFixture({ endpoint, owner: 'team', name: 'second' }),
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(second)
    )
    const gitlabRepo = new Repository(
      'gitlab',
      103,
      gitHubRepoFixture({
        endpoint: gitlab.endpoint,
        owner: 'team',
        name: 'gitlab',
      }),
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(gitlab)
    )
    const local = new Repository('local', 104, null, false)
    const groups = groupRepositories(
      [firstRepo, secondRepo, gitlabRepo, local],
      cache,
      []
    )
    const accounts = [first, second, gitlab]

    const firstOnly = filterRepositoryGroups(
      groups,
      accounts,
      accountFilterFor(first),
      'github'
    )
    assert.deepEqual(
      firstOnly.flatMap(group => group.items.map(item => item.repository.id)),
      [firstRepo.id]
    )
    assert.equal(
      filterRepositoryGroups(
        groups,
        accounts,
        accountFilterFor(gitlab),
        'github'
      ).length,
      0
    )
    assert.deepEqual(
      filterRepositoryGroups(groups, accounts, 'all', 'local').flatMap(group =>
        group.items.map(item => item.repository.id)
      ),
      [local.id]
    )
  })

  it('classifies stale hosted bindings as unknown without guessing the provider', () => {
    const staleGitLab = new Repository(
      'stale-gitlab',
      201,
      gitHubRepoFixture({
        endpoint: 'https://gitlab.example/api/v4',
        owner: 'team',
        name: 'stale-gitlab',
      }),
      false,
      null,
      {},
      false,
      undefined,
      'missing-account'
    )
    const cloning = new CloningRepository(
      '/tmp/cloning',
      'https://bitbucket.example/team/cloning.git'
    )
    const bitbucket = makeAccount(
      'bb-user',
      'https://bitbucket.example/api/2.0',
      40,
      'bitbucket'
    )
    cloning.accountKey = getAccountKey(bitbucket)

    assert.equal(repositoryService(staleGitLab, []), 'unknown')
    assert.equal(repositoryService(cloning, [bitbucket]), 'bitbucket')
  })

  it('filters after full grouping so pinned and recent duplicates stay coherent', () => {
    const account = makeAccount(
      'octocat',
      'https://api.github.com',
      50,
      'github'
    )
    const hosted = new Repository(
      'hosted',
      301,
      gitHubRepoFixture({ owner: 'octocat', name: 'hosted' }),
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(account)
    )
    const locals = Array.from(
      { length: 7 },
      (_, index) => new Repository(`local-${index}`, 400 + index, null, false)
    )
    const fullGroups = groupRepositories(
      [hosted, ...locals],
      cache,
      [hosted.id],
      true,
      [hosted.id]
    )
    const filtered = filterRepositoryGroups(
      fullGroups,
      [account],
      'all',
      'github'
    )

    assert.deepEqual(
      filtered.map(group => group.identifier.kind),
      ['pinned', 'recent', 'dotcom']
    )
    assert.ok(
      filtered.every(group => group.items[0].repository.id === hosted.id)
    )
  })

  it('combines status filters with persisted visibility without regrouping', () => {
    const clean = new Repository('clean', 501, null, false)
    const changed = new Repository('changed', 502, null, false)
    const ahead = new Repository('ahead', 503, null, false)
    const behind = new Repository('behind', 504, null, false)
    const missing = new Repository('missing', 505, null, true)
    const cloning = new CloningRepository(
      '/tmp/cloning-status',
      'https://example.test/cloning-status.git'
    )
    const state = new Map<number, ILocalRepositoryState>([
      [
        clean.id,
        {
          aheadBehind: { ahead: 0, behind: 0 },
          changedFilesCount: 0,
          branchName: 'main',
          defaultBranchName: 'main',
        },
      ],
      [
        changed.id,
        {
          aheadBehind: { ahead: 0, behind: 0 },
          changedFilesCount: 2,
          branchName: 'main',
          defaultBranchName: 'main',
        },
      ],
      [
        ahead.id,
        {
          aheadBehind: { ahead: 2, behind: 0 },
          changedFilesCount: 0,
          branchName: 'main',
          defaultBranchName: 'main',
        },
      ],
      [
        behind.id,
        {
          aheadBehind: { ahead: 0, behind: 3 },
          changedFilesCount: 0,
          branchName: 'main',
          defaultBranchName: 'main',
        },
      ],
    ])
    const groups = groupRepositories(
      [clean, changed, ahead, behind, missing, cloning],
      state,
      [],
      true,
      [ahead.id]
    )
    const idsFor = (
      statusFilters: ReadonlyArray<RepositoryStatusFilter>,
      showHiddenRepositories = false
    ) =>
      filterRepositoryGroups(groups, [], 'all', 'all', {
        statusFilters,
        hiddenRepositoryIds: [ahead.id],
        showHiddenRepositories,
      }).flatMap(group => group.items.map(item => item.repository.id))

    assert.deepEqual(idsFor(['changed']), [changed.id])
    assert.deepEqual(idsFor(['ahead']), [])
    assert.deepEqual(idsFor(['ahead'], true), [ahead.id, ahead.id])
    assert.deepEqual(idsFor(['behind']), [behind.id])
    assert.deepEqual(
      new Set(idsFor(['clean'], true)),
      new Set([clean.id, ahead.id, behind.id])
    )
    assert.deepEqual(
      new Set(idsFor(['missing-or-cloning'])),
      new Set([missing.id, cloning.id])
    )
    assert.deepEqual(
      new Set(idsFor(['changed', 'behind'])),
      new Set([changed.id, behind.id])
    )
  })
})
