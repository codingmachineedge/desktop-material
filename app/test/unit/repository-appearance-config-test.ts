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
})
