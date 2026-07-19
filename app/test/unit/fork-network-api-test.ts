import assert from 'node:assert'
import { describe, it } from 'node:test'

import { API } from '../../src/lib/api'
import { forkNetworkRepositoryFixture } from '../helpers/fork-network-fixtures'

function response(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), init)
}

function fork(index: number) {
  return forkNetworkRepositoryFixture(`fork-${index}`)
}

describe('fork network API boundary', () => {
  it('uses fixed numeric pages and caps a full fork network at 100 entries', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const paths = new Array<string>()
    const controller = new AbortController()
    Reflect.set(
      api,
      'ghRequest',
      async (
        method: string,
        path: string,
        options?: { signal?: AbortSignal; reloadCache?: boolean }
      ) => {
        assert.equal(method, 'GET')
        assert.equal(options?.signal, controller.signal)
        assert.equal(options?.reloadCache, true)
        paths.push(path)
        const page = path.endsWith('page=2') ? 2 : 1
        return response(
          Array.from({ length: 50 }, (_, offset) =>
            fork((page - 1) * 50 + offset)
          )
        )
      }
    )

    const result = await api.fetchForkNetworkRepositories(
      'upstream',
      'project',
      controller.signal
    )

    assert.equal(result.items.length, 100)
    assert.equal(result.truncated, true)
    assert.deepEqual(paths, [
      'repos/upstream/project/forks?sort=newest&per_page=50&page=1',
      'repos/upstream/project/forks?sort=newest&per_page=50&page=2',
    ])
    assert.ok(paths.every(path => !path.includes('http')))
  })

  it('stops branch pagination on a short page and encodes exact identities', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const requests = new Array<string>()
    Reflect.set(api, 'ghRequest', async (_method: string, path: string) => {
      requests.push(path)
      if (path.includes('/branches/feature%2Freview')) {
        return response({
          name: 'feature/review',
          protected: false,
          commit: { sha: 'a'.repeat(40) },
        })
      }
      if (path === 'repos/alice/project') {
        return response(fork(1))
      }
      return response([
        {
          name: 'feature/review',
          protected: false,
          commit: { sha: 'a'.repeat(40) },
        },
      ])
    })

    const page = await api.fetchForkNetworkBranches('alice', 'project')
    const exactRepository = await api.fetchForkNetworkRepository(
      'alice',
      'project'
    )
    const exactBranch = await api.fetchForkNetworkBranch(
      'alice',
      'project',
      'feature/review'
    )

    assert.equal(page.items.length, 1)
    assert.equal(page.truncated, false)
    assert.equal(exactRepository.owner.login, 'fork-1')
    assert.equal(exactBranch.commit.sha, 'a'.repeat(40))
    assert.deepEqual(requests, [
      'repos/alice/project/branches?per_page=50&page=1',
      'repos/alice/project',
      'repos/alice/project/branches/feature%2Freview',
    ])
  })

  it('rejects a malformed non-array network page', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    Reflect.set(api, 'ghRequest', async () => response({ items: [] }))

    await assert.rejects(
      () => api.fetchForkNetworkBranches('alice', 'project'),
      /expected a repository-network API page to be an array/i
    )
  })
})
