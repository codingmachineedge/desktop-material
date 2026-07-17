import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import {
  DefaultRepositoryLogoDesign,
  IRepositoryLogoDesign,
} from '../../../src/models/repository-logo'
import { RepositoryLogo } from '../../../src/ui/repository-logo/repository-logo'
import { RepositoryLogoStudio } from '../../../src/ui/repository-logo/repository-logo-studio'
import { fireEvent, render, screen } from '../../helpers/ui/render'

describe('RepositoryLogo', () => {
  it('renders only normalized vector primitives and escapes custom text', () => {
    const design = {
      ...DefaultRepositoryLogoDesign,
      background: {
        ...DefaultRepositoryLogoDesign.background,
        fill: 'gradient' as const,
        primaryColor: '#123456',
        secondaryColor: '#abcdef',
      },
      layers: [
        {
          id: 'name',
          type: 'text' as const,
          source: 'custom' as const,
          text: '<script>ignored</script>',
          font: 'sans' as const,
          fontWeight: 700 as const,
          letterSpacing: 0,
          x: 50,
          y: 50,
          scale: 1,
          rotation: 0,
          opacity: 1,
          color: '#ffffff',
        },
      ],
    }
    const view = render(
      <RepositoryLogo
        design={design}
        repositoryName="desktop-material"
        title="Repository logo"
      />
    )
    assert.ok(screen.getByRole('img', { name: 'Repository logo' }))
    assert.equal(view.container.querySelector('script'), null)
    assert.equal(
      view.container.querySelector('text')?.textContent,
      '<script>ignored</script>'
    )
    assert.equal(
      view.container.querySelectorAll('linearGradient stop').length,
      2
    )
  })
})

describe('RepositoryLogoStudio', () => {
  it('edits layers with bounded undo and redo and exposes name presets', () => {
    const changes: IRepositoryLogoDesign[] = []
    render(
      <RepositoryLogoStudio
        value={DefaultRepositoryLogoDesign}
        repositoryName="desktop-material"
        onChange={design => changes.push(design)}
      />
    )

    assert.ok(screen.getByRole('img', { name: /Live logo preview/ }))
    assert.ok(screen.getByRole('button', { name: 'Import JSON…' }))
    assert.ok(screen.getByRole('button', { name: 'Export JSON…' }))
    assert.match(screen.getByText(/1 of 8/).textContent ?? '', /1 of 8/)
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    assert.ok(screen.getByText(/2 of 8/))
    assert.equal(changes.at(-1)?.layers.length, 2)

    const layerTabs = screen.getAllByRole('tab')
    assert.equal(layerTabs[0].tabIndex, -1)
    assert.equal(layerTabs[1].tabIndex, 0)
    layerTabs[1].focus()
    fireEvent.keyDown(layerTabs[1], { key: 'ArrowLeft' })
    assert.equal(document.activeElement, layerTabs[0])
    assert.equal(layerTabs[0].getAttribute('aria-selected'), 'true')

    fireEvent.click(layerTabs[1])

    const horizontal = document.querySelector<HTMLInputElement>(
      '.repository-logo-layer-editor input[name="x"]'
    )!
    fireEvent.change(horizontal, {
      target: { value: '74' },
    })
    assert.equal(changes.at(-1)?.layers[1]?.x, 74)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    assert.notEqual(changes.at(-1)?.layers[1]?.x, 74)
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    assert.equal(changes.at(-1)?.layers[1]?.x, 74)

    fireEvent.click(screen.getByRole('button', { name: 'Repository name' }))
    const layer = changes.at(-1)?.layers[0]
    assert.equal(layer?.type, 'text')
    if (layer?.type === 'text') {
      assert.equal(layer.source, 'repository-name')
    }
  })

  it('can return a repository override to the inherited profile design', () => {
    let inherited = 0
    render(
      <RepositoryLogoStudio
        value={DefaultRepositoryLogoDesign}
        repositoryName="desktop-material"
        isInherited={false}
        onChange={() => undefined}
        onInherit={() => inherited++}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Inherit profile logo' })
    )
    assert.equal(inherited, 1)
  })

  it('edits gradient, border, shadow, mark, and text typography controls', () => {
    const changes: IRepositoryLogoDesign[] = []
    render(
      <RepositoryLogoStudio
        value={DefaultRepositoryLogoDesign}
        repositoryName="desktop-material"
        onChange={design => changes.push(design)}
      />
    )
    fireEvent.change(screen.getByLabelText('Fill'), {
      target: { value: 'gradient' },
    })
    assert.ok(screen.getByText('End color'))
    fireEvent.change(screen.getByLabelText('Shape'), {
      target: { value: 'hexagon' },
    })
    fireEvent.change(screen.getByLabelText('Shadow'), {
      target: { value: 'strong' },
    })
    fireEvent.change(screen.getByLabelText('Mark'), {
      target: { value: 'star' },
    })
    const borderWidth = document.querySelector<HTMLInputElement>(
      'input[name="borderWidth"]'
    )!
    fireEvent.change(borderWidth, { target: { value: '4' } })
    assert.equal(changes.at(-1)?.background.fill, 'gradient')
    assert.equal(changes.at(-1)?.background.shape, 'hexagon')
    assert.equal(changes.at(-1)?.background.shadow, 'strong')
    assert.equal(changes.at(-1)?.background.borderWidth, 4)
    const mark = changes.at(-1)?.layers[0]
    assert.equal(mark?.type, 'mark')
    if (mark?.type === 'mark') {
      assert.equal(mark.mark, 'star')
    }

    fireEvent.click(screen.getByRole('button', { name: 'Add text' }))
    fireEvent.change(screen.getByLabelText('Weight'), {
      target: { value: '800' },
    })
    const text = changes.at(-1)?.layers.at(-1)
    assert.equal(text?.type, 'text')
    if (text?.type === 'text') {
      assert.equal(text.fontWeight, 800)
    }
  })
})
