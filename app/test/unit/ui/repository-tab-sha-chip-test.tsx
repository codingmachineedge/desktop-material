import assert from 'node:assert'
import { beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { ProfileStore } from '../../../src/lib/stores/profile-store'
import { RepositoryStateCache } from '../../../src/lib/stores/repository-state-cache'
import { RepositoryTabsStore } from '../../../src/lib/stores/repository-tabs-store'
import {
  IProfileTabsState,
  IRepositoryTab,
} from '../../../src/models/repository-tab'
import { IProfileHistoryPage } from '../../../src/models/profile'
import { Popup, PopupType } from '../../../src/models/popup'
import { Repository } from '../../../src/models/repository'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { RepositoryTabStrip } from '../../../src/ui/repository-tabs/repository-tab-strip'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const repository = new Repository('/work/material', 1, null, false)

function makeTab(id: string): IRepositoryTab {
  return {
    id,
    repositoryId: repository.id,
    repositoryPath: repository.path,
    customLabel: null,
    titleStyle: null,
  }
}

/** Build a single-head history page mirroring the settings profile HEAD. */
function pageFor(options: {
  readonly sha?: string
  readonly shortSha?: string
  readonly canUndo?: boolean
  readonly canRedo?: boolean
}): IProfileHistoryPage {
  const head =
    options.sha === undefined
      ? []
      : [
          {
            sha: options.sha,
            shortSha: options.shortSha ?? options.sha.slice(0, 7),
            summary: 'Change setting',
            body: '',
            committedAt: new Date(0),
            undoOf: null,
            redoOf: null,
            restoreOf: null,
          },
        ]
  return {
    entries: head,
    total: head.length,
    hasMore: false,
    canUndo: options.canUndo ?? false,
    canRedo: options.canRedo ?? false,
  }
}

interface IHarness {
  readonly store: RepositoryTabsStore
  readonly setHistory: (page: IProfileHistoryPage) => void
  readonly dispatcher: Dispatcher
  readonly popups: ReadonlyArray<Popup>
  readonly container: HTMLElement
}

async function mountStrip(initial: IProfileHistoryPage): Promise<IHarness> {
  let currentPage = initial
  const initialTabs: IProfileTabsState = {
    tabs: [makeTab('material')],
    activeTabId: 'material',
  }
  const profileStore = {
    readTabs: () => Promise.resolve(initialTabs),
    writeTabs: () => Promise.resolve(),
    getSettingsHistory: () => Promise.resolve(currentPage),
  } as unknown as ProfileStore
  const store = new RepositoryTabsStore(profileStore, 'primary')
  await store.initialize()

  const popups: Popup[] = []
  const dispatcher = {
    selectRepository: () => undefined,
    showFoldout: () => undefined,
    setNotificationCentreOpen: () => undefined,
    showPopup: (popup: Popup) => {
      popups.push(popup)
      return Promise.resolve()
    },
    undoLastSettingsChange: () => Promise.resolve(),
    redoLastSettingsChange: () => Promise.resolve(),
  } as unknown as Dispatcher
  const stateManager = {
    get: () => {
      throw new Error('status cache should not be read by the commit chip')
    },
  } as unknown as RepositoryStateCache

  const { container } = render(
    <RepositoryTabStrip
      tabsStore={store}
      repositories={[repository]}
      dispatcher={dispatcher}
      repositoryStateManager={stateManager}
      unreadNotificationCount={0}
      isNotificationCentreOpen={false}
    />
  )

  return {
    store,
    setHistory: page => (currentPage = page),
    dispatcher,
    popups,
    container,
  }
}

async function makeStore(initial: IProfileHistoryPage): Promise<{
  readonly store: RepositoryTabsStore
  readonly setHistory: (page: IProfileHistoryPage) => void
  readonly reads: () => number
}> {
  let currentPage = initial
  let readCount = 0
  const initialTabs: IProfileTabsState = {
    tabs: [makeTab('material')],
    activeTabId: 'material',
  }
  const profileStore = {
    readTabs: () => Promise.resolve(initialTabs),
    writeTabs: () => Promise.resolve(),
    getSettingsHistory: () => {
      readCount++
      return Promise.resolve(currentPage)
    },
  } as unknown as ProfileStore
  const store = new RepositoryTabsStore(profileStore, 'primary')
  await store.initialize()
  return {
    store,
    setHistory: page => (currentPage = page),
    reads: () => readCount,
  }
}

function chip(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    '.repository-tab-commit-chip'
  )
  assert.ok(element, 'the commit chip should be rendered')
  return element
}

describe('RepositoryTabStrip settings commit chip', () => {
  beforeEach(() => {
    localStorage.removeItem('language-mode-v1')
    document.body.removeAttribute('data-dm-motion')
  })

  it('renders the saved short sha and starts with nothing to undo or redo', async () => {
    const harness = await mountStrip(
      pageFor({ sha: 'abcdef1234', shortSha: 'abcdef1' })
    )

    await waitFor(() => assert.ok(screen.getByText('Saved · abcdef1')))
    assert.equal(
      chip(harness.container).classList.contains('is-pulsing'),
      false
    )
    assert.equal(
      screen
        .getByRole('button', { name: 'Undo last settings change' })
        .hasAttribute('disabled'),
      true
    )
    assert.equal(
      screen
        .getByRole('button', { name: 'Redo settings change' })
        .hasAttribute('disabled'),
      true
    )
  })

  it('pulses and lights undo when a new commit lands', async () => {
    const harness = await mountStrip(
      pageFor({ sha: 'abcdef1234', shortSha: 'abcdef1' })
    )
    await waitFor(() => assert.ok(screen.getByText('Saved · abcdef1')))

    harness.setHistory(
      pageFor({ sha: '9876543210', shortSha: '9876543', canUndo: true })
    )
    await harness.store.refreshSettingsCommitSummary()

    await waitFor(() => assert.ok(screen.getByText('Committed 9876543')))
    assert.equal(chip(harness.container).classList.contains('is-pulsing'), true)
    assert.equal(
      screen
        .getByRole('button', { name: 'Undo last settings change' })
        .hasAttribute('disabled'),
      false
    )
    assert.equal(
      screen
        .getByRole('button', { name: 'Redo settings change' })
        .hasAttribute('disabled'),
      true
    )
  })

  it('clears the pulse when the bounce animation ends', async () => {
    const harness = await mountStrip(pageFor({ sha: 'abcdef1234' }))
    await waitFor(() => assert.ok(screen.getByText('Saved · abcdef1')))

    harness.setHistory(pageFor({ sha: '9876543210', shortSha: '9876543' }))
    await harness.store.refreshSettingsCommitSummary()
    await waitFor(() =>
      assert.equal(
        chip(harness.container).classList.contains('is-pulsing'),
        true
      )
    )

    fireEvent.animationEnd(chip(harness.container))
    await waitFor(() =>
      assert.equal(
        chip(harness.container).classList.contains('is-pulsing'),
        false
      )
    )
    assert.ok(screen.getByText('Saved · 9876543'))
  })

  it('opens the settings history manager from the trailing cluster', async () => {
    const harness = await mountStrip(pageFor({ sha: 'abcdef1234' }))
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Settings history' }))
    )

    fireEvent.click(screen.getByRole('button', { name: 'Settings history' }))

    assert.equal(harness.popups.length, 1)
    assert.equal(harness.popups[0].type, PopupType.SettingsHistory)
  })

  it('suppresses the commit pulse under reduced motion', async () => {
    const harness = await mountStrip(
      pageFor({ sha: 'abcdef1234', shortSha: 'abcdef1' })
    )
    await waitFor(() => assert.ok(screen.getByText('Saved · abcdef1')))

    document.body.setAttribute('data-dm-motion', 'reduced')
    try {
      harness.setHistory(pageFor({ sha: '9876543210', shortSha: '9876543' }))
      await harness.store.refreshSettingsCommitSummary()

      // With no pulse the chip stays in its resting "Saved" form.
      await waitFor(() => assert.ok(screen.getByText('Saved · 9876543')))
      assert.equal(
        chip(harness.container).classList.contains('is-pulsing'),
        false
      )
    } finally {
      document.body.removeAttribute('data-dm-motion')
    }
  })
})

describe('RepositoryTabsStore settings commit summary', () => {
  it('reads the HEAD summary and notifies subscribers on change', async () => {
    const { store, setHistory } = await makeStore(
      pageFor({ sha: 'abcdef1234', shortSha: 'abcdef1' })
    )
    const summaries: Array<string | null> = []
    store.onDidUpdateSettingsCommit(summary => summaries.push(summary.shortSha))

    await store.refreshSettingsCommitSummary()
    assert.deepEqual(store.getSettingsCommitSummary(), {
      sha: 'abcdef1234',
      shortSha: 'abcdef1',
      canUndo: false,
      canRedo: false,
    })

    setHistory(
      pageFor({ sha: '9876543210', shortSha: '9876543', canRedo: true })
    )
    await store.refreshSettingsCommitSummary()
    assert.equal(store.getSettingsCommitSummary().canRedo, true)
    assert.deepEqual(summaries, ['abcdef1', '9876543'])
  })

  it('does not re-notify when the HEAD summary is unchanged', async () => {
    const { store } = await makeStore(pageFor({ sha: 'abcdef1234' }))
    let notifications = 0
    store.onDidUpdateSettingsCommit(() => notifications++)

    await store.refreshSettingsCommitSummary()
    await store.refreshSettingsCommitSummary()

    assert.equal(notifications, 1)
  })

  it('is a no-op against a profile store without history support', async () => {
    const profileStore = {
      readTabs: () => Promise.resolve(null),
      writeTabs: () => Promise.resolve(),
    } as unknown as ProfileStore
    const store = new RepositoryTabsStore(profileStore, 'primary')
    await store.initialize()
    let notifications = 0
    store.onDidUpdateSettingsCommit(() => notifications++)

    await store.refreshSettingsCommitSummary()

    assert.equal(notifications, 0)
    assert.deepEqual(store.getSettingsCommitSummary(), {
      sha: null,
      shortSha: null,
      canUndo: false,
      canRedo: false,
    })
  })
})
