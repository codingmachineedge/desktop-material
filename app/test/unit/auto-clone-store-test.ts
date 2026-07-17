import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import { Account, getAccountKey } from '../../src/models/account'
import { IAPIRepository } from '../../src/lib/api'
import {
  AutoCloneStore,
  IAutoClonePolicy,
  MaxAutoClonePolicies,
  MaxAutoClonePolicyFileCharacters,
  MaxAutoCloneSeenUrls,
  getAutoClonePolicy,
  loadAutoClonePolicies,
} from '../../src/lib/stores/auto-clone-store'
import { IAccountRepositories } from '../../src/lib/stores/api-repositories-store'
import { BatchCloneMode, IBatchCloneInput } from '../../src/models/batch-clone'

class MemoryStorage {
  public value: string | null
  public constructor(value: string | null = null) {
    this.value = value
  }
  public getItem() {
    return this.value
  }
  public setItem(_key: string, value: string) {
    this.value = value
  }
}

function makeAccount(login = 'owner', id = 1): Account {
  return new Account(
    login,
    'https://api.github.com',
    'token',
    [],
    '',
    id,
    login,
    'free'
  )
}

function repository(name: string): IAPIRepository {
  return {
    id: name.length,
    name,
    full_name: `owner/${name}`,
    clone_url: `https://github.com/owner/${name}.git`,
    html_url: `https://github.com/owner/${name}`,
    default_branch: 'main',
    private: false,
    fork: false,
    archived: false,
    owner: { id: 1, login: 'owner', type: 'User' },
  } as unknown as IAPIRepository
}

function accountState(
  repositories: ReadonlyArray<IAPIRepository>
): IAccountRepositories {
  return {
    repositories,
    loading: false,
    error: null,
    organizations: [],
    organizationsLoading: false,
    organizationRepositories: new Map(),
  }
}

describe('AutoCloneStore', () => {
  it('baselines existing repositories and launches only later discoveries', async () => {
    const account = makeAccount()
    const existing = repository('existing')
    const discovered = repository('discovered')
    let state = accountState([existing])
    const batches: ReadonlyArray<IBatchCloneInput>[] = []
    const storage = new MemoryStorage()
    const store = new AutoCloneStore(
      {
        getAccounts: () => [account],
        getApiRepositories: () => new Map([[account, state]]),
        isRepositoryTracked: () => false,
        refreshRepositories: async () => {},
        startBackgroundBatch: inputs => {
          batches.push(inputs)
          return true
        },
        notify: () => {},
      },
      storage
    )

    store.configure(
      account,
      Path.resolve('/clones'),
      BatchCloneMode.Sequential,
      true
    )
    await store.evaluateNow()
    assert.equal(batches.length, 0)

    state = accountState([existing, discovered])
    await store.evaluateNow()
    assert.equal(batches.length, 1)
    assert.deepEqual(
      batches[0].map(input => input.url),
      [discovered.clone_url]
    )
    const policies: ReadonlyArray<IAutoClonePolicy> =
      loadAutoClonePolicies(storage)
    assert.ok(policies[0].seenUrls.includes(discovered.clone_url))
  })

  it('returns the complete saved configuration for each account', () => {
    const first = makeAccount('first', 1)
    const second = makeAccount('second', 2)
    const storage = new MemoryStorage()
    const state = accountState([])
    const store = new AutoCloneStore(
      {
        getAccounts: () => [first, second],
        getApiRepositories: () =>
          new Map([
            [first, state],
            [second, state],
          ]),
        isRepositoryTracked: () => false,
        refreshRepositories: async () => {},
        startBackgroundBatch: () => true,
        notify: () => {},
      },
      storage
    )
    const firstPath = Path.resolve('/first-clones')
    const secondPath = Path.resolve('/second-clones')
    store.configure(first, firstPath, BatchCloneMode.Sequential, true)
    store.configure(second, secondPath, BatchCloneMode.Parallel, true)

    assert.deepEqual(getAutoClonePolicy(first, storage), {
      accountKey: getAccountKey(first),
      baseDirectory: firstPath,
      mode: BatchCloneMode.Sequential,
      baselineEstablished: true,
      seenUrls: [],
    })
    assert.equal(getAutoClonePolicy(second, storage)?.baseDirectory, secondPath)
    assert.equal(
      getAutoClonePolicy(second, storage)?.mode,
      BatchCloneMode.Parallel
    )
  })

  it('fails safely when policy storage throws or contains oversized data', () => {
    const notifications: string[] = []
    const throwingReadStorage = {
      getItem: () => {
        throw new Error('read failed')
      },
      setItem: () => {},
    }
    assert.deepEqual(loadAutoClonePolicies(throwingReadStorage), [])

    const throwingWriteStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    const account = makeAccount()
    const store = new AutoCloneStore(
      {
        getAccounts: () => [account],
        getApiRepositories: () => new Map([[account, accountState([])]]),
        isRepositoryTracked: () => false,
        refreshRepositories: async () => {},
        startBackgroundBatch: () => true,
        notify: title => notifications.push(title),
      },
      throwingWriteStorage
    )
    assert.doesNotThrow(() =>
      store.configure(
        account,
        Path.resolve('/clones'),
        BatchCloneMode.Sequential,
        true
      )
    )
    assert.ok(notifications.some(title => /not saved/i.test(title)))

    assert.deepEqual(
      loadAutoClonePolicies(
        new MemoryStorage(' '.repeat(MaxAutoClonePolicyFileCharacters + 1))
      ),
      []
    )
  })

  it('rejects malformed policies and unsafe API repository metadata', async () => {
    const account = makeAccount()
    const validPolicy = {
      accountKey: getAccountKey(account),
      baseDirectory: Path.resolve('/clones'),
      mode: BatchCloneMode.Sequential,
      baselineEstablished: true,
      seenUrls: [],
    }
    const malformed = new MemoryStorage(
      JSON.stringify({
        version: 1,
        policies: [
          {
            accountKey: getAccountKey(account),
            baseDirectory: 'relative',
            mode: BatchCloneMode.Sequential,
            baselineEstablished: true,
            seenUrls: [],
          },
        ],
      })
    )
    assert.deepEqual(loadAutoClonePolicies(malformed), [])
    assert.deepEqual(
      loadAutoClonePolicies(
        new MemoryStorage(
          JSON.stringify({
            version: 1,
            policies: Array.from(
              { length: MaxAutoClonePolicies + 1 },
              (_, index) => ({
                ...validPolicy,
                accountKey: `account-${index}`,
              })
            ),
          })
        )
      ),
      []
    )
    assert.deepEqual(
      loadAutoClonePolicies(
        new MemoryStorage(
          JSON.stringify({
            version: 1,
            policies: [
              {
                ...validPolicy,
                seenUrls: Array.from(
                  { length: MaxAutoCloneSeenUrls + 1 },
                  (_, index) => `https://example.test/${index}.git`
                ),
              },
            ],
          })
        )
      ),
      []
    )

    const existing = repository('existing')
    let state = accountState([existing])
    let starts = 0
    const notifications: string[] = []
    const store = new AutoCloneStore(
      {
        getAccounts: () => [account],
        getApiRepositories: () => new Map([[account, state]]),
        isRepositoryTracked: () => false,
        refreshRepositories: async () => {},
        startBackgroundBatch: () => {
          starts += 1
          return true
        },
        notify: title => notifications.push(title),
      },
      new MemoryStorage()
    )
    store.configure(
      account,
      Path.resolve('/clones'),
      BatchCloneMode.Sequential,
      true
    )
    state = accountState([
      existing,
      {
        ...repository('unsafe'),
        name: 'x'.repeat(1025),
      },
    ])
    await store.evaluateNow()

    assert.equal(starts, 0)
    assert.ok(notifications.some(title => /paused/i.test(title)))
  })

  it('does not run a queued discovery pass after shutdown', async () => {
    const account = makeAccount()
    const existing = repository('existing')
    const discovered = repository('discovered')
    let state = accountState([existing])
    let starts = 0
    const store = new AutoCloneStore(
      {
        getAccounts: () => [account],
        getApiRepositories: () => new Map([[account, state]]),
        isRepositoryTracked: () => false,
        refreshRepositories: async () => {},
        startBackgroundBatch: () => {
          starts += 1
          return true
        },
        notify: () => {},
      },
      new MemoryStorage()
    )
    store.configure(
      account,
      Path.resolve('/clones'),
      BatchCloneMode.Sequential,
      true
    )
    state = accountState([existing, discovered])

    store.start()
    store.stop()
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.equal(starts, 0)
  })

  it('rejects and scrubs credentialed repository URLs without exposing secrets', () => {
    const account = makeAccount()
    const secret = 'super-secret-auto-token'
    const unsafeRepository = {
      ...repository('unsafe'),
      clone_url: `https://x-access-token:${secret}@github.com/owner/unsafe.git`,
    }
    const storage = new MemoryStorage()
    const notices: string[] = []
    const store = new AutoCloneStore(
      {
        getAccounts: () => [account],
        getApiRepositories: () =>
          new Map([[account, accountState([unsafeRepository])]]),
        isRepositoryTracked: () => false,
        refreshRepositories: async () => {},
        startBackgroundBatch: () => {
          assert.fail('credentialed repository must not start a batch')
        },
        notify: (title, body) => notices.push(`${title}\n${body}`),
      },
      storage
    )

    store.configure(
      account,
      Path.resolve('/clones'),
      BatchCloneMode.Sequential,
      true
    )
    assert.equal(storage.value, null)
    assert.ok(notices.some(notice => /not enabled/i.test(notice)))
    assert.ok(notices.every(notice => !notice.includes(secret)))

    storage.value = JSON.stringify({
      version: 1,
      policies: [
        {
          accountKey: getAccountKey(account),
          baseDirectory: Path.resolve('/clones'),
          mode: BatchCloneMode.Sequential,
          baselineEstablished: true,
          seenUrls: [unsafeRepository.clone_url],
        },
      ],
    })
    assert.deepEqual(loadAutoClonePolicies(storage), [])
    assert.ok(storage.value !== null && !storage.value.includes(secret))
  })
})
