import assert from 'node:assert'
import { describe, it } from 'node:test'

import { Repository } from '../../src/models/repository'
import { DefaultRepositoryLogoDesign } from '../../src/models/repository-logo'
import { RepositoryLogoLoader } from '../../src/ui/repository-logo/repository-logo-loader'

function repository(path: string, id: number) {
  return new Repository(path, id, null, false)
}

describe('RepositoryLogoLoader', () => {
  it('deduplicates in-flight reads for the same repository path', async () => {
    let complete!: () => void
    const gate = new Promise<void>(resolve => {
      complete = resolve
    })
    let calls = 0
    const loader = new RepositoryLogoLoader(async () => {
      calls++
      await gate
      return { logo: DefaultRepositoryLogoDesign, listNameStyle: null }
    }, 4)
    const repo = repository('/work/shared', 1)

    // The cached unit is the appearance read; repeated requests share the
    // exact same promise, and the logo-only wrapper rides the same read.
    const first = loader.loadAppearance(repo)
    const second = loader.loadAppearance(repo)
    const logo = loader.load(repo)

    assert.strictEqual(second, first)
    assert.equal(calls, 1)
    complete()
    assert.strictEqual(await logo, DefaultRepositoryLogoDesign)
    await first
    assert.equal(calls, 1)
    assert.equal(loader.size, 1)
  })

  it('keeps a hard LRU bound across resolved entries', async () => {
    const calls = new Map<string, number>()
    const loader = new RepositoryLogoLoader(async repo => {
      calls.set(repo.path, (calls.get(repo.path) ?? 0) + 1)
      return { logo: DefaultRepositoryLogoDesign, listNameStyle: null }
    }, 2)
    const first = repository('/work/first', 1)
    const second = repository('/work/second', 2)
    const third = repository('/work/third', 3)

    await loader.load(first)
    await loader.load(second)
    await loader.load(first)
    await loader.load(third)

    assert.equal(loader.size, 2)
    await loader.load(second)
    assert.equal(calls.get(first.path), 1)
    assert.equal(calls.get(second.path), 2)
  })

  it('invalidates a shared event token only once', async () => {
    let calls = 0
    const loader = new RepositoryLogoLoader(async () => {
      calls++
      return { logo: DefaultRepositoryLogoDesign, listNameStyle: null }
    })
    const repo = repository('/work/event', 1)
    const event = new Event('logo-change')

    await loader.load(repo)
    loader.invalidate(repo.path, event)
    await loader.load(repo)
    loader.invalidate(repo.path, event)
    await loader.load(repo)

    assert.equal(calls, 2)
  })

  it('drops rejected entries so a later request can recover', async () => {
    let calls = 0
    const loader = new RepositoryLogoLoader(async () => {
      calls++
      if (calls === 1) {
        throw new Error('temporary read failure')
      }
      return { logo: DefaultRepositoryLogoDesign, listNameStyle: null }
    })
    const repo = repository('/work/retry', 1)

    await assert.rejects(loader.load(repo), /temporary read failure/)
    await loader.load(repo)

    assert.equal(calls, 2)
    assert.equal(loader.size, 1)
  })

  it('rejects invalid cache bounds', () => {
    assert.throws(
      () => new RepositoryLogoLoader(undefined, 0),
      /positive integer/
    )
  })
})
