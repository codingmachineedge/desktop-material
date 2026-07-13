import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  normalizeRepositoryDeepenCommitCount,
  parseRepositoryFetchRemotes,
  parseRepositoryShallowStatus,
  prepareRepositoryFetchRemoteInspection,
  prepareRepositoryHistoryDeepen,
  prepareRepositoryHistoryUnshallow,
  prepareRepositoryShallowStatusInspection,
} from '../../src/ui/repository-tools'
import { buildRepositoryShallowHistoryFetchArgs } from '../../src/lib/git/shallow-history'

describe('guided shallow-history recipes', () => {
  it('strictly parses only Git shallow-repository booleans', () => {
    assert.equal(parseRepositoryShallowStatus('true\n'), true)
    assert.equal(parseRepositoryShallowStatus('false\r\n'), false)

    for (const output of [
      '',
      '1',
      'TRUE',
      ' true\n',
      'true\nfalse',
      'x'.repeat(65),
    ]) {
      assert.throws(() => parseRepositoryShallowStatus(output))
    }
  })

  it('accepts only bounded, non-option fetch remote names', () => {
    assert.deepStrictEqual(
      parseRepositoryFetchRemotes('origin\r\nteam/release\nupstream.git\n'),
      ['origin', 'team/release', 'upstream.git']
    )
    assert.deepStrictEqual(parseRepositoryFetchRemotes(''), [])

    for (const output of [
      '--upload-pack=payload\n',
      'origin\nbad remote\n',
      'origin\norigin\n',
      '../outside\n',
      'team//fork\n',
      'trailing/\n',
      'control\u0000remote\n',
      `${Array.from({ length: 129 }, (_, index) => `remote-${index}`).join(
        '\n'
      )}\n`,
    ]) {
      assert.throws(() => parseRepositoryFetchRemotes(output))
    }
  })

  it('normalizes only a bounded whole deepen count', () => {
    assert.equal(normalizeRepositoryDeepenCommitCount(' 1 '), 1)
    assert.equal(normalizeRepositoryDeepenCommitCount('50'), 50)
    assert.equal(normalizeRepositoryDeepenCommitCount('1000000'), 1_000_000)

    for (const value of [
      '',
      '0',
      '-1',
      '+1',
      '01',
      '1.5',
      '1e3',
      '1000001',
      '50 --upload-pack=payload',
      '50\u0000--all',
    ]) {
      assert.throws(() => normalizeRepositoryDeepenCommitCount(value))
    }
  })

  it('uses fixed read-only inspection recipes', () => {
    assert.deepStrictEqual(prepareRepositoryShallowStatusInspection(), [
      'rev-parse',
      '--is-shallow-repository',
    ])
    assert.deepStrictEqual(prepareRepositoryFetchRemoteInspection(), ['remote'])
  })

  it('builds a contained deepen recipe with an option terminator', () => {
    assert.deepStrictEqual(prepareRepositoryHistoryDeepen('origin', '75'), {
      action: 'deepen',
      remote: 'origin',
      deepenBy: 75,
      args: [
        'fetch',
        '--no-auto-maintenance',
        '--no-recurse-submodules',
        '--no-write-fetch-head',
        '--deepen=75',
        '--',
        'origin',
      ],
    })

    for (const [remote, count] of [
      ['--all', '50'],
      ['origin', '--unshallow'],
      ['origin', '50 --upload-pack=payload'],
      ['bad\u0000remote', '50'],
    ]) {
      assert.throws(() => prepareRepositoryHistoryDeepen(remote, count))
    }
  })

  it('keeps full-history fetching a distinct fixed recipe', () => {
    assert.deepStrictEqual(prepareRepositoryHistoryUnshallow('upstream'), {
      action: 'unshallow',
      remote: 'upstream',
      deepenBy: null,
      args: [
        'fetch',
        '--no-auto-maintenance',
        '--no-recurse-submodules',
        '--no-write-fetch-head',
        '--unshallow',
        '--',
        'upstream',
      ],
    })
    assert.throws(() => prepareRepositoryHistoryUnshallow('-upstream'))
    assert.throws(() => prepareRepositoryHistoryUnshallow('bad\nremote'))
  })

  it('rebuilds only fixed authenticated fetch arguments at execution time', () => {
    assert.deepStrictEqual(
      buildRepositoryShallowHistoryFetchArgs({
        action: 'deepen',
        remote: 'origin',
        deepenBy: 50,
      }),
      [
        'fetch',
        '--no-auto-maintenance',
        '--no-recurse-submodules',
        '--no-write-fetch-head',
        '--deepen=50',
        '--',
        'origin',
      ]
    )
    assert.throws(() =>
      buildRepositoryShallowHistoryFetchArgs({
        action: 'deepen',
        remote: '--upload-pack=payload',
        deepenBy: 50,
      })
    )
    assert.throws(() =>
      buildRepositoryShallowHistoryFetchArgs({
        action: 'unshallow',
        remote: 'origin',
        deepenBy: 1,
      })
    )
  })
})
