import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  cantoneseTranslations,
  englishTranslations,
  type TranslationKey,
} from '../../src/lib/i18n-resources'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `Missing contract boundary: ${start}`)

  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `Missing contract boundary: ${end}`)

  return source.slice(startIndex, endIndex)
}

describe('pull preview source and style contracts', () => {
  it('pulls directly on toolbar click and previews on right click and app-menu pull', () => {
    const toolbar = read('app/src/ui/toolbar/push-pull-button.tsx')
    const toolbarPull = between(
      toolbar,
      '  private pull = () => {',
      '\n  private onPullButtonContextMenu'
    )
    assert.match(toolbarPull, /dispatcher\.pull\(this\.props\.repository\)/)
    assert.doesNotMatch(toolbarPull, /showPopup/)

    const toolbarPreview = between(
      toolbar,
      '  private onPullButtonContextMenu = (',
      '\n  private fetch = () => {'
    )
    assert.match(toolbarPreview, /event\.preventDefault\(\)/)
    assert.match(
      toolbarPreview,
      /dispatcher\.showPopup\(\{\s*type: PopupType\.PullPreview,\s*repository: this\.props\.repository,\s*\}\)/
    )
    assert.doesNotMatch(toolbarPreview, /dispatcher\.pull\(/)

    // The preview context menu is wired to the pull-state button only.
    const contextMenuBindings = toolbar.match(
      /onContextMenu=\{this\.onPullButtonContextMenu\}/g
    )
    assert.equal(contextMenuBindings?.length, 1)
    const pullButton = between(
      toolbar,
      '  private pullButton(',
      '\n  private pushButton('
    )
    assert.match(pullButton, /onContextMenu=\{this\.onPullButtonContextMenu\}/)

    const app = read('app/src/ui/app.tsx')
    assert.match(app, /case 'pull':\s*return this\.pull\(\)/)

    const appMenuPull = between(
      app,
      '  private async pull() {',
      '\n  private async fetch() {'
    )
    assert.match(
      appMenuPull,
      /dispatcher\.showPopup\(\{\s*type: PopupType\.PullPreview,\s*repository: state\.repository,\s*\}\)/
    )
    assert.doesNotMatch(appMenuPull, /dispatcher\.pull\(/)
  })

  it('retains direct pull for non-interactive agent automation', () => {
    const dispatcher = read('app/src/ui/dispatcher/dispatcher.ts')
    const directPull = between(
      dispatcher,
      '  public async pull(',
      '\n  /** Fetch and return a bounded review'
    )
    assert.match(directPull, /await this\.appStore\._pull\(repository\)/)
    assert.match(directPull, /options\?\.autoBuild !== false/)

    const agentExecutor = read('app/src/lib/agent-command-executor.ts')
    const agentPull = between(
      agentExecutor,
      "    case 'pull': {",
      "\n    case 'fetch': {"
    )
    assert.match(
      agentPull,
      /await dispatcher\.pull\(repository, \{ autoBuild: false \}\)/
    )
  })

  it('renders PullPreview popups and loads their styles', () => {
    const app = read('app/src/ui/app.tsx')
    assert.match(app, /import \{ PullPreviewDialog \} from '\.\/pull-preview'/)
    assert.match(
      app,
      /const ModalPopupTypes = new Set<PopupType>\(\[[\s\S]*?PopupType\.PullPreview,[\s\S]*?\]\)/
    )

    const popupCase = between(
      app,
      '      case PopupType.PullPreview:',
      '\n      case PopupType.CommitAndPushAll:'
    )
    assert.match(popupCase, /<PullPreviewDialog/)
    assert.match(popupCase, /dispatcher=\{this\.props\.dispatcher\}/)
    assert.match(popupCase, /repository=\{popup\.repository\}/)
    assert.match(popupCase, /onDismissed=\{onPopupDismissedFn\}/)

    const uiStyles = read('app/styles/_ui.scss')
    assert.match(uiStyles, /@import 'ui\/pull-preview';/)
  })

  it('uses a single content column and wrapping footer actions when narrow', () => {
    const styles = read('app/styles/ui/_pull-preview.scss')
    const narrowStart = styles.indexOf('@media (max-width: 680px)')
    assert.notEqual(narrowStart, -1, 'Missing pull preview narrow breakpoint')
    const narrow = styles.slice(narrowStart)

    assert.match(
      narrow,
      /\.pull-preview-route\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      narrow,
      /\.pull-preview-columns\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(narrow, /\.pull-preview-list-scroll\s*\{\s*max-height: 220px;/)
    assert.match(
      narrow,
      /\.dialog-footer \.button-group\s*\{[\s\S]*?flex-wrap: wrap;[\s\S]*?button\s*\{[\s\S]*?flex: 1 1 100%;/
    )
  })

  it('defines every pull preview key in English and Cantonese', () => {
    const keysFor = (catalog: Readonly<Record<string, unknown>>) =>
      Object.keys(catalog)
        .filter(key => key.startsWith('pullPreview.'))
        .sort()

    const englishKeys = keysFor(englishTranslations)
    const cantoneseKeys = keysFor(cantoneseTranslations)

    assert.ok(englishKeys.length > 0, 'Expected pull preview translation keys')
    assert.deepEqual(cantoneseKeys, englishKeys)

    for (const key of englishKeys) {
      const typedKey = key as TranslationKey
      assert.ok(englishTranslations[typedKey].trim().length > 0, key)
      assert.ok((cantoneseTranslations[typedKey] ?? '').trim().length > 0, key)
    }
  })
})
