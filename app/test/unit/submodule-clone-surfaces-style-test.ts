import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const read = (...segments: ReadonlyArray<string>) =>
  readFileSync(join(process.cwd(), 'app', ...segments), 'utf8')

describe('submodule clone-surface contracts', () => {
  it('shows a highlighted, non-selecting submodule badge on clone rows', () => {
    const list = read(
      'src',
      'ui',
      'clone-repository',
      'cloneable-repository-filter-list.tsx'
    )

    // The badge is a real button, stops row selection, and is labelled.
    assert.match(
      list,
      /onSubmoduleBadgeClick[\s\S]*?event\.stopPropagation\(\)[\s\S]*?onShowSubmodules/
    )
    assert.match(
      list,
      /className="submodule-badge"[\s\S]*?aria-label=\{label\}/
    )
    // Rows probe lazily as they become visible.
    assert.match(list, /onProbeSubmodules\(repository\)/)

    const style = read('styles', 'ui', '_cloneable-repository-filter-list.scss')
    assert.match(
      style,
      /\.submodule-badge\s*\{[\s\S]*?background: var\(--md-sys-color-tertiary-container\);[\s\S]*?color: var\(--md-sys-color-on-tertiary-container\);/
    )
    assert.match(style, /\.submodule-badge\s*\{[\s\S]*?cursor: pointer;/)
  })

  it('registers both submodule popups and renders them from the app shell', () => {
    const popup = read('src', 'models', 'popup.ts')
    assert.match(popup, /CloneableSubmodules = 'CloneableSubmodules'/)
    assert.match(popup, /SubmoduleManager = 'SubmoduleManager'/)
    assert.match(
      popup,
      /type: PopupType\.CloneableSubmodules[\s\S]*?parentCloneUrl: string[\s\S]*?entries: ReadonlyArray<IGitModulesEntry>/
    )

    const app = read('src', 'ui', 'app.tsx')
    assert.match(
      app,
      /case PopupType\.CloneableSubmodules:[\s\S]*?<CloneableSubmodulesDialog[\s\S]*?onCloneUrl=\{popup\.onCloneUrl \?\? this\.showCloneRepo\}/
    )
    assert.match(
      app,
      /case PopupType\.SubmoduleManager:[\s\S]*?<SubmoduleManagerDialog/
    )
    assert.match(
      app,
      /onShowRepositorySubmodules=\{this\.onShowRepositorySubmodules\}/
    )
  })

  it('clones each pre-clone submodule through a resolved URL only', () => {
    const dialog = read(
      'src',
      'ui',
      'clone-repository',
      'cloneable-submodules-dialog.tsx'
    )

    assert.match(
      dialog,
      /resolveSubmoduleCloneUrl\(this\.props\.parentCloneUrl, entry\.url\)/
    )
    assert.match(dialog, /disabled=\{resolvedUrl === null\}/)
    assert.match(dialog, /'Clone as Repository' : 'Clone as repository'/)
  })

  it('lists the submodule manager on the repo page only when submodules exist', () => {
    const tools = read('src', 'ui', 'repository-tools', 'repository-tools.tsx')

    // The hub entry is gated on a positive count plus an opener callback.
    assert.match(
      tools,
      /getAllHubEntries\(\)[\s\S]*?onOpenSubmoduleManager === undefined \|\|[\s\S]*?submoduleCount === null \|\|[\s\S]*?submoduleCount === 0[\s\S]*?return RepositoryToolsHubEntries/
    )
    assert.match(tools, /id: 'submodule-manager'/)
    assert.match(
      tools,
      /selected === 'submodule-manager' && this\.renderSubmoduleManager\(\)/
    )

    const repositoryView = read('src', 'ui', 'repository.tsx')
    assert.match(
      repositoryView,
      /submoduleCount=\{this\.state\.submoduleCount\}[\s\S]*?onOpenSubmoduleManager=\{this\.onOpenSubmoduleManager\}/
    )
    assert.match(
      repositoryView,
      /type: PopupType\.SubmoduleManager,[\s\S]*?repository: this\.props\.repository,/
    )
  })

  it('manages cloned and uncloned submodules in place', () => {
    const manager = read('src', 'ui', 'repository-settings', 'submodules.tsx')

    // Summary chips distinguish cloned from not-cloned submodules.
    assert.match(manager, /submodules-summary-cloned[\s\S]*?\{cloned\} cloned/)
    assert.match(
      manager,
      /submodules-summary-uncloned[\s\S]*?\{uncloned\} not cloned/
    )
    // Uninitialized submodules get a Clone action, not Update.
    assert.match(
      manager,
      /submodule\.status === 'uninitialized' \? 'Clone' : 'Update'/
    )

    // The shared styles serve both the settings tab and the standalone
    // manager dialog.
    const settingsStyle = read(
      'styles',
      'ui',
      'dialogs',
      '_repository-settings.scss'
    )
    assert.match(
      settingsStyle,
      /#repository-settings,\s*#submodule-manager\s*\{[\s\S]*?\.submodules-settings/
    )

    const uiManifest = read('styles', '_ui.scss')
    assert.match(uiManifest, /@import 'ui\/cloneable-submodules';/)
  })
})
