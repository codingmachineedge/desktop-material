import assert from 'node:assert'
import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http'
import { AddressInfo } from 'node:net'
import { describe, it } from 'node:test'
import { OllamaClient } from '../../../src/lib/ollama/client'
import { nodeOllamaFetch } from '../../../src/lib/ollama/transport'
import { OllamaClientError } from '../../../src/lib/ollama/types'

interface ITestServer {
  readonly server: Server
  readonly endpoint: string
}

type TestServerHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => void

async function listen(handler: TestServerHandler): Promise<ITestServer> {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => reject(error)
    server.once('error', failed)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', failed)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  return { server, endpoint: `http://127.0.0.1:${address.port}` }
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections()
  if (!server.listening) {
    return
  }
  await new Promise<void>(resolve => server.close(() => resolve()))
}

async function eventually(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<void>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Native transport did not close in time.')),
          1_000
        )
      }),
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

describe('native Ollama renderer transport', () => {
  it('reads Node response streams without the browser Response constructor', async () => {
    const fixture = await listen((request, response) => {
      if (request.url === '/api/version') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end('{"version":"0.12.6"}')
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      response.end('{"status":"success"}\n')
    })
    const originalResponse = globalThis.Response
    globalThis.Response = new Proxy(originalResponse, {
      construct: () => {
        throw new Error('Browser Response must not wrap a Node stream.')
      },
    })

    try {
      const client = new OllamaClient(fixture.endpoint)
      assert.equal((await client.health()).version, '0.12.6')
      assert.equal((await client.pull('material-chat:7b')).done, true)
    } finally {
      globalThis.Response = originalResponse
      await close(fixture.server)
    }
  })

  it('maps native error statuses through the structural response', async () => {
    const fixture = await listen((_request, response) => {
      response.writeHead(503, { 'Content-Type': 'application/json' })
      response.end('{"error":"offline"}')
    })

    try {
      const client = new OllamaClient(fixture.endpoint)
      await assert.rejects(client.health(), (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'http')
        assert.equal(error.status, 503)
        return true
      })
    } finally {
      await close(fixture.server)
    }
  })

  it('uses Node HTTP by default and streams without browser CORS headers', async () => {
    const requests = new Array<{
      readonly path: string | undefined
      readonly headers: Readonly<Record<string, string | string[] | undefined>>
      readonly body: string
    }>()
    const fixture = await listen((request, response) => {
      const chunks = new Array<Buffer>()
      request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        requests.push({
          path: request.url,
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
        if (request.url === '/api/version') {
          response.writeHead(200, { 'Content-Type': 'application/json' })
          response.end('{"version":"0.9.1"}')
          return
        }
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
        response.write('{"status":"pulling')
        setImmediate(() => response.end(' manifest"}\n{"status":"success"}\n'))
      })
    })
    const originalFetch = globalThis.fetch
    let browserFetches = 0
    globalThis.fetch = async () => {
      browserFetches++
      throw new Error('Browser fetch must not be used.')
    }

    try {
      const client = new OllamaClient(`${fixture.endpoint}/v1`)
      assert.equal((await client.health()).version, '0.9.1')
      assert.equal((await client.pull('llama3.2')).done, true)
      assert.equal(browserFetches, 0)
      assert.deepEqual(
        requests.map(request => request.path),
        ['/api/version', '/api/pull']
      )
      assert.deepEqual(JSON.parse(requests[1].body), {
        model: 'llama3.2',
        stream: true,
      })
      for (const request of requests) {
        assert.equal(request.headers.origin, undefined)
        assert.equal(request.headers.referer, undefined)
        assert.equal(request.headers.cookie, undefined)
        assert.equal(request.headers.authorization, undefined)
      }
    } finally {
      globalThis.fetch = originalFetch
      await close(fixture.server)
    }
  })

  it('never follows redirects', async () => {
    let redirectedRequests = 0
    const target = await listen((_request, response) => {
      redirectedRequests++
      response.end('{"version":"attacker"}')
    })
    const source = await listen((_request, response) => {
      response.writeHead(302, {
        Location: `${target.endpoint}/api/version`,
      })
      response.end()
    })

    try {
      const client = new OllamaClient(source.endpoint)
      await assert.rejects(client.health(), (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'network')
        assert.equal(error.message.includes(target.endpoint), false)
        return true
      })
      assert.equal(redirectedRequests, 0)
    } finally {
      await close(source.server)
      await close(target.server)
    }
  })

  it('rejects URL and header credentials before opening a connection', async () => {
    let requests = 0
    const fixture = await listen((_request, response) => {
      requests++
      response.end('{"version":"unexpected"}')
    })

    try {
      await assert.rejects(
        nodeOllamaFetch(
          `http://alice:secret@127.0.0.1:${
            new URL(fixture.endpoint).port
          }/api/version`,
          { redirect: 'error', credentials: 'omit' }
        )
      )
      await assert.rejects(
        nodeOllamaFetch(
          `http://@127.0.0.1:${new URL(fixture.endpoint).port}/api/version`,
          { redirect: 'error', credentials: 'omit' }
        )
      )
      await assert.rejects(
        nodeOllamaFetch(`${fixture.endpoint}/api/version`, {
          redirect: 'error',
          credentials: 'omit',
          headers: { Authorization: 'Bearer secret' },
        })
      )
      await assert.rejects(
        nodeOllamaFetch(`${fixture.endpoint}/prefix/api/version`, {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
        })
      )
      await assert.rejects(
        nodeOllamaFetch(`${fixture.endpoint}/api/version?token=secret`, {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
        })
      )
      await assert.rejects(
        nodeOllamaFetch(`${fixture.endpoint}/api/version?`, {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
        })
      )
      await assert.rejects(
        nodeOllamaFetch(`${fixture.endpoint}/api/version#`, {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
        })
      )
      await assert.rejects(
        nodeOllamaFetch(`${fixture.endpoint}/prefix/../api/version`, {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
        })
      )
      await assert.rejects(
        nodeOllamaFetch(`${fixture.endpoint}/api/delete`, {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
        })
      )
      assert.equal(requests, 0)
    } finally {
      await close(fixture.server)
    }
  })

  it('aborts an active native response stream', async () => {
    let closedResolve: (() => void) | undefined
    const closed = new Promise<void>(resolve => (closedResolve = resolve))
    const fixture = await listen((_request, response) => {
      response.on('close', () => closedResolve?.())
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      response.write('{"status":"pulling manifest"}\n')
    })
    const controller = new AbortController()

    try {
      const client = new OllamaClient(fixture.endpoint)
      await assert.rejects(
        client.pull('llama3.2', {
          signal: controller.signal,
          onProgress: () => controller.abort(),
        }),
        { name: 'AbortError' }
      )
      await eventually(closed)
    } finally {
      controller.abort()
      await close(fixture.server)
    }
  })

  it('enforces request deadlines against a native socket', async () => {
    let closedResolve: (() => void) | undefined
    const closed = new Promise<void>(resolve => (closedResolve = resolve))
    const fixture = await listen((request, _response) => {
      request.socket.on('close', () => closedResolve?.())
    })

    try {
      const client = new OllamaClient(fixture.endpoint)
      await assert.rejects(
        client.health({ timeoutMs: 25 }),
        (error: unknown) => {
          assert.ok(error instanceof OllamaClientError)
          assert.equal(error.kind, 'timeout')
          return true
        }
      )
      await eventually(closed)
    } finally {
      await close(fixture.server)
    }
  })
})
