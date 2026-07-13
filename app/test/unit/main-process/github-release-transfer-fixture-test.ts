import assert from 'node:assert'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  handleGitHubReleaseAssetDownload,
  handleGitHubReleaseAssetUpload,
  IGitHubReleaseTransferSender,
  updateGitHubReleaseTransferAccounts,
} from '../../../src/main-process/github-release-transfer'
import { IGitHubReleaseTransferProgressEvent } from '../../../src/lib/github-release-transfer'

const bytes = Buffer.from('loopback GHES release fixture')
const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`

class FixtureSender
  extends EventEmitter
  implements IGitHubReleaseTransferSender
{
  public constructor(public readonly id: number) {
    super()
  }
  public send(
    _channel: 'github-release-transfer-progress',
    _event: IGitHubReleaseTransferProgressEvent
  ) {}
  public isDestroyed() {
    return false
  }
}

async function requestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks = new Array<Buffer>()
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

describe('GitHub release transfer loopback GHES fixture', () => {
  let endpoint = ''
  let directory = ''
  const requests = new Array<{
    method: string
    url: string
    authorization?: string
  }>()
  const server = createServer(async (request, response) => {
    requests.push({
      method: request.method ?? '',
      url: request.url ?? '',
      authorization: request.headers.authorization,
    })
    if (
      request.method === 'GET' &&
      request.url === '/api/v3/repos/acme/rocket/releases/assets/19'
    ) {
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
      })
      response.end(bytes)
      return
    }
    if (
      request.method === 'POST' &&
      request.url ===
        '/api/uploads/repos/acme/rocket/releases/7/assets?name=fixture.bin&label=Loopback+proof'
    ) {
      const body = await requestBody(request)
      assert.deepEqual(body, bytes)
      response.writeHead(201, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          id: 19,
          name: 'fixture.bin',
          label: 'Loopback proof',
          state: 'uploaded',
          content_type: 'application/octet-stream',
          size: bytes.byteLength,
          download_count: 0,
          created_at: '2026-07-13T10:00:00Z',
          updated_at: '2026-07-13T10:00:00Z',
          digest,
        })
      )
      return
    }
    response.writeHead(404)
    response.end()
  })

  before(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address !== null && typeof address !== 'string')
    endpoint = `http://127.0.0.1:${address.port}/api/v3`
    directory = await mkdtemp(join(tmpdir(), 'release-transfer-fixture-'))
    updateGitHubReleaseTransferAccounts([{ endpoint, token: 'fixture-token' }])
  })

  after(async () => {
    updateGitHubReleaseTransferAccounts([])
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    )
    await rm(directory, { recursive: true, force: true })
  })

  it('downloads and uploads through exact GHES API and upload routes', async () => {
    const source = join(directory, 'fixture.bin')
    const destination = join(directory, 'downloaded.bin')
    await writeFile(source, bytes)
    const dependencies = {
      fetch: async (url: string, init: RequestInit) => await fetch(url, init),
      upload: async (
        url: string,
        headers: Readonly<Record<string, string>>,
        body: Uint8Array,
        signal: AbortSignal
      ) =>
        await fetch(url, {
          method: 'POST',
          headers,
          body,
          redirect: 'manual',
          signal,
        }),
    }

    const downloaded = await handleGitHubReleaseAssetDownload(
      new FixtureSender(41),
      {
        operationId: 'd'.repeat(32),
        endpoint,
        token: 'fixture-token',
        owner: 'acme',
        repository: 'rocket',
        releaseId: 7,
        asset: {
          id: 19,
          name: 'fixture.bin',
          sizeInBytes: bytes.byteLength,
          digest,
        },
        destination,
      },
      dependencies
    )
    const uploaded = await handleGitHubReleaseAssetUpload(
      new FixtureSender(42),
      {
        operationId: 'e'.repeat(32),
        endpoint,
        token: 'fixture-token',
        owner: 'acme',
        repository: 'rocket',
        releaseId: 7,
        sourcePath: source,
        name: 'fixture.bin',
        label: 'Loopback proof',
      },
      dependencies
    )

    assert.equal(downloaded.ok, true)
    assert.equal(uploaded.ok, true)
    assert.deepEqual(await readFile(destination), bytes)
    assert.deepEqual(
      requests.map(request => [
        request.method,
        request.url,
        request.authorization,
      ]),
      [
        [
          'GET',
          '/api/v3/repos/acme/rocket/releases/assets/19',
          'Bearer fixture-token',
        ],
        [
          'POST',
          '/api/uploads/repos/acme/rocket/releases/7/assets?name=fixture.bin&label=Loopback+proof',
          'Bearer fixture-token',
        ],
      ]
    )
  })
})
