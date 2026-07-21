import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import '../../helpers/ui/setup'
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { CloneableRepositoryListItem } from '../../../src/ui/clone-repository/cloneable-repository-filter-list'
import { ICloneableRepositoryListItem } from '../../../src/ui/clone-repository/group-repositories'
import * as octicons from '../../../src/ui/octicons/octicons.generated'
import { IMatches } from '../../../src/lib/fuzzy-find'

const noMatches: IMatches = { title: [], subtitle: [] }

function item(
  overrides: Partial<ICloneableRepositoryListItem>
): ICloneableRepositoryListItem {
  return {
    id: 'https://github.com/octocat/dugite',
    text: ['octocat/dugite'],
    url: 'https://github.com/octocat/dugite.git',
    name: 'dugite',
    icon: octicons.repo,
    isPrivate: false,
    description: 'Elegant bindings for Git',
    language: 'TypeScript',
    stargazers: 1200,
    forks: 210,
    sizeInKilobytes: 8100,
    defaultBranch: 'main',
    updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  }
}

function renderRow(
  listItem: ICloneableRepositoryListItem,
  {
    showMetadata = true,
    languageMode = 'english' as const,
  }: {
    showMetadata?: boolean
    languageMode?: 'english' | 'cantonese' | 'bilingual'
  } = {}
) {
  return renderToStaticMarkup(
    <CloneableRepositoryListItem
      item={listItem}
      matches={noMatches}
      checked={false}
      showMetadata={showMetadata}
      languageMode={languageMode}
    />
  )
}

describe('CloneableRepositoryListItem metadata card', () => {
  it('renders the description, language dot and every metric', () => {
    const markup = renderRow(item({}))

    assert.match(markup, /with-metadata/)
    assert.match(markup, /Elegant bindings for Git/)
    // Language dot painted with the TypeScript palette color.
    assert.match(markup, /lang-dot/)
    assert.match(markup, /#3178c6/)
    assert.match(markup, /TypeScript/)
    // Compact star/fork counts.
    assert.match(markup, /1[.,]2k/)
    assert.match(markup, /210/)
    // Size and default branch.
    assert.match(markup, /MB/)
    assert.match(markup, /main/)
    // Relative updated time.
    assert.match(markup, /ago/)
    // Metric icons come from the Material Symbols set.
    assert.match(markup, /star/)
    assert.match(markup, /fork_right/)
    assert.match(markup, /schedule/)
  })

  it('renders a Public visibility pill for a public repository', () => {
    const markup = renderRow(item({ isPrivate: false }))
    assert.match(markup, /visibility-pill/)
    assert.match(markup, /Public/)
    assert.match(markup, />public</)
  })

  it('renders a Private visibility pill with the lock glyph', () => {
    const markup = renderRow(item({ isPrivate: true }))
    assert.match(markup, /visibility-pill[^"]*private/)
    assert.match(markup, /Private/)
    assert.match(markup, />lock</)
  })

  it('shows the localized fallback when the description is blank', () => {
    const markup = renderRow(item({ description: null }))
    assert.match(markup, /No description provided/)
    assert.match(markup, /repo-description[^"]*empty/)
  })

  it('omits metrics that the API did not return (older GHES)', () => {
    const markup = renderRow(
      item({
        stargazers: undefined,
        forks: undefined,
        sizeInKilobytes: undefined,
        updatedAt: undefined,
        language: null,
      })
    )
    // The metadata container is still present (fixed row height) but the
    // absent metrics do not render.
    assert.match(markup, /repo-meta/)
    assert.doesNotMatch(markup, /fork_right/)
    assert.doesNotMatch(markup, /schedule/)
    assert.doesNotMatch(markup, /lang-dot/)
    // The default branch was still supplied, so it survives.
    assert.match(markup, /alt_route/)
  })

  it('localizes the metadata labels in Cantonese', () => {
    const markup = renderRow(item({ isPrivate: true }), {
      languageMode: 'cantonese',
    })
    assert.match(markup, /私人/)
    assert.match(markup, /未有描述|Elegant/)
  })

  it('localizes the metadata labels bilingually', () => {
    const markup = renderRow(item({ isPrivate: false }), {
      languageMode: 'bilingual',
    })
    // Bilingual visibility pill shows both languages separated by the middot.
    assert.match(markup, /Public · 公開/)
  })

  it('falls back to the compact single-line row when metadata is off', () => {
    const markup = renderRow(item({}), { showMetadata: false })
    assert.doesNotMatch(markup, /with-metadata/)
    assert.doesNotMatch(markup, /repo-meta/)
    assert.doesNotMatch(markup, /visibility-pill/)
    // The compact row still shows the repository name.
    assert.match(markup, /octocat\/dugite/)
  })
})
