export const ActionsMetadataJSONMaximumBytes = 2 * 1024 * 1024

export type ActionsMetadataJSONFailure =
  | 'too-large'
  | 'invalid-length'
  | 'invalid-json'

export class ActionsMetadataJSONError extends Error {
  public constructor(
    message: string,
    public readonly kind: ActionsMetadataJSONFailure
  ) {
    super(message)
    this.name = 'ActionsMetadataJSONError'
  }
}

function abortError(): Error {
  const error = new Error('Actions request canceled.')
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
    throw new ActionsMetadataJSONError(
      'GitHub returned an invalid Actions metadata size.',
      'invalid-length'
    )
  }
  if (Number(raw) > maximumBytes) {
    throw new ActionsMetadataJSONError(
      'GitHub returned more Actions metadata than the app can process safely.',
      'too-large'
    )
  }
}

/** Read and parse Actions JSON without retaining more than the explicit cap. */
export async function readBoundedActionsJSON(
  response: Response,
  signal?: AbortSignal,
  maximumBytes: number = ActionsMetadataJSONMaximumBytes
): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('Actions JSON byte limit must be a positive integer.')
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
    throw new ActionsMetadataJSONError(
      'GitHub returned an invalid empty Actions response.',
      'invalid-json'
    )
  }

  let bytes = new Uint8Array(Math.min(maximumBytes, 64 * 1024))
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
      const nextLength = length + next.value.byteLength
      if (nextLength > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throwIfAborted(signal)
        throw new ActionsMetadataJSONError(
          'GitHub returned more Actions metadata than the app can process safely.',
          'too-large'
        )
      }
      if (nextLength > bytes.byteLength) {
        const capacity = Math.min(
          maximumBytes,
          Math.max(nextLength, bytes.byteLength * 2)
        )
        const expanded = new Uint8Array(capacity)
        expanded.set(bytes.subarray(0, length))
        bytes = expanded
      }
      bytes.set(next.value, length)
      length = nextLength
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
  }

  throwIfAborted(signal)
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(0, length)
    )
    return JSON.parse(text) as unknown
  } catch {
    throw new ActionsMetadataJSONError(
      'GitHub returned invalid Actions metadata.',
      'invalid-json'
    )
  }
}

/** Keep only the bounded API error field understood by the HTTP layer. */
export function parseBoundedActionsAPIError(
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
