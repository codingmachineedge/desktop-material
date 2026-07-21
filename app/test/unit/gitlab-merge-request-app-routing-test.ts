import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('GitLab merge request app routing contract', () => {
  it('mounts each popup with isolated state and a live exact-context service', () => {
    const app = read('app/src/ui/app.tsx')

    assert.match(app, /case PopupType\.GitLabMergeRequest/)
    assert.match(app, /key=\{`gitlab-merge-request-\$\{popup\.id\}`\}/)
    assert.match(app, /contextCurrent: \(\) =>/)
    assert.match(app, /isGitLabMergeRequestContextCurrent\(/)
    assert.match(app, /const opened = await dispatcher\.openInBrowser\(url\)/)
    assert.match(app, /if \(!opened\)/)
  })

  it('uses provider continuation after the publish prerequisite', () => {
    const app = read('app/src/ui/app.tsx')
    const push = read('app/src/ui/branches/push-branch-commits.tsx')

    assert.match(app, /onConfirm=\{this\.showCreatePullRequest\}/)
    assert.match(app, /dispatcher\.continueCreatePullRequest\(/)
    assert.equal(
      (push.match(/await this\.props\.onConfirm\(/g) ?? []).length,
      2
    )
  })

  it('carries repository identity through every review-request entry point', () => {
    const list = read('app/src/ui/branches/pull-request-list.tsx')
    const dropdown = read('app/src/ui/toolbar/branch-dropdown.tsx')
    const quickView = read('app/src/ui/pull-request-quick-view.tsx')
    const appStore = read('app/src/lib/stores/app-store.ts')

    assert.match(list, /showPullRequestLifecycle\(\s*this\.props\.repository,/)
    assert.match(list, /showPullRequestByPR\(\s*this\.props\.repository,/)
    assert.match(dropdown, /showPullRequestByPR\(this\.props\.repository, pr\)/)
    assert.match(quickView, /showPullRequestByPR\(\s*this\.props\.repository,/)
    assert.equal(
      (appStore.match(/getPullRequestInteractionRoute\(/g) ?? []).length,
      2
    )
  })
})
