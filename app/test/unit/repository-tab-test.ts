import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  clampTabFontSize,
  clampTabCharacterSpacing,
  isValidTabColor,
  isValidFontFamily,
  tabTitleStyleToCss,
  tabFrameStyleToCss,
  tabFontStack,
  tabFontOptions,
  MinTabFontSize,
  MaxTabFontSize,
  MinTabCharacterSpacing,
  MaxTabCharacterSpacing,
  DefaultTabCharacterSpacing,
  IRepositoryTab,
  IProfileTabsState,
  ITabTitleStyle,
} from '../../src/models/repository-tab'
import { Repository, SubmoduleRepository } from '../../src/models/repository'
import { ProfileStore } from '../../src/lib/stores/profile-store'
import { RepositoryTabsStore } from '../../src/lib/stores/repository-tabs-store'
import { FilterMode } from '../../src/lib/fuzzy-find'
import {
  ITabSessionFile,
  TabSessionFormat,
  TabSessionVersion,
} from '../../src/lib/tab-session-file'

describe('clampTabFontSize', () => {
  it('clamps below the minimum', () => {
    assert.equal(clampTabFontSize(2), MinTabFontSize)
  })

  it('clamps above the maximum', () => {
    assert.equal(clampTabFontSize(99), MaxTabFontSize)
  })

  it('rounds values within range', () => {
    assert.equal(clampTabFontSize(12.4), 12)
    assert.equal(clampTabFontSize(12.6), 13)
  })
})

describe('clampTabCharacterSpacing', () => {
  it('clamps and snaps to quarter-pixel increments', () => {
    assert.equal(clampTabCharacterSpacing(-10), MinTabCharacterSpacing)
    assert.equal(clampTabCharacterSpacing(20), MaxTabCharacterSpacing)
    assert.equal(clampTabCharacterSpacing(1.13), 1.25)
  })

  it('falls back safely for non-finite persisted values', () => {
    assert.equal(
      clampTabCharacterSpacing(Number.NaN),
      DefaultTabCharacterSpacing
    )
    assert.equal(
      clampTabCharacterSpacing(Number.POSITIVE_INFINITY),
      DefaultTabCharacterSpacing
    )
  })
})

describe('isValidTabColor', () => {
  it('accepts hex colors', () => {
    assert.ok(isValidTabColor('#fff'))
    assert.ok(isValidTabColor('#00ff00'))
    assert.ok(isValidTabColor('#11223344'))
  })

  it('rejects anything that is not a hex color', () => {
    assert.ok(!isValidTabColor('red'))
    assert.ok(!isValidTabColor('url(x)'))
    assert.ok(!isValidTabColor('#ggg'))
    assert.ok(!isValidTabColor('javascript:alert(1)'))
  })
})

describe('tabTitleStyleToCss', () => {
  it('returns an empty object for a null style', () => {
    assert.deepEqual(tabTitleStyleToCss(null), {})
  })

  it('drops a color that fails validation (no CSS injection)', () => {
    const css = tabTitleStyleToCss({ color: 'expression(alert(1))' })
    assert.equal(css.color, undefined)
  })

  it('keeps a valid color', () => {
    const css = tabTitleStyleToCss({ color: '#123456' })
    assert.equal(css.color, '#123456')
  })

  it('applies bold, italic, underline, and strikethrough together', () => {
    const css = tabTitleStyleToCss({
      bold: true,
      italic: true,
      underline: true,
      strikeThrough: true,
    })
    assert.equal(css.fontWeight, 'bold')
    assert.equal(css.fontStyle, 'italic')
    assert.equal(css.textDecoration, 'underline line-through')
  })

  it('applies small caps and only supported case transforms', () => {
    const css = tabTitleStyleToCss({
      smallCaps: true,
      textCase: 'uppercase',
    })
    assert.equal(css.fontVariant, 'small-caps')
    assert.equal(css.textTransform, 'uppercase')

    const malformed = tabTitleStyleToCss({
      textCase: 'rotate(90deg)',
    } as unknown as ITabTitleStyle)
    assert.equal(malformed.textTransform, undefined)
  })

  it('clamps character spacing and drops non-finite values', () => {
    assert.equal(
      tabTitleStyleToCss({ characterSpacing: 9 }).letterSpacing,
      '4px'
    )
    assert.equal(
      tabTitleStyleToCss({ characterSpacing: 0.62 }).letterSpacing,
      '0.5px'
    )
    assert.equal(
      tabTitleStyleToCss({ characterSpacing: Number.NaN }).letterSpacing,
      undefined
    )
  })

  it('maps only curated text effects to fixed CSS', () => {
    assert.equal(
      tabTitleStyleToCss({ textEffect: 'soft-shadow' }).textShadow,
      '0 1px 2px rgb(0 0 0 / 35%)'
    )
    assert.equal(
      tabTitleStyleToCss({ textEffect: 'strong-shadow' }).textShadow,
      '1px 2px 3px rgb(0 0 0 / 55%)'
    )
    assert.equal(tabTitleStyleToCss({ textEffect: 'none' }).textShadow, 'none')
    assert.equal(
      tabTitleStyleToCss({
        textEffect: 'url(javascript:alert(1))',
      } as unknown as ITabTitleStyle).textShadow,
      undefined
    )
  })

  it('uses a validated background color as a text highlight', () => {
    assert.equal(
      tabTitleStyleToCss({ backgroundColor: '#ffff00' }).backgroundColor,
      '#ffff00'
    )
    assert.equal(
      tabTitleStyleToCss({ backgroundColor: 'url(x)' }).backgroundColor,
      undefined
    )
  })

  it('clamps the font size', () => {
    assert.equal(tabTitleStyleToCss({ fontSize: 100 }).fontSize, '32px')
    assert.equal(tabTitleStyleToCss({ fontSize: 1 }).fontSize, '10px')
  })

  it('resolves a curated font family to its stack', () => {
    assert.equal(
      tabTitleStyleToCss({ fontFamily: 'Segoe UI' }).fontFamily,
      `'Segoe UI', system-ui, sans-serif`
    )
  })

  it('keeps back-compat with legacy font buckets', () => {
    // 'system' inherits the default (no override).
    assert.equal(
      tabTitleStyleToCss({ fontFamily: 'system' }).fontFamily,
      undefined
    )
    // 'serif'/'monospace' still resolve to serif/monospace stacks.
    assert.equal(
      tabTitleStyleToCss({ fontFamily: 'serif' }).fontFamily,
      'serif'
    )
    assert.equal(
      tabTitleStyleToCss({ fontFamily: 'monospace' }).fontFamily,
      'monospace'
    )
  })

  it('drops a font family that fails validation (no CSS injection)', () => {
    assert.equal(
      tabTitleStyleToCss({ fontFamily: 'Arial; } body { display:none' })
        .fontFamily,
      undefined
    )
  })
})

describe('isValidFontFamily', () => {
  it('accepts curated and generic family names', () => {
    assert.ok(isValidFontFamily('Segoe UI'))
    assert.ok(isValidFontFamily('Times New Roman'))
    assert.ok(isValidFontFamily('sans-serif'))
  })

  it('rejects names carrying CSS punctuation', () => {
    assert.ok(!isValidFontFamily('Arial;'))
    assert.ok(!isValidFontFamily('a{color:red}'))
    assert.ok(!isValidFontFamily(''))
  })
})

describe('tabFontStack', () => {
  it('offers bundled Roboto Serif without changing persisted Roboto Slab', () => {
    assert.deepEqual(
      tabFontOptions
        .filter(option =>
          ['Roboto Serif', 'Roboto Slab', 'Roboto Mono'].includes(option.family)
        )
        .map(option => option.family),
      ['Roboto Slab', 'Roboto Serif', 'Roboto Mono']
    )
    assert.equal(tabFontStack('Roboto Serif'), `'Roboto Serif', Georgia, serif`)
    assert.equal(tabFontStack('Roboto Slab'), `'Roboto Slab', Georgia, serif`)
    assert.equal(
      tabFontStack('Roboto Mono'),
      `'Roboto Mono', Consolas, monospace`
    )
  })

  it('quotes an unknown but valid family with a generic fallback', () => {
    assert.equal(tabFontStack('My Font'), `'My Font', sans-serif`)
  })

  it('returns undefined for an unsafe family', () => {
    assert.equal(tabFontStack('a}b{'), undefined)
  })
})

describe('tabFrameStyleToCss', () => {
  it('does not grow the frame at or below the default size', () => {
    assert.deepEqual(tabFrameStyleToCss(null), {})
    assert.deepEqual(tabFrameStyleToCss({}), {})
    assert.deepEqual(tabFrameStyleToCss({ fontSize: 13 }), {})
  })

  it('grows height and min-width for a larger size', () => {
    const css = tabFrameStyleToCss({ fontSize: 32 })
    assert.ok(typeof css.height === 'string' && parseInt(css.height, 10) > 38)
    assert.ok(
      typeof css.minWidth === 'string' && parseInt(css.minWidth, 10) > 132
    )
  })

  it('caps min-width at the strip max width', () => {
    const css = tabFrameStyleToCss({ fontSize: MaxTabFontSize })
    assert.ok(parseInt(String(css.minWidth), 10) <= 240)
  })
})

describe('RepositoryTabsStore', () => {
  it('rebinds a restored active tab by path without losing its presentation', async () => {
    let writes = 0
    const restored = {
      tabs: [
        {
          id: 'restored-tab',
          repositoryId: 41,
          repositoryPath: 'C:\\work\\desktop-material',
          customLabel: 'Styled tab',
          titleStyle: { bold: true },
        },
      ],
      activeTabId: 'restored-tab',
    }
    const profileStore = {
      readTabs: () => Promise.resolve(restored),
      writeTabs: () => {
        writes++
        return Promise.resolve()
      },
    } as unknown as ProfileStore
    const store = new RepositoryTabsStore(profileStore)
    await store.initialize()

    store.rebindActiveTabToRepository({
      id: 99,
      path: 'C:\\work\\desktop-material',
    } as Repository)

    const active = store.getActiveTab()
    assert.equal(active?.repositoryId, 99)
    assert.equal(active?.customLabel, 'Styled tab')
    assert.deepEqual(active?.titleStyle, { bold: true })
    assert.equal(store.getState().tabs.length, 1)
    assert.equal(writes, 0)
  })

  it('patches tab styles without deleting unknown newer appearance keys', async () => {
    const futureStyle = {
      color: '#123456',
      futurePaletteMode: 'theme',
      futureRecentColors: ['#abcdef'],
    } as unknown as ITabTitleStyle
    const restored: IProfileTabsState = {
      tabs: [
        {
          id: 'future-tab',
          repositoryId: 41,
          repositoryPath: 'C:\\work\\desktop-material',
          customLabel: null,
          titleStyle: futureStyle,
        },
      ],
      activeTabId: 'future-tab',
    }
    const profileStore = {
      readTabs: () => Promise.resolve(restored),
      writeTabs: () => Promise.resolve(),
    } as unknown as ProfileStore
    const store = new RepositoryTabsStore(profileStore)
    await store.initialize()

    await store.setTabStyle('future-tab', { bold: true })

    assert.deepEqual(store.getActiveTab()?.titleStyle, {
      color: '#123456',
      futurePaletteMode: 'theme',
      futureRecentColors: ['#abcdef'],
      bold: true,
    })
  })

  it('still clears every style key when clear formatting is requested', async () => {
    const restored: IProfileTabsState = {
      tabs: [
        {
          id: 'styled-tab',
          repositoryId: 41,
          repositoryPath: 'C:\\work\\desktop-material',
          customLabel: null,
          titleStyle: { bold: true, strikeThrough: true },
        },
      ],
      activeTabId: 'styled-tab',
    }
    const profileStore = {
      readTabs: () => Promise.resolve(restored),
      writeTabs: () => Promise.resolve(),
    } as unknown as ProfileStore
    const store = new RepositoryTabsStore(profileStore)
    await store.initialize()

    await store.setTabStyle('styled-tab', null)

    assert.equal(store.getActiveTab()?.titleStyle, null)
  })
})

describe('RepositoryTabsStore range and match close', () => {
  function makeTab(
    id: string,
    name: string,
    customLabel: string | null = null
  ): IRepositoryTab {
    return {
      id,
      repositoryId: id.charCodeAt(0),
      repositoryPath: `C:\\work\\${name}`,
      customLabel,
      titleStyle: null,
    }
  }

  async function makeStore(
    tabs: ReadonlyArray<IRepositoryTab>,
    activeTabId: string | null
  ): Promise<{ store: RepositoryTabsStore; getWrites: () => number }> {
    let writes = 0
    const initial: IProfileTabsState = { tabs, activeTabId }
    const profileStore = {
      readTabs: () => Promise.resolve(initial),
      writeTabs: () => {
        writes++
        return Promise.resolve()
      },
    } as unknown as ProfileStore
    const store = new RepositoryTabsStore(profileStore)
    await store.initialize()
    return { store, getWrites: () => writes }
  }

  const layout = () => [
    makeTab('a', 'alpha'),
    makeTab('b', 'bravo'),
    makeTab('c', 'charlie'),
    makeTab('d', 'delta'),
  ]

  it('closeTabsToLeft removes earlier tabs and keeps a surviving active', async () => {
    const { store } = await makeStore(layout(), 'd')
    const active = await store.closeTabsToLeft('c')

    assert.deepEqual(
      store.getState().tabs.map(t => t.id),
      ['c', 'd']
    )
    assert.equal(active, 'd')
    assert.equal(store.getState().activeTabId, 'd')
  })

  it('closeTabsToLeft reactivates the anchor when the active tab is removed', async () => {
    const { store } = await makeStore(layout(), 'a')
    const active = await store.closeTabsToLeft('c')

    assert.deepEqual(
      store.getState().tabs.map(t => t.id),
      ['c', 'd']
    )
    assert.equal(active, 'c')
    assert.equal(store.getState().activeTabId, 'c')
  })

  it('closeTabsToLeft is a no-op on the first tab', async () => {
    const { store, getWrites } = await makeStore(layout(), 'b')
    const active = await store.closeTabsToLeft('a')

    assert.equal(store.getState().tabs.length, 4)
    assert.equal(active, 'b')
    assert.equal(getWrites(), 0)
  })

  it('closeTabsToRight removes later tabs and reactivates the anchor when needed', async () => {
    const { store } = await makeStore(layout(), 'd')
    const active = await store.closeTabsToRight('b')

    assert.deepEqual(
      store.getState().tabs.map(t => t.id),
      ['a', 'b']
    )
    // The active 'd' was removed, so the anchor 'b' is reactivated.
    assert.equal(active, 'b')
  })

  it('closeTabsToRight is a no-op on the last tab', async () => {
    const { store, getWrites } = await makeStore(layout(), 'a')
    const active = await store.closeTabsToRight('d')

    assert.equal(store.getState().tabs.length, 4)
    assert.equal(active, 'a')
    assert.equal(getWrites(), 0)
  })

  it('closeOtherTabs keeps only the anchor and activates it', async () => {
    const { store } = await makeStore(layout(), 'a')
    const active = await store.closeOtherTabs('c')

    assert.deepEqual(
      store.getState().tabs.map(t => t.id),
      ['c']
    )
    assert.equal(active, 'c')
    assert.equal(store.getState().activeTabId, 'c')
  })

  it('closeTabsMatching prunes substring matches and reactivates a neighbor', async () => {
    // 'a' and 'd' become the surviving edges; match the two middle tabs.
    const tabs = [
      makeTab('a', 'alpha'),
      makeTab('b', 'bravo-test'),
      makeTab('c', 'charlie-test'),
      makeTab('d', 'delta'),
    ]
    const { store } = await makeStore(tabs, 'b')
    const active = await store.closeTabsMatching('test', FilterMode.Substring)

    assert.deepEqual(
      store.getState().tabs.map(t => t.id),
      ['a', 'd']
    )
    // Active 'b' was pruned; the nearest survivor to its right is 'd'.
    assert.equal(active, 'd')
    assert.equal(store.getState().activeTabId, 'd')
  })

  it('closeTabsMatching matches against a custom label', async () => {
    const tabs = [
      makeTab('a', 'alpha', 'Keep me'),
      makeTab('b', 'bravo', 'Scratch space'),
      makeTab('c', 'charlie'),
    ]
    const { store } = await makeStore(tabs, 'a')
    await store.closeTabsMatching('scratch', FilterMode.Substring)

    assert.deepEqual(
      store.getState().tabs.map(t => t.id),
      ['a', 'c']
    )
  })

  it('closeTabsMatching with an invalid regex is a no-op', async () => {
    const { store, getWrites } = await makeStore(layout(), 'a')
    const active = await store.closeTabsMatching('(', FilterMode.Regex)

    assert.equal(store.getState().tabs.length, 4)
    assert.equal(active, 'a')
    assert.equal(getWrites(), 0)
  })

  it('closeTabsMatching supports valid regex patterns', async () => {
    const { store } = await makeStore(layout(), 'a')
    await store.closeTabsMatching('^(alpha|delta)$', FilterMode.Regex)

    assert.deepEqual(
      store.getState().tabs.map(t => t.id),
      ['b', 'c']
    )
  })

  it('findMatchingTabs reports a regex error without matching anything', async () => {
    const { store } = await makeStore(layout(), 'a')
    const result = store.findMatchingTabs('(', FilterMode.Regex)

    assert.notEqual(result.regexError, null)
    assert.equal(result.tabs.length, 0)
  })

  it('findMatchingTabs returns nothing for an empty query', async () => {
    const { store } = await makeStore(layout(), 'a')
    const result = store.findMatchingTabs('', FilterMode.Substring)

    assert.equal(result.regexError, null)
    assert.equal(result.tabs.length, 0)
  })
})

describe('RepositoryTabsStore window scope', () => {
  it('reads and writes only its assigned window slot', async () => {
    const scopes: string[] = []
    const initial: IProfileTabsState = { tabs: [], activeTabId: null }
    const profileStore = {
      readTabs: (scope: string) => {
        scopes.push(`read:${scope}`)
        return Promise.resolve(initial)
      },
      writeTabs: (
        _state: IProfileTabsState,
        _description: string,
        scope: string
      ) => {
        scopes.push(`write:${scope}`)
        return Promise.resolve()
      },
    } as unknown as ProfileStore
    const store = new RepositoryTabsStore(profileStore, 'window-2')
    await store.initialize()
    await store.ensureTabForRepository(
      new Repository('C:\\repos\\secondary', 501, null, false)
    )

    assert.deepEqual(scopes, ['read:window-2', 'write:window-2'])
  })

  it('never persists or rebinds a temporary submodule tab', async () => {
    const writes: IProfileTabsState[] = []
    const initial: IProfileTabsState = {
      tabs: [
        {
          id: 'root-tab',
          repositoryId: 502,
          repositoryPath: 'C:\\repos\\root',
          customLabel: null,
          titleStyle: null,
        },
      ],
      activeTabId: 'root-tab',
    }
    const profileStore = {
      readTabs: () => Promise.resolve(initial),
      writeTabs: (state: IProfileTabsState) => {
        writes.push(state)
        return Promise.resolve()
      },
    } as unknown as ProfileStore
    const parent = new Repository('C:\\repos\\root', 502, null, false)
    const temporary = new SubmoduleRepository(
      'C:\\repos\\root\\vendor\\child',
      'C:\\repos\\root\\.git\\modules\\vendor\\child',
      parent,
      {
        name: 'vendor/child',
        path: 'vendor/child',
        url: 'https://example.invalid/child.git',
        branch: null,
        update: null,
        ignore: null,
        shallow: null,
        fetchRecurseSubmodules: null,
        sha: '0123456789012345678901234567890123456789',
        describe: null,
        status: 'up-to-date',
      }
    )
    const store = new RepositoryTabsStore(profileStore, 'window-temp')
    await store.initialize()

    await store.ensureTabForRepository(temporary)
    store.rebindActiveTabToRepository(temporary)

    assert.equal(writes.length, 0)
    assert.deepEqual(store.getState(), initial)
  })
})

describe('RepositoryTabsStore pinning and arrangement', () => {
  function tab(
    id: string,
    options: {
      readonly name?: string
      readonly customLabel?: string | null
      readonly isPinned?: boolean
      readonly isFavorite?: boolean
      readonly openedAt?: number
      readonly repositoryId?: number
    } = {}
  ): IRepositoryTab {
    return {
      id,
      repositoryId: options.repositoryId ?? id.charCodeAt(0),
      repositoryPath: `C:\\work\\${options.name ?? id}`,
      customLabel: options.customLabel ?? null,
      titleStyle: null,
      ...(options.isPinned === undefined ? {} : { isPinned: options.isPinned }),
      ...(options.isFavorite === undefined
        ? {}
        : { isFavorite: options.isFavorite }),
      ...(options.openedAt === undefined ? {} : { openedAt: options.openedAt }),
    }
  }

  async function storeFor(
    tabs: ReadonlyArray<IRepositoryTab>,
    activeTabId: string | null = tabs[0]?.id ?? null,
    now: () => number = Date.now
  ): Promise<{
    readonly store: RepositoryTabsStore
    readonly writes: ReadonlyArray<{
      readonly state: IProfileTabsState
      readonly scope: string
    }>
  }> {
    const writes: Array<{ state: IProfileTabsState; scope: string }> = []
    const profileStore = {
      readTabs: () => Promise.resolve({ tabs, activeTabId }),
      writeTabs: (
        state: IProfileTabsState,
        _description: string,
        scope: string
      ) => {
        writes.push({ state, scope })
        return Promise.resolve()
      },
    } as unknown as ProfileStore
    const store = new RepositoryTabsStore(profileStore, 'arrange-window', now)
    await store.initialize()
    return { store, writes }
  }

  const ids = (store: RepositoryTabsStore) =>
    store.getState().tabs.map(item => item.id)

  it('timestamps newly opened tabs without rewriting legacy timestamps', async () => {
    const legacy = tab('legacy')
    const { store } = await storeFor([legacy], 'legacy', () => 123456)

    await store.ensureTabForRepository(
      new Repository('C:\\work\\new-repository', 999, null, false)
    )

    assert.equal(store.getState().tabs[0].openedAt, undefined)
    assert.equal(store.getState().tabs[1].openedAt, 123456)
  })

  it('normalizes a restored pin group and preserves active selection', async () => {
    const restored = [
      tab('u1'),
      tab('p1', { isPinned: true }),
      tab('u2'),
      tab('p2', { isPinned: true }),
    ]
    const { store, writes } = await storeFor(restored, 'u2')

    assert.deepEqual(ids(store), ['p1', 'p2', 'u1', 'u2'])
    assert.equal(store.getState().activeTabId, 'u2')
    assert.equal(writes.length, 0)
  })

  it('pins and unpins at the group boundary without changing the active tab', async () => {
    const { store } = await storeFor(
      [tab('p1', { isPinned: true }), tab('u1'), tab('u2')],
      'u2'
    )

    await store.setTabPinned('u2', true)
    assert.deepEqual(ids(store), ['p1', 'u2', 'u1'])
    assert.equal(store.getState().activeTabId, 'u2')
    assert.equal(store.getState().tabs[1].isPinned, true)

    await store.toggleTabPinned('p1')
    assert.deepEqual(ids(store), ['u2', 'p1', 'u1'])
    assert.equal(store.getState().tabs[1].isPinned, false)
    assert.equal(store.getState().activeTabId, 'u2')
  })

  it('stars tabs independently and arranges favorites inside pin groups', async () => {
    const { store } = await storeFor([
      tab('p-normal', { isPinned: true }),
      tab('p-favorite', { isPinned: true, isFavorite: true }),
      tab('u-normal'),
      tab('u-favorite', { isFavorite: true }),
    ])

    await store.arrangeTabsByFavorite('favorites-first')
    assert.deepEqual(ids(store), [
      'p-favorite',
      'p-normal',
      'u-favorite',
      'u-normal',
    ])

    await store.setTabFavorite('u-normal', true)
    assert.equal(store.getState().tabs[3].isFavorite, true)
    await store.toggleTabFavorite('u-favorite')
    assert.equal(
      store.getState().tabs.find(item => item.id === 'u-favorite')?.isFavorite,
      false
    )

    await store.arrangeTabsByFavorite('favorites-last')
    assert.deepEqual(ids(store), [
      'p-normal',
      'p-favorite',
      'u-favorite',
      'u-normal',
    ])
  })

  it('restricts manual moves to the tab pinned group', async () => {
    const { store } = await storeFor([
      tab('p1', { isPinned: true }),
      tab('p2', { isPinned: true }),
      tab('u1'),
      tab('u2'),
    ])

    await store.moveTab('u2', 0)
    assert.deepEqual(ids(store), ['p1', 'p2', 'u2', 'u1'])

    await store.moveTab('p1', 99)
    assert.deepEqual(ids(store), ['p2', 'p1', 'u2', 'u1'])
  })

  it('protects pinned tabs from user bulk close but permits explicit close', async () => {
    const { store } = await storeFor(
      [tab('p', { isPinned: true }), tab('u1'), tab('u2')],
      'u1'
    )

    await store.closeOtherTabs('u2')
    assert.deepEqual(ids(store), ['p', 'u2'])
    assert.equal(store.getState().activeTabId, 'u2')

    await store.closeTab('p')
    assert.deepEqual(ids(store), ['u2'])
  })

  it('removes pinned bindings when their repository is actually removed', async () => {
    const { store } = await storeFor(
      [
        tab('p', { isPinned: true, repositoryId: 10 }),
        tab('u1', { repositoryId: 10 }),
        tab('u2'),
      ],
      'p'
    )

    await store.closeTabsForRepository(10)

    assert.deepEqual(ids(store), ['u2'])
    assert.equal(store.getState().activeTabId, 'u2')
  })

  it('previews and closes all except literal matches using repository aliases', async () => {
    const tabs = [
      tab('a', { name: 'desktop-material', customLabel: 'Main workspace' }),
      tab('b', { name: 'api-service' }),
      tab('p', { name: 'protected', isPinned: true }),
    ]
    const { store } = await storeFor(tabs, 'b')
    const aliases = (candidate: IRepositoryTab) =>
      candidate.id === 'a' ? ['Material Alias', 'Desktop Material'] : []

    const preview = store.previewCloseTabsExceptContaining(
      'MATERIAL ALIAS',
      aliases
    )
    assert.deepEqual(
      preview.matchingTabs.map(item => item.id),
      ['a']
    )
    assert.deepEqual(
      preview.keptTabs.map(item => item.id),
      ['p', 'a']
    )
    assert.deepEqual(
      preview.closedTabs.map(item => item.id),
      ['b']
    )
    assert.equal(preview.canClose, true)

    await store.closeTabsExceptContaining('material alias', aliases)
    assert.deepEqual(ids(store), ['p', 'a'])
    assert.equal(store.getState().activeTabId, 'a')
  })

  it('never closes for blank or zero-match inverse queries', async () => {
    const { store, writes } = await storeFor([tab('a'), tab('b')])

    assert.equal(store.previewCloseTabsExceptContaining('  ').canClose, false)
    assert.equal(
      store.previewCloseTabsExceptContaining('missing').canClose,
      false
    )
    await store.closeTabsExceptContaining('missing')

    assert.deepEqual(ids(store), ['a', 'b'])
    assert.equal(writes.length, 0)
  })

  it('matches inverse-close queries against the full local path literally', async () => {
    const { store } = await storeFor([
      {
        ...tab('a'),
        repositoryPath: 'C:\\clients\\North [literal]\\repo',
      },
      tab('b'),
    ])

    const preview = store.previewCloseTabsExceptContaining('[LITERAL]')
    assert.deepEqual(
      preview.matchingTabs.map(item => item.id),
      ['a']
    )
    assert.equal(preview.canClose, true)
  })

  it('arranges labels locale-aware and stably inside pin groups', async () => {
    const { store } = await storeFor([
      tab('p10', { customLabel: 'Repo 10', isPinned: true }),
      tab('p2', { customLabel: 'Repo 2', isPinned: true }),
      tab('same1', { customLabel: 'Same' }),
      tab('b', { customLabel: 'beta' }),
      tab('same2', { customLabel: 'same' }),
    ])

    await store.arrangeTabsByLabel('ascending')
    assert.deepEqual(ids(store), ['p2', 'p10', 'b', 'same1', 'same2'])

    await store.arrangeTabsByLabel('descending')
    assert.deepEqual(ids(store), ['p10', 'p2', 'same1', 'same2', 'b'])
  })

  it('arranges opened time migration-safely and keeps stable ties', async () => {
    const { store } = await storeFor([
      tab('legacy1'),
      tab('new', { openedAt: 300 }),
      tab('legacy2'),
      tab('old', { openedAt: 100 }),
    ])

    await store.arrangeTabsByOpenedAt('oldest')
    assert.deepEqual(ids(store), ['legacy1', 'legacy2', 'old', 'new'])

    await store.arrangeTabsByOpenedAt('newest')
    assert.deepEqual(ids(store), ['new', 'old', 'legacy1', 'legacy2'])
  })

  it('arranges caller-supplied status ranks one-shot with stable ties', async () => {
    const { store } = await storeFor([
      tab('changed1'),
      tab('clean'),
      tab('conflict'),
      tab('changed2'),
    ])
    const ranks: Readonly<Record<string, number>> = {
      conflict: 0,
      changed1: 1,
      changed2: 1,
      clean: 3,
    }

    await store.arrangeTabsByRepositoryStatus(
      'needs-attention-first',
      item => ranks[item.id]
    )
    assert.deepEqual(ids(store), ['conflict', 'changed1', 'changed2', 'clean'])

    await store.arrangeTabsByRepositoryStatus(
      'clean-first',
      item => ranks[item.id]
    )
    assert.deepEqual(ids(store), ['clean', 'changed1', 'changed2', 'conflict'])
  })

  it('persists arrangements only in the assigned window scope', async () => {
    const { store, writes } = await storeFor([tab('b'), tab('a')], 'b')

    await store.arrangeTabsByLabel('ascending')

    assert.deepEqual(ids(store), ['a', 'b'])
    assert.equal(store.getState().activeTabId, 'b')
    assert.equal(writes.at(-1)?.scope, 'arrange-window')
  })

  it('replaces tabs from a portable session and skips missing paths safely', async () => {
    const alpha = new Repository('C:\\work\\alpha', 101, null, false)
    const beta = new Repository('C:\\work\\beta', 102, null, false)
    const { store } = await storeFor([tab('old')], 'old', () => 999)
    const session: ITabSessionFile = {
      format: TabSessionFormat,
      version: TabSessionVersion,
      exportedAt: new Date(0).toISOString(),
      activeRepositoryPath: beta.path,
      tabs: [
        {
          repositoryPath: alpha.path,
          customLabel: 'Alpha custom',
          titleStyle: { bold: true, futureStyle: 'kept' },
          isPinned: true,
          openedAt: 10,
        },
        {
          repositoryPath: beta.path,
          customLabel: null,
          titleStyle: null,
          isFavorite: true,
          futureTab: 'kept',
        },
        {
          repositoryPath: 'C:\\work\\missing',
          customLabel: null,
          titleStyle: null,
        },
      ],
    }

    const result = await store.importTabSession(
      session,
      [alpha, beta],
      'replace'
    )

    assert.equal(result.importedCount, 2)
    assert.equal(result.skippedCount, 1)
    assert.equal(result.activeRepository, beta)
    assert.equal(store.getState().tabs.length, 2)
    assert.equal(store.getState().tabs[0].customLabel, 'Alpha custom')
    assert.equal(store.getState().tabs[0].titleStyle?.futureStyle, 'kept')
    assert.equal(store.getState().tabs[1].isFavorite, true)
    assert.equal(store.getState().tabs[1].futureTab, 'kept')
    assert.equal(store.getActiveTab()?.repositoryId, beta.id)
    assert.notEqual(store.getState().tabs[0].id, 'old')
  })

  it('merges session metadata into existing ids and never wipes on zero matches', async () => {
    const alpha = new Repository('C:\\work\\alpha', 201, null, false)
    const existing = {
      ...tab('stable-id', { repositoryId: alpha.id }),
      repositoryPath: alpha.path,
      openedAt: 123,
    }
    const { store, writes } = await storeFor([existing], 'stable-id')
    const session: ITabSessionFile = {
      format: TabSessionFormat,
      version: TabSessionVersion,
      exportedAt: new Date(0).toISOString(),
      activeRepositoryPath: alpha.path,
      tabs: [
        {
          repositoryPath: alpha.path,
          customLabel: 'Merged alias',
          titleStyle: null,
          isFavorite: true,
        },
      ],
    }

    await store.importTabSession(session, [alpha], 'merge')
    assert.equal(store.getState().tabs[0].id, 'stable-id')
    assert.equal(store.getState().tabs[0].openedAt, 123)
    assert.equal(store.getState().tabs[0].customLabel, 'Merged alias')
    assert.equal(store.getState().tabs[0].isFavorite, true)

    const beforeWrites = writes.length
    const missingOnly: ITabSessionFile = {
      ...session,
      activeRepositoryPath: 'C:\\work\\missing',
      tabs: [
        {
          repositoryPath: 'C:\\work\\missing',
          customLabel: null,
          titleStyle: null,
        },
      ],
    }
    const result = await store.importTabSession(missingOnly, [], 'replace')
    assert.equal(result.importedCount, 0)
    assert.equal(writes.length, beforeWrites)
    assert.equal(store.getState().tabs[0].id, 'stable-id')
  })
})
