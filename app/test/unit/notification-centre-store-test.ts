import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it } from 'node:test'
import assert from 'node:assert'

import { NotificationCentreStore } from '../../src/lib/stores/notification-centre-store'
import {
  INotificationEntry,
  parseNotificationLog,
  serializeNotificationLog,
  shapeNotificationEntry,
} from '../../src/models/notification-centre'
import {
  commitAllChanges,
  ensureProfileRepository,
  getProfileCommitFiles,
  getProfileHistory,
} from '../../src/lib/profiles/profile-git'
import { Repository } from '../../src/models/repository'
import { writeCrashSafeText } from '../../src/lib/crash-safe-file'
import { git } from '../../src/lib/git/core'

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

  it('clears the complete retained list in one persisted action', async () => {
    const { store, harness, descriptions } = createHarness([
      entry('newest', false),
      entry('middle', true),
      entry('oldest', false),
    ])

    await store.clearAll()

    assert.deepEqual(harness.entries, [])
    assert.deepEqual(descriptions, ['Clear all notifications'])

    await store.clearAll()
    assert.deepEqual(descriptions, ['Clear all notifications'])
  })
})

describe('NotificationCentreStore crash-safe recovery', () => {
  it('restores a valid backup and commits only the notification file', async t => {
    const directory = await mkdtemp(
      join(tmpdir(), 'desktop-material-notification-recovery-')
    )
    t.after(() => rm(directory, { recursive: true, force: true }))
    const repository = await ensureProfileRepository(directory)
    const path = join(directory, 'notifications.json')
    const backupEntries = [entry('backup', false)]
    const latestEntries = [entry('latest', true)]
    const validate = (raw: string) => parseNotificationLog(raw) !== null

    await writeCrashSafeText(path, serializeNotificationLog(backupEntries), {
      validatePrevious: validate,
    })
    await writeCrashSafeText(path, serializeNotificationLog(latestEntries), {
      validatePrevious: validate,
    })
    await commitAllChanges(repository, 'Initialize notification fixture')
    await writeFile(path, '{"partial":', 'utf8')

    const store = new NotificationCentreStore()
    const harness = store as unknown as {
      entries: ReadonlyArray<INotificationEntry>
      loadOrInitialize(repository: Repository): Promise<void>
    }
    await harness.loadOrInitialize(repository)

    assert.deepEqual(
      harness.entries.map(value => value.id),
      ['backup']
    )
    const history = await getProfileHistory(repository)
    assert.equal(history.total, 2)
    assert.match(history.entries[0].summary, /crash-safe backup/)
    assert.deepEqual(
      await getProfileCommitFiles(repository, history.entries[0].sha),
      ['notifications.json']
    )
    assert.equal(
      (await git(['status', '--porcelain'], directory, 'testStatus')).stdout,
      ''
    )
  })
})
