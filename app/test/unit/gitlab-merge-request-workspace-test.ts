import assert from 'node:assert'
import { describe, it } from 'node:test'
import { Account, getAccountKey } from '../../src/models/account'
import { Branch, BranchType } from '../../src/models/branch'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { PullRequest, PullRequestRef } from '../../src/models/pull-request'
import { Repository } from '../../src/models/repository'
import {
  buildGitLabMergeRequestBranchContext,
  buildGitLabMergeRequestManageBranchContext,
  getGitLabMergeRequestWorkspaceRoute,
  getGitLabMergeRequestManageVersion,
  getGitLabMergeRequestWorkspaceVersion,
  getPullRequestBrowserURL,
  getPullRequestCreationBrowserURL,
  getPullRequestInteractionRoute,
  getPullRequestProviderForRepository,
} from '../../src/lib/gitlab-merge-request-workspace'

const endpoint = 'https://gitlab.example.test/api/v4'

function account(id: number, provider: Account['provider'] = 'gitlab') {
  return new Account(
    `user-${id}`,
    endpoint,
    `token-${id}`,
    [],
    '',
    id,
    `User ${id}`,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    provider
  )
}

function repository(selected: Account) {
  const hosted = new GitHubRepository(
    'material',
    new Owner('group/subgroup', endpoint, 77),
    77,
    false,
    'https://gitlab.example.test/group/subgroup/material'
  )
  return new Repository(
    'C:\\work\\material',
    7,
    hosted,
    false,
    null,
    {},
    false,
    undefined,
    getAccountKey(selected)
  )
}

function localBranch(name: string, upstream: string | null, sha: string) {
  return new Branch(
    name,
    upstream,
    { sha },
    BranchType.Local,
    `refs/heads/${name}`
  )
}

function remoteBranch(name: string, sha: string) {
  return new Branch(
    `origin/${name}`,
    null,
    { sha },
    BranchType.Remote,
    `refs/remotes/origin/${name}`
  )
}

describe('GitLab merge request workspace routing', () => {
  it('uses only the exact repository-bound account on a shared endpoint', () => {
    const first = account(1)
    const selected = account(2)
    const repo = repository(selected)
    for (const accounts of [
      [first, selected],
      [selected, first],
    ]) {
      assert.equal(
        getPullRequestProviderForRepository(repo, accounts),
        'gitlab'
      )
      assert.deepEqual(getGitLabMergeRequestWorkspaceRoute(repo, accounts), {
        repositoryId: '7',
        accountKey: getAccountKey(selected),
        accountUserId: 2,
        accountLogin: 'user-2',
        accountDisplayName: 'User 2',
        friendlyEndpoint: 'GitLab · gitlab.example.test',
        providerHTMLURL: 'https://gitlab.example.test',
        projectPath: 'group/subgroup/material',
      })
    }
    assert.equal(getGitLabMergeRequestWorkspaceRoute(repo, [first]), null)
  })

  it('keeps GitHub and Bitbucket on their provider routes', () => {
    const github = account(3, 'github')
    const bitbucket = account(4, 'bitbucket')
    assert.equal(
      getPullRequestProviderForRepository(repository(github), [github]),
      'github'
    )
    assert.equal(
      getPullRequestProviderForRepository(repository(bitbucket), [bitbucket]),
      'bitbucket'
    )
    assert.equal(
      getPullRequestInteractionRoute(repository(github), [github]),
      'github-native'
    )
    assert.equal(
      getPullRequestInteractionRoute(repository(bitbucket), [bitbucket]),
      'provider-browser'
    )
  })

  it('uses native GitLab only for same-project review requests', () => {
    const selected = account(2)
    const sameProject = repository(selected)
    assert.equal(
      getPullRequestInteractionRoute(sameProject, [selected]),
      'gitlab-native'
    )

    const parent = sameProject.gitHubRepository
    assert.notEqual(parent, null)
    const forkHosted = new GitHubRepository(
      'material-fork',
      new Owner('contributor', endpoint, 88),
      88,
      false,
      'https://gitlab.example.test/contributor/material-fork',
      null,
      null,
      null,
      null,
      parent
    )
    const fork = new Repository(
      'C:\\work\\material-fork',
      8,
      forkHosted,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(selected)
    )
    assert.equal(
      getPullRequestInteractionRoute(fork, [selected]),
      'provider-browser'
    )
  })

  it('fails closed for an unbound repository with ambiguous accounts', () => {
    const first = account(1)
    const second = account(2)
    const bound = repository(second)
    const unbound = new Repository(
      bound.path,
      bound.id,
      bound.gitHubRepository,
      false
    )
    assert.equal(
      getPullRequestProviderForRepository(unbound, [first, second]),
      null
    )
    assert.equal(getPullRequestInteractionRoute(unbound, [first, second]), null)
    assert.equal(
      getGitLabMergeRequestWorkspaceRoute(unbound, [first, second]),
      null
    )
    assert.equal(
      getPullRequestProviderForRepository(unbound, [second]),
      'gitlab'
    )
  })

  it('fails provider routing closed when an explicit account binding targets another host', () => {
    const selected = account(2)
    const mismatchedHosted = new GitHubRepository(
      'material',
      new Owner('group/subgroup', 'https://other.example.test/api/v4', 77),
      77
    )
    const mismatched = new Repository(
      'C:\\work\\material',
      7,
      mismatchedHosted,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(selected)
    )
    assert.equal(
      getPullRequestProviderForRepository(mismatched, [selected]),
      null
    )
    assert.equal(
      getGitLabMergeRequestWorkspaceRoute(mismatched, [selected]),
      null
    )
  })

  it('derives source and target branches from the exact configured remote', () => {
    const topic = localBranch('topic', 'origin/topic', 'a'.repeat(40))
    const main = remoteBranch('main', 'b'.repeat(40))
    const release = remoteBranch('release', 'c'.repeat(40))
    const other = new Branch(
      'upstream/private',
      null,
      { sha: 'd'.repeat(40) },
      BranchType.Remote,
      'refs/remotes/upstream/private'
    )
    assert.deepEqual(
      buildGitLabMergeRequestBranchContext(
        topic,
        [topic, release, main, other],
        main,
        'origin',
        release
      ),
      {
        sourceBranch: 'topic',
        targetBranches: ['release', 'main'],
        initialTargetBranch: 'release',
      }
    )
    assert.equal(
      buildGitLabMergeRequestBranchContext(
        localBranch('unpublished', null, 'e'.repeat(40)),
        [main],
        main,
        'origin'
      ).sourceBranch,
      null
    )
    assert.deepEqual(
      buildGitLabMergeRequestManageBranchContext(
        [topic, release, main, other],
        main,
        'origin'
      ),
      {
        sourceBranch: null,
        targetBranches: ['main', 'topic', 'release'],
        initialTargetBranch: 'main',
      }
    )
  })

  it('versions account, project, branch, and remote identity together', () => {
    const selected = account(2)
    const repo = repository(selected)
    const branch = localBranch('topic', 'origin/topic', 'a'.repeat(40))
    const route = getGitLabMergeRequestWorkspaceRoute(repo, [selected])!
    const first = getGitLabMergeRequestWorkspaceVersion(
      repo,
      branch,
      { name: 'origin', url: 'https://gitlab.example.test/group/material.git' },
      route
    )
    const changed = getGitLabMergeRequestWorkspaceVersion(
      repo,
      localBranch('topic', 'origin/topic', 'b'.repeat(40)),
      { name: 'origin', url: 'https://gitlab.example.test/group/material.git' },
      route
    )
    assert.notEqual(first, changed)
    assert.notEqual(
      getGitLabMergeRequestManageVersion(repo, route, 7),
      getGitLabMergeRequestManageVersion(repo, route, 8)
    )
  })

  it('constructs GitLab browser URLs and rejects a mismatched account', () => {
    const selected = account(2)
    const repo = repository(selected)
    const hosted = repo.gitHubRepository!
    const pullRequest = new PullRequest(
      new Date('2026-07-20T10:00:00Z'),
      'Review',
      42,
      new PullRequestRef('topic', 'a'.repeat(40), hosted),
      new PullRequestRef('main', 'b'.repeat(40), hosted),
      'author',
      false,
      'Body'
    )
    assert.equal(
      getPullRequestBrowserURL(repo, [selected], pullRequest),
      'https://gitlab.example.test/group/subgroup/material/-/merge_requests/42'
    )
    assert.equal(
      getPullRequestBrowserURL(repo, [account(1)], pullRequest),
      null
    )

    const refreshedTarget = new GitHubRepository(
      'material',
      new Owner('group/subgroup', endpoint, 999),
      999,
      true,
      'https://gitlab.example.test/group/subgroup/material',
      null,
      true,
      false,
      'admin'
    )
    const refreshedPullRequest = new PullRequest(
      pullRequest.created,
      pullRequest.title,
      pullRequest.pullRequestNumber,
      pullRequest.head,
      new PullRequestRef('main', 'b'.repeat(40), refreshedTarget),
      pullRequest.author,
      pullRequest.draft,
      pullRequest.body
    )
    assert.equal(
      getPullRequestBrowserURL(repo, [selected], refreshedPullRequest),
      'https://gitlab.example.test/group/subgroup/material/-/merge_requests/42'
    )

    const otherProject = new GitHubRepository(
      'other-project',
      new Owner('group/subgroup', endpoint, 88),
      88
    )
    const mispairedPullRequest = new PullRequest(
      pullRequest.created,
      pullRequest.title,
      pullRequest.pullRequestNumber,
      pullRequest.head,
      new PullRequestRef('main', 'b'.repeat(40), otherProject),
      pullRequest.author,
      pullRequest.draft,
      pullRequest.body
    )
    assert.equal(
      getPullRequestBrowserURL(repo, [selected], mispairedPullRequest),
      null
    )
  })

  it('constructs provider composers from exact account origins, not persisted HTML URLs', () => {
    const selected = account(2)
    const hosted = new GitHubRepository(
      'material',
      new Owner('group/subgroup', endpoint, 77),
      77,
      false,
      'https://attacker.invalid/redirect'
    )
    const gitlab = new Repository(
      'C:\\work\\material',
      7,
      hosted,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(selected)
    )
    assert.equal(
      getPullRequestCreationBrowserURL(gitlab, [selected]),
      'https://gitlab.example.test/group/subgroup/material/-/merge_requests/new'
    )

    const bitbucketEndpoint = 'https://api.bitbucket.org/2.0'
    const bitbucket = new Account(
      'workspace',
      bitbucketEndpoint,
      'token-bitbucket',
      [],
      '',
      9,
      'Workspace',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'bitbucket'
    )
    const bitbucketHosted = new GitHubRepository(
      'material',
      new Owner('workspace', bitbucketEndpoint, 9),
      9,
      false,
      'https://attacker.invalid/redirect'
    )
    const bitbucketRepository = new Repository(
      'C:\\work\\bitbucket-material',
      9,
      bitbucketHosted,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(bitbucket)
    )
    assert.equal(
      getPullRequestCreationBrowserURL(bitbucketRepository, [bitbucket]),
      'https://bitbucket.org/workspace/material/pull-requests/new'
    )
    assert.equal(
      getPullRequestCreationBrowserURL(bitbucketRepository, [selected]),
      null
    )
  })
})
