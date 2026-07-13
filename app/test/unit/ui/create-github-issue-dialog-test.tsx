import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { ICreatedGitHubIssue } from '../../../src/lib/github-issue'
import { APIError } from '../../../src/lib/http'
import { Account } from '../../../src/models/account'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import { CreateGitHubIssueDialog } from '../../../src/ui/create-github-issue'
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

function createAccount(token: string = 'secret-token') {
  return new Account('octocat', endpoint, token, [], '', 1, 'Octo Cat', 'free')
}

function createRepository(
  options: { archived?: boolean; issues?: boolean } = {}
) {
  const owner = new Owner('desktop', endpoint, 1)
  const gitHubRepository = new GitHubRepository(
    'material',
    owner,
    42,
    false,
    'https://github.com/desktop/material',
    'https://github.com/desktop/material.git',
    options.issues ?? true,
    options.archived ?? false,
    'read'
  )
  return new Repository('C:\\fixtures\\material', 5, gitHubRepository, false)
}

class TestDispatcher {
  public createCalls = new Array<{
    repository: Repository
    account: Account
    title: string
    body: string
    signal: AbortSignal
  }>()
  public openedURLs = new Array<string>()
  public fallbackRepositories = new Array<Repository>()

  public createResult: (signal: AbortSignal) => Promise<ICreatedGitHubIssue> =
    async () => ({
      number: 12,
      title: 'Created title',
      url: 'https://github.com/desktop/material/issues/12',
    })

  public createGitHubIssue(
    repository: Repository,
    account: Account,
    title: string,
    body: string,
    signal: AbortSignal
  ) {
    this.createCalls.push({ repository, account, title, body, signal })
    return this.createResult(signal)
  }

  public async openInBrowser(url: string) {
    this.openedURLs.push(url)
    return true
  }

  public async openIssueCreationPage(repository: Repository) {
    this.fallbackRepositories.push(repository)
    return true
  }
}

function asDispatcher(dispatcher: TestDispatcher) {
  return dispatcher as unknown as Dispatcher
}

function renderIssueDialog(
  repository: Repository,
  accounts: ReadonlyArray<Account>,
  dispatcher: TestDispatcher,
  onDismissed: () => void
) {
  return render(
    <DialogStackContext.Provider value={{ isTopMost: true }}>
      <CreateGitHubIssueDialog
        repository={repository}
        accounts={accounts}
        dispatcher={asDispatcher(dispatcher)}
        onDismissed={onDismissed}
      />
    </DialogStackContext.Provider>
  )
}

function composeAndReview(title: string, body: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: title },
  })
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Description (optional)' }),
    { target: { value: body } }
  )
  fireEvent.click(screen.getByRole('button', { name: 'Review issue' }))
}

describe('CreateGitHubIssueDialog', () => {
  it('reviews the exact draft, creates it with the repository account, and opens only the validated result', async () => {
    const dispatcher = new TestDispatcher()
    const account = createAccount()
    const repository = createRepository()
    let dismissed = 0

    renderIssueDialog(repository, [account], dispatcher, () => dismissed++)

    assert.ok(screen.getByText('desktop/material'))
    assert.ok(screen.getByText('octocat · GitHub.com'))
    assert.equal(document.body.textContent?.includes('secret-token'), false)

    composeAndReview('  A guided issue  ', 'Line one\nLine two')
    assert.ok(screen.getByRole('heading', { name: 'A guided issue' }))
    assert.equal(
      document.querySelector('.create-github-issue-review-body')?.textContent,
      'Line one\nLine two'
    )
    assert.match(
      screen.getByText(/Confirming will publish/).textContent ?? '',
      /desktop\/material as octocat/
    )

    const create = screen.getByRole('button', { name: 'Create issue' })
    assert.equal(create.hasAttribute('autofocus'), true)
    assert.equal(
      create.getAttribute('aria-describedby'),
      'create-github-issue-confirmation'
    )
    fireEvent.click(create)

    await waitFor(() => assert.equal(dispatcher.createCalls.length, 1))
    const call = dispatcher.createCalls[0]
    assert.equal(call.repository, repository)
    assert.equal(call.account, account)
    assert.equal(call.title, 'A guided issue')
    assert.equal(call.body, 'Line one\nLine two')
    assert.equal(call.signal.aborted, false)

    await waitFor(() => assert.ok(screen.getByText('Issue #12 created')))
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitHub' }))
    await waitFor(() =>
      assert.deepEqual(dispatcher.openedURLs, [
        'https://github.com/desktop/material/issues/12',
      ])
    )
    assert.equal(dismissed, 0)
  })

  it('passes exact cancellation to the request and warns about duplicate retries', async () => {
    const dispatcher = new TestDispatcher()
    dispatcher.createResult = signal =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new DOMException('Canceled', 'AbortError'))
        )
      })

    renderIssueDialog(
      createRepository(),
      [createAccount()],
      dispatcher,
      () => {}
    )

    composeAndReview('Cancel this request', '')
    fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))
    await waitFor(() => assert.equal(dispatcher.createCalls.length, 1))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }))

    assert.equal(dispatcher.createCalls[0].signal.aborted, true)
    await waitFor(() =>
      assert.match(
        screen.getByRole('alert').textContent ?? '',
        /duplicate issue/i
      )
    )
    assert.ok(screen.getByRole('button', { name: 'Create issue' }))
  })

  it('keeps the reviewed draft after an actionable permission failure', async () => {
    const dispatcher = new TestDispatcher()
    dispatcher.createResult = async () => {
      throw new APIError(new Response(null, { status: 403 }), {
        message: 'private draft echoed by server',
      })
    }

    renderIssueDialog(
      createRepository(),
      [createAccount()],
      dispatcher,
      () => {}
    )

    composeAndReview('Permission test', 'Private description')
    fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))

    await waitFor(() =>
      assert.match(
        screen.getByRole('alert').textContent ?? '',
        /denied issue creation/i
      )
    )
    assert.equal(
      screen.getByRole('alert').textContent?.includes('private draft'),
      false
    )
    assert.ok(screen.getByRole('heading', { name: 'Permission test' }))
  })

  it('offers a browser fallback without sending draft text when no eligible account exists', async () => {
    const dispatcher = new TestDispatcher()
    const repository = createRepository()
    let dismissed = 0

    renderIssueDialog(repository, [], dispatcher, () => dismissed++)

    assert.ok(screen.getByText('Native issue creation is unavailable'))
    assert.match(
      screen.getByText(/matching GitHub account/).textContent ?? '',
      /Sign in/
    )
    assert.equal(screen.queryByRole('textbox'), null)

    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }))
    await waitFor(() =>
      assert.deepEqual(dispatcher.fallbackRepositories, [repository])
    )
    await waitFor(() => assert.equal(dismissed, 1))
  })

  it('renders repository lifecycle restrictions before any submission', () => {
    const dispatcher = new TestDispatcher()
    renderIssueDialog(
      createRepository({ archived: true }),
      [createAccount()],
      dispatcher,
      () => {}
    )

    assert.match(
      screen.getByText(/repository is archived/).textContent ?? '',
      /cannot accept/
    )
    assert.equal(screen.queryByRole('textbox'), null)
    assert.equal(dispatcher.createCalls.length, 0)
  })
})
