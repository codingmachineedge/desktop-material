import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  mergeWindowTabsState,
  readWindowTabsState,
} from '../../src/lib/profiles/profile-tabs-file'
import {
  IProfileTabsState,
  IRepositoryTab,
  ITabTitleStyle,
} from '../../src/models/repository-tab'

const tab = (id: string): IRepositoryTab => ({
  id,
  repositoryId: id.charCodeAt(0),
  repositoryPath: `C:\\repos\\${id}`,
  customLabel: null,
  titleStyle: null,
})

const state = (id: string): IProfileTabsState => ({
  tabs: [tab(id)],
  activeTabId: id,
})

describe('profile tabs file window scopes', () => {
  it('loads the legacy single-window format as primary', () => {
    const legacy = { version: 1, ...state('a') }
    assert.deepEqual(readWindowTabsState(legacy, 'primary'), state('a'))
    assert.equal(readWindowTabsState(legacy, 'window-2'), null)
  })

  it('merges a secondary window without replacing primary tabs', () => {
    const merged = mergeWindowTabsState(
      { version: 1, ...state('a') },
      'window-2',
      state('b'),
      1
    )
    assert.deepEqual(readWindowTabsState(merged, 'primary'), state('a'))
    assert.deepEqual(readWindowTabsState(merged, 'window-2'), state('b'))
  })

  it('keeps the legacy top-level fields synchronized to primary', () => {
    const merged = mergeWindowTabsState(
      { windows: { 'window-2': state('b') } },
      'primary',
      state('c'),
      1
    ) as { tabs: ReadonlyArray<IRepositoryTab>; activeTabId: string | null }
    assert.deepEqual(merged.tabs, state('c').tabs)
    assert.equal(merged.activeTabId, 'c')
  })

  it('ignores malformed scoped entries', () => {
    assert.equal(
      readWindowTabsState(
        { windows: { 'window-2': { tabs: 'bad', activeTabId: 1 } } },
        'window-2'
      ),
      null
    )
  })

  it('preserves unknown newer tab-appearance keys across merge and read', () => {
    const futureStyle = {
      bold: true,
      futurePaletteMode: 'theme',
      futurePaletteTokens: ['primary', 'secondary'],
    } as unknown as ITabTitleStyle
    const futureState: IProfileTabsState = {
      tabs: [{ ...tab('z'), titleStyle: futureStyle }],
      activeTabId: 'z',
    }

    const persisted = JSON.parse(
      JSON.stringify(mergeWindowTabsState({}, 'primary', futureState, 2))
    )
    const restored = readWindowTabsState(persisted, 'primary')

    assert.deepEqual(restored, futureState)
  })
})
