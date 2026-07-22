import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  mergeWindowTabsState,
  readWindowTabsState,
} from '../../src/lib/profiles/profile-tabs-file'
import {
  IProfileTabsState,
  IRepositoryTab,
  ITabGroup,
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

const group = (id: string): ITabGroup => ({
  id,
  name: `Group ${id}`,
  color: 'purple',
  isCollapsed: true,
})

const groupedState = (id: string, groupId: string): IProfileTabsState => ({
  tabs: [{ ...tab(id), groupId }],
  activeTabId: id,
  groups: [group(groupId)],
})

describe('profile tabs file window scopes', () => {
  it('loads the legacy single-window format as primary', () => {
    const legacy = { version: 1, ...state('a') }
    assert.deepEqual(readWindowTabsState(legacy, 'primary'), state('a'))
    assert.equal(readWindowTabsState(legacy, 'window-2'), null)
  })

  it('loads group metadata from the top-level primary format', () => {
    const topLevel = { version: 2, ...groupedState('a', 'group-a') }

    assert.deepEqual(
      readWindowTabsState(topLevel, 'primary'),
      groupedState('a', 'group-a')
    )
  })

  it('merges a secondary window without replacing primary tabs', () => {
    const merged = mergeWindowTabsState(
      { version: 2, ...groupedState('a', 'group-a') },
      'window-2',
      groupedState('b', 'group-b'),
      2
    )
    assert.deepEqual(
      readWindowTabsState(merged, 'primary'),
      groupedState('a', 'group-a')
    )
    assert.deepEqual(
      readWindowTabsState(merged, 'window-2'),
      groupedState('b', 'group-b')
    )
  })

  it('keeps the legacy top-level fields synchronized to primary', () => {
    const primary = groupedState('c', 'group-c')
    const merged = mergeWindowTabsState(
      { windows: { 'window-2': groupedState('b', 'group-b') } },
      'primary',
      primary,
      2
    ) as {
      tabs: ReadonlyArray<IRepositoryTab>
      activeTabId: string | null
      groups?: ReadonlyArray<ITabGroup>
    }
    assert.deepEqual(merged.tabs, primary.tabs)
    assert.equal(merged.activeTabId, 'c')
    assert.deepEqual(merged.groups, primary.groups)
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

  it('repairs malformed, duplicate, and untrusted group records safely', () => {
    const restored = readWindowTabsState(
      {
        windows: {
          primary: {
            ...state('a'),
            groups: [
              null,
              { id: '', name: 'Missing id', color: 'red' },
              { id: 'safe', name: '  Release   work  ', color: '#bad' },
              { id: 'safe', name: 'Duplicate', color: 'green' },
              { id: 'bad-name', name: 42, color: 'blue' },
            ],
          },
        },
      },
      'primary'
    )

    assert.deepEqual(restored?.groups, [
      { id: 'safe', name: 'Release work', color: 'blue' },
    ])
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

  it('round-trips optional pin/open time and unknown newer tab fields', () => {
    const futureTab = {
      ...tab('future'),
      isPinned: true,
      openedAt: 1740000000000,
      futureArrangementKey: { rank: 7 },
    } as unknown as IRepositoryTab
    const futureState: IProfileTabsState = {
      tabs: [futureTab],
      activeTabId: futureTab.id,
    }

    const persisted = JSON.parse(
      JSON.stringify(mergeWindowTabsState({}, 'window-future', futureState, 3))
    )
    const restored = readWindowTabsState(persisted, 'window-future')

    assert.deepEqual(restored, futureState)
  })

  it('round-trips unknown newer group fields in a scoped window', () => {
    const futureGroup = {
      ...group('future-group'),
      futureLayout: { density: 'compact' },
    } as unknown as ITabGroup
    const futureState: IProfileTabsState = {
      tabs: [{ ...tab('future'), groupId: futureGroup.id }],
      activeTabId: 'future',
      groups: [futureGroup],
    }

    const persisted = JSON.parse(
      JSON.stringify(mergeWindowTabsState({}, 'window-future', futureState, 3))
    )

    assert.deepEqual(
      readWindowTabsState(persisted, 'window-future'),
      futureState
    )
  })
})
