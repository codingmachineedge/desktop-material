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
        onChanged={overrides => changes.push(overrides)}
      />
    )

    const selects = view.container.querySelectorAll('select')
    assert.equal(selects.length, 6)
    assert.equal(selects[0].value, 'violet')

    fireEvent.change(selects[0], { target: { value: '' } })
    assert.deepEqual(changes.at(-1), { accentPalette: undefined })

    fireEvent.change(selects[1], { target: { value: 'neutral' } })
    assert.deepEqual(changes.at(-1), {
      accentPalette: 'violet',
      surfacePalette: 'neutral',
    })
  })
})
