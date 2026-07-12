import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import {
  classifyVersionHistoryDiffLine,
  IVersionHistoryEntry,
  IVersionHistoryPage,
  IVersionedStoreHistorySource,
  VersionedStoreHistory,
} from '../../../src/ui/version-history'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolveValue: ((value: T) => void) | null = null
  const promise = new Promise<T>(resolve => {
    resolveValue = resolve
  })

  if (resolveValue === null) {
    throw new Error('Deferred promise resolver was not initialized')
  }

  return { promise, resolve: resolveValue }
}

function historyEntry(sha: string, summary: string): IVersionHistoryEntry {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    summary,
    body: '',
    committedAt: new Date('2026-07-11T12:00:00Z'),
    undoOf: null,
    redoOf: null,
    restoreOf: null,
  }
}

function historyPage(
  entries: ReadonlyArray<IVersionHistoryEntry>,
  hasMore: boolean,
  canUndo = true
): IVersionHistoryPage {
  return {
    entries,
    total: entries.length,
    hasMore,
    canUndo,
    canRedo: false,
  }
}

describe('versioned store history', () => {
  it('classifies unified diff lines for the read-only viewer', () => {
    assert.equal(classifyVersionHistoryDiffLine('diff --git a/a b/a'), 'header')
    assert.equal(
      classifyVersionHistoryDiffLine('--- a/settings.json'),
      'header'
    )
    assert.equal(
      classifyVersionHistoryDiffLine('+++ b/settings.json'),
      'header'
    )
    assert.equal(classifyVersionHistoryDiffLine('@@ -1 +1 @@'), 'hunk')
    assert.equal(classifyVersionHistoryDiffLine('-"theme": "dark"'), 'deletion')
    assert.equal(
      classifyVersionHistoryDiffLine('+"theme": "light"'),
      'addition'
    )
    assert.equal(classifyVersionHistoryDiffLine(' unchanged'), 'context')
  })

  it('ignores an old pagination response after undo reloads history', async () => {
    Object.assign(globalThis, {
      localStorage: {
        length: 0,
        clear: () => {},
        getItem: () => null,
        key: () => null,
        removeItem: () => {},
        setItem: () => {},
      } as Storage,
    })

    const initialEntry = historyEntry('11111111', 'Initial snapshot')
    const staleEntry = historyEntry('22222222', 'Stale older snapshot')
    const undoEntry = historyEntry('33333333', 'Undo snapshot')
    const stalePagination = createDeferred<IVersionHistoryPage>()
    let historyCalls = 0

    const source: IVersionedStoreHistorySource = {
      getHistory: () => {
        historyCalls++
        if (historyCalls === 1) {
          return Promise.resolve(historyPage([initialEntry], true))
        }
        if (historyCalls === 2) {
          return stalePagination.promise
        }
        return Promise.resolve(historyPage([undoEntry], false, false))
      },
      getFiles: () => Promise.resolve([]),
      getDiff: () => Promise.resolve(''),
      undoLastChange: () => Promise.resolve(),
      redoLastChange: () => Promise.resolve(),
      restoreTo: () => Promise.resolve(),
    }

    render(
      <VersionedStoreHistory
        title="Settings history"
        timelineLabel="Settings timeline"
        description="Test history"
        source={source}
        onDismissed={() => {}}
      />
    )

    await waitFor(() =>
      assert.equal(screen.getAllByText('Initial snapshot').length, 2)
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => assert.equal(historyCalls, 2))

    fireEvent.click(screen.getByRole('button', { name: 'Undo last' }))
    await waitFor(() => {
      assert.equal(historyCalls, 3)
      assert.equal(screen.getAllByText('Undo snapshot').length, 2)
    })

    stalePagination.resolve(historyPage([staleEntry], false))
    await stalePagination.promise
    await Promise.resolve()

    assert.equal(screen.queryAllByText('Initial snapshot').length, 0)
    assert.equal(screen.queryAllByText('Stale older snapshot').length, 0)
    assert.equal(screen.getAllByText('Undo snapshot').length, 2)
  })

  it('loads file metadata only for the selected entry', async () => {
    Object.assign(globalThis, {
      localStorage: {
        length: 0,
        clear: () => {},
        getItem: () => null,
        key: () => null,
        removeItem: () => {},
        setItem: () => {},
      } as Storage,
    })

    const first = historyEntry('11111111', 'First snapshot')
    const second = historyEntry('22222222', 'Second snapshot')
    const third = historyEntry('33333333', 'Third snapshot')
    const requestedFiles: string[] = []
    const source: IVersionedStoreHistorySource = {
      getHistory: () =>
        Promise.resolve(historyPage([first, second, third], false)),
      getFiles: sha => {
        requestedFiles.push(sha)
        return Promise.resolve(['settings.json'])
      },
      getDiff: () => Promise.resolve(''),
      undoLastChange: () => Promise.resolve(),
      redoLastChange: () => Promise.resolve(),
      restoreTo: () => Promise.resolve(),
    }

    render(
      <VersionedStoreHistory
        title="Settings history"
        timelineLabel="Settings timeline"
        description="Test history"
        source={source}
        onDismissed={() => {}}
      />
    )

    await waitFor(() => assert.deepEqual(requestedFiles, [first.sha]))
    assert.equal(screen.getAllByText('Select to inspect').length, 2)

    fireEvent.click(screen.getByRole('option', { name: /Second snapshot/i }))
    await waitFor(() =>
      assert.deepEqual(requestedFiles, [first.sha, second.sha])
    )
  })

  it('filters the shared timeline with substring and regex modes', async () => {
    const entries = [
      historyEntry('11111111', 'Changed theme'),
      historyEntry('22222222', 'Marked notification read'),
      historyEntry('33333333', 'Restored settings'),
    ]
    const source: IVersionedStoreHistorySource = {
      getHistory: () => Promise.resolve(historyPage(entries, false)),
      getFiles: () => Promise.resolve([]),
      getDiff: () => Promise.resolve(''),
      undoLastChange: () => Promise.resolve(),
      redoLastChange: () => Promise.resolve(),
      restoreTo: () => Promise.resolve(),
    }

    render(
      <VersionedStoreHistory
        title="Settings history"
        timelineLabel="Settings timeline"
        description="Test history"
        source={source}
        onDismissed={() => {}}
      />
    )

    await waitFor(() =>
      assert.ok(screen.getByRole('option', { name: /Changed theme/i }))
    )
    fireEvent.change(screen.getByLabelText('Search version history'), {
      target: { value: 'notification' },
    })
    await waitFor(() => {
      assert.equal(
        screen.queryByRole('option', { name: /Changed theme/i }),
        null
      )
      assert.ok(
        screen.getByRole('option', { name: /Marked notification read/i })
      )
    })

    fireEvent.click(screen.getByLabelText(/Filter mode: Fuzzy/))
    fireEvent.click(screen.getByLabelText(/Filter mode: Substring/))
    fireEvent.change(screen.getByLabelText('Search version history'), {
      target: { value: '^Restored' },
    })
    await waitFor(() =>
      assert.ok(screen.getByRole('option', { name: /Restored settings/i }))
    )
  })
})
