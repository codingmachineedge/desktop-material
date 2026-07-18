import './profile-history-test-env'
import { describe, it, TestContext } from 'node:test'
import assert from 'node:assert'
import { chmod, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { createTempDirectory } from '../helpers/temp'
import {
  commitAllChanges,
  ensureProfileRepository,
  getProfileCommitDiff,
  getProfileCommitFiles,
  getProfileHistory,
  ProfileCommitQueue,
  redoLastProfileChange,
  restoreProfileTo,
  undoLastProfileChange,
  withProfileRepositoryLock,
} from '../../src/lib/profiles/profile-git'
import { AsyncInMemoryStore, InMemoryStore } from '../helpers/stores'
import { Repository } from '../../src/models/repository'
import { LocalProfileKey } from '../../src/models/profile'
import { git } from '../../src/lib/git/core'

async function createProfileRepository(t: TestContext): Promise<Repository> {
  return ensureProfileRepository(await createTempDirectory(t))
}

async function writeSettings(
  repository: Repository,
  settings: Record<string, unknown>
) {
  await writeFile(
    join(repository.path, 'settings.json'),
    JSON.stringify({ version: 1, settings }, null, 2)
  )
}

async function readSettings(repository: Repository) {
  return JSON.parse(
    await readFile(join(repository.path, 'settings.json'), 'utf8')
  ) as { readonly settings: Record<string, string> }
}

describe('profile git history', () => {
  it('serializes profile mutations across window stores', async t => {
    const repository = await createProfileRepository(t)
    let active = 0
    let maximumActive = 0
    const order: string[] = []
    const mutation = (name: string) =>
      withProfileRepositoryLock(repository, async () => {
        active++
        maximumActive = Math.max(maximumActive, active)
        order.push(`${name}:start`)
        await new Promise(resolve => setTimeout(resolve, 30))
        order.push(`${name}:end`)
        active--
      })

    await Promise.all([mutation('first'), mutation('second')])

    assert.equal(maximumActive, 1)
    assert.equal(order.length, 4)
    assert.ok(order.indexOf('first:start') < order.indexOf('first:end'))
    assert.ok(order.indexOf('second:start') < order.indexOf('second:end'))
  })

  it('returns bounded skip-based pages with action availability', async t => {
    const repository = await createProfileRepository(t)

    await writeSettings(repository, { 'tab-size': '2' })
    await commitAllChanges(repository, 'Initialize profile')

    let page = await getProfileHistory(repository, 0, 2)
    assert.equal(page.total, 1)
    assert.equal(page.hasMore, false)
    assert.equal(page.canUndo, false)
    assert.equal(page.canRedo, false)

    await writeSettings(repository, { 'tab-size': '4' })
    await commitAllChanges(repository, 'Change tab size')
    await writeSettings(repository, { 'tab-size': '8' })
    await commitAllChanges(repository, 'Change tab size again')

    page = await getProfileHistory(repository, 0, 2)
    assert.deepEqual(
      page.entries.map(entry => entry.summary),
      ['Change tab size again', 'Change tab size']
    )
    assert.equal(page.total, 3)
    assert.equal(page.hasMore, true)
    assert.equal(page.canUndo, true)

    const secondPage = await getProfileHistory(repository, 2, 2)
    assert.deepEqual(
      secondPage.entries.map(entry => entry.summary),
      ['Initialize profile']
    )
    assert.equal(secondPage.total, 3)
    assert.equal(secondPage.hasMore, false)
  })

  it('loads changed files and unified diffs lazily', async t => {
    const repository = await createProfileRepository(t)
    await writeSettings(repository, { 'tab-size': '2' })
    await commitAllChanges(repository, 'Initialize profile')

    await writeSettings(repository, { 'tab-size': '4' })
    await writeFile(
      join(repository.path, 'tabs.json'),
      JSON.stringify({ version: 1, tabs: [], activeTabId: null }, null, 2)
    )
    await commitAllChanges(repository, 'Change settings and tabs')
    const sha = (await getProfileHistory(repository)).entries[0].sha

    assert.deepEqual(
      [...(await getProfileCommitFiles(repository, sha))].sort(),
      ['settings.json', 'tabs.json']
    )

    const diff = await getProfileCommitDiff(repository, sha, 'settings.json')
    assert.match(diff, /"tab-size": "4"/)
    assert.doesNotMatch(diff, /tabs\.json/)

    await assert.rejects(
      getProfileCommitDiff(repository, sha, '../outside-profile'),
      /was not changed/
    )
  })

  it('scopes and paginates history by exact tab-object changes', async t => {
    const repository = await createProfileRepository(t)

    // A settings-only commit must never leak into a tab-scoped page.
    await writeSettings(repository, { 'tab-size': '2' })
    await commitAllChanges(repository, 'Initialize profile')

    interface ITestTab {
      readonly id: string
      readonly customLabel: string | null
      readonly titleStyle: Record<string, unknown> | null
    }
    const tab = (
      id: string,
      customLabel: string | null = null,
      titleStyle: Record<string, unknown> | null = null
    ): ITestTab => ({ id, customLabel, titleStyle })
    const writeTabs = (tabs: ReadonlyArray<ITestTab>) =>
      writeFile(
        join(repository.path, 'tabs.json'),
        JSON.stringify(
          {
            version: 1,
            tabs,
            activeTabId: null,
          },
          null,
          2
        )
      )

    await writeTabs([tab('alpha-tab-id')])
    await commitAllChanges(repository, 'Open alpha tab')

    // The id line is unchanged, so the former -G pickaxe missed this commit.
    await writeTabs([tab('alpha-tab-id', null, { bold: true })])
    await commitAllChanges(repository, 'Style alpha tab')

    await writeTabs([
      tab('alpha-tab-id', null, { bold: true }),
      tab('beta-tab-id'),
    ])
    await commitAllChanges(repository, 'Open beta tab')

    // An unrelated tab-object edit must not leak into alpha's history.
    await writeTabs([
      tab('alpha-tab-id', null, { bold: true }),
      tab('beta-tab-id', null, { italic: true }),
    ])
    await commitAllChanges(repository, 'Style beta tab')

    await writeTabs([
      tab('alpha-tab-id', 'Renamed alpha', { bold: true }),
      tab('beta-tab-id', null, { italic: true }),
    ])
    await commitAllChanges(repository, 'Rename alpha tab')

    // Array order and active-tab state are not part of either tab object.
    await writeFile(
      join(repository.path, 'tabs.json'),
      JSON.stringify(
        {
          version: 1,
          tabs: [
            tab('beta-tab-id', null, { italic: true }),
            tab('alpha-tab-id', 'Renamed alpha', { bold: true }),
          ],
          activeTabId: 'beta-tab-id',
        },
        null,
        2
      )
    )
    await commitAllChanges(repository, 'Reorder and activate beta tab')

    await writeTabs([tab('beta-tab-id', null, { italic: true })])
    await commitAllChanges(repository, 'Close alpha tab')

    const alpha = await getProfileHistory(repository, 0, 2, {
      tabId: 'alpha-tab-id',
    })
    assert.deepEqual(
      alpha.entries.map(entry => entry.summary),
      ['Close alpha tab', 'Rename alpha tab']
    )
    assert.equal(alpha.total, 4)
    assert.equal(alpha.hasMore, true)
    // A scoped view is read-only: profile-wide undo/redo are never offered.
    assert.equal(alpha.canUndo, false)
    assert.equal(alpha.canRedo, false)

    const alphaSecondPage = await getProfileHistory(repository, 2, 2, {
      tabId: 'alpha-tab-id',
    })
    assert.deepEqual(
      alphaSecondPage.entries.map(entry => entry.summary),
      ['Style alpha tab', 'Open alpha tab']
    )
    assert.equal(alphaSecondPage.total, 4)
    assert.equal(alphaSecondPage.hasMore, false)

    const beta = await getProfileHistory(repository, 0, 50, {
      tabId: 'beta-tab-id',
    })
    assert.deepEqual(
      beta.entries.map(entry => entry.summary),
      ['Style beta tab', 'Open beta tab']
    )

    // The unfiltered read still returns the whole timeline with mutations.
    const full = await getProfileHistory(repository)
    assert.equal(full.total, 8)
    assert.equal(full.canUndo, true)
  })

  it('matches unusual tab ids literally without regex interpretation', async t => {
    const repository = await createProfileRepository(t)
    const specialId = 'tab.*[id]\\^$'
    const writeTabs = (tabs: ReadonlyArray<Record<string, unknown>>) =>
      writeFile(
        join(repository.path, 'tabs.json'),
        JSON.stringify({ version: 1, tabs, activeTabId: null }, null, 2)
      )

    await writeTabs([{ id: 'tabZZi^', titleStyle: null }])
    await commitAllChanges(repository, 'Open regex-shaped decoy')

    await writeTabs([
      { id: 'tabZZi^', titleStyle: null },
      { id: specialId, titleStyle: null },
    ])
    await commitAllChanges(repository, 'Open literal special id')

    await writeTabs([
      { id: 'tabZZi^', titleStyle: { bold: true } },
      { id: specialId, titleStyle: null },
    ])
    await commitAllChanges(repository, 'Change only regex-shaped decoy')

    await writeTabs([
      { id: 'tabZZi^', titleStyle: { bold: true } },
      { id: specialId, titleStyle: { underline: true } },
    ])
    await commitAllChanges(repository, 'Style literal special id')

    await writeTabs([{ id: 'tabZZi^', titleStyle: { bold: true } }])
    await commitAllChanges(repository, 'Close literal special id')

    const history = await getProfileHistory(repository, 0, 50, {
      tabId: specialId,
    })
    assert.deepEqual(
      history.entries.map(entry => entry.summary),
      [
        'Close literal special id',
        'Style literal special id',
        'Open literal special id',
      ]
    )
    assert.equal(history.total, 3)
    assert.equal(history.canUndo, false)
    assert.equal(history.canRedo, false)
  })

  it('undoes, redoes, and restores only by appending trailer-linked commits', async t => {
    const repository = await createProfileRepository(t)
    await writeSettings(repository, { 'tab-size': '2' })
    await commitAllChanges(repository, 'Initialize profile')
    const initialSha = (await getProfileHistory(repository)).entries[0].sha

    await writeSettings(repository, { 'tab-size': '4' })
    await writeFile(
      join(repository.path, 'tabs.json'),
      JSON.stringify({ version: 1, tabs: [], activeTabId: null }, null, 2)
    )
    await commitAllChanges(repository, 'Change profile')
    const changeSha = (await getProfileHistory(repository)).entries[0].sha

    await undoLastProfileChange(repository)
    let history = await getProfileHistory(repository)
    const undoSha = history.entries[0].sha
    assert.equal(history.entries[0].undoOf, changeSha)
    assert.equal(history.entries[0].redoOf, null)
    assert.equal(history.canRedo, true)
    assert.equal((await readSettings(repository)).settings['tab-size'], '2')
    await assert.rejects(stat(join(repository.path, 'tabs.json')))

    await redoLastProfileChange(repository)
    history = await getProfileHistory(repository)
    assert.equal(history.entries[0].redoOf, undoSha)
    assert.equal(history.canRedo, false)
    assert.equal((await readSettings(repository)).settings['tab-size'], '4')
    await stat(join(repository.path, 'tabs.json'))

    await writeSettings(repository, { 'tab-size': '8' })
    await commitAllChanges(repository, 'Change profile after redo')
    await restoreProfileTo(repository, initialSha)

    history = await getProfileHistory(repository)
    assert.equal(history.entries[0].restoreOf, initialSha)
    assert.equal((await readSettings(repository)).settings['tab-size'], '2')
    await assert.rejects(stat(join(repository.path, 'tabs.json')))

    const shas = new Set(history.entries.map(entry => entry.sha))
    assert.equal(shas.has(initialSha), true)
    assert.equal(shas.has(changeSha), true)
    assert.equal(shas.has(undoSha), true)
    assert.equal(history.total, 6)
  })

  it('traverses two logical undos and redos without reverting audit commits out of order', async t => {
    const repository = await createProfileRepository(t)
    await writeSettings(repository, { 'tab-size': '2' })
    await commitAllChanges(repository, 'Initialize profile')

    await writeSettings(repository, { 'tab-size': '4' })
    await commitAllChanges(repository, 'Change tab size to 4')
    const changeTo4 = (await getProfileHistory(repository)).entries[0].sha

    await writeSettings(repository, { 'tab-size': '8' })
    await commitAllChanges(repository, 'Change tab size to 8')
    const changeTo8 = (await getProfileHistory(repository)).entries[0].sha

    await undoLastProfileChange(repository)
    let history = await getProfileHistory(repository)
    const undo8 = history.entries[0].sha
    assert.equal(history.entries[0].undoOf, changeTo8)
    assert.equal((await readSettings(repository)).settings['tab-size'], '4')
    assert.equal(history.canUndo, true)
    assert.equal(history.canRedo, true)

    await undoLastProfileChange(repository)
    history = await getProfileHistory(repository)
    const undo4 = history.entries[0].sha
    assert.equal(history.entries[0].undoOf, changeTo4)
    assert.equal((await readSettings(repository)).settings['tab-size'], '2')
    assert.equal(history.canUndo, false)
    assert.equal(history.canRedo, true)

    await redoLastProfileChange(repository)
    history = await getProfileHistory(repository)
    assert.equal(history.entries[0].redoOf, undo4)
    assert.equal((await readSettings(repository)).settings['tab-size'], '4')
    assert.equal(history.canUndo, true)
    assert.equal(history.canRedo, true)

    await redoLastProfileChange(repository)
    history = await getProfileHistory(repository)
    assert.equal(history.entries[0].redoOf, undo8)
    assert.equal((await readSettings(repository)).settings['tab-size'], '8')
    assert.equal(history.canUndo, true)
    assert.equal(history.canRedo, false)
    assert.equal(history.total, 7)
  })

  it('invalidates the logical redo stack when a new change is committed', async t => {
    const repository = await createProfileRepository(t)
    await writeSettings(repository, { 'tab-size': '2' })
    await commitAllChanges(repository, 'Initialize profile')
    await writeSettings(repository, { 'tab-size': '4' })
    await commitAllChanges(repository, 'Change tab size to 4')
    await writeSettings(repository, { 'tab-size': '8' })
    await commitAllChanges(repository, 'Change tab size to 8')

    await undoLastProfileChange(repository)
    assert.equal((await getProfileHistory(repository)).canRedo, true)

    await writeSettings(repository, { 'tab-size': '6' })
    await commitAllChanges(repository, 'Change tab size on new branch')

    const history = await getProfileHistory(repository)
    assert.equal(history.canRedo, false)
    await assert.rejects(redoLastProfileChange(repository), /cannot be redone/)

    await undoLastProfileChange(repository)
    assert.equal((await readSettings(repository)).settings['tab-size'], '4')
  })

  it('rolls back HEAD, index, and worktree when an audit commit fails', async t => {
    const repository = await createProfileRepository(t)
    await writeSettings(repository, { 'tab-size': '2' })
    await commitAllChanges(repository, 'Initialize profile')
    const initialSha = (await getProfileHistory(repository)).entries[0].sha

    await writeSettings(repository, { 'tab-size': '4' })
    await commitAllChanges(repository, 'Change tab size')
    const originalHistory = await getProfileHistory(repository)
    const originalHead = originalHistory.entries[0].sha

    const hook = join(repository.path, '.git', 'hooks', 'pre-commit')
    await writeFile(hook, '#!/bin/sh\nexit 1\n')
    await chmod(hook, 0o755)

    await assert.rejects(undoLastProfileChange(repository))
    let history = await getProfileHistory(repository)
    assert.equal(history.entries[0].sha, originalHead)
    assert.equal(history.total, originalHistory.total)
    assert.equal((await readSettings(repository)).settings['tab-size'], '4')
    assert.equal(
      (await git(['status', '--porcelain'], repository.path, 'testStatus'))
        .stdout,
      ''
    )

    await assert.rejects(restoreProfileTo(repository, initialSha))
    history = await getProfileHistory(repository)
    assert.equal(history.entries[0].sha, originalHead)
    assert.equal(history.total, originalHistory.total)
    assert.equal((await readSettings(repository)).settings['tab-size'], '4')
    assert.equal(
      (await git(['status', '--porcelain'], repository.path, 'testStatus'))
        .stdout,
      ''
    )
  })
})

describe('ProfileStore settings history', () => {
  it('flushes pending settings and applies restored snapshots through the allowlist', async t => {
    installTestLocalStorage(t)
    const [{ ProfileStore }, { AccountsStore }] = await Promise.all([
      import('../../src/lib/stores/profile-store'),
      import('../../src/lib/stores/accounts-store'),
    ])
    const repository = await createProfileRepository(t)
    await writeSettings(repository, {
      'tab-size': '2',
      users: '[repository secret]',
    })
    await commitAllChanges(repository, 'Initialize profile')
    const initialSha = (await getProfileHistory(repository)).entries[0].sha

    const previousTabSize = localStorage.getItem('tab-size')
    const previousUsers = localStorage.getItem('users')
    t.after(() => {
      restoreStorageValue('tab-size', previousTabSize)
      restoreStorageValue('users', previousUsers)
    })
    localStorage.setItem('tab-size', '2')
    localStorage.setItem('users', '[live secret]')

    const store = new ProfileStore(
      new AccountsStore(new InMemoryStore(), new AsyncInMemoryStore())
    )
    const internals = store as unknown as {
      enabled: boolean
      lastSnapshotsByKey: Map<string, Record<string, string>>
      repositoriesByKey: Map<string, Repository>
      queuesByKey: Map<string, ProfileCommitQueue>
    }
    internals.enabled = true
    internals.lastSnapshotsByKey.set(LocalProfileKey, { 'tab-size': '2' })
    internals.repositoriesByKey.set(LocalProfileKey, repository)
    internals.queuesByKey.set(
      LocalProfileKey,
      new ProfileCommitQueue(repository)
    )

    localStorage.setItem('tab-size', '4')
    store.onAppStateChanged()

    // The history read occurs before the one-second timer and must still flush
    // both the snapshot capture and its queued commit.
    let history = await store.getSettingsHistory()
    assert.equal(history.total, 2)
    assert.equal((await readSettings(repository)).settings['tab-size'], '4')

    await store.restoreSettingsTo(initialSha)
    assert.equal(localStorage.getItem('tab-size'), '2')
    assert.equal(localStorage.getItem('users'), '[live secret]')

    history = await store.getSettingsHistory()
    assert.equal(history.entries[0].restoreOf, initialSha)
    assert.equal(history.total, 3)
  })

  it('serializes tab writes with history reads and mutations', async t => {
    installTestLocalStorage(t)
    const [{ ProfileStore }, { AccountsStore }] = await Promise.all([
      import('../../src/lib/stores/profile-store'),
      import('../../src/lib/stores/accounts-store'),
    ])
    const repository = await createProfileRepository(t)
    await writeSettings(repository, { 'tab-size': '2' })
    await commitAllChanges(repository, 'Initialize profile')

    const previousTabSize = localStorage.getItem('tab-size')
    t.after(() => restoreStorageValue('tab-size', previousTabSize))
    localStorage.setItem('tab-size', '2')
    const store = new ProfileStore(
      new AccountsStore(new InMemoryStore(), new AsyncInMemoryStore())
    )
    const internals = store as unknown as {
      enabled: boolean
      lastSnapshotsByKey: Map<string, Record<string, string>>
      repositoriesByKey: Map<string, Repository>
      queuesByKey: Map<string, ProfileCommitQueue>
    }
    internals.enabled = true
    internals.lastSnapshotsByKey.set(LocalProfileKey, { 'tab-size': '2' })
    internals.repositoriesByKey.set(LocalProfileKey, repository)
    internals.queuesByKey.set(
      LocalProfileKey,
      new ProfileCommitQueue(repository)
    )

    const write = store.writeTabs(
      { tabs: [], activeTabId: null },
      'Change repository tabs'
    )
    const historyRead = store.getSettingsHistory()
    const [, history] = await Promise.all([write, historyRead])

    assert.equal(history.total, 2)
    assert.deepEqual(
      await getProfileCommitFiles(repository, history.entries[0].sha),
      ['tabs.json']
    )

    const undo = store.undoLastSettingsChange()
    const tabsRead = store.readTabs()
    const [, tabs] = await Promise.all([undo, tabsRead])
    assert.equal(tabs, null)
  })

  it('recovers tabs from the last valid atomic backup without polluting history', async t => {
    installTestLocalStorage(t)
    const [{ ProfileStore }, { AccountsStore }] = await Promise.all([
      import('../../src/lib/stores/profile-store'),
      import('../../src/lib/stores/accounts-store'),
    ])
    const repository = await createProfileRepository(t)
    await writeSettings(repository, { 'tab-size': '2' })
    await commitAllChanges(repository, 'Initialize profile')

    const previousTabSize = localStorage.getItem('tab-size')
    t.after(() => restoreStorageValue('tab-size', previousTabSize))
    localStorage.setItem('tab-size', '2')
    const store = new ProfileStore(
      new AccountsStore(new InMemoryStore(), new AsyncInMemoryStore())
    )
    const internals = store as unknown as {
      enabled: boolean
      lastSnapshotsByKey: Map<string, Record<string, string>>
      repositoriesByKey: Map<string, Repository>
      queuesByKey: Map<string, ProfileCommitQueue>
    }
    internals.enabled = true
    internals.lastSnapshotsByKey.set(LocalProfileKey, { 'tab-size': '2' })
    internals.repositoriesByKey.set(LocalProfileKey, repository)
    internals.queuesByKey.set(
      LocalProfileKey,
      new ProfileCommitQueue(repository)
    )

    const first = {
      tabs: [
        {
          id: 'first',
          repositoryId: 1,
          repositoryPath: 'C:\\repositories\\first',
          customLabel: null,
          titleStyle: null,
        },
      ],
      activeTabId: 'first',
    }
    const second = {
      tabs: [
        {
          id: 'second',
          repositoryId: 2,
          repositoryPath: 'C:\\repositories\\second',
          customLabel: null,
          titleStyle: null,
        },
      ],
      activeTabId: 'second',
    }
    await store.writeTabs(first, 'Save first tab state')
    await store.writeTabs(second, 'Save second tab state')
    await writeFile(join(repository.path, 'tabs.json'), '{"partial":', 'utf8')

    assert.deepEqual(await store.readTabs(), first)
    await store.flush()

    const history = await getProfileHistory(repository)
    assert.deepEqual(
      await getProfileCommitFiles(repository, history.entries[0].sha),
      ['tabs.json']
    )
    assert.equal(
      (await git(['status', '--porcelain'], repository.path, 'testStatus'))
        .stdout,
      ''
    )
  })

  it('preserves and appends settings edited after a non-modal history action begins', async t => {
    installTestLocalStorage(t)
    const [{ ProfileStore }, { AccountsStore }] = await Promise.all([
      import('../../src/lib/stores/profile-store'),
      import('../../src/lib/stores/accounts-store'),
    ])
    const repository = await createProfileRepository(t)
    await writeSettings(repository, { 'tab-size': '2' })
    await commitAllChanges(repository, 'Initialize profile')
    await writeSettings(repository, { 'tab-size': '4' })
    await commitAllChanges(repository, 'Change tab size to 4')

    const previousTabSize = localStorage.getItem('tab-size')
    t.after(() => restoreStorageValue('tab-size', previousTabSize))
    localStorage.setItem('tab-size', '4')
    const store = new ProfileStore(
      new AccountsStore(new InMemoryStore(), new AsyncInMemoryStore())
    )
    const internals = store as unknown as {
      enabled: boolean
      lastSnapshotsByKey: Map<string, Record<string, string>>
      repositoriesByKey: Map<string, Repository>
      queuesByKey: Map<string, ProfileCommitQueue>
    }
    internals.enabled = true
    internals.lastSnapshotsByKey.set(LocalProfileKey, { 'tab-size': '4' })
    internals.repositoriesByKey.set(LocalProfileKey, repository)
    internals.queuesByKey.set(
      LocalProfileKey,
      new ProfileCommitQueue(repository)
    )

    const undo = store.undoLastSettingsChange()
    localStorage.setItem('tab-size', '8')
    store.onAppStateChanged()
    await undo
    await store.flush()

    const history = await store.getSettingsHistory()
    assert.equal(localStorage.getItem('tab-size'), '8')
    assert.equal((await readSettings(repository)).settings['tab-size'], '8')
    assert.equal(history.entries[0].undoOf, null)
    assert.notEqual(history.entries[1].undoOf, null)
    assert.equal(history.canRedo, false)
  })
})

function restoreStorageValue(key: string, value: string | null) {
  if (value === null) {
    localStorage.removeItem(key)
  } else {
    localStorage.setItem(key, value)
  }
}

function installTestLocalStorage(t: TestContext) {
  if (globalThis.localStorage !== undefined) {
    return
  }

  const values = new Map<string, string>()
  const storage = {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
  t.after(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage
  })
}
