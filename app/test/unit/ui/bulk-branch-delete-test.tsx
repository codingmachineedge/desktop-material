import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { Branch, BranchType } from '../../../src/models/branch'
import { Repository } from '../../../src/models/repository'
import { IReviewedBranchDeletion } from '../../../src/lib/git'
import { BulkBranchDelete } from '../../../src/ui/branches/bulk-branch-delete'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'
import { LanguageModeChangedEvent } from '../../../src/lib/i18n'

function branch(name: string, sha: string, type = BranchType.Local): Branch {
  const ref =
    type === BranchType.Local ? `refs/heads/${name}` : `refs/remotes/${name}`
  return new Branch(name, null, { sha }, type, ref)
}

describe('bulk branch delete', () => {
  it('protects current/default/remote branches and sends exact reviewed tips', async () => {
    const repository = new Repository('C:\\repo', 1, null, false)
    const main = branch('main', 'a'.repeat(40))
    const one = branch('feature/one', 'b'.repeat(40))
    const two = branch('feature/two', 'c'.repeat(40))
    const remote = branch(
      'origin/remote-only',
      'd'.repeat(40),
      BranchType.Remote
    )
    const requests: ReadonlyArray<IReviewedBranchDeletion>[] = []
    render(
      <BulkBranchDelete
        repository={repository}
        allBranches={[main, one, two, remote]}
        currentBranch={main}
        defaultBranch={main}
        dispatcher={{
          deleteReviewedBranches: async (_repository, reviewed) => {
            requests.push(reviewed)
            return reviewed.map(item => ({
              name: item.name,
              status: 'deleted' as const,
              detail: `Deleted at ${item.expectedSha.slice(0, 12)}.`,
            }))
          },
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete branches…' }))
    assert(screen.queryByRole('checkbox', { name: /main/ }) === null)
    assert(screen.queryByRole('checkbox', { name: /remote-only/ }) === null)
    fireEvent.click(screen.getByRole('checkbox', { name: /feature\/one/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Review deletion (1)' }))
    assert(screen.getByText(/Permanently delete 1 exact local branch/))
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete reviewed branches' })
    )

    await waitFor(() => assert.equal(requests.length, 1))
    assert.deepEqual(requests[0], [
      { name: 'feature/one', expectedSha: 'b'.repeat(40) },
    ])
    assert(screen.getByRole('list', { name: 'Deletion results' }))
    assert(screen.getByText(/Deleted at b{12}/))
  })

  it('surfaces stale-review failure without claiming deletion', async () => {
    const repository = new Repository('C:\\repo', 1, null, false)
    const main = branch('main', 'a'.repeat(40))
    const candidate = branch('feature/stale', 'b'.repeat(40))
    render(
      <BulkBranchDelete
        repository={repository}
        allBranches={[main, candidate]}
        currentBranch={main}
        defaultBranch={main}
        dispatcher={{
          deleteReviewedBranches: async () => {
            throw new Error('The reviewed branch list changed.')
          },
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete branches…' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /feature\/stale/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Review deletion (1)' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete reviewed branches' })
    )
    assert(await screen.findByRole('alert'))
    assert(screen.queryByRole('list', { name: 'Deletion results' }) === null)
  })

  it('switches English, Cantonese, and bilingual copy live', async () => {
    localStorage.setItem(
      'appearance-customization-v1',
      JSON.stringify({ version: 1, languageMode: 'english' })
    )
    const repository = new Repository('C:\\repo', 1, null, false)
    const main = branch('main', 'a'.repeat(40))
    const candidate = branch('feature/localized', 'b'.repeat(40))
    const view = render(
      <BulkBranchDelete
        repository={repository}
        allBranches={[main, candidate]}
        currentBranch={main}
        defaultBranch={main}
        dispatcher={{ deleteReviewedBranches: async () => [] }}
      />
    )

    try {
      assert.ok(screen.getByRole('button', { name: 'Delete branches…' }))
      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'cantonese' })
      )
      await waitFor(() =>
        assert.ok(screen.getByRole('button', { name: '刪除分支…' }))
      )
      assert.ok(screen.getByLabelText('批次刪除分支'))

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'bilingual' })
      )
      await waitFor(() =>
        assert.match(
          view.container.textContent ?? '',
          /Delete branches… · 刪除分支…/
        )
      )
    } finally {
      view.unmount()
      localStorage.removeItem('appearance-customization-v1')
    }
  })
})
