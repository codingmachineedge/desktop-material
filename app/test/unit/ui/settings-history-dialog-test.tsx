import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import {
  ISettingsHistoryDispatcher,
  SettingsHistoryDialog,
} from '../../../src/ui/settings-history'
import { IProfileHistoryPage } from '../../../src/models/profile'
import { SettingsHistoryScope } from '../../../src/models/popup'
import { render, screen, waitFor } from '../../helpers/ui/render'

function historyPage(): IProfileHistoryPage {
  return {
    entries: [
      {
        sha: '1111111111111111111111111111111111111111',
        shortSha: '1111111',
        summary: 'Open alpha tab',
        body: '',
        committedAt: new Date('2026-07-11T12:00:00Z'),
        undoOf: null,
        redoOf: null,
        restoreOf: null,
      },
    ],
    total: 1,
    hasMore: false,
    canUndo: false,
    canRedo: false,
  }
}

interface IRecordingDispatcher extends ISettingsHistoryDispatcher {
  readonly historyScopes: Array<SettingsHistoryScope | undefined>
  readonly requestedFiles: Array<string>
}

function recordingDispatcher(
  page: IProfileHistoryPage = historyPage()
): IRecordingDispatcher {
  const historyScopes: Array<SettingsHistoryScope | undefined> = []
  const requestedFiles: Array<string> = []
  return {
    historyScopes,
    requestedFiles,
    getSettingsHistory: (_skip, _limit, scope) => {
      historyScopes.push(scope)
      return Promise.resolve(page)
    },
    // Both files change in the commit; the scoped view must only inspect tabs.
    getSettingsHistoryFiles: sha => {
      requestedFiles.push(sha)
      return Promise.resolve(['settings.json', 'tabs.json'])
    },
    getSettingsHistoryDiff: () => Promise.resolve(''),
    undoLastSettingsChange: () => Promise.resolve(),
    redoLastSettingsChange: () => Promise.resolve(),
    restoreSettingsTo: () => Promise.resolve(),
  }
}

describe('settings history dialog', () => {
  it('builds a read-only, tab-filtered source for a tab scope', async () => {
    const dispatcher = recordingDispatcher()
    const scope: SettingsHistoryScope = {
      kind: 'tab',
      tabId: 'alpha-tab-id',
      label: 'Alpha repo',
    }

    render(
      <SettingsHistoryDialog
        dispatcher={dispatcher}
        scope={scope}
        onDismissed={() => {}}
      />
    )

    await waitFor(() =>
      assert.ok(screen.getByRole('option', { name: /Open alpha tab/i }))
    )

    // The scope is forwarded so the history read is filtered to the tab.
    assert.deepEqual(dispatcher.historyScopes, [scope])
    assert.ok(screen.getByText('Appearance history — Alpha repo'))

    // Read-only: none of the profile-wide mutations are offered.
    assert.equal(screen.queryByRole('button', { name: 'Undo' }), null)
    assert.equal(screen.queryByRole('button', { name: 'Redo' }), null)
    assert.equal(
      screen.queryByRole('button', { name: /Restore Open alpha tab/i }),
      null
    )

    // Only the tab state file is surfaced (as a list chip and a detail tab),
    // never profile settings.
    await waitFor(() => assert.ok(screen.getAllByText('tabs.json').length > 0))
    assert.equal(screen.queryByText('settings.json'), null)
  })

  it('keeps the full-profile view mutable when no scope is given', async () => {
    const dispatcher = recordingDispatcher()

    render(
      <SettingsHistoryDialog dispatcher={dispatcher} onDismissed={() => {}} />
    )

    await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Undo' })))
    assert.ok(screen.getByText('Settings history'))
    assert.deepEqual(dispatcher.historyScopes, [undefined])
  })

  it('does not promise reorder-only commits in an empty scoped history', async () => {
    const dispatcher = recordingDispatcher({
      ...historyPage(),
      entries: [],
      total: 0,
    })

    render(
      <SettingsHistoryDialog
        dispatcher={dispatcher}
        scope={{ kind: 'tab', tabId: 'alpha-tab-id', label: 'Alpha repo' }}
        onDismissed={() => {}}
      />
    )

    const description = await screen.findByText(/saved properties/i)
    assert.doesNotMatch(description.textContent ?? '', /reorder/i)
  })
})
