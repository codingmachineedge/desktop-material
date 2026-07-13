import { describe, it } from 'node:test'
import assert from 'node:assert'
import { groupBranches } from '../../src/ui/branches'
import { Branch, BranchType } from '../../src/models/branch'
import { CommitIdentity } from '../../src/models/commit-identity'
import { BranchSortOrder } from '../../src/models/branch-sort-order'

describe('Branches grouping', () => {
  const author = new CommitIdentity('Hubot', 'hubot@github.com', new Date())

  const branchTip = {
    sha: '300acef',
    author,
  }

  const currentBranch = new Branch(
    'master',
    null,
    branchTip,
    BranchType.Local,
    ''
  )
  const defaultBranch = new Branch(
    'master',
    null,
    branchTip,
    BranchType.Local,
    ''
  )
  const recentBranches = [
    new Branch('some-recent-branch', null, branchTip, BranchType.Local, ''),
  ]
  const otherBranch = new Branch(
    'other-branch',
    null,
    branchTip,
    BranchType.Local,
    ''
  )

  const allBranches = [currentBranch, ...recentBranches, otherBranch]

  it('should group branches', () => {
    const groups = groupBranches(
      defaultBranch,
      currentBranch,
      allBranches,
      recentBranches
    )
    assert.equal(groups.length, 3)

    assert.equal(groups[0].identifier, 'default')
    let items = groups[0].items
    assert.equal(items[0].branch, defaultBranch)

    assert.equal(groups[1].identifier, 'recent')
    items = groups[1].items
    assert.equal(items[0].branch, recentBranches[0])

    assert.equal(groups[2].identifier, 'other')
    items = groups[2].items
    assert.equal(items[0].branch, otherBranch)
  })

  it('sorts remaining branches by name or last activity', () => {
    const oldTip = {
      sha: 'old',
      author: new CommitIdentity(
        'Hubot',
        'hubot@github.com',
        new Date('2025-01-01T00:00:00Z')
      ),
    }
    const newTip = {
      sha: 'new',
      author: new CommitIdentity(
        'Hubot',
        'hubot@github.com',
        new Date('2026-01-01T00:00:00Z')
      ),
    }
    const alpha = new Branch('alpha', null, oldTip, BranchType.Local, '')
    const zulu = new Branch('zulu', null, newTip, BranchType.Local, '')

    const alphabetical = groupBranches(
      null,
      null,
      [zulu, alpha],
      [],
      BranchSortOrder.Alphabetical
    )
    assert.deepEqual(
      alphabetical[0].items.map(item => item.branch.name),
      ['alpha', 'zulu']
    )

    const recentFirst = groupBranches(
      null,
      null,
      [alpha, zulu],
      [],
      BranchSortOrder.LastModified
    )
    assert.deepEqual(
      recentFirst[0].items.map(item => item.branch.name),
      ['zulu', 'alpha']
    )
  })

  it('groups pinned branches first and hides only nonessential branches', () => {
    const groups = groupBranches(
      defaultBranch,
      currentBranch,
      allBranches,
      recentBranches,
      BranchSortOrder.Alphabetical,
      {
        pinned: ['other-branch'],
        hidden: ['some-recent-branch', 'master'],
        solo: null,
      }
    )

    assert.deepEqual(
      groups.map(group => group.identifier),
      ['default', 'pinned', 'other']
    )
    assert.equal(groups[0].items[0].branch.name, 'master')
    assert.equal(groups[1].items[0].branch.name, 'other-branch')
    assert.equal(groups[1].items[0].isPinned, true)
    assert.equal(groups[2].items.length, 0)
  })

  it('keeps the default and current branches available in solo view', () => {
    const feature = new Branch('feature', null, branchTip, BranchType.Local, '')
    const groups = groupBranches(
      defaultBranch,
      feature,
      [...allBranches, feature],
      recentBranches,
      BranchSortOrder.Alphabetical,
      { pinned: [], hidden: [], solo: 'other-branch' }
    )

    assert.deepEqual(
      groups.flatMap(group => group.items.map(item => item.branch.name)),
      ['master', 'feature', 'other-branch']
    )
  })
})
