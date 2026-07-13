import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  buildGitHubPullRequestTargets,
  getGitHubPullRequestContextVersion,
  getGitHubPullRequestCreationError,
  getGitHubPullRequestCreationURL,
  getGitHubPullRequestHead,
  getGitHubPullRequestHeadRepository,
  GitHubPullRequestBodyMaximumLength,
  GitHubPullRequestMetadataMaximumItems,
  GitHubPullRequestTitleMaximumLength,
  normalizeGitHubPullRequestDraft,
  normalizeGitHubPullRequestMetadata,
  normalizeGitHubPullRequestReview,
  normalizeGitHubPullRequestUpdate,
  parseGitHubPullRequestMetadataField,
  resolveRefreshedGitHubPullRequestBranch,
  validateCreatedGitHubPullRequest,
  validateGitHubPullRequestLifecycle,
  validateGitHubPullRequestMergeReceipt,
  validateGitHubPullRequestDraftRouting,
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

function createHeadRepository(
  fullName: string = 'desktop/material',
  name: string | null = null
) {
  return { name, fullName }
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
        true,
        createHeadRepository('octocat/material')
      ),
      {
        title: 'Native PR',
        body: ' body\n',
        head: 'octocat:feature/native',
        headRepository: createHeadRepository('octocat/material'),
        base: 'main',
        draft: true,
      }
    )
  })

  it('rejects empty, oversized, ambiguous, and same-repository identical refs', () => {
    assert.throws(() =>
      normalizeGitHubPullRequestDraft(
        ' ',
        '',
        'feature',
        'main',
        false,
        createHeadRepository()
      )
    )
    assert.throws(() =>
      normalizeGitHubPullRequestDraft(
        'x'.repeat(GitHubPullRequestTitleMaximumLength + 1),
        '',
        'feature',
        'main',
        false,
        createHeadRepository()
      )
    )
    assert.throws(() =>
      normalizeGitHubPullRequestDraft(
        'Title',
        'x'.repeat(GitHubPullRequestBodyMaximumLength + 1),
        'feature',
        'main',
        false,
        createHeadRepository()
      )
    )
    for (const branch of ['', ' bad', 'bad..ref', 'bad[ref', 'bad\\ref']) {
      assert.throws(() => validateGitHubPullRequestBranch(branch, 'head'))
    }
    assert.throws(() =>
      normalizeGitHubPullRequestDraft(
        'Title',
        '',
        'main',
        'main',
        false,
        createHeadRepository()
      )
    )
    for (const headRepository of [
      createHeadRepository('not/a/full/name'),
      createHeadRepository('desktop/material', 'other'),
      createHeadRepository('desktop/material', 'material'),
    ]) {
      assert.throws(() =>
        normalizeGitHubPullRequestDraft(
          'Title',
          '',
          'octocat:feature',
          'main',
          false,
          headRepository
        )
      )
    }
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

  it('reviews and revalidates the exact same-owner fork head repository', () => {
    const parent = createGitHubRepository(
      'acme',
      'upstream',
      'https://github.com/acme/upstream'
    )
    const fork = createGitHubRepository(
      'acme',
      'product-fork',
      'https://github.com/acme/product-fork',
      parent
    )
    const branch = createBranch('feature', 'origin/published-feature')
    const remote = createRemote(
      'origin',
      'https://github.com/acme/product-fork.git'
    )
    const head = getGitHubPullRequestHead(
      fork,
      parent,
      branch,
      remote,
      'https://github.com'
    )
    const headRepository = getGitHubPullRequestHeadRepository(fork, parent)
    assert.equal(head, 'acme:published-feature')
    assert.deepEqual(headRepository, {
      name: 'product-fork',
      fullName: 'acme/product-fork',
    })

    const reviewed = normalizeGitHubPullRequestDraft(
      'Same-owner fork',
      '',
      head,
      'main',
      false,
      headRepository
    )
    assert.doesNotThrow(() =>
      validateGitHubPullRequestDraftRouting(
        fork,
        parent,
        branch,
        remote,
        'https://github.com',
        reviewed
      )
    )

    for (const changed of [
      { ...reviewed, head: 'acme:other' },
      {
        ...reviewed,
        headRepository: { ...headRepository, name: 'upstream' },
      },
      {
        ...reviewed,
        headRepository: { ...headRepository, fullName: 'acme/upstream' },
      },
    ]) {
      assert.throws(() =>
        validateGitHubPullRequestDraftRouting(
          fork,
          parent,
          branch,
          remote,
          'https://github.com',
          changed
        )
      )
    }

    const differentOwner = createGitHubRepository(
      'octocat',
      'product-fork',
      'https://github.com/octocat/product-fork',
      parent
    )
    assert.deepEqual(
      getGitHubPullRequestHeadRepository(differentOwner, parent),
      { name: null, fullName: 'octocat/product-fork' }
    )
    assert.deepEqual(getGitHubPullRequestHeadRepository(fork, fork), {
      name: null,
      fullName: 'acme/product-fork',
    })
  })

  it('binds HTTPS, enterprise-base, custom HTTP, and SSH remotes to the provider', () => {
    const branch = createBranch('feature', 'origin/published-feature')
    const cases = [
      {
        html: 'https://github.com/octocat/material',
        provider: 'https://github.com',
        remote: 'https://github.com/OCTOCAT/MATERIAL.git',
      },
      {
        html: 'https://github.example.test/Code/octocat/material',
        provider: 'https://github.example.test/Code',
        remote: 'https://github.example.test/Code/OCTOCAT/MATERIAL.git',
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
        remote: 'ssh://git@github.com/OCTOCAT/MATERIAL.git',
      },
      {
        html: 'https://github.com/octocat/material',
        provider: 'https://github.com',
        remote: 'ssh://git@ssh.github.com:443/OCTOCAT/MATERIAL.git',
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

  it('rejects userinfo, alternate HTTP origins/base paths, and untrusted SSH routes', () => {
    const source = createGitHubRepository(
      'octocat',
      'material',
      'https://github.example.test/code/octocat/material'
    )
    const branch = createBranch('feature', 'origin/published-feature')

    const rejectedRemotes = [
      'https://github.example.test:8443/code/octocat/material.git',
      'https://github.example.test/Code/octocat/material.git',
      'https://github.example.test/other/octocat/material.git',
      'https://user@github.example.test/code/octocat/material.git',
      'https://user:secret@github.example.test/code/octocat/material.git',
      'ssh://git@github.example.test:2222/octocat/material.git',
      'ssh://git@github.example.test/other/octocat/material.git',
      'ssh://git@ssh.github.com:443/octocat/material.git',
    ]
    for (const remote of rejectedRemotes) {
      assert.throws(
        () =>
          getGitHubPullRequestHead(
            source,
            source,
            branch,
            createRemote('origin', remote),
            'https://github.example.test/code'
          ),
        error =>
          error instanceof Error &&
          !error.message.includes(remote) &&
          !error.message.includes('secret')
      )
    }

    const dotComSource = createGitHubRepository(
      'octocat',
      'material',
      'https://github.com/octocat/material'
    )
    for (const remote of [
      'ssh://git@ssh.github.com:22/octocat/material.git',
      'ssh://octocat@ssh.github.com:443/octocat/material.git',
      'ssh://git@ssh.github.com:444/octocat/material.git',
    ]) {
      assert.throws(() =>
        getGitHubPullRequestHead(
          dotComSource,
          dotComSource,
          branch,
          createRemote('origin', remote),
          'https://github.com'
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
      true,
      createHeadRepository('octocat/material')
    )
    const valid = {
      number: 12,
      title: reviewed.title,
      body: reviewed.body,
      html_url: 'https://github.com/desktop/material/pull/12',
      state: 'open',
      draft: reviewed.draft,
      head: {
        ref: 'feature',
        label: reviewed.head,
        repo: { full_name: reviewed.headRepository.fullName },
      },
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
      {
        ...valid,
        head: { ...valid.head, repo: { full_name: 'attacker/material' } },
      },
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

describe('GitHub pull request lifecycle validation', () => {
  const lifecycle = {
    number: 42,
    title: 'Lifecycle PR',
    body: 'Reviewed body',
    html_url: 'https://github.com/desktop/material/pull/42',
    state: 'open' as const,
    draft: false,
    merged: false,
    mergeable: true,
    mergeable_state: 'clean',
    head: {
      ref: 'feature/lifecycle',
      sha: 'a'.repeat(40),
      repo: { full_name: 'octocat/material' },
    },
    base: { ref: 'main' },
    requested_reviewers: [{ login: 'reviewer-one' }],
    assignees: [{ login: 'octocat' }],
    labels: [{ name: 'ready for review' }],
  }

  it('normalizes bounded metadata and exact update/review fields', () => {
    assert.deepEqual(
      normalizeGitHubPullRequestMetadata(
        [' Reviewer-One ', 'reviewer-one'],
        ['octocat'],
        [' ready for review ']
      ),
      {
        reviewers: ['reviewer-one'],
        assignees: ['octocat'],
        labels: ['ready for review'],
      }
    )
    assert.deepEqual(parseGitHubPullRequestMetadataField('a, b ,c'), [
      'a',
      'b',
      'c',
    ])
    assert.deepEqual(
      normalizeGitHubPullRequestUpdate('  Updated  ', 'body', 'release', {
        reviewers: [],
        assignees: [],
        labels: [],
      }),
      {
        title: 'Updated',
        body: 'body',
        base: 'release',
        metadata: { reviewers: [], assignees: [], labels: [] },
      }
    )
    assert.deepEqual(
      normalizeGitHubPullRequestReview('APPROVE', 'Looks good'),
      {
        event: 'APPROVE',
        body: 'Looks good',
      }
    )
    assert.throws(() => normalizeGitHubPullRequestReview('REQUEST_CHANGES', ''))
  })

  it('rejects oversized, ambiguous, and malformed metadata', () => {
    assert.throws(() =>
      normalizeGitHubPullRequestMetadata(
        new Array(GitHubPullRequestMetadataMaximumItems + 1).fill('octocat'),
        [],
        []
      )
    )
    for (const login of ['', '-leading', 'trailing-', 'space name', '../x']) {
      assert.throws(() => normalizeGitHubPullRequestMetadata([login], [], []))
    }
    for (const label of ['', 'x'.repeat(51), 'line\nbreak']) {
      assert.throws(() => normalizeGitHubPullRequestMetadata([], [], [label]))
    }
  })

  it('validates an exact provider-bound lifecycle snapshot', () => {
    assert.deepEqual(
      validateGitHubPullRequestLifecycle(
        lifecycle,
        'desktop',
        'material',
        42,
        'https://github.com'
      ),
      {
        number: 42,
        title: 'Lifecycle PR',
        body: 'Reviewed body',
        url: 'https://github.com/desktop/material/pull/42',
        state: 'open',
        draft: false,
        merged: false,
        mergeable: true,
        mergeableState: 'clean',
        headRef: 'feature/lifecycle',
        headSHA: 'a'.repeat(40),
        headRepository: 'octocat/material',
        base: 'main',
        metadata: {
          reviewers: ['reviewer-one'],
          assignees: ['octocat'],
          labels: ['ready for review'],
        },
      }
    )

    for (const value of [
      { ...lifecycle, number: 43 },
      { ...lifecycle, html_url: 'https://evil.test/desktop/material/pull/42' },
      { ...lifecycle, head: { ...lifecycle.head, sha: 'not-a-sha' } },
      { ...lifecycle, head: { ...lifecycle.head, repo: null } },
      { ...lifecycle, mergeable_state: 'bad\nstate' },
    ]) {
      assert.throws(() =>
        validateGitHubPullRequestLifecycle(
          value,
          'desktop',
          'material',
          42,
          'https://github.com'
        )
      )
    }
  })

  it('requires an affirmative, bounded merge response', () => {
    assert.deepEqual(
      validateGitHubPullRequestMergeReceipt({
        merged: true,
        sha: 'b'.repeat(40),
        message: 'provider-controlled text',
      }),
      {
        merged: true,
        sha: 'b'.repeat(40),
        message: 'Pull request merged.',
      }
    )
    assert.throws(() =>
      validateGitHubPullRequestMergeReceipt({
        merged: false,
        sha: 'b'.repeat(40),
      })
    )
  })
})
