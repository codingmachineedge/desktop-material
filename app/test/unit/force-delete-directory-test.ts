import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'

import {
  IForceDeleteFileSystem,
  safeForceDeleteDirectory,
  validateDeletionTarget,
} from '../../src/main-process/force-delete-directory'

interface IFakeEntry {
  readonly isDirectory: boolean
  readonly isSymbolicLink: boolean
}

function fakeFs(
  entries: ReadonlyMap<string, IFakeEntry>,
  removed: string[]
): IForceDeleteFileSystem {
  return {
    lstat: async (path: string) => {
      const entry = entries.get(path)
      if (entry === undefined) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      return {
        isDirectory: () => entry.isDirectory,
        isSymbolicLink: () => entry.isSymbolicLink,
      }
    },
    rm: async (path: string) => {
      removed.push(path)
    },
  }
}

describe('safeForceDeleteDirectory', () => {
  it('permanently deletes a contained repository directory', async () => {
    const target = Path.resolve('/work/material')
    const removed: string[] = []
    const fs = fakeFs(
      new Map([[target, { isDirectory: true, isSymbolicLink: false }]]),
      removed
    )

    await safeForceDeleteDirectory(target, fs)

    assert.deepEqual(removed, [target])
  })

  it('refuses an empty or whitespace path and never deletes', async () => {
    const removed: string[] = []
    const fs = fakeFs(new Map(), removed)

    await assert.rejects(() => safeForceDeleteDirectory('', fs), /empty path/)
    await assert.rejects(
      () => safeForceDeleteDirectory('   ', fs),
      /empty path/
    )
    assert.deepEqual(removed, [])
  })

  it('refuses a filesystem root and never deletes', async () => {
    const removed: string[] = []
    const fs = fakeFs(new Map(), removed)
    const root = Path.parse(Path.resolve('/work/material')).root

    await assert.rejects(
      () => safeForceDeleteDirectory(root, fs),
      /filesystem root/
    )
    assert.deepEqual(removed, [])
  })

  it('refuses to follow a symbolic link or junction and never deletes', async () => {
    const target = Path.resolve('/work/linked-repo')
    const removed: string[] = []
    const fs = fakeFs(
      new Map([[target, { isDirectory: true, isSymbolicLink: true }]]),
      removed
    )

    await assert.rejects(
      () => safeForceDeleteDirectory(target, fs),
      /symbolic link or junction/
    )
    assert.deepEqual(removed, [])
  })

  it('refuses to delete a non-directory target', async () => {
    const target = Path.resolve('/work/material/file.txt')
    const removed: string[] = []
    const fs = fakeFs(
      new Map([[target, { isDirectory: false, isSymbolicLink: false }]]),
      removed
    )

    await assert.rejects(
      () => safeForceDeleteDirectory(target, fs),
      /not a directory/
    )
    assert.deepEqual(removed, [])
  })

  it('validateDeletionTarget returns a resolved absolute path', () => {
    const resolved = validateDeletionTarget('/work/material')
    assert.equal(resolved, Path.resolve('/work/material'))
    assert.ok(Path.isAbsolute(resolved))
  })
})
