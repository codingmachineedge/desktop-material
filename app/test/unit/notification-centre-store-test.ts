import { describe, it } from 'node:test'
import assert from 'node:assert'

import { NotificationCentreStore } from '../../src/lib/stores/notification-centre-store'
import {
  INotificationEntry,
  shapeNotificationEntry,
} from '../../src/models/notification-centre'

interface IStoreHarness {
  enabled: boolean
  entries: ReadonlyArray<INotificationEntry>
  initialize: () => Promise<void>
  persist: (description: string) => Promise<void>
}

const entry = (id: string, read: boolean): INotificationEntry => ({
  ...shapeNotificationEntry(
    { kind: 'info', title: `Notification ${id}`, body: `Body ${id}` },
    id,
    new Date('2026-07-16T12:00:00.000Z')
  ),
  read,
})

const createHarness = (entries: ReadonlyArray<INotificationEntry>) => {
  const store = new NotificationCentreStore()
  const harness = store as unknown as IStoreHarness
  const descriptions = new Array<string>()

  harness.enabled = true
  harness.entries = entries
  harness.initialize = async () => {}
  harness.persist = async description => {
    descriptions.push(description)
  }

  return { store, harness, descriptions }
}

describe('NotificationCentreStore bulk mutations', () => {
  it('sets many read states and persists the whole action exactly once', async () => {
    const { store, harness, descriptions } = createHarness([
      entry('a', false),
      entry('b', true),
      entry('c', false),
    ])

    await store.setReadMany(new Set(['a', 'b', 'missing']), true)

    assert.deepEqual(
      harness.entries.map(value => value.read),
      [true, true, false]
    )
    assert.deepEqual(descriptions, ['Mark 1 notification read'])

    await store.setReadMany(['a', 'b'], true)
    assert.deepEqual(descriptions, ['Mark 1 notification read'])
  })

  it('deletes many entries and persists the whole action exactly once', async () => {
    const { store, harness, descriptions } = createHarness([
      entry('a', false),
      entry('b', true),
      entry('c', false),
    ])

    await store.deleteMany(['a', 'a', 'c', 'missing'])

    assert.deepEqual(
      harness.entries.map(value => value.id),
      ['b']
    )
    assert.deepEqual(descriptions, ['Delete 2 notifications'])

    await store.deleteMany(new Set(['missing']))
    assert.deepEqual(descriptions, ['Delete 2 notifications'])
  })
})
