import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  buildGitHubPullRequestTargets,
  getGitHubPullRequestContextVersion,
  getGitHubPullRequestCreationError,
  getGitHubPullRequestCreationURL,
  getGitHubPullRequestHead,
  GitHubPullRequestBodyMaximumLength,
  GitHubPullRequestTitleMaximumLength,
  normalizeGitHubPullRequestDraft,
  validateCreatedGitHubPullRequest,
  validateGitHubPullRequestBranch,
} from '../../src/lib/github-pull-request'
import { APIError } from '../../src/lib/http'
import { Branch, BranchType } from '../../src/models/branch'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { Repository } from '../../src/models/repository'

const endpoint = 'https://api.github.com'

function createGitHubRepository(
  owner: string,
  name: string,
  htmlURL: string,
  parent: GitHubRepository | null = null
) {
  return new GitHubRepository(
    name,
    new Owner(owner, endpoint, owner.length),
    name.length,
    false,
    htmlURL,
    `${htmlURL}.git`,
    true,
    false,
    'write',
    parent
  )
}

function createBranch(
  name: string,
  upstream: string | null,
  sha: string = 'a'.repeat(40)
) {
  return new Branch(
    name,
    upstream,
    { sha },
    BranchType.Local,
    `refs/heads/${name}`
  )
}

function createRemoteBranch(remote: string, name: string) {
  return new Branch(
    `${remote}/${name}`,
    null,
    { sha: 'c'.repeat(40) },
    BranchType.Remote,
    `refs/remotes/${remote}/${name}`
  )
}

describe('GitHub pull request validation', () => {
  it('normalizes only title whitespace and preserves the reviewed payload', () => {
    assert.deepEqual(
      normalizeGitHubPullRequestDraft(
        '  Native PR  ',
        ' body\n',
        'octocat:feature/native',
        'main',
        true
      ),
      {
        title: 'Native PR',
        body: ' body\n',
        head: 'octocat:feature/native',
        base: 'main',
        draft: true,
      }
    )
  })

  it('rejects empty, oversized, ambiguous, and same-repository identical refs', () => {
    assert.throws(() =>
      normalizeGitHubPullRequestDraft(' ', '', 'feature', 'main', false)
    )
    assert.throws(() =>
      normalizeGitHubPullRequestDraft(
        'x'.repeat(GitHubPullRequestTitleMaximumLength + 1),
        '',
        'feature',
        'main',
        false
      )
    )
    assert.throws(() =>
      normalizeGitHubPullRequestDraft(
        'Title',
        'x'.repeat(GitHubPullRequestBodyMaximumLength + 1),
        'feature',
        'main',
        false
      )
    )
    for (const branch of ['', ' bad', 'bad..ref', 'bad[ref', 'bad\\ref']) {
      assert.throws(() => validateGitHubPullRequestBranch(branch, 'head'))
    }
    assert.throws(() =>
      normalizeGitHubPullRequestDraft('Title', '', 'main', 'main', false)
    )
  })

  it('maps local upstream names to same-repo and fork-parent API heads', () => {
    const parent = createGitHubRepository(
      'desktop',
      'material',
      'https://github.com/desktop/material'
    )
    const fork = createGitHubRepository(
      'octocat',
      'material',
      'https://github.com/octocat/material',
      parent
    )
    const branch = createBranch('local-name', 'origin/published-name')

    assert.equal(getGitHubPullRequestHead(fork, fork, branch), 'published-name')
    assert.equal(
      getGitHubPullRequestHead(fork, parent, branch),
      'octocat:published-name'
    )
    assert.throws(() =>
      getGitHubPullRequestHead(fork, parent, createBranch('local', null))
    )
  })

  it('maps self and parent base branches to exact differently named remotes', () => {
    const parent = createGitHubRepository(
      'desktop',
      'material',
      'https://github.com/desktop/material'
    )
    const fork = createGitHubRepository(
      'octocat',
      'material',
      'https://github.com/octocat/material',
      parent
    )
    const originMain = createRemoteBranch('company-fork', 'main')
    const upstreamMain = createRemoteBranch('contribution-target', 'main')
    const unrelated = createRemoteBranch('mirror', 'main')

    const targets = buildGitHubPullRequestTargets(
      fork,
      [originMain, upstreamMain, unrelated],
      originMain,
      upstreamMain,
      'company-fork',
      'contribution-target'
    )

    assert.deepEqual(
      targets.map(target => ({
        name: target.repository.fullName,
        bases: target.baseBranches.map(branch => branch.name),
        default: target.defaultBranch?.name,
      })),
      [
        {
          name: 'octocat/material',
          bases: ['company-fork/main'],
          default: 'company-fork/main',
        },
        {
          name: 'desktop/material',
          bases: ['contribution-target/main'],
          default: 'contribution-target/main',
        },
      ]
    )
  })

  it('builds browser fallback URLs on the exact self or parent target', () => {
    const parent = createGitHubRepository(
      'desktop',
      'material',
      'https://github.com/desktop/material'
    )
    const fork = createGitHubRepository(
      'octocat',
      'material',
      'https://github.com/octocat/material',
      parent
    )
    const head = createBranch('local-name', 'origin/feature/native')
    const base = createBranch('main', 'upstream/main')

    assert.equal(
      getGitHubPullRequestCreationURL(fork, fork, head, base),
      'https://github.com/octocat/material/pull/new/main...feature%2Fnative'
    )
    assert.equal(
      getGitHubPullRequestCreationURL(fork, parent, head, base),
      'https://github.com/desktop/material/pull/new/main...octocat:material:feature%2Fnative'
    )
  })

  it('accepts only the exact provider PR URL, including enterprise paths', () => {
    assert.deepEqual(
      validateCreatedGitHubPullRequest(
        {
          number: 12,
          title: 'Created',
          body: '',
          html_url: 'https://github.example.test/code/team/repo/pull/12',
          state: 'open',
          draft: true,
        },
        'team',
        'repo',
        'https://github.example.test/code'
      ),
      {
        number: 12,
        title: 'Created',
        url: 'https://github.example.test/code/team/repo/pull/12',
        draft: true,
      }
    )

    for (const html_url of [
      'https://evil.example.test/code/team/repo/pull/12',
      'https://github.example.test/code/team/repo/pull/13',
      'https://github.example.test/code/team/repo/pull/12?next=evil',
      'https://user:password@github.example.test/code/team/repo/pull/12',
    ]) {
      assert.throws(() =>
        validateCreatedGitHubPullRequest(
          {
            number: 12,
            title: 'Created',
            body: '',
            html_url,
            state: 'open',
          },
          'team',
          'repo',
          'https://github.example.test/code'
        )
      )
    }
  })

  it('changes the repository context version for branch and tip changes', () => {
    const gitHubRepository = createGitHubRepository(
      'desktop',
      'material',
      'https://github.com/desktop/material'
    )
    const repository = new Repository(
      'C:\\fixtures\\material',
      5,
      gitHubRepository,
      false
    )
    const first = createBranch('feature', 'origin/feature', 'a'.repeat(40))
    const second = createBranch('feature', 'origin/feature', 'b'.repeat(40))
    const other = createBranch('other', 'origin/other', 'a'.repeat(40))

    assert.notEqual(
      getGitHubPullRequestContextVersion(repository, first),
      getGitHubPullRequestContextVersion(repository, second)
    )
    assert.notEqual(
      getGitHubPullRequestContextVersion(repository, first),
      getGitHubPullRequestContextVersion(repository, other)
    )
  })

  it('redacts provider response text while keeping duplicate-risk guidance', () => {
    const validation = getGitHubPullRequestCreationError(
      new APIError(new Response(null, { status: 422 }), {
        message: 'server echoed a private pull request body',
      })
    )
    assert.equal(validation.kind, 'validation')
    assert.match(validation.message, /already exist/i)
    assert.doesNotMatch(validation.message, /private pull request body/i)

    const permission = getGitHubPullRequestCreationError(
      new APIError(new Response(null, { status: 403 }), {
        message: 'secret title',
      })
    )
    assert.equal(permission.kind, 'permission')
    assert.doesNotMatch(permission.message, /secret title/i)
  })
})
