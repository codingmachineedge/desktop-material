import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  buildProviderTriageURL,
  filterProviderTriageItems,
  IAPIProviderTriageItem,
  normalizeProviderTriageItem,
  normalizeProviderTriagePage,
  validateProviderTriageCoordinate,
} from '../../src/lib/provider-triage'

const now = new Date('2026-07-13T12:00:00Z')
const base: IAPIProviderTriageItem = {
  number: 42,
  title: 'Review provider routing',
  createdAt: '2026-06-01T12:00:00Z',
  updatedAt: '2026-07-12T12:00:00Z',
  authorLogin: 'fixture-bot',
  assigneeLogins: ['Selected'],
  reviewRequestedLogins: ['SELECTED'],
  draft: false,
}

function item(
  overrides: Partial<IAPIProviderTriageItem> = {},
  accountIdentity = 'https://api.github.com#1',
  repository = 'material'
) {
  return normalizeProviderTriageItem(
    'github',
    'https://github.com',
    'desktop',
    repository,
    accountIdentity,
    'selected',
    'pull-request',
    { ...base, ...overrides },
    now
  )
}

describe('provider-neutral triage model', () => {
  it('builds links from the exact account origin for every provider route', () => {
    assert.equal(
      buildProviderTriageURL(
        'github',
        'https://github.example',
        'desktop',
        'material',
        'issue',
        7
      ),
      'https://github.example/desktop/material/issues/7'
    )
    assert.equal(
      buildProviderTriageURL(
        'gitlab',
        'https://gitlab.example/gitlab',
        'group/subgroup',
        'material',
        'issue',
        8
      ),
      'https://gitlab.example/gitlab/group/subgroup/material/-/issues/8'
    )
    assert.equal(
      buildProviderTriageURL(
        'gitlab',
        'https://gitlab.example',
        'group',
        'material',
        'pull-request',
        9
      ),
      'https://gitlab.example/group/material/-/merge_requests/9'
    )
    assert.equal(
      buildProviderTriageURL(
        'bitbucket',
        'https://bitbucket.org',
        'workspace',
        'material',
        'pull-request',
        10
      ),
      'https://bitbucket.org/workspace/material/pull-requests/10'
    )
  })

  it('uses an opaque identity that cannot collide across repositories or accounts', () => {
    const first = item()
    const otherRepository = item({}, undefined, 'other')
    const otherAccount = item({}, 'https://api.github.com#2')
    assert.match(first.id, /^triage-[0-9a-f]{24}$/)
    assert.notEqual(first.id, otherRepository.id)
    assert.notEqual(first.id, otherAccount.id)
    assert.doesNotMatch(first.id, /github\.com|desktop|material/)
  })

  it('normalizes display text and computes stable attention buckets', () => {
    const normalized = item({
      title: '  Safe\u0000\n title  ',
      authorLogin: 'SELECTED',
      createdAt: '2026-04-01T12:00:00Z',
      updatedAt: '2026-05-01T12:00:00Z',
    })
    assert.equal(normalized.title, 'Safe title')
    assert.equal(normalized.attention.authored, true)
    assert.equal(normalized.attention.assigned, true)
    assert.equal(normalized.attention.reviewRequested, true)
    assert.equal(normalized.attention.stale, true)
    assert.equal(normalized.attention.recentlyUpdated, false)
  })

  it('rejects unsafe origins, coordinates, draft values, and page flags', () => {
    assert.throws(() =>
      buildProviderTriageURL(
        'github',
        'https://user:secret@github.example',
        'desktop',
        'material',
        'issue',
        1
      )
    )
    assert.throws(() =>
      validateProviderTriageCoordinate('../escape', 'material', false)
    )
    assert.throws(() => item({ draft: 'false' as unknown as boolean }))
    assert.throws(() =>
      normalizeProviderTriagePage(
        'github',
        'https://github.com',
        'desktop',
        'material',
        'account-key',
        'selected',
        'issue',
        {
          supported: 'yes' as unknown as boolean,
          capped: false,
          items: [],
        },
        now
      )
    )
    assert.throws(() =>
      normalizeProviderTriagePage(
        'bitbucket',
        'https://bitbucket.org',
        'desktop',
        'material',
        'account-key',
        'selected',
        'issue',
        { supported: false, capped: true, items: [] },
        now
      )
    )
  })

  it('filters and sorts without accepting invented filter values', () => {
    const assigned = item()
    const unrelated = item({
      number: 43,
      title: 'Other work',
      authorLogin: 'other',
      assigneeLogins: [],
      reviewRequestedLogins: [],
      updatedAt: '2026-07-10T12:00:00Z',
    })
    assert.deepEqual(
      filterProviderTriageItems([unrelated, assigned], {
        query: 'routing',
        kind: 'all',
        bucket: 'assigned',
        sort: 'updated-descending',
      }).map(x => x.number),
      [42]
    )
    assert.throws(() =>
      filterProviderTriageItems([assigned], {
        query: '',
        kind: 'invented' as 'all',
        bucket: 'all',
        sort: 'updated-descending',
      })
    )
  })
})
