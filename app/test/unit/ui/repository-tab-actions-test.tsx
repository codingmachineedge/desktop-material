import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { ProfileStore } from '../../../src/lib/stores/profile-store'
import { ElementAppearanceCoordinator } from '../../../src/lib/stores/element-appearance-coordinator'
import { RepositoryStateCache } from '../../../src/lib/stores/repository-state-cache'
import { RepositoryTabsStore } from '../../../src/lib/stores/repository-tabs-store'
import { CloningRepository } from '../../../src/models/cloning-repository'
import {
  IProfileTabsState,
  IRepositoryTab,
} from '../../../src/models/repository-tab'
import { Repository } from '../../../src/models/repository'
import { TipState } from '../../../src/models/tip'
import { IVersionedStoreHistorySource } from '../../../src/ui/version-history'
import { ArrangeTabsPopover } from '../../../src/ui/repository-tabs/arrange-tabs-popover'
import {
  CloseTabsContainingPopover,
  CloseTabsExceptContainingPopover,
} from '../../../src/ui/repository-tabs/close-tabs-containing-popover'
import { RepositoryTabStrip } from '../../../src/ui/repository-tabs/repository-tab-strip'
import { TabSearchPopover } from '../../../src/ui/repository-tabs/tab-search-popover'
import {
  repositoryTabMatchKeys,
  repositoryTabStatusRank,
  visibleTabLabel,
} from '../../../src/ui/repository-tabs/tab-action-helpers'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { getAppearanceRepositoryDisplayPath } from '../../../src/ui/appearance/anchored-appearance-editor'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'

function makeTab(
  id: string,
  repository: Repository,
  options: {
    readonly customLabel?: string | null
    readonly isPinned?: boolean
    readonly isFavorite?: boolean
    readonly openedAt?: number
  } = {}
): IRepositoryTab {
  return {
    id,
    repositoryId: repository.id,
    repositoryPath: repository.path,
    customLabel: options.customLabel ?? null,
    titleStyle: null,
    ...(options.isPinned === undefined ? {} : { isPinned: options.isPinned }),
    ...(options.isFavorite === undefined
      ? {}
      : { isFavorite: options.isFavorite }),
    ...(options.openedAt === undefined ? {} : { openedAt: options.openedAt }),
  }
}

async function createStore(
  tabs: ReadonlyArray<IRepositoryTab>,
  activeTabId: string | null = tabs[0]?.id ?? null,
  elementAppearanceCoordinator?: ElementAppearanceCoordinator
): Promise<RepositoryTabsStore> {
  const initial: IProfileTabsState = { tabs, activeTabId }
  const profileStore = {
    readTabs: () => Promise.resolve(initial),
    writeTabs: () => Promise.resolve(),
  } as unknown as ProfileStore
  const store = new RepositoryTabsStore(
    profileStore,
    'primary',
    Date.now,
    elementAppearanceCoordinator
  )
  await store.initialize()
  return store
}

interface IArrangeHarnessProps {
  readonly store: RepositoryTabsStore
  readonly repositories: ReadonlyArray<Repository>
  readonly ranks: Readonly<Record<string, number>>
  readonly onClose?: () => void
}

function ArrangeHarness(props: IArrangeHarnessProps) {
  const [tabs, setTabs] = React.useState(props.store.getState())
  React.useEffect(() => {
    const disposable = props.store.onDidUpdate(setTabs)
    return () => disposable.dispose()
  }, [props.store])
  const repository = (tab: IRepositoryTab) =>
    props.repositories.find(candidate => candidate.id === tab.repositoryId) ??
    null
  return (
    <ArrangeTabsPopover
      tabs={tabs}
      tabsStore={props.store}
      anchor={null}
      resolveLabel={tab => visibleTabLabel(tab, repository(tab))}
      resolveMatchKeys={tab => repositoryTabMatchKeys(tab, repository(tab))}
      resolveStatusRank={tab => props.ranks[tab.id] ?? 3}
      onClose={props.onClose ?? (() => undefined)}
    />
  )
}

describe('CloseTabsContainingPopover compatibility', () => {
  it('keeps the existing regex action and protects matching pinned tabs', async () => {
    localStorage.removeItem('filter-mode/close-tabs-containing')
    const pinnedRepository = new Repository('/work/pinned', 1, null, false)
    const closableRepository = new Repository('/work/closable', 2, null, false)
    const untouchedRepository = new Repository(
      '/work/untouched',
      3,
      null,
      false
    )
    const store = await createStore([
      makeTab('pinned', pinnedRepository, {
        customLabel: 'Pinned Match',
        isPinned: true,
      }),
      makeTab('closable', closableRepository, {
        customLabel: 'Closable Match',
      }),
      makeTab('untouched', untouchedRepository),
    ])
    let closedActiveId: string | null | undefined

    render(
      <CloseTabsContainingPopover
        tabsStore={store}
        anchor={null}
        onClosed={activeId => (closedActiveId = activeId)}
        onClose={() => undefined}
      />
    )

    // Cycle the shared filter-mode control from its fuzzy default to regex.
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Filter mode: Fuzzy (click to change)',
      })
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Filter mode: Substring (click to change)',
      })
    )
    const input = screen.getByRole('textbox', {
      name: 'Close tabs containing',
    })
    fireEvent.change(input, {
      target: { value: 'Match$' },
    })

    assert.match(
      screen.getByRole('status').textContent ?? '',
      /1 close, 1 pinned protected/
    )
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      assert.deepEqual(
        store.getState().tabs.map(tab => tab.id),
        ['pinned', 'untouched']
      )
    )
    assert.equal(closedActiveId, 'pinned')
  })
})

describe('CloseTabsExceptContainingPopover', () => {
  it('previews literal alias matches, pinned protection, and safe counts', async () => {
    const material = new Repository(
      '/work/desktop-material',
      1,
      null,
      false,
      'Material Alias'
    )
    const api = new Repository('/work/api', 2, null, false)
    const protectedRepository = new Repository(
      '/work/protected',
      3,
      null,
      false
    )
    const repositories = [material, api, protectedRepository]
    const store = await createStore(
      [
        makeTab('material', material, { customLabel: 'Main workspace' }),
        makeTab('api', api),
        makeTab('protected', protectedRepository, { isPinned: true }),
      ],
      'api'
    )
    let closedActiveId: string | null | undefined
    let dismissals = 0
    const repository = (tab: IRepositoryTab) =>
      repositories.find(candidate => candidate.id === tab.repositoryId) ?? null

    render(
      <CloseTabsExceptContainingPopover
        tabsStore={store}
        anchor={null}
        resolveAdditionalKeys={tab =>
          repositoryTabMatchKeys(tab, repository(tab))
        }
        resolveLabel={tab => visibleTabLabel(tab, repository(tab))}
        onClosed={activeId => (closedActiveId = activeId)}
        onClose={() => dismissals++}
      />
    )

    const confirm = screen.getByRole('button', { name: 'Close tabs' })
    assert.equal(confirm.hasAttribute('disabled'), true)

    fireEvent.change(screen.getByLabelText('Text to keep'), {
      target: { value: 'MATERIAL ALIAS' },
    })

    assert.match(
      screen.getByRole('status').textContent ?? '',
      /2 kept, 1 closed, 1 pinned protected/
    )
    const preview = screen.getByRole('region', { name: 'Tab close preview' })
    assert.ok(within(preview).getByText('Protected pinned'))
    assert.ok(within(preview).getByText('Main workspace'))

    assert.ok(screen.getByRole('button', { name: 'Close 1' }))
    fireEvent.keyDown(screen.getByLabelText('Text to keep'), { key: 'Enter' })
    await waitFor(() =>
      assert.deepEqual(
        store.getState().tabs.map(tab => tab.id),
        ['protected', 'material']
      )
    )
    assert.equal(closedActiveId, 'material')
    assert.equal(dismissals, 1)
  })

  it('blocks blank/zero-match Enter and supports Escape dismissal', async () => {
    const alpha = new Repository('/work/alpha', 1, null, false)
    const beta = new Repository('/work/beta', 2, null, false)
    const store = await createStore([makeTab('a', alpha), makeTab('b', beta)])
    let dismissals = 0
    render(
      <CloseTabsExceptContainingPopover
        tabsStore={store}
        anchor={null}
        resolveAdditionalKeys={() => []}
        resolveLabel={tab => tab.repositoryPath}
        onClosed={() => undefined}
        onClose={() => dismissals++}
      />
    )

    const input = screen.getByLabelText('Text to keep')
    fireEvent.change(input, { target: { value: 'not-present' } })
    const confirm = screen.getByRole('button', { name: 'Close tabs' })
    assert.equal(confirm.hasAttribute('disabled'), true)
    fireEvent.keyDown(input, { key: 'Enter' })
    assert.equal(store.getState().tabs.length, 2)

    fireEvent.keyDown(input, { key: 'Escape' })
    assert.equal(dismissals, 1)
  })
})

describe('ArrangeTabsPopover', () => {
  it('stars and one-shot arranges favorite tabs accessibly', async () => {
    const alpha = new Repository('/work/alpha', 1, null, false)
    const beta = new Repository('/work/beta', 2, null, false)
    const store = await createStore([
      makeTab('alpha', alpha),
      makeTab('beta', beta, { isFavorite: true }),
    ])
    render(
      <ArrangeHarness store={store} repositories={[alpha, beta]} ranks={{}} />
    )

    assert.ok(screen.getByText('Favorite'))
    fireEvent.click(screen.getByRole('button', { name: 'Favorite alpha' }))
    await waitFor(() =>
      assert.equal(
        store.getState().tabs.find(tab => tab.id === 'alpha')?.isFavorite,
        true
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'Favorites last' }))
    await waitFor(() =>
      assert.match(screen.getByRole('status').textContent ?? '', /moved last/)
    )
  })

  it('pins and moves tabs with labelled group-constrained controls', async () => {
    const zed = new Repository('/work/zed', 1, null, false)
    const beta = new Repository('/work/beta', 2, null, false)
    const alpha = new Repository('/work/alpha', 3, null, false)
    const store = await createStore([
      makeTab('zed', zed, { isPinned: true }),
      makeTab('beta', beta),
      makeTab('alpha', alpha),
    ])

    render(
      <ArrangeHarness
        store={store}
        repositories={[zed, beta, alpha]}
        ranks={{}}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pin alpha' }))
    await waitFor(() =>
      assert.deepEqual(
        store.getState().tabs.map(tab => tab.id),
        ['zed', 'alpha', 'beta']
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Move alpha to first' }))
    await waitFor(() =>
      assert.deepEqual(
        store.getState().tabs.map(tab => tab.id),
        ['alpha', 'zed', 'beta']
      )
    )
    assert.match(screen.getByRole('status').textContent ?? '', /moved to first/)
    assert.equal(store.getState().activeTabId, 'zed')
  })

  it('applies stable one-shot label, opened, and status arrangements', async () => {
    const beta = new Repository('/work/beta', 1, null, false)
    const alpha = new Repository('/work/alpha', 2, null, false)
    const clean = new Repository('/work/clean', 3, null, false)
    const store = await createStore([
      makeTab('beta', beta, { openedAt: 200 }),
      makeTab('alpha', alpha, { openedAt: 100 }),
      makeTab('clean', clean, { openedAt: 300 }),
    ])
    render(
      <ArrangeHarness
        store={store}
        repositories={[beta, alpha, clean]}
        ranks={{ beta: 1, alpha: 0, clean: 3 }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Label A → Z' }))
    await waitFor(() =>
      assert.deepEqual(
        store.getState().tabs.map(tab => tab.id),
        ['alpha', 'beta', 'clean']
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Newest opened' }))
    await waitFor(() =>
      assert.deepEqual(
        store.getState().tabs.map(tab => tab.id),
        ['clean', 'beta', 'alpha']
      )
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Needs attention first' })
    )
    await waitFor(() =>
      assert.deepEqual(
        store.getState().tabs.map(tab => tab.id),
        ['alpha', 'beta', 'clean']
      )
    )
    assert.equal(store.getState().activeTabId, 'beta')
  })

  it('filters via the shared filter modes without changing sort scope', async () => {
    localStorage.removeItem('filter-mode/arrange-tabs')
    const zed = new Repository(
      '/clients/material/zed',
      1,
      null,
      false,
      'Studio'
    )
    const alpha = new Repository('/work/alpha', 2, null, false)
    const beta = new Repository('/work/beta', 3, null, false)
    const store = await createStore([
      makeTab('zed', zed, { customLabel: 'Material workspace' }),
      makeTab('beta', beta),
      makeTab('alpha', alpha),
    ])
    render(
      <ArrangeHarness
        store={store}
        repositories={[zed, alpha, beta]}
        ranks={{}}
      />
    )

    const filter = screen.getByRole('searchbox', { name: 'Filter tabs' })
    fireEvent.change(filter, { target: { value: 'material workspace' } })
    assert.ok(screen.getByText('1 of 3 tabs'))
    assert.ok(screen.getByText('Material workspace'))
    assert.equal(screen.queryByText('alpha'), null)

    // Substring mode consults every literal key, e.g. the repository path.
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Filter mode: Fuzzy (click to change)',
      })
    )
    fireEvent.change(filter, { target: { value: 'clients/material' } })
    assert.ok(screen.getByText('1 of 3 tabs'))
    assert.ok(screen.getByText('Material workspace'))

    fireEvent.click(screen.getByRole('button', { name: 'Label A → Z' }))
    await waitFor(() =>
      assert.deepEqual(
        store.getState().tabs.map(tab => tab.id),
        ['alpha', 'beta', 'zed']
      )
    )

    fireEvent.change(filter, { target: { value: 'not present' } })
    assert.ok(screen.getByText('0 of 3 tabs'))
    assert.ok(screen.getByText('No tabs match this filter.'))
  })

  it('uses full pin-group indices when the filtered row is at a boundary', async () => {
    const pinned = new Repository('/work/pinned', 1, null, false)
    const first = new Repository('/work/first', 2, null, false)
    const last = new Repository('/work/last', 3, null, false)
    const store = await createStore([
      makeTab('pinned', pinned, { isPinned: true }),
      makeTab('first', first),
      makeTab('last', last),
    ])
    render(
      <ArrangeHarness
        store={store}
        repositories={[pinned, first, last]}
        ranks={{}}
      />
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter tabs' }), {
      target: { value: 'first' },
    })
    assert.equal(
      screen
        .getByRole('button', { name: 'Move first left' })
        .hasAttribute('disabled'),
      true
    )
    assert.equal(
      screen
        .getByRole('button', { name: 'Move first right' })
        .hasAttribute('disabled'),
      false
    )
  })
})

describe('TabSearchPopover', () => {
  const alpha = new Repository('/work/alpha', 1, null, false)
  const material = new Repository(
    '/clients/material',
    2,
    null,
    false,
    'Studio Alias'
  )
  const omega = new Repository('/work/omega', 3, null, false)
  const repositories = [alpha, material, omega]
  const tabs = [
    makeTab('alpha', alpha),
    makeTab('material', material, {
      customLabel: 'Material workspace',
      isPinned: true,
      isFavorite: true,
    }),
    makeTab('omega', omega),
  ]
  const repository = (tab: IRepositoryTab) =>
    repositories.find(candidate => candidate.id === tab.repositoryId) ?? null

  it('matches keys under the shared filter modes and switches with Home, End, Enter, and Escape', async () => {
    localStorage.removeItem('filter-mode/tab-search')
    let selected: string | null = null
    let closes = 0
    render(
      <TabSearchPopover
        tabs={tabs}
        activeTabId="material"
        anchor={null}
        resolveLabel={tab => visibleTabLabel(tab, repository(tab))}
        resolveMatchKeys={tab => repositoryTabMatchKeys(tab, repository(tab))}
        onSelect={tab => (selected = tab.id)}
        onClose={() => closes++}
      />
    )

    const input = screen.getByRole('combobox', { name: 'Search open tabs' })
    await waitFor(() => assert.equal(document.activeElement, input))
    assert.ok(
      screen.getByRole('option', {
        name: 'Material workspace, active, pinned, favorite',
      })
    )

    fireEvent.change(input, { target: { value: 'workspace' } })
    assert.equal(screen.getAllByRole('option').length, 1)
    assert.ok(screen.getByText('1 matching tab'))

    // Substring mode consults every literal key, e.g. the repository alias.
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Filter mode: Fuzzy (click to change)',
      })
    )
    fireEvent.change(input, { target: { value: 'studio alias' } })
    assert.equal(screen.getAllByRole('option').length, 1)
    assert.ok(screen.getByText('1 matching tab'))

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'End' })
    assert.equal(
      input.getAttribute('aria-activedescendant'),
      'tab-search-result-2'
    )
    fireEvent.keyDown(input, { key: 'Home' })
    assert.equal(
      input.getAttribute('aria-activedescendant'),
      'tab-search-result-0'
    )
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    assert.equal(selected, 'material')
    assert.equal(closes, 1)

    fireEvent.keyDown(input, { key: 'Escape' })
    assert.equal(closes, 2)
  })

  it('clamps keyboard highlighting when matching tabs are removed', () => {
    const { rerender } = render(
      <TabSearchPopover
        tabs={tabs}
        activeTabId="alpha"
        anchor={null}
        resolveLabel={tab => visibleTabLabel(tab, repository(tab))}
        resolveMatchKeys={tab => repositoryTabMatchKeys(tab, repository(tab))}
        onSelect={() => undefined}
        onClose={() => undefined}
      />
    )
    const input = screen.getByRole('combobox', { name: 'Search open tabs' })
    fireEvent.keyDown(input, { key: 'End' })
    rerender(
      <TabSearchPopover
        tabs={[tabs[0]]}
        activeTabId="alpha"
        anchor={null}
        resolveLabel={tab => visibleTabLabel(tab, repository(tab))}
        resolveMatchKeys={tab => repositoryTabMatchKeys(tab, repository(tab))}
        onSelect={() => undefined}
        onClose={() => undefined}
      />
    )
    assert.equal(
      input.getAttribute('aria-activedescendant'),
      'tab-search-result-0'
    )
  })
})

describe('RepositoryTab title appearance', () => {
  it('opens the title-owned anchored editor and its independent Git history', async () => {
    const alpha = new Repository('/work/alpha', 1, null, false)
    let style: IRepositoryTab['titleStyle'] = null
    const historySource: IVersionedStoreHistorySource = {
      getHistory: async () => ({
        entries: [],
        total: 0,
        hasMore: false,
        canUndo: false,
        canRedo: false,
      }),
      getFiles: async () => [],
      getDiff: async () => '',
      undoLastChange: async () => undefined,
      redoLastChange: async () => undefined,
      restoreTo: async () => undefined,
    }
    const coordinator = {
      flush: async () => undefined,
      ensureTabTitleElement: async (
        _tabId: string,
        seed: IRepositoryTab['titleStyle']
      ) => ({ style: style ?? seed }),
      setTabTitleElement: async (
        _tabId: string,
        next: IRepositoryTab['titleStyle']
      ) => {
        style = next
      },
      getTabTitleHistorySource: () => historySource,
      getTabTitleRepositoryPath: () =>
        'C:\\appearance-elements\\alpha-tab\\title-style',
    } as unknown as ElementAppearanceCoordinator
    const store = await createStore(
      [makeTab('alpha-tab', alpha)],
      'alpha-tab',
      coordinator
    )
    const dispatcher = {
      selectRepository: () => undefined,
      showFoldout: () => undefined,
      setNotificationCentreOpen: () => undefined,
    } as unknown as Dispatcher
    const stateManager = {
      get: () => {
        throw new Error('status cache should not be read by the style editor')
      },
    } as unknown as RepositoryStateCache

    render(
      <RepositoryTabStrip
        tabsStore={store}
        repositories={[alpha]}
        dispatcher={dispatcher}
        repositoryStateManager={stateManager}
        unreadNotificationCount={0}
        isNotificationCentreOpen={false}
      />
    )

    const label = screen.getByText('alpha')
    assert.equal(label.classList.contains('repository-tab-label'), true)
    fireEvent.contextMenu(label)

    assert.ok(screen.getByText('Tab appearance'))
    assert.ok(
      screen.getByText(
        getAppearanceRepositoryDisplayPath(
          'C:\\appearance-elements\\alpha-tab\\title-style'
        )
      )
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Open tab appearance history' })
    )

    await waitFor(() =>
      assert.ok(screen.getByRole('dialog', { name: 'alpha tab title history' }))
    )
    assert.ok(screen.getByText('Element-local Git history'))
    assert.ok(screen.getByRole('button', { name: 'Undo' }))
    assert.ok(screen.getByRole('button', { name: 'Redo' }))

    fireEvent.click(
      screen.getByRole('button', { name: 'Close alpha tab title history' })
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Close alpha tab title' })
    )
    await waitFor(() => assert.equal(document.activeElement, label))

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'alpha' }))
    assert.equal(
      screen.queryByText('Tab appearance'),
      null,
      'the surrounding frame keeps its tab-command context menu'
    )
  })
})

describe('RepositoryTabStrip drag arrangement', () => {
  it('reorders by drag within a pin group and rejects crossing the boundary', async () => {
    const pinned = new Repository('/work/pinned', 1, null, false)
    const alpha = new Repository('/work/alpha', 2, null, false)
    const beta = new Repository('/work/beta', 3, null, false)
    const store = await createStore([
      makeTab('pinned', pinned, { isPinned: true }),
      makeTab('alpha', alpha),
      makeTab('beta', beta),
    ])
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'none',
      setData: () => undefined,
      getData: () => '',
    } as unknown as DataTransfer
    const dispatcher = {
      selectRepository: () => undefined,
      showFoldout: () => undefined,
      setNotificationCentreOpen: () => undefined,
    } as unknown as Dispatcher
    const stateManager = {
      get: () => {
        throw new Error('status cache should not be read during drag')
      },
    } as unknown as RepositoryStateCache

    render(
      <RepositoryTabStrip
        tabsStore={store}
        repositories={[pinned, alpha, beta]}
        dispatcher={dispatcher}
        repositoryStateManager={stateManager}
        unreadNotificationCount={0}
        isNotificationCentreOpen={false}
      />
    )

    fireEvent.dragStart(screen.getByRole('tab', { name: 'beta' }), {
      dataTransfer,
    })
    fireEvent.drop(screen.getByRole('tab', { name: 'alpha' }), {
      dataTransfer,
      clientX: 0,
    })
    await waitFor(() =>
      assert.deepEqual(
        store.getState().tabs.map(tab => tab.id),
        ['pinned', 'beta', 'alpha']
      )
    )

    fireEvent.dragStart(screen.getByRole('tab', { name: 'alpha' }), {
      dataTransfer,
    })
    fireEvent.drop(screen.getByRole('tab', { name: 'pinned, pinned' }), {
      dataTransfer,
      clientX: 0,
    })
    assert.deepEqual(
      store.getState().tabs.map(tab => tab.id),
      ['pinned', 'beta', 'alpha']
    )
    assert.match(
      screen.getAllByRole('status').at(-1)?.textContent ?? '',
      /separate groups/
    )

    const arrangeButton = screen.getByRole('button', { name: 'Arrange tabs' })
    fireEvent.click(arrangeButton)
    assert.ok(screen.getByRole('dialog', { name: 'Arrange tabs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => assert.equal(document.activeElement, arrangeButton))
  })

  it('switches a searched tab through the existing selection path and scrolls it into view', async () => {
    const alpha = new Repository('/work/alpha', 1, null, false)
    const beta = new Repository('/work/beta', 2, null, false, 'Beta Alias')
    const store = await createStore([
      makeTab('alpha', alpha),
      makeTab('beta', beta),
    ])
    let selectedRepositoryId: number | null = null
    const dispatcher = {
      selectRepository: (repository: Repository) =>
        (selectedRepositoryId = repository.id),
      showFoldout: () => undefined,
      setNotificationCentreOpen: () => undefined,
    } as unknown as Dispatcher
    const stateManager = {
      get: () => {
        throw new Error('status cache should not be read during search')
      },
    } as unknown as RepositoryStateCache

    render(
      <RepositoryTabStrip
        tabsStore={store}
        repositories={[alpha, beta]}
        dispatcher={dispatcher}
        repositoryStateManager={stateManager}
        unreadNotificationCount={0}
        isNotificationCentreOpen={false}
      />
    )

    const betaTab = screen.getByRole('tab', { name: 'beta' })
    let scrolled = false
    Object.defineProperty(betaTab, 'scrollIntoView', {
      configurable: true,
      value: () => (scrolled = true),
    })
    const searchButton = screen.getByRole('button', { name: 'Search tabs' })
    fireEvent.click(searchButton)
    const input = screen.getByRole('combobox', { name: 'Search open tabs' })
    fireEvent.change(input, { target: { value: 'beta alias' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => assert.equal(store.getState().activeTabId, 'beta'))
    assert.equal(selectedRepositoryId, beta.id)
    await waitFor(() => assert.equal(scrolled, true))
    await waitFor(() => assert.equal(document.activeElement, searchButton))
  })
})

describe('repositoryTabStatusRank', () => {
  const repository = new Repository('/work/ranked', 1, null, false)
  const rankFor = (overrides: object) =>
    repositoryTabStatusRank(repository, {
      get: () => ({
        branchesState: { tip: { kind: TipState.Valid } },
        changesState: {
          conflictState: null,
          workingDirectory: { files: [] },
        },
        aheadBehind: null,
        ...overrides,
      }),
    } as unknown as RepositoryStateCache)

  it('ranks unavailable, conflicts, changes, sync delta, then clean', () => {
    assert.equal(
      repositoryTabStatusRank(
        new CloningRepository('/tmp/clone', 'https://example/repo.git'),
        {} as unknown as RepositoryStateCache
      ),
      0
    )
    assert.equal(
      repositoryTabStatusRank(
        new Repository('/work/missing', 2, null, true),
        {} as unknown as RepositoryStateCache
      ),
      0
    )
    assert.equal(
      rankFor({ branchesState: { tip: { kind: TipState.Unknown } } }),
      0
    )
    assert.equal(
      rankFor({
        changesState: {
          conflictState: {},
          workingDirectory: { files: [] },
        },
      }),
      0
    )
    assert.equal(
      rankFor({
        changesState: {
          conflictState: null,
          workingDirectory: { files: [{}] },
        },
      }),
      1
    )
    assert.equal(rankFor({ aheadBehind: { ahead: 1, behind: 1 } }), 2)
    assert.equal(rankFor({}), 3)
  })
})
