import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  ActionsArtifactJSONError,
  parseBoundedActionsArtifactAPIError,
  readBoundedActionsArtifactJSON,
} from '../../src/lib/actions-artifact-json'

describe('bounded Actions artifact JSON', () => {
  it('parses a response at the explicit byte limit', async () => {
    const body = JSON.stringify({ artifacts: [] })
    assert.deepEqual(
      await readBoundedActionsArtifactJSON(
        new Response(body),
        undefined,
        body.length
      ),
      { artifacts: [] }
    )
  })

  it('rejects advertised and streamed bodies above the cap', async () => {
    await assert.rejects(
      readBoundedActionsArtifactJSON(
        new Response('{}', { headers: { 'Content-Length': '101' } }),
        undefined,
        100
      ),
      (error: ActionsArtifactJSONError) => error.kind === 'too-large'
    )

    let canceled = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(80))
          controller.enqueue(new Uint8Array(80))
        },
        cancel() {
          canceled = true
        },
      })
    )
    await assert.rejects(
      readBoundedActionsArtifactJSON(response, undefined, 100),
      (error: ActionsArtifactJSONError) => error.kind === 'too-large'
    )
    assert.equal(canceled, true)
  })

  it('cancels a pending reader with the exact AbortSignal', async () => {
    const controller = new AbortController()
    let canceled = false
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          canceled = true
        },
      })
    )
    const reading = readBoundedActionsArtifactJSON(
      response,
      controller.signal,
      100
    )
    controller.abort()
    await assert.rejects(reading, { name: 'AbortError' })
    assert.equal(canceled, true)
  })

  it('rejects invalid JSON and bounds provider error copy', async () => {
    await assert.rejects(
      readBoundedActionsArtifactJSON(new Response('{'), undefined, 10),
      (error: ActionsArtifactJSONError) => error.kind === 'invalid-json'
    )
    assert.deepEqual(
      parseBoundedActionsArtifactAPIError({ message: 'Denied' }),
      {
        message: 'Denied',
      }
    )
    assert.equal(
      parseBoundedActionsArtifactAPIError({ message: 'x'.repeat(513) }),
      null
    )
  })
})
