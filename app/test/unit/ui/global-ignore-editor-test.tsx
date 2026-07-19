import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { IGlobalIgnoreDocument } from '../../../src/lib/git/global-ignore'
import { LanguageModeChangedEvent } from '../../../src/lib/i18n'
import {
  GlobalIgnoreEditor,
  appendRules,
} from '../../../src/ui/preferences/global-ignore'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const initial: IGlobalIgnoreDocument = {
  configured: false,
  exists: false,
  path: 'C:\\fixture\\global-ignore',
  contents: '*.tmp\n',
}

describe('GlobalIgnoreEditor', () => {
  it('loads, edits, saves, and reports the activated scope', async () => {
    const saves: Array<{ path: string; contents: string }> = []
    render(
      <GlobalIgnoreEditor
        load={async () => initial}
        save={async (path, contents) => {
          saves.push({ path, contents })
          return { configured: true, exists: true, path, contents }
        }}
      />
    )

    await screen.findByDisplayValue(initial.path)
    fireEvent.click(screen.getByRole('button', { name: 'Add OS files' }))
    const editor = screen.getByRole('textbox', {
      name: 'Global ignore rules',
    }) as HTMLTextAreaElement
    assert.match(editor.value, /Thumbs\.db/)

    fireEvent.click(screen.getByRole('button', { name: 'Save global rules' }))
    await screen.findByRole('status')
    assert.equal(saves.length, 1)
    assert.equal(saves[0].path, initial.path)
    assert.match(saves[0].contents, /\.DS_Store/)
    assert.ok(screen.getByText(/saved and activated/))
  })

  it('keeps save failures visible and retains the editor contents', async () => {
    render(
      <GlobalIgnoreEditor
        load={async () => initial}
        save={async () => {
          throw new Error('locked')
        }}
      />
    )
    await screen.findByDisplayValue(initial.path)
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Global ignore rules' }),
      { target: { value: 'dist/\n' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save global rules' }))
    await waitFor(() => assert.ok(screen.getByRole('alert')))
    assert.match(screen.getByRole('alert').textContent ?? '', /locked/)
    assert.equal(
      (
        screen.getByRole('textbox', {
          name: 'Global ignore rules',
        }) as HTMLTextAreaElement
      ).value,
      'dist/\n'
    )
  })

  it('adds starter rules idempotently', () => {
    assert.equal(
      appendRules('.idea/\n', ['.idea/', '*.swp']),
      '.idea/\n*.swp\n'
    )
  })

  it('switches English, Cantonese, and bilingual copy live', async () => {
    localStorage.setItem(
      'appearance-customization-v1',
      JSON.stringify({ version: 1, languageMode: 'english' })
    )
    const view = render(<GlobalIgnoreEditor load={async () => initial} />)

    try {
      await screen.findByRole('heading', { name: 'Global ignore rules' })

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'cantonese' })
      )
      await waitFor(() =>
        assert.ok(screen.getByRole('heading', { name: '全域忽略規則' }))
      )
      assert.ok(screen.getByRole('button', { name: '儲存全域規則' }))
      assert.ok(screen.getByRole('textbox', { name: '全域忽略規則' }))

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'bilingual' })
      )
      await waitFor(() =>
        assert.match(
          view.container.textContent ?? '',
          /Global ignore rules · 全域忽略規則/
        )
      )
      assert.ok(screen.getByRole('button', { name: 'Save global rules' }))
    } finally {
      view.unmount()
      localStorage.removeItem('appearance-customization-v1')
    }
  })
})
