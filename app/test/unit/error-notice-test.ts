import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  ErrorNoticeQueueLimit,
  MaximumErrorNoticeDetailsLength,
  MaximumErrorNoticeMessageLength,
  MaximumErrorNoticeQueueLimit,
  MaximumErrorNoticeTitleLength,
  dismissErrorNotice,
  enqueueErrorNotice,
} from '../../src/models/error-notice'

const idFactory = (...ids: ReadonlyArray<string>) => {
  let index = 0
  return () => ids[index++] ?? `generated-${index}`
}

describe('error notice queue', () => {
  it('bounds content and fills safe copy for blank fields', () => {
    const result = enqueueErrorNotice(
      [],
      {
        title: `  ${'T'.repeat(MaximumErrorNoticeTitleLength + 20)}  `,
        message: `\0${'M'.repeat(MaximumErrorNoticeMessageLength + 20)}`,
        details: `  ${'D'.repeat(MaximumErrorNoticeDetailsLength + 20)}  `,
      },
      { now: () => 10, createId: () => 'bounded' }
    )

    assert.equal(
      Array.from(result.notice.title).length,
      MaximumErrorNoticeTitleLength
    )
    assert.equal(
      Array.from(result.notice.message).length,
      MaximumErrorNoticeMessageLength
    )
    assert.equal(
      Array.from(result.notice.details ?? '').length,
      MaximumErrorNoticeDetailsLength
    )
    assert.equal(result.notice.message.includes('\0'), false)
    assert.equal(result.notice.createdAt, 10)
    assert.equal(result.notice.updatedAt, 10)

    const blank = enqueueErrorNotice(
      [],
      { title: ' ', message: '\r\n', details: ' ' },
      { createId: () => 'blank' }
    ).notice
    assert.equal(blank.title, 'Something went wrong')
    assert.equal(blank.message, 'An unexpected error occurred.')
    assert.equal(blank.details, null)
  })

  it('deduplicates equal notices, preserves identity, and moves them newest', () => {
    const createId = idFactory('first', 'second', 'unused')
    const first = enqueueErrorNotice(
      [],
      { title: 'Fetch failed', message: 'Network unavailable' },
      { now: () => 20, createId }
    )
    const second = enqueueErrorNotice(
      first.notices,
      { title: 'Checkout failed', message: 'Branch is locked' },
      { now: () => 30, createId }
    )
    const repeated = enqueueErrorNotice(
      second.notices,
      { title: 'Fetch failed', message: 'Network unavailable' },
      { now: () => 40, createId }
    )

    assert.equal(repeated.deduplicated, true)
    assert.equal(repeated.notice.id, 'first')
    assert.equal(repeated.notice.occurrences, 2)
    assert.equal(repeated.notice.createdAt, 20)
    assert.equal(repeated.notice.updatedAt, 40)
    assert.deepEqual(
      repeated.notices.map(notice => notice.id),
      ['second', 'first']
    )
  })

  it('supports explicit operation fingerprints and evicts oldest notices', () => {
    let notices = enqueueErrorNotice(
      [],
      {
        title: 'First wording',
        message: 'One',
        dedupeKey: 'same-operation',
      },
      { createId: () => 'operation' }
    ).notices
    const merged = enqueueErrorNotice(
      notices,
      {
        title: 'Updated wording',
        message: 'Two',
        dedupeKey: 'same-operation',
      },
      { createId: () => 'ignored' }
    )
    assert.equal(merged.notices.length, 1)
    assert.equal(merged.notice.id, 'operation')
    assert.equal(merged.notice.title, 'Updated wording')

    notices = merged.notices
    for (let index = 0; index < ErrorNoticeQueueLimit; index++) {
      notices = enqueueErrorNotice(
        notices,
        { title: `Error ${index}`, message: `Message ${index}` },
        { createId: () => `notice-${index}` }
      ).notices
    }
    assert.equal(notices.length, ErrorNoticeQueueLimit)
    assert.equal(
      notices.some(notice => notice.id === 'operation'),
      false
    )

    let oversizedLimitQueue = notices
    for (let index = ErrorNoticeQueueLimit; index < 12; index++) {
      oversizedLimitQueue = enqueueErrorNotice(
        oversizedLimitQueue,
        { title: `Error ${index}`, message: `Message ${index}` },
        { limit: 1_000, createId: () => `notice-${index}` }
      ).notices
    }
    assert.equal(oversizedLimitQueue.length, MaximumErrorNoticeQueueLimit)
  })

  it('dismisses exactly one id and preserves identity for a no-op', () => {
    const first = enqueueErrorNotice(
      [],
      { message: 'First' },
      { createId: () => 'first' }
    ).notices
    const notices = enqueueErrorNotice(
      first,
      { message: 'Second' },
      { createId: () => 'second' }
    ).notices

    assert.deepEqual(
      dismissErrorNotice(notices, 'first').map(notice => notice.id),
      ['second']
    )
    assert.equal(dismissErrorNotice(notices, 'missing'), notices)
  })
})
