import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  CHEAP_LFS_PART_SIZE_BYTES,
  CHEAP_LFS_POINTER_VERSION,
  ICheapLfsPointer,
  isCheapLfsPointerText,
  parseCheapLfsPointer,
  planFileParts,
  serializeCheapLfsPointer,
  validateCheapLfsTrackedPath,
} from '../../../src/lib/cheap-lfs/pointer'

const NUL = String.fromCharCode(0)
const BOM = String.fromCharCode(0xfeff)

const pointer: ICheapLfsPointer = {
  version: CHEAP_LFS_POINTER_VERSION,
  releaseTag: 'v1.0.0',
  assetName: 'game assets.bin',
  sizeInBytes: 123456,
  sha256: 'a'.repeat(64),
}

const multiPartPointer: ICheapLfsPointer = {
  version: CHEAP_LFS_POINTER_VERSION,
  releaseTag: 'v2.0.0',
  assetName: 'huge.bin',
  sizeInBytes: 30,
  sha256: 'a'.repeat(64),
  parts: [
    { name: 'huge.bin.part001', sizeInBytes: 10, sha256: 'b'.repeat(64) },
    { name: 'huge.bin.part002', sizeInBytes: 20, sha256: 'c'.repeat(64) },
  ],
}

describe('cheap LFS pointer', () => {
  it('round-trips a serialized pointer and ends with a trailing newline', () => {
    const text = serializeCheapLfsPointer(pointer)
    assert.equal(text.endsWith('\n'), true)
    assert.equal(text.split('\n').filter(line => line.length > 0).length, 5)
    assert.deepEqual(parseCheapLfsPointer(text), pointer)
  })

  it('preserves an asset name that contains spaces', () => {
    const parsed = parseCheapLfsPointer(serializeCheapLfsPointer(pointer))
    assert.equal(parsed?.assetName, 'game assets.bin')
  })

  it('parses an old single-asset pointer as one with no parts (back-compat)', () => {
    const parsed = parseCheapLfsPointer(serializeCheapLfsPointer(pointer))
    assert.deepEqual(parsed, pointer)
    assert.equal(parsed?.parts, undefined)
  })

  it('round-trips a multi-part pointer with its parts serialized in order', () => {
    const text = serializeCheapLfsPointer(multiPartPointer)
    assert.equal(text.endsWith('\n'), true)
    // The five head lines are unchanged; part lines follow them, in order.
    const lines = text.trimEnd().split('\n')
    assert.deepEqual(lines.slice(0, 5), [
      `version ${CHEAP_LFS_POINTER_VERSION}`,
      'release-tag v2.0.0',
      'asset-name huge.bin',
      'size 30',
      `sha256 ${'a'.repeat(64)}`,
    ])
    assert.deepEqual(lines.slice(5), [
      `part ${'b'.repeat(64)} 10 huge.bin.part001`,
      `part ${'c'.repeat(64)} 20 huge.bin.part002`,
    ])
    assert.deepEqual(parseCheapLfsPointer(text), multiPartPointer)
  })

  it('round-trips an adaptively deflated part', () => {
    const compressed: ICheapLfsPointer = {
      ...pointer,
      assetName: 'game assets.bin.deflate',
      parts: [
        {
          name: 'game assets.bin.deflate',
          sizeInBytes: 123456,
          sha256: 'b'.repeat(64),
          deflatedSizeInBytes: 1234,
        },
      ],
    }
    const text = serializeCheapLfsPointer(compressed)
    assert.match(
      text,
      new RegExp(
        `part-deflate ${'b'.repeat(64)} 123456 1234 game assets\\.bin\\.deflate`
      )
    )
    assert.deepEqual(parseCheapLfsPointer(text), compressed)
  })

  it('rejects parts that exceed the bounded release-asset size', () => {
    const oversized = CHEAP_LFS_PART_SIZE_BYTES + 1
    const text = [
      `version ${CHEAP_LFS_POINTER_VERSION}`,
      'release-tag v2.0.0',
      'asset-name huge.bin',
      `size ${oversized}`,
      `sha256 ${'a'.repeat(64)}`,
      `part-deflate ${'b'.repeat(64)} ${oversized} 1 huge.bin.deflate`,
      '',
    ].join('\n')

    assert.equal(parseCheapLfsPointer(text), null)
    const zeroStored = text
      .replace(`size ${oversized}`, 'size 10')
      .replace(`${oversized} 1`, '10 0')
    assert.equal(parseCheapLfsPointer(zeroStored), null)
  })

  it('preserves a part name that contains spaces', () => {
    const spaced: ICheapLfsPointer = {
      ...multiPartPointer,
      assetName: 'game assets.bin',
      sizeInBytes: 30,
      parts: [
        {
          name: 'game assets.bin.part001',
          sizeInBytes: 30,
          sha256: 'b'.repeat(64),
        },
      ],
    }
    assert.deepEqual(
      parseCheapLfsPointer(serializeCheapLfsPointer(spaced)),
      spaced
    )
  })

  it('rejects a multi-part pointer whose parts do not sum to the whole size', () => {
    const bad = serializeCheapLfsPointer({
      ...multiPartPointer,
      sizeInBytes: 31,
    })
    assert.equal(parseCheapLfsPointer(bad), null)
  })

  it('rejects a part line with a malformed sha256, size, or empty name', () => {
    const head = [
      `version ${CHEAP_LFS_POINTER_VERSION}`,
      'release-tag v2.0.0',
      'asset-name huge.bin',
      'size 30',
      `sha256 ${'a'.repeat(64)}`,
    ]
    const rejected: ReadonlyArray<string> = [
      // sha256 that is not 64 hex characters.
      [...head, 'part deadbeef 30 huge.bin.part001'].join('\n'),
      // Non-integer part size.
      [...head, `part ${'b'.repeat(64)} 3.0 huge.bin.part001`].join('\n'),
      // Empty part name.
      [...head, `part ${'b'.repeat(64)} 30 `].join('\n'),
    ]
    for (const text of rejected) {
      assert.equal(parseCheapLfsPointer(`${text}\n`), null, text)
    }
  })

  it('plans file parts with a remainder final part', () => {
    assert.deepEqual(planFileParts(10, 4), [
      { index: 0, offset: 0, length: 4 },
      { index: 1, offset: 4, length: 4 },
      { index: 2, offset: 8, length: 2 },
    ])
    // A file within a single part is the N=1 whole-file case.
    assert.deepEqual(planFileParts(3, 4), [{ index: 0, offset: 0, length: 3 }])
    // An exact multiple ends with a full final part.
    assert.deepEqual(planFileParts(8, 4), [
      { index: 0, offset: 0, length: 4 },
      { index: 1, offset: 4, length: 4 },
    ])
  })

  it('tolerates CRLF line endings, a leading BOM, and surrounding whitespace', () => {
    const crlf = serializeCheapLfsPointer(pointer).replace(/\n/g, '\r\n')
    assert.deepEqual(parseCheapLfsPointer(`${BOM}\n  ${crlf}  \n`), pointer)
  })

  it('rejects every malformation and returns null', () => {
    const lines = serializeCheapLfsPointer(pointer).trimEnd().split('\n')
    const rejected: ReadonlyArray<string> = [
      // Wrong version marker.
      lines.map(l => l.replace(/^version .*/, 'version other/v9')).join('\n'),
      // SHA-256 that is not 64 hex characters.
      lines.map(l => l.replace(/^sha256 .*/, 'sha256 deadbeef')).join('\n'),
      // Uppercase hex is not accepted.
      lines
        .map(l => l.replace(/^sha256 .*/, `sha256 ${'A'.repeat(64)}`))
        .join('\n'),
      // Non-integer size.
      lines.map(l => l.replace(/^size .*/, 'size 12.5')).join('\n'),
      // Negative size.
      lines.map(l => l.replace(/^size .*/, 'size -1')).join('\n'),
      // Empty release tag.
      lines.map(l => l.replace(/^release-tag .*/, 'release-tag ')).join('\n'),
      // Whitespace inside the release tag.
      lines
        .map(l => l.replace(/^release-tag .*/, 'release-tag v 1'))
        .join('\n'),
      // Empty asset name.
      lines.map(l => l.replace(/^asset-name .*/, 'asset-name ')).join('\n'),
      // Missing a line.
      lines.slice(0, 4).join('\n'),
      // Extra line.
      [...lines, 'extra value'].join('\n'),
      // Duplicate key (still five lines, but 'version' appears twice).
      lines.map((l, i) => (i === 4 ? 'version dup' : l)).join('\n'),
      // A NUL byte anywhere disqualifies the text.
      `${serializeCheapLfsPointer(pointer)}${NUL}`,
      // Not a pointer at all.
      'just some file contents\n',
    ]
    for (const text of rejected) {
      assert.equal(parseCheapLfsPointer(text), null, text)
    }
  })

  it('classifies pointer text and rejects binaries with isCheapLfsPointerText', () => {
    assert.equal(isCheapLfsPointerText(serializeCheapLfsPointer(pointer)), true)
    assert.equal(
      isCheapLfsPointerText(`${BOM}${serializeCheapLfsPointer(pointer)}`),
      true
    )
    assert.equal(isCheapLfsPointerText(`${NUL}${NUL}binary`), false)
    assert.equal(isCheapLfsPointerText('#!/bin/sh\necho hi\n'), false)
    assert.equal(isCheapLfsPointerText(''), false)
  })

  it('normalizes safe paths and rejects unsafe ones', () => {
    const table: ReadonlyArray<[string, string | null]> = [
      ['assets/game.bin', 'assets/game.bin'],
      ['assets\\game.bin', 'assets/game.bin'],
      ['  data/file.psd  ', 'data/file.psd'],
      ['file.bin', 'file.bin'],
      ['', null],
      ['/etc/passwd', null],
      ['C:/Windows/system32', null],
      ['../escape.bin', null],
      ['assets/../../escape.bin', null],
      ['./file.bin', null],
      ['assets//file.bin', null],
      ['.git/config', null],
      ['.gitignore', null],
      ['.github/workflows/ci.yml', null],
    ]
    for (const [input, expected] of table) {
      assert.equal(validateCheapLfsTrackedPath(input), expected, input)
    }
  })
})
