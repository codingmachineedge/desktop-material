import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { LanguageModeChangedEvent } from '../../src/lib/i18n'
import { DiffContextPreferencesControl } from '../../src/ui/diff/diff-context-preferences-control'
import {
  canAutomaticallyExpandDiff,
  DiffContextPreferencesStorageKey,
  MaxAutomaticallyExpandedDiffBytes,
  MaxAutomaticallyExpandedDiffLines,
  normalizeDiffContextPreferences,
  readDiffContextPreferences,
} from '../../src/ui/diff/diff-context-preferences'
import { IFileContents } from '../../src/ui/diff/syntax-highlighting'
import { fireEvent, render, screen, waitFor } from '../helpers/ui/render'

function contents(
  newContents: ReadonlyArray<string>,
  overrides: Partial<IFileContents> = {}
): IFileContents {
  return {
    file: {} as IFileContents['file'],
    oldContents: [],
    newContents,
    canBeExpanded: true,
    newContentsArePartial: false,
    newContentsByteLength: newContents.join('\n').length,
    ...overrides,
  }
}

describe('diff context preferences', () => {
  it('normalizes persisted data and rejects malformed or unsupported values', () => {
    localStorage.removeItem(DiffContextPreferencesStorageKey)
    assert.deepEqual(readDiffContextPreferences(), {
      alwaysExpand: false,
      contextLines: 20,
    })
    assert.deepEqual(
      normalizeDiffContextPreferences({
        alwaysExpand: true,
        contextLines: 50,
      }),
      { alwaysExpand: true, contextLines: 50 }
    )
    assert.deepEqual(
      normalizeDiffContextPreferences({
        alwaysExpand: 'yes',
        contextLines: 999,
      }),
      { alwaysExpand: false, contextLines: 20 }
    )

    localStorage.setItem(DiffContextPreferencesStorageKey, '{not-json')
    assert.deepEqual(readDiffContextPreferences(), {
      alwaysExpand: false,
      contextLines: 20,
    })
    localStorage.removeItem(DiffContextPreferencesStorageKey)
  })

  it('bounds automatic whole-file expansion by completeness, lines, and bytes', () => {
    assert.equal(canAutomaticallyExpandDiff(contents(['one', 'two'])), true)
    assert.equal(
      canAutomaticallyExpandDiff(
        contents(['partial'], { newContentsArePartial: true })
      ),
      false
    )
    assert.equal(
      canAutomaticallyExpandDiff(
        contents(new Array(MaxAutomaticallyExpandedDiffLines + 1).fill('x'))
      ),
      false
    )
    assert.equal(
      canAutomaticallyExpandDiff(
        contents(['x'], {
          newContentsByteLength: MaxAutomaticallyExpandedDiffBytes + 1,
        })
      ),
      false
    )
    assert.equal(
      canAutomaticallyExpandDiff(contents(['x'], { canBeExpanded: false })),
      false
    )
  })

  it('persists controls and switches all three language modes live', async () => {
    localStorage.removeItem(DiffContextPreferencesStorageKey)
    localStorage.setItem(
      'appearance-customization-v1',
      JSON.stringify({ version: 1, languageMode: 'english' })
    )
    const view = render(<DiffContextPreferencesControl />)

    try {
      const autoExpand = screen.getByRole('checkbox', {
        name: 'Automatically expand whole-file context',
      })
      fireEvent.click(autoExpand)
      assert.equal(readDiffContextPreferences().alwaysExpand, true)

      fireEvent.click(screen.getByRole('radio', { name: '100 lines' }))
      assert.equal(readDiffContextPreferences().contextLines, 100)

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'cantonese' })
      )
      await waitFor(() =>
        assert.ok(
          screen.getByRole('checkbox', {
            name: '自動攤開整份檔案內容',
          })
        )
      )
      assert.ok(screen.getByRole('radio', { name: '100 行' }))

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'bilingual' })
      )
      await waitFor(() => {
        assert.ok(
          screen.getByRole('checkbox', {
            name: /Automatically expand whole-file context.*自動攤開整份檔案內容/,
          })
        )
        assert.match(
          view.container.textContent ?? '',
          /Diff context · 差異上下文/
        )
      })
    } finally {
      view.unmount()
      localStorage.removeItem(DiffContextPreferencesStorageKey)
      localStorage.removeItem('appearance-customization-v1')
    }
  })
})
