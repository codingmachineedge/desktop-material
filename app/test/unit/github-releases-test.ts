import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  GitHubReleaseAssetMaximumPages,
  GitHubReleaseAssetPageSize,
  GitHubReleaseMaximumPages,
  GitHubReleasePageSize,
  getGitHubReleaseAssetFingerprint,
  getGitHubReleaseFingerprint,
  normalizeGitHubReleaseAssetName,
  normalizeGitHubReleaseDraft,
  parseGitHubReleaseAssetList,
  parseGitHubReleaseList,
} from '../../src/lib/github-releases'

const asset = (id: number = 11) => ({
  id,
  name: `desktop-${id}.zip`,
  label: null,
  state: 'uploaded',
  content_type: 'application/zip',
  size: 4096,
  download_count: 2,
  created_at: '2026-07-13T10:00:00Z',
  updated_at: '2026-07-13T10:01:00Z',
  digest: `sha256:${'a'.repeat(64)}`,
})

const release = (id: number = 7) => ({
  id,
  tag_name: `v${id}.0.0`,
  target_commitish: 'main',
  name: `Release ${id}`,
  body: 'Reviewed notes',
  draft: true,
  prerelease: false,
  created_at: '2026-07-13T09:00:00Z',
  published_at: null,
  author: { login: 'fixture-bot' },
  assets: [asset()],
})

describe('GitHub Releases model', () => {
  it('normalizes bounded release and digest data', () => {
    const result = parseGitHubReleaseList([release()], 1)
    assert.equal(result.releases[0].id, 7)
    assert.equal(
      result.releases[0].assets[0].digest,
      `sha256:${'a'.repeat(64)}`
    )
    assert.equal(result.nextPage, null)
    assert.equal(result.capped, false)
  })

  it('derives pagination only from a full locally requested page', () => {
    const releases = Array.from({ length: GitHubReleasePageSize }, (_, index) =>
      release(index + 1)
    )
    const first = parseGitHubReleaseList(releases, 1)
    assert.equal(first.nextPage, 2)
    assert.equal(first.capped, false)

    const last = parseGitHubReleaseList(releases, GitHubReleaseMaximumPages)
    assert.equal(last.nextPage, null)
    assert.equal(last.capped, true)
  })

  it('bounds asset pages and rejects duplicates or unsupported digests', () => {
    const assets = Array.from(
      { length: GitHubReleaseAssetPageSize },
      (_, index) => asset(index + 1)
    )
    const result = parseGitHubReleaseAssetList(
      assets,
      GitHubReleaseAssetMaximumPages
    )
    assert.equal(result.assets.length, GitHubReleaseAssetPageSize)
    assert.equal(result.capped, true)
    assert.throws(() => parseGitHubReleaseAssetList([asset(1), asset(1)]))
    assert.throws(() =>
      parseGitHubReleaseAssetList([{ ...asset(), digest: 'sha512:unsafe' }])
    )
  })

  it('rejects oversized pages and unsafe provider strings', () => {
    assert.throws(() =>
      parseGitHubReleaseList(
        Array.from({ length: GitHubReleasePageSize + 1 }, (_, i) =>
          release(i + 1)
        )
      )
    )
    assert.throws(() =>
      parseGitHubReleaseAssetList([{ ...asset(), name: '../escape.exe' }])
    )
    assert.throws(() => parseGitHubReleaseList([release()], 0))
  })

  it('normalizes reviewed drafts and asset names without raw paths', () => {
    assert.deepEqual(
      normalizeGitHubReleaseDraft({
        tagName: ' v1.2.3 ',
        targetCommitish: ' main ',
        name: ' Stable ',
        body: ' Notes ',
        prerelease: false,
      }),
      {
        tagName: 'v1.2.3',
        targetCommitish: 'main',
        name: 'Stable',
        body: 'Notes',
        prerelease: false,
      }
    )
    assert.equal(normalizeGitHubReleaseAssetName(' build.zip '), 'build.zip')
    assert.throws(() => normalizeGitHubReleaseAssetName('../build.zip'))
    assert.throws(() =>
      normalizeGitHubReleaseDraft({
        tagName: '-bad tag',
        targetCommitish: 'main',
        name: '',
        body: '',
        prerelease: false,
      })
    )
  })

  it('fingerprints every reviewed release and asset field deterministically', () => {
    const parsed = parseGitHubReleaseList([release()], 1).releases[0]
    const reordered = { ...parsed, assets: [...parsed.assets].reverse() }
    assert.equal(
      getGitHubReleaseFingerprint(parsed),
      getGitHubReleaseFingerprint(reordered)
    )
    assert.notEqual(
      getGitHubReleaseFingerprint(parsed),
      getGitHubReleaseFingerprint({ ...parsed, body: 'Changed remotely' })
    )
    assert.notEqual(
      getGitHubReleaseAssetFingerprint(parsed.assets[0]),
      getGitHubReleaseAssetFingerprint({
        ...parsed.assets[0],
        downloadCount: parsed.assets[0].downloadCount + 1,
      })
    )
  })
})
