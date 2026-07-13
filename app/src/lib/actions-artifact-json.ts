export const ActionsArtifactJSONMaximumBytes = 1024 * 1024

export type ActionsArtifactJSONFailure =
  | 'too-large'
  | 'invalid-length'
  | 'invalid-json'

export class ActionsArtifactJSONError extends Error {
  public constructor(
    message: string,
    public readonly kind: ActionsArtifactJSONFailure
  ) {
    super(message)
    this.name = 'ActionsArtifactJSONError'
  }
}

function abortError(): Error {
  const error = new Error('Artifact request canceled.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError()
  }
}

function validateContentLength(response: Response, maximumBytes: number) {
  const raw = response.headers.get('content-length')
  if (raw === null) {
    return
  }
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new ActionsArtifactJSONError(
      'GitHub returned an invalid artifact metadata size.',
      'invalid-length'
    )
  }
  if (Number(raw) > maximumBytes) {
    throw new ActionsArtifactJSONError(
      'GitHub returned more artifact metadata than the app can process safely.',
      'too-large'
    )
  }
}

/** Read and parse JSON without ever retaining more than the explicit cap. */
export async function readBoundedActionsArtifactJSON(
  response: Response,
  signal?: AbortSignal,
  maximumBytes: number = ActionsArtifactJSONMaximumBytes
): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('Artifact JSON byte limit must be a positive integer.')
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
    throw new ActionsArtifactJSONError(
      'GitHub returned an invalid empty artifact response.',
      'invalid-json'
    )
  }

  const chunks = new Array<Uint8Array>()
  let length = 0
  const cancel = () => {
    reader.cancel(abortError()).catch(() => undefined)
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      throwIfAborted(signal)
      const next = await reader.read()
      throwIfAborted(signal)
      if (next.done) {
        break
      }
      if (length + next.value.byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throwIfAborted(signal)
        throw new ActionsArtifactJSONError(
          'GitHub returned more artifact metadata than the app can process safely.',
          'too-large'
        )
      }
      chunks.push(next.value)
      length += next.value.byteLength
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
  }

  throwIfAborted(signal)
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return JSON.parse(text) as unknown
  } catch {
    throw new ActionsArtifactJSONError(
      'GitHub returned invalid artifact metadata.',
      'invalid-json'
    )
  }
}

/** Keep only the bounded API error fields understood by the HTTP layer. */
export function parseBoundedActionsArtifactAPIError(
  value: unknown
): { readonly message?: string } | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const message = (value as Record<string, unknown>).message
  return typeof message === 'string' && message.length <= 512
    ? { message }
    : null
}
