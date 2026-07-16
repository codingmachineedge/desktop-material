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
import { RepositoriesStore } from '../../../src/lib/stores/repositories-store'
import { IAPIProviderTriagePage } from '../../../src/lib/provider-triage'
import { IAPIFullRepository } from '../../../src/lib/api'
import { RepositoryProviderTriage } from '../../../src/ui/repository-tools'
import { TestRepositoriesDatabase } from '../../helpers/databases'
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
const otherAccount = new Account(
  'other',
  'https://api.github.com',
  'other-fixture-token',
  [],
  '',
  2,
  'Other'
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

function repositoryWithAccount(accountKey: string | null): Repository {
  return new Repository(
    repository.path,
    repository.id,
    repository.gitHubRepository,
    repository.missing,
    repository.alias,
    repository.workflowPreferences,
    repository.isTutorialRepository,
    repository.gitDir,
    accountKey,
    repository.buildRunPreferences,
    repository.groupName,
    repository.defaultBranch,
    repository.customEditorOverride
  )
}

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

function nextRepositoryUpdate(
  store: RepositoriesStore,
  predicate: (repository: Repository) => boolean
): Promise<Repository> {
  return new Promise(resolve => {
    let dispose = () => {}
    const subscription = store.onDidUpdate(repositories => {
      const updated = repositories.find(predicate)
      if (updated !== undefined) {
        dispose()
        resolve(updated)
      }
    })
    dispose = () => subscription.dispose()
  })
}

describe('provider triage UI', () => {
  it('mounts and refreshes the exact repository-settings binding emitted by the real store', async () => {
    const database = new TestRepositoriesDatabase()
    await database.reset()
    try {
      const repositories = new RepositoriesStore(database)
      const settingsAccount = new Account(
        'selected',
        'https://API.GITHUB.com/',
        'settings-session',
        [],
        '',
        1,
        'Selected'
      )
      const refreshedAccount = new Account(
        'selected-renamed',
        'https://api.github.com',
        'refreshed-session',
        [],
        '',
        1,
        'Selected renamed'
      )
      const settingsAccountKey = getAccountKey(settingsAccount)
      const path = 'C:\\fixture\\settings-bound-material'
      const addedUpdate = nextRepositoryUpdate(
        repositories,
        candidate => candidate.path === path
      )
      const local = await repositories.addRepository(path, `${path}\\.git`)
      await addedUpdate

      const apiRepository: IAPIFullRepository = {
        clone_url: 'https://github.com/desktop/material.git',
        ssh_url: 'git@github.com:desktop/material.git',
        html_url: 'https://github.com/desktop/material',
        name: 'material',
        owner: {
          id: 2,
          html_url: 'https://github.com/desktop',
          login: 'desktop',
          avatar_url: '',
          type: 'Organization',
        },
        private: true,
        fork: false,
        default_branch: 'main',
        pushed_at: '2026-07-15T00:00:00Z',
        has_issues: true,
        archived: false,
        permissions: { pull: true, push: true, admin: false },
        parent: undefined,
      }
      const hostedUpdate = nextRepositoryUpdate(
        repositories,
        candidate => candidate.gitHubRepository?.name === 'material'
      )
      const hosted = await repositories.setGitHubRepository(
        local,
        await repositories.upsertGitHubRepository(
          settingsAccount.endpoint,
          apiRepository
        )
      )
      await hostedUpdate

      const bindingUpdate = nextRepositoryUpdate(
        repositories,
        candidate => candidate.accountKey === settingsAccountKey
      )
      const saved = await repositories.updateRepositoryAccount(
        hosted,
        settingsAccountKey
      )
      const emitted = await bindingUpdate
      assert.equal(emitted.accountKey, settingsAccountKey)
      assert.equal(emitted.hash, saved.hash)
      assert.notEqual(emitted.hash, hosted.hash)

      const routed = new Array<Account>()
      let associationCalls = 0
      const triageStore = new ProviderTriageStore({
        apiFor: selectedAccount => {
          routed.push(selectedAccount)
          return {
            fetchProviderTriageIssues: async () => issues,
            fetchProviderTriagePullRequests: async () => pullRequests,
          }
        },
        htmlURLForEndpoint: () => 'https://github.com',
        now: () => new Date('2026-07-16T00:00:00Z'),
      })
      const accountStatuses = new Array<string>()
      const triageSubscription = triageStore.onDidUpdate(() =>
        accountStatuses.push(triageStore.getState().accountStatus)
      )
      render(
        <RepositoryProviderTriage
          repository={emitted}
          accounts={[refreshedAccount]}
          store={triageStore}
          onAssociateAccount={async () => {
            associationCalls++
            throw new Error('A valid explicit binding must not be overwritten')
          }}
        />
      )

      await waitFor(() => assert.ok(screen.getByText('2 of 2 work items')))
      assert.equal(screen.queryByLabelText('Repository account'), null)
      assert.equal(
        screen.queryByRole('button', { name: 'Use this account' }),
        null
      )
      assert.equal(associationCalls, 0)
      assert.deepEqual(routed, [refreshedAccount])
      assert.equal(accountStatuses.includes('selection-required'), false)
      assert.equal(accountStatuses.includes('signed-out'), false)

      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      await waitFor(() => assert.equal(routed.length, 2))
      assert.deepEqual(routed, [refreshedAccount, refreshedAccount])
      assert.equal(associationCalls, 0)
      assert.equal(accountStatuses.includes('selection-required'), false)
      assert.equal(accountStatuses.includes('signed-out'), false)
      triageSubscription.dispose()
    } finally {
      database.close()
    }
  })

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

  it('persists a labelled repository account choice and refreshes it immediately', async () => {
    const routed = new Array<string>()
    const persisted = new Array<string>()
    const triageStore = new ProviderTriageStore({
      apiFor: selectedAccount => {
        routed.push(getAccountKey(selectedAccount))
        return {
          fetchProviderTriageIssues: async () => issues,
          fetchProviderTriagePullRequests: async () => pullRequests,
        }
      },
      htmlURLForEndpoint: () => 'https://github.com',
      now: () => new Date('2026-07-13T00:00:00Z'),
    })
    const unbound = repositoryWithAccount(null)
    const view = render(
      <RepositoryProviderTriage
        repository={unbound}
        accounts={[account, otherAccount]}
        store={triageStore}
        onAssociateAccount={async (repo, accountKey) => {
          persisted.push(accountKey)
          return repositoryWithAccount(accountKey)
        }}
      />
    )

    const picker = await screen.findByLabelText('Repository account')
    assert.equal(picker.getAttribute('id'), 'provider-triage-account')
    assert.ok(screen.getByRole('option', { name: 'GitHub · selected' }))
    assert.ok(screen.getByRole('option', { name: 'GitHub · other' }))
    fireEvent.change(picker, {
      target: { value: getAccountKey(otherAccount) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use this account' }))

    await waitFor(() => assert.ok(screen.getByText('2 of 2 work items')))
    assert.deepEqual(persisted, [getAccountKey(otherAccount)])
    assert.deepEqual(routed, [getAccountKey(otherAccount)])

    view.rerender(
      <RepositoryProviderTriage
        repository={repositoryWithAccount(getAccountKey(otherAccount))}
        accounts={[account, otherAccount]}
        store={triageStore}
        onAssociateAccount={async (repo, accountKey) => {
          persisted.push(accountKey)
          return repositoryWithAccount(accountKey)
        }}
      />
    )
    await waitFor(() =>
      assert.ok(screen.getByText(/GitHub · desktop\/material · other/))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.equal(routed.length, 3))
    assert.deepEqual(routed, [
      getAccountKey(otherAccount),
      getAccountKey(otherAccount),
      getAccountKey(otherAccount),
    ])
  })

  it('auto-binds one valid match and exposes signed-out account routes', async () => {
    const persisted = new Array<string>()
    const triageStore = store({
      fetchProviderTriageIssues: async () => issues,
      fetchProviderTriagePullRequests: async () => pullRequests,
    })
    const view = render(
      <RepositoryProviderTriage
        repository={repositoryWithAccount(null)}
        accounts={[account]}
        store={triageStore}
        onAssociateAccount={async (repo, accountKey) => {
          persisted.push(accountKey)
          return repositoryWithAccount(accountKey)
        }}
      />
    )
    await waitFor(() => assert.ok(screen.getByText('2 of 2 work items')))
    assert.deepEqual(persisted, [getAccountKey(account)])

    let signIns = 0
    let managed = 0
    view.rerender(
      <RepositoryProviderTriage
        repository={repositoryWithAccount(null)}
        accounts={[]}
        store={triageStore}
        onSignIn={() => signIns++}
        onManageAccounts={() => managed++}
      />
    )
    await waitFor(() =>
      assert.ok(screen.getByText(/Sign in.*manage accounts/i))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Manage accounts' }))
    assert.equal(signIns, 1)
    assert.equal(managed, 1)
  })

  it('preserves a stale explicit binding and offers re-authentication', async () => {
    let reauthenticated: string | null = null
    render(
      <RepositoryProviderTriage
        repository={repository}
        accounts={[]}
        store={store({
          fetchProviderTriageIssues: async () => issues,
          fetchProviderTriagePullRequests: async () => pullRequests,
        })}
        onReauthenticateAccount={accountKey => {
          reauthenticated = accountKey
        }}
      />
    )

    await waitFor(() => assert.ok(screen.getByText(/saved repository binding/)))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    assert.equal(reauthenticated, getAccountKey(account))
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
