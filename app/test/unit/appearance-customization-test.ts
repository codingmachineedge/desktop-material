import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  DefaultAppearanceCustomization,
  normalizeAppearanceCustomization,
  parseAppearanceCustomization,
  parseRepositoryAppearanceOverrides,
  resolveAppearanceCustomization,
} from '../../src/models/appearance-customization'

describe('appearance customization', () => {
  it('uses defaults for missing, malformed, oversized, or unversioned values', () => {
    assert.deepEqual(
      parseAppearanceCustomization(null),
      DefaultAppearanceCustomization
    )
    assert.deepEqual(
      parseAppearanceCustomization('{not json'),
      DefaultAppearanceCustomization
    )
    assert.deepEqual(
      parseAppearanceCustomization(JSON.stringify({ accentPalette: 'rose' })),
      DefaultAppearanceCustomization
    )
    assert.deepEqual(
      parseAppearanceCustomization('x'.repeat(4097)),
      DefaultAppearanceCustomization
    )
  })

  it('keeps valid values and replaces invalid fields independently', () => {
    const parsed = parseAppearanceCustomization(
      JSON.stringify({
        version: 1,
        accentPalette: 'violet',
        surfacePalette: 'not-css',
        motion: 'reduced',
        tabWidth: 'wide',
        unexpected: 'ignored',
      })
    )

    assert.equal(parsed.accentPalette, 'violet')
    assert.equal(parsed.surfacePalette, 'tonal')
    assert.equal(parsed.motion, 'reduced')
    assert.equal(parsed.tabWidth, 'wide')
    assert.equal('unexpected' in parsed, false)
  })

  it('normalizes internal updates before persistence', () => {
    const normalized = normalizeAppearanceCustomization({
      ...DefaultAppearanceCustomization,
      toolbarDensity: 'compact',
      uiFont: 'url(javascript:bad)',
    })

    assert.equal(normalized.toolbarDensity, 'compact')
    assert.equal(normalized.uiFont, 'material')
  })

  it('allowlists repository overrides and resolves them over profile values', () => {
    const overrides = parseRepositoryAppearanceOverrides(
      JSON.stringify({
        version: 1,
        accentPalette: 'amber',
        tabWidth: 'compact',
        motion: 'reduced',
        uiFont: 'system',
        toolbarDensity: 'invalid',
      })
    )

    assert.deepEqual(overrides, {
      accentPalette: 'amber',
      tabWidth: 'compact',
    })

    const resolved = resolveAppearanceCustomization(
      {
        ...DefaultAppearanceCustomization,
        surfacePalette: 'neutral',
        tabWidth: 'wide',
      },
      overrides
    )
    assert.equal(resolved.accentPalette, 'amber')
    assert.equal(resolved.surfacePalette, 'neutral')
    assert.equal(resolved.tabWidth, 'compact')
  })
})
