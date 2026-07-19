import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { StructuredDiff } from '../../src/ui/diff/structured-diff'
import { buildStructuredDiff } from '../../src/ui/diff/structured-diff-data'
import { LanguageModeChangedEvent } from '../../src/lib/i18n'
import { fireEvent, render, screen, waitFor } from '../helpers/ui/render'

describe('StructuredDiff', () => {
  it('renders an accessible table with row and cell change semantics', () => {
    const result = buildStructuredDiff(
      'people.csv',
      'id,name\n1,Ada\n2,Grace',
      'id,name\n1,Ada Lovelace\n3,Lin\n4,Katherine'
    )
    assert.equal(result.kind, 'table')
    if (result.kind !== 'table') {
      return
    }

    const view = render(
      <StructuredDiff data={result.data} readOnly={true} codeDiff={null} />
    )

    assert.ok(screen.getByRole('table', { name: 'CSV table diff' }))
    assert.ok(screen.getByRole('columnheader', { name: 'Column 1' }))
    assert.ok(view.container.querySelector('tr[data-diff-status="changed"]'))
    assert.ok(view.container.querySelector('tr[data-diff-status="added"]'))
    const changedCell = view.container.querySelector(
      'td[data-diff-status="changed"]'
    )
    assert.ok(changedCell)
    assert.match(changedCell.textContent ?? '', /Ada/)
    assert.match(changedCell.textContent ?? '', /Ada Lovelace/)
    assert.ok(changedCell.querySelector('del'))
    assert.ok(changedCell.querySelector('ins'))
  })

  it('keeps the original writable code diff interactive behind the toggle', () => {
    const result = buildStructuredDiff(
      'people.tsv',
      'id\tname\n1\tAda',
      'id\tname\n1\tGrace'
    )
    assert.equal(result.kind, 'table')
    if (result.kind !== 'table') {
      return
    }

    let selections = 0
    render(
      <StructuredDiff
        data={result.data}
        readOnly={false}
        codeDiff={
          <button onClick={() => selections++}>Select changed line</button>
        }
      />
    )

    assert.ok(screen.getByText(/Switch to Code/))
    fireEvent.click(screen.getByRole('button', { name: 'Code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select changed line' }))
    assert.equal(selections, 1)
    assert.equal(screen.queryByRole('table'), null)

    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    assert.ok(screen.getByRole('table', { name: 'TSV table diff' }))
  })

  it('reacts to English, Cantonese, and bilingual language changes', async () => {
    const result = buildStructuredDiff('data.csv', 'a\n1', 'a\n2')
    assert.equal(result.kind, 'table')
    if (result.kind !== 'table') {
      return
    }

    localStorage.setItem(
      'appearance-customization-v1',
      JSON.stringify({ version: 1, languageMode: 'english' })
    )
    const view = render(
      <StructuredDiff data={result.data} readOnly={true} codeDiff={null} />
    )

    try {
      assert.ok(screen.getByRole('button', { name: 'Code' }))

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'cantonese' })
      )
      await waitFor(() =>
        assert.ok(screen.getByRole('button', { name: '程式碼' }))
      )

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'bilingual' })
      )
      await waitFor(() => {
        assert.ok(screen.getByRole('button', { name: 'Code' }))
        assert.match(view.container.textContent ?? '', /Code · 程式碼/)
      })
    } finally {
      view.unmount()
      localStorage.removeItem('appearance-customization-v1')
    }
  })
})
