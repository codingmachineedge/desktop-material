import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { Repository } from '../../../src/models/repository'
import { GitIgnore } from '../../../src/ui/repository-settings/git-ignore'
import { fireEvent, render, screen } from '../../helpers/ui/render'

// The manager probes the working tree for suggestions on mount and logs a
// warning if that fails; provide a no-op logger so the async probe over a
// fixture path cannot crash the render.
;(globalThis as unknown as { log: unknown }).log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}

function noop() {}

function repository() {
  return new Repository('/desktop-material-gitignore-fixture', 1, null, false)
}

function renderManager() {
  return render(
    <GitIgnore
      repository={repository()}
      text={null}
      onIgnoreTextChanged={noop}
      onShowExamples={noop}
    />
  )
}

function openBrowse() {
  fireEvent.click(screen.getByRole('button', { name: 'Browse all templates' }))
}

describe('GitIgnore template catalog', () => {
  it('reports the full catalog window and every category when browsing', () => {
    renderManager()
    openBrowse()

    assert.ok(screen.getByText('Showing 1–19 of 19 templates'))
    // One representative template from each category is rendered.
    for (const label of [
      'Node',
      'Unity',
      'Visual Studio',
      'Terraform',
      'macOS',
    ]) {
      assert.ok(screen.getByText(label))
    }

    // 19 templates fit one page, so the pagination controls stay hidden.
    assert.equal(
      screen.queryByRole('navigation', { name: 'Template catalog pages' }),
      null
    )
  })

  it('filters the catalog by category with a live count', () => {
    renderManager()
    openBrowse()

    fireEvent.change(screen.getByLabelText('Filter templates by category'), {
      target: { value: 'language' },
    })
    assert.ok(screen.getByText('Showing 1–8 of 8 templates'))
    assert.ok(screen.getByText('Node'))
    // Templates from other categories are excluded.
    assert.equal(screen.queryByText('Unity'), null)
    assert.equal(screen.queryByText('Terraform'), null)
  })

  it('combines the search filter with the category filter', () => {
    renderManager()
    openBrowse()

    fireEvent.change(screen.getByLabelText('Filter templates by category'), {
      target: { value: 'language' },
    })
    fireEvent.change(screen.getByLabelText('Search templates'), {
      target: { value: 'py' },
    })
    assert.ok(screen.getByText('Showing 1–1 of 1 template'))
    assert.ok(screen.getByText('Python'))
    assert.equal(screen.queryByText('Node'), null)
  })

  it('shows an explicit empty state when nothing matches', () => {
    renderManager()
    openBrowse()

    fireEvent.change(screen.getByLabelText('Search templates'), {
      target: { value: 'no-such-template-xyz' },
    })
    assert.ok(screen.getByText('No templates match these filters'))
    assert.ok(screen.getByText(/Try another search or category/))
  })
})
