import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('clone recovery UI contracts', () => {
  it('binds async path results to an exact tab/account/input snapshot', () => {
    const ui = read('app/src/ui/clone-repository/clone-repository.tsx')
    assert.match(ui, /pathValidationSequence/)
    assert.match(ui, /cloneInputSequence/)
    assert.match(ui, /getAccountSnapshotKey/)
    assert.match(ui, /newTabState\.path === path/)
    assert.match(ui, /newTabState\.url === url/)
    assert.match(ui, /request === this\.pathValidationSequence/)
  })

  it('keeps short clone dialogs internally scrollable', () => {
    const ui = read('app/src/ui/clone-repository/clone-repository.tsx')
    const style = read('app/styles/ui/_add-repository.scss')
    assert.match(ui, /className="clone-repository-tab-panel"/)
    assert.match(style, /\.clone-repository-tab-panel[\s\S]*overflow-y: auto/)
    assert.match(
      style,
      /@media \(max-height: 550px\)[\s\S]*\.dialog-footer[\s\S]*overflow-y: auto/
    )
    assert.match(style, /height: clamp\(120px, 34vh, 260px\)/)
  })

  it('provides pause, resume, review, and background-only auto-clone wiring', () => {
    const progress = read(
      'app/src/ui/clone-repository/batch-clone-progress.tsx'
    )
    const dispatcher = read('app/src/ui/dispatcher/dispatcher.ts')
    const appStore = read('app/src/lib/stores/app-store.ts')
    assert.match(progress, /Pause remaining/)
    assert.match(progress, /Recheck destinations/)
    assert.match(dispatcher, /pauseBatchClone/)
    assert.match(dispatcher, /resumeBatchClone/)
    assert.match(dispatcher, /retryBatchCloneRegistration/)
    assert.match(appStore, /this\._cloneBatch\(items, mode, 'auto'\)/)
    assert.doesNotMatch(
      appStore,
      /startBackgroundAutoCloneBatch[\s\S]{0,800}PopupType\.BatchCloneProgress/
    )
  })

  it('reopens retained work only on explicit Clone and finalizes once', () => {
    const app = read('app/src/ui/app.tsx')
    const appStore = read('app/src/lib/stores/app-store.ts')
    assert.match(
      app,
      /batchCloneNeedsAttention\(this\.state\.batchCloneState\)/
    )
    assert.match(app, /type: PopupType\.BatchCloneProgress/)
    assert.match(appStore, /statuses\.get\(item\.path\)\?\.finalized !== true/)
    assert.match(appStore, /selectRegisteredBatchClonePaths/)
    assert.match(appStore, /batchCloneStore\.markFinalized\(finalizedPaths\)/)
    assert.doesNotMatch(
      appStore,
      /batchCloneStore\.markFinalized\(unfinalizedPaths\)/
    )
    assert.match(appStore, /if \(!registrationComplete\) \{\s*return/)
    assert.match(appStore, /completionNotificationPending/)
    assert.match(appStore, /markCompletionNotified\(\)/)
    assert.match(appStore, /batchCloneStore\.requiresAttention/)

    const progress = read(
      'app/src/ui/clone-repository/batch-clone-progress.tsx'
    )
    assert.match(progress, /Retry adding repositories/)
    assert.match(progress, /retryBatchCloneRegistration/)
    assert.match(progress, /hasPendingRegistration \? 'Close' : 'Done'/)
  })

  it('hydrates saved automatic clone path and mode per account', () => {
    const ui = read('app/src/ui/clone-repository/clone-repository.tsx')
    assert.match(ui, /getAutoClonePolicy\(account\)/)
    assert.match(ui, /policy\.baseDirectory/)
    assert.match(ui, /policy\?\.mode/)
    assert.match(ui, /autoCloneHydrationKey/)
  })
})
