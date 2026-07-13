import assert from 'node:assert'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  downloadGitHubReleaseAsset,
  normalizeGitHubReleaseAssetDestination,
} from '../../src/lib/github-release-asset-download'
import { IGitHubReleaseAsset } from '../../src/lib/github-releases'

const temporaryDirectories = new Array<string>()

async function temporaryDirectory() {
  const path = await mkdtemp(
    join(tmpdir(), 'desktop-material-release-download-')
  )
  temporaryDirectories.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true }))
  )
})

function asset(bytes: Uint8Array, digest: string | null): IGitHubReleaseAsset {
  return {
    id: 9,
    name: 'desktop.exe',
    label: null,
    state: 'uploaded',
    contentType: 'application/octet-stream',
    sizeInBytes: bytes.byteLength,
    downloadCount: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    digest,
  }
}

describe('GitHub release asset download', () => {
  it('streams, hashes, verifies, and publishes without overwrite', async () => {
    const directory = await temporaryDirectory()
    const destination = join(directory, 'desktop.exe')
    await writeFile(destination, 'existing')
    const bytes = new TextEncoder().encode('verified release asset')
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    const progress = new Array<number>()

    const result = await downloadGitHubReleaseAsset(
      asset(bytes, digest),
      new Response(bytes, {
        headers: { 'Content-Length': String(bytes.byteLength) },
      }),
      destination,
      new AbortController().signal,
      event => progress.push(event.transferredBytes)
    )

    assert.equal(result.path, join(directory, 'desktop (2).exe'))
    assert.equal(await readFile(destination, 'utf8'), 'existing')
    assert.deepEqual(await readFile(result.path), Buffer.from(bytes))
    assert.equal(result.localDigest, digest)
    assert.equal(result.matchesGitHubDigest, true)
    assert.deepEqual(progress, [0, bytes.byteLength])
  })

  it('removes partial files on digest and size failures', async () => {
    const directory = await temporaryDirectory()
    const destination = join(directory, 'asset.bin')
    const bytes = new TextEncoder().encode('unsafe')
    await assert.rejects(() =>
      downloadGitHubReleaseAsset(
        asset(bytes, `sha256:${'0'.repeat(64)}`),
        new Response(bytes),
        destination,
        new AbortController().signal
      )
    )
    await assert.rejects(() =>
      downloadGitHubReleaseAsset(
        asset(bytes, null),
        new Response(new Uint8Array(bytes.byteLength - 1)),
        destination,
        new AbortController().signal
      )
    )
    assert.deepEqual(await readdir(directory), [])
  })

  it('cancels before publishing and accepts exact arbitrary suffixes', async () => {
    const directory = await temporaryDirectory()
    const destination = join(directory, 'symbols.tar.zst')
    assert.equal(
      normalizeGitHubReleaseAssetDestination(destination),
      destination
    )
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      downloadGitHubReleaseAsset(
        asset(new Uint8Array(), null),
        new Response(null),
        destination,
        controller.signal
      ),
      error => (error as Error).name === 'AbortError'
    )
    assert.deepEqual(await readdir(directory), [])
    assert.throws(() => normalizeGitHubReleaseAssetDestination('relative.exe'))
  })
})
