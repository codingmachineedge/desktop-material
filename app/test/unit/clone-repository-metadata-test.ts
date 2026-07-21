import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  formatRepositoryCount,
  formatRepositorySize,
  formatRepositoryUpdated,
  getLanguageColor,
  getRepositoryLanguages,
  NeutralLanguageColor,
} from '../../src/ui/clone-repository/repository-metadata'
import {
  filterRepositoriesByLanguage,
  groupRepositories,
} from '../../src/ui/clone-repository/group-repositories'
import { IAPIIdentity, IAPIRepository } from '../../src/lib/api'

const owner: IAPIIdentity = {
  id: 1,
  login: 'octocat',
  avatar_url: '',
  html_url: '',
  type: 'User',
}

function repo(overrides: Partial<IAPIRepository>): IAPIRepository {
  return {
    clone_url: `https://github.com/octocat/${overrides.name ?? 'repo'}.git`,
    ssh_url: '',
    html_url: `https://github.com/octocat/${overrides.name ?? 'repo'}`,
    name: overrides.name ?? 'repo',
    owner,
    private: false,
    fork: false,
    default_branch: 'main',
    pushed_at: '2020-01-01T00:00:00Z',
    has_issues: true,
    archived: false,
    ...overrides,
  }
}

describe('getLanguageColor', () => {
  it('returns the palette color for a known language', () => {
    assert.strictEqual(getLanguageColor('TypeScript'), '#3178c6')
    assert.strictEqual(getLanguageColor('Ruby'), '#701516')
  })

  it('matches case-insensitively', () => {
    assert.strictEqual(getLanguageColor('typescript'), '#3178c6')
    assert.strictEqual(getLanguageColor('TYPESCRIPT'), '#3178c6')
  })

  it('falls back to the neutral token for unknown or empty languages', () => {
    assert.strictEqual(getLanguageColor('Whitespace'), NeutralLanguageColor)
    assert.strictEqual(getLanguageColor(null), NeutralLanguageColor)
    assert.strictEqual(getLanguageColor(undefined), NeutralLanguageColor)
    assert.strictEqual(getLanguageColor(''), NeutralLanguageColor)
  })
})

describe('getRepositoryLanguages', () => {
  it('returns the distinct languages sorted alphabetically', () => {
    const languages = getRepositoryLanguages([
      repo({ name: 'a', language: 'TypeScript' }),
      repo({ name: 'b', language: 'Ruby' }),
      repo({ name: 'c', language: 'Shell' }),
    ])
    assert.deepStrictEqual([...languages], ['Ruby', 'Shell', 'TypeScript'])
  })

  it('deduplicates case-insensitively, keeping first-seen casing', () => {
    const languages = getRepositoryLanguages([
      repo({ name: 'a', language: 'TypeScript' }),
      repo({ name: 'b', language: 'typescript' }),
    ])
    assert.deepStrictEqual([...languages], ['TypeScript'])
  })

  it('ignores repositories without a detected language', () => {
    const languages = getRepositoryLanguages([
      repo({ name: 'a', language: null }),
      repo({ name: 'b', language: undefined }),
      repo({ name: 'c', language: '' }),
      repo({ name: 'd', language: 'Go' }),
    ])
    assert.deepStrictEqual([...languages], ['Go'])
  })

  it('returns an empty array for a null listing', () => {
    assert.deepStrictEqual([...getRepositoryLanguages(null)], [])
  })
})

describe('formatRepositoryCount', () => {
  it('formats large counts compactly', () => {
    assert.match(formatRepositoryCount(4300)!, /4[.,]3k/)
    assert.match(formatRepositoryCount(1200)!, /1[.,]2k/)
  })

  it('leaves small counts as plain integers', () => {
    assert.strictEqual(formatRepositoryCount(210), '210')
    assert.strictEqual(formatRepositoryCount(0), '0')
  })

  it('returns null when the count is unavailable', () => {
    assert.strictEqual(formatRepositoryCount(undefined), null)
    assert.strictEqual(formatRepositoryCount(null), null)
  })
})

describe('formatRepositorySize', () => {
  it('scales kilobytes into a human byte string', () => {
    assert.match(formatRepositorySize(8100)!, /MB$/)
    assert.match(formatRepositorySize(200)!, /KB$/)
  })

  it('handles a zero-size repository', () => {
    assert.match(formatRepositorySize(0)!, /B$/)
  })

  it('returns null when the size is unavailable', () => {
    assert.strictEqual(formatRepositorySize(undefined), null)
    assert.strictEqual(formatRepositorySize(null), null)
  })
})

describe('formatRepositoryUpdated', () => {
  it('renders a relative "ago" string for a past timestamp', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    assert.match(formatRepositoryUpdated(twoDaysAgo.toISOString())!, /ago/)
  })

  it('returns null for missing or unparseable timestamps', () => {
    assert.strictEqual(formatRepositoryUpdated(undefined), null)
    assert.strictEqual(formatRepositoryUpdated(null), null)
    assert.strictEqual(formatRepositoryUpdated(''), null)
    assert.strictEqual(formatRepositoryUpdated('not-a-date'), null)
  })
})

describe('filterRepositoriesByLanguage', () => {
  const repositories = [
    repo({ name: 'a', language: 'TypeScript' }),
    repo({ name: 'b', language: 'Ruby' }),
    repo({ name: 'c', language: 'Shell' }),
    repo({ name: 'd', language: null }),
  ]

  it('returns the list unchanged for an empty selection', () => {
    const result = filterRepositoriesByLanguage(repositories, new Set())
    assert.strictEqual(result, repositories)
  })

  it('narrows to the selected languages (case-insensitively)', () => {
    const result = filterRepositoriesByLanguage(
      repositories,
      new Set(['typescript', 'shell'])
    )
    assert.deepStrictEqual(
      result.map(r => r.name),
      ['a', 'c']
    )
  })

  it('excludes repositories without a language when a filter is active', () => {
    const result = filterRepositoriesByLanguage(
      repositories,
      new Set(['TypeScript'])
    )
    assert.deepStrictEqual(
      result.map(r => r.name),
      ['a']
    )
  })
})

describe('groupRepositories metadata mapping', () => {
  it('carries the rich metadata onto every list item', () => {
    const groups = groupRepositories(
      [
        repo({
          name: 'dugite',
          private: true,
          description: 'Elegant bindings for Git',
          language: 'TypeScript',
          stargazers_count: 1200,
          forks_count: 210,
          size: 8100,
          default_branch: 'trunk',
          updated_at: '2020-05-01T00:00:00Z',
        }),
      ],
      'octocat'
    )

    const item = groups[0].items[0]
    assert.strictEqual(item.isPrivate, true)
    assert.strictEqual(item.description, 'Elegant bindings for Git')
    assert.strictEqual(item.language, 'TypeScript')
    assert.strictEqual(item.stargazers, 1200)
    assert.strictEqual(item.forks, 210)
    assert.strictEqual(item.sizeInKilobytes, 8100)
    assert.strictEqual(item.defaultBranch, 'trunk')
    assert.strictEqual(item.updatedAt, '2020-05-01T00:00:00Z')
  })

  it('leaves optional metadata undefined for a sparse (older-GHES) repository', () => {
    const groups = groupRepositories(
      [repo({ name: 'legacy', private: false })],
      'octocat'
    )
    const item = groups[0].items[0]
    assert.strictEqual(item.isPrivate, false)
    assert.strictEqual(item.stargazers, undefined)
    assert.strictEqual(item.language, undefined)
    assert.strictEqual(item.sizeInKilobytes, undefined)
  })
})
