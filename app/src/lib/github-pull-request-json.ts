import { APIError } from './http'

export const GitHubPullRequestJSONMaximumBytes = 1024 * 1024

export type GitHubPullRequestJSONFailure =
  | 'too-large'
  | 'invalid-length'
  | 'invalid-json'

export class GitHubPullRequestJSONError extends Error {
  public constructor(
    message: string,
    public readonly kind: GitHubPullRequestJSONFailure
  ) {
    super(message)
    this.name = 'GitHubPullRequestJSONError'
  }
}

function abortError(): Error {
  const error = new Error('Pull request request canceled.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError()
  }
}

function validateContentLength(response: Response, maximumBytes: number): void {
  const raw = response.headers.get('content-length')
  if (raw === null) {
    return
  }
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new GitHubPullRequestJSONError(
      'GitHub returned an invalid pull request metadata size.',
      'invalid-length'
    )
  }
  if (Number(raw) > maximumBytes) {
    throw new GitHubPullRequestJSONError(
      'GitHub returned more pull request metadata than the app can process safely.',
      'too-large'
    )
  }
}

/** Read pull request JSON without retaining more than the explicit byte cap. */
export async function readBoundedGitHubPullRequestJSON(
  response: Response,
  signal?: AbortSignal,
  maximumBytes: number = GitHubPullRequestJSONMaximumBytes
): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('Pull request JSON byte limit must be a positive integer.')
  }
  throwIfAborted(signal)
  try {
    validateContentLength(response, maximumBytes)
  } catch (error) {
    await response.body?.cancel().catch(() => undefined)
    throwIfAborted(signal)
    throw error
  }

  const reader = response.body?.getReader()
  if (reader === undefined) {
    throw new GitHubPullRequestJSONError(
      'GitHub returned an invalid empty pull request response.',
      'invalid-json'
    )
  }

  const chunks = new Array<Uint8Array>()
  let received = 0
  const cancel = () => reader.cancel(abortError()).catch(() => undefined)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      throwIfAborted(signal)
      const next = await reader.read()
      throwIfAborted(signal)
      if (next.done) {
        break
      }
      if (received + next.value.byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throwIfAborted(signal)
        throw new GitHubPullRequestJSONError(
          'GitHub returned more pull request metadata than the app can process safely.',
          'too-large'
        )
      }
      chunks.push(next.value)
      received += next.value.byteLength
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
  }

  throwIfAborted(signal)
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    ) as unknown
  } catch {
    throw new GitHubPullRequestJSONError(
      'GitHub returned invalid pull request metadata.',
      'invalid-json'
    )
  }
}

function boundedAPIError(value: unknown): { readonly message?: string } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const message = (value as Record<string, unknown>).message
  return typeof message === 'string' && message.length <= 512
    ? { message }
    : null
}

/** Parse a bounded response and preserve the repository API's typed error. */
export async function boundedGitHubPullRequestResponse(
  response: Response,
  signal?: AbortSignal
): Promise<unknown> {
  let value: unknown
  try {
    value = await readBoundedGitHubPullRequestJSON(response, signal)
  } catch (error) {
    if (!response.ok && error instanceof GitHubPullRequestJSONError) {
      throw new APIError(response, null)
    }
    throw error
  }
  if (!response.ok) {
    throw new APIError(response, boundedAPIError(value))
  }
  return value
}
