import './profile-history-test-env'

import assert from 'node:assert'
import { describe, it, TestContext } from 'node:test'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import {
  IRepoMusicDocument,
  parseRepoMusicDocument,
} from '../../src/lib/audio/audio-settings'
import { DedicatedSettingFileName } from '../../src/lib/stores/dedicated-setting-store'
import {
  RepoMusicRepositoryDirectoryName,
  RepoMusicStore,
} from '../../src/lib/stores/repo-music-store'
import { createTempDirectory } from '../helpers/temp'

async function createStore(t: TestContext) {
  const root = join(await createTempDirectory(t), 'repository-music')
  const store = new RepoMusicStore({ root })
  await store.initialize()
  return { root, store }
}

function repositoryPath(root: string): string {
  return join(root, RepoMusicRepositoryDirectoryName)
}

async function readDocument(root: string): Promise<IRepoMusicDocument> {
  return parseRepoMusicDocument(
    await readFile(join(repositoryPath(root), DedicatedSettingFileName), 'utf8')
  )
}

describe('RepoMusicStore', () => {
  it('creates a dedicated Git repository and durably persists overrides', async t => {
    const { root, store } = await createStore(t)

    assert.equal(
      (await stat(join(repositoryPath(root), '.git'))).isDirectory(),
      true
    )

    await store.setOverride('/repos/alpha', {
      kind: 'custom',
      track: 'alpha.mp3',
    })
    await store.setOverride('/repos/beta', { kind: 'off' })

    // The committed working file reflects both choices.
    const onDisk = await readDocument(root)
    assert.deepStrictEqual(onDisk.overrides, {
      '/repos/alpha': { kind: 'custom', track: 'alpha.mp3' },
      '/repos/beta': { kind: 'off' },
    })

    // A fresh store opened on the same root rediscovers them.
    const reopened = new RepoMusicStore({ root })
    await reopened.initialize()
    assert.deepStrictEqual(reopened.getDocument().overrides, onDisk.overrides)
    assert.deepStrictEqual(reopened.getOverride('/repos/beta'), { kind: 'off' })
    assert.strictEqual(reopened.getOverride('/repos/unknown'), null)
  })

  it('clears an override back to the derived theme', async t => {
    const { root, store } = await createStore(t)
    await store.setOverride('/r', { kind: 'custom', track: 't.mp3' })
    await store.setOverride('/r', null)

    assert.strictEqual(store.getOverride('/r'), null)
    assert.deepStrictEqual((await readDocument(root)).overrides, {})
  })

  it('records each change as its own commit in the history timeline', async t => {
    const { store } = await createStore(t)
    await store.setOverride('/one', { kind: 'custom', track: '1.mp3' })
    await store.setOverride('/two', { kind: 'off' })

    const history = await store.getHistory()
    // Initialization + two edits => at least three commits.
    assert.ok(
      history.entries.length >= 3,
      `expected >= 3 commits, got ${history.entries.length}`
    )
  })

  it('migrates a legacy localStorage map once, then is idempotent', async t => {
    const { root, store } = await createStore(t)

    const first = await store.migrateLegacyMap({
      '/legacy/a': 'a.mp3',
      '/legacy/b': 'b.ogg',
    })
    assert.strictEqual(first, true)

    assert.deepStrictEqual((await readDocument(root)).overrides, {
      '/legacy/a': { kind: 'custom', track: 'a.mp3' },
      '/legacy/b': { kind: 'custom', track: 'b.ogg' },
    })

    // Re-running the migration commits nothing new.
    const second = await store.migrateLegacyMap({
      '/legacy/a': 'a.mp3',
      '/legacy/b': 'b.ogg',
    })
    assert.strictEqual(second, false)

    // An empty legacy map is always a no-op.
    assert.strictEqual(await store.migrateLegacyMap({}), false)
  })

  it('never overwrites a newer choice during migration', async t => {
    const { root, store } = await createStore(t)
    await store.setOverride('/legacy/a', { kind: 'off' })

    const migrated = await store.migrateLegacyMap({
      '/legacy/a': 'a.mp3',
      '/legacy/c': 'c.mp3',
    })
    assert.strictEqual(migrated, true)

    const overrides = (await readDocument(root)).overrides
    assert.deepStrictEqual(overrides['/legacy/a'], { kind: 'off' })
    assert.deepStrictEqual(overrides['/legacy/c'], {
      kind: 'custom',
      track: 'c.mp3',
    })
  })
})
