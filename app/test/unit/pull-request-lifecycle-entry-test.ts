import assert from 'node:assert'
import { describe, it } from 'node:test'

import { generatePullRequestContextMenuItems } from '../../src/ui/branches/pull-request-list-item-context-menu'

describe('pull request lifecycle entry point', () => {
  it('places the purpose-built manager before browser and checkout actions', () => {
    const calls = new Array<string>()
    const items = generatePullRequestContextMenuItems({
      onManagePullRequest: () => calls.push('manage'),
      onViewPullRequestOnGitHub: () => calls.push('view'),
      onCheckoutInNewWorktree: () => calls.push('checkout'),
    })
    assert.deepEqual(
      items.map(item => item.label),
      [
        'Manage Pull Request…',
        'View Pull Request on GitHub',
        __DARWIN__ ? 'Checkout in New Worktree…' : 'Checkout in new worktree…',
      ]
    )
    items[0].action?.()
    assert.deepEqual(calls, ['manage'])
  })
})
