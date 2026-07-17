import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as React from 'react'
import { RepositoryAppearance } from '../../../src/ui/repository-settings/appearance'
import { fireEvent, render } from '../../helpers/ui/render'

describe('RepositoryAppearance', () => {
  it('offers app inheritance and reports repository overrides', () => {
    const changes: Array<object> = []
    const view = render(
      <RepositoryAppearance
        overrides={{ accentPalette: 'violet' }}
        isLoading={false}
        repositoryName="desktop-material"
        onChanged={overrides => changes.push(overrides)}
      />
    )

    const accent = view.container.querySelector<HTMLSelectElement>(
      'select[name="accentPalette"]'
    )!
    const surface = view.container.querySelector<HTMLSelectElement>(
      'select[name="surfacePalette"]'
    )!
    assert.equal(accent.value, 'violet')

    fireEvent.change(accent, { target: { value: '' } })
    assert.deepEqual(changes.at(-1), { accentPalette: undefined })

    fireEvent.change(surface, { target: { value: 'neutral' } })
    assert.deepEqual(changes.at(-1), {
      accentPalette: 'violet',
      surfacePalette: 'neutral',
    })
  })
})
