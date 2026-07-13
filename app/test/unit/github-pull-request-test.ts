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
  resolveRefreshedGitHubPullRequestBranch,
  validateCreatedGitHubPullRequest,
  validateGitHubPullRequestBranch,
} from '../../src/lib/github-pull-request'
import { APIError } from '../../src/lib/http'
import { Branch, BranchType } from '../../src/models/branch'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { Repository } from '../../src/models/repository'
import { IRemote } from '../../src/models/remote'

const endpoint = 'https://api.github.com'

function createRemote(
  name: string = 'origin',
  url: string = 'https://github.com/octocat/material.git'
): IRemote {
  return { name, url }
}

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
    const sourceRemote = createRemote()

    assert.equal(
      getGitHubPullRequestHead(
        fork,
        fork,
        branch,
        sourceRemote,
        'https://github.com'
      ),
      'published-name'
    )
    assert.equal(
      getGitHubPullRequestHead(
        fork,
        parent,
        branch,
        sourceRemote,
        'https://github.com'
      ),
      'octocat:published-name'
    )
    assert.throws(() =>
      getGitHubPullRequestHead(
        fork,
        parent,
        createBranch('local', null),
        sourceRemote,
        'https://github.com'
      )
    )
    assert.throws(() =>
      getGitHubPullRequestHead(
        fork,
        parent,
        branch,
        createRemote('origin', 'https://github.com/attacker/material.git'),
        'https://github.com'
      )
    )
    assert.throws(() =>
      getGitHubPullRequestHead(
        fork,
        parent,
        branch,
        {
          name: 'mirror',
          url: sourceRemote.url,
        },
        'https://github.com'
      )
    )
    const attackerMetadata = createGitHubRepository(
      'octocat',
      'material',
      'https://evil.example.test/octocat/material',
      parent
    )
    assert.throws(() =>
      getGitHubPullRequestHead(
        attackerMetadata,
        parent,
        branch,
        createRemote(
          'origin',
          'https://evil.example.test/octocat/material.git'
        ),
        'https://github.com'
      )
    )
  })

  it('binds HTTPS, enterprise-base, custom HTTP, and SSH remotes to the provider', () => {
    const branch = createBranch('feature', 'origin/published-feature')
    const cases = [
      {
        html: 'https://github.com/octocat/material',
        provider: 'https://github.com',
        remote: 'https://github.com/octocat/material.git',
      },
      {
        html: 'https://github.example.test/code/octocat/material',
        provider: 'https://github.example.test/code',
        remote: 'https://github.example.test/code/octocat/material.git',
      },
      {
        html: 'http://github.internal:8080/code/octocat/material',
        provider: 'http://github.internal:8080/code',
        remote: 'http://github.internal:8080/code/octocat/material.git',
      },
      {
        html: 'https://github.com/octocat/material',
        provider: 'https://github.com',
        remote: 'git@github.com:octocat/material.git',
      },
      {
        html: 'https://github.com/octocat/material',
        provider: 'https://github.com',
        remote: 'ssh://git@github.com/octocat/material.git',
      },
    ]

    for (const fixture of cases) {
      const source = createGitHubRepository('octocat', 'material', fixture.html)
      assert.equal(
        getGitHubPullRequestHead(
          source,
          source,
          branch,
          createRemote('origin', fixture.remote),
          fixture.provider
        ),
        'published-feature'
      )
    }
  })

  it('rejects alternate HTTP ports/base paths and non-default SSH routes', () => {
    const source = createGitHubRepository(
      'octocat',
      'material',
      'https://github.example.test/code/octocat/material'
    )
    const branch = createBranch('feature', 'origin/published-feature')

    for (const remote of [
      'https://github.example.test:8443/code/octocat/material.git',
      'https://github.example.test/other/octocat/material.git',
      'ssh://git@github.example.test:2222/octocat/material.git',
      'ssh://git@github.example.test/other/octocat/material.git',
    ]) {
      assert.throws(() =>
        getGitHubPullRequestHead(
          source,
          source,
          branch,
          createRemote('origin', remote),
          'https://github.example.test/code'
        )
      )
    }
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
        default: target.defaultBranchName,
      })),
      [
        {
          name: 'octocat/material',
          bases: ['main'],
          default: 'main',
        },
        {
          name: 'desktop/material',
          bases: ['main'],
          default: 'main',
        },
      ]
    )
  })

  it('uses canonical provider refs for aliases, collisions, and defaults', () => {
    const source = createGitHubRepository(
      'octocat',
      'material',
      'https://github.com/octocat/material'
    )
    const aliasForMain = createBranch('release', 'origin/main')
    const originMain = createRemoteBranch('origin', 'main')
    const originRelease = createRemoteBranch('origin', 'release')

    const [target] = buildGitHubPullRequestTargets(
      source,
      [aliasForMain, originRelease, originMain],
      aliasForMain,
      null,
      'origin',
      'upstream'
    )

    assert.deepEqual(
      target.baseBranches.map(base => base.name),
      ['main', 'release']
    )
    assert.equal(target.defaultBranchName, 'main')
    assert.equal(target.baseBranches[0].branch, originMain)
    assert.equal(target.baseBranches[1].branch, originRelease)
  })

  it('re-resolves a newly published branch only for the same checked-out ref', () => {
    const requested = createBranch('feature', null)
    const published = createBranch('feature', 'origin/published-feature')
    const other = createBranch('other', 'origin/other')

    assert.equal(
      resolveRefreshedGitHubPullRequestBranch(requested, published),
      published
    )
    assert.equal(
      resolveRefreshedGitHubPullRequestBranch(requested, other),
      null
    )
    assert.equal(resolveRefreshedGitHubPullRequestBranch(requested, null), null)
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
    const sourceRemote = createRemote()

    assert.equal(
      getGitHubPullRequestCreationURL(
        fork,
        fork,
        head,
        sourceRemote,
        'https://github.com',
        base.nameWithoutRemote
      ),
      'https://github.com/octocat/material/pull/new/main...feature%2Fnative'
    )
    assert.equal(
      getGitHubPullRequestCreationURL(
        fork,
        parent,
        head,
        sourceRemote,
        'https://github.com',
        base.nameWithoutRemote
      ),
      'https://github.com/desktop/material/pull/new/main...octocat:material:feature%2Fnative'
    )
  })

  it('constrains browser fallbacks to the endpoint HTML origin and base path', () => {
    const enterpriseParent = createGitHubRepository(
      'desktop',
      'material',
      'https://github.example.test/code/desktop/material'
    )
    const enterpriseFork = createGitHubRepository(
      'octocat',
      'material',
      'https://github.example.test/code/octocat/material',
      enterpriseParent
    )
    const enterpriseRemote = createRemote(
      'origin',
      'https://github.example.test/code/octocat/material.git'
    )
    const head = createBranch('feature', 'origin/feature')

    assert.equal(
      getGitHubPullRequestCreationURL(
        enterpriseFork,
        enterpriseParent,
        head,
        enterpriseRemote,
        'https://github.example.test/code'
      ),
      'https://github.example.test/code/desktop/material/pull/new/octocat:material:feature'
    )

    const httpSource = createGitHubRepository(
      'octocat',
      'material',
      'http://github.internal/octocat/material'
    )
    assert.equal(
      getGitHubPullRequestCreationURL(
        httpSource,
        httpSource,
        head,
        createRemote('origin', 'http://github.internal/octocat/material.git'),
        'http://github.internal'
      ),
      'http://github.internal/octocat/material/pull/new/feature'
    )

    const attackerTarget = createGitHubRepository(
      'desktop',
      'material',
      'https://evil.example.test/code/desktop/material'
    )
    assert.equal(
      getGitHubPullRequestCreationURL(
        enterpriseFork,
        attackerTarget,
        head,
        enterpriseRemote,
        'https://github.example.test/code'
      ),
      null
    )
    const downgradedTarget = createGitHubRepository(
      'desktop',
      'material',
      'http://github.example.test/code/desktop/material'
    )
    assert.equal(
      getGitHubPullRequestCreationURL(
        enterpriseFork,
        downgradedTarget,
        head,
        enterpriseRemote,
        'https://github.example.test/code'
      ),
      null
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

  it('rejects malformed or mismatched success fields against the review', () => {
    const reviewed = normalizeGitHubPullRequestDraft(
      'Reviewed title',
      'Reviewed body',
      'octocat:feature',
      'main',
      true
    )
    const valid = {
      number: 12,
      title: reviewed.title,
      body: reviewed.body,
      html_url: 'https://github.com/desktop/material/pull/12',
      state: 'open',
      draft: reviewed.draft,
      head: { ref: 'feature', label: reviewed.head },
      base: { ref: reviewed.base },
    }

    assert.deepEqual(
      validateCreatedGitHubPullRequest(
        valid,
        'desktop',
        'material',
        'https://github.com',
        reviewed
      ),
      {
        number: 12,
        title: reviewed.title,
        url: valid.html_url,
        draft: true,
      }
    )

    for (const response of [
      null,
      [],
      { ...valid, number: Number.NaN },
      { ...valid, title: 'Changed by response' },
      { ...valid, state: 'closed' },
      { ...valid, draft: false },
      { ...valid, head: { ...valid.head, ref: 'other' } },
      { ...valid, base: { ref: 'release' } },
    ]) {
      assert.throws(() =>
        validateCreatedGitHubPullRequest(
          response,
          'desktop',
          'material',
          'https://github.com',
          reviewed
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
      getGitHubPullRequestContextVersion(repository, first, createRemote()),
      getGitHubPullRequestContextVersion(repository, second, createRemote())
    )
    assert.notEqual(
      getGitHubPullRequestContextVersion(repository, first, createRemote()),
      getGitHubPullRequestContextVersion(repository, other, createRemote())
    )
    assert.notEqual(
      getGitHubPullRequestContextVersion(repository, first, createRemote()),
      getGitHubPullRequestContextVersion(
        repository,
        first,
        createRemote('mirror')
      )
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
