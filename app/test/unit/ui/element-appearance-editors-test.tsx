import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { DefaultAppIdentityCustomization } from '../../../src/models/app-identity'
import { DefaultRepositoryLogoDesign } from '../../../src/models/repository-logo'
import {
  AppearanceEditorElementId,
  AppIdentityAppearanceEditor,
  AppWorkspaceAppearanceEditor,
  CodeDiffAppearanceEditor,
  DefaultRepositoryLogoAppearanceEditor,
  FeatureHighlightingAppearanceEditor,
  RepositoryListAppearanceEditor,
  RepositoryTabsAppearanceEditor,
  ToolbarAppearanceEditor,
  UpdateProgressAppearanceEditor,
} from '../../../src/ui/appearance'
import { fireEvent, render, screen } from '../../helpers/ui/render'

describe('element appearance editor content', () => {
  it('edits only its narrow value and exposes its own history action', () => {
    const changes = new Array<{
      accentPalette: 'blue' | 'violet' | 'teal' | 'green' | 'amber' | 'rose'
      surfacePalette: 'tonal' | 'neutral'
      elevation: 'standard' | 'subtle' | 'flat'
      uiFont: 'material' | 'system'
      motion: 'system' | 'reduced'
    }>()
    let historyRequests = 0

    render(
      <AppWorkspaceAppearanceEditor
        value={{
          accentPalette: 'blue',
          surfacePalette: 'tonal',
          elevation: 'standard',
          uiFont: 'material',
          motion: 'system',
        }}
        onChange={value => changes.push(value)}
        onShowHistory={() => historyRequests++}
      />
    )

    const editor = screen.getByRole('region', {
      name: 'App workspace appearance',
    })
    assert.equal(
      editor.getAttribute('data-appearance-element-id'),
      AppearanceEditorElementId.AppWorkspace
    )

    fireEvent.change(screen.getByLabelText('Accent color'), {
      target: { value: 'rose' },
    })
    assert.deepEqual(changes, [
      {
        accentPalette: 'rose',
        surfacePalette: 'tonal',
        elevation: 'standard',
        uiFont: 'material',
        motion: 'system',
      },
    ])

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open app workspace appearance history',
      })
    )
    assert.equal(historyRequests, 1)
  })

  it('renders each focused editor and keeps repository-only tab fields narrow', () => {
    const onChange = () => undefined
    const onShowHistory = () => undefined

    const view = render(
      <>
        <UpdateProgressAppearanceEditor
          value={{ updateProgressPalette: 'accent' }}
          onChange={onChange}
          onShowHistory={onShowHistory}
        />
        <CodeDiffAppearanceEditor
          value={{ monospaceFont: 'platform' }}
          onChange={onChange}
          onShowHistory={onShowHistory}
        />
        <ToolbarAppearanceEditor
          value={{ toolbarLabels: 'auto', toolbarDensity: 'comfortable' }}
          onChange={onChange}
          onShowHistory={onShowHistory}
        />
        <RepositoryListAppearanceEditor
          value={{ repositoryListDensity: 'comfortable' }}
          onChange={onChange}
          onShowHistory={onShowHistory}
        />
        <FeatureHighlightingAppearanceEditor
          value={{ highlightDesktopMaterialFeatures: false }}
          onChange={onChange}
          onShowHistory={onShowHistory}
        />
      </>
    )

    for (const title of [
      'Update progress appearance',
      'Code and diff appearance',
      'Toolbar appearance',
      'Repository list appearance',
      'Feature highlighting appearance',
    ]) {
      assert.ok(screen.getByRole('region', { name: title }))
    }

    const tabChanges = new Array<Record<string, unknown>>()
    view.rerender(
      <RepositoryTabsAppearanceEditor
        value={{ tabDensity: 'comfortable', tabWidth: 'standard' }}
        onChange={value => tabChanges.push(value)}
        onShowHistory={onShowHistory}
      />
    )
    assert.equal(screen.queryByLabelText('Tab close buttons'), null)
    fireEvent.change(screen.getByLabelText('Tab density'), {
      target: { value: 'compact' },
    })
    assert.deepEqual(tabChanges, [
      { tabDensity: 'compact', tabWidth: 'standard' },
    ])

    view.rerender(
      <RepositoryTabsAppearanceEditor
        value={{
          tabDensity: 'comfortable',
          tabWidth: 'standard',
          tabCloseButtons: 'hover',
        }}
        onChange={onChange}
        onShowHistory={onShowHistory}
      />
    )
    assert.ok(screen.getByLabelText('Tab close buttons'))
  })

  it('hosts the existing identity and logo studios in bounded element panels', () => {
    const view = render(
      <AppIdentityAppearanceEditor
        value={DefaultAppIdentityCustomization}
        onChange={() => undefined}
        onShowHistory={() => undefined}
      />
    )
    assert.ok(screen.getByRole('region', { name: 'App identity appearance' }))
    assert.ok(screen.getByLabelText('App name'))

    view.rerender(
      <DefaultRepositoryLogoAppearanceEditor
        value={DefaultRepositoryLogoDesign}
        repositoryName="Example repository"
        onChange={() => undefined}
        onShowHistory={() => undefined}
      />
    )
    assert.ok(
      screen.getByRole('region', {
        name: 'Default repository logo appearance',
      })
    )
    assert.ok(screen.getByRole('heading', { name: 'Custom repository logo' }))
  })
})
