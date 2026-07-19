import assert from 'node:assert'
import { beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { Account, getAccountKey } from '../../../src/models/account'
import { CloningRepository } from '../../../src/models/cloning-repository'
import {
  ILocalRepositoryState,
  Repository,
} from '../../../src/models/repository'
import { hideRepository } from '../../../src/lib/stores/repository-list-visibility'
import { ShowBranchNameInRepoListSetting } from '../../../src/models/show-branch-name-in-repo-list'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { RepositoriesList } from '../../../src/ui/repositories-list/repositories-list'
import { LanguageModeChangedEvent } from '../../../src/lib/i18n'
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
  public constructor(private readonly callback: ResizeObserverCallback) {}

  public observe(target: Element) {
    Object.defineProperty(target, 'offsetWidth', {
      configurable: true,
      value: 365,
    })
    Object.defineProperty(target, 'offsetHeight', {
      configurable: true,
      value: 360,
    })
    this.callback(
      [
        {
          target,
          contentRect: {
            x: 0,
            y: 0,
            width: 365,
            height: 360,
            top: 0,
            right: 365,
            bottom: 360,
            left: 0,
            toJSON: () => ({}),
          },
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this as unknown as ResizeObserver
    )
  }
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

beforeEach(() => localStorage.clear())

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

  it('offers combinable accessible status chips for every repository state', async () => {
    const clean = new Repository('/work/clean-repo', 11, null, false)
    const changed = new Repository('/work/changed-repo', 12, null, false)
    const ahead = new Repository('/work/ahead-repo', 13, null, false)
    const behind = new Repository('/work/behind-repo', 14, null, false)
    const missing = new Repository('/work/missing-repo', 15, null, true)
    const cloning = new CloningRepository(
      '/work/cloning-repo',
      'https://example.test/cloning-repo.git'
    )
    const localRepositoryStateLookup = new Map<number, ILocalRepositoryState>([
      [
        clean.id,
        {
          aheadBehind: { ahead: 0, behind: 0 },
          changedFilesCount: 0,
          branchName: 'main',
          defaultBranchName: 'main',
        },
      ],
      [
        changed.id,
        {
          aheadBehind: { ahead: 0, behind: 0 },
          changedFilesCount: 1,
          branchName: 'main',
          defaultBranchName: 'main',
        },
      ],
      [
        ahead.id,
        {
          aheadBehind: { ahead: 2, behind: 0 },
          changedFilesCount: 0,
          branchName: 'main',
          defaultBranchName: 'main',
        },
      ],
      [
        behind.id,
        {
          aheadBehind: { ahead: 0, behind: 3 },
          changedFilesCount: 0,
          branchName: 'main',
          defaultBranchName: 'main',
        },
      ],
    ])

    render(
      <RepositoriesList
        {...commonProps}
        accounts={[]}
        repositories={[clean, changed, ahead, behind, missing, cloning]}
        localRepositoryStateLookup={localRepositoryStateLookup}
      />
    )

    const all = screen.getByRole('button', { name: 'All' })
    const changedChip = screen.getByRole('button', { name: 'Changed' })
    assert.equal(all.getAttribute('aria-pressed'), 'true')

    fireEvent.click(changedChip)
    assert.equal(changedChip.getAttribute('aria-pressed'), 'true')
    assert.equal(all.getAttribute('aria-pressed'), 'false')
    await waitFor(() => assert.ok(screen.getByText('changed-repo')))
    assert.equal(screen.queryByText('clean-repo'), null)

    fireEvent.click(screen.getByRole('button', { name: 'Behind' }))
    await waitFor(() => {
      assert.ok(screen.getByText('changed-repo'))
      assert.ok(screen.getByText('behind-repo'))
    })

    fireEvent.click(all)
    fireEvent.click(screen.getByRole('button', { name: 'Missing / cloning' }))
    await waitFor(() => {
      assert.ok(screen.getByText('missing-repo'))
      assert.ok(screen.getByText('cloning-repo'))
    })
    assert.equal(screen.queryByText('changed-repo'), null)
  })

  it('keeps hidden repositories recoverable and visibly identified', async () => {
    const visible = new Repository('/work/visible-repo', 21, null, false)
    const hidden = new Repository('/work/hidden-repo', 22, null, false)
    hideRepository(hidden)

    render(
      <RepositoriesList
        {...commonProps}
        accounts={[]}
        repositories={[visible, hidden]}
      />
    )

    await waitFor(() => assert.ok(screen.getByText('visible-repo')))
    assert.equal(screen.queryByText('hidden-repo'), null)

    const showHidden = screen.getByRole('button', {
      name: 'Show hidden repositories (1)',
    })
    assert.equal(showHidden.getAttribute('aria-pressed'), 'false')
    fireEvent.click(showHidden)

    await waitFor(() => {
      assert.ok(screen.getByText('hidden-repo'))
      assert.ok(screen.getByText('Hidden'))
    })
    assert.equal(
      screen
        .getByRole('button', { name: 'Hide hidden repositories' })
        .getAttribute('aria-pressed'),
      'true'
    )
  })

  it('switches status and visibility controls through all language modes', async () => {
    localStorage.setItem(
      'appearance-customization-v1',
      JSON.stringify({ version: 1, languageMode: 'english' })
    )
    const visible = new Repository('/work/visible-localized', 31, null, false)
    const hidden = new Repository('/work/hidden-localized', 32, null, false)
    hideRepository(hidden)

    const view = render(
      <RepositoriesList
        {...commonProps}
        accounts={[]}
        repositories={[visible, hidden]}
      />
    )

    try {
      assert.ok(screen.getByText('Repository status'))
      assert.ok(screen.getByRole('button', { name: 'Changed' }))

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'cantonese' })
      )
      await waitFor(() => assert.ok(screen.getByText('Repo 狀態')))
      assert.ok(screen.getByRole('button', { name: '有變更' }))
      const showHidden = screen.getByRole('button', {
        name: '顯示隱藏 repo（1）',
      })
      fireEvent.click(showHidden)
      await waitFor(() => assert.ok(screen.getByText('已隱藏')))

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'bilingual' })
      )
      await waitFor(() =>
        assert.match(
          view.container.textContent ?? '',
          /Repository status · Repo 狀態/
        )
      )
      assert.ok(screen.getByRole('button', { name: 'Changed' }))
      assert.ok(
        screen.getByRole('button', { name: 'Hide hidden repositories' })
      )
      assert.match(
        view.container.textContent ?? '',
        /Showing hidden \(1\) · 顯示緊隱藏項目（1）/
      )
    } finally {
      view.unmount()
      localStorage.clear()
    }
  })
})
