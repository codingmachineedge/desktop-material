import assert from 'node:assert'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

import {
  createNamedAPIFunctionBinding,
  NamedAPIFunctionsStorageKey,
} from '../../src/lib/named-api-functions'
import { NamedAPIFunctionsStore } from '../../src/lib/stores/named-api-functions-store'
import { Account, getAccountKey } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { Repository } from '../../src/models/repository'

class MemoryStorage {
  public readonly values = new Map<string, string>()
  public failWrites = false

  public getItem(key: string) {
    return this.values.get(key) ?? null
  }

  public setItem(key: string, value: string) {
    if (this.failWrites) {
      throw new Error('fixture storage failure')
    }
    this.values.set(key, value)
  }

  public removeItem(key: string) {
    this.values.delete(key)
  }
}

function bindingFixture(suffix = 'one') {
  const account = new Account(
    `fixture-${suffix}`,
    'https://api.github.com',
    'never-written',
    [],
    '',
    suffix.length,
    'Fixture',
    'free'
  )
  const repository = new Repository(
    resolve(`named-api-store-${suffix}`),
    suffix.length,
    new GitHubRepository(
      `material-${suffix}`,
      new Owner('desktop', account.endpoint, suffix.length),
      suffix.length
    ),
    false,
    null,
    {},
    false,
    undefined,
    getAccountKey(account)
  )
  return createNamedAPIFunctionBinding(repository, account)
}

function draft(
  binding: ReturnType<typeof bindingFixture>,
  name: string,
  id?: string
) {
  return {
    ...(id === undefined ? {} : { id }),
    name,
    description: `Read patterns for ${name}.`,
    operationId: 'secret-scanning/list-repo-custom-patterns',
    binding,
    request: {
      mode: 'rest' as const,
      method: 'GET' as const,
      path: `repos/desktop/${
        binding.remoteFullName.split('/')[1]
      }/secret-scanning/custom-patterns`,
      bodyText: '',
    },
    now: new Date('2026-07-17T00:00:00.000Z'),
  }
}

describe('NamedAPIFunctionsStore', () => {
  it('adds, updates, removes, and cascades binding-owned functions', () => {
    const storage = new MemoryStorage()
    const store = new NamedAPIFunctionsStore(storage)
    const firstBinding = bindingFixture('one')
    const secondBinding = bindingFixture('two')
    const first = store.upsert(draft(firstBinding, 'list_one'))
    store.upsert(draft(secondBinding, 'list_two'))
    const updated = store.upsert({
      ...draft(firstBinding, 'list_one', first.id),
      description: 'Updated description.',
    })

    assert.equal(updated.id, first.id)
    assert.equal(updated.description, 'Updated description.')
    assert.equal(store.getAll().length, 2)
    assert.equal(store.removeByBinding(firstBinding), 1)
    assert.deepEqual(
      store.getAll().map(value => value.name),
      ['list_two']
    )
    assert.equal(store.remove('missing'), false)
  })

  it('does not mutate storage when validation or the atomic write fails', () => {
    const storage = new MemoryStorage()
    const store = new NamedAPIFunctionsStore(storage)
    const binding = bindingFixture()
    store.upsert(draft(binding, 'list_one'))
    const before = storage.getItem(NamedAPIFunctionsStorageKey)

    assert.throws(
      () => store.upsert(draft(binding, 'List Invalid')),
      /Function names/
    )
    assert.equal(storage.getItem(NamedAPIFunctionsStorageKey), before)

    storage.failWrites = true
    assert.throws(
      () => store.upsert(draft(binding, 'list_two')),
      /fixture storage failure/
    )
    assert.equal(storage.getItem(NamedAPIFunctionsStorageKey), before)
  })

  it('migrates the legacy direct array to the canonical versioned document', () => {
    const storage = new MemoryStorage()
    const store = new NamedAPIFunctionsStore(storage)
    const definition = store.upsert(draft(bindingFixture(), 'list_one'))
    storage.setItem(NamedAPIFunctionsStorageKey, JSON.stringify([definition]))

    store.migrate()
    const migrated = JSON.parse(
      storage.getItem(NamedAPIFunctionsStorageKey) ?? '{}'
    )
    assert.equal(migrated.version, 1)
    assert.equal(migrated.functions[0].name, 'list_one')
  })

  it('publishes restored documents and fails closed on malformed profile state', () => {
    const storage = new MemoryStorage()
    const store = new NamedAPIFunctionsStore(storage)
    const binding = bindingFixture()
    store.upsert(draft(binding, 'list_one'))
    const oneFunction = storage.getItem(NamedAPIFunctionsStorageKey)!
    store.upsert(draft(binding, 'list_two'))
    const twoFunctions = storage.getItem(NamedAPIFunctionsStorageKey)!
    storage.setItem(NamedAPIFunctionsStorageKey, oneFunction)

    const updates: Array<ReadonlyArray<string>> = []
    const errors: Error[] = []
    store.onDidUpdate(functions =>
      updates.push(functions.map(value => value.name))
    )
    store.onDidError(error => errors.push(error))

    storage.setItem(NamedAPIFunctionsStorageKey, twoFunctions)
    assert.deepEqual(
      store.migrate().map(value => value.name),
      ['list_one', 'list_two']
    )
    assert.deepEqual(updates.at(-1), ['list_one', 'list_two'])

    storage.setItem(NamedAPIFunctionsStorageKey, '{malformed')
    assert.throws(() => store.migrate(), /not valid JSON/)
    assert.deepEqual(updates.at(-1), [])
    assert.equal(errors.length, 1)
    assert.equal(storage.getItem(NamedAPIFunctionsStorageKey), '{malformed')
  })
})
