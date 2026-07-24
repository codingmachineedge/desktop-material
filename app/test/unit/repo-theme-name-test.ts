import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  deriveRepositoryTheme,
  repositoryThemeRootLabel,
} from '../../src/lib/audio/repo-theme'
import { repositoryThemeName } from '../../src/lib/audio/repo-theme-name'

const theme = deriveRepositoryTheme('facebook/react')

describe('repositoryThemeName', () => {
  it('reads as an English "Mood Texture in Root Scale" phrase', () => {
    const name = repositoryThemeName(theme, 'english')
    const root = repositoryThemeRootLabel(theme)
    assert.match(name, /^[A-Z][a-z]+ [A-Z][a-z]+ in /)
    assert.ok(name.includes(` in ${root} `))
  })

  it('renders a Cantonese name carrying the root and scale', () => {
    const name = repositoryThemeName(theme, 'cantonese')
    const root = repositoryThemeRootLabel(theme)
    assert.ok(name.includes(root))
    // Cantonese copy uses CJK characters for the mood/texture/scale words.
    assert.match(name, /[一-鿿]/)
  })

  it('joins both languages in bilingual mode', () => {
    const name = repositoryThemeName(theme, 'bilingual')
    assert.ok(name.includes(' · '))
    assert.ok(name.includes(repositoryThemeName(theme, 'english')))
  })

  it('is deterministic for a given theme and mode', () => {
    assert.strictEqual(
      repositoryThemeName(theme, 'english'),
      repositoryThemeName(theme, 'english')
    )
  })
})
