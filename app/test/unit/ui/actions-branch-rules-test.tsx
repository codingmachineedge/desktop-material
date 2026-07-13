import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { IActionsBranchRuleList } from '../../../src/lib/actions-branch-rules'
import {
  ActionsBranchRulesError,
  ActionsStore,
} from '../../../src/lib/stores/actions-store'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import { BranchRules } from '../../../src/ui/actions/branch-rules'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function repository(accountKey: string, id: number = 1): Repository {
  return new Repository(
    'C:/project',
    id,
    new GitHubRepository(
      'project',
      new Owner('example', 'https://api.github.com', 1),
      1
    ),
    false,
    null,
    {},
    false,
    undefined,
    accountKey
  )
}

const result = (
  branch: string,
  label: string = 'Require signed commits'
): IActionsBranchRuleList => ({
  branch,
  capped: false,
  rules: [
    {
      rulesetId: 42,
      type: 'required_signatures',
      label,
      description: 'Active for this branch.',
      sourceType: 'Organization',
      source: 'example',
    },
  ],
})

function store(
  fetchBranchRules: ActionsStore['fetchBranchRules']
): ActionsStore {
  return { fetchBranchRules } as ActionsStore
}

describe('effective branch rules inspector', () => {
  it('loads purpose-built rule summaries for a long current branch', async () => {
    const branch =
      'feature/a-very-long-branch-name-that-must-wrap-without-horizontal-scrolling'
    render(
      <BranchRules
        repository={repository('account-a')}
        currentBranch={branch}
        actionsStore={store(async () => result(branch))}
      />
    )

    assert.ok(screen.getByRole('heading', { name: 'Effective branch rules' }))
    fireEvent.click(screen.getByRole('button', { name: 'Inspect rules' }))
    assert.ok(await screen.findByText('Require signed commits'))
    assert.ok(screen.getByText('Ruleset #42 · Organization · example'))
    assert.ok(
      screen.getByRole('list', { name: `Effective rules for ${branch}` })
    )
    assert.ok(screen.getByText(/1 active rule applies/))
  })

  it('aborts and ignores stale account and branch responses', async () => {
    const first = deferred<IActionsBranchRuleList>()
    const second = deferred<IActionsBranchRuleList>()
    const signals = new Array<AbortSignal | undefined>()
    const actionsStore = store(async (selected, branch, signal) => {
      signals.push(signal)
      return selected.accountKey === 'account-a'
        ? first.promise
        : second.promise
    })
    const view = render(
      <BranchRules
        repository={repository('account-a')}
        currentBranch="main"
        actionsStore={actionsStore}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Inspect rules' }))
    await waitFor(() => assert.equal(signals.length, 1))

    view.rerender(
      <BranchRules
        repository={repository('account-b', 2)}
        currentBranch="release/account-b"
        actionsStore={actionsStore}
      />
    )
    await waitFor(() => assert.equal(signals.length, 2))
    assert.equal(signals[0]?.aborted, true)

    first.resolve(result('main', 'Stale account rule'))
    second.resolve(result('release/account-b', 'Current account rule'))
    assert.ok(await screen.findByText('Current account rule'))
    assert.equal(screen.queryByText('Stale account rule'), null)
  })

  it('offers explicit cancellation without closing the inspector', async () => {
    let signal: AbortSignal | undefined
    render(
      <BranchRules
        repository={repository('account-a')}
        currentBranch="main"
        actionsStore={store(async (_repository, _branch, requestSignal) => {
          signal = requestSignal
          return await new Promise<IActionsBranchRuleList>((_resolve, reject) =>
            requestSignal?.addEventListener(
              'abort',
              () => {
                const error = new Error('canceled')
                error.name = 'AbortError'
                reject(error)
              },
              { once: true }
            )
          )
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Inspect rules' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Cancel inspection' })
    )
    assert.equal(signal?.aborted, true)
    assert.ok(await screen.findByText('Branch rule request canceled.'))
    assert.ok(screen.getByRole('button', { name: 'Hide rules' }))
  })

  it('distinguishes unsupported, permission, and provider failures', async () => {
    const cases = [
      new ActionsBranchRulesError(
        'unsupported',
        'Effective branch rules are not supported.'
      ),
      new ActionsBranchRulesError(
        'permission',
        'The selected account lacks permission.',
        403
      ),
      new ActionsBranchRulesError('service', 'GitHub returned an error.', 503),
    ]
    const labels = [
      'Unsupported provider',
      'Permission required',
      'Provider error',
    ]

    for (const [index, error] of cases.entries()) {
      const view = render(
        <BranchRules
          repository={repository(`account-${index}`, index + 1)}
          currentBranch="main"
          actionsStore={store(async () => {
            throw error
          })}
        />
      )
      fireEvent.click(screen.getByRole('button', { name: 'Inspect rules' }))
      assert.ok(await screen.findByText(labels[index]))
      assert.ok(screen.getByRole('alert'))
      assert.ok(screen.getByRole('button', { name: 'Retry inspection' }))
      view.unmount()
    }
  })

  it('explains detached HEAD without making a provider request', () => {
    let requests = 0
    render(
      <BranchRules
        repository={repository('account-a')}
        currentBranch={null}
        actionsStore={store(async () => {
          requests++
          return result('main')
        })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Inspect rules' }))
    assert.ok(screen.getByText('Detached HEAD'))
    assert.ok(screen.getByText(/Check out a local branch/))
    assert.equal(requests, 0)
  })
})
