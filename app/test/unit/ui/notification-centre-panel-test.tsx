import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import {
  IAPINotificationThread,
  IAPINotificationsOptions,
  IAPINotificationsPage,
} from '../../../src/lib/api'
import { APIError } from '../../../src/lib/http'
import {
  GitHubNotificationsStore,
  IGitHubNotificationsAPI,
} from '../../../src/lib/stores/github-notifications-store'
import { Account } from '../../../src/models/account'
import { INotificationEntry } from '../../../src/models/notification-centre'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { NotificationCentrePanel } from '../../../src/ui/notifications/notification-centre-panel'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'

const account = (
  login: string,
  id: number,
  provider: 'github' | 'gitlab' = 'github'
) =>
  new Account(
    login,
    provider === 'github'
      ? 'https://api.github.com'
      : 'https://gitlab.example.test/api/v4',
    `${login}-secret-token`,
    [],
    '',
    id,
    login,
    'free',
    undefined,
    undefined,
    undefined,
    undefined,
    provider
  )

const notification = (
  id: string,
  unread: boolean = true,
  title: string = `Notification ${id}`
): IAPINotificationThread => ({
  id,
  repository: {
    id: 1,
    name: 'repository',
    full_name: 'owner/repository-with-a-very-long-name-that-must-not-clip',
    private: false,
    owner: {
      id: 1,
      login: 'owner',
      avatar_url: 'https://avatars.example.test/owner',
      html_url: 'https://github.com/owner',
      type: 'User',
    },
    html_url: 'https://github.com/owner/repository',
  },
  subject: {
    title,
    url: `https://api.github.com/repos/owner/repository/issues/${id}`,
    latest_comment_url: null,
    type: 'Issue',
  },
  reason: 'review_requested',
  unread,
  updated_at: '2026-07-12T12:00:00Z',
  last_read_at: null,
  url: `https://api.github.com/notifications/threads/${id}`,
  subscription_url: `https://api.github.com/notifications/threads/${id}/subscription`,
})

const page = (
  notifications: ReadonlyArray<IAPINotificationThread>,
  options: Partial<IAPINotificationsPage> = {}
): IAPINotificationsPage => ({
  notifications,
  hasNextPage: false,
  notModified: false,
  lastModified: 'Sun, 12 Jul 2026 12:00:00 GMT',
  pollIntervalSeconds: null,
  ...options,
})

const localEntry: INotificationEntry = {
  id: 'local-entry',
  kind: 'info',
  title: 'Local notification',
  body: 'Stored in the git-backed notification log',
  createdAt: '2026-07-12T12:00:00Z',
  read: false,
}

const dispatcher = {
  setNotificationCentreOpen: () => {},
  markAllNotificationsRead: () => {},
  clearAllNotifications: () => {},
  showPopup: () => {},
  markNotificationUnread: () => {},
  markNotificationRead: () => {},
  deleteNotification: () => {},
} as unknown as Dispatcher

describe('NotificationCentrePanel', () => {
  it('keeps Local as the default source with connected keyboard tabs', () => {
    render(
      <NotificationCentrePanel
        dispatcher={dispatcher}
        entries={[localEntry]}
        unreadCount={1}
        repositories={[]}
        accounts={[]}
      />
    )

    const local = screen.getByRole('tab', { name: 'Local' })
    const github = screen.getByRole('tab', { name: 'GitHub' })
    const sourcePanel = screen.getByRole('tabpanel', { name: 'Local' })
    const all = screen.getByRole('tab', { name: 'All' })
    const unread = screen.getByRole('tab', { name: 'Unread (1)' })
    const filterPanel = screen.getByRole('tabpanel', { name: 'All' })

    assert.equal(local.getAttribute('aria-controls'), sourcePanel.id)
    assert.equal(github.getAttribute('aria-controls'), sourcePanel.id)
    assert.equal(sourcePanel.getAttribute('aria-labelledby'), local.id)
    assert.equal(all.getAttribute('aria-controls'), filterPanel.id)
    assert.equal(unread.getAttribute('aria-controls'), filterPanel.id)
    assert.equal(filterPanel.getAttribute('aria-labelledby'), all.id)
    assert.equal(
      screen.getByText('Local notification').textContent,
      'Local notification'
    )
    assert.ok(screen.getByRole('button', { name: 'Notification history' }))
    assert.equal(
      screen.getByText('userData/notifications.git').textContent,
      'userData/notifications.git'
    )

    all.focus()
    fireEvent.keyDown(all, { key: 'End' })
    assert.equal(unread.getAttribute('aria-selected'), 'true')
    assert.equal(unread.tabIndex, 0)
    assert.equal(all.tabIndex, -1)
    assert.equal(filterPanel.getAttribute('aria-labelledby'), unread.id)
    assert.equal(document.activeElement, unread)

    github.focus()
    fireEvent.keyDown(github, { key: 'Home' })
    assert.equal(document.activeElement, local)
    assert.equal(local.getAttribute('aria-selected'), 'true')
  })

  it('isolates GitHub controls and preserves the Local filter when switching sources', async () => {
    render(
      <NotificationCentrePanel
        dispatcher={dispatcher}
        entries={[localEntry]}
        unreadCount={1}
        repositories={[]}
        accounts={[]}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Unread (1)' }))
    fireEvent.click(screen.getByRole('tab', { name: 'GitHub' }))

    assert.ok(screen.getByRole('option', { name: 'No signed-in accounts' }))
    assert.equal(screen.queryByText('No signed-in GitHub accounts'), null)
    assert.ok(screen.getByText('Sign in to a GitHub account to view its inbox'))
    assert.equal(
      screen.queryByRole('button', { name: 'Notification history' }),
      null
    )
    assert.equal(screen.queryByRole('button', { name: 'Clear all' }), null)

    fireEvent.click(screen.getByRole('tab', { name: 'Local' }))
    assert.equal(
      screen
        .getByRole('tab', { name: 'Unread (1)' })
        .getAttribute('aria-selected'),
      'true'
    )
    assert.ok(screen.getByText('Local notification'))
  })

  it('loads bounded pages across accounts and supports exact read and done actions', async () => {
    const first = account('first', 1)
    const second = account('second', 2)
    const thirdParty = account('third-party', 3, 'gitlab')
    const fetches = new Array<{
      login: string
      options: IAPINotificationsOptions
    }>()
    const reads = new Array<string>()
    const dones = new Array<string>()
    const apiFactory = (selected: Account): IGitHubNotificationsAPI => ({
      fetchNotifications: async options => {
        fetches.push({ login: selected.login, options })
        return page(
          [
            notification(
              `${selected.login}-${options.page}`,
              true,
              `A very long notification title ${selected.login}-${
                options.page
              } ${'without-spaces-'.repeat(12)}`
            ),
          ],
          { hasNextPage: options.page === 1 }
        )
      },
      markNotificationThreadRead: async id => {
        reads.push(id)
      },
      markNotificationThreadDone: async id => {
        dones.push(id)
      },
    })
    const store = new GitHubNotificationsStore(
      [first, second, thirdParty],
      apiFactory
    )

    render(
      <NotificationCentrePanel
        dispatcher={dispatcher}
        entries={[]}
        unreadCount={0}
        repositories={[]}
        accounts={[first, second, thirdParty]}
        githubNotificationsStore={store}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'GitHub' }))
    await waitFor(() =>
      assert.ok(screen.getByText(/A very long notification title/))
    )

    const accountSelect = screen.getByRole('combobox', {
      name: 'GitHub notification account',
    })
    assert.deepEqual(
      within(accountSelect)
        .getAllByRole('option')
        .map(option => option.textContent),
      ['first · GitHub.com', 'second · GitHub.com']
    )
    assert.equal(document.body.textContent?.includes('secret-token'), false)
    assert.equal(fetches[0].options.perPage, 50)
    assert.equal(fetches[0].options.includeRead, false)

    fireEvent.change(accountSelect, {
      target: { value: `${second.endpoint}#2` },
    })
    await waitFor(() => assert.equal(fetches.at(-1)?.login, 'second'))

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Participating only' })
    )
    await waitFor(() =>
      assert.equal(fetches.at(-1)?.options.participating, true)
    )

    const unreadTab = screen.getByRole('tab', { name: /Unread/ })
    unreadTab.focus()
    fireEvent.keyDown(unreadTab, { key: 'Home' })
    await waitFor(() => assert.equal(fetches.at(-1)?.options.includeRead, true))
    assert.equal(
      document.activeElement,
      screen.getByRole('tab', { name: 'All' })
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => assert.equal(fetches.at(-1)?.options.page, 2))
    assert.ok(screen.getByText(/second-2/))

    const markRead = screen.getByRole('button', {
      name: /Mark as read:.*second-1/,
    })
    fireEvent.click(markRead)
    await waitFor(() => assert.deepEqual(reads, ['second-1']))
    await waitFor(() =>
      assert.equal(
        screen.queryByRole('button', { name: /Mark as read:.*second-1/ }),
        null
      )
    )

    const done = screen.getAllByRole('button', { name: /Mark as done:/ })[0]
    done.focus()
    fireEvent.click(done)
    const confirmation = screen.getByRole('alertdialog', {
      name: 'Mark notification done?',
    })
    assert.ok(within(confirmation).getByText(/selected GitHub inbox/))
    assert.equal(
      document.activeElement,
      within(confirmation).getByRole('button', { name: 'Mark done' })
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    assert.equal(screen.queryByRole('alertdialog'), null)
    assert.equal(document.activeElement, done)

    fireEvent.click(done)
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }))
    await waitFor(() => assert.deepEqual(dones, ['second-1']))
    await waitFor(() => assert.equal(screen.queryByText(/second-1/), null))
    assert.equal(
      document.activeElement,
      screen.getByRole('tab', { name: 'GitHub' })
    )
  })

  it('announces loading and renders actionable permission failures', async () => {
    const selected = account('first', 1)
    let rejectFetch!: (error: unknown) => void
    const pending = new Promise<IAPINotificationsPage>((_resolve, reject) => {
      rejectFetch = reject
    })
    const api: IGitHubNotificationsAPI = {
      fetchNotifications: () => pending,
      markNotificationThreadRead: async () => {},
      markNotificationThreadDone: async () => {},
    }
    const store = new GitHubNotificationsStore([selected], () => api)

    render(
      <NotificationCentrePanel
        dispatcher={dispatcher}
        entries={[]}
        unreadCount={0}
        repositories={[]}
        accounts={[selected]}
        githubNotificationsStore={store}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'GitHub' }))
    assert.equal(
      screen.getByRole('status').textContent,
      'Loading GitHub notifications…'
    )

    rejectFetch(
      new APIError(new Response(null, { status: 403 }), {
        message: 'forbidden',
      })
    )
    await waitFor(() =>
      assert.ok(
        screen.getByRole('alert').textContent?.includes('classic user token')
      )
    )
    assert.ok(screen.getByRole('button', { name: 'Try again' }))
  })
})
