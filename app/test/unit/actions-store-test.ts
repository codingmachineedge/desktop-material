import { describe, it } from 'node:test'
import assert from 'node:assert'
import { IAPIWorkflowRun } from '../../src/lib/api'
import { workflowRunsEqual } from '../../src/lib/stores/actions-store'

const run = (id: number, updatedAt: string) =>
  ({ id, updated_at: updatedAt } as IAPIWorkflowRun)

describe('ActionsStore helpers', () => {
  it('treats run pages with the same ids and update times as equal', () => {
    assert.equal(workflowRunsEqual([run(1, 'a')], [run(1, 'a')]), true)
  })

  it('detects updated and reordered workflow runs', () => {
    assert.equal(workflowRunsEqual([run(1, 'a')], [run(1, 'b')]), false)
    assert.equal(
      workflowRunsEqual([run(1, 'a'), run(2, 'b')], [run(2, 'b'), run(1, 'a')]),
      false
    )
  })
})
