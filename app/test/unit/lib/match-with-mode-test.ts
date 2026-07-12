import { describe, it } from 'node:test'
import assert from 'node:assert'
import { FilterMode, match, matchWithMode } from '../../../src/lib/fuzzy-find'
import { getText } from '../../../src/ui/lib/filter-list'

describe('matchWithMode', () => {
  const items = [
    { id: '1', text: ['desktop-material', 'a material fork'] },
    { id: '2', text: ['Desktop-Plus', 'another fork'] },
    { id: '3', text: ['tokens', 'design tokens list'] },
  ]

  describe('fuzzy mode', () => {
    it('delegates to the existing match implementation', () => {
      const viaMode = matchWithMode('tokens', items, getText, {
        mode: FilterMode.Fuzzy,
        caseSensitive: false,
      })
      const direct = match('tokens', items, getText)

      assert.equal(viaMode.regexError, null)
      assert.deepEqual(
        viaMode.results.map(r => r.item.id),
        direct.map(r => r.item.id)
      )
    })

    it('is case insensitive', () => {
      const result = matchWithMode('DESKTOP', items, getText, {
        mode: FilterMode.Fuzzy,
        caseSensitive: false,
      })

      assert(result.results.length >= 1)
    })
  })

  describe('substring mode', () => {
    it('matches a contiguous substring and preserves order', () => {
      const result = matchWithMode('fork', items, getText, {
        mode: FilterMode.Substring,
        caseSensitive: false,
      })

      assert.equal(result.regexError, null)
      assert.deepEqual(
        result.results.map(r => r.item.id),
        ['1', '2']
      )
    })

    it('honours case sensitivity', () => {
      const insensitive = matchWithMode('desktop', items, getText, {
        mode: FilterMode.Substring,
        caseSensitive: false,
      })
      assert.deepEqual(
        insensitive.results.map(r => r.item.id),
        ['1', '2']
      )

      const sensitive = matchWithMode('desktop', items, getText, {
        mode: FilterMode.Substring,
        caseSensitive: true,
      })
      assert.deepEqual(
        sensitive.results.map(r => r.item.id),
        ['1']
      )
    })

    it('produces contiguous highlight indices for the title', () => {
      const result = matchWithMode('material', items, getText, {
        mode: FilterMode.Substring,
        caseSensitive: false,
      })

      const first = result.results.find(r => r.item.id === '1')
      assert(first !== undefined)
      // 'desktop-material' -> 'material' starts at index 8
      assert.deepEqual(first!.matches.title, [8, 9, 10, 11, 12, 13, 14, 15])
    })

    it('returns nothing when there is no substring match', () => {
      const result = matchWithMode('zzz', items, getText, {
        mode: FilterMode.Substring,
        caseSensitive: false,
      })

      assert.equal(result.results.length, 0)
    })
  })

  describe('regex mode', () => {
    it('matches items using a valid pattern', () => {
      const result = matchWithMode('^desktop', items, getText, {
        mode: FilterMode.Regex,
        caseSensitive: false,
      })

      assert.equal(result.regexError, null)
      assert.deepEqual(
        result.results.map(r => r.item.id),
        ['1', '2']
      )
    })

    it('honours case sensitivity', () => {
      const result = matchWithMode('^Desktop', items, getText, {
        mode: FilterMode.Regex,
        caseSensitive: true,
      })

      assert.deepEqual(
        result.results.map(r => r.item.id),
        ['2']
      )
    })

    it('returns all items and an error for an invalid pattern', () => {
      const result = matchWithMode('(', items, getText, {
        mode: FilterMode.Regex,
        caseSensitive: false,
      })

      assert.notEqual(result.regexError, null)
      assert.equal(result.results.length, items.length)
    })

    it('rejects patterns over the length cap', () => {
      const longPattern = 'a'.repeat(1001)
      const result = matchWithMode(longPattern, items, getText, {
        mode: FilterMode.Regex,
        caseSensitive: false,
      })

      assert.notEqual(result.regexError, null)
      assert.equal(result.results.length, items.length)
    })

    it('does not hang on zero-width matches', () => {
      const result = matchWithMode('^', items, getText, {
        mode: FilterMode.Regex,
        caseSensitive: false,
      })

      assert.equal(result.regexError, null)
      assert.equal(result.results.length, items.length)
    })
  })
})
