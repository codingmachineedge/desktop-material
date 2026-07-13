import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as React from 'react'
import {
  IWorktreeMaintenancePreview,
  WorktreeMaintenanceOperation,
} from '../../../src/models/worktree'
import { WorktreeAdministration } from '../../../src/ui/worktrees/worktree-administration'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

describe('Worktree administration', () => {
  it('reviews and revalidates prune before changing metadata', async () => {
    const previews = new Array<WorktreeMaintenanceOperation>()
    const runs = new Array<WorktreeMaintenanceOperation>()
    render(
      <WorktreeAdministration
        repositoryPath="C:/repo"
        onPreview={async operation => {
          previews.push(operation)
          return { operation, affectedCount: 2 }
        }}
        onRun={async operation => {
          runs.push(operation)
          return { operation, affectedCount: 1 }
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Preview prune' }))
    const review = await screen.findByRole('alertdialog')
    assert.match(review.textContent ?? '', /Prune 2 missing worktree records/)
    assert.doesNotMatch(review.textContent ?? '', /C:\\|C:\//)
    fireEvent.click(screen.getByRole('button', { name: 'Prune records' }))

    await screen.findByText('1 missing worktree record pruned.')
    assert.deepEqual(previews, ['prune'])
    assert.deepEqual(runs, ['prune'])
  })

  it('keeps a zero-result repair path-free and non-mutating', async () => {
    let runs = 0
    render(
      <WorktreeAdministration
        repositoryPath="C:/repo"
        onPreview={async operation => ({ operation, affectedCount: 0 })}
        onRun={async operation => {
          runs++
          return { operation, affectedCount: 0 }
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Review repair' }))
    await screen.findByText('No registered worktree links need repair.')
    assert.equal(screen.queryByRole('alertdialog'), null)
    assert.equal(runs, 0)
  })

  it('drops an old preview after the repository changes', async () => {
    let resolvePreview: (
      preview: IWorktreeMaintenancePreview
    ) => void = () => {}
    const delayed = new Promise<IWorktreeMaintenancePreview>(resolve => {
      resolvePreview = resolve
    })
    const view = render(
      <WorktreeAdministration
        repositoryPath="C:/old"
        onPreview={async () => delayed}
        onRun={async operation => ({ operation, affectedCount: 1 })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Preview prune' }))

    view.rerender(
      <WorktreeAdministration
        repositoryPath="C:/new"
        onPreview={async operation => ({ operation, affectedCount: 1 })}
        onRun={async operation => ({ operation, affectedCount: 1 })}
      />
    )
    resolvePreview({ operation: 'prune', affectedCount: 4 })

    await waitFor(() => {
      assert.equal(screen.queryByRole('alertdialog'), null)
      assert.ok(
        screen.getByText(
          'Review prune or repair before changing worktree metadata.'
        )
      )
    })
  })
})
