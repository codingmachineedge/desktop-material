import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as Path from 'path'
import { readFile } from 'fs/promises'

import { createTempDirectory } from '../../helpers/temp'
import {
  GlobalIgnoreMaximumBytes,
  readGlobalIgnore,
  resolveGlobalIgnorePath,
  saveGlobalIgnore,
} from '../../../src/lib/git/global-ignore'
import { getGlobalPathConfigValue } from '../../../src/lib/git/config'

describe('global ignore', () => {
  it('resolves home-relative paths without invoking a shell', async t => {
    const HOME = await createTempDirectory(t)
    assert.equal(
      resolveGlobalIgnorePath('~/.config/git/ignore', { HOME }),
      Path.join(HOME, '.config', 'git', 'ignore')
    )
    assert.throws(() => resolveGlobalIgnorePath('\0bad', { HOME }), /invalid/)
  })

  it('proposes an inert default when Git has no configured excludes file', async t => {
    const HOME = await createTempDirectory(t)
    const document = await readGlobalIgnore({ HOME })
    assert.equal(document.configured, false)
    assert.equal(document.exists, false)
    assert.equal(document.path, Path.join(HOME, '.gitignore_global'))
    assert.equal(document.contents, '')
  })

  it('writes rules before activating the absolute global config path', async t => {
    const HOME = await createTempDirectory(t)
    const path = Path.join(HOME, 'config', 'global-ignore')
    const saved = await saveGlobalIgnore(path, '.idea/\n*.swp', { HOME })

    assert.equal(saved.contents, '.idea/\n*.swp\n')
    assert.equal(await readFile(path, 'utf8'), '.idea/\n*.swp\n')
    assert.equal(
      await getGlobalPathConfigValue('core.excludesFile', { HOME }),
      path
    )

    const loaded = await readGlobalIgnore({ HOME })
    assert.deepEqual(loaded, saved)
  })

  it('rejects oversized and binary-looking rule documents', async t => {
    const HOME = await createTempDirectory(t)
    const path = Path.join(HOME, '.gitignore_global')
    await assert.rejects(
      saveGlobalIgnore(path, 'x'.repeat(GlobalIgnoreMaximumBytes + 1), {
        HOME,
      }),
      /512 KiB/
    )
    await assert.rejects(
      saveGlobalIgnore(path, 'safe\0unsafe', { HOME }),
      /NUL/
    )
  })
})
