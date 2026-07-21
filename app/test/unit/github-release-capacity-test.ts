import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  GitHubReleaseAssetMaximumCount,
  isUploadedGitHubReleaseAsset,
  parseGitHubRelease,
} from '../../src/lib/github-releases'

const asset = (id: number, state: string = 'uploaded') => ({
  id,
  name: `object-${id}.bin`,
  label: null,
  state,
  content_type: 'application/octet-stream',
  size: 1,
  download_count: 0,
  created_at: '2026-07-21T10:00:00Z',
  updated_at: '2026-07-21T10:00:00Z',
  digest: null,
})

const release = (assets: ReadonlyArray<ReturnType<typeof asset>>) => ({
  id: 42,
  tag_name: 'assets',
  target_commitish: 'main',
  name: 'Cheap LFS assets',
  body: '',
  draft: true,
  prerelease: false,
  created_at: '2026-07-21T09:00:00Z',
  published_at: null,
  author: { login: 'fixture-bot' },
  assets,
})

describe('GitHub release asset capacity', () => {
  it('parses the complete 1,000-object release inventory', () => {
    const parsed = parseGitHubRelease(
      release(
        Array.from({ length: GitHubReleaseAssetMaximumCount }, (_, index) =>
          asset(index + 1)
        )
      )
    )

    assert.equal(parsed.assets.length, GitHubReleaseAssetMaximumCount)
  })

  it('counts incomplete provider objects without treating them as files', () => {
    const parsed = parseGitHubRelease(release([asset(1, 'starter')]))

    assert.equal(parsed.assets[0].state, 'starter')
    assert.equal(isUploadedGitHubReleaseAsset(parsed.assets[0]), false)
  })

  it('rejects an impossible embedded inventory above provider capacity', () => {
    assert.throws(() =>
      parseGitHubRelease(
        release(
          Array.from(
            { length: GitHubReleaseAssetMaximumCount + 1 },
            (_, index) => asset(index + 1)
          )
        )
      )
    )
  })
})
