import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as React from 'react'
import { MergeConflictPathPreview } from '../../../src/ui/lib/merge-conflict-path-preview'
import { render, screen } from '../../helpers/ui/render'

describe('Merge conflict path preview', () => {
  it('renders a bounded accessible list and an additional-path count', () => {
    const paths = Array.from(
      { length: 25 },
      (_, index) => `very/long/component-${index + 1}/conflict-file.ts`
    )
    render(<MergeConflictPathPreview paths={paths} />)

    const list = screen.getByRole('list', { name: 'Predicted conflict paths' })
    assert.equal(list.querySelectorAll('li').length, 20)
    assert.ok(screen.getByText(paths[0]))
    assert.equal(screen.queryByText(paths[20]), null)
    assert.ok(screen.getByText('5 additional conflict paths not shown.'))
  })

  it('renders nothing for a clean merge', () => {
    const view = render(<MergeConflictPathPreview paths={[]} />)
    assert.equal(view.container.textContent, '')
  })
})
