import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { Account, getAccountKey } from '../../../src/models/account'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import {
  GitHubIssuesError,
  GitHubIssuesStore,
  IGitHubIssueMutationReview,
} from '../../../src/lib/stores/github-issues-store'
import {
  GitHubIssueMutationOperation,
  IGitHubIssue,
  IGitHubIssueMetadata,
  IGitHubIssueQuery,
  IGitHubIssueUpdate,
} from '../../../src/lib/github-issues'
import { GitHubIssuesView } from '../../../src/ui/github-issues'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const account = new Account(
  'fixture-bot',
  'https://api.github.com',
  'fixture-token',
  [],
  '',
  42,
  'Fixture Bot'
)
const remote = new GitHubRepository(
  'material',
  new Owner('desktop', 'https://api.github.com', 1),
  1,
  false,
  null,
  null,
  true
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

const issue: IGitHubIssue = {
  id: 1007,
  number: 7,
  title: 'Material shell clips long titles',
  body: 'Validated issue detail.\nSecond line.',
  state: 'open',
  stateReason: null,
  authorLogin: 'fixture-author',
  createdAt: new Date('2026-07-13T10:00:00Z'),
  updatedAt: new Date('2026-07-13T11:00:00Z'),
  closedAt: null,
  url: 'https://github.com/desktop/material/issues/7',
  labels: [{ id: 1, name: 'bug', color: 'd73a4a', description: 'Bug report' }],
  assignees: ['fixture-maintainer'],
  milestone: {
    number: 3,
    title: 'Next milestone',
    state: 'open',
    dueOn: null,
  },
  commentCount: 1,
  locked: false,
}

const review = (
  operation: GitHubIssueMutationOperation
): IGitHubIssueMutationReview => ({
  repositoryFingerprint: `sha256:${'a'.repeat(64)}`,
  accountFingerprint: `sha256:${'b'.repeat(64)}`,
  accountGeneration: 1,
  issueNumber: 7,
  issueFingerprint: `sha256:${'c'.repeat(64)}`,
  operation,
  mutationFingerprint: `sha256:${'d'.repeat(64)}`,
})

const dispatcher = {
  showPopup: () => undefined,
  openInBrowser: async () => true,
} as unknown as Dispatcher

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const metadata: IGitHubIssueMetadata = {
  labels: issue.labels,
  assignees: issue.assignees,
  milestones: [issue.milestone!],
  labelsCapped: false,
  assigneesCapped: false,
  milestonesCapped: false,
  unavailable: [],
}

function fakeStore(overrides: Record<string, unknown> = {}) {
  return {
    list: async (_repository: Repository, query: IGitHubIssueQuery) => ({
      issues: [issue],
      page: query.page,
      nextPage: query.page === 1 ? 2 : null,
      capped: false,
      incomplete: false,
    }),
    metadata: async () => metadata,
    detail: async () => issue,
    comments: async () => ({
      comments: [
        {
          id: 55,
          body: 'Validated comment',
          authorLogin: 'fixture-reviewer',
          createdAt: new Date('2026-07-13T12:00:00Z'),
          updatedAt: new Date('2026-07-13T12:00:00Z'),
          url: 'https://github.com/desktop/material/issues/7#issuecomment-55',
        },
      ],
      page: 1,
      nextPage: null,
      capped: false,
    }),
    createMutationReview: (
      _repository: Repository,
      _issue: IGitHubIssue,
      operation: GitHubIssueMutationOperation
    ) => review(operation),
    update: async (
      _repository: Repository,
      _review: IGitHubIssueMutationReview,
      update: IGitHubIssueUpdate
    ) => ({ ...issue, title: update.title, body: update.body }),
    addComment: async () => ({
      id: 56,
      body: 'New comment',
      authorLogin: 'fixture-bot',
      createdAt: new Date(),
      updatedAt: new Date(),
      url: 'https://github.com/desktop/material/issues/7#issuecomment-56',
    }),
    setState: async (
      _repository: Repository,
      _review: IGitHubIssueMutationReview,
      state: 'open' | 'closed'
    ) => ({ ...issue, state }),
    ...overrides,
  } as unknown as GitHubIssuesStore
}

async function selectFixtureIssue() {
  await waitFor(() =>
    assert.ok(
      screen.getByRole('button', {
        name: /Material shell clips long titles/,
      })
    )
  )
  fireEvent.click(
    screen.getByRole('button', {
      name: /Material shell clips long titles/,
    })
  )
  await waitFor(() =>
    assert.ok(screen.getByRole('heading', { name: issue.title }))
  )
}

describe('GitHub Issues view', () => {
  it('browses validated issue detail, comments, filters, and exact pages', async () => {
    const queries = new Array<IGitHubIssueQuery>()
    const store = fakeStore({
      list: async (_repository: Repository, query: IGitHubIssueQuery) => {
        queries.push(query)
        return {
          issues: [issue],
          page: query.page,
          nextPage: query.page === 1 ? 2 : null,
          capped: false,
          incomplete: false,
        }
      },
      metadata: async () => ({
        labels: issue.labels,
        assignees: [],
        milestones: [issue.milestone!],
        labelsCapped: false,
        assigneesCapped: false,
        milestonesCapped: false,
        unavailable: ['assignees'],
      }),
    })
    render(
      <GitHubIssuesView
        repository={repository}
        accounts={[account]}
        issuesStore={store}
        dispatcher={dispatcher}
      />
    )

    assert.ok(screen.getByRole('main', { name: 'GitHub Issues' }))
    await selectFixtureIssue()
    assert.ok(screen.getByText(/Validated issue detail/))
    assert.ok(screen.getByText('Validated comment'))
    assert.ok(screen.getAllByText('Next milestone').length >= 2)
    assert.match(
      screen.getByText(/Some repository metadata is unavailable/).textContent ??
        '',
      /provider version or selected account access changed/
    )

    fireEvent.change(screen.getByLabelText('Search title and description'), {
      target: { value: 'shell repo:other/private is:pr' },
    })
    fireEvent.change(screen.getByLabelText('State'), {
      target: { value: 'all' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => assert.equal(queries.length, 2))
    assert.equal(queries[1].search, 'shell repo:other/private is:pr')
    assert.equal(queries[1].state, 'all')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => assert.equal(queries.at(-1)?.page, 2))
  })

  it('keeps metadata independent while issue detail loads and allows a reload', async () => {
    const pendingMetadata = deferred<IGitHubIssueMetadata>()
    let metadataCalls = 0
    const store = fakeStore({
      metadata: async () => {
        metadataCalls++
        return await pendingMetadata.promise
      },
    })
    render(
      <GitHubIssuesView
        repository={repository}
        accounts={[account]}
        issuesStore={store}
        dispatcher={dispatcher}
      />
    )

    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Loading metadata…' }))
    )
    await selectFixtureIssue()
    assert.ok(screen.getByText(/Validated issue detail/))

    pendingMetadata.resolve(metadata)
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Reload metadata' }))
    )
    assert.ok(screen.getByRole('option', { name: 'bug' }))

    fireEvent.click(screen.getByRole('button', { name: 'Reload metadata' }))
    await waitFor(() => assert.equal(metadataCalls, 2))
  })

  it('keeps validated detail usable and retries an independent comment failure', async () => {
    let commentCalls = 0
    const store = fakeStore({
      comments: async () => {
        commentCalls++
        if (commentCalls === 1) {
          throw new GitHubIssuesError(
            'service',
            'Comments are temporarily unavailable.'
          )
        }
        return {
          comments: [
            {
              id: 55,
              body: 'Validated comment after retry',
              authorLogin: 'fixture-reviewer',
              createdAt: new Date('2026-07-13T12:00:00Z'),
              updatedAt: new Date('2026-07-13T12:00:00Z'),
              url: 'https://github.com/desktop/material/issues/7#issuecomment-55',
            },
          ],
          page: 1,
          nextPage: null,
          capped: false,
        }
      },
    })
    render(
      <GitHubIssuesView
        repository={repository}
        accounts={[account]}
        issuesStore={store}
        dispatcher={dispatcher}
      />
    )

    await selectFixtureIssue()
    assert.ok(screen.getByText(/Validated issue detail/))
    await waitFor(() =>
      assert.ok(screen.getByText('Comments are temporarily unavailable.'))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry comments' }))
    await waitFor(() => assert.equal(commentCalls, 2))
    assert.ok(screen.getByText('Validated comment after retry'))
  })

  it('updates metadata only after the exact review confirmation', async () => {
    const updates = new Array<IGitHubIssueUpdate>()
    const store = fakeStore({
      update: async (
        _repository: Repository,
        _review: IGitHubIssueMutationReview,
        update: IGitHubIssueUpdate
      ) => {
        updates.push(update)
        return { ...issue, title: update.title, body: update.body }
      },
    })
    render(
      <GitHubIssuesView
        repository={repository}
        accounts={[account]}
        issuesStore={store}
        dispatcher={dispatcher}
      />
    )
    await selectFixtureIssue()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Updated issue title' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    assert.equal(updates.length, 0)
    assert.ok(screen.getByRole('heading', { name: 'Review issue changes' }))
    assert.ok(screen.getByText('Updated issue title'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm changes' }))
    await waitFor(() => assert.equal(updates.length, 1))
    assert.equal(updates[0].title, 'Updated issue title')
    assert.ok(screen.getByText('Issue changes saved.'))
  })

  it('reviews comments and close operations before crossing the write boundary', async () => {
    let commentCalls = 0
    let stateCalls = 0
    const store = fakeStore({
      addComment: async () => {
        commentCalls++
        throw new GitHubIssuesError(
          'uncertain',
          'Desktop lost confirmation after GitHub began the request to add the comment. Check the issue on GitHub before retrying.'
        )
      },
      setState: async () => {
        stateCalls++
        return { ...issue, state: 'closed' }
      },
    })
    render(
      <GitHubIssuesView
        repository={repository}
        accounts={[account]}
        issuesStore={store}
        dispatcher={dispatcher}
      />
    )
    await selectFixtureIssue()

    fireEvent.click(screen.getByRole('button', { name: 'Add comment' }))
    fireEvent.change(screen.getByLabelText('Comment'), {
      target: { value: 'Reviewed new comment' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review comment' }))
    assert.equal(commentCalls, 0)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm comment' }))
    await waitFor(() => assert.equal(commentCalls, 1))
    assert.ok(screen.getByRole('alert'))
    assert.match(screen.getByRole('alert').textContent ?? '', /Check the issue/)

    fireEvent.click(screen.getByRole('button', { name: 'Close issue' }))
    assert.equal(stateCalls, 0)
    assert.ok(screen.getByRole('heading', { name: 'Confirm close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm close' }))
    await waitFor(() => assert.equal(stateCalls, 1))
  })

  it('uses the existing guided creator and explains selected-account sign-in', async () => {
    let popupCalls = 0
    const popupDispatcher = {
      showPopup: () => {
        popupCalls++
      },
      openInBrowser: async () => true,
    } as unknown as Dispatcher
    const view = render(
      <GitHubIssuesView
        repository={repository}
        accounts={[account]}
        issuesStore={fakeStore()}
        dispatcher={popupDispatcher}
      />
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'New issue' }))
    )
    fireEvent.click(screen.getByRole('button', { name: 'New issue' }))
    assert.equal(popupCalls, 1)

    view.rerender(
      <GitHubIssuesView
        repository={repository}
        accounts={[]}
        issuesStore={fakeStore()}
        dispatcher={popupDispatcher}
      />
    )
    await waitFor(() =>
      assert.ok(
        screen.getByRole('heading', { name: 'Sign in to browse Issues' })
      )
    )
    assert.match(
      screen.getByRole('status').textContent ?? '',
      /will not try another signed-in account implicitly/
    )
  })
})
