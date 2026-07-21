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
      languageMode: 'english',
    })
    assert.deepEqual(
      items.map(item => item.label),
      [
        'Manage review request…',
        'Open review request in browser',
        __DARWIN__ ? 'Checkout in New Worktree…' : 'Checkout in new worktree…',
      ]
    )
    items[0].action?.()
    assert.deepEqual(calls, ['manage'])
  })

  it('uses the typed Hong Kong Cantonese labels', () => {
    const items = generatePullRequestContextMenuItems({
      onManagePullRequest: () => undefined,
      onViewPullRequestOnGitHub: () => undefined,
      languageMode: 'cantonese',
    })

    assert.deepEqual(
      items.map(item => item.label),
      ['管理審閱請求…', '喺瀏覽器打開審閱請求']
    )
  })
})
