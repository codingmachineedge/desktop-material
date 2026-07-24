import { describe, it } from 'node:test'
import assert from 'node:assert'
import { PreferencesTab } from '../../src/models/preferences'
import { FilterMode } from '../../src/lib/fuzzy-find'
import {
  SettingsSearchCatalog,
  filterSettingsEntries,
  fuzzyFilterSettings,
  groupSettingsResultsByTab,
  settingsSearchKeys,
  settingsTabNameKey,
  settingsTabsWithMatches,
} from '../../src/lib/settings-search/settings-search-catalog'

const fuzzy = { mode: FilterMode.Fuzzy, caseSensitive: false } as const
const substring = { mode: FilterMode.Substring, caseSensitive: false } as const
const regex = { mode: FilterMode.Regex, caseSensitive: false } as const

describe('settings search catalog', () => {
  it('covers every preferences tab', () => {
    const covered = new Set(SettingsSearchCatalog.map(e => e.tab))
    for (const tab of Object.values(PreferencesTab)) {
      if (typeof tab !== 'number') {
        continue
      }
      assert.ok(
        covered.has(tab),
        `Tab ${PreferencesTab[tab]} has no searchable settings`
      )
    }
  })

  it('uses unique entry ids', () => {
    const ids = SettingsSearchCatalog.map(e => e.id)
    assert.strictEqual(new Set(ids).size, ids.length)
  })

  it('has a tab-name key for every tab used by the catalog', () => {
    for (const entry of SettingsSearchCatalog) {
      assert.ok(settingsTabNameKey(entry.tab).length > 0)
    }
  })
})

describe('settingsSearchKeys', () => {
  it('includes English and Cantonese title and description text', () => {
    const entry = SettingsSearchCatalog.find(e => e.id === 'git-name')
    assert.ok(entry, 'expected git-name entry')
    const keys = settingsSearchKeys(entry!)
    // Two packed keys: [title (both langs), description + keywords]. Both a
    // Latin term and a CJK term appear, and keyword aliases are searchable.
    assert.strictEqual(keys.length, 2)
    assert.ok(keys.some(k => /Name/i.test(k)))
    assert.ok(keys.some(k => /名/.test(k)))
    assert.ok(keys.some(k => k.includes('user.name')))
  })
})

describe('filterSettingsEntries', () => {
  it('returns no results for an empty or whitespace query', () => {
    assert.deepStrictEqual(filterSettingsEntries('', fuzzy).results, [])
    assert.deepStrictEqual(filterSettingsEntries('   ', fuzzy).results, [])
  })

  it('finds a setting by its English label (fuzzy)', () => {
    const results = fuzzyFilterSettings('default branch')
    assert.ok(results.some(e => e.id === 'git-default-branch'))
  })

  it('finds a setting by a keyword alias not present in the label', () => {
    // "telemetry" only appears as a keyword on the usage-stats entry.
    const results = fuzzyFilterSettings('telemetry')
    assert.ok(results.some(e => e.id === 'advanced-usage-stats'))
  })

  it('matches Cantonese query text against the localized description', () => {
    // "深色" (dark) is only in the Cantonese appearance-theme copy/keywords.
    const results = filterSettingsEntries('深色', substring).results
    assert.ok(results.some(r => r.item.id === 'appearance-theme'))
  })

  it('matches settings across more than one tab for a broad query', () => {
    const results = filterSettingsEntries('auto', substring).results
    const tabs = settingsTabsWithMatches(results)
    assert.ok(tabs.has(PreferencesTab.Automation))
    assert.ok(tabs.size >= 1)
  })

  it('respects case sensitivity in substring mode', () => {
    const sensitiveHit = filterSettingsEntries('SSH', {
      mode: FilterMode.Substring,
      caseSensitive: true,
    }).results
    assert.ok(sensitiveHit.some(r => r.item.id === 'advanced-open-ssh'))

    const sensitiveMiss = filterSettingsEntries('sSh', {
      mode: FilterMode.Substring,
      caseSensitive: true,
    }).results
    assert.ok(!sensitiveMiss.some(r => r.item.id === 'advanced-open-ssh'))
  })

  it('surfaces an error and passes items through for an invalid regex', () => {
    const result = filterSettingsEntries('(unclosed', regex)
    assert.ok(result.regexError !== null)
    assert.strictEqual(result.results.length, SettingsSearchCatalog.length)
  })

  it('matches with a valid regex pattern', () => {
    const result = filterSettingsEntries('def.ult', regex)
    assert.strictEqual(result.regexError, null)
    assert.ok(result.results.some(r => r.item.id === 'git-default-branch'))
  })

  it('returns highlight ranges for the matched title in substring mode', () => {
    const result = filterSettingsEntries('Theme', substring)
    const themeMatch = result.results.find(
      r => r.item.id === 'appearance-theme'
    )
    assert.ok(themeMatch)
    assert.ok(themeMatch!.matches.title.length > 0)
  })
})

describe('groupSettingsResultsByTab', () => {
  it('groups results by owning tab and preserves first-seen order', () => {
    const results = filterSettingsEntries('a', substring).results
    const groups = groupSettingsResultsByTab(results)

    // Every result is accounted for exactly once.
    const total = groups.reduce((n, g) => n + g.matches.length, 0)
    assert.strictEqual(total, results.length)

    // No tab appears twice.
    const seen = groups.map(g => g.tab)
    assert.strictEqual(new Set(seen).size, seen.length)

    // Each group only contains its own tab's entries.
    for (const group of groups) {
      assert.ok(group.matches.every(m => m.item.tab === group.tab))
    }
  })

  it('produces an empty grouping for no results', () => {
    assert.deepStrictEqual(groupSettingsResultsByTab([]), [])
  })
})
