import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  applyForkBranchCheckoutPlan,
  git,
  reviewForkBranchCheckout,
} from '../../../src/lib/git'
import {
  ForkBranchCheckoutError,
  getForkNetworkRepositoryIdentity,
  IForkNetworkBranchCatalog,
} from '../../../src/lib/fork-network'
import { Repository } from '../../../src/models/repository'
import {
  setupLocalForkOfRepository,
  setupTwoCommitRepo,
} from '../../helpers/repositories'
import { makeCommit, switchTo } from '../../helpers/repository-scaffolding'

async function ref(
  repository: Repository,
  name: string
): Promise<string | null> {
  const result = await git(
    ['rev-parse', '--verify', name],
    repository.path,
    'testForkBranchRef',
    { successExitCodes: new Set([0, 1, 128]) }
  )
  return result.exitCode === 0 ? result.stdout.trim().toLowerCase() : null
}

async function fixture(t: Parameters<typeof setupTwoCommitRepo>[0]) {
  const upstream = await setupTwoCommitRepo(t)
  await git(['branch', 'feature/review'], upstream.path, 'createFeature')
  const headSha = await ref(upstream, 'refs/heads/feature/review')
  assert.notEqual(headSha, null)
  const local = await setupLocalForkOfRepository(t, upstream)
  const catalog: IForkNetworkBranchCatalog = {
    repositoryIdentity: getForkNetworkRepositoryIdentity(local),
    rootOwner: 'upstream',
    rootName: 'project',
    fork: {
      id: 'contributor/project',
      owner: 'contributor',
      name: 'project',
      cloneURL: upstream.path,
      htmlURL: 'https://github.com/contributor/project',
      isPrivate: false,
      defaultBranch: 'master',
    },
    branches: [
      {
        id: `feature%2Freview@${headSha}`,
        name: 'feature/review',
        headSha: headSha!,
        protected: false,
      },
    ],
    truncated: false,
    rejectedCount: 0,
    snapshotToken: 'a'.repeat(64),
  }
  return { upstream, local, catalog, branch: catalog.branches[0] }
}

describe('git reviewed fork branch checkout', () => {
  it('fetches through a managed remote and atomically creates a tracked local ref', async t => {
    const { local, catalog, branch } = await fixture(t)
    const plan = await reviewForkBranchCheckout(
      local,
      catalog,
      branch,
      'fork/contributor/feature-review'
    )

    assert.equal(plan.remoteName, 'github-desktop-contributor')
    assert.equal(plan.remoteWillBeCreated, true)
    await applyForkBranchCheckoutPlan(local, plan)

    assert.equal(
      await ref(local, 'refs/heads/fork/contributor/feature-review'),
      branch.headSha
    )
    assert.equal(await ref(local, plan.remoteRef), branch.headSha)
    assert.equal(
      await ref(
        local,
        `refs/desktop-material/fork-checkout/${plan.reviewToken}`
      ),
      null
    )
    const upstream = await git(
      [
        'for-each-ref',
        '--format=%(upstream:short)',
        'refs/heads/fork/contributor/feature-review',
      ],
      local.path,
      'readForkBranchUpstream'
    )
    assert.equal(
      upstream.stdout.trim(),
      'github-desktop-contributor/feature/review'
    )
  })

  it('allocates a deterministic managed remote when the conventional name collides', async t => {
    const { local, catalog, branch } = await fixture(t)
    const unrelated = await setupTwoCommitRepo(t)
    await git(
      ['remote', 'add', 'github-desktop-contributor', unrelated.path],
      local.path,
      'addCollidingForkRemote'
    )

    const plan = await reviewForkBranchCheckout(
      local,
      catalog,
      branch,
      'fork/contributor/feature-review'
    )

    assert.match(plan.remoteName, /^github-desktop-contributor-[a-f0-9]{8}$/)
    assert.equal(plan.remoteWillBeCreated, true)
  })

  it('rejects local collisions with a non-destructive alternate suggestion', async t => {
    const { local, catalog, branch } = await fixture(t)
    await git(
      ['branch', 'fork/contributor/feature/review'],
      local.path,
      'addCollidingLocalBranch'
    )

    await assert.rejects(
      () =>
        reviewForkBranchCheckout(
          local,
          catalog,
          branch,
          'fork/contributor/feature/review'
        ),
      (error: unknown) =>
        error instanceof ForkBranchCheckoutError &&
        error.code === 'local-branch-collision' &&
        error.suggestedLocalBranchName === 'fork/contributor/feature/review-2'
    )
    assert.equal(
      await ref(local, 'refs/heads/fork/contributor/feature/review'),
      branch.headSha
    )
  })

  it('does not publish local or managed remote refs when the source head moved', async t => {
    const { upstream, local, catalog, branch } = await fixture(t)
    const plan = await reviewForkBranchCheckout(
      local,
      catalog,
      branch,
      'fork/contributor/feature-review'
    )
    await switchTo(upstream, 'feature/review')
    await makeCommit(upstream, {
      entries: [{ path: 'moved.txt', contents: 'new source head' }],
    })

    await assert.rejects(
      () => applyForkBranchCheckoutPlan(local, plan),
      (error: unknown) =>
        error instanceof ForkBranchCheckoutError &&
        error.code === 'branch-moved'
    )
    assert.equal(
      await ref(local, 'refs/heads/fork/contributor/feature-review'),
      null
    )
    assert.equal(await ref(local, plan.remoteRef), null)
  })
})
