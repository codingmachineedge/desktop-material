import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  MaxOllamaChatEvents,
  MaxOllamaChatResponseBytes,
  OllamaClient,
} from '../../../src/lib/ollama/client'
import {
  IOllamaChatResponseChunk,
  OllamaClientError,
  OllamaFetch,
} from '../../../src/lib/ollama/types'

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

function ndjsonResponse(lines: ReadonlyArray<string>): Response {
  return new Response(lines.join('\n'))
}

describe('Ollama chat streaming', () => {
  it('parses chunk-split NDJSON deltas and resolves the full assistant text', async () => {
    const encoder = new TextEncoder()
    const objects = [
      { message: { role: 'assistant', content: 'Hel' }, done: false },
      { message: { role: 'assistant', content: 'lo, ' }, done: false },
      { message: { role: 'assistant', content: 'friend' }, done: false },
      { message: { role: 'assistant', content: '' }, done: true },
    ]
    const body = encoder.encode(
      objects.map(value => JSON.stringify(value)).join('\n') + '\n'
    )

    const splitPoints = [1, 12, 33, 61, body.byteLength - 4]
    const chunks = new Array<Uint8Array>()
    let start = 0
    for (const end of splitPoints) {
      chunks.push(body.slice(start, end))
      start = end
    }
    chunks.push(body.slice(start))

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
    const deltas = new Array<IOllamaChatResponseChunk>()
    const client = new OllamaClient('http://localhost:11434/v1', { fetcher })

    const text = await client.chat(
      'llama3.2',
      [{ role: 'user', content: 'Hi there' }],
      { onChunk: chunk => deltas.push(chunk) }
    )

    assert.equal(text, 'Hello, friend')
    assert.deepEqual(
      deltas.map(delta => delta.content),
      ['Hel', 'lo, ', 'friend']
    )
    assert.ok(captured !== undefined)
    assertSafeRequest(captured)
    assert.equal(captured.url, 'http://localhost:11434/api/chat')
    assert.deepEqual(jsonBody(captured), {
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'Hi there' }],
      stream: true,
    })
  })

  it('cancels an active chat stream through the caller AbortSignal', async () => {
    const controller = new AbortController()
    let requestSignal: AbortSignal | null = null
    let streamCancelled = false
    const fetcher: OllamaFetch = async (_input, init = {}) => {
      requestSignal = init.signal ?? null
      return new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(
              new TextEncoder().encode(
                '{"message":{"role":"assistant","content":"partial"},"done":false}\n'
              )
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
      client.chat('llama3.2', [{ role: 'user', content: 'go' }], {
        signal: controller.signal,
        onChunk: () => controller.abort(),
      }),
      { name: 'AbortError' }
    )
    assert.equal((requestSignal as AbortSignal | null)?.aborted, true)
    assert.equal(streamCancelled, true)
  })

  it('does not start a chat for an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    let requests = 0
    const client = new OllamaClient('http://localhost:11434', {
      fetcher: async () => {
        requests++
        return ndjsonResponse(['{"message":{"content":"x"},"done":true}'])
      },
    })

    await assert.rejects(
      client.chat('llama3.2', [{ role: 'user', content: 'hi' }], {
        signal: controller.signal,
      }),
      { name: 'AbortError' }
    )
    assert.equal(requests, 0)
  })

  it('rejects a stream that ends before the done marker', async () => {
    const client = new OllamaClient('http://localhost:11434', {
      fetcher: async () =>
        ndjsonResponse(['{"message":{"content":"partial"},"done":false}']),
    })

    await assert.rejects(
      client.chat('llama3.2', [{ role: 'user', content: 'hi' }]),
      (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'response')
        return true
      }
    )
  })

  it('bounds the aggregate assistant text', async () => {
    const oversized = 'x'.repeat(MaxOllamaChatResponseBytes + 16)
    const client = new OllamaClient('http://localhost:11434', {
      fetcher: async () =>
        ndjsonResponse([
          JSON.stringify({ message: { content: oversized }, done: false }),
          JSON.stringify({ message: { content: '' }, done: true }),
        ]),
    })

    await assert.rejects(
      client.chat('llama3.2', [{ role: 'user', content: 'hi' }]),
      (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'response')
        assert.equal(error.message.includes('allowed size'), true)
        return true
      }
    )
  })

  it('bounds the number of streamed chat events', async () => {
    const lines = new Array(MaxOllamaChatEvents + 1)
      .fill('{"message":{"content":"a"},"done":false}')
      .concat('{"message":{"content":""},"done":true}')
    const client = new OllamaClient('http://localhost:11434', {
      fetcher: async () => ndjsonResponse(lines),
    })

    await assert.rejects(
      client.chat('llama3.2', [{ role: 'user', content: 'hi' }]),
      (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'response')
        return true
      }
    )
  })

  it('rejects an invalid outbound transcript before any request', async () => {
    let requests = 0
    const client = new OllamaClient('http://localhost:11434', {
      fetcher: async () => {
        requests++
        return ndjsonResponse(['{"message":{"content":""},"done":true}'])
      },
    })

    await assert.rejects(client.chat('llama3.2', []), (error: unknown) => {
      assert.ok(error instanceof OllamaClientError)
      assert.equal(error.kind, 'validation')
      return true
    })
    await assert.rejects(
      client.chat('llama3.2', [
        { role: 'system' as never, content: 'ok' },
        { role: 'weird' as never, content: 'no' },
      ]),
      (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'validation')
        return true
      }
    )
    assert.equal(requests, 0)
  })

  it('rejects a non-loopback endpoint before constructing the client', () => {
    assert.throws(
      () => new OllamaClient('http://ollama.example.com/v1'),
      (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'endpoint')
        return true
      }
    )
  })

  it('surfaces a provider stream error as a generic server failure', async () => {
    const client = new OllamaClient('http://localhost:11434', {
      fetcher: async () =>
        ndjsonResponse([
          '{"error":"model https://alice:secret@host/private not found"}',
        ]),
    })

    await assert.rejects(
      client.chat('private/model', [{ role: 'user', content: 'hi' }]),
      (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'server')
        assert.equal(error.message.includes('alice'), false)
        assert.equal(error.message.includes('secret'), false)
        return true
      }
    )
  })
})
