import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { Account } from '../../src/models/account'
import { AccountsStore } from '../../src/lib/stores'
import { getKeyForAccount } from '../../src/lib/auth'
import { InMemoryStore, AsyncInMemoryStore } from '../helpers/stores'

describe('AccountsStore', () => {
  let accountsStore: AccountsStore

  beforeEach(() => {
    accountsStore = new AccountsStore(
      new InMemoryStore(),
      new AsyncInMemoryStore()
    )
  })

  describe('adding a new user', () => {
    it('contains the added user', async () => {
      const newAccountLogin = 'joan'
      await accountsStore.addAccount(
        new Account(newAccountLogin, '', 'deadbeef', [], '', 1, '', 'free')
      )

      const users = await accountsStore.getAll()
      assert.equal(users[0].login, newAccountLogin)
    })

    it('keeps multiple users on the same endpoint', async () => {
      const endpoint = 'https://api.github.com'
      await accountsStore.addAccount(
        new Account('joan', endpoint, 'token-one', [], '', 1, '', 'free')
      )
      await accountsStore.addAccount(
        new Account('joel', endpoint, 'token-two', [], '', 2, '', 'free')
      )

      const users = await accountsStore.getAll()
      assert.equal(users.length, 2)
      assert.deepStrictEqual(
        users.map(x => x.login),
        ['joan', 'joel']
      )
    })

    it('updates the same identity without replacing sibling accounts', async () => {
      const endpoint = 'https://api.github.com'
      await accountsStore.addAccount(
        new Account('old-login', endpoint, 'old-token', [], '', 1, '', 'free')
      )
      await accountsStore.addAccount(
        new Account('sibling', endpoint, 'token-two', [], '', 2, '', 'free')
      )
      await accountsStore.addAccount(
        new Account('new-login', endpoint, 'new-token', [], '', 1, '', 'free')
      )

      const users = await accountsStore.getAll()
      assert.equal(users.length, 2)
      assert.equal(users.find(x => x.id === 1)?.login, 'new-login')
      assert.equal(users.find(x => x.id === 1)?.token, 'new-token')
      assert.equal(users.find(x => x.id === 2)?.login, 'sibling')
    })

    it('persists provider metadata without writing tokens to the data store', async () => {
      const dataStore = new InMemoryStore()
      const secureStore = new AsyncInMemoryStore()
      accountsStore = new AccountsStore(dataStore, secureStore)
      const account = new Account(
        'fox',
        'https://gitlab.example.com/api/v4',
        'secret-provider-token',
        [],
        '',
        42,
        'Fox',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'gitlab'
      )

      await accountsStore.addAccount(account)

      const persisted = dataStore.getItem('users')
      assert.match(persisted, /"provider":"gitlab"/)
      assert.doesNotMatch(persisted, /secret-provider-token/)
      const reloaded = new AccountsStore(dataStore, secureStore)
      const [result] = await reloaded.getAll()
      assert.equal(result.provider, 'gitlab')
      assert.equal(result.token, 'secret-provider-token')
    })
  })

  describe('loading persisted users', () => {
    it('recovers when account metadata cannot be read', async () => {
      const dataStore = {
        getItem: () => {
          throw new Error('simulated read failure')
        },
        setItem: () => {},
      }
      accountsStore = new AccountsStore(dataStore, new AsyncInMemoryStore())
      const error = new Promise<Error>(resolve =>
        accountsStore.onDidError(resolve)
      )

      assert.deepStrictEqual(await accountsStore.getAll(), [])
      assert.match(
        (await error).message,
        /could not read saved account metadata/
      )
    })

    it('repairs malformed account JSON without rejecting initialization', async () => {
      const dataStore = new InMemoryStore()
      dataStore.setItem('users', '{"token":"must-not-leak"')
      accountsStore = new AccountsStore(dataStore, new AsyncInMemoryStore())
      const error = new Promise<Error>(resolve =>
        accountsStore.onDidError(resolve)
      )

      assert.deepStrictEqual(await accountsStore.getAll(), [])
      assert.equal(dataStore.getItem('users'), '[]')
      assert.doesNotMatch((await error).message, /must-not-leak/)
    })

    it('repairs a non-array account payload', async () => {
      const dataStore = new InMemoryStore()
      dataStore.setItem('users', JSON.stringify({ login: 'not-an-array' }))
      accountsStore = new AccountsStore(dataStore, new AsyncInMemoryStore())

      assert.deepStrictEqual(await accountsStore.getAll(), [])
      assert.equal(dataStore.getItem('users'), '[]')
    })

    it('keeps valid accounts while removing invalid rows and persisted secrets', async () => {
      const dataStore = new InMemoryStore()
      const secureStore = new AsyncInMemoryStore()
      dataStore.setItem(
        'users',
        JSON.stringify([
          {
            login: 'safe-account',
            endpoint: 'https://api.github.com',
            token: 'persisted-secret',
            emails: [],
            avatarURL: '',
            id: 7,
            name: 'Safe Account',
            plan: 'free',
          },
          {
            login: 'broken-account',
            endpoint: 'not a URL',
            token: 'another-secret',
            emails: [],
            avatarURL: '',
            id: 8,
            name: 'Broken Account',
          },
        ])
      )
      const safeAccount = new Account(
        'safe-account',
        'https://api.github.com',
        '',
        [],
        '',
        7,
        'Safe Account',
        'free'
      )
      await secureStore.setItem(
        getKeyForAccount(safeAccount),
        safeAccount.login,
        'secure-token'
      )
      accountsStore = new AccountsStore(dataStore, secureStore)

      const users = await accountsStore.getAll()
      assert.equal(users.length, 1)
      assert.equal(users[0].login, 'safe-account')
      assert.equal(users[0].token, 'secure-token')
      const persisted = dataStore.getItem('users')
      assert.doesNotMatch(persisted, /persisted-secret|another-secret/)
      assert.doesNotMatch(persisted, /broken-account/)
    })

    it('keeps an account available when metadata persistence fails', async () => {
      const dataStore = {
        getItem: () => null,
        setItem: () => {
          throw new Error('simulated write failure')
        },
      }
      accountsStore = new AccountsStore(dataStore, new AsyncInMemoryStore())
      await accountsStore.getAll()
      const error = new Promise<Error>(resolve =>
        accountsStore.onDidError(resolve)
      )

      const account = new Account(
        'still-in-memory',
        'https://api.github.com',
        'secure-token',
        [],
        '',
        11,
        'Still In Memory',
        'free'
      )
      assert.equal(await accountsStore.addAccount(account), account)
      assert.equal((await accountsStore.getAll())[0], account)
      assert.match((await error).message, /could not save account metadata/)
    })

    it('reloads account changes written by another window', async () => {
      const dataStore = new InMemoryStore()
      const secureStore = new AsyncInMemoryStore()
      const firstWindow = new AccountsStore(dataStore, secureStore)
      const secondWindow = new AccountsStore(dataStore, secureStore)
      assert.equal((await secondWindow.getAll()).length, 0)

      const account = new Account(
        'shared',
        'https://api.github.com',
        'shared-token',
        [],
        '',
        99,
        'Shared',
        'free'
      )
      await firstWindow.addAccount(account)
      await secondWindow.reloadFromStore()

      assert.equal((await secondWindow.getAll())[0].login, 'shared')
      assert.equal((await secondWindow.getAll())[0].token, 'shared-token')

      await firstWindow.removeAccount(account)
      await secondWindow.reloadFromStore()
      assert.equal((await secondWindow.getAll()).length, 0)
    })

    it('migrates .ghe.com users still using /api/v3 to api. subdomain', async () => {
      const dataStore = new InMemoryStore()
      dataStore.setItem(
        'users',
        JSON.stringify([
          {
            login: 'joan',
            endpoint: 'https://whatever.ghe.com/api/v3',
            token: 'deadbeef',
            emails: [],
            avatarURL: '',
            id: 1,
            name: '',
            plan: 'free',
          },
        ])
      )
      accountsStore = new AccountsStore(dataStore, new AsyncInMemoryStore())

      const users = await accountsStore.getAll()
      assert.equal(users[0].login, 'joan')
      assert.equal(users[0].endpoint, 'https://api.whatever.ghe.com/')

      const persistedUsers = JSON.parse(dataStore.getItem('users'))
      assert.equal(persistedUsers[0].login, 'joan')
      assert.equal(persistedUsers[0].endpoint, 'https://api.whatever.ghe.com/')
    })

    it('does NOT migrate GHE users already using the api. subdomain', async () => {
      const dataStore = new InMemoryStore()
      dataStore.setItem(
        'users',
        JSON.stringify([
          {
            login: 'joan',
            endpoint: 'https://api.whatever.ghe.com/',
            token: 'deadbeef',
            emails: [],
            avatarURL: '',
            id: 1,
            name: '',
            plan: 'free',
          },
        ])
      )
      accountsStore = new AccountsStore(dataStore, new AsyncInMemoryStore())

      const users = await accountsStore.getAll()
      assert.equal(users[0].login, 'joan')
      assert.equal(users[0].endpoint, 'https://api.whatever.ghe.com/')

      const persistedUsers = JSON.parse(dataStore.getItem('users'))
      assert.equal(persistedUsers[0].login, 'joan')
      assert.equal(persistedUsers[0].endpoint, 'https://api.whatever.ghe.com/')
    })

    it('does NOT migrate GHES users still using /api/v3 to api. subdomain', async () => {
      const dataStore = new InMemoryStore()
      dataStore.setItem(
        'users',
        JSON.stringify([
          {
            login: 'joan',
            endpoint: 'https://my-company-repos.com/api/v3',
            token: 'deadbeef',
            emails: [],
            avatarURL: '',
            id: 1,
            name: '',
            plan: 'free',
          },
        ])
      )
      accountsStore = new AccountsStore(dataStore, new AsyncInMemoryStore())

      const users = await accountsStore.getAll()
      assert.equal(users[0].login, 'joan')
      assert.equal(users[0].endpoint, 'https://my-company-repos.com/api/v3')

      const persistedUsers = JSON.parse(dataStore.getItem('users'))
      assert.equal(persistedUsers[0].login, 'joan')
      assert.equal(
        persistedUsers[0].endpoint,
        'https://my-company-repos.com/api/v3'
      )
    })
  })
})
