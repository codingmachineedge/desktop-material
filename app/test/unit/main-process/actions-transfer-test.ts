import assert from 'node:assert'
import { createHash } from 'crypto'
import { EventEmitter } from 'events'
import { mkdtemp, readFile, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Readable } from 'stream'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  cancelActionsTransfer,
  createElectronActionsFetcher,
  handleActionsArtifactTransfer,
  handleActionsJobLogTransfer,
  IActionsTransferDependencies,
  IActionsTransferSender,
  updateActionsTransferAccounts,
} from '../../../src/main-process/actions-transfer'
import {
  ActionsJobLogMaximumBytes,
  ActionsJobLogTruncationMarker,
  IActionsArtifactTransferRequest,
  IActionsJobLogTransferRequest,
  IActionsTransferProgressEvent,
} from '../../../src/lib/actions-transfer'

const archive = Buffer.from('trusted main process artifact')
const digest = `sha256:${createHash('sha256').update(archive).digest('hex')}`
const signedHost = 'productionresultssa16.blob.core.windows.net'

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
    private readonly endError: Error | null = null
  ) {
    super()
  }

  public end() {
    if (this.endError !== null) {
      throw this.endError
    }
    queueMicrotask(this.onEnd)
    return this
  }

  public abort() {
    if (!this.aborted) {
      this.aborted = true
      this.emit('abort')
      this.emit('close')
    }
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

function testDependencies(
  fetch: IActionsTransferDependencies['fetch']
): IActionsTransferDependencies {
  return {
    fetch,
    redirects: {
      resolve: async () => [{ address: '20.60.1.2', family: 4 }],
      request: async (url, _addresses, signal) =>
        fetch(url.toString(), {
          method: 'GET',
          headers: {
            Accept: 'application/octet-stream',
            'User-Agent': 'GitHubDesktop-ActionsTransfer',
          },
          redirect: 'manual',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          signal,
        }),
    },
  }
}

function trackedResponse(status: number, headers?: HeadersInit) {
  let canceled = false
  return {
    response: new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          canceled = true
          throw new Error('response cancellation failed')
        },
      }),
      { status, headers }
    ),
    wasCanceled: () => canceled,
  }
}

describe('main-process Actions transfer', () => {
  beforeEach(() => {
    updateActionsTransferAccounts([
      {
        endpoint: 'https://api.github.com',
        token: 'selected-account-token',
      },
    ])
  })

  afterEach(() => updateActionsTransferAccounts([]))

  it('captures isolated Electron redirects without following them', async () => {
    const requestedOptions =
      new Array<Electron.ClientRequestConstructorOptions>()
    const isolatedSession = {} as Electron.Session
    let request: FakeClientRequest
    const fetcher = createElectronActionsFetcher(
      options => {
        requestedOptions.push(options)
        request = new FakeClientRequest(() => {
          request.emit(
            'redirect',
            302,
            'GET',
            `https://${signedHost}/archive.zip`,
            { location: [`https://${signedHost}/archive.zip`] }
          )
          request.emit('error', new Error('redirect canceled'))
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
      `https://${signedHost}/archive.zip`
    )
    const options = requestedOptions[0]
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
    assert.equal(request!.aborted, true)
  })

  it('streams Electron responses and binds cancellation to ClientRequest', async () => {
    const completeStream = Object.assign(Readable.from([archive]), {
      statusCode: 200,
      statusMessage: 'OK',
      headers: { 'content-length': String(archive.byteLength) },
    })
    let completeRequest: FakeClientRequest
    const completeFetcher = createElectronActionsFetcher(
      () => {
        completeRequest = new FakeClientRequest(() => {
          completeRequest.emit('response', completeStream)
        })
        return completeRequest as unknown as Electron.ClientRequest
      },
      () => ({} as Electron.Session)
    )
    const complete = await completeFetcher('https://api.github.com/file', {})
    assert.deepEqual(Buffer.from(await complete.arrayBuffer()), archive)
    assert.equal(completeRequest!.aborted, false)

    const pendingStream = Object.assign(new Readable({ read() {} }), {
      statusCode: 200,
      statusMessage: 'OK',
      headers: {},
    })
    let pendingRequest: FakeClientRequest
    const pendingFetcher = createElectronActionsFetcher(
      () => {
        pendingRequest = new FakeClientRequest(() => {
          pendingRequest.emit('response', pendingStream)
        })
        return pendingRequest as unknown as Electron.ClientRequest
      },
      () => ({} as Electron.Session)
    )
    const pending = await pendingFetcher('https://api.github.com/pending', {})
    await pending.body?.cancel('preflight failed')
    assert.equal(pendingRequest!.aborted, true)

    let abortedRequest: FakeClientRequest
    const abortedFetcher = createElectronActionsFetcher(
      () => {
        abortedRequest = new FakeClientRequest(() => undefined)
        return abortedRequest as unknown as Electron.ClientRequest
      },
      () => ({} as Electron.Session)
    )
    const controller = new AbortController()
    const aborted = abortedFetcher('https://api.github.com/pending', {
      signal: controller.signal,
    })
    controller.abort()
    await assert.rejects(aborted, error => {
      assert.equal((error as Error).name, 'AbortError')
      return true
    })
    assert.equal(abortedRequest!.aborted, true)

    let failedRequest: FakeClientRequest
    const failedFetcher = createElectronActionsFetcher(
      () => {
        failedRequest = new FakeClientRequest(
          () => undefined,
          new Error('request start failed')
        )
        return failedRequest as unknown as Electron.ClientRequest
      },
      () => ({} as Electron.Session)
    )
    await assert.rejects(
      failedFetcher('https://api.github.com/failed', {}),
      /request start failed/
    )
    assert.equal(failedRequest!.aborted, true)
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
          headers: { Location: `https://${signedHost}/first` },
        }),
        new Response(null, {
          status: 307,
          headers: { Location: `https://${signedHost}/final.zip` },
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
        testDependencies(async (url, init) => {
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
        })
      )

      assert.equal(result.ok, true)
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
      assert.deepEqual(
        requests.map(request => request.accept),
        [
          'application/vnd.github+json',
          'application/octet-stream',
          'application/octet-stream',
        ]
      )
      assert.deepEqual(
        requests.map(request => request.apiVersion),
        ['2026-03-10', null, null]
      )
      assert.equal(requests[2].url, `https://${signedHost}/final.zip`)
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
        testDependencies(async () => {
          downgradeFetches++
          return new Response(null, {
            status: 302,
            headers: { Location: `http://${signedHost}/archive.zip` },
          })
        })
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
        testDependencies(async () => {
          redirectFetches++
          return new Response(null, {
            status: 302,
            headers: {
              Location: `https://${signedHost}/${redirectFetches}`,
            },
          })
        })
      )
      assert.equal(excessive.ok, false)
      assert.equal(excessive.ok ? '' : excessive.reason, 'too-many-redirects')
      assert.equal(redirectFetches, 6)

      let loopFetches = 0
      const loop = await handleActionsArtifactTransfer(
        new TestSender(22),
        artifactRequest(join(directory, 'loop.zip'), {
          operationId: 'c1'.repeat(16),
        }),
        testDependencies(async () => {
          loopFetches++
          return new Response(null, {
            status: 302,
            headers: { Location: `https://${signedHost}/loop` },
          })
        })
      )
      assert.equal(loop.ok, false)
      assert.equal(loop.ok ? '' : loop.reason, 'redirect-loop')
      assert.equal(loopFetches, 2)
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
        testDependencies(async () => new Response(null, { status: 410 }))
      )
      assert.deepEqual(expiredArtifact, {
        ok: false,
        reason: 'expired',
        status: 410,
      })

      const expiredLog = await handleActionsJobLogTransfer(
        new TestSender(5),
        logRequest({ operationId: '2'.repeat(32) }),
        testDependencies(async () => new Response(null, { status: 410 }))
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
        testDependencies(async () => new Response(null, { status: 302 }))
      )
      assert.deepEqual(missingLocation, {
        ok: false,
        reason: 'missing-location',
        status: null,
      })
      assert.deepEqual(await readdir(directory), [])
    })
  })

  it('cancels authenticated and signed error bodies without masking failures', async () => {
    await withDirectory(async directory => {
      const expired = trackedResponse(410)
      const expiredResult = await handleActionsArtifactTransfer(
        new TestSender(16),
        artifactRequest(join(directory, 'expired-body.zip'), {
          operationId: '6'.repeat(32),
        }),
        testDependencies(async () => expired.response)
      )
      assert.deepEqual(expiredResult, {
        ok: false,
        reason: 'expired',
        status: 410,
      })
      assert.equal(expired.wasCanceled(), true)

      const invalidRedirect = trackedResponse(302, {
        Location: `http://${signedHost}/archive.zip`,
      })
      const invalidResult = await handleActionsArtifactTransfer(
        new TestSender(17),
        artifactRequest(join(directory, 'invalid-body.zip'), {
          operationId: '7'.repeat(32),
        }),
        testDependencies(async () => invalidRedirect.response)
      )
      assert.deepEqual(invalidResult, {
        ok: false,
        reason: 'unsafe-redirect',
        status: null,
      })
      assert.equal(invalidRedirect.wasCanceled(), true)

      const initial = new Response(null, {
        status: 302,
        headers: { Location: `https://${signedHost}/archive.zip` },
      })
      const signedFailure = trackedResponse(503)
      const responses = [initial, signedFailure.response]
      const signedResult = await handleActionsArtifactTransfer(
        new TestSender(18),
        artifactRequest(join(directory, 'signed-error.zip'), {
          operationId: '8'.repeat(32),
        }),
        testDependencies(async () => responses.shift()!)
      )
      assert.deepEqual(signedResult, {
        ok: false,
        reason: 'http',
        status: 503,
      })
      assert.equal(signedFailure.wasCanceled(), true)
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
        testDependencies(
          async (_url, init) =>
            await new Promise<Response>((_resolve, reject) =>
              init.signal?.addEventListener(
                'abort',
                () => reject(new DOMException('canceled', 'AbortError')),
                { once: true }
              )
            )
        )
      )
      const duplicate = await handleActionsArtifactTransfer(
        sender,
        request,
        testDependencies(async () => new Response(archive))
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
        testDependencies(
          async (_url, init) =>
            await new Promise<Response>((_resolve, reject) =>
              init.signal?.addEventListener(
                'abort',
                () => reject(new DOMException('destroyed', 'AbortError')),
                { once: true }
              )
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
        testDependencies(async () => {
          fetches++
          return new Response(archive)
        })
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
        testDependencies(async () => {
          fetches++
          return new Response(archive)
        })
      )
      assert.deepEqual(invalidDestination, {
        ok: false,
        reason: 'invalid-request',
        status: null,
      })

      for (const [index, owner] of ['.', '..'].entries()) {
        const dotSegment = await handleActionsArtifactTransfer(
          new TestSender(40 + index),
          artifactRequest(join(directory, `dot-segment-${index}.zip`), {
            operationId: `${index + 6}`.repeat(32),
            owner,
          }),
          testDependencies(async () => {
            fetches++
            return new Response(archive)
          })
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

  it('cancels fetched artifact and log bodies when abort wins completion', async () => {
    await withDirectory(async directory => {
      const artifactSender = new TestSender(23)
      const artifactResponse = trackedResponse(200)
      const artifactResult = await handleActionsArtifactTransfer(
        artifactSender,
        artifactRequest(join(directory, 'fetch-race.zip'), {
          operationId: 'd1'.repeat(16),
        }),
        testDependencies(async () => {
          queueMicrotask(() => artifactSender.destroy())
          return artifactResponse.response
        })
      )
      assert.deepEqual(artifactResult, {
        ok: false,
        reason: 'canceled',
        status: null,
      })
      assert.equal(artifactResponse.wasCanceled(), true)

      const logSender = new TestSender(24)
      const logResponse = trackedResponse(200)
      const logResult = await handleActionsJobLogTransfer(
        logSender,
        logRequest({ operationId: 'e1'.repeat(16) }),
        testDependencies(async () => {
          queueMicrotask(() => logSender.destroy())
          return logResponse.response
        })
      )
      assert.deepEqual(logResult, {
        ok: false,
        reason: 'canceled',
        status: null,
      })
      assert.equal(logResponse.wasCanceled(), true)
      assert.deepEqual(await readdir(directory), [])
    })
  })

  it('rejects foreign and stale endpoint-token pairs from renderer IPC', async () => {
    await withDirectory(async directory => {
      let fetches = 0
      const network = testDependencies(async () => {
        fetches++
        return new Response(archive, {
          headers: { 'Content-Length': String(archive.byteLength) },
        })
      })
      const foreign = await handleActionsArtifactTransfer(
        new TestSender(19),
        artifactRequest(join(directory, 'foreign.zip'), {
          operationId: '9'.repeat(32),
          token: 'foreign-token',
        }),
        network
      )
      assert.deepEqual(foreign, {
        ok: false,
        reason: 'invalid-request',
        status: null,
      })
      assert.equal(fetches, 0)

      updateActionsTransferAccounts([
        { endpoint: 'https://api.github.com./', token: 'ambiguous-token' },
      ])
      const ambiguous = await handleActionsArtifactTransfer(
        new TestSender(26),
        artifactRequest(join(directory, 'ambiguous.zip'), {
          operationId: '91'.repeat(16),
          endpoint: 'https://api.github.com./',
          token: 'ambiguous-token',
        }),
        network
      )
      assert.equal(ambiguous.ok, false)
      assert.equal(ambiguous.ok ? '' : ambiguous.reason, 'invalid-request')
      assert.equal(fetches, 0)

      updateActionsTransferAccounts([
        { endpoint: 'https://api.github.com/', token: 'replacement-token' },
      ])
      const stale = await handleActionsArtifactTransfer(
        new TestSender(20),
        artifactRequest(join(directory, 'stale.zip'), {
          operationId: 'a1'.repeat(16),
        }),
        network
      )
      assert.equal(stale.ok, false)
      assert.equal(stale.ok ? '' : stale.reason, 'invalid-request')
      assert.equal(fetches, 0)

      const current = await handleActionsArtifactTransfer(
        new TestSender(21),
        artifactRequest(join(directory, 'current.zip'), {
          operationId: 'b1'.repeat(16),
          token: 'replacement-token',
        }),
        network
      )
      assert.equal(current.ok, true)
      assert.equal(fetches, 1)
      assert.deepEqual(await readFile(join(directory, 'current.zip')), archive)
    })
  })

  it('turns a raced progress-send failure into cancellation', async () => {
    await withDirectory(async directory => {
      const result = await handleActionsArtifactTransfer(
        new ThrowingSender(15),
        artifactRequest(join(directory, 'destroyed.zip'), {
          operationId: '5'.repeat(32),
        }),
        testDependencies(
          async () =>
            new Response(archive, {
              headers: { 'Content-Length': String(archive.byteLength) },
            })
        )
      )

      assert.deepEqual(result, {
        ok: false,
        reason: 'canceled',
        status: null,
      })
      assert.deepEqual(await readdir(directory), [])
    })
  })

  it('maps destination filesystem failures without publishing partial files', async () => {
    await withDirectory(async directory => {
      const result = await handleActionsArtifactTransfer(
        new TestSender(25),
        artifactRequest(join(directory, 'missing', 'package.zip'), {
          operationId: 'f1'.repeat(16),
        }),
        testDependencies(
          async () =>
            new Response(archive, {
              headers: { 'Content-Length': String(archive.byteLength) },
            })
        )
      )
      assert.deepEqual(result, {
        ok: false,
        reason: 'destination',
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
        headers: { Location: `https://${signedHost}/job.txt` },
      }),
      new Response(bytes),
    ]
    const result = await handleActionsJobLogTransfer(
      new TestSender(12),
      logRequest(),
      testDependencies(async (_url, init) => {
        requests.push(new Headers(init.headers).get('Authorization'))
        return responses.shift()!
      })
    )

    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.truncated, true)
      assert.equal(result.log.endsWith(ActionsJobLogTruncationMarker), true)
    }
    assert.deepEqual(requests, ['Bearer selected-account-token', null])
  })

  it('releases the job-log response reader after a successful read', async () => {
    const response = new Response('complete log')
    const result = await handleActionsJobLogTransfer(
      new TestSender(14),
      logRequest(),
      testDependencies(async () => response)
    )

    assert.deepEqual(result, {
      ok: true,
      log: 'complete log',
      truncated: false,
    })
    assert.equal(response.body?.locked, false)
  })

  it('reports cancellation that occurs while a job-log read is pending', async () => {
    let readStarted!: () => void
    const reading = new Promise<void>(resolve => (readStarted = resolve))
    let bodyCanceled = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          readStarted()
          return new Promise<void>(() => undefined)
        },
        cancel() {
          bodyCanceled = true
        },
      })
    )
    const sender = new TestSender(13)
    const request = logRequest({ operationId: 'f'.repeat(32) })
    const pending = handleActionsJobLogTransfer(
      sender,
      request,
      testDependencies(async () => response)
    )

    await reading
    assert.equal(cancelActionsTransfer(sender.id, request.operationId), true)
    assert.deepEqual(await pending, {
      ok: false,
      reason: 'canceled',
      status: null,
    })
    assert.equal(bodyCanceled, true)
  })
})
