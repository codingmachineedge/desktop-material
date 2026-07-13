import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import {
  IGitHubPullRequestLifecycle,
  IGitHubPullRequestMergeReceipt,
  IGitHubPullRequestMutationReceipt,
  IGitHubPullRequestReview,
  IGitHubPullRequestReviewReceipt,
  IGitHubPullRequestUpdate,
} from '../../../src/lib/github-pull-request'
import { Account } from '../../../src/models/account'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { PullRequest, PullRequestRef } from '../../../src/models/pull-request'
import {
  Repository,
  RepositoryWithGitHubRepository,
} from '../../../src/models/repository'
import { DialogStackContext } from '../../../src/ui/dialog'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { GitHubPullRequestLifecycleDialog } from '../../../src/ui/github-pull-request-lifecycle'
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

function createAccount(login: string = 'octocat') {
  return new Account(login, endpoint, 'token', [], '', 1, login, 'free')
}

function createFixture() {
  const target = new GitHubRepository(
    'material',
    new Owner('desktop', endpoint, 1),
    2,
    false,
    'https://github.com/desktop/material',
    'https://github.com/desktop/material.git',
    true,
    false,
    'write',
    null
  )
  const repository = new Repository(
    'C:\\fixtures\\material',
    5,
    target,
    false
  ) as RepositoryWithGitHubRepository
  const pullRequest = new PullRequest(
    new Date('2026-01-01T00:00:00Z'),
    'Lifecycle PR',
    42,
    new PullRequestRef('feature', 'a'.repeat(40), target),
    new PullRequestRef('main', 'b'.repeat(40), target),
    'octocat',
    false,
    'Body'
  )
  return { repository, pullRequest }
}

function snapshot(
  overrides: Partial<IGitHubPullRequestLifecycle> = {}
): IGitHubPullRequestLifecycle {
  return {
    number: 42,
    title: 'Lifecycle PR',
    body: 'Body',
    url: 'https://github.com/desktop/material/pull/42',
    state: 'open',
    draft: false,
    merged: false,
    mergeable: true,
    mergeableState: 'clean',
    headRef: 'feature',
    headSHA: 'a'.repeat(40),
    headRepository: 'octocat/material',
    base: 'main',
    metadata: {
      reviewers: ['old-reviewer'],
      assignees: ['old-assignee'],
      labels: ['old-label'],
    },
    ...overrides,
  }
}

class TestDispatcher {
  public inspectCalls = 0
  public updateCalls = new Array<{
    expectedHeadSHA: string
    update: IGitHubPullRequestUpdate
  }>()
  public reviewCalls = new Array<{
    expectedHeadSHA: string
    review: IGitHubPullRequestReview
  }>()
  public mergeCalls = new Array<{
    expectedHeadSHA: string
    method: string
  }>()
  public inspectResult = Promise.resolve(snapshot())

  public inspectGitHubPullRequest() {
    this.inspectCalls++
    return this.inspectResult
  }

  public async updateGitHubPullRequest(
    _repository: Repository,
    _pullRequest: PullRequest,
    _account: Account,
    expectedHeadSHA: string,
    update: IGitHubPullRequestUpdate
  ): Promise<IGitHubPullRequestMutationReceipt> {
    this.updateCalls.push({ expectedHeadSHA, update })
    return {
      pullRequest: snapshot({
        title: update.title,
        body: update.body,
        base: update.base,
        metadata: update.metadata,
      }),
      warnings: [],
    }
  }

  public async submitGitHubPullRequestReview(
    _repository: Repository,
    _pullRequest: PullRequest,
    _account: Account,
    expectedHeadSHA: string,
    review: IGitHubPullRequestReview
  ): Promise<IGitHubPullRequestReviewReceipt> {
    this.reviewCalls.push({ expectedHeadSHA, review })
    return {
      id: 9,
      state: 'APPROVED',
      url: 'https://github.com/desktop/material/pull/42',
    }
  }

  public async mergeGitHubPullRequest(
    _repository: Repository,
    _pullRequest: PullRequest,
    _account: Account,
    expectedHeadSHA: string,
    method: string
  ): Promise<IGitHubPullRequestMergeReceipt> {
    this.mergeCalls.push({ expectedHeadSHA, method })
    return {
      merged: true,
      sha: 'b'.repeat(40),
      message: 'Pull request merged.',
    }
  }

  public async openInBrowser() {
    return true
  }
}

function dialog(
  dispatcher: TestDispatcher,
  options: {
    readonly topMost?: boolean
    readonly accounts?: ReadonlyArray<Account>
  } = {}
) {
  const fixture = createFixture()
  return (
    <DialogStackContext.Provider value={{ isTopMost: options.topMost ?? true }}>
      <GitHubPullRequestLifecycleDialog
        repository={fixture.repository}
        pullRequest={fixture.pullRequest}
        baseBranchNames={['main', 'release']}
        accounts={options.accounts ?? [createAccount()]}
        dispatcher={dispatcher as unknown as Dispatcher}
        onDismissed={() => {}}
      />
    </DialogStackContext.Provider>
  )
}

describe('GitHubPullRequestLifecycleDialog', () => {
  it('inspects and reviews exact title, body, base, reviewers, assignees, and labels', async () => {
    const dispatcher = new TestDispatcher()
    render(dialog(dispatcher))
    await waitFor(() =>
      assert.ok(screen.getByRole('heading', { name: 'Details and metadata' }))
    )

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Pull request title' }),
      { target: { value: ' Updated lifecycle ' } }
    )
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Pull request base branch' }),
      { target: { value: 'release' } }
    )
    fireEvent.change(screen.getByLabelText('Requested reviewers'), {
      target: { value: 'reviewer-one, reviewer-two' },
    })
    fireEvent.change(screen.getByLabelText('Assignees'), {
      target: { value: 'octocat' },
    })
    fireEvent.change(screen.getByLabelText('Labels'), {
      target: { value: 'ready, docs' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review updates' }))
    assert.ok(screen.getByRole('heading', { name: 'Review updates' }))
    assert.match(
      screen.getByText(/Reviewers:/).textContent ?? '',
      /reviewer-one/
    )
    fireEvent.click(screen.getByRole('button', { name: 'Apply updates' }))

    await waitFor(() => assert.equal(dispatcher.updateCalls.length, 1))
    assert.deepEqual(dispatcher.updateCalls[0], {
      expectedHeadSHA: 'a'.repeat(40),
      update: {
        title: 'Updated lifecycle',
        body: 'Body',
        base: 'release',
        metadata: {
          reviewers: ['reviewer-one', 'reviewer-two'],
          assignees: ['octocat'],
          labels: ['ready', 'docs'],
        },
      },
    })
    await waitFor(() =>
      assert.ok(screen.getByText('Pull request details updated.'))
    )
  })

  it('confirms a review and requires the exact pull request number before merge', async () => {
    const dispatcher = new TestDispatcher()
    render(dialog(dispatcher))
    await waitFor(() =>
      assert.ok(screen.getByRole('heading', { name: 'Submit a review' }))
    )

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Review decision' }),
      {
        target: { value: 'APPROVE' },
      }
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Review comment' }), {
      target: { value: 'Looks good' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review submission' }))
    assert.ok(screen.getByRole('heading', { name: 'Review submission' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }))
    await waitFor(() => assert.equal(dispatcher.reviewCalls.length, 1))
    assert.deepEqual(dispatcher.reviewCalls[0].review, {
      event: 'APPROVE',
      body: 'Looks good',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Prepare merge' }))
    const mergeButton = screen.getByRole('button', {
      name: 'Merge pull request',
    })
    assert.equal(mergeButton.getAttribute('aria-disabled'), 'true')
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Type #42 to confirm merge' }),
      { target: { value: '#42' } }
    )
    assert.equal(mergeButton.getAttribute('aria-disabled'), null)
    fireEvent.click(mergeButton)
    await waitFor(() => assert.equal(dispatcher.mergeCalls.length, 1))
    assert.deepEqual(dispatcher.mergeCalls[0], {
      expectedHeadSHA: 'a'.repeat(40),
      method: 'merge',
    })
    await waitFor(() =>
      assert.match(document.body.textContent ?? '', /merged/i)
    )
  })

  it('keeps draft merge read-only and guards non-topmost transport', async () => {
    const draftDispatcher = new TestDispatcher()
    draftDispatcher.inspectResult = Promise.resolve(snapshot({ draft: true }))
    render(dialog(draftDispatcher))
    await waitFor(() =>
      assert.ok(screen.getByRole('heading', { name: 'Merge' }))
    )
    assert.equal(
      screen
        .getByRole('button', { name: 'Prepare merge' })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.match(
      screen.getByText(/Draft status is shown/).textContent ?? '',
      /REST/
    )

    const guardedDispatcher = new TestDispatcher()
    render(dialog(guardedDispatcher, { topMost: false }))
    assert.equal(guardedDispatcher.inspectCalls, 0)
  })

  it('shows a neutral sign-in requirement without an eligible account', async () => {
    const dispatcher = new TestDispatcher()
    render(dialog(dispatcher, { accounts: [] }))
    await waitFor(() =>
      assert.match(document.body.textContent ?? '', /matching GitHub account/i)
    )
    assert.equal(dispatcher.inspectCalls, 0)
  })
})
