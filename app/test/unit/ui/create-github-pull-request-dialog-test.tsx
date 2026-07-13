import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import {
  ICreatedGitHubPullRequest,
  IGitHubPullRequestDraft,
  IGitHubPullRequestTarget,
} from '../../../src/lib/github-pull-request'
import { APIError } from '../../../src/lib/http'
import { Account } from '../../../src/models/account'
import { Branch, BranchType } from '../../../src/models/branch'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { IRemote } from '../../../src/models/remote'
import { Repository } from '../../../src/models/repository'
import { CreateGitHubPullRequestDialog } from '../../../src/ui/create-github-pull-request'
import { DialogStackContext } from '../../../src/ui/dialog'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const endpoint = 'https://api.github.com'
let restoreIpcSend: (() => void) | null = null
let restoreDialogShow: (() => void) | null = null

beforeEach(async () => {
  const electron = await import('electron')
  const previousSend = electron.ipcRenderer.send
  electron.ipcRenderer.send = () => {}
  restoreIpcSend = () => {
    electron.ipcRenderer.send = previousSend
    restoreIpcSend = null
  }

  const prototype = window.HTMLDialogElement.prototype
  const previousShow = prototype.show
  prototype.show = function () {
    this.setAttribute('open', '')
  }
  restoreDialogShow = () => {
    prototype.show = previousShow
    restoreDialogShow = null
  }
})

afterEach(() => {
  restoreIpcSend?.()
  restoreDialogShow?.()
})

function createAccount(login: string = 'octocat', token: string = 'token') {
  return new Account(
    login,
    endpoint,
    token,
    [],
    '',
    login.length,
    login,
    'free'
  )
}

function createGitHubRepository(
  owner: string,
  name: string,
  options: { archived?: boolean; parent?: GitHubRepository | null } = {}
) {
  return new GitHubRepository(
    name,
    new Owner(owner, endpoint, owner.length),
    owner.length + name.length,
    false,
    `https://github.com/${owner}/${name}`,
    `https://github.com/${owner}/${name}.git`,
    true,
    options.archived ?? false,
    'write',
    options.parent ?? null
  )
}

function createLocalBranch(
  name: string = 'feature/local-name',
  upstream: string | null = 'origin/published-head'
) {
  return new Branch(
    name,
    upstream,
    { sha: 'a'.repeat(40) },
    BranchType.Local,
    `refs/heads/${name}`
  )
}

function createRemoteBranch(remote: string, name: string) {
  return new Branch(
    `${remote}/${name}`,
    null,
    { sha: 'b'.repeat(40) },
    BranchType.Remote,
    `refs/remotes/${remote}/${name}`
  )
}

function createFixture(options: { parentArchived?: boolean } = {}) {
  const parent = createGitHubRepository('desktop', 'material', {
    archived: options.parentArchived,
  })
  const source = createGitHubRepository('octocat', 'material', { parent })
  const repository = new Repository(
    'C:\\fixtures\\material',
    5,
    source,
    false
  ) as Repository & { readonly gitHubRepository: GitHubRepository }
  const currentBranch = createLocalBranch()
  const sourceRemote: IRemote = {
    name: 'origin',
    url: 'https://github.com/octocat/material.git',
  }
  const parentMain = createRemoteBranch('upstream', 'main')
  const sourceMain = createRemoteBranch('origin', 'main')
  const targets: ReadonlyArray<IGitHubPullRequestTarget> = [
    {
      repository: parent,
      baseBranches: [
        { name: 'main', branch: parentMain },
        {
          name: 'release',
          branch: createRemoteBranch('upstream', 'release'),
        },
      ],
      defaultBranchName: 'main',
    },
    {
      repository: source,
      baseBranches: [{ name: 'main', branch: sourceMain }],
      defaultBranchName: 'main',
    },
  ]
  return {
    parent,
    source,
    repository,
    currentBranch,
    sourceRemote,
    targets,
  }
}

class TestDispatcher {
  public contextCurrent = true
  public createCalls = new Array<{
    target: GitHubRepository
    account: Account
    branch: Branch
    sourceRemote: IRemote | null
    providerHTMLURL: string
    contextVersion: string
    draft: IGitHubPullRequestDraft
    signal: AbortSignal
  }>()
  public browserCalls = new Array<{
    target?: GitHubRepository
    baseBranchName?: string
    sourceRemote: IRemote | null
  }>()
  public openedURLs = new Array<string>()

  public createResult: (
    signal: AbortSignal
  ) => Promise<ICreatedGitHubPullRequest> = async () => ({
    number: 12,
    title: 'Created title',
    url: 'https://github.com/desktop/material/pull/12',
    draft: true,
  })

  public isGitHubPullRequestContextCurrent() {
    return this.contextCurrent
  }

  public createGitHubPullRequest(
    _repository: Repository,
    target: GitHubRepository,
    account: Account,
    branch: Branch,
    sourceRemote: IRemote | null,
    providerHTMLURL: string,
    contextVersion: string,
    draft: IGitHubPullRequestDraft,
    signal: AbortSignal
  ) {
    this.createCalls.push({
      target,
      account,
      branch,
      sourceRemote,
      providerHTMLURL,
      contextVersion,
      draft,
      signal,
    })
    return this.createResult(signal)
  }

  public async openCreatePullRequestInBrowser(
    _repository: Repository,
    _branch: Branch,
    sourceRemote: IRemote | null,
    baseBranchName?: string,
    target?: GitHubRepository
  ) {
    this.browserCalls.push({ target, baseBranchName, sourceRemote })
    return true
  }

  public async openInBrowser(url: string) {
    this.openedURLs.push(url)
    return true
  }
}

function asDispatcher(dispatcher: TestDispatcher) {
  return dispatcher as unknown as Dispatcher
}

interface IRenderOptions {
  readonly topMost?: boolean
  readonly contextCurrent?: boolean
  readonly accounts?: ReadonlyArray<Account>
  readonly initialTargetHash?: string
}

function dialogElement(
  fixture: ReturnType<typeof createFixture>,
  dispatcher: TestDispatcher,
  onDismissed: () => void,
  options: IRenderOptions = {}
) {
  return (
    <DialogStackContext.Provider value={{ isTopMost: options.topMost ?? true }}>
      <CreateGitHubPullRequestDialog
        repository={fixture.repository}
        currentBranch={fixture.currentBranch}
        sourceRemote={fixture.sourceRemote}
        providerHTMLURL="https://github.com"
        targets={fixture.targets}
        initialTargetHash={options.initialTargetHash ?? fixture.parent.hash}
        initialBaseBranchName={null}
        contextVersion="repository-generation-1"
        repositoryContextCurrent={options.contextCurrent ?? true}
        accounts={options.accounts ?? [createAccount()]}
        dispatcher={asDispatcher(dispatcher)}
        onDismissed={onDismissed}
      />
    </DialogStackContext.Provider>
  )
}

function composeAndReview(title: string, body: string, draft: boolean = false) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: title },
  })
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Description (optional)' }),
    { target: { value: body } }
  )
  if (draft) {
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Create as draft pull request' })
    )
  }
  fireEvent.click(screen.getByRole('button', { name: 'Review pull request' }))
}

describe('CreateGitHubPullRequestDialog', () => {
  it('reviews and creates the exact target, account, published head, base, and draft', async () => {
    const fixture = createFixture()
    const dispatcher = new TestDispatcher()
    render(dialogElement(fixture, dispatcher, () => {}))

    assert.equal(
      screen.getByRole<HTMLSelectElement>('combobox', {
        name: 'Target repository',
      }).value,
      fixture.parent.hash
    )
    assert.equal(
      screen.getByRole<HTMLSelectElement>('combobox', {
        name: 'Base branch',
      }).value,
      'main'
    )
    assert.match(
      screen.getByRole('group', { name: 'Head branch' }).textContent ?? '',
      /octocat:published-head/
    )
    assert.equal(document.body.textContent?.includes('token'), false)

    composeAndReview('  Native pull request  ', 'Line one\nLine two', true)
    assert.ok(screen.getByRole('heading', { name: 'Native pull request' }))
    assert.match(
      screen.getByRole('group', { name: 'Pull request route' }).textContent ??
        '',
      /octocat:published-head → main/
    )
    const create = screen.getByRole('button', {
      name: 'Create draft pull request',
    })
    assert.equal(create.hasAttribute('autofocus'), true)
    fireEvent.click(create)

    await waitFor(() => assert.equal(dispatcher.createCalls.length, 1))
    const call = dispatcher.createCalls[0]
    assert.equal(call.target, fixture.parent)
    assert.equal(call.account.login, 'octocat')
    assert.equal(call.branch, fixture.currentBranch)
    assert.equal(call.sourceRemote, fixture.sourceRemote)
    assert.equal(call.providerHTMLURL, 'https://github.com')
    assert.equal(call.contextVersion, 'repository-generation-1')
    assert.deepEqual(call.draft, {
      title: 'Native pull request',
      body: 'Line one\nLine two',
      head: 'octocat:published-head',
      base: 'main',
      draft: true,
    })
    assert.equal(call.signal.aborted, false)

    await waitFor(() =>
      assert.ok(screen.getByText('Draft pull request #12 created'))
    )
    assert.ok(screen.getByText('Native pull request'))
    assert.equal(screen.queryByText('Created title'), null)
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitHub' }))
    await waitFor(() =>
      assert.deepEqual(dispatcher.openedURLs, [
        'https://github.com/desktop/material/pull/12',
      ])
    )
  })

  it('passes exact cancellation and warns before a duplicate retry', async () => {
    const fixture = createFixture()
    const dispatcher = new TestDispatcher()
    dispatcher.createResult = signal =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new DOMException('Canceled', 'AbortError'))
        )
      })
    render(dialogElement(fixture, dispatcher, () => {}))

    composeAndReview('Cancel native PR', '')
    fireEvent.click(screen.getByRole('button', { name: 'Create pull request' }))
    await waitFor(() => assert.equal(dispatcher.createCalls.length, 1))
    assert.equal(screen.queryByRole('button', { name: 'Close' }), null)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    assert.equal(dispatcher.createCalls[0].signal.aborted, false)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }))

    assert.equal(dispatcher.createCalls[0].signal.aborted, true)
    await waitFor(() =>
      assert.match(
        screen.getByRole('alert').textContent ?? '',
        /duplicate pull request/i
      )
    )
    assert.ok(screen.getByRole('button', { name: 'Create pull request' }))
  })

  it('keeps the reviewed draft and redacts a provider permission error', async () => {
    const fixture = createFixture()
    const dispatcher = new TestDispatcher()
    dispatcher.createResult = async () => {
      throw new APIError(new Response(null, { status: 403 }), {
        message: 'provider echoed a private description',
      })
    }
    render(dialogElement(fixture, dispatcher, () => {}))

    composeAndReview('Permission test', 'Private description')
    fireEvent.click(screen.getByRole('button', { name: 'Create pull request' }))

    await waitFor(() =>
      assert.match(
        screen.getByRole('alert').textContent ?? '',
        /denied pull request creation/i
      )
    )
    assert.equal(
      screen.getByRole('alert').textContent?.includes('private description'),
      false
    )
    assert.ok(screen.getByRole('heading', { name: 'Permission test' }))
  })

  it('offers a no-draft browser fallback when no matching account exists', async () => {
    const fixture = createFixture()
    const dispatcher = new TestDispatcher()
    let dismissed = 0
    render(
      dialogElement(fixture, dispatcher, () => dismissed++, { accounts: [] })
    )

    assert.ok(screen.getByText('Native pull request creation is unavailable'))
    assert.match(
      screen.getByText(/matching GitHub account/).textContent ?? '',
      /Sign in/
    )
    assert.equal(screen.queryByRole('textbox'), null)
    fireEvent.click(
      screen.getByRole('button', { name: 'Open browser fallback' })
    )

    await waitFor(() => assert.equal(dispatcher.browserCalls.length, 1))
    assert.equal(dispatcher.browserCalls[0].target, fixture.parent)
    assert.equal(dispatcher.browserCalls[0].sourceRemote, fixture.sourceRemote)
    assert.equal(dispatcher.browserCalls[0].baseBranchName, 'main')
    await waitFor(() => assert.equal(dismissed, 1))
  })

  it('preserves target selection when one offered fork target is unavailable', () => {
    const fixture = createFixture({ parentArchived: true })
    const dispatcher = new TestDispatcher()
    render(dialogElement(fixture, dispatcher, () => {}))

    assert.match(
      screen.getByText(/selected repository is archived/).textContent ?? '',
      /archived/
    )
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Target repository' }),
      { target: { value: fixture.source.hash } }
    )

    assert.ok(screen.getByRole('textbox', { name: 'Title' }))
    assert.match(
      screen.getByRole('group', { name: 'Head branch' }).textContent ?? '',
      /published-head/
    )
  })

  it('guards non-topmost actions and aborts an in-flight stale repository generation', async () => {
    const fixture = createFixture()
    const dispatcher = new TestDispatcher()
    dispatcher.createResult = signal =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new DOMException('Stale', 'AbortError'))
        )
      })
    const rendered = render(
      dialogElement(fixture, dispatcher, () => {}, { topMost: false })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Review pull request' }))
    assert.equal(
      screen.queryByRole('button', { name: 'Create pull request' }),
      null
    )

    rendered.rerender(dialogElement(fixture, dispatcher, () => {}))
    composeAndReview('Generation guard', '')
    fireEvent.click(screen.getByRole('button', { name: 'Create pull request' }))
    await waitFor(() => assert.equal(dispatcher.createCalls.length, 1))

    rendered.rerender(
      dialogElement(fixture, dispatcher, () => {}, {
        contextCurrent: false,
      })
    )
    await waitFor(() =>
      assert.equal(dispatcher.createCalls[0].signal.aborted, true)
    )
    assert.match(screen.getByRole('alert').textContent ?? '', /duplicate/i)
    assert.equal(
      screen.queryByRole('button', { name: 'Open browser fallback' }),
      null
    )
  })

  it('keeps the immutable success receipt after account and context changes', async () => {
    const fixture = createFixture()
    const dispatcher = new TestDispatcher()
    const rendered = render(dialogElement(fixture, dispatcher, () => {}))

    composeAndReview('Durable success', 'Immutable description')
    fireEvent.click(screen.getByRole('button', { name: 'Create pull request' }))
    await waitFor(() => assert.ok(screen.getByText('Pull request #12 created')))

    rendered.rerender(
      dialogElement(fixture, dispatcher, () => {}, {
        accounts: [],
        contextCurrent: false,
      })
    )
    assert.ok(screen.getByText('Pull request #12 created'))
    assert.ok(screen.getByText('Durable success'))
    assert.ok(screen.getByText('Immutable description'))
    assert.equal(screen.queryByText('Created title'), null)
    assert.ok(screen.getByRole('button', { name: 'Open on GitHub' }))
  })
})
