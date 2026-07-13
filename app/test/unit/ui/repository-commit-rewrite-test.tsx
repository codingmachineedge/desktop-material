import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as React from 'react'

import {
  IStructuredCommitRewriteInspection,
  IStructuredCommitRewritePlanItem,
  RebaseResult,
  StructuredCommitRewriteError,
} from '../../../src/lib/git'
import { Repository } from '../../../src/models/repository'
import {
  IRepositoryCommitRewriteClient,
  RepositoryCommitRewrite,
} from '../../../src/ui/repository-tools'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const base = '0'.repeat(40)
const first = '1'.repeat(40)
const second = '2'.repeat(40)
const third = '3'.repeat(40)

const inspection: IStructuredCommitRewriteInspection = {
  branchName: 'feature/review',
  upstreamName: 'origin/main',
  baseSha: base,
  headSha: third,
  commits: [
    { sha: first, summary: 'First visible title' },
    { sha: second, summary: 'Second visible title' },
    { sha: third, summary: 'Third visible title' },
  ],
}

class FakeCommitRewriteClient implements IRepositoryCommitRewriteClient {
  public inspections = 0
  public readonly executions: Array<
    ReadonlyArray<IStructuredCommitRewritePlanItem>
  > = []
  public continues = 0
  public aborts = 0
  public inspectResult: Promise<IStructuredCommitRewriteInspection> =
    Promise.resolve(inspection)
  public executeResult = RebaseResult.CompletedWithoutError
  public continueResult = RebaseResult.CompletedWithoutError

  public inspect = async () => {
    this.inspections++
    return this.inspectResult
  }

  public execute = async (
    _repository: Repository,
    _inspection: IStructuredCommitRewriteInspection,
    plan: ReadonlyArray<IStructuredCommitRewritePlanItem>
  ) => {
    this.executions.push(plan)
    return this.executeResult
  }

  public continue = async () => {
    this.continues++
    return this.continueResult
  }

  public abort = async () => {
    this.aborts++
  }
}

function renderRewrite(
  client: IRepositoryCommitRewriteClient,
  repository = new Repository('C:/fixture/repository', -1, null, false),
  onRefreshRepository = async () => {},
  onBusyChanged = (_busy: boolean) => {}
) {
  return render(
    <RepositoryCommitRewrite
      repository={repository}
      disabled={false}
      client={client}
      onRefreshRepository={onRefreshRepository}
      onBusyChanged={onBusyChanged}
    />
  )
}

describe('RepositoryCommitRewrite', () => {
  it('requires a final confirmation for an ordered keep/fold/drop plan', async () => {
    const client = new FakeCommitRewriteClient()
    const busy: boolean[] = []
    let refreshes = 0
    renderRewrite(
      client,
      undefined,
      async () => {
        refreshes++
      },
      value => busy.push(value)
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Review local commits' })
    )
    await screen.findByText('First visible title')
    assert.equal(client.inspections, 1)
    assert.equal(screen.queryByText(/author@example\.invalid/), null)
    assert.equal(screen.queryByText(/private body contents/i), null)

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Move Second visible title (2222222) earlier',
      })
    )
    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'Action for First visible title (1111111)',
      }),
      { target: { value: 'fixup' } }
    )
    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'Action for Third visible title (3333333)',
      }),
      { target: { value: 'drop' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review final plan' }))

    assert.notEqual(screen.getByRole('alertdialog'), null)
    assert.equal(client.executions.length, 0)
    assert.match(
      screen.getByText(/previously published branch will need a force push/i)
        .textContent ?? '',
      /revalidates this exact branch/
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm and rewrite commits' })
    )
    await waitFor(() => assert.equal(client.executions.length, 1))
    assert.deepStrictEqual(client.executions[0], [
      { sha: second, action: 'pick' },
      { sha: first, action: 'fixup' },
      { sha: third, action: 'drop' },
    ])
    assert.equal(refreshes, 1)
    assert.equal(busy[0], true)
    assert.equal(busy[busy.length - 1], false)
    assert.notEqual(
      screen.getByRole('status').textContent?.match(/rewrite completed/i),
      null
    )
  })

  it('keeps an invalid all-drop plan in review with an accessible error', async () => {
    const client = new FakeCommitRewriteClient()
    renderRewrite(client)
    fireEvent.click(
      screen.getByRole('button', { name: 'Review local commits' })
    )
    await screen.findByText('First visible title')

    for (const label of [
      'Action for First visible title (1111111)',
      'Action for Second visible title (2222222)',
      'Action for Third visible title (3333333)',
    ]) {
      fireEvent.change(screen.getByRole('combobox', { name: label }), {
        target: { value: 'drop' },
      })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Review final plan' }))

    assert.match(
      screen.getByRole('alert').textContent ?? '',
      /Keep at least one local commit/
    )
    assert.equal(screen.queryByRole('alertdialog'), null)
    assert.equal(client.executions.length, 0)
  })

  it('offers continue and abort recovery without exposing command input', async () => {
    const client = new FakeCommitRewriteClient()
    client.executeResult = RebaseResult.ConflictsEncountered
    renderRewrite(client)
    fireEvent.click(
      screen.getByRole('button', { name: 'Review local commits' })
    )
    await screen.findByText('First visible title')
    fireEvent.change(
      screen.getByRole('combobox', {
        name: 'Action for Third visible title (3333333)',
      }),
      { target: { value: 'drop' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Review final plan' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm and rewrite commits' })
    )

    const recovery = await screen.findByRole('region', {
      name: 'Commit rewrite conflict recovery',
    })
    assert.match(
      recovery.textContent ?? '',
      /Resolve every conflicted tracked file/
    )
    assert.equal(screen.queryByRole('textbox'), null)
    assert.equal(screen.queryByText(/git rebase/i), null)

    fireEvent.click(screen.getByRole('button', { name: 'Continue rewrite' }))
    await waitFor(() => assert.equal(client.continues, 1))
    assert.match(screen.getByRole('status').textContent ?? '', /completed/i)
  })

  it('recovers a rebase discovered during inspection and can abort it', async () => {
    const client = new FakeCommitRewriteClient()
    client.inspectResult = Promise.reject(
      new StructuredCommitRewriteError(
        'rebase-in-progress',
        'A rebase is already in progress.'
      )
    )
    renderRewrite(client)
    fireEvent.click(
      screen.getByRole('button', { name: 'Review local commits' })
    )

    await screen.findByRole('region', {
      name: 'Commit rewrite conflict recovery',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Abort and restore' }))
    await waitFor(() => assert.equal(client.aborts, 1))
    assert.match(screen.getByRole('status').textContent ?? '', /restored/i)
  })

  it('ignores a stale inspection after the selected repository changes', async () => {
    let resolveInspection:
      | ((value: IStructuredCommitRewriteInspection) => void)
      | undefined
    const client = new FakeCommitRewriteClient()
    client.inspectResult = new Promise(resolve => {
      resolveInspection = resolve
    })
    const firstRepository = new Repository('C:/fixture/one', -1, null, false)
    const secondRepository = new Repository('C:/fixture/two', -2, null, false)
    const rendered = renderRewrite(client, firstRepository)
    fireEvent.click(
      screen.getByRole('button', { name: 'Review local commits' })
    )

    rendered.rerender(
      <RepositoryCommitRewrite
        repository={secondRepository}
        disabled={false}
        client={client}
        onRefreshRepository={async () => {}}
        onBusyChanged={() => {}}
      />
    )
    resolveInspection?.(inspection)
    await waitFor(() =>
      assert.notEqual(
        screen.getByRole('button', { name: 'Review local commits' }),
        null
      )
    )
    assert.equal(screen.queryByText('First visible title'), null)
  })

  it('cancels a pending review and ignores its delayed result', async () => {
    let resolveInspection:
      | ((value: IStructuredCommitRewriteInspection) => void)
      | undefined
    const client = new FakeCommitRewriteClient()
    client.inspectResult = new Promise(resolve => {
      resolveInspection = resolve
    })
    const busy: boolean[] = []
    renderRewrite(client, undefined, undefined, value => busy.push(value))
    fireEvent.click(
      screen.getByRole('button', { name: 'Review local commits' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel review' }))
    resolveInspection?.(inspection)

    await waitFor(() =>
      assert.notEqual(
        screen.getByRole('button', { name: 'Review local commits' }),
        null
      )
    )
    assert.equal(screen.queryByText('First visible title'), null)
    assert.deepStrictEqual(busy, [true, false])
  })
})
