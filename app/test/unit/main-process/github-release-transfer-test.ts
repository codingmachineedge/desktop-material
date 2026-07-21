import assert from 'node:assert'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { ClientRequest, Session } from 'electron'
import {
  cancelGitHubReleaseTransfer,
  createElectronGitHubReleaseUploadFetcher,
  handleGitHubReleaseAssetDownload,
  handleGitHubReleaseAssetUpload,
  IGitHubReleaseTransferDependencies,
  IGitHubReleaseTransferSender,
  updateGitHubReleaseTransferAccounts,
} from '../../../src/main-process/github-release-transfer'
import {
  IGitHubReleaseAssetDownloadRequest,
  IGitHubReleaseAssetUploadRequest,
  IGitHubReleaseTransferProgressEvent,
} from '../../../src/lib/github-release-transfer'

const account = {
  endpoint: 'https://api.github.com',
  token: 'selected-account-token',
}
const bytes = Buffer.from('trusted release asset')
const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`

class TestSender extends EventEmitter implements IGitHubReleaseTransferSender {
  public readonly sent = new Array<IGitHubReleaseTransferProgressEvent>()
  private destroyed = false

  public constructor(public readonly id: number) {
    super()
  }

  public send(
    channel: 'github-release-transfer-progress',
    event: IGitHubReleaseTransferProgressEvent
  ) {
    assert.equal(channel, 'github-release-transfer-progress')
    this.sent.push(event)
  }

  public isDestroyed() {
    return this.destroyed
  }
}

const downloadRequest = (
  destination: string,
  overrides: Partial<IGitHubReleaseAssetDownloadRequest> = {}
): IGitHubReleaseAssetDownloadRequest => ({
  operationId: 'a'.repeat(32),
  ...account,
  owner: 'desktop',
  repository: 'material',
  releaseId: 7,
  asset: {
    id: 19,
    name: 'desktop.exe',
    state: 'uploaded',
    sizeInBytes: bytes.byteLength,
    digest,
  },
  destination,
  ...overrides,
})

const uploadRequest = (
  sourcePath: string,
  overrides: Partial<IGitHubReleaseAssetUploadRequest> = {}
): IGitHubReleaseAssetUploadRequest => ({
  operationId: 'b'.repeat(32),
  ...account,
  owner: 'desktop',
  repository: 'material',
  releaseId: 7,
  sourcePath,
  name: 'desktop.exe',
  label: 'Windows installer',
  ...overrides,
})

function uploadedAsset() {
  return {
    id: 19,
    name: 'desktop.exe',
    label: 'Windows installer',
    state: 'uploaded',
    content_type: 'application/octet-stream',
    size: bytes.byteLength,
    download_count: 0,
    created_at: '2026-07-13T10:00:00Z',
    updated_at: '2026-07-13T10:00:00Z',
    digest,
  }
}

const noRedirects = {
  resolve: async () => [{ address: '20.60.1.2', family: 4 as const }],
  request: async () => new Response(bytes),
}

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'release-main-transfer-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('main-process GitHub release transfer', () => {
  beforeEach(() => updateGitHubReleaseTransferAccounts([account]))
  afterEach(() => updateGitHubReleaseTransferAccounts([]))

  it('downloads the exact account-bound asset and atomically verifies it', async () => {
    await withDirectory(async directory => {
      const requests = new Array<{ url: string; headers: Headers }>()
      const dependencies: IGitHubReleaseTransferDependencies = {
        fetch: async (url, init) => {
          requests.push({ url, headers: new Headers(init.headers) })
          return new Response(bytes, {
            headers: { 'Content-Length': String(bytes.byteLength) },
          })
        },
        upload: async () => {
          throw new Error('unexpected upload')
        },
        redirects: noRedirects,
      }
      const destination = join(directory, 'desktop.exe')
      const sender = new TestSender(1)
      const result = await handleGitHubReleaseAssetDownload(
        sender,
        downloadRequest(destination),
        dependencies
      )

      assert.equal(result.ok, true)
      assert.equal(
        requests[0]?.url,
        'https://api.github.com/repos/desktop/material/releases/assets/19'
      )
      assert.equal(
        requests[0]?.headers.get('Authorization'),
        'Bearer selected-account-token'
      )
      assert.equal(await readFile(destination, 'utf8'), bytes.toString())
      assert.equal(sender.sent.at(-1)?.transferredBytes, bytes.byteLength)
    })
  })

  it('strips authentication after the first validated redirect', async () => {
    await withDirectory(async directory => {
      const signedURL = 'https://objects.githubusercontent.com/release.exe'
      let authenticatedRequests = 0
      let anonymousRequests = 0
      const dependencies: IGitHubReleaseTransferDependencies = {
        fetch: async (_url, init) => {
          authenticatedRequests++
          assert.equal(
            new Headers(init.headers).get('Authorization'),
            'Bearer selected-account-token'
          )
          return new Response(null, {
            status: 302,
            headers: { Location: signedURL },
          })
        },
        upload: async () => {
          throw new Error('unexpected upload')
        },
        redirects: {
          resolve: async () => [{ address: '20.60.1.2', family: 4 }],
          request: async url => {
            anonymousRequests++
            assert.equal(url.toString(), signedURL)
            return new Response(bytes, {
              headers: { 'Content-Length': String(bytes.byteLength) },
            })
          },
        },
      }
      const result = await handleGitHubReleaseAssetDownload(
        new TestSender(2),
        downloadRequest(join(directory, 'redirected.exe')),
        dependencies
      )
      assert.equal(result.ok, true)
      assert.equal(authenticatedRequests, 1)
      assert.equal(anonymousRequests, 1)
    })
  })

  it('uploads a revalidated regular file only to the derived provider endpoint', async () => {
    await withDirectory(async directory => {
      const source = join(directory, 'desktop.exe')
      await writeFile(source, bytes)
      let request:
        | {
            url: string
            headers: Readonly<Record<string, string>>
            body: Buffer
            length: number
          }
        | undefined
      const dependencies: IGitHubReleaseTransferDependencies = {
        fetch: async () => new Response(null, { status: 500 }),
        // Read the streamed source back from disk to prove the exact file bytes
        // reach the fetcher without ever being buffered by the transfer.
        upload: async (url, headers, uploadSource) => {
          request = {
            url,
            headers,
            body: await readFile(uploadSource.path),
            length: uploadSource.length,
          }
          return new Response(JSON.stringify(uploadedAsset()), { status: 201 })
        },
        redirects: noRedirects,
      }
      const sender = new TestSender(3)
      const result = await handleGitHubReleaseAssetUpload(
        sender,
        uploadRequest(source),
        dependencies
      )

      assert.equal(result.ok, true)
      assert.equal(
        request?.url,
        'https://uploads.github.com/repos/desktop/material/releases/7/assets?name=desktop.exe&label=Windows+installer'
      )
      assert.equal(
        new Headers(request?.headers).get('Authorization'),
        'Bearer selected-account-token'
      )
      assert.equal(
        new Headers(request?.headers).get('Content-Length'),
        String(bytes.byteLength)
      )
      assert.deepEqual(request?.body, bytes)
      assert.equal(request?.length, bytes.byteLength)
      if (result.ok) {
        assert.equal(result.localDigest, digest)
        assert.equal(result.bytes, bytes.byteLength)
      }
      assert.deepEqual(
        sender.sent.map(progress => progress.transferredBytes),
        [0, bytes.byteLength]
      )
    })
  })

  it('refuses incomplete provider assets for uploads and downloads', async () => {
    await withDirectory(async directory => {
      const source = join(directory, 'desktop.exe')
      await writeFile(source, bytes)
      const cleanupRequests = new Array<{ url: string; method: string }>()
      const dependencies: IGitHubReleaseTransferDependencies = {
        fetch: async (url, init) => {
          cleanupRequests.push({ url, method: init.method ?? 'GET' })
          return new Response(null, { status: 204 })
        },
        upload: async () =>
          new Response(
            JSON.stringify({ ...uploadedAsset(), state: 'starter' }),
            { status: 201 }
          ),
        redirects: noRedirects,
      }

      const upload = await handleGitHubReleaseAssetUpload(
        new TestSender(20),
        uploadRequest(source),
        dependencies
      )
      const download = await handleGitHubReleaseAssetDownload(
        new TestSender(21),
        downloadRequest(join(directory, 'incomplete.exe'), {
          asset: {
            id: 19,
            name: 'desktop.exe',
            state: 'starter',
            sizeInBytes: bytes.byteLength,
            digest,
          },
        }),
        dependencies
      )

      assert.deepEqual(upload, {
        ok: false,
        reason: 'invalid-response',
        status: null,
      })
      assert.deepEqual(download, {
        ok: false,
        reason: 'invalid-request',
        status: null,
      })
      assert.deepEqual(cleanupRequests, [
        {
          url: 'https://api.github.com/repos/desktop/material/releases/assets/19',
          method: 'DELETE',
        },
      ])
    })
  })

  it('uploads only the requested byte range for a split part', async () => {
    await withDirectory(async directory => {
      const source = join(directory, 'huge.bin')
      const first = Buffer.from('AAAAAAAA'.repeat(8))
      const second = Buffer.from('BBBBBBBB'.repeat(8))
      await writeFile(source, Buffer.concat([first, second]))
      const secondDigest = `sha256:${createHash('sha256')
        .update(second)
        .digest('hex')}`
      let request:
        | {
            body: Buffer
            length: number
            offset: number
            contentLength: string | null
          }
        | undefined
      const dependencies: IGitHubReleaseTransferDependencies = {
        fetch: async () => new Response(null, { status: 500 }),
        // Slice the streamed range back out of the file to prove exactly the
        // second part's bytes — and only those — reach the fetcher.
        upload: async (_url, headers, uploadSource) => {
          const fileBytes = await readFile(uploadSource.path)
          request = {
            body: fileBytes.subarray(
              uploadSource.offset,
              uploadSource.offset + uploadSource.length
            ),
            length: uploadSource.length,
            offset: uploadSource.offset,
            contentLength: new Headers(headers).get('Content-Length'),
          }
          return new Response(
            JSON.stringify({
              ...uploadedAsset(),
              size: second.byteLength,
              digest: secondDigest,
            }),
            { status: 201 }
          )
        },
        redirects: noRedirects,
      }
      const sender = new TestSender(9)
      const result = await handleGitHubReleaseAssetUpload(
        sender,
        uploadRequest(source, {
          range: { offset: first.byteLength, length: second.byteLength },
        }),
        dependencies
      )

      assert.equal(result.ok, true)
      assert.equal(request?.offset, first.byteLength)
      assert.equal(request?.length, second.byteLength)
      assert.equal(request?.contentLength, String(second.byteLength))
      assert.deepEqual(request?.body, second)
      if (result.ok) {
        // The digest and byte count cover exactly the uploaded range.
        assert.equal(result.localDigest, secondDigest)
        assert.equal(result.bytes, second.byteLength)
      }
      assert.deepEqual(
        sender.sent.map(progress => progress.transferredBytes),
        [0, second.byteLength]
      )
      assert.deepEqual(
        sender.sent.map(progress => progress.totalBytes),
        [second.byteLength, second.byteLength]
      )
    })
  })

  it('surfaces intermediate upload bytes accepted by the transfer request', async () => {
    await withDirectory(async directory => {
      const source = join(directory, 'desktop.exe')
      await writeFile(source, bytes)
      const halfway = Math.floor(bytes.byteLength / 2)
      const dependencies: IGitHubReleaseTransferDependencies = {
        fetch: async () => new Response(null, { status: 500 }),
        upload: async (_url, _headers, uploadSource, _signal, onProgress) => {
          onProgress?.(halfway)
          onProgress?.(uploadSource.length)
          return new Response(JSON.stringify(uploadedAsset()), { status: 201 })
        },
        redirects: noRedirects,
      }
      const sender = new TestSender(19)

      const result = await handleGitHubReleaseAssetUpload(
        sender,
        uploadRequest(source),
        dependencies
      )

      assert.equal(result.ok, true)
      assert.deepEqual(
        sender.sent.map(progress => progress.transferredBytes),
        [0, halfway, bytes.byteLength]
      )
    })
  })

  it('uses chunked Electron streaming without buffering or waiting for drain', async () => {
    await withDirectory(async directory => {
      const source = join(directory, 'large-upload.bin')
      const sourceBytes = Buffer.alloc(256 * 1024, 0x61)
      await writeFile(source, sourceBytes)
      const request = new EventEmitter() as EventEmitter & {
        write: (
          chunk: Buffer,
          encoding: BufferEncoding | undefined,
          callback: () => void
        ) => void
        end: () => void
        abort: () => void
        chunkedEncoding: boolean
      }
      request.chunkedEncoding = false
      const written = new Array<Buffer>()
      let pendingWrites = 0
      let maximumPendingWrites = 0
      request.write = (chunk, _encoding, callback) => {
        assert.equal(request.chunkedEncoding, true)
        // Electron returns void and has no Writable `drain` contract.
        pendingWrites++
        maximumPendingWrites = Math.max(maximumPendingWrites, pendingWrites)
        setImmediate(() => {
          written.push(Buffer.from(chunk))
          pendingWrites--
          callback()
        })
      }
      request.abort = () => undefined
      request.end = () => {
        setImmediate(() => {
          const response = new EventEmitter() as EventEmitter & {
            statusCode: number
            statusMessage: string
            headers: Record<string, string>
          }
          response.statusCode = 201
          response.statusMessage = 'Created'
          response.headers = { 'content-type': 'application/json' }
          request.emit('response', response)
          response.emit('data', Buffer.from('{"ok":true}'))
          response.emit('end')
        })
      }

      const accepted = new Array<number>()
      let constructorHeaders: Headers | undefined
      const upload = createElectronGitHubReleaseUploadFetcher(
        options => {
          constructorHeaders = new Headers(options.headers as HeadersInit)
          return request as unknown as ClientRequest
        },
        () => ({} as Session)
      )
      let timeout: NodeJS.Timeout | undefined
      try {
        const response = await Promise.race([
          upload(
            'https://uploads.github.com/example',
            {
              Authorization: 'Bearer test-token',
              'Content-Length': String(sourceBytes.byteLength),
              'Content-Type': 'application/octet-stream',
            },
            { path: source, offset: 0, length: sourceBytes.byteLength },
            new AbortController().signal,
            bytes => accepted.push(bytes)
          ),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error('callback-only upload pump stalled')),
              2000
            )
          }),
        ])

        assert.equal(response.status, 201)
      } finally {
        if (timeout !== undefined) {
          clearTimeout(timeout)
        }
      }
      assert.deepEqual(Buffer.concat(written), sourceBytes)
      assert.equal(maximumPendingWrites, 1)
      assert.equal(request.chunkedEncoding, true)
      assert.equal(constructorHeaders?.get('Content-Length'), null)
      assert.equal(
        constructorHeaders?.get('Authorization'),
        'Bearer test-token'
      )
      assert.equal(
        constructorHeaders?.get('Content-Type'),
        'application/octet-stream'
      )
      assert.ok(accepted.length > 1)
      assert.equal(accepted.at(-1), sourceBytes.byteLength)
    })
  })

  it('rejects account drift, unsafe sources, and upload redirects', async () => {
    await withDirectory(async directory => {
      const source = join(directory, 'desktop.exe')
      await writeFile(source, bytes)
      const dependencies: IGitHubReleaseTransferDependencies = {
        fetch: async () => new Response(bytes),
        upload: async () => new Response(null, { status: 302 }),
        redirects: noRedirects,
      }
      const wrongAccount = await handleGitHubReleaseAssetUpload(
        new TestSender(4),
        uploadRequest(source, { token: 'different-token' }),
        dependencies
      )
      assert.deepEqual(wrongAccount, {
        ok: false,
        reason: 'invalid-request',
        status: null,
      })
      const unsafeSource = await handleGitHubReleaseAssetUpload(
        new TestSender(5),
        uploadRequest(directory),
        dependencies
      )
      assert.equal(unsafeSource.ok, false)
      assert.equal(unsafeSource.ok ? null : unsafeSource.reason, 'source')
      const redirect = await handleGitHubReleaseAssetUpload(
        new TestSender(6),
        uploadRequest(source),
        dependencies
      )
      assert.equal(redirect.ok, false)
      assert.equal(redirect.ok ? null : redirect.reason, 'unsafe-redirect')
    })
  })

  it('cancels only the transfer owned by the requesting renderer', async () => {
    await withDirectory(async directory => {
      const source = join(directory, 'desktop.exe')
      await writeFile(source, bytes)
      const dependencies: IGitHubReleaseTransferDependencies = {
        fetch: async () => new Response(bytes),
        upload: async (_url, _headers, _source, signal) =>
          await new Promise<Response>((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new DOMException('canceled', 'AbortError'))
            )
          }),
        redirects: noRedirects,
      }
      const sender = new TestSender(7)
      const pending = handleGitHubReleaseAssetUpload(
        sender,
        uploadRequest(source, { operationId: 'c'.repeat(32) }),
        dependencies
      )
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(cancelGitHubReleaseTransfer(8, 'c'.repeat(32)), false)
      assert.equal(cancelGitHubReleaseTransfer(7, 'c'.repeat(32)), true)
      assert.deepEqual(await pending, {
        ok: false,
        reason: 'canceled',
        status: null,
      })
      assert.equal(cancelGitHubReleaseTransfer(7, 'c'.repeat(32)), false)
    })
  })
})
