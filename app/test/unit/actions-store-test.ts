import { describe, it } from 'node:test'
import assert from 'node:assert'
import { IAPIWorkflowRun } from '../../src/lib/api'
import {
  accountSupportsActions,
  actionsMutationError,
  workflowRunsEqual,
} from '../../src/lib/stores/actions-store'
import { Account } from '../../src/models/account'
import { Owner } from '../../src/models/owner'
import { GitHubRepository } from '../../src/models/github-repository'
import { APIError } from '../../src/lib/http'

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

  it('explains permission and Enterprise capability failures', () => {
    const denied = actionsMutationError(
      new APIError(
        new Response(null, { status: 403 }),
        { message: 'Forbidden' }
      ),
      'disable-workflow'
    )
    assert.match(denied.message, /Actions write access/)

    const unavailable = actionsMutationError(
      new APIError(
        new Response(null, { status: 404 }),
        { message: 'Not Found' }
      ),
      'enable-workflow'
    )
    assert.match(unavailable.message, /GitHub Enterprise version/)
  })

  it('preserves non-API operation errors', () => {
    const original = new Error('network unavailable')
    assert.equal(actionsMutationError(original, 'cancel-run'), original)
  })
})
