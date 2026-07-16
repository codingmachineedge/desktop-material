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
  MinTabFontSize,
  MaxTabFontSize,
  MinTabCharacterSpacing,
  MaxTabCharacterSpacing,
  DefaultTabCharacterSpacing,
  IRepositoryTab,
  IProfileTabsState,
  ITabTitleStyle,
} from '../../src/models/repository-tab'
import { Repository } from '../../src/models/repository'
import { ProfileStore } from '../../src/lib/stores/profile-store'
import { RepositoryTabsStore } from '../../src/lib/stores/repository-tabs-store'
import { FilterMode } from '../../src/lib/fuzzy-find'

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
})
