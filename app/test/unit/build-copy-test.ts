import assert from 'node:assert'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { removeAndCopy } from '../../../script/build'

describe('build copying', () => {
  it('dereferences a directory link before removing destination children', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-build-copy-test-'))

    try {
      const sourceTarget = join(root, 'source-target')
      const sourceLink = join(root, 'source-link')
      const destination = join(root, 'destination')
      const sourceUnicodeFile = join(
        sourceTarget,
        'unicode',
        'source-must-survive.txt'
      )

      mkdirSync(join(sourceTarget, 'unicode'), { recursive: true })
      writeFileSync(sourceUnicodeFile, 'source content')
      symlinkSync(
        sourceTarget,
        sourceLink,
        process.platform === 'win32' ? 'junction' : 'dir'
      )

      removeAndCopy(sourceLink, destination)

      assert.equal(lstatSync(sourceLink).isSymbolicLink(), true)
      assert.equal(lstatSync(destination).isSymbolicLink(), false)
      assert.equal(
        readFileSync(
          join(destination, 'unicode', 'source-must-survive.txt'),
          'utf8'
        ),
        'source content'
      )

      rmSync(join(destination, 'unicode'), { recursive: true, force: true })

      assert.equal(existsSync(join(destination, 'unicode')), false)
      assert.equal(readFileSync(sourceUnicodeFile, 'utf8'), 'source content')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects nested links instead of copying outside-tree contents', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-build-copy-test-'))

    try {
      const source = join(root, 'source')
      const outside = join(root, 'outside')
      const nestedLink = join(source, 'nested-link')
      const destination = join(root, 'destination')
      const outsideFile = join(outside, 'must-not-be-copied.txt')

      mkdirSync(source, { recursive: true })
      mkdirSync(outside, { recursive: true })
      writeFileSync(outsideFile, 'outside content')
      symlinkSync(
        outside,
        nestedLink,
        process.platform === 'win32' ? 'junction' : 'dir'
      )

      assert.throws(
        () => removeAndCopy(source, destination),
        /Refusing to copy nested symbolic link from build input/
      )
      assert.equal(readFileSync(outsideFile, 'utf8'), 'outside content')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
