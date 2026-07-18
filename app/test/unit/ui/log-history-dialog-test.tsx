import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import {
  ILogHistoryDispatcher,
  LogHistoryDialog,
} from '../../../src/ui/log-history/log-history-dialog'
import { IProfileHistoryPage } from '../../../src/models/profile'
import { render, screen, waitFor } from '../../helpers/ui/render'

const page: IProfileHistoryPage = {
  entries: [
    {
      sha: '1'.repeat(40),
      shortSha: '1111111',
      summary: 'Capture log activity',
      body: '',
      committedAt: new Date('2026-07-17T12:00:00Z'),
      undoOf: null,
      redoOf: null,
      restoreOf: null,
    },
  ],
  total: 1,
  hasMore: false,
  canUndo: true,
  canRedo: false,
}

describe('LogHistoryDialog', () => {
  it('renders the log timeline through the shared history manager', async () => {
    const requestedFiles = new Array<string>()
    const dispatcher: ILogHistoryDispatcher = {
      getLogHistory: () => Promise.resolve(page),
      getLogHistoryFiles: sha => {
        requestedFiles.push(sha)
        return Promise.resolve(['app.log'])
      },
      getLogHistoryDiff: () => Promise.resolve(''),
      undoLastLogChange: () => Promise.resolve(),
      redoLastLogChange: () => Promise.resolve(),
      restoreLogsTo: () => Promise.resolve(),
    }

    render(<LogHistoryDialog dispatcher={dispatcher} onDismissed={() => {}} />)

    assert.ok(screen.getByRole('dialog', { name: /log history/i }))
    await waitFor(() =>
      assert.equal(screen.getAllByText('Capture log activity').length, 2)
    )
    assert.deepEqual(requestedFiles, [page.entries[0].sha])
    await waitFor(() => assert.ok(screen.getAllByText('app.log').length > 0))
  })
})
