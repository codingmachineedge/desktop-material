import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { Account } from '../../src/models/account'
import { AccountsStore } from '../../src/lib/stores'
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
