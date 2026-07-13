import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { Account, getAccountKey } from '../../../src/models/account'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import {
  IProviderTriageAPI,
  ProviderTriageStore,
} from '../../../src/lib/stores/provider-triage-store'
import { IAPIProviderTriagePage } from '../../../src/lib/provider-triage'
import { RepositoryProviderTriage } from '../../../src/ui/repository-tools'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const account = new Account(
  'selected',
  'https://api.github.com',
  'fixture-token',
  [],
  '',
  1,
  'Selected'
)
const remote = new GitHubRepository(
  'material',
  new Owner('desktop', account.endpoint, 2),
  1
)
const repository = new Repository(
  'C:\\fixture\\material',
  1,
  remote,
  false,
  null,
  {},
  false,
  undefined,
  getAccountKey(account)
)

const issues: IAPIProviderTriagePage = {
  supported: true,
  capped: true,
  items: [
    {
      number: 10,
      title: '<img src=x onerror=alert(1)> Issue title',
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-02T00:00:00Z',
      authorLogin: 'other',
      assigneeLogins: ['selected'],
      reviewRequestedLogins: [],
      draft: false,
    },
  ],
}
const pullRequests: IAPIProviderTriagePage = {
  supported: true,
  capped: false,
  items: [
    {
      number: 11,
      title: 'Review exact account routing',
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-12T00:00:00Z',
      authorLogin: 'selected',
      assigneeLogins: [],
      reviewRequestedLogins: ['selected'],
      draft: true,
    },
  ],
}

function store(api: IProviderTriageAPI) {
  return new ProviderTriageStore({
    apiFor: () => api,
    htmlURLForEndpoint: () => 'https://github.com',
    now: () => new Date('2026-07-13T00:00:00Z'),
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(value => {
    resolve = value
  })
  return { promise, resolve }
}

describe('provider triage UI', () => {
  it('renders bounded capability state, safe links, and accessible filters', async () => {
    const triageStore = store({
      fetchProviderTriageIssues: async () => issues,
      fetchProviderTriagePullRequests: async () => pullRequests,
    })
    render(
      <RepositoryProviderTriage
        repository={repository}
        accounts={[account]}
        store={triageStore}
      />
    )

    await waitFor(() => assert.ok(screen.getByText('2 of 2 work items')))
    assert.ok(screen.getByRole('heading', { name: 'Provider triage' }))
    assert.ok(screen.getByRole('search'))
    assert.ok(screen.getByRole('list', { name: 'Provider capability status' }))
    assert.ok(screen.getByText('Ready · newest page shown'))
    assert.equal(screen.getAllByText('Review requested').length, 2)
    assert.ok(screen.getByText('Draft'))
    assert.equal(screen.queryByRole('img'), null)

    const issueLink = screen.getByRole('link', {
      name: 'Open issue 10 on GitHub',
    })
    assert.equal(
      issueLink.getAttribute('href'),
      'https://github.com/desktop/material/issues/10'
    )
    const pullRequestLink = screen.getByRole('link', {
      name: 'Open pull request 11 on GitHub',
    })
    assert.equal(
      pullRequestLink.getAttribute('href'),
      'https://github.com/desktop/material/pull/11'
    )

    fireEvent.change(screen.getByLabelText('Attention'), {
      target: { value: 'review-requested' },
    })
    assert.ok(screen.getByText('1 of 2 work items'))
    assert.equal(screen.queryByText(/Issue title/), null)

    fireEvent.change(screen.getByLabelText('Search work items'), {
      target: { value: 'no match' },
    })
    assert.ok(screen.getByText('No work items match these filters.'))
  })

  it('shows unsupported and partial provider channels without raw errors', async () => {
    const triageStore = store({
      fetchProviderTriageIssues: async () => ({
        supported: false,
        capped: false,
        items: [],
      }),
      fetchProviderTriagePullRequests: async () => {
        throw new Error('token=raw-secret C:\\private\\path')
      },
    })
    render(
      <RepositoryProviderTriage
        repository={repository}
        accounts={[account]}
        store={triageStore}
      />
    )
    await waitFor(() =>
      assert.ok(screen.getByText(/Some triage data could not be loaded/))
    )
    assert.ok(screen.getByText('Not supported by this provider'))
    assert.ok(screen.getByText('Unavailable'))
    assert.doesNotMatch(document.body.textContent ?? '', /raw-secret|private/)
  })

  it('cancels an in-flight refresh and invalidates a removed account', async () => {
    const pending = new Promise<IAPIProviderTriagePage>(() => {})
    const triageStore = store({
      fetchProviderTriageIssues: async () => pending,
      fetchProviderTriagePullRequests: async () => pending,
    })
    const view = render(
      <RepositoryProviderTriage
        repository={repository}
        accounts={[account]}
        store={triageStore}
      />
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Cancel' }))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.ok(screen.getByText('Triage refresh canceled.'))

    view.rerender(
      <RepositoryProviderTriage
        repository={repository}
        accounts={[]}
        store={triageStore}
      />
    )
    await waitFor(() => assert.ok(screen.getByText(/no longer signed in/)))
    assert.ok(
      screen.getByText(
        'Connect this repository to an exact signed-in account to load triage.'
      )
    )
  })

  it('reloads through a rotated same-key account and drops the old response', async () => {
    const oldPage = deferred<IAPIProviderTriagePage>()
    const oldSignals = new Array<AbortSignal>()
    const rotated = account.withToken('rotated-token')
    const triageStore = new ProviderTriageStore({
      apiFor: selectedAccount =>
        selectedAccount.token === account.token
          ? {
              fetchProviderTriageIssues: async (owner, name, limit, signal) => {
                oldSignals.push(signal!)
                return oldPage.promise
              },
              fetchProviderTriagePullRequests: async (
                owner,
                name,
                limit,
                signal
              ) => {
                oldSignals.push(signal!)
                return oldPage.promise
              },
            }
          : {
              fetchProviderTriageIssues: async () => ({
                supported: true,
                capped: false,
                items: [{ ...issues.items[0], number: 99 }],
              }),
              fetchProviderTriagePullRequests: async () => ({
                supported: true,
                capped: false,
                items: [],
              }),
            },
      htmlURLForEndpoint: () => 'https://github.com',
      now: () => new Date('2026-07-13T00:00:00Z'),
    })
    const view = render(
      <RepositoryProviderTriage
        repository={repository}
        accounts={[account]}
        store={triageStore}
      />
    )
    await waitFor(() => assert.equal(oldSignals.length, 2))
    view.rerender(
      <RepositoryProviderTriage
        repository={repository}
        accounts={[rotated]}
        store={triageStore}
      />
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('link', { name: 'Open issue 99 on GitHub' }))
    )
    assert.equal(
      oldSignals.every(signal => signal.aborted),
      true
    )
    oldPage.resolve(issues)
    assert.equal(
      screen.queryByRole('link', { name: 'Open issue 10 on GitHub' }),
      null
    )
  })
})
