import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  resolveEffectiveBranchRulesAccount,
  resolveEffectiveBranchRulesContext,
} from '../../src/lib/effective-branch-rules-context'
import { Account, getAccountKey } from '../../src/models/account'
import { Branch, BranchType } from '../../src/models/branch'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { IRemote } from '../../src/models/remote'
import { Repository } from '../../src/models/repository'

const endpoint = 'https://api.github.com'

function gitHubRepository(
  owner: string,
  name: string,
  id: number,
  parent: GitHubRepository | null = null,
  permission: 'read' | 'write' | 'admin' | null = 'write'
) {
  const htmlURL = `https://github.com/${owner}/${name}`
  return new GitHubRepository(
    name,
    new Owner(owner, endpoint, id),
    id,
    false,
    htmlURL,
    `${htmlURL}.git`,
    true,
    false,
    permission,
    parent
  )
}

function localRepository(
  gitHub: GitHubRepository,
  accountKey: string | null = null
) {
  return new Repository(
    'C:\\fixtures\\material',
    7,
    gitHub,
    false,
    null,
    {},
    false,
    undefined,
    accountKey
  )
}

function account(id: number, accountEndpoint = endpoint, login = `user-${id}`) {
  return new Account(login, accountEndpoint, 'token', [], '', id, login)
}

function branch(
  name = 'feature',
  upstream: string | null = `origin/${name}`,
  sha = 'a'.repeat(40)
) {
  return new Branch(
    name,
    upstream,
    { sha },
    BranchType.Local,
    `refs/heads/${name}`
  )
}

function remote(
  name = 'origin',
  url = 'https://github.com/octocat/material.git'
): IRemote {
  return { name, url }
}

describe('effective branch rules context', () => {
  it('resolves only the exact saved account or one unique legacy endpoint identity', () => {
    const gitHub = gitHubRepository('octocat', 'material', 2)
    const first = account(1)
    const duplicate = account(1, endpoint, 'renamed-user')
    const second = account(2)

    const exact = resolveEffectiveBranchRulesAccount(
      [second, first],
      localRepository(gitHub, getAccountKey(first)),
      endpoint
    )
    assert.equal(exact.kind, 'ready')
    assert.equal(exact.kind === 'ready' ? exact.account.id : null, 1)

    assert.equal(
      resolveEffectiveBranchRulesAccount(
        [first, duplicate],
        localRepository(gitHub),
        endpoint
      ).kind,
      'ready'
    )
    assert.equal(
      resolveEffectiveBranchRulesAccount(
        [first, second],
        localRepository(gitHub),
        endpoint
      ).kind,
      'ambiguous'
    )
    assert.equal(
      resolveEffectiveBranchRulesAccount([], localRepository(gitHub), endpoint)
        .kind,
      'signed-out'
    )

    const otherHost = account(3, 'https://github.example.test/api/v3')
    assert.equal(
      resolveEffectiveBranchRulesAccount(
        [otherHost],
        localRepository(gitHub, getAccountKey(otherHost)),
        endpoint
      ).kind,
      'incompatible'
    )
  })

  it('resolves the exact child or fork-parent remote without guessing', () => {
    const parent = gitHubRepository('desktop', 'material', 1)
    const child = gitHubRepository('octocat', 'material', 2, parent)
    const repository = localRepository(child)

    const own = resolveEffectiveBranchRulesContext(
      repository,
      branch(),
      remote()
    )
    assert.equal(own.kind, 'ready')
    assert.equal(
      own.kind === 'ready' ? own.gitHubRepository.hash : null,
      child.hash
    )
    assert.equal(own.branch, 'feature')

    const upstream = resolveEffectiveBranchRulesContext(
      repository,
      branch('release', 'upstream/release'),
      remote('upstream', 'https://github.com/desktop/material.git')
    )
    assert.equal(upstream.kind, 'ready')
    assert.equal(
      upstream.kind === 'ready' ? upstream.gitHubRepository.hash : null,
      parent.hash
    )
    assert.equal(upstream.branch, 'release')
  })

  it('refuses unrelated, mismatched, and unpublished remotes', () => {
    const repository = localRepository(
      gitHubRepository('octocat', 'material', 2)
    )

    for (const result of [
      resolveEffectiveBranchRulesContext(
        repository,
        branch('release', 'other/release'),
        remote('other', 'https://github.com/someone/else.git')
      ),
      resolveEffectiveBranchRulesContext(
        repository,
        branch(),
        remote('mirror')
      ),
      resolveEffectiveBranchRulesContext(
        repository,
        branch('local-only', null),
        remote()
      ),
    ]) {
      assert.equal(result.kind, 'unsupported')
      assert.match(
        result.kind === 'unsupported' ? result.message : '',
        /not published|recognized GitHub remote/i
      )
    }
  })

  it('versions every repository, branch, upstream, and remote identity field', () => {
    const child = gitHubRepository('octocat', 'material', 2)
    const repository = localRepository(child)
    const base = resolveEffectiveBranchRulesContext(
      repository,
      branch(),
      remote()
    ).contextVersion

    const contexts = [
      resolveEffectiveBranchRulesContext(
        repository,
        branch('feature', 'origin/feature', 'b'.repeat(40)),
        remote()
      ),
      resolveEffectiveBranchRulesContext(
        repository,
        branch(),
        remote('origin', 'https://github.com/octocat/material')
      ),
      resolveEffectiveBranchRulesContext(
        repository,
        branch('release', 'origin/release'),
        remote()
      ),
      resolveEffectiveBranchRulesContext(
        localRepository(
          gitHubRepository('octocat', 'material', 2, null, 'admin')
        ),
        branch(),
        remote()
      ),
    ]

    assert.ok(contexts.every(context => context.contextVersion !== base))
  })
})
