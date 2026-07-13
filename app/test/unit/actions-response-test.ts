import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  ActionsMetadataJSONError,
  parseBoundedActionsAPIError,
  readBoundedActionsJSON,
} from '../../src/lib/actions-response'

describe('bounded Actions responses', () => {
  it('parses many single-byte chunks without retaining an unbounded chunk list', async () => {
    const expected = {
      message: 'tiny chunks',
      jobs: Array.from({ length: 80 }, (_, index) => ({ id: index + 1 })),
    }
    const payload = new TextEncoder().encode(JSON.stringify(expected))
    let offset = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= payload.length) {
          controller.close()
          return
        }
        controller.enqueue(payload.subarray(offset, offset + 1))
        offset++
      },
    })

    const value = await readBoundedActionsJSON(
      new Response(stream),
      undefined,
      payload.length
    )
    assert.deepEqual(value, expected)
    assert.equal(offset, payload.length)
  })

  it('rejects declared and streamed payloads beyond the caller cap', async () => {
    await assert.rejects(
      readBoundedActionsJSON(
        new Response('{}', { headers: { 'content-length': '3' } }),
        undefined,
        2
      ),
      (error: unknown) =>
        error instanceof ActionsMetadataJSONError && error.kind === 'too-large'
    )
    await assert.rejects(
      readBoundedActionsJSON(new Response('{"long":true}'), undefined, 4),
      (error: unknown) =>
        error instanceof ActionsMetadataJSONError && error.kind === 'too-large'
    )
  })

  it('keeps only one short API error message', () => {
    assert.deepEqual(parseBoundedActionsAPIError({ message: 'Unavailable' }), {
      message: 'Unavailable',
    })
    assert.equal(
      parseBoundedActionsAPIError({ message: 'x'.repeat(513) }),
      null
    )
    assert.equal(parseBoundedActionsAPIError(['Unavailable']), null)
  })
})
