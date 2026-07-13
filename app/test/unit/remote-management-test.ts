import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  createRemoteDrafts,
  createRemoteManagementPlan,
  normalizeRemoteBranch,
  normalizeRemoteName,
  normalizeRemoteUrl,
  remoteManagementPlanHasChanges,
} from '../../src/lib/remote-management'
import {
  IRemoteDraft,
  IRemoteManagementSnapshot,
} from '../../src/models/remote'

const snapshot: IRemoteManagementSnapshot = {
  token: 'a'.repeat(64),
  remotes: [
    {
      name: 'origin',
      fetchUrl: 'https://example.test/team/project.git',
      fetchUrlHasCredentials: false,
      pushUrl: null,
      pushUrlHasCredentials: false,
      prune: 'inherit',
      defaultBranch: 'main',
    },
    {
      name: 'legacy',
      fetchUrl: 'ssh://git@example.test/team/legacy.git',
      fetchUrlHasCredentials: false,
      pushUrl: null,
      pushUrlHasCredentials: false,
      prune: 'disabled',
      defaultBranch: null,
    },
  ],
}

describe('remote management plans', () => {
  it('builds a complete URL-free review for add, rename, edit, and removal', () => {
    const drafts = createRemoteDrafts(snapshot)
    const origin: IRemoteDraft = {
      ...drafts[0],
      name: 'primary',
      fetchUrl: 'https://example.test/team/project-v2.git',
      pushUrl: 'ssh://git@example.test/team/project.git',
      prune: 'enabled',
      defaultBranch: 'stable',
    }
    const added: IRemoteDraft = {
      originalName: null,
      name: 'upstream',
      fetchUrl: 'https://example.test/community/project.git',
      fetchUrlHasCredentials: false,
      pushUrl: null,
      pushUrlHasCredentials: false,
      prune: 'inherit',
      defaultBranch: null,
    }

    const plan = createRemoteManagementPlan(snapshot, [origin, added])

    assert.deepEqual(plan.removed, ['legacy'])
    assert.equal(plan.updates.length, 2)
    assert.deepEqual(plan.updates[0], {
      originalName: 'origin',
      name: 'primary',
      fetchUrl: 'https://example.test/team/project-v2.git',
      pushUrl: 'ssh://git@example.test/team/project.git',
      prune: 'enabled',
      defaultBranch: 'stable',
    })
    assert.equal(remoteManagementPlanHasChanges(plan), true)
    const renderedReview = JSON.stringify(plan.review)
    assert.doesNotMatch(renderedReview, /https?:\/\//)
    assert.doesNotMatch(renderedReview, /ssh:\/\//)
    assert.ok(plan.review.some(item => item.destructive))
  })

  it('preserves an unchanged masked URL without putting it in the plan', () => {
    const masked: IRemoteManagementSnapshot = {
      token: 'b'.repeat(64),
      remotes: [
        {
          ...snapshot.remotes[0],
          fetchUrlHasCredentials: true,
        },
      ],
    }
    const [draft] = createRemoteDrafts(masked)
    const plan = createRemoteManagementPlan(masked, [
      { ...draft, prune: 'enabled' },
    ])
    assert.equal(plan.updates[0].fetchUrl, undefined)
    assert.equal(plan.updates[0].prune, 'enabled')
  })

  it('rejects duplicate names, embedded HTTP credentials, and unsafe refs', () => {
    const drafts = createRemoteDrafts(snapshot)
    assert.throws(
      () =>
        createRemoteManagementPlan(snapshot, [
          drafts[0],
          { ...drafts[1], name: 'origin' },
        ]),
      /already exists/
    )
    assert.throws(
      () => normalizeRemoteUrl('https://user:secret@example.test/repo.git'),
      /credential helper/
    )
    assert.throws(() => normalizeRemoteUrl('--upload-pack=unsafe'), /options/)
    assert.throws(() => normalizeRemoteName('-unsafe'), /Remote names/)
    assert.throws(() => normalizeRemoteBranch('../outside'), /safe branch/)
  })

  it('returns an empty plan when no settings changed', () => {
    const plan = createRemoteManagementPlan(
      snapshot,
      createRemoteDrafts(snapshot)
    )
    assert.equal(remoteManagementPlanHasChanges(plan), false)
    assert.deepEqual(plan.review, [])
  })
})
