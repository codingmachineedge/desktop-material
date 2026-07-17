import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Repository } from '../../src/models/repository'
import {
  getRepositoryAppearanceOverrides,
  RepositoryAppearanceConfigKey,
  setRepositoryAppearanceOverrides,
} from '../../src/lib/appearance-customization'
import { getConfigValue, setConfigValue } from '../../src/lib/git/config'
import { setupFixtureRepository } from '../helpers/repositories'
import { DefaultRepositoryLogoDesign } from '../../src/models/repository-logo'

describe('repository appearance config', () => {
  it('round-trips allowlisted overrides through local Git config', async t => {
    const path = await setupFixtureRepository(t, 'test-repo')
    const repository = new Repository(path, -1, null, false)

    const saved = await setRepositoryAppearanceOverrides(repository, {
      accentPalette: 'rose',
      toolbarDensity: 'compact',
      tabWidth: 'wide',
    })

    assert.deepEqual(saved, {
      accentPalette: 'rose',
      toolbarDensity: 'compact',
      tabWidth: 'wide',
    })
    assert.deepEqual(await getRepositoryAppearanceOverrides(repository), saved)
    assert.match(
      (await getConfigValue(repository, RepositoryAppearanceConfigKey, true))!,
      /"version":1/
    )
  })

  it('ignores malformed and non-allowlisted repository values', async t => {
    const path = await setupFixtureRepository(t, 'test-repo')
    const repository = new Repository(path, -1, null, false)
    await setConfigValue(
      repository,
      RepositoryAppearanceConfigKey,
      JSON.stringify({
        version: 1,
        accentPalette: 'url(javascript:bad)',
        motion: 'reduced',
      })
    )

    assert.deepEqual(await getRepositoryAppearanceOverrides(repository), {})
  })

  it('round-trips the repository list-name typography override', async t => {
    const path = await setupFixtureRepository(t, 'test-repo')
    const repository = new Repository(path, -1, null, false)

    const saved = await setRepositoryAppearanceOverrides(repository, {
      listNameStyle: {
        fontFamily: 'Georgia',
        fontSize: 16,
        bold: true,
      },
    })

    assert.deepEqual(saved.listNameStyle, {
      fontFamily: 'Georgia',
      fontSize: 16,
      bold: true,
    })
    assert.deepEqual(
      (await getRepositoryAppearanceOverrides(repository)).listNameStyle,
      saved.listNameStyle
    )
    assert.match(
      (await getConfigValue(repository, RepositoryAppearanceConfigKey, true))!,
      /"listNameStyle"/
    )
  })

  it('persists a normalized vector logo only in local Git config', async t => {
    const path = await setupFixtureRepository(t, 'test-repo')
    const repository = new Repository(path, -1, null, false)
    const saved = await setRepositoryAppearanceOverrides(repository, {
      repositoryLogo: {
        ...DefaultRepositoryLogoDesign,
        background: {
          ...DefaultRepositoryLogoDesign.background,
          shape: 'hexagon',
          primaryColor: '#123456',
        },
      },
    })
    assert.equal(saved.repositoryLogo?.background.shape, 'hexagon')
    assert.equal(
      (await getRepositoryAppearanceOverrides(repository)).repositoryLogo
        ?.background.primaryColor,
      '#123456'
    )
    const config = await getConfigValue(
      repository,
      RepositoryAppearanceConfigKey,
      true
    )
    assert.match(config ?? '', /"repositoryLogo"/)
  })
})
