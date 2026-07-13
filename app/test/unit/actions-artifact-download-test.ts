import { describe, it } from 'node:test'
import assert from 'node:assert'
import { createHash } from 'crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  ActionsArtifactDownloadError,
  downloadActionsArtifactArchive,
  normalizeActionsArtifactDestination,
} from '../../src/lib/actions-artifact-download'
import { IActionsArtifact } from '../../src/lib/actions-artifacts'

const archive = Buffer.from('bounded artifact archive')
const sha256 = (bytes: Uint8Array) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

const artifact = (
  overrides: Partial<IActionsArtifact> = {}
): IActionsArtifact => ({
  id: 19,
  name: 'Windows package',
  sizeInBytes: archive.byteLength,
  expired: false,
  createdAt: new Date('2026-07-13T10:00:00Z'),
  expiresAt: new Date('2026-10-11T10:00:00Z'),
  updatedAt: new Date('2026-07-13T10:01:00Z'),
  digest: sha256(archive),
  workflowRun: null,
  ...overrides,
})

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-artifact-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('Actions artifact archive download', () => {
  it('streams, hashes, and atomically avoids overwriting an existing archive', async () => {
    await withDirectory(async directory => {
      const destination = join(directory, 'package.zip')
      await writeFile(destination, 'keep me')
      const progress = new Array<number>()

      const result = await downloadActionsArtifactArchive({
        artifact: artifact(),
        response: new Response(archive, {
          headers: { 'Content-Length': String(archive.byteLength) },
        }),
        destination,
        signal: new AbortController().signal,
        onProgress: value => progress.push(value.receivedBytes),
      })

      assert.equal(result.path, join(directory, 'package (2).zip'))
      assert.equal(result.localDigest, sha256(archive))
      assert.equal(result.matchesGitHubDigest, true)
      assert.equal((await readFile(destination)).toString(), 'keep me')
      assert.deepEqual(await readFile(result.path), archive)
      assert.equal(progress[0], 0)
      assert.equal(progress.at(-1), archive.byteLength)
      assert.equal(
        (await readdir(directory)).some(name => name.endsWith('.partial')),
        false
      )
    })
  })

  it('adds the archive extension and requires an absolute destination', () => {
    assert.ok(
      normalizeActionsArtifactDestination('C:\\safe\\package').endsWith('.zip')
    )
    assert.throws(() => normalizeActionsArtifactDestination('package.zip'), {
      name: 'ActionsArtifactDownloadError',
    })
  })

  it('deletes the partial file when GitHub’s digest does not match', async () => {
    await withDirectory(async directory => {
      await assert.rejects(
        downloadActionsArtifactArchive({
          artifact: artifact({ digest: `sha256:${'0'.repeat(64)}` }),
          response: new Response(archive),
          destination: join(directory, 'bad.zip'),
          signal: new AbortController().signal,
        }),
        (error: ActionsArtifactDownloadError) =>
          error.kind === 'digest-mismatch'
      )
      assert.deepEqual(await readdir(directory), [])
    })
  })

  it('rejects advertised and actual size mismatches without publishing', async () => {
    await withDirectory(async directory => {
      await assert.rejects(
        downloadActionsArtifactArchive({
          artifact: artifact(),
          response: new Response(archive, {
            headers: { 'Content-Length': String(archive.byteLength + 1) },
          }),
          destination: join(directory, 'wrong-header.zip'),
          signal: new AbortController().signal,
        }),
        (error: ActionsArtifactDownloadError) => error.kind === 'size-mismatch'
      )

      await assert.rejects(
        downloadActionsArtifactArchive({
          artifact: artifact({ sizeInBytes: archive.byteLength - 1 }),
          response: new Response(archive),
          destination: join(directory, 'wrong-body.zip'),
          signal: new AbortController().signal,
        }),
        (error: ActionsArtifactDownloadError) => error.kind === 'size-mismatch'
      )
      assert.deepEqual(await readdir(directory), [])
    })
  })

  it('cancels the reader and removes its partial file', async () => {
    await withDirectory(async directory => {
      const controller = new AbortController()
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(archive.slice(0, 4))
          },
          cancel() {},
        })
      )

      await assert.rejects(
        downloadActionsArtifactArchive({
          artifact: artifact(),
          response,
          destination: join(directory, 'canceled.zip'),
          signal: controller.signal,
          onProgress: progress => {
            if (progress.receivedBytes > 0) {
              controller.abort()
            }
          },
        }),
        { name: 'AbortError' }
      )
      assert.deepEqual(await readdir(directory), [])
    })
  })
})
