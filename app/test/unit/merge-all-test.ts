import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Branch, BranchType } from '../../src/models/branch'
import {
  selectBranchCandidates,
  selectWorktreeCandidates,
} from '../../src/lib/automation/merge-all'

const branch = (name: string) =>
  new Branch(name, null, { sha: name }, BranchType.Local, `refs/heads/${name}`)

describe('merge-all candidate selection', () => {
  it('excludes default, remote, and worktree-checked-out branches', () => {
    const remote = new Branch(
      'origin/remote',
      null,
      { sha: 'remote' },
      BranchType.Remote,
      'refs/remotes/origin/remote'
    )
    const candidates = selectBranchCandidates(
      [branch('main'), branch('feature'), branch('busy'), remote],
      'main',
      new Set(['refs/heads/busy'])
    )
    assert.deepEqual(
      candidates.map(candidate => candidate.branch.name),
      ['feature']
    )
  })

  it('selects eligible linked worktrees and explains skips', () => {
    const worktrees = [
      {
        path: '/repo',
        head: 'main',
        branch: 'refs/heads/main',
        isDetached: false,
        type: 'main' as const,
        isLocked: false,
        isPrunable: false,
      },
      {
        path: '/feature',
        head: 'feature',
        branch: 'refs/heads/feature',
        isDetached: false,
        type: 'linked' as const,
        isLocked: false,
        isPrunable: false,
      },
      {
        path: '/locked',
        head: 'locked',
        branch: 'refs/heads/locked',
        isDetached: false,
        type: 'linked' as const,
        isLocked: true,
        isPrunable: false,
      },
    ]
    const result = selectWorktreeCandidates(worktrees, [
      branch('main'),
      branch('feature'),
      branch('locked'),
    ])
    assert.deepEqual(
      result.candidates.map(item => item.branch.name),
      ['feature']
    )
    assert.equal(result.skipped[0].branch, 'locked')
    assert.match(result.skipped[0].detail, /locked/)
  })
})
