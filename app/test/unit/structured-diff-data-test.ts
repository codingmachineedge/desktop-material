import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  buildStructuredDiff,
  MaxStructuredDiffBytes,
  MaxStructuredDiffRows,
  parseDelimitedText,
} from '../../src/ui/diff/structured-diff-data'

describe('structured delimited diff data', () => {
  it('parses RFC-4180 commas, escaped quotes, CRLF, and quoted newlines', () => {
    const result = parseDelimitedText(
      'name,note\r\nAlice,"hello, ""team"""\r\nBob,"line 1\r\nline 2"\r\n',
      ','
    )

    assert.equal(result.kind, 'parsed')
    if (result.kind === 'parsed') {
      assert.deepEqual(result.rows, [
        ['name', 'note'],
        ['Alice', 'hello, "team"'],
        ['Bob', 'line 1\r\nline 2'],
      ])
    }
  })

  it('uses the same quoted-field rules for TSV input', () => {
    const result = parseDelimitedText('name\tnote\nAda\t"one\ttwo"', '\t')

    assert.equal(result.kind, 'parsed')
    if (result.kind === 'parsed') {
      assert.deepEqual(result.rows, [
        ['name', 'note'],
        ['Ada', 'one\ttwo'],
      ])
    }
  })

  it('rejects malformed quoting deterministically', () => {
    assert.deepEqual(parseDelimitedText('"unterminated', ','), {
      kind: 'fallback',
      reason: 'malformed',
    })
    assert.deepEqual(parseDelimitedText('"closed"oops', ','), {
      kind: 'fallback',
      reason: 'malformed',
    })
    assert.deepEqual(parseDelimitedText('a"quote,b', ','), {
      kind: 'fallback',
      reason: 'malformed',
    })
  })

  it('bounds source bytes and record count', () => {
    assert.deepEqual(
      parseDelimitedText('x'.repeat(MaxStructuredDiffBytes + 1), ','),
      { kind: 'fallback', reason: 'oversized' }
    )
    assert.deepEqual(
      parseDelimitedText(
        new Array(MaxStructuredDiffRows + 1).fill('x').join('\n'),
        ','
      ),
      { kind: 'fallback', reason: 'oversized' }
    )
  })

  it('aligns records and exposes added, removed, changed, and cell states', () => {
    const result = buildStructuredDiff(
      'people.csv',
      'id,name,score\n1,Alice,10\n2,Bob,20\n4,Drop,40',
      'id,name,score\n1,Alice,11\n3,Carol,30\n2,Bob,20'
    )

    assert.equal(result.kind, 'table')
    if (result.kind === 'table') {
      assert.equal(result.data.format, 'csv')
      assert.equal(result.data.columnCount, 3)
      assert.deepEqual(
        result.data.rows.map(row => row.status),
        ['unchanged', 'changed', 'added', 'unchanged', 'removed']
      )
      assert.deepEqual(
        result.data.rows[1].cells.map(cell => cell.status),
        ['unchanged', 'unchanged', 'changed']
      )
      assert.equal(result.data.rows[1].cells[2].previous, '10')
      assert.equal(result.data.rows[1].cells[2].current, '11')
    }
  })

  it('falls back to code for malformed and oversized structured files', () => {
    assert.deepEqual(buildStructuredDiff('bad.csv', 'a,b', '"bad'), {
      kind: 'code',
      reason: 'malformed',
    })
    assert.deepEqual(
      buildStructuredDiff(
        'large.tsv',
        '',
        'x'.repeat(MaxStructuredDiffBytes + 1)
      ),
      { kind: 'code', reason: 'oversized' }
    )
  })
})
