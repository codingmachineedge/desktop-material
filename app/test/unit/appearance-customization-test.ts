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
    assert.deepEqual(
      parseAppearanceCustomization(
        JSON.stringify({ version: 1, padding: 'x'.repeat(33_000) })
      ),
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
    assert.equal(parsed.appIdentity.displayName, 'Desktop Material')
    assert.equal(parsed.repositoryLogo.version, 1)
    assert.equal('unexpected' in parsed, false)
  })

  it('migrates old v1 profiles and preserves newer nested identity keys', () => {
    const migrated = parseAppearanceCustomization(
      JSON.stringify({ version: 1, accentPalette: 'teal' })
    )
    assert.equal(migrated.appIdentity.displayName, 'Desktop Material')

    const parsed = parseAppearanceCustomization(
      JSON.stringify({
        version: 1,
        appIdentity: {
          displayName: 'Material Workbench',
          logo: 'terminal',
          logoColor: '#6750a4',
          fontFamily: 'Consolas',
          fontSize: 14,
          fontWeight: 700,
          textCase: 'uppercase',
          futureLogoTreatment: 'duotone',
        },
      })
    )

    assert.equal(parsed.appIdentity.displayName, 'Material Workbench')
    assert.equal(parsed.appIdentity.logo, 'terminal')
    assert.equal(parsed.appIdentity.fontFamily, 'Consolas')
    assert.equal(parsed.appIdentity.futureLogoTreatment, 'duotone')
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

  it('normalizes a local vector logo while keeping it repository-only', () => {
    const overrides = parseRepositoryAppearanceOverrides(
      JSON.stringify({
        version: 1,
        repositoryLogo: {
          version: 1,
          background: {
            shape: 'circle',
            fill: 'solid',
            primaryColor: '#123456',
          },
          layers: [
            {
              id: 'mark',
              type: 'mark',
              mark: 'star',
              color: 'url(javascript:bad)',
            },
          ],
        },
      })
    )

    assert.equal(overrides.repositoryLogo?.background.shape, 'circle')
    assert.equal(overrides.repositoryLogo?.background.primaryColor, '#123456')
    assert.equal(overrides.repositoryLogo?.layers[0]?.color, '#ffffff')
  })
})
