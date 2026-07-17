import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  DefaultRepositoryLogoDesign,
  getRepositoryLogoMonogram,
  MaxRepositoryLogoDocumentLength,
  MaxRepositoryLogoLayers,
  normalizeRepositoryLogoDesign,
  parseRepositoryLogoDesign,
  repositoryLogoText,
  serializeRepositoryLogoDesign,
} from '../../src/models/repository-logo'

describe('repository logo documents', () => {
  it('normalizes every visual field and enforces layer and transform caps', () => {
    const layers = Array.from(
      { length: MaxRepositoryLogoLayers + 5 },
      (_, i) => ({
        id: i < 2 ? 'duplicate' : `unsafe id ${i}`,
        type: i % 2 === 0 ? 'mark' : 'text',
        mark: 'not-a-mark',
        source: 'custom',
        text: `Layer ${i}\n${'x'.repeat(50)}`,
        font: 'javascript:bad',
        fontWeight: 999,
        letterSpacing: 99,
        x: -500,
        y: 500,
        scale: 99,
        rotation: -999,
        opacity: 8,
        color: 'url(javascript:bad)',
      })
    )
    const design = normalizeRepositoryLogoDesign({
      background: {
        shape: 'script',
        fill: 'gradient',
        primaryColor: 'red; background:url(bad)',
        secondaryColor: '#123456',
        gradientAngle: 999,
        borderWidth: 99,
        borderColor: 'currentColor',
        shadow: 'strong',
      },
      layers,
    })

    assert.equal(design.layers.length, MaxRepositoryLogoLayers)
    assert.equal(
      new Set(design.layers.map(layer => layer.id)).size,
      design.layers.length
    )
    assert.equal(design.background.shape, 'rounded')
    assert.equal(design.background.primaryColor, '#0969da')
    assert.equal(design.background.secondaryColor, '#123456')
    assert.equal(design.background.gradientAngle, 360)
    assert.equal(design.background.borderWidth, 6)
    assert.equal(design.layers[0].x, 0)
    assert.equal(design.layers[0].y, 100)
    assert.equal(design.layers[0].scale, 3)
    assert.equal(design.layers[0].rotation, -180)
    assert.equal(design.layers[0].opacity, 1)
    assert.equal(design.layers[0].color, '#ffffff')
    assert.equal(design.layers[0].type, 'mark')
    if (design.layers[0].type === 'mark') {
      assert.equal(design.layers[0].mark, 'repository')
    }
  })

  it('round-trips valid portable JSON and rejects invalid roots and oversized files', () => {
    const serialized = serializeRepositoryLogoDesign({
      ...DefaultRepositoryLogoDesign,
      background: {
        ...DefaultRepositoryLogoDesign.background,
        fill: 'gradient',
        primaryColor: '#123456',
      },
    })
    assert.deepEqual(parseRepositoryLogoDesign(serialized), {
      ...DefaultRepositoryLogoDesign,
      background: {
        ...DefaultRepositoryLogoDesign.background,
        fill: 'gradient',
        primaryColor: '#123456',
      },
    })
    assert.equal(parseRepositoryLogoDesign('{"version":2}'), null)
    assert.equal(parseRepositoryLogoDesign('[]'), null)
    assert.equal(
      parseRepositoryLogoDesign(
        'x'.repeat(MaxRepositoryLogoDocumentLength + 1)
      ),
      null
    )
  })

  it('derives bounded repository-name and monogram text without markup', () => {
    assert.equal(getRepositoryLogoMonogram('desktop-material'), 'DM')
    assert.equal(getRepositoryLogoMonogram('repository'), 'RE')
    const layer = {
      id: 'name',
      type: 'text' as const,
      source: 'repository-name' as const,
      text: '<script>alert(1)</script>',
      font: 'sans' as const,
      fontWeight: 700 as const,
      letterSpacing: 0,
      x: 50,
      y: 50,
      scale: 1,
      rotation: 0,
      opacity: 1,
      color: '#ffffff',
    }
    assert.equal(repositoryLogoText(layer, 'a'.repeat(80)).length, 24)
  })
})
