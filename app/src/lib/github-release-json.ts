import { APIError } from './http'

export const GitHubReleaseJSONMaximumBytes = 2 * 1024 * 1024
/** Exact releases can embed all 1,000 full asset records. */
export const GitHubReleaseExactJSONMaximumBytes = 8 * 1024 * 1024

export class GitHubReleaseJSONError extends Error {
  public constructor(
    message: string,
    public readonly kind: 'too-large' | 'invalid-length' | 'invalid-json'
  ) {
    super(message)
    this.name = 'GitHubReleaseJSONError'
  }
}

function abortError(): Error {
  const error = new Error('GitHub Releases request canceled.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw abortError()
  }
}

/** Read release metadata without retaining more than the explicit byte cap. */
export async function readBoundedGitHubReleaseJSON(
  response: Response,
  signal?: AbortSignal,
  maximumBytes: number = GitHubReleaseJSONMaximumBytes
): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('Release JSON byte limit must be a positive integer.')
  }
  throwIfAborted(signal)
  const length = response.headers.get('content-length')
  if (length !== null) {
    if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) {
      await response.body?.cancel().catch(() => undefined)
      throw new GitHubReleaseJSONError(
        'GitHub returned an invalid release metadata size.',
        'invalid-length'
      )
    }
    if (Number(length) > maximumBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new GitHubReleaseJSONError(
        'GitHub returned more release metadata than the app can process safely.',
        'too-large'
      )
    }
  }

  const reader = response.body?.getReader()
  if (reader === undefined) {
    throw new GitHubReleaseJSONError(
      'GitHub returned an invalid empty release response.',
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
        throw new GitHubReleaseJSONError(
          'GitHub returned more release metadata than the app can process safely.',
          'too-large'
        )
      }
      chunks.push(next.value)
      received += next.value.byteLength
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
  }

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
    throw new GitHubReleaseJSONError(
      'GitHub returned invalid release metadata.',
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
export async function boundedGitHubReleaseResponse(
  response: Response,
  signal?: AbortSignal,
  maximumBytes: number = GitHubReleaseJSONMaximumBytes
): Promise<unknown> {
  let value: unknown
  try {
    value = await readBoundedGitHubReleaseJSON(response, signal, maximumBytes)
  } catch (error) {
    if (!response.ok && error instanceof GitHubReleaseJSONError) {
      throw new APIError(response, null)
    }
    throw error
  }
  if (!response.ok) {
    throw new APIError(response, boundedAPIError(value))
  }
  return value
}
