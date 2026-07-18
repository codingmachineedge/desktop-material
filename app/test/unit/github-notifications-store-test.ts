import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  IAPINotificationThread,
  IAPINotificationsOptions,
  IAPINotificationsPage,
} from '../../src/lib/api'
import { APIError } from '../../src/lib/http'
import {
  GitHubNotificationsClearConcurrency,
  GitHubNotificationsStore,
  IGitHubNotificationsAPI,
  githubNotificationsError,
} from '../../src/lib/stores/github-notifications-store'
import { Account, getAccountKey } from '../../src/models/account'

const account = (
  login: string,
  id: number,
  provider: 'github' | 'gitlab' = 'github',
  token: string = `${login}-token`
) =>
  new Account(
    login,
    provider === 'github'
      ? 'https://api.github.com'
      : 'https://gitlab.example.test/api/v4',
    token,
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
  unread: boolean = true
): IAPINotificationThread => ({
  id,
  repository: {
    id: 1,
    name: 'repository',
    full_name: 'owner/repository',
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
    title: `Notification ${id}`,
    url: `https://api.github.com/repos/owner/repository/issues/${id}`,
    latest_comment_url: null,
    type: 'Issue',
  },
  reason: 'mention',
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

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const inertMutations = {
  markNotificationThreadRead: async () => {},
  markNotificationThreadDone: async () => {},
}

describe('GitHubNotificationsStore', () => {
  it('keeps same-endpoint accounts distinct and applies inbox filters', async () => {
    const first = account('first', 1)
    const second = account('second', 2)
    const gitlab = account('third-party', 3, 'gitlab')
    const fetches = new Array<{
      login: string
      options: IAPINotificationsOptions
    }>()
    const store = new GitHubNotificationsStore(
      [first, second, gitlab],
      selected => ({
        fetchNotifications: async options => {
          fetches.push({ login: selected.login, options })
          return page([notification(`${selected.id}`)])
        },
        ...inertMutations,
      })
    )

    await store.start()
    await store.setFilter('all')
    await store.setParticipating(true)
    await store.selectAccount(getAccountKey(second))

    assert.deepEqual(
      fetches.map(fetch => fetch.login),
      ['first', 'first', 'first', 'second']
    )
    assert.equal(fetches.at(-1)?.options.includeRead, true)
    assert.equal(fetches.at(-1)?.options.participating, true)
    assert.equal(store.getState().selectedAccountKey, getAccountKey(second))
    assert.deepEqual(
      store.getState().notifications.map(item => item.id),
      ['2']
    )
    store.dispose()
  })

  it('aborts and suppresses stale results when the account changes', async () => {
    const first = account('first', 1)
    const second = account('second', 2)
    const pending = deferred<IAPINotificationsPage>()
    let firstSignal: AbortSignal | undefined
    const store = new GitHubNotificationsStore([first, second], selected => ({
      fetchNotifications: options => {
        if (selected.id === first.id) {
          firstSignal = options.signal
          return pending.promise
        }
        return Promise.resolve(page([notification('second')]))
      },
      ...inertMutations,
    }))

    const starting = store.start()
    await Promise.resolve()
    await store.selectAccount(getAccountKey(second))
    assert.equal(firstSignal?.aborted, true)

    pending.resolve(page([notification('stale')]))
    await starting
    assert.deepEqual(
      store.getState().notifications.map(item => item.id),
      ['second']
    )
    store.dispose()
  })

  it('loads every page automatically and de-duplicates thread ids without truncation', async () => {
    const calls = new Array<number>()
    const store = new GitHubNotificationsStore([account('first', 1)], () => ({
      fetchNotifications: async options => {
        calls.push(options.page)
        const start = (options.page - 1) * 50
        const items = Array.from({ length: 50 }, (_, index) =>
          notification(String(start + index))
        )
        if (options.page === 2) {
          items[0] = notification('0')
        }
        return page(items, { hasNextPage: options.page < 5 })
      },
      ...inertMutations,
    }))

    await store.start()

    assert.deepEqual(calls, [1, 2, 3, 4, 5])
    assert.equal(store.getState().notifications.length, 249)
    assert.equal(
      new Set(store.getState().notifications.map(item => item.id)).size,
      store.getState().notifications.length
    )
    assert.deepEqual(
      store
        .getState()
        .notifications.slice(0, 3)
        .map(item => item.id),
      ['0', '1', '2']
    )
    assert.deepEqual(
      store
        .getState()
        .notifications.slice(-3)
        .map(item => item.id),
      ['247', '248', '249']
    )
    store.dispose()
  })

  it('clears the complete inbox with bounded concurrency and retains failures in order', async () => {
    const items = Array.from({ length: 11 }, (_, index) =>
      notification(String(index))
    )
    const calls = new Array<string>()
    let active = 0
    let maximumActive = 0
    const store = new GitHubNotificationsStore([account('first', 1)], () => ({
      fetchNotifications: async () => page(items),
      markNotificationThreadRead: async () => {},
      markNotificationThreadDone: async id => {
        calls.push(id)
        active++
        maximumActive = Math.max(maximumActive, active)
        await new Promise<void>(resolve => setImmediate(resolve))
        active--
        if (id === '3' || id === '8') {
          throw new Error('fixture failure')
        }
      },
    }))

    await store.start()
    const result = await store.markAllThreadsDone()

    assert.equal(result.attempted, 11)
    assert.equal(result.cleared, 9)
    assert.deepEqual(result.failedIds, ['3', '8'])
    assert.equal(result.canceled, false)
    assert.equal(new Set(calls).size, 11)
    assert(maximumActive > 1)
    assert(maximumActive <= GitHubNotificationsClearConcurrency)
    assert.deepEqual(
      store.getState().notifications.map(item => item.id),
      ['3', '8']
    )
    assert.match(
      store.getState().error?.message ?? '',
      /2 GitHub notifications/
    )
    assert.equal(store.getState().clearingAll, false)
    store.dispose()
  })

  it('aborts a clear-all operation when the account context changes', async () => {
    const first = account('first', 1)
    const second = account('second', 2)
    const signals = new Array<AbortSignal>()
    const store = new GitHubNotificationsStore([first, second], selected => ({
      fetchNotifications: async () =>
        page(
          selected.id === first.id
            ? Array.from({ length: 8 }, (_, index) =>
                notification(`first-${index}`)
              )
            : [notification('second')]
        ),
      markNotificationThreadRead: async () => {},
      markNotificationThreadDone: async (_id, signal) => {
        if (selected.id !== first.id || signal === undefined) {
          return
        }
        signals.push(signal)
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          )
        })
      },
    }))

    await store.start()
    const clearing = store.markAllThreadsDone()
    for (
      let attempt = 0;
      attempt < 10 && signals.length < GitHubNotificationsClearConcurrency;
      attempt++
    ) {
      await Promise.resolve()
    }
    assert.equal(signals.length, GitHubNotificationsClearConcurrency)

    await store.selectAccount(getAccountKey(second))
    const result = await clearing

    assert.equal(result.canceled, true)
    assert(signals.every(signal => signal.aborted))
    assert.deepEqual(
      store.getState().notifications.map(item => item.id),
      ['second']
    )
    assert.equal(store.getState().clearingAll, false)
    store.dispose()
  })

  it('retains cached threads on 304 and obeys the server poll interval', async () => {
    let current = new Date('2026-07-12T12:00:00Z')
    let calls = 0
    const store = new GitHubNotificationsStore(
      [account('first', 1)],
      () => ({
        fetchNotifications: async () => {
          calls++
          return calls === 1
            ? page([notification('cached')], { pollIntervalSeconds: 60 })
            : page([], {
                notModified: true,
                lastModified: null,
                pollIntervalSeconds: 90,
              })
        },
        ...inertMutations,
      }),
      () => current
    )

    await store.start()
    await store.refresh()
    assert.equal(calls, 1)

    current = new Date('2026-07-12T12:01:01Z')
    await store.refresh()
    assert.equal(calls, 2)
    assert.deepEqual(
      store.getState().notifications.map(item => item.id),
      ['cached']
    )
    assert.equal(
      store.getState().nextRefreshAt?.toISOString(),
      '2026-07-12T12:02:31.000Z'
    )
    store.dispose()
  })

  it('updates only the exact thread after read and done mutations', async () => {
    const read = new Array<string>()
    const done = new Array<string>()
    const store = new GitHubNotificationsStore([account('first', 1)], () => ({
      fetchNotifications: async () =>
        page([notification('read-me'), notification('done-me')]),
      markNotificationThreadRead: async id => {
        read.push(id)
      },
      markNotificationThreadDone: async id => {
        done.push(id)
      },
    }))

    await store.start()
    assert.equal(await store.markThreadRead('read-me'), true)
    assert.equal(await store.markThreadDone('done-me'), true)

    assert.deepEqual(read, ['read-me'])
    assert.deepEqual(done, ['done-me'])
    assert.equal(
      store.getState().notifications.find(item => item.id === 'read-me')
        ?.unread,
      false
    )
    assert.equal(
      store.getState().notifications.some(item => item.id === 'done-me'),
      false
    )
    store.dispose()
  })

  it('aborts pending mutations when the panel source stops', async () => {
    const pending = deferred<void>()
    let signal: AbortSignal | undefined
    const store = new GitHubNotificationsStore([account('first', 1)], () => ({
      fetchNotifications: async () => page([notification('pending')]),
      markNotificationThreadRead: async (_id, valueSignal) => {
        signal = valueSignal
        await pending.promise
      },
      markNotificationThreadDone: async () => {},
    }))

    await store.start()
    const mutation = store.markThreadRead('pending')
    await Promise.resolve()
    store.stop()
    assert.equal(signal?.aborted, true)
    pending.resolve()
    assert.equal(await mutation, false)
    store.dispose()
  })

  it('distinguishes rate-limit and permission failures', async () => {
    const resetSeconds = Math.floor(
      new Date('2026-07-12T13:00:00Z').getTime() / 1000
    )
    const limited = new APIError(
      new Response(JSON.stringify({ message: 'rate limited' }), {
        status: 403,
        headers: { 'X-RateLimit-Reset': String(resetSeconds) },
      }),
      { message: 'rate limited' }
    )
    const denied = new APIError(
      new Response(JSON.stringify({ message: 'forbidden' }), { status: 403 }),
      { message: 'forbidden' }
    )
    const api: IGitHubNotificationsAPI = {
      fetchNotifications: async () => {
        throw limited
      },
      ...inertMutations,
    }
    const store = new GitHubNotificationsStore([account('first', 1)], () => api)

    await store.start()
    assert.equal(store.getState().error?.kind, 'rate-limit')
    assert.equal(githubNotificationsError(denied).kind, 'permission')
    store.dispose()
  })
})
