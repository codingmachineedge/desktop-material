import { describe, it } from 'node:test'
import assert from 'node:assert'
import { IAPIWorkflowRun } from '../../src/lib/api'
import {
  accountSupportsActions,
  workflowRunsEqual,
} from '../../src/lib/stores/actions-store'
import { Account } from '../../src/models/account'
import { Owner } from '../../src/models/owner'
import { GitHubRepository } from '../../src/models/github-repository'

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

  it('does not route provider repositories into GitHub Actions', () => {
    const endpoint = 'https://gitlab.example.com/api/v4'
    const repository = new GitHubRepository(
      'project',
      new Owner('group', endpoint, 1),
      1
    )
    const account = new Account(
      'fox',
      endpoint,
      'token',
      [],
      '',
      1,
      'Fox',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'gitlab'
    )

    assert.equal(accountSupportsActions(repository, [account]), false)
  })
})
