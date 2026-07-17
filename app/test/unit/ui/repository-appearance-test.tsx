import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as React from 'react'
import { RepositoryAppearance } from '../../../src/ui/repository-settings/appearance'
import { fireEvent, render, screen, within } from '../../helpers/ui/render'

describe('RepositoryAppearance', () => {
  it('reports overrides and inheritance through swatches and segmented chips', () => {
    const changes: Array<object> = []
    render(
      <RepositoryAppearance
        overrides={{ accentPalette: 'violet' }}
        isLoading={false}
        repositoryName="desktop-material"
        onChanged={overrides => changes.push(overrides)}
      />
    )

    // The current accent swatch is pressed.
    const accentGroup = screen.getByRole('group', { name: 'Accent color' })
    const violet = within(accentGroup).getByRole('button', { name: 'Violet' })
    assert.equal(violet.getAttribute('aria-pressed'), 'true')

    // Inheriting the accent clears the override.
    fireEvent.click(
      within(accentGroup).getByRole('button', { name: 'Inherit' })
    )
    assert.deepEqual(changes.at(-1), { accentPalette: undefined })

    // Choosing a surface reports it alongside the retained accent.
    const surfaceGroup = screen.getByRole('group', { name: 'Surface color' })
    fireEvent.click(
      within(surfaceGroup).getByRole('button', { name: 'Neutral' })
    )
    assert.deepEqual(changes.at(-1), {
      accentPalette: 'violet',
      surfacePalette: 'neutral',
    })
  })

  it('edits the list-name typography with style toggles and colors', () => {
    const changes: Array<{ listNameStyle?: object }> = []
    render(
      <RepositoryAppearance
        overrides={{}}
        isLoading={false}
        repositoryName="desktop-material"
        onChanged={overrides => changes.push(overrides)}
      />
    )

    const styleGroup = screen.getByRole('group', { name: 'Font style' })
    fireEvent.click(within(styleGroup).getByRole('button', { name: 'Bold' }))
    assert.deepEqual(changes.at(-1)?.listNameStyle, { bold: true })

    const colorGroup = screen.getByRole('group', { name: 'Text color' })
    fireEvent.click(within(colorGroup).getByRole('button', { name: 'Blue' }))
    assert.equal(
      (changes.at(-1)?.listNameStyle as { color?: string }).color,
      '#006493'
    )
  })
})
