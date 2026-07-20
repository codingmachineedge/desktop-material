import './profile-history-test-env'

import assert from 'node:assert'
import { stat } from 'fs/promises'
import { join } from 'path'
import { describe, it } from 'node:test'

import { ElementAppearanceCoordinator } from '../../src/lib/stores/element-appearance-coordinator'
import { ProfileStore } from '../../src/lib/stores/profile-store'
import { RepositoryTabsStore } from '../../src/lib/stores/repository-tabs-store'
import { IProfileTabsState } from '../../src/models/repository-tab'
import { createTempDirectory } from '../helpers/temp'

function profileWithTabs(
  initial: IProfileTabsState,
  writes: IProfileTabsState[]
): ProfileStore {
  return {
    getActiveProfileKey: () => 'local',
    getActiveProfileRepositoryPath: () => null,
    onDidUpdate: () => ({ dispose: () => undefined }),
    readTabs: () => Promise.resolve(initial),
    writeTabs: (state: IProfileTabsState) => {
      writes.push(state)
      return Promise.resolve()
    },
  } as unknown as ProfileStore
}

describe('RepositoryTabsStore dedicated appearance history', () => {
  it('migrates, overlays, and versions each tab title in its own repository', async t => {
    localStorage.clear()
    const root = await createTempDirectory(t)
    const legacy: IProfileTabsState = {
      tabs: [
        {
          id: 'alpha-tab',
          repositoryId: 1,
          repositoryPath: 'C:\\work\\alpha',
          customLabel: null,
          titleStyle: { bold: true },
        },
        {
          id: 'beta-tab',
          repositoryId: 2,
          repositoryPath: 'C:\\work\\beta',
          customLabel: null,
          titleStyle: { italic: true },
        },
      ],
      activeTabId: 'alpha-tab',
    }
    const writes: IProfileTabsState[] = []
    const profile = profileWithTabs(legacy, writes)
    const coordinator = new ElementAppearanceCoordinator(profile)
    await coordinator.initialize(join(root, 'appearance-elements'))
    const store = new RepositoryTabsStore(
      profile,
      'primary',
      Date.now,
      coordinator
    )

    await store.initialize()

    assert.deepEqual(store.getState().tabs[0].titleStyle, { bold: true })
    assert.deepEqual(store.getState().tabs[1].titleStyle, { italic: true })
    assert.equal(writes.length, 1)
    assert.deepEqual(
      writes[0].tabs.map(tab => tab.titleStyle),
      [null, null]
    )

    const alphaPath = store.getTabStyleRepositoryPath('alpha-tab')
    const betaPath = store.getTabStyleRepositoryPath('beta-tab')
    assert.notEqual(alphaPath, null)
    assert.notEqual(betaPath, null)
    assert.notEqual(alphaPath, betaPath)
    assert.equal((await stat(join(alphaPath!, '.git'))).isDirectory(), true)
    assert.equal((await stat(join(betaPath!, '.git'))).isDirectory(), true)

    await store.setTabStyle('alpha-tab', { underline: true })
    await coordinator.flush()

    assert.deepEqual(store.getState().tabs[0].titleStyle, {
      bold: true,
      underline: true,
    })
    assert.deepEqual(store.getState().tabs[1].titleStyle, { italic: true })
    assert.equal(
      writes.length,
      1,
      'appearance edits must not write the profile tabs file'
    )

    const alphaHistory = store.getTabStyleHistorySource('alpha-tab')
    const betaHistory = store.getTabStyleHistorySource('beta-tab')
    assert.notEqual(alphaHistory, null)
    assert.notEqual(betaHistory, null)
    assert.equal((await alphaHistory!.getHistory()).total, 2)
    assert.equal((await betaHistory!.getHistory()).total, 1)

    await alphaHistory!.undoLastChange!()
    await store.reloadTabStyleFromElement('alpha-tab')
    assert.deepEqual(store.getState().tabs[0].titleStyle, { bold: true })

    await alphaHistory!.redoLastChange!()
    await store.reloadTabStyleFromElement('alpha-tab')
    assert.deepEqual(store.getState().tabs[0].titleStyle, {
      bold: true,
      underline: true,
    })

    const initialSha = (await alphaHistory!.getHistory()).entries.at(-1)?.sha
    assert.notEqual(initialSha, undefined)
    await alphaHistory!.restoreTo!(initialSha!)
    await store.reloadTabStyleFromElement('alpha-tab')
    assert.deepEqual(store.getState().tabs[0].titleStyle, { bold: true })
    assert.equal((await alphaHistory!.getHistory()).total, 5)

    await store.renameTab('alpha-tab', 'Alpha workspace')
    assert.equal(writes.length, 2)
    assert.equal(writes[1].tabs[0].customLabel, 'Alpha workspace')
    assert.deepEqual(
      writes[1].tabs.map(tab => tab.titleStyle),
      [null, null],
      'later structural commits must keep appearance out of tabs.json'
    )
  })

  it('keeps a dedicated value authoritative when legacy tabs.json is reloaded', async t => {
    localStorage.clear()
    const root = await createTempDirectory(t)
    const legacy: IProfileTabsState = {
      tabs: [
        {
          id: 'stable-tab',
          repositoryId: 1,
          repositoryPath: 'C:\\work\\stable',
          customLabel: null,
          titleStyle: { bold: true },
        },
      ],
      activeTabId: 'stable-tab',
    }
    const profile = profileWithTabs(legacy, [])
    const coordinator = new ElementAppearanceCoordinator(profile)
    await coordinator.initialize(join(root, 'appearance-elements'))
    const store = new RepositoryTabsStore(
      profile,
      'primary',
      Date.now,
      coordinator
    )
    await store.initialize()
    await store.setTabStyle('stable-tab', { color: '#123456' })

    await store.reloadFromDisk()

    assert.deepEqual(store.getActiveTab()?.titleStyle, {
      bold: true,
      color: '#123456',
    })
  })
})
