import assert from 'node:assert'
import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import { mkdtemp, readFile, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { describe, it } from 'node:test'
import {
  cancelActionsTransfer,
  createElectronActionsFetcher,
  handleActionsArtifactTransfer,
  handleActionsJobLogTransfer,
  IActionsTransferSender,
} from '../../../src/main-process/actions-transfer'
import {
  getCompletedActionsArtifactDownload,
  releaseCompletedActionsArtifactDownload,
} from '../../../src/main-process/actions-artifact-download-registry'
import {
  ActionsJobLogMaximumBytes,
  ActionsJobLogTruncationMarker,
  IActionsArtifactTransferRequest,
  IActionsJobLogTransferRequest,
  IActionsTransferProgressEvent,
} from '../../../src/lib/actions-transfer'

const archive = Buffer.from('trusted main process artifact')
const digest = `sha256:${createHash('sha256').update(archive).digest('hex')}`

class TestSender extends EventEmitter implements IActionsTransferSender {
  public readonly sent = new Array<IActionsTransferProgressEvent>()
  private destroyed = false

  public constructor(public readonly id: number) {
    super()
  }

  public send(
    channel: 'actions-transfer-progress',
    event: IActionsTransferProgressEvent
  ) {
    assert.equal(channel, 'actions-transfer-progress')
    this.sent.push(event)
  }

  public isDestroyed() {
    return this.destroyed
  }

  public destroy() {
    this.destroyed = true
    this.emit('destroyed')
  }
}

class ThrowingSender extends TestSender {
  public override send(): void {
    throw new Error('renderer was destroyed')
  }
}

class FakeClientRequest extends EventEmitter {
  public aborted = false

  public constructor(
    private readonly onEnd: () => void,
    private readonly closeBeforeResponse: boolean = false
  ) {
    super()
  }

  public end() {
    if (this.closeBeforeResponse) {
      this.emit('close')
    }
    queueMicrotask(this.onEnd)
    return this
  }

  public abort() {
    if (this.aborted) {
      return
    }
    this.aborted = true
    this.emit('abort')
    this.emit('close')
  }
}

const artifactRequest = (
  destination: string,
  overrides: Partial<IActionsArtifactTransferRequest> = {}
): IActionsArtifactTransferRequest => ({
  operationId: 'a'.repeat(32),
  endpoint: 'https://api.github.com',
  token: 'selected-account-token',
  owner: 'owner',
  repository: 'repo',
  artifact: {
    id: 19,
    sizeInBytes: archive.byteLength,
    expired: false,
    digest,
    workflowRun: null,
  },
  destination,
  ...overrides,
})

const logRequest = (
  overrides: Partial<IActionsJobLogTransferRequest> = {}
): IActionsJobLogTransferRequest => ({
  operationId: 'b'.repeat(32),
  endpoint: 'https://api.github.com',
  token: 'selected-account-token',
  owner: 'owner',
  repository: 'repo',
  jobId: 7,
  ...overrides,
})

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'actions-main-transfer-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('main-process Actions transfer', () => {
  it('captures Electron ClientRequest redirects without following them', async () => {
    const requestedOptions =
      new Array<Electron.ClientRequestConstructorOptions>()
    let request: FakeClientRequest
    const isolatedSession = {} as Electron.Session
    const fetcher = createElectronActionsFetcher(
      nextOptions => {
        requestedOptions.push(nextOptions)
        request = new FakeClientRequest(() => {
          request.emit(
            'redirect',
            302,
            'GET',
            'https://blob.example.test/archive.zip',
            {
              location: ['https://blob.example.test/archive.zip'],
            }
          )
          request.emit('error', new Error('Redirect was cancelled'))
          request.emit('close')
        })
        return request as unknown as Electron.ClientRequest
      },
      () => isolatedSession
    )

    const response = await fetcher('https://api.github.com/artifact', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer selected-account-token',
        Accept: 'application/vnd.github+json',
      },
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    })

    assert.equal(response.status, 302)
    assert.equal(
      response.headers.get('location'),
      'https://blob.example.test/archive.zip'
    )
    const options = requestedOptions[0]
    assert.equal(options.url, 'https://api.github.com/artifact')
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'manual')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.useSessionCookies, false)
    assert.equal(options.referrerPolicy, 'no-referrer')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.session, isolatedSession)
    assert.equal(
      (options.headers as Record<string, string>).authorization,
      'Bearer selected-account-token'
    )
  })

  it('streams Electron responses and binds body cancellation to ClientRequest', async () => {
    const responseStream = Object.assign(Readable.from([archive]), {
      statusCode: 200,
      statusMessage: 'OK',
      headers: {
        'content-length': String(archive.byteLength),
      },
    })
    let responseRequest: FakeClientRequest
    const responseFetcher = createElectronActionsFetcher(
      () => {
        responseRequest = new FakeClientRequest(() => {
          responseRequest.emit('response', responseStream)
        }, true)
        return responseRequest as unknown as Electron.ClientRequest
      },
      () => ({} as Electron.Session)
    )
    const responseController = new AbortController()
    const response = await responseFetcher('https://blob.example.test/file', {
      signal: responseController.signal,
    })
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), archive)
    responseController.abort()
    assert.equal(responseRequest!.aborted, false)

    const pendingBody = Object.assign(
      new Readable({
        read() {},
      }),
      {
        statusCode: 200,
        statusMessage: 'OK',
        headers: {},
      }
    )
    let bodyRequest: FakeClientRequest
    const bodyFetcher = createElectronActionsFetcher(
      () => {
        bodyRequest = new FakeClientRequest(() => {
          bodyRequest.emit('response', pendingBody)
        })
        return bodyRequest as unknown as Electron.ClientRequest
      },
      () => ({} as Electron.Session)
    )
    const cancelableResponse = await bodyFetcher(
      'https://blob.example.test/cancelable',
      {}
    )
    await cancelableResponse.body?.cancel('preflight failed')
    assert.equal(bodyRequest!.aborted, true)

    let pendingRequest: FakeClientRequest
    const pendingFetcher = createElectronActionsFetcher(
      () => {
        pendingRequest = new FakeClientRequest(() => undefined)
        return pendingRequest as unknown as Electron.ClientRequest
      },
      () => ({} as Electron.Session)
    )
    const controller = new AbortController()
    const pending = pendingFetcher('https://blob.example.test/pending', {
      signal: controller.signal,
    })
    controller.abort()
    await assert.rejects(pending, error => {
      assert.equal((error as Error).name, 'AbortError')
      return true
    })
    assert.equal(pendingRequest!.aborted, true)
  })

  it('validates every hop, strips auth after the API, and streams to disk', async () => {
    await withDirectory(async directory => {
      const requests = new Array<{
        url: string
        authorization: string | null
        redirect: RequestRedirect | undefined
        credentials: RequestCredentials | undefined
        referrerPolicy: ReferrerPolicy | undefined
        cache: RequestCache | undefined
        accept: string | null
        apiVersion: string | null
      }>()
      const responses = [
        new Response(null, {
          status: 302,
          headers: { Location: 'https://blob.example.test/first' },
        }),
        new Response(null, {
          status: 307,
          headers: { Location: 'https://cdn.example.test/final.zip' },
        }),
        new Response(archive, {
          headers: { 'Content-Length': String(archive.byteLength) },
        }),
      ]
      const sender = new TestSender(1)
      const destination = join(directory, 'artifact.zip')
      const result = await handleActionsArtifactTransfer(
        sender,
        artifactRequest(destination),
        async (url, init) => {
          requests.push({
            url,
            authorization: new Headers(init.headers).get('Authorization'),
            redirect: init.redirect,
            credentials: init.credentials,
            referrerPolicy: init.referrerPolicy,
            cache: init.cache,
            accept: new Headers(init.headers).get('Accept'),
            apiVersion: new Headers(init.headers).get('X-GitHub-Api-Version'),
          })
          return responses.shift()!
        }
      )

      assert.equal(result.ok, true)
      if (result.ok) {
        assert.match(result.downloadId, /^[a-f0-9]{32}$/)
        assert.deepEqual(
          getCompletedActionsArtifactDownload(sender.id, result.downloadId),
          {
            downloadId: result.downloadId,
            senderId: sender.id,
            path: destination,
            bytes: archive.length,
            archiveDigest: digest,
            owner: 'owner',
            repository: 'repo',
            artifactId: 19,
            workflowRun: null,
          }
        )
        assert.equal(
          releaseCompletedActionsArtifactDownload(sender.id, result.downloadId),
          true
        )
      }
      assert.deepEqual(
        requests.map(request => request.authorization),
        ['Bearer selected-account-token', null, null]
      )
      assert.ok(requests.every(request => request.redirect === 'manual'))
      assert.ok(requests.every(request => request.credentials === 'omit'))
      assert.ok(
        requests.every(request => request.referrerPolicy === 'no-referrer')
      )
      assert.ok(requests.every(request => request.cache === 'no-store'))
      assert.ok(
        requests.every(
          request => request.accept === 'application/vnd.github+json'
        )
      )
      assert.ok(requests.every(request => request.apiVersion === '2026-03-10'))
      assert.equal(requests[2].url, 'https://cdn.example.test/final.zip')
      assert.deepEqual(await readFile(destination), archive)
      assert.ok(sender.sent.length >= 1)
      assert.ok(
        sender.sent.every(event => event.operationId === 'a'.repeat(32))
      )
    })
  })

  it('rejects downgrade and excessive redirect chains before publication', async () => {
    await withDirectory(async directory => {
      let downgradeFetches = 0
      const downgrade = await handleActionsArtifactTransfer(
        new TestSender(2),
        artifactRequest(join(directory, 'downgrade.zip')),
        async () => {
          downgradeFetches++
          return new Response(null, {
            status: 302,
            headers: { Location: 'http://blob.example.test/archive.zip' },
          })
        }
      )
      assert.deepEqual(downgrade, {
        ok: false,
        reason: 'unsafe-redirect',
        status: null,
      })
      assert.equal(downgradeFetches, 1)

      let redirectFetches = 0
      const excessive = await handleActionsArtifactTransfer(
        new TestSender(3),
        artifactRequest(join(directory, 'redirects.zip'), {
          operationId: 'c'.repeat(32),
        }),
        async () => {
          redirectFetches++
          return new Response(null, {
            status: 302,
            headers: {
              Location: `https://blob.example.test/${redirectFetches}`,
            },
          })
        }
      )
      assert.equal(excessive.ok, false)
      assert.equal(excessive.ok ? '' : excessive.reason, 'too-many-redirects')
      assert.equal(redirectFetches, 6)
      assert.deepEqual(await readdir(directory), [])
    })
  })

  it('cancels the final response stream when artifact preflight fails', async () => {
    await withDirectory(async directory => {
      let canceled = false
      const response = new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            canceled = true
          },
        }),
        {
          headers: {
            'Content-Length': String(archive.byteLength + 1),
          },
        }
      )
      const result = await handleActionsArtifactTransfer(
        new TestSender(18),
        artifactRequest(join(directory, 'mismatch.zip'), {
          operationId: '8'.repeat(32),
        }),
        async () => response
      )

      assert.deepEqual(result, {
        ok: false,
        reason: 'size-mismatch',
        status: null,
      })
      assert.equal(canceled, true)
      assert.deepEqual(await readdir(directory), [])
    })
  })

  it('returns typed expiration and missing-location outcomes', async () => {
    await withDirectory(async directory => {
      const expiredArtifact = await handleActionsArtifactTransfer(
        new TestSender(4),
        artifactRequest(join(directory, 'expired.zip'), {
          operationId: '1'.repeat(32),
        }),
        async () => new Response(null, { status: 410 })
      )
      assert.deepEqual(expiredArtifact, {
        ok: false,
        reason: 'expired',
        status: 410,
      })

      const expiredLog = await handleActionsJobLogTransfer(
        new TestSender(5),
        logRequest({ operationId: '2'.repeat(32) }),
        async () => new Response(null, { status: 410 })
      )
      assert.deepEqual(expiredLog, {
        ok: false,
        reason: 'expired',
        status: 410,
      })

      const missingLocation = await handleActionsArtifactTransfer(
        new TestSender(6),
        artifactRequest(join(directory, 'missing.zip'), {
          operationId: '3'.repeat(32),
        }),
        async () => new Response(null, { status: 302 })
      )
      assert.deepEqual(missingLocation, {
        ok: false,
        reason: 'missing-location',
        status: null,
      })
      assert.deepEqual(await readdir(directory), [])
    })
  })

  it('scopes duplicate and cancellation state to sender plus operation id', async () => {
    await withDirectory(async directory => {
      const sender = new TestSender(8)
      const other = new TestSender(9)
      const request = artifactRequest(join(directory, 'pending.zip'), {
        operationId: 'd'.repeat(32),
      })
      const pending = handleActionsArtifactTransfer(
        sender,
        request,
        async (_url, init) =>
          await new Promise<Response>((_resolve, reject) =>
            init.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('canceled', 'AbortError')),
              { once: true }
            )
          )
      )
      const duplicate = await handleActionsArtifactTransfer(
        sender,
        request,
        async () => new Response(archive)
      )
      assert.deepEqual(duplicate, {
        ok: false,
        reason: 'invalid-request',
        status: null,
      })
      assert.equal(cancelActionsTransfer(other.id, request.operationId), false)
      assert.equal(cancelActionsTransfer(sender.id, request.operationId), true)
      assert.deepEqual(await pending, {
        ok: false,
        reason: 'canceled',
        status: null,
      })
      assert.equal(cancelActionsTransfer(sender.id, request.operationId), false)
    })
  })

  it('aborts and cleans state when the owning renderer is destroyed', async () => {
    await withDirectory(async directory => {
      const sender = new TestSender(10)
      const request = artifactRequest(join(directory, 'destroyed.zip'), {
        operationId: 'e'.repeat(32),
      })
      const pending = handleActionsArtifactTransfer(
        sender,
        request,
        async (_url, init) =>
          await new Promise<Response>((_resolve, reject) =>
            init.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('destroyed', 'AbortError')),
              { once: true }
            )
          )
      )
      sender.destroy()
      assert.equal((await pending).ok, false)
      assert.equal(cancelActionsTransfer(sender.id, request.operationId), false)
    })
  })

  it('rejects malformed request fields before network access', async () => {
    await withDirectory(async directory => {
      let fetches = 0
      const result = await handleActionsArtifactTransfer(
        new TestSender(11),
        artifactRequest(join(directory, 'invalid.zip'), {
          owner: 'owner/escape',
        }),
        async () => {
          fetches++
          return new Response(archive)
        }
      )
      assert.equal(result.ok, false)
      assert.equal(result.ok ? '' : result.reason, 'invalid-request')
      assert.equal(fetches, 0)

      const invalidDestination = await handleActionsArtifactTransfer(
        new TestSender(14),
        artifactRequest('unused', {
          operationId: '4'.repeat(32),
          destination: 42 as unknown as string,
        }),
        async () => {
          fetches++
          return new Response(archive)
        }
      )
      assert.deepEqual(invalidDestination, {
        ok: false,
        reason: 'invalid-request',
        status: null,
      })
      assert.equal(fetches, 0)

      for (const [index, owner] of ['.', '..'].entries()) {
        const dotSegment = await handleActionsArtifactTransfer(
          new TestSender(20 + index),
          artifactRequest(join(directory, `dot-segment-${index}.zip`), {
            operationId: `${index + 6}`.repeat(32),
            owner,
          }),
          async () => {
            fetches++
            return new Response(archive)
          }
        )
        assert.deepEqual(dotSegment, {
          ok: false,
          reason: 'invalid-request',
          status: null,
        })
      }
      assert.equal(fetches, 0)
    })
  })

  it('turns a raced progress-send failure into cancellation', async () => {
    await withDirectory(async directory => {
      const result = await handleActionsArtifactTransfer(
        new ThrowingSender(15),
        artifactRequest(join(directory, 'destroyed.zip'), {
          operationId: '5'.repeat(32),
        }),
        async () =>
          new Response(archive, {
            headers: { 'Content-Length': String(archive.byteLength) },
          })
      )

      assert.deepEqual(result, {
        ok: false,
        reason: 'canceled',
        status: null,
      })
      assert.deepEqual(await readdir(directory), [])
    })
  })

  it('uses the same redirect guard and bounded stream for job logs', async () => {
    const bytes = new Uint8Array(ActionsJobLogMaximumBytes + 1).fill(65)
    const requests = new Array<string | null>()
    const responses = [
      new Response(null, {
        status: 302,
        headers: { Location: 'https://blob.example.test/job.txt' },
      }),
      new Response(bytes),
    ]
    const result = await handleActionsJobLogTransfer(
      new TestSender(12),
      logRequest(),
      async (_url, init) => {
        requests.push(new Headers(init.headers).get('Authorization'))
        return responses.shift()!
      }
    )

    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.truncated, true)
      assert.equal(result.log.endsWith(ActionsJobLogTruncationMarker), true)
    }
    assert.deepEqual(requests, ['Bearer selected-account-token', null])
  })

  it('reports cancellation that occurs while a job-log read is pending', async () => {
    let readStarted!: () => void
    const reading = new Promise<void>(resolve => (readStarted = resolve))
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          readStarted()
          return new Promise<void>(() => undefined)
        },
      })
    )
    const sender = new TestSender(13)
    const request = logRequest({ operationId: 'f'.repeat(32) })
    const pending = handleActionsJobLogTransfer(
      sender,
      request,
      async () => response
    )

    await reading
    assert.equal(cancelActionsTransfer(sender.id, request.operationId), true)
    assert.deepEqual(await pending, {
      ok: false,
      reason: 'canceled',
      status: null,
    })
  })
})
