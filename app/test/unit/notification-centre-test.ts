import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  countUnread,
  insertNotification,
  parseNotificationLog,
  serializeNotificationLog,
  shapeNotificationEntry,
  NotificationCentreCap,
  NotificationDedupeWindowMs,
  INotificationEntry,
  INotificationInput,
} from '../../src/models/notification-centre'

const baseInput: INotificationInput = {
  kind: 'auto-commit',
  title: 'Auto commit',
  body: 'Committed 3 files',
}

describe('notification-centre model', () => {
  describe('shapeNotificationEntry', () => {
    it('creates an unread ISO-timestamped entry from an input', () => {
      const now = new Date('2026-07-11T10:00:00.000Z')
      const entry = shapeNotificationEntry(baseInput, 'id-1', now)

      assert.equal(entry.id, 'id-1')
      assert.equal(entry.kind, 'auto-commit')
      assert.equal(entry.title, 'Auto commit')
      assert.equal(entry.body, 'Committed 3 files')
      assert.equal(entry.read, false)
      assert.equal(entry.createdAt, '2026-07-11T10:00:00.000Z')
    })

    it('only serializes optional fields that were supplied', () => {
      const entry = shapeNotificationEntry(baseInput, 'id-1', new Date())
      assert.equal('accountKey' in entry, false)
      assert.equal('repositoryId' in entry, false)
      assert.equal('action' in entry, false)

      const withOptional = shapeNotificationEntry(
        {
          ...baseInput,
          accountKey: 'https://api.github.com#1',
          repositoryId: 42,
          action: { kind: 'open-repository', repositoryId: 42 },
        },
        'id-2',
        new Date()
      )
      assert.equal(withOptional.accountKey, 'https://api.github.com#1')
      assert.equal(withOptional.repositoryId, 42)
      assert.deepEqual(withOptional.action, {
        kind: 'open-repository',
        repositoryId: 42,
      })
    })
  })

  describe('insertNotification', () => {
    it('prepends new entries newest-first', () => {
      const now = new Date('2026-07-11T10:00:00.000Z')
      const first = insertNotification([], baseInput, 'a', now)
      const second = insertNotification(
        first.entries,
        { ...baseInput, title: 'Second', body: 'other' },
        'b',
        new Date('2026-07-11T10:00:30.000Z')
      )

      assert.equal(second.deduped, false)
      assert.deepEqual(
        second.entries.map(e => e.id),
        ['b', 'a']
      )
    })

    it('coalesces an identical notification inside the dedupe window', () => {
      const t0 = new Date('2026-07-11T10:00:00.000Z')
      const first = insertNotification([], baseInput, 'a', t0)

      const t1 = new Date(t0.getTime() + NotificationDedupeWindowMs - 1)
      const second = insertNotification(first.entries, baseInput, 'b', t1)

      assert.equal(second.deduped, true)
      assert.equal(second.entries.length, 1)
      // The coalesced entry keeps the original id but bumps the timestamp.
      assert.equal(second.entries[0].id, 'a')
      assert.equal(second.entries[0].createdAt, t1.toISOString())
      assert.equal(second.entry.id, 'a')
    })

    it('re-marks a coalesced entry as unread', () => {
      const t0 = new Date('2026-07-11T10:00:00.000Z')
      const first = insertNotification([], baseInput, 'a', t0)
      const read = {
        ...first,
        entries: first.entries.map(e => ({ ...e, read: true })),
      }

      const t1 = new Date(t0.getTime() + 1000)
      const second = insertNotification(read.entries, baseInput, 'b', t1)
      assert.equal(second.entries[0].read, false)
    })

    it('does not coalesce once the dedupe window has elapsed', () => {
      const t0 = new Date('2026-07-11T10:00:00.000Z')
      const first = insertNotification([], baseInput, 'a', t0)

      const t1 = new Date(t0.getTime() + NotificationDedupeWindowMs)
      const second = insertNotification(first.entries, baseInput, 'b', t1)
      assert.equal(second.deduped, false)
      assert.equal(second.entries.length, 2)
    })

    it('only coalesces when kind, title and body all match', () => {
      const t0 = new Date('2026-07-11T10:00:00.000Z')
      const first = insertNotification([], baseInput, 'a', t0)
      const differentBody = insertNotification(
        first.entries,
        { ...baseInput, body: 'Committed 4 files' },
        'b',
        new Date(t0.getTime() + 1000)
      )
      assert.equal(differentBody.deduped, false)
      assert.equal(differentBody.entries.length, 2)
    })

    it('prunes oldest entries beyond the retention cap', () => {
      let entries: ReadonlyArray<INotificationEntry> = []
      const total = NotificationCentreCap + 5
      for (let i = 0; i < total; i++) {
        // Unique titles and spaced timestamps so nothing coalesces.
        const result = insertNotification(
          entries,
          { ...baseInput, title: `n-${i}` },
          `id-${i}`,
          new Date(2_000_000_000_000 + i * NotificationDedupeWindowMs)
        )
        entries = result.entries
      }

      assert.equal(entries.length, NotificationCentreCap)
      // Newest first: the most recent insert is at the head.
      assert.equal(entries[0].title, `n-${total - 1}`)
      // The five oldest were pruned.
      assert.equal(
        entries.some(e => e.title === 'n-0'),
        false
      )
    })

    it('reports the number of pruned entries', () => {
      let entries: ReadonlyArray<INotificationEntry> = []
      for (let i = 0; i < NotificationCentreCap; i++) {
        entries = insertNotification(
          entries,
          { ...baseInput, title: `n-${i}` },
          `id-${i}`,
          new Date(2_000_000_000_000 + i * NotificationDedupeWindowMs)
        ).entries
      }

      const overflow = insertNotification(
        entries,
        { ...baseInput, title: 'overflow' },
        'overflow',
        new Date(3_000_000_000_000)
      )
      assert.equal(overflow.pruned, 1)
      assert.equal(overflow.entries.length, NotificationCentreCap)
    })
  })

  describe('countUnread', () => {
    it('counts only unread entries', () => {
      const entries: ReadonlyArray<INotificationEntry> = [
        shapeNotificationEntry(baseInput, 'a', new Date()),
        { ...shapeNotificationEntry(baseInput, 'b', new Date()), read: true },
        shapeNotificationEntry(baseInput, 'c', new Date()),
      ]
      assert.equal(countUnread(entries), 2)
    })
  })

  describe('serialize / parse round trip', () => {
    it('round-trips a valid log', () => {
      const entries: ReadonlyArray<INotificationEntry> = [
        shapeNotificationEntry(
          {
            ...baseInput,
            action: { kind: 'open-url', url: 'https://example.com' },
          },
          'a',
          new Date('2026-07-11T10:00:00.000Z')
        ),
      ]
      const serialized = serializeNotificationLog(entries)
      const parsed = parseNotificationLog(serialized)
      assert.notEqual(parsed, null)
      assert.deepEqual(parsed?.entries, entries)
    })

    it('returns null for invalid JSON', () => {
      assert.equal(parseNotificationLog('{not json'), null)
    })

    it('returns null for an unsupported version', () => {
      assert.equal(
        parseNotificationLog(JSON.stringify({ version: 2, entries: [] })),
        null
      )
    })

    it('returns null when entries is not an array', () => {
      assert.equal(
        parseNotificationLog(JSON.stringify({ version: 1, entries: {} })),
        null
      )
    })

    it('returns null when any entry is structurally invalid', () => {
      const raw = JSON.stringify({
        version: 1,
        entries: [{ id: 'a', kind: 'not-a-kind', title: 't', body: 'b' }],
      })
      assert.equal(parseNotificationLog(raw), null)
    })

    it('drops an unknown action rather than rejecting the whole log', () => {
      const raw = JSON.stringify({
        version: 1,
        entries: [
          {
            id: 'a',
            kind: 'info',
            title: 't',
            body: 'b',
            createdAt: '2026-07-11T10:00:00.000Z',
            read: false,
            action: { kind: 'bogus' },
          },
        ],
      })
      const parsed = parseNotificationLog(raw)
      assert.notEqual(parsed, null)
      assert.equal('action' in (parsed?.entries[0] ?? {}), false)
    })
  })
})
