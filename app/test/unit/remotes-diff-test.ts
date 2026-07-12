import { describe, it } from 'node:test'
import assert from 'node:assert'
import { diffRemotes, IRemote } from '../../src/models/remote'

const origin: IRemote = { name: 'origin', url: 'https://github.com/o/r.git' }
const upstream: IRemote = {
  name: 'upstream',
  url: 'https://github.com/u/r.git',
}

describe('diffRemotes', () => {
  it('reports no changes when the lists are identical', () => {
    const { added, removed, changed } = diffRemotes(
      [origin, upstream],
      [origin, upstream]
    )

    assert.deepStrictEqual(added, [])
    assert.deepStrictEqual(removed, [])
    assert.deepStrictEqual(changed, [])
  })

  it('detects an added remote', () => {
    const { added, removed, changed } = diffRemotes(
      [origin],
      [origin, upstream]
    )

    assert.deepStrictEqual(added, [upstream])
    assert.deepStrictEqual(removed, [])
    assert.deepStrictEqual(changed, [])
  })

  it('detects a removed remote', () => {
    const { added, removed, changed } = diffRemotes(
      [origin, upstream],
      [origin]
    )

    assert.deepStrictEqual(added, [])
    assert.deepStrictEqual(removed, [upstream])
    assert.deepStrictEqual(changed, [])
  })

  it('detects a URL change on a kept remote', () => {
    const edited: IRemote = { name: 'origin', url: 'git@github.com:o/r.git' }
    const { added, removed, changed } = diffRemotes([origin], [edited])

    assert.deepStrictEqual(added, [])
    assert.deepStrictEqual(removed, [])
    assert.deepStrictEqual(changed, [edited])
  })

  it('treats a renamed remote as a removal plus an addition', () => {
    const renamed: IRemote = { name: 'fork', url: origin.url }
    const { added, removed, changed } = diffRemotes([origin], [renamed])

    assert.deepStrictEqual(added, [renamed])
    assert.deepStrictEqual(removed, [origin])
    assert.deepStrictEqual(changed, [])
  })

  it('handles a combination of add, remove and change at once', () => {
    const changedOrigin: IRemote = { name: 'origin', url: 'git@host:o/r.git' }
    const added: IRemote = { name: 'mirror', url: 'https://x/y.git' }

    const diff = diffRemotes([origin, upstream], [changedOrigin, added])

    assert.deepStrictEqual(diff.added, [added])
    assert.deepStrictEqual(diff.removed, [upstream])
    assert.deepStrictEqual(diff.changed, [changedOrigin])
  })
})
