import { describe, it, mock } from 'node:test'
import assert from 'node:assert'
import { createHash } from 'crypto'
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  ActionsArtifactDownloadError,
  downloadActionsArtifactArchive,
  normalizeActionsArtifactDestination,
  publishActionsArtifactWithoutOverwrite,
} from '../../src/lib/actions-artifact-download'
import {
  ActionsArtifactMaximumDownloadBytes,
  IActionsArtifact,
} from '../../src/lib/actions-artifacts'

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

function cancellationTrackedResponse(headers?: HeadersInit) {
  let canceled = false
  return {
    response: new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          canceled = true
          throw new Error('response body cancellation failed')
        },
      }),
      { headers }
    ),
    wasCanceled: () => canceled,
  }
}

describe('Actions artifact archive download', () => {
  it('streams, hashes, and atomically avoids overwriting an existing archive', async () => {
    await withDirectory(async directory => {
      const destination = join(directory, 'package.zip')
      await writeFile(destination, 'keep me')
      const progress = new Array<number>()
      const response = new Response(archive, {
        headers: { 'Content-Length': String(archive.byteLength) },
      })

      const result = await downloadActionsArtifactArchive({
        artifact: artifact(),
        response,
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
      assert.equal(response.body?.locked, false)
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

  it('cancels the response while preserving pre-stream validation errors', async () => {
    await withDirectory(async directory => {
      const controller = new AbortController()
      controller.abort()
      const aborted = cancellationTrackedResponse({
        'Content-Length': String(archive.byteLength),
      })
      await assert.rejects(
        downloadActionsArtifactArchive({
          artifact: artifact(),
          response: aborted.response,
          destination: join(directory, 'aborted.zip'),
          signal: controller.signal,
        }),
        { name: 'AbortError' }
      )
      assert.equal(aborted.wasCanceled(), true)

      const cases: ReadonlyArray<{
        readonly artifact: IActionsArtifact
        readonly headers?: HeadersInit
        readonly destination: string
        readonly expected: RegExp
      }> = [
        {
          artifact: artifact({ expired: true }),
          destination: join(directory, 'expired.zip'),
          expected: /expired/,
        },
        {
          artifact: artifact({
            sizeInBytes: ActionsArtifactMaximumDownloadBytes + 1,
          }),
          destination: join(directory, 'metadata-too-large.zip'),
          expected: /larger than the app’s 5 GiB/,
        },
        {
          artifact: artifact(),
          headers: { 'Content-Length': 'invalid' },
          destination: join(directory, 'invalid-header.zip'),
          expected: /invalid artifact archive size/,
        },
        {
          artifact: artifact(),
          headers: {
            'Content-Length': String(ActionsArtifactMaximumDownloadBytes + 1),
          },
          destination: join(directory, 'response-too-large.zip'),
          expected: /larger than the app’s 5 GiB/,
        },
        {
          artifact: artifact(),
          headers: { 'Content-Length': String(archive.byteLength + 1) },
          destination: join(directory, 'size-mismatch.zip'),
          expected: /does not match/,
        },
        {
          artifact: artifact(),
          headers: { 'Content-Length': String(archive.byteLength) },
          destination: 'relative.zip',
          expected: /absolute destination/,
        },
      ]

      for (const testCase of cases) {
        const tracked = cancellationTrackedResponse(testCase.headers)
        await assert.rejects(
          downloadActionsArtifactArchive({
            artifact: testCase.artifact,
            response: tracked.response,
            destination: testCase.destination,
            signal: new AbortController().signal,
          }),
          testCase.expected
        )
        assert.equal(tracked.wasCanceled(), true)
      }
      assert.deepEqual(await readdir(directory), [])
    })
  })

  it('cancels the response when partial-file setup fails', async () => {
    await withDirectory(async directory => {
      const tracked = cancellationTrackedResponse({
        'Content-Length': String(archive.byteLength),
      })
      await assert.rejects(
        downloadActionsArtifactArchive({
          artifact: artifact(),
          response: tracked.response,
          destination: join(directory, 'missing', 'package.zip'),
          signal: new AbortController().signal,
        }),
        (error: ActionsArtifactDownloadError) => error.kind === 'destination'
      )
      assert.equal(tracked.wasCanceled(), true)
      assert.equal(tracked.response.body?.locked, false)
      assert.deepEqual(await readdir(directory), [])
    })
  })

  it('maps write, sync, and publish filesystem failures to destination', async () => {
    await withDirectory(async directory => {
      const probe = await open(join(directory, 'probe'), 'w')
      const prototype = Object.getPrototypeOf(probe)
      await probe.close()
      await rm(join(directory, 'probe'))

      const write = mock.method(prototype, 'write', async () => {
        throw Object.assign(new Error('write denied'), { code: 'EACCES' })
      })
      try {
        await assert.rejects(
          downloadActionsArtifactArchive({
            artifact: artifact(),
            response: new Response(archive),
            destination: join(directory, 'write.zip'),
            signal: new AbortController().signal,
          }),
          (error: ActionsArtifactDownloadError) => error.kind === 'destination'
        )
      } finally {
        write.mock.restore()
      }
      assert.deepEqual(await readdir(directory), [])

      const sync = mock.method(prototype, 'sync', async () => {
        throw Object.assign(new Error('sync denied'), { code: 'EIO' })
      })
      try {
        await assert.rejects(
          downloadActionsArtifactArchive({
            artifact: artifact(),
            response: new Response(archive),
            destination: join(directory, 'sync.zip'),
            signal: new AbortController().signal,
          }),
          (error: ActionsArtifactDownloadError) => error.kind === 'destination'
        )
      } finally {
        sync.mock.restore()
      }
      assert.deepEqual(await readdir(directory), [])

      const partial = join(directory, '.package.partial')
      await writeFile(partial, archive)
      await assert.rejects(
        publishActionsArtifactWithoutOverwrite(
          partial,
          join(directory, 'missing', 'package.zip'),
          new AbortController().signal
        ),
        (error: ActionsArtifactDownloadError) => error.kind === 'destination'
      )
      assert.deepEqual(await readdir(directory), ['.package.partial'])
    })
  })

  it('deletes the partial file when GitHub’s digest does not match', async () => {
    await withDirectory(async directory => {
      const response = new Response(archive)
      await assert.rejects(
        downloadActionsArtifactArchive({
          artifact: artifact({ digest: `sha256:${'0'.repeat(64)}` }),
          response,
          destination: join(directory, 'bad.zip'),
          signal: new AbortController().signal,
        }),
        (error: ActionsArtifactDownloadError) =>
          error.kind === 'digest-mismatch'
      )
      assert.equal(response.body?.locked, false)
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
      assert.equal(response.body?.locked, false)
      assert.deepEqual(await readdir(directory), [])
    })
  })

  it('removes a linked candidate when cancellation reaches the publish boundary', async () => {
    await withDirectory(async directory => {
      const partial = join(directory, '.package.partial')
      const destination = join(directory, 'package.zip')
      await writeFile(partial, archive)
      const controller = new AbortController()
      controller.abort()

      await assert.rejects(
        publishActionsArtifactWithoutOverwrite(
          partial,
          destination,
          controller.signal
        ),
        { name: 'AbortError' }
      )
      assert.deepEqual(await readdir(directory), ['.package.partial'])
    })
  })
})
