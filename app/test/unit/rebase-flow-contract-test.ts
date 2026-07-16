import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('reviewed rebase flow contracts', () => {
  it('revalidates exact refs after refreshing status immediately before Git', () => {
    const dispatcher = read('app/src/ui/dispatcher/dispatcher.ts')
    const start = dispatcher.indexOf('public async startRebase(')
    const end = dispatcher.indexOf(
      '/**\n   * Initialize and launch the rebase flow',
      start
    )
    const flow = dispatcher.slice(start, end)
    const refresh = flow.indexOf('await this.appStore._loadStatus(repository)')
    const firstValidation = flow.indexOf(
      'let currentState = getValidatedState()'
    )
    const warningProbe = flow.indexOf(
      'showForcePushWarning = await this.warnAboutRemoteCommits('
    )
    const postProbeRefresh = flow.indexOf(
      'await this.appStore._loadStatus(repository)',
      warningProbe
    )
    const postProbeValidation = flow.indexOf(
      'currentState = getValidatedState()',
      warningProbe
    )
    const initialization = flow.indexOf(
      'this.appStore._initializeMultiCommitOperation(',
      postProbeValidation
    )
    const accepted = flow.indexOf(
      'options?.onPreflightAccepted?.()',
      postProbeValidation
    )
    const git = flow.indexOf('await this.rebase(', initialization)

    assert.ok(refresh >= 0)
    assert.ok(firstValidation > refresh)
    assert.ok(warningProbe > firstValidation)
    assert.ok(postProbeRefresh > warningProbe)
    assert.ok(postProbeValidation > postProbeRefresh)
    assert.ok(accepted > postProbeValidation)
    assert.ok(initialization > accepted)
    assert.ok(initialization > postProbeValidation)
    assert.ok(git > initialization)
    assert.match(
      flow,
      /warnAboutRemoteCommits\(\s*repository,\s*targetBranch,\s*baseBranch\.tip\.sha\s*\)/
    )
  })

  it('shows a bounded accessible current-to-base review and stale errors', () => {
    const component = read(
      'app/src/ui/multi-commit-operation/choose-branch/rebase-choose-branch-dialog.tsx'
    )
    assert.match(component, /Rebase current branch/)
    assert.match(component, /className="rebase-route"/)
    assert.match(component, /className="rebase-ahead-behind"/)
    assert.match(component, /commits ahead and \$\{behind\} commits behind/)
    assert.match(component, /Commits to replay/)
    assert.match(component, /slice\(0, 5\)/)
    assert.match(component, /aria-live="polite"/)
    assert.match(component, /role="alert"/)
    assert.match(component, /this\.previewGeneration/)
    assert.match(component, /new AbortController\(\)/)
    assert.match(component, /signal: abortController\.signal/)
    assert.match(
      component,
      /this\.startAbortController !== null \|\| !this\.canStart\(\)/
    )
    assert.match(
      component,
      /private onDismissed = \(\) => \{\s*this\.startAbortController\?\.abort\(\)/
    )
    assert.match(
      component,
      /componentWillUnmount\(\): void \{[\s\S]*?preflightAdvanced === false[\s\S]*?startAbortController\.abort\(\)/
    )
    assert.match(
      component,
      /onPreflightAccepted: \(\) => \{[\s\S]*?preflightAdvanced = true/
    )
    assert.match(component, /Desktop will never force-push it automatically/)

    const sharedDialog = read(
      'app/src/ui/multi-commit-operation/choose-branch/base-choose-branch-dialog.tsx'
    )
    assert.match(sharedDialog, /className="rebase-cancel-before-start"/)
    assert.match(sharedDialog, />\s*Cancel\s*<\/Button>/)

    const forceWarning = read(
      'app/src/ui/multi-commit-operation/dialog/warn-force-push-dialog.tsx'
    )
    assert.match(forceWarning, /new AbortController\(\)/)
    assert.match(
      forceWarning,
      /if \(this\.startAbortController !== null\) \{\s*return/
    )
    assert.match(forceWarning, /onPreflightAccepted/)
    assert.match(forceWarning, /className="multi-commit-force-push-warning"/)
    assert.match(forceWarning, /okButtonDisabled=\{this\.state\.isStarting\}/)
    assert.match(forceWarning, /role="status"/)
    assert.match(forceWarning, /role="alert"/)
  })

  it('keeps the dialog and review scrollable without horizontal clipping', () => {
    const chooseBranch = read('app/styles/ui/dialogs/_choose-branch.scss')
    const dialog = read('app/styles/ui/_dialog.scss')
    assert.match(chooseBranch, /max-width: calc\(100vw - 16px\);/)
    assert.match(
      chooseBranch,
      /\.rebase-commit-preview\s*\{[\s\S]*?min-width: 0;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      chooseBranch,
      /\.rebase-review\s*\{[\s\S]*?max-height: clamp\([\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      chooseBranch,
      /\.choose-branch-actions\s*\{[\s\S]*?flex-wrap: wrap;[\s\S]*?min-width: 0;/
    )
    assert.match(
      chooseBranch,
      /dialog\.multi-commit-force-push-warning\s*\{[\s\S]*?max-width: calc\(100vw - 16px\);[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      dialog,
      /&#choose-branch\s*\{[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
  })
})
