import assert from 'node:assert'
import { describe, it, mock } from 'node:test'
import {
  MaxOllamaJsonBodyBytes,
  MaxOllamaNdjsonLineBytes,
  MaxOllamaPullBytes,
  MaxOllamaPullEvents,
  OllamaClient,
} from '../../../src/lib/ollama/client'
import {
  IOllamaPullProgress,
  OllamaClientError,
  OllamaFetch,
} from '../../../src/lib/ollama/types'
import {
  MaxOllamaLargeTextLength,
  MaxOllamaMetadataEntries,
  MaxOllamaModelNameLength,
  MaxOllamaModels,
  MaxOllamaObjectProperties,
} from '../../../src/lib/ollama/validation'

interface ICapturedRequest {
  readonly url: string
  readonly init: RequestInit
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }
  return input instanceof URL ? input.href : input.url
}

function jsonResponse(value: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function jsonBody(request: ICapturedRequest): Record<string, unknown> {
  assert.equal(typeof request.init.body, 'string')
  return JSON.parse(request.init.body as string) as Record<string, unknown>
}

function assertSafeRequest(request: ICapturedRequest): void {
  assert.equal(request.init.redirect, 'error')
  assert.equal(request.init.credentials, 'omit')
  assert.equal(request.init.cache, 'no-store')
  assert.equal(request.init.referrerPolicy, 'no-referrer')
  assert.ok(request.init.signal instanceof AbortSignal)
}

describe('Ollama client discovery', () => {
  it('projects version, installed models, running models, and bounded metadata', async () => {
    const requests = new Array<ICapturedRequest>()
    const fetcher: OllamaFetch = async (input, init = {}) => {
      const url = requestUrl(input)
      requests.push({ url, init })
      switch (new URL(url).pathname) {
        case '/api/version':
          return jsonResponse({ version: '0.9.1', channel: 'stable' })
        case '/api/tags':
          return jsonResponse({
            models: [
              {
                name: 'llama3.2:latest',
                modified_at: '2026-07-19T20:00:00Z',
                size: 2_048,
                digest: 'sha256:abc',
                details: {
                  format: 'gguf',
                  family: 'llama',
                  families: ['llama'],
                  parameter_size: '3B',
                  quantization_level: 'Q4_K_M',
                  future_detail: true,
                },
                future_top_level: { retained: true },
              },
              { model: 'nomic-embed-text:latest' },
            ],
          })
        case '/api/ps':
          return jsonResponse({
            models: [
              {
                model: 'llama3.2:latest',
                size: 2_048,
                size_vram: 1_536,
                context_length: 8_192,
                expires_at: '2026-07-19T20:05:00Z',
                details: { family: 'llama' },
              },
            ],
          })
        case '/api/show':
          return jsonResponse({
            modelfile: 'FROM llama3.2',
            parameters: 'temperature 0.7',
            template: '{{ .Prompt }}',
            license: 'Model license',
            modified_at: '2026-07-19T20:00:00Z',
            capabilities: ['completion', 'tools'],
            details: { family: 'llama', future_detail: 'kept' },
            model_info: {
              'general.architecture': 'llama',
              'llama.context_length': 8_192,
            },
            future_show_field: ['kept'],
          })
        default:
          throw new Error(`Unexpected request: ${url}`)
      }
    }
    const client = new OllamaClient('http://localhost:11434/v1', { fetcher })

    const version = await client.health()
    const models = await client.list()
    const running = await client.listRunning()
    const shown = await client.show('llama3.2:latest')

    assert.equal(client.endpoint, 'http://localhost:11434')
    assert.equal(version.version, '0.9.1')

    assert.equal(models.length, 2)
    assert.equal(models[0].name, 'llama3.2:latest')
    assert.equal(models[0].model, 'llama3.2:latest')
    assert.equal(models[0].size, 2_048)
    assert.equal(models[0].details?.parameterSize, '3B')
    assert.deepEqual(models[0].details?.families, ['llama'])
    assert.equal(models[1].name, 'nomic-embed-text:latest')
    assert.equal(models[1].size, undefined)

    assert.equal(running.length, 1)
    assert.equal(running[0].sizeVram, 1_536)
    assert.equal(running[0].contextLength, 8_192)
    assert.equal(running[0].expiresAt, '2026-07-19T20:05:00Z')

    assert.equal(shown.modelfile, 'FROM llama3.2')
    assert.deepEqual(shown.capabilities, ['completion', 'tools'])
    assert.deepEqual(shown.modelInfo, [
      { key: 'general.architecture', value: 'llama' },
      { key: 'llama.context_length', value: 8_192 },
    ])
    assert.deepEqual(shown.projectorInfo, [])

    assert.deepEqual(
      requests.map(request => [request.init.method, request.url]),
      [
        ['GET', 'http://localhost:11434/api/version'],
        ['GET', 'http://localhost:11434/api/tags'],
        ['GET', 'http://localhost:11434/api/ps'],
        ['POST', 'http://localhost:11434/api/show'],
      ]
    )
    for (const request of requests) {
      assertSafeRequest(request)
    }
    assert.deepEqual(jsonBody(requests[3]), { model: 'llama3.2:latest' })
  })

  it('rejects malformed JSON shapes', async () => {
    const responses: ReadonlyArray<unknown> = [
      { version: 7 },
      { models: 'not-an-array' },
      {},
      { done: 'yes' },
    ]
    let index = 0
    const client = new OllamaClient('http://127.0.0.1:11434', {
      fetcher: async () => jsonResponse(responses[index++]),
    })

    for (const operation of [
      () => client.health(),
      () => client.list(),
      () => client.show('llama3.2'),
      () => client.load('llama3.2'),
    ]) {
      await assert.rejects(operation, (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'response')
        return true
      })
    }
  })

  it('rejects oversized success bodies before parsing them', async () => {
    const client = new OllamaClient('http://localhost:11434/v1', {
      fetcher: async () =>
        new Response('{"version":"safe"}', {
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': String(MaxOllamaJsonBodyBytes + 1),
          },
        }),
    })

    await assert.rejects(client.health(), (error: unknown) => {
      assert.ok(error instanceof OllamaClientError)
      assert.equal(error.kind, 'response')
      assert.equal(error.message.includes('allowed size'), true)
      return true
    })
  })

  it('bounds model collections and projected metadata entries', async () => {
    const responses = [
      {
        models: new Array(MaxOllamaModels + 1).fill({ model: 'llama3.2' }),
      },
      {
        model_info: Object.fromEntries(
          new Array(MaxOllamaMetadataEntries + 1)
            .fill(undefined)
            .map((_value, index) => [`field.${index}`, index])
        ),
      },
    ]
    let index = 0
    const client = new OllamaClient('http://127.0.0.1:11434', {
      fetcher: async () => jsonResponse(responses[index++]),
    })

    for (const operation of [
      () => client.list(),
      () => client.show('llama3.2'),
    ]) {
      await assert.rejects(operation, (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'response')
        return true
      })
    }
  })

  it('bounds strings, object properties, and numeric fields', async () => {
    const overfullObject = Object.fromEntries(
      new Array(MaxOllamaObjectProperties + 1)
        .fill(undefined)
        .map((_value, index) => [`field${index}`, index])
    )
    const responses = [
      { models: [{ model: 'x'.repeat(MaxOllamaModelNameLength + 1) }] },
      { models: [{ model: 'llama3.2', size: Number.MAX_SAFE_INTEGER + 1 }] },
      { modelfile: 'x'.repeat(MaxOllamaLargeTextLength + 1) },
      { version: '0.9.1', ...overfullObject },
    ]
    let index = 0
    const client = new OllamaClient('http://localhost:11434', {
      fetcher: async () => jsonResponse(responses[index++]),
    })

    for (const operation of [
      () => client.list(),
      () => client.list(),
      () => client.show('llama3.2'),
      () => client.health(),
    ]) {
      await assert.rejects(operation, (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'response')
        return true
      })
    }
  })
})

describe('Ollama client lifecycle operations', () => {
  it('sends exact copy, delete, preload, and unload requests', async () => {
    const requests = new Array<ICapturedRequest>()
    const fetcher: OllamaFetch = async (input, init = {}) => {
      const request = { url: requestUrl(input), init }
      requests.push(request)
      return request.url.endsWith('/api/generate')
        ? jsonResponse({ done: true, response: '' })
        : new Response(null, { status: 200 })
    }
    const client = new OllamaClient('http://localhost:11434/v1', { fetcher })

    await client.copy('llama3.2', 'llama3.2-backup')
    await client.delete('llama3.2-backup')
    await client.load('llama3.2')
    await client.unload('llama3.2')

    assert.deepEqual(
      requests.map(request => [
        request.init.method,
        new URL(request.url).pathname,
        jsonBody(request),
      ]),
      [
        [
          'POST',
          '/api/copy',
          { source: 'llama3.2', destination: 'llama3.2-backup' },
        ],
        ['DELETE', '/api/delete', { model: 'llama3.2-backup' }],
        [
          'POST',
          '/api/generate',
          { model: 'llama3.2', prompt: '', keep_alive: -1, stream: false },
        ],
        [
          'POST',
          '/api/generate',
          { model: 'llama3.2', prompt: '', keep_alive: 0, stream: false },
        ],
      ]
    )
    for (const request of requests) {
      assertSafeRequest(request)
    }
  })

  it('uses a dedicated load deadline and honors an explicit override', async () => {
    mock.timers.enable()
    try {
      const signals = new Array<AbortSignal>()
      const fetcher: OllamaFetch = async (_input, init = {}) =>
        new Promise<Response>((_resolve, reject) => {
          assert.ok(init.signal instanceof AbortSignal)
          signals.push(init.signal)
          init.signal.addEventListener(
            'abort',
            () => reject(new Error('stop')),
            {
              once: true,
            }
          )
        })
      const client = new OllamaClient('http://localhost:11434', {
        fetcher,
        requestTimeoutMs: 10,
        loadTimeoutMs: 200,
      })

      const defaultDeadline = client.load('llama3.2')
      mock.timers.tick(10)
      assert.equal(signals[0].aborted, false)
      mock.timers.tick(190)
      assert.equal(signals[0].aborted, true)
      await assert.rejects(defaultDeadline, (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'timeout')
        return true
      })

      const explicitDeadline = client.load('llama3.2', { timeoutMs: 25 })
      mock.timers.tick(24)
      assert.equal(signals[1].aborted, false)
      mock.timers.tick(1)
      assert.equal(signals[1].aborted, true)
      await assert.rejects(explicitDeadline, (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'timeout')
        return true
      })
    } finally {
      mock.timers.reset()
    }
  })

  it('returns status-only HTTP errors without provider response details', async () => {
    const secretError =
      'open https://alice:super-secret@example.com then use Bearer abc123 and token=hidden'
    const client = new OllamaClient('http://localhost:11434/v1', {
      fetcher: async () => jsonResponse({ error: secretError }, 502),
    })

    await assert.rejects(client.delete('llama3.2'), (error: unknown) => {
      assert.ok(error instanceof OllamaClientError)
      assert.equal(error.kind, 'http')
      assert.equal(error.status, 502)
      assert.equal(error.message, 'Ollama request failed with HTTP 502.')
      assert.equal(error.message.includes('alice'), false)
      assert.equal(error.message.includes('super-secret'), false)
      assert.equal(error.message.includes('abc123'), false)
      assert.equal(error.message.includes('hidden'), false)
      assert.equal(error.message.includes('[redacted]'), false)
      return true
    })
  })

  it('times out without surfacing transport error details', async () => {
    const fetcher: OllamaFetch = async (_input, init = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => reject(new Error('https://alice:secret@example.com/private')),
          { once: true }
        )
      })
    const client = new OllamaClient('http://localhost:11434/v1', {
      fetcher,
    })

    await assert.rejects(client.health({ timeoutMs: 10 }), (error: unknown) => {
      assert.ok(error instanceof OllamaClientError)
      assert.equal(error.kind, 'timeout')
      assert.equal(error.message.includes('alice'), false)
      assert.equal(error.message.includes('secret'), false)
      return true
    })
  })
})

describe('Ollama pull streaming', () => {
  it('parses chunk-split NDJSON and reports every progress event', async () => {
    const encoder = new TextEncoder()
    const wire = encoder.encode(
      [
        JSON.stringify({ status: 'pulling manifest' }),
        JSON.stringify({
          status: 'pulling modèle',
          digest: 'sha256:abc',
          total: 100,
          completed: 40,
        }),
        JSON.stringify({ status: 'success' }),
        '',
      ].join('\r\n')
    )
    const splitPoints = [1, 17, 49, 77, wire.byteLength - 3]
    const chunks = new Array<Uint8Array>()
    let start = 0
    for (const end of splitPoints) {
      chunks.push(wire.slice(start, end))
      start = end
    }
    chunks.push(wire.slice(start))

    let captured: ICapturedRequest | undefined
    const fetcher: OllamaFetch = async (input, init = {}) => {
      captured = { url: requestUrl(input), init }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(chunk)
            }
            controller.close()
          },
        })
      )
    }
    const progress = new Array<IOllamaPullProgress>()
    const client = new OllamaClient('http://localhost:11434/v1', { fetcher })

    const final = await client.pull('gemma3:4b', {
      onProgress: value => progress.push(value),
    })

    assert.deepEqual(
      progress.map(value => value.status),
      ['pulling manifest', 'pulling modèle', 'success']
    )
    assert.equal(progress[1].digest, 'sha256:abc')
    assert.equal(progress[1].total, 100)
    assert.equal(progress[1].completed, 40)
    assert.equal(final.status, 'success')
    assert.ok(captured !== undefined)
    assertSafeRequest(captured)
    assert.equal(captured.url, 'http://localhost:11434/api/pull')
    assert.deepEqual(jsonBody(captured), { model: 'gemma3:4b', stream: true })
  })

  it('cancels an active stream through the caller AbortSignal', async () => {
    const controller = new AbortController()
    let requestSignal: AbortSignal | null = null
    let streamCancelled = false
    const fetcher: OllamaFetch = async (_input, init = {}) => {
      requestSignal = init.signal ?? null
      return new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(
              new TextEncoder().encode('{"status":"pulling manifest"}\n')
            )
          },
          cancel() {
            streamCancelled = true
          },
        })
      )
    }
    const client = new OllamaClient('http://localhost:11434', { fetcher })

    await assert.rejects(
      client.pull('llama3.2', {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
      { name: 'AbortError' }
    )
    assert.equal((requestSignal as AbortSignal | null)?.aborted, true)
    assert.equal(streamCancelled, true)
  })

  it('does not start a pull for an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    let requests = 0
    const client = new OllamaClient('http://localhost:11434', {
      fetcher: async () => {
        requests++
        return jsonResponse({ status: 'success' })
      },
    })

    await assert.rejects(
      client.pull('llama3.2', { signal: controller.signal }),
      { name: 'AbortError' }
    )
    assert.equal(requests, 0)
  })

  it('enforces a total pull deadline even while progress remains active', async () => {
    let interval: ReturnType<typeof setInterval> | undefined
    let streamCancelled = false
    const client = new OllamaClient('http://localhost:11434', {
      pullTotalTimeoutMs: 30,
      pullInactivityTimeoutMs: 1_000,
      fetcher: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const progress = new TextEncoder().encode(
                '{"status":"pulling layers"}\n'
              )
              controller.enqueue(progress)
              interval = setInterval(() => controller.enqueue(progress), 5)
            },
            cancel() {
              streamCancelled = true
              if (interval !== undefined) {
                clearInterval(interval)
              }
            },
          })
        ),
    })

    await assert.rejects(client.pull('llama3.2'), (error: unknown) => {
      assert.ok(error instanceof OllamaClientError)
      assert.equal(error.kind, 'timeout')
      return true
    })
    assert.equal(streamCancelled, true)
  })

  it('enforces pull inactivity and explicitly cancels the reader', async () => {
    let streamCancelled = false
    const client = new OllamaClient('http://localhost:11434', {
      pullInactivityTimeoutMs: 20,
      pullTotalTimeoutMs: 1_000,
      fetcher: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              streamCancelled = true
            },
          })
        ),
    })

    await assert.rejects(client.pull('llama3.2'), (error: unknown) => {
      assert.ok(error instanceof OllamaClientError)
      assert.equal(error.kind, 'timeout')
      return true
    })
    assert.equal(streamCancelled, true)
  })

  it('caps aggregate pull bytes independently of line and event caps', async () => {
    let streamCancelled = false
    const client = new OllamaClient('http://localhost:11434', {
      fetcher: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(MaxOllamaPullBytes + 1))
            },
            cancel() {
              streamCancelled = true
            },
          })
        ),
    })

    await assert.rejects(client.pull('llama3.2'), (error: unknown) => {
      assert.ok(error instanceof OllamaClientError)
      assert.equal(error.kind, 'response')
      assert.equal(error.message.includes('allowed size'), true)
      return true
    })
    assert.equal(streamCancelled, true)
  })

  it('rejects malformed and oversized NDJSON progress lines', async () => {
    const bodies = [
      '{"status":\n',
      `${JSON.stringify({
        status: 'x'.repeat(MaxOllamaNdjsonLineBytes),
      })}\n`,
      `${new Array(MaxOllamaPullEvents + 1)
        .fill('{"status":"pulling layers"}')
        .join('\n')}\n`,
    ]
    let index = 0
    const client = new OllamaClient('http://localhost:11434', {
      fetcher: async () => new Response(bodies[index++]),
    })

    for (const body of bodies) {
      assert.ok(body.length > 0)
      await assert.rejects(client.pull('llama3.2'), (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'response')
        return true
      })
    }
  })

  it('treats a successful stream error object as a generic server failure', async () => {
    const client = new OllamaClient('http://localhost:11434', {
      fetcher: async () =>
        new Response(
          '{"error":"registry https://alice:secret@example.com failed"}\n'
        ),
    })

    await assert.rejects(client.pull('private/model'), (error: unknown) => {
      assert.ok(error instanceof OllamaClientError)
      assert.equal(error.kind, 'server')
      assert.equal(error.message, 'Ollama rejected the request.')
      assert.equal(error.message.includes('alice'), false)
      assert.equal(error.message.includes('secret'), false)
      return true
    })
  })
})
