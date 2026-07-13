import assert from 'node:assert'
import { describe, it } from 'node:test'
import { API } from '../../src/lib/api'
import {
  GitHubReleaseJSONError,
  GitHubReleaseJSONMaximumBytes,
} from '../../src/lib/github-release-json'
import { APIError } from '../../src/lib/http'

const apiAsset = {
  id: 19,
  name: 'desktop.zip',
  label: null,
  state: 'uploaded',
  content_type: 'application/zip',
  size: 1024,
  download_count: 0,
  created_at: '2026-07-13T10:00:00Z',
  updated_at: '2026-07-13T10:01:00Z',
  digest: `sha256:${'a'.repeat(64)}`,
}

const apiRelease = {
  id: 42,
  tag_name: 'v1.0.0',
  target_commitish: 'main',
  name: 'Desktop Material 1.0',
  body: 'Reviewed notes',
  draft: true,
  prerelease: false,
  created_at: '2026-07-13T09:00:00Z',
  published_at: null,
  author: { login: 'fixture-bot' },
  assets: [apiAsset],
}

describe('GitHub Releases API', () => {
  it('uses bounded locally generated list and asset paths', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const controller = new AbortController()
    const requests = new Array<{
      method: string
      path: string
      signal?: AbortSignal
    }>()
    Reflect.set(
      api,
      'ghRequest',
      async (
        method: string,
        path: string,
        options?: { signal?: AbortSignal }
      ) => {
        requests.push({ method, path, signal: options?.signal })
        const value = path.endsWith('/releases/42')
          ? apiRelease
          : path.endsWith('/releases/assets/19')
          ? apiAsset
          : path.includes('/assets?')
          ? [apiAsset]
          : [apiRelease]
        return new Response(JSON.stringify(value))
      }
    )

    const releases = await api.fetchReleases(
      'desktop',
      'material',
      2,
      controller.signal
    )
    const assets = await api.fetchReleaseAssets(
      'desktop',
      'material',
      42,
      3,
      controller.signal
    )
    const exactRelease = await api.fetchRelease(
      'desktop',
      'material',
      42,
      controller.signal
    )
    const exactAsset = await api.fetchReleaseAsset(
      'desktop',
      'material',
      19,
      controller.signal
    )

    assert.equal(releases.releases[0].tagName, 'v1.0.0')
    assert.equal(assets.assets[0].name, 'desktop.zip')
    assert.equal(exactRelease.id, 42)
    assert.equal(exactAsset.id, 19)
    assert.deepEqual(requests, [
      {
        method: 'GET',
        path: 'repos/desktop/material/releases?per_page=30&page=2',
        signal: controller.signal,
      },
      {
        method: 'GET',
        path: 'repos/desktop/material/releases/42/assets?per_page=100&page=3',
        signal: controller.signal,
      },
      {
        method: 'GET',
        path: 'repos/desktop/material/releases/42',
        signal: controller.signal,
      },
      {
        method: 'GET',
        path: 'repos/desktop/material/releases/assets/19',
        signal: controller.signal,
      },
    ])
  })

  it('creates drafts and publishes only through separate exact mutations', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const requests = new Array<{
      method: string
      path: string
      body?: Object
    }>()
    Reflect.set(
      api,
      'ghRequest',
      async (method: string, path: string, options?: { body?: Object }) => {
        requests.push({ method, path, body: options?.body })
        const published =
          method === 'PATCH' &&
          (options?.body as { draft?: boolean })?.draft === false
        return new Response(
          JSON.stringify({
            ...apiRelease,
            draft: !published,
            published_at: published ? '2026-07-13T11:00:00Z' : null,
          })
        )
      }
    )

    await api.createReleaseDraft('desktop', 'material', {
      tagName: ' v1.0.0 ',
      targetCommitish: ' main ',
      name: ' Stable ',
      body: ' Notes ',
      prerelease: false,
    })
    await api.publishRelease('desktop', 'material', 42)

    assert.deepEqual(requests[0], {
      method: 'POST',
      path: 'repos/desktop/material/releases',
      body: {
        tag_name: 'v1.0.0',
        target_commitish: 'main',
        name: 'Stable',
        body: 'Notes',
        draft: true,
        prerelease: false,
      },
    })
    assert.deepEqual(requests[1], {
      method: 'PATCH',
      path: 'repos/desktop/material/releases/42',
      body: { draft: false },
    })
  })

  it('updates reviewed fields and deletes only exact identifiers', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    const requests = new Array<{
      method: string
      path: string
      body?: Object
    }>()
    Reflect.set(
      api,
      'ghRequest',
      async (method: string, path: string, options?: { body?: Object }) => {
        requests.push({ method, path, body: options?.body })
        return method === 'DELETE'
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify({ ...apiRelease, name: 'Edited' }))
      }
    )

    await api.updateRelease('desktop', 'material', {
      releaseId: 42,
      tagName: 'v1.0.1',
      targetCommitish: 'main',
      name: 'Edited',
      body: 'Updated notes',
      prerelease: true,
    })
    await api.deleteReleaseAsset('desktop', 'material', 19)
    await api.deleteRelease('desktop', 'material', 42)

    assert.equal(requests[0].path, 'repos/desktop/material/releases/42')
    assert.equal(requests[1].path, 'repos/desktop/material/releases/assets/19')
    assert.equal(requests[2].path, 'repos/desktop/material/releases/42')
  })

  it('bounds provider errors and rejects invalid routes before requests', async () => {
    const api = new API('https://api.github.com', 'secret-token')
    let requests = 0
    Reflect.set(api, 'ghRequest', async () => {
      requests++
      return new Response(new Uint8Array(GitHubReleaseJSONMaximumBytes + 1), {
        status: 403,
      })
    })
    await assert.rejects(
      api.fetchReleases('desktop', 'material'),
      error => error instanceof APIError && error.responseStatus === 403
    )
    assert.equal(requests, 1)
    await assert.rejects(() => api.fetchReleases('bad/owner', 'material'))
    await assert.rejects(() => api.fetchReleaseAssets('desktop', 'material', 0))
    await assert.rejects(() => api.fetchRelease('desktop', 'material', 0))
    await assert.rejects(() => api.fetchReleaseAsset('desktop', 'material', 0))
    assert.equal(requests, 1)

    Reflect.set(
      api,
      'ghRequest',
      async () =>
        new Response('{}', {
          headers: {
            'Content-Length': String(GitHubReleaseJSONMaximumBytes + 1),
          },
        })
    )
    await assert.rejects(
      api.fetchReleases('desktop', 'material'),
      error =>
        error instanceof GitHubReleaseJSONError && error.kind === 'too-large'
    )
  })
})
