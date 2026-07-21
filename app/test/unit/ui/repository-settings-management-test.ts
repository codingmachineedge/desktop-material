import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('Repository Settings repository-management surfaces', () => {
  it('owns Back appearance beside the element in staged and live contexts', () => {
    const backButton = read('app/src/ui/submodules/submodule-back-button.tsx')
    const submodules = read('app/src/ui/repository-settings/submodules.tsx')
    const appearance = read('app/src/ui/preferences/appearance.tsx')
    const app = read('app/src/ui/app.tsx')

    assert.match(
      backButton,
      /onContextMenu[\s\S]*?preventDefault\(\)[\s\S]*?stopPropagation\(\)[\s\S]*?editorAnchor/
    )
    assert.match(
      backButton,
      /anchorPosition=\{PopoverAnchorPosition\.RightTop\}[\s\S]*?decoration=\{PopoverDecoration\.Balloon\}/
    )
    assert.match(
      backButton,
      /data-context-menu-owner="true"[\s\S]*?ariaHaspopup="dialog"[\s\S]*?ariaExpanded=\{isEditorOpen\}/
    )
    assert.match(
      submodules,
      /className="submodule-appearance-preview"[\s\S]*?<SubmoduleBackButton[\s\S]*?onAppearanceCustomizationChanged=\{[\s\S]*?this\.props\.onAppearanceCustomizationChanged/
    )
    assert.doesNotMatch(
      appearance,
      /renderCustomizationSelect\(\s*'submoduleBackButton(?:Style|Label)'/
    )
    assert.match(
      app,
      /<SubmoduleBackButton[\s\S]*?onAppearanceCustomizationChanged=\{[\s\S]*?this\.onSubmoduleBackAppearanceChanged[\s\S]*?private onSubmoduleBackAppearanceChanged = \([\s\S]*?dispatcher\.setAppearanceCustomization/
    )
  })

  it('stages active-profile submodule appearance until Save', () => {
    const settings = read(
      'app/src/ui/repository-settings/repository-settings.tsx'
    )
    const app = read('app/src/ui/app.tsx')

    assert.match(
      app,
      /<RepositorySettings[\s\S]*?appearanceCustomization=\{this\.state\.appearanceCustomization\}/
    )
    assert.match(
      settings,
      /appearanceCustomization: props\.appearanceCustomization,[\s\S]*?appearanceCustomizationHasChanged: false/
    )
    assert.match(
      settings,
      /onAppearanceCustomizationChanged = \([\s\S]*?this\.setState\(\{[\s\S]*?appearanceCustomization,[\s\S]*?appearanceCustomizationHasChanged: true,[\s\S]*?\}\)/
    )
    assert.match(
      settings,
      /private onSubmit = async \(\) => \{[\s\S]*?if \(this\.state\.appearanceCustomizationHasChanged\) \{[\s\S]*?await this\.props\.dispatcher\.setAppearanceCustomization\([\s\S]*?this\.state\.appearanceCustomization[\s\S]*?\)/
    )
  })

  it('registers a dedicated Subtrees tab with the shared manager surface', () => {
    const settings = read(
      'app/src/ui/repository-settings/repository-settings.tsx'
    )
    const subtreeManager = read(
      'app/src/ui/subtrees/subtree-manager-dialog.tsx'
    )

    assert.match(settings, /Submodules,\s*Subtrees,\s*Automation,/)
    assert.match(
      settings,
      /case RepositorySettingsTab\.Subtrees:[\s\S]*?<SubtreeManager[\s\S]*?repository=\{this\.props\.repository\}[\s\S]*?accounts=\{this\.props\.accounts\}/
    )
    assert.match(
      subtreeManager,
      /export class SubtreeManager extends React\.Component/
    )
    assert.match(
      subtreeManager,
      /export class SubtreeManagerDialog[\s\S]*?<SubtreeManager[\s\S]*?<DialogFooter>/
    )
  })

  it('fences repository settings while an embedded subtree mutation runs', () => {
    const settings = read(
      'app/src/ui/repository-settings/repository-settings.tsx'
    )
    const tabBar = read('app/src/ui/tab-bar.tsx')

    assert.match(
      settings,
      /subtreeOperationInProgress: boolean[\s\S]*?subtreeOperationInProgress: false/
    )
    assert.match(
      settings,
      /<SubtreeManager[\s\S]*?onOperationStateChanged=\{this\.onSubtreeOperationStateChanged\}/
    )
    assert.match(
      settings,
      /disabled=\{dialogBusy\}[\s\S]*?dismissDisabled=\{this\.state\.subtreeOperationInProgress\}/
    )
    assert.match(settings, /<TabBar[\s\S]*?disabled=\{dialogBusy\}/)
    assert.match(
      settings,
      /okButtonDisabled=\{[\s\S]*?this\.state\.subtreeOperationInProgress[\s\S]*?cancelButtonDisabled=\{this\.state\.subtreeOperationInProgress\}/
    )
    assert.match(
      tabBar,
      /readonly disabled\?: boolean[\s\S]*?if \(this\.props\.disabled\) \{[\s\S]*?return/
    )
  })

  it('labels temporary submodule management explicitly in both locales', () => {
    const submodules = read('app/src/ui/repository-settings/submodules.tsx')
    const resources = read('app/src/lib/i18n-resources.ts')

    assert.match(
      submodules,
      /translationKey="submodule\.temporaryOpenDescription"/
    )
    assert.match(
      resources,
      /'submodule\.openAsRepository': 'Open temporary viewer'/
    )
    assert.match(
      resources,
      /'submodule\.temporaryOpenDescription':[\s\S]*?never added to your repository list/
    )
    assert.match(resources, /'submodule\.openAsRepository': '開臨時檢視器'/)
  })
})
