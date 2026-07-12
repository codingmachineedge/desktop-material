import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  RegexBlock,
  RegexBlockKind,
  blocksToPattern,
  escapeLiteral,
  explainBlocks,
  flagsToString,
} from '../../../src/ui/lib/regex-builder/regex-block-model'

describe('regex-block-model', () => {
  describe('escapeLiteral', () => {
    it('escapes regex metacharacters', () => {
      assert.equal(escapeLiteral('a.b*c'), 'a\\.b\\*c')
      assert.equal(escapeLiteral('(x)'), '\\(x\\)')
      assert.equal(escapeLiteral('a+b'), 'a\\+b')
    })

    it('leaves plain text untouched', () => {
      assert.equal(escapeLiteral('desktop'), 'desktop')
    })
  })

  describe('flagsToString', () => {
    it('emits flags in canonical order', () => {
      assert.equal(
        flagsToString({
          g: true,
          i: true,
          m: false,
          s: false,
          u: true,
          y: false,
        }),
        'giu'
      )
    })

    it('returns an empty string when no flags are set', () => {
      assert.equal(
        flagsToString({
          g: false,
          i: false,
          m: false,
          s: false,
          u: false,
          y: false,
        }),
        ''
      )
    })
  })

  describe('blocksToPattern', () => {
    it('escapes literal blocks', () => {
      const blocks: ReadonlyArray<RegexBlock> = [
        { kind: RegexBlockKind.Literal, value: 'a.b' },
      ]
      assert.equal(blocksToPattern(blocks), 'a\\.b')
    })

    it('emits character classes and anchors verbatim', () => {
      const blocks: ReadonlyArray<RegexBlock> = [
        { kind: RegexBlockKind.Anchor, value: '^' },
        { kind: RegexBlockKind.CharClass, value: '\\d' },
        { kind: RegexBlockKind.Anchor, value: '$' },
      ]
      assert.equal(blocksToPattern(blocks), '^\\d$')
    })

    it('serialises quantifiers including lazy variants', () => {
      assert.equal(
        blocksToPattern([
          { kind: RegexBlockKind.CharClass, value: '\\w' },
          { kind: RegexBlockKind.Quantifier, quantifier: 'plus', lazy: false },
        ]),
        '\\w+'
      )

      assert.equal(
        blocksToPattern([
          { kind: RegexBlockKind.CharClass, value: '.' },
          { kind: RegexBlockKind.Quantifier, quantifier: 'star', lazy: true },
        ]),
        '.*?'
      )

      assert.equal(
        blocksToPattern([
          { kind: RegexBlockKind.CharClass, value: '\\d' },
          {
            kind: RegexBlockKind.Quantifier,
            quantifier: 'range',
            min: 2,
            max: 5,
            lazy: false,
          },
        ]),
        '\\d{2,5}'
      )
    })

    it('serialises capturing, non-capturing and named groups', () => {
      assert.equal(
        blocksToPattern([
          {
            kind: RegexBlockKind.Group,
            groupType: 'capturing',
            children: [{ kind: RegexBlockKind.Literal, value: 'ab' }],
          },
        ]),
        '(ab)'
      )

      assert.equal(
        blocksToPattern([
          {
            kind: RegexBlockKind.Group,
            groupType: 'nonCapturing',
            children: [{ kind: RegexBlockKind.Literal, value: 'ab' }],
          },
        ]),
        '(?:ab)'
      )

      assert.equal(
        blocksToPattern([
          {
            kind: RegexBlockKind.Group,
            groupType: 'named',
            name: 'word',
            children: [{ kind: RegexBlockKind.CharClass, value: '\\w' }],
          },
        ]),
        '(?<word>\\w)'
      )
    })

    it('serialises alternations', () => {
      assert.equal(
        blocksToPattern([
          {
            kind: RegexBlockKind.Alternation,
            options: [
              [{ kind: RegexBlockKind.Literal, value: 'a' }],
              [{ kind: RegexBlockKind.Literal, value: 'b' }],
            ],
          },
        ]),
        '(?:a|b)'
      )
    })

    it('serialises lookaround', () => {
      assert.equal(
        blocksToPattern([
          {
            kind: RegexBlockKind.Lookaround,
            direction: 'ahead',
            negated: false,
            children: [{ kind: RegexBlockKind.CharClass, value: '\\d' }],
          },
        ]),
        '(?=\\d)'
      )

      assert.equal(
        blocksToPattern([
          {
            kind: RegexBlockKind.Lookaround,
            direction: 'behind',
            negated: true,
            children: [{ kind: RegexBlockKind.Literal, value: 'x' }],
          },
        ]),
        '(?<!x)'
      )
    })

    it('produces a pattern that compiles as a valid regex', () => {
      const blocks: ReadonlyArray<RegexBlock> = [
        { kind: RegexBlockKind.Anchor, value: '^' },
        {
          kind: RegexBlockKind.Group,
          groupType: 'capturing',
          children: [
            { kind: RegexBlockKind.CharClass, value: '\\w' },
            {
              kind: RegexBlockKind.Quantifier,
              quantifier: 'plus',
              lazy: false,
            },
          ],
        },
        { kind: RegexBlockKind.Literal, value: '.ts' },
      ]

      const pattern = blocksToPattern(blocks)
      assert.equal(pattern, '^(\\w+)\\.ts')
      assert.doesNotThrow(() => new RegExp(pattern))
    })
  })

  describe('explainBlocks', () => {
    it('describes an empty pattern', () => {
      assert.match(explainBlocks([]), /empty pattern/)
    })

    it('describes anchors and character classes', () => {
      const text = explainBlocks([
        { kind: RegexBlockKind.Anchor, value: '^' },
        { kind: RegexBlockKind.CharClass, value: '\\d' },
      ])
      assert.match(text, /start of line/)
      assert.match(text, /\\d/)
    })

    it('describes quantifiers', () => {
      const text = explainBlocks([
        { kind: RegexBlockKind.CharClass, value: '\\w' },
        { kind: RegexBlockKind.Quantifier, quantifier: 'plus', lazy: false },
      ])
      assert.match(text, /one or more times/)
    })
  })
})
