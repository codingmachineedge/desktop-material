import { describe, it } from 'node:test'
import assert from 'node:assert'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { createTempDirectory } from '../helpers/temp'
import {
  NonEmptyCloneFolderError,
  validateEmptyFolder,
} from '../../src/lib/path-validation'

describe('validateEmptyFolder', () => {
  it('rejects a null path', async () => {
    const result = await validateEmptyFolder(null)
    assert.ok(result instanceof Error)
  })

  it('accepts a path that does not exist yet', async t => {
    const tempDir = await createTempDirectory(t)
    const result = await validateEmptyFolder(join(tempDir, 'does-not-exist'))
    assert.equal(result, null)
  })

  it('accepts an existing empty directory', async t => {
    const tempDir = await createTempDirectory(t)
    const empty = join(tempDir, 'empty')
    await mkdir(empty)
    const result = await validateEmptyFolder(empty)
    assert.equal(result, null)
  })

  it('rejects a directory that already contains files', async t => {
    const tempDir = await createTempDirectory(t)
    await writeFile(join(tempDir, 'existing.txt'), 'contents', 'utf8')
    const result = await validateEmptyFolder(tempDir)
    assert.ok(result instanceof Error)
    assert.match(result.message, /contains files/)
    assert(result instanceof NonEmptyCloneFolderError)
  })

  it('rejects a path that refers to a file', async t => {
    const tempDir = await createTempDirectory(t)
    const filePath = join(tempDir, 'a-file')
    await writeFile(filePath, 'contents', 'utf8')
    const result = await validateEmptyFolder(filePath)
    assert.ok(result instanceof Error)
    assert.match(result.message, /already a file/)
  })
})
