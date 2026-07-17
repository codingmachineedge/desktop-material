import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { Account, getAccountKey } from '../../../src/models/account'
import { Repository } from '../../../src/models/repository'
import { ShowBranchNameInRepoListSetting } from '../../../src/models/show-branch-name-in-repo-list'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { RepositoriesList } from '../../../src/ui/repositories-list/repositories-list'
import { accountFilterFor } from '../../../src/ui/repositories-list/repository-list-filters'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'
import { gitHubRepoFixture } from '../../helpers/github-repo-builder'

const github = new Account(
  'octocat',
  'https://api.github.com',
  'github-token',
  [],
  '',
  1,
  'Octo Cat',
  'free'
)
const gitlab = new Account(
  'fox',
  'https://gitlab.example/api/v4',
  'gitlab-token',
  [],
  '',
  2,
  'GitLab Fox',
  'free',
  undefined,
  undefined,
  undefined,
  undefined,
  'gitlab'
)

class TestResizeObserver {
  public observe() {}
  public unobserve() {}
  public disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: TestResizeObserver,
})
Object.defineProperty(window, 'ResizeObserver', {
  configurable: true,
  value: TestResizeObserver,
})

const githubRepository = new Repository(
  '/work/github-repo',
  1,
  gitHubRepoFixture({ owner: 'octocat', name: 'github-repo' }),
  false,
  null,
  {},
  false,
  undefined,
  getAccountKey(github)
)
const gitlabRepository = new Repository(
  '/work/gitlab-repo',
  2,
  gitHubRepoFixture({
    endpoint: gitlab.endpoint,
    owner: 'team',
    name: 'gitlab-repo',
  }),
  false,
  null,
  {},
  false,
  undefined,
  getAccountKey(gitlab)
)
const localRepository = new Repository('/work/local-repo', 3, null, false)

const dispatcher = {
  closeFoldout: () => undefined,
  recordRepoClicked: () => undefined,
  showPopup: () => undefined,
} as unknown as Dispatcher

const commonProps = {
  selectedRepository: null,
  repositories: [githubRepository, gitlabRepository, localRepository],
  recentRepositories: [],
  showRecentRepositories: true,
  showBranchNameInRepoList: ShowBranchNameInRepoListSetting.Never,
  localRepositoryStateLookup: new Map(),
  onSelectionChanged: () => undefined,
  askForConfirmationOnRemoveRepository: false,
  onRemoveRepository: () => undefined,
  onShowRepository: () => undefined,
  onViewOnGitHub: () => undefined,
  onOpenInNewWindow: () => undefined,
  onOpenInShell: () => undefined,
  onOpenInExternalEditor: () => undefined,
  onFilterTextChanged: () => undefined,
  filterText: '',
  dispatcher,
}

describe('RepositoriesList account and service filters', () => {
  it('combines mutually exclusive scopes and clears a stale account selection', async () => {
    const { rerender } = render(
      <RepositoriesList {...commonProps} accounts={[github, gitlab]} />
    )
    const account = screen.getByRole('combobox', {
      name: 'Repository account',
    })
    const service = screen.getByRole('combobox', {
      name: 'Repository service',
    })

    fireEvent.change(account, { target: { value: accountFilterFor(github) } })
    assert.equal((account as HTMLSelectElement).value, accountFilterFor(github))

    fireEvent.change(service, { target: { value: 'gitlab' } })
    assert.equal((service as HTMLSelectElement).value, 'gitlab')

    fireEvent.change(account, { target: { value: 'all' } })
    assert.equal((account as HTMLSelectElement).value, 'all')

    fireEvent.change(service, { target: { value: 'all' } })
    fireEvent.change(account, { target: { value: accountFilterFor(github) } })
    rerender(<RepositoriesList {...commonProps} accounts={[gitlab]} />)
    await waitFor(() =>
      assert.equal((account as HTMLSelectElement).value, 'all')
    )
    assert.equal(screen.queryByRole('option', { name: /Octo Cat/ }), null)
    assert.ok(screen.getByRole('option', { name: /GitLab Fox/ }))
  })
})
