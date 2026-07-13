import { describe, it } from 'node:test'
import assert from 'node:assert'

import {
  isSparseCheckoutCommandSupported,
  parseGitBoolean,
  parseSparseCheckoutDirectories,
  parseSparseCheckoutList,
  SparseCheckoutDirectoryLengthLimit,
} from '../../../src/lib/git/sparse-checkout-parser'

describe('git/sparse-checkout-parser', () => {
  it('normalizes a vertical list of repository-relative directories', () => {
    const result = parseSparseCheckoutDirectories(
      ' src\\ui/ \r\ndocs//guides\npackages\\desktop '
    )

    assert.deepEqual(result.issues, [])
    assert.deepEqual(result.directories, [
      'src/ui',
      'docs/guides',
      'packages/desktop',
    ])
  })

  it('rejects unsafe, empty, option-looking, and traversal entries', () => {
    const cases = [
      { value: '', kind: 'empty' },
      { value: '   ', kind: 'empty' },
      { value: '/src', kind: 'absolute' },
      { value: '\\server\\share', kind: 'absolute' },
      { value: 'C:\\src', kind: 'absolute' },
      { value: '../src', kind: 'traversal' },
      { value: 'src/./ui', kind: 'traversal' },
      { value: '-skip', kind: 'option-looking' },
      { value: 'src\tui', kind: 'control-character' },
    ] as const

    for (const testCase of cases) {
      const result = parseSparseCheckoutDirectories(testCase.value)
      assert.equal(result.directories.length, 0, testCase.value)
      assert.equal(result.issues[0]?.kind, testCase.kind, testCase.value)
    }
  })

  it('rejects duplicates after slash normalization and trailing separators', () => {
    const result = parseSparseCheckoutDirectories('src/ui\nsrc\\ui/')
    assert.deepEqual(result.directories, ['src/ui'])
    assert.equal(result.issues.length, 1)
    assert.equal(result.issues[0].kind, 'duplicate')
    assert.match(result.issues[0].message, /duplicates line 1/)
  })

  it('bounds individual directory length', () => {
    const result = parseSparseCheckoutDirectories(
      'a'.repeat(SparseCheckoutDirectoryLengthLimit + 1)
    )
    assert.equal(result.issues[0]?.kind, 'too-long')
  })

  it('parses Git support, config booleans, and cone-mode list output', () => {
    assert.equal(
      isSparseCheckoutCommandSupported(
        'usage: git sparse-checkout (init | list | set | reapply | disable)'
      ),
      true
    )
    assert.equal(
      isSparseCheckoutCommandSupported(
        "git: 'sparse-checkout' is not a git command"
      ),
      false
    )
    assert.equal(parseGitBoolean(' true\r\n'), true)
    assert.equal(parseGitBoolean('false'), false)
    assert.deepEqual(
      parseSparseCheckoutList('src\\ui\r\ndocs/guide\r\n', true),
      ['src/ui', 'docs/guide']
    )
    assert.deepEqual(parseSparseCheckoutList('', true), [])
  })
})
