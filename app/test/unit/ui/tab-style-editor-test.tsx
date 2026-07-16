import assert from 'node:assert'
import { beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import {
  IRepositoryTab,
  ITabTitleStyle,
} from '../../../src/models/repository-tab'
import { TabStyleEditor } from '../../../src/ui/repository-tabs/tab-style-editor'
import { fireEvent, render, screen } from '../../helpers/ui/render'

const RecentColorsKey = 'tab-style-recent-colors'

function tab(titleStyle: ITabTitleStyle | null): IRepositoryTab {
  return {
    id: 'tab-1',
    repositoryId: 1,
    repositoryPath: 'C:\\work\\desktop-material',
    customLabel: null,
    titleStyle,
  }
}

function renderEditor(
  titleStyle: ITabTitleStyle | null,
  onStyleChange: (style: ITabTitleStyle) => void
) {
  return render(
    <TabStyleEditor
      tab={tab(titleStyle)}
      anchor={null}
      onStyleChange={onStyleChange}
      onReset={() => {}}
      onClose={() => {}}
    />
  )
}

beforeEach(() => localStorage.removeItem(RecentColorsKey))

describe('TabStyleEditor colors', () => {
  it('preserves text-color palette behavior', () => {
    const changes = new Array<ITabTitleStyle>()
    renderEditor({ italic: true }, style => changes.push(style))

    fireEvent.click(screen.getByRole('button', { name: 'Text color #0070c0' }))

    assert.deepEqual(changes.at(-1), {
      italic: true,
      color: '#0070c0',
    })
    assert.deepEqual(
      JSON.parse(localStorage.getItem(RecentColorsKey) ?? '[]'),
      ['#0070c0']
    )
  })

  it('applies validated palette colors to the tab background and remembers them', () => {
    const changes = new Array<ITabTitleStyle>()
    renderEditor({ color: '#ffffff', bold: true }, style => changes.push(style))

    assert.ok(screen.getByRole('dialog', { name: 'Tab appearance' }))
    assert.equal(
      screen.getByRole('button', { name: 'Text' }).getAttribute('aria-pressed'),
      'true'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Background' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Background color #ff0000' })
    )

    assert.deepEqual(changes.at(-1), {
      color: '#ffffff',
      bold: true,
      backgroundColor: '#ff0000',
    })
    assert.deepEqual(
      JSON.parse(localStorage.getItem(RecentColorsKey) ?? '[]'),
      ['#ff0000']
    )
  })

  it('applies a custom background color through the shared validated picker', () => {
    const changes = new Array<ITabTitleStyle>()
    renderEditor({ italic: true }, style => changes.push(style))

    fireEvent.click(screen.getByRole('button', { name: 'Background' }))
    fireEvent.change(screen.getByLabelText('Custom background color'), {
      target: { value: '#123456' },
    })

    assert.deepEqual(changes.at(-1), {
      italic: true,
      backgroundColor: '#123456',
    })
    assert.deepEqual(
      JSON.parse(localStorage.getItem(RecentColorsKey) ?? '[]'),
      ['#123456']
    )
  })

  it('removes only the selected color override when returning to default', () => {
    const changes = new Array<ITabTitleStyle>()
    renderEditor(
      { color: '#ffffff', backgroundColor: '#006493', underline: true },
      style => changes.push(style)
    )

    fireEvent.click(screen.getByRole('button', { name: 'Background' }))

    const defaultButton = screen.getByRole('button', {
      name: 'Use default background color',
    })
    assert.equal(defaultButton.getAttribute('aria-pressed'), 'false')
    fireEvent.click(defaultButton)

    assert.deepEqual(changes.at(-1), {
      color: '#ffffff',
      underline: true,
    })
  })
})
