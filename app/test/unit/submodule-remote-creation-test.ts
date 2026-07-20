import assert from 'node:assert'
import { describe, it, mock } from 'node:test'

import { API, IAPIFullRepository, IAPIOrganization } from '../../src/lib/api'
import { Account } from '../../src/models/account'
import { Dispatcher } from '../../src/ui/dispatcher'

const account = new Account(
  'material-tester',
  'https://api.github.com',
  'synthetic-token',
  [],
  '',
  7,
  'Material Tester'
)

const organization: IAPIOrganization = {
  id: 19,
  login: 'material-org',
  avatar_url: 'https://example.invalid/org.png',
  url: 'https://api.github.com/orgs/material-org',
}

const repository: IAPIFullRepository = {
  clone_url: 'https://github.com/material-org/shared-ui.git',
  ssh_url: 'git@github.com:material-org/shared-ui.git',
  html_url: 'https://github.com/material-org/shared-ui',
  name: 'shared-ui',
  owner: {
    id: organization.id,
    login: organization.login,
    avatar_url: organization.avatar_url,
    html_url: 'https://github.com/material-org',
    type: 'Organization',
  },
  private: true,
  fork: false,
  default_branch: 'main',
  pushed_at: '2026-07-19T12:00:00Z',
  has_issues: true,
  archived: false,
  parent: undefined,
}

describe('Remote repository creation for submodules', () => {
  it('requests an initial commit and returns the host clone URL unchanged', async () => {
    const calls = new Array<ReadonlyArray<unknown>>()
    const controller = new AbortController()
    const fakeAPI = {
      createRepository: async (...args: ReadonlyArray<unknown>) => {
        calls.push(args)
        return repository
      },
    }
    const fromAccount = mock.method(API, 'fromAccount', () => {
      return fakeAPI as unknown as API
    })

    try {
      const dispatcher = Object.create(Dispatcher.prototype) as Dispatcher
      const result = await dispatcher.createRemoteRepositoryForSubmodule(
        account,
        organization,
        'shared-ui',
        ' Shared controls ',
        true,
        controller.signal
      )

      assert.equal(result, repository)
      assert.deepEqual(calls, [
        [
          organization,
          'shared-ui',
          'Shared controls',
          true,
          true,
          controller.signal,
        ],
      ])
    } finally {
      fromAccount.mock.restore()
    }
  })

  it('forwards cancellation to a pending creation request and bounds the uncertain outcome', async () => {
    const api = new API('https://api.github.com', 'synthetic-token')
    let requestSignal: AbortSignal | undefined
    Reflect.set(
      api,
      'ghRequest',
      async (
        _method: string,
        _path: string,
        options?: { readonly signal?: AbortSignal }
      ) => {
        requestSignal = options?.signal
        return await new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener(
            'abort',
            () => {
              const error = new Error('unbounded transport detail')
              error.name = 'AbortError'
              reject(error)
            },
            { once: true }
          )
        })
      }
    )
    const controller = new AbortController()
    const pending = api.createRepository(
      null,
      'shared-ui',
      '',
      true,
      true,
      controller.signal
    )

    assert.equal(requestSignal, controller.signal)
    controller.abort()

    await assert.rejects(pending, error => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /may still have created the repository/i)
      assert.match(error.message, /check it before retrying/i)
      assert.doesNotMatch(error.message, /unbounded transport detail/i)
      assert.ok(error.message.length <= 200)
      return true
    })
  })

  it('rejects invalid metadata and unauthenticated providers before API work', async () => {
    let apiCalls = 0
    const fromAccount = mock.method(API, 'fromAccount', () => {
      apiCalls++
      return {} as API
    })

    try {
      const dispatcher = Object.create(Dispatcher.prototype) as Dispatcher
      await assert.rejects(
        dispatcher.createRemoteRepositoryForSubmodule(
          account,
          null,
          'contains spaces',
          '',
          false
        ),
        /only letters/
      )
      await assert.rejects(
        dispatcher.createRemoteRepositoryForSubmodule(
          new Account(
            'provider-user',
            'https://gitlab.example.com/api/v4',
            'token',
            [],
            '',
            8,
            'Provider User',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            'gitlab'
          ),
          null,
          'shared-ui',
          '',
          false
        ),
        /authenticated GitHub account/
      )
      assert.equal(apiCalls, 0)
    } finally {
      fromAccount.mock.restore()
    }
  })

  it('rejects an unusable clone URL instead of passing it to Git', async () => {
    const fromAccount = mock.method(API, 'fromAccount', () => {
      return {
        createRepository: async () => ({
          ...repository,
          clone_url: 'bad\nurl',
        }),
      } as unknown as API
    })

    try {
      const dispatcher = Object.create(Dispatcher.prototype) as Dispatcher
      await assert.rejects(
        dispatcher.createRemoteRepositoryForSubmodule(
          account,
          null,
          'shared-ui',
          '',
          true
        ),
        /unusable clone URL/
      )
    } finally {
      fromAccount.mock.restore()
    }
  })
})
