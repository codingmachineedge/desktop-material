import assert from 'node:assert'
import { describe, it } from 'node:test'

import {
  boundedGitHubPullRequestResponse,
  GitHubPullRequestJSONError,
  GitHubPullRequestJSONMaximumBytes,
  readBoundedGitHubPullRequestJSON,
} from '../../src/lib/github-pull-request-json'
import { APIError } from '../../src/lib/http'

describe('bounded GitHub pull request JSON', () => {
  it('parses a response at the explicit byte limit', async () => {
    const body = JSON.stringify({ number: 42 })
    assert.deepEqual(
      await readBoundedGitHubPullRequestJSON(
        new Response(body),
        undefined,
        body.length
      ),
      { number: 42 }
    )
  })

  it('rejects invalid lengths and streamed bodies above the cap', async () => {
    let invalidLengthCanceled = false
    const invalidLengthResponse = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          invalidLengthCanceled = true
        },
      }),
      { headers: { 'Content-Length': '1e3' } }
    )
    await assert.rejects(
      readBoundedGitHubPullRequestJSON(invalidLengthResponse, undefined, 100),
      (error: GitHubPullRequestJSONError) => error.kind === 'invalid-length'
    )
    assert.equal(invalidLengthCanceled, true)

    let streamedCanceled = false
    const streamedResponse = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(80))
          controller.enqueue(new Uint8Array(80))
        },
        cancel() {
          streamedCanceled = true
        },
      })
    )
    await assert.rejects(
      readBoundedGitHubPullRequestJSON(streamedResponse, undefined, 100),
      (error: GitHubPullRequestJSONError) => error.kind === 'too-large'
    )
    assert.equal(streamedCanceled, true)
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
    const reading = readBoundedGitHubPullRequestJSON(
      response,
      controller.signal,
      100
    )
    controller.abort()
    await assert.rejects(reading, { name: 'AbortError' })
    assert.equal(canceled, true)
  })

  it('bounds provider errors and never echoes oversized error messages', async () => {
    await assert.rejects(
      boundedGitHubPullRequestResponse(
        new Response(JSON.stringify({ message: 'Denied' }), { status: 403 })
      ),
      (error: APIError) =>
        error.responseStatus === 403 && error.apiError?.message === 'Denied'
    )

    await assert.rejects(
      boundedGitHubPullRequestResponse(
        new Response(JSON.stringify({ message: 'x'.repeat(513) }), {
          status: 403,
        })
      ),
      (error: APIError) =>
        error.responseStatus === 403 && error.apiError === null
    )

    await assert.rejects(
      boundedGitHubPullRequestResponse(
        new Response('{}', {
          status: 403,
          headers: {
            'Content-Length': String(GitHubPullRequestJSONMaximumBytes + 1),
          },
        }),
        undefined
      ),
      (error: APIError) =>
        error.responseStatus === 403 && error.apiError === null
    )
  })
})
