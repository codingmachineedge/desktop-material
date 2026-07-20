import {
  getOllamaApiUrl,
  normalizeOllamaEndpoint,
  OllamaOperation,
} from './endpoint'
import { nodeOllamaFetch } from './transport'
import {
  IOllamaClient,
  IOllamaClientOptions,
  IOllamaModel,
  IOllamaModelInfo,
  IOllamaPullOptions,
  IOllamaPullProgress,
  IOllamaRequestOptions,
  IOllamaResponse,
  IOllamaRunningModel,
  IOllamaVersion,
  OllamaClientError,
  OllamaFetch,
} from './types'
import {
  hasServerError,
  normalizeOllamaModelName,
  parseModelsResponse,
  parsePullProgress,
  parseRunningModelsResponse,
  parseShowResponse,
  parseVersionResponse,
  validateGenerateResponse,
} from './validation'

export const DefaultOllamaRequestTimeoutMs = 30_000
export const DefaultOllamaLoadTimeoutMs = 10 * 60 * 1_000
export const DefaultOllamaPullInactivityTimeoutMs = 120_000
export const DefaultOllamaPullTotalTimeoutMs = 6 * 60 * 60 * 1_000
export const MaxOllamaJsonBodyBytes = 2 * 1_024 * 1_024
export const MaxOllamaErrorBodyBytes = 16 * 1_024
export const MaxOllamaNdjsonLineBytes = 64 * 1_024
export const MaxOllamaPullBytes = 8 * 1_024 * 1_024
export const MaxOllamaPullEvents = 4_096

const MaxTimerDelayMs = 2_147_483_647

type OllamaMethod = 'GET' | 'POST' | 'DELETE'
type TimeoutKind = 'request' | 'pull-total' | 'pull-inactivity'

interface IRequestContext {
  readonly signal: AbortSignal
  touch(): void
  timeoutKind(): TimeoutKind | undefined
  dispose(): void
}

function abortError(): Error {
  const error = new Error('The Ollama request was cancelled.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw abortError()
  }
}

function resolveTimeout(value: number | undefined, fallback: number): number {
  const timeout = value ?? fallback
  if (
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > MaxTimerDelayMs
  ) {
    throw new OllamaClientError(
      'validation',
      'The Ollama request timeout is invalid.'
    )
  }
  return timeout
}

function createRequestContext(
  callerSignal: AbortSignal | undefined,
  totalTimeoutMs: number,
  inactivityTimeoutMs?: number
): IRequestContext {
  const controller = new AbortController()
  let timeoutKind: TimeoutKind | undefined
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined

  const abortFor = (kind: TimeoutKind) => {
    if (!controller.signal.aborted) {
      timeoutKind = kind
      controller.abort()
    }
  }
  const totalTimer = setTimeout(
    () =>
      abortFor(inactivityTimeoutMs === undefined ? 'request' : 'pull-total'),
    totalTimeoutMs
  )
  const touch = () => {
    if (inactivityTimeoutMs === undefined || controller.signal.aborted) {
      return
    }
    if (inactivityTimer !== undefined) {
      clearTimeout(inactivityTimer)
    }
    inactivityTimer = setTimeout(
      () => abortFor('pull-inactivity'),
      inactivityTimeoutMs
    )
  }
  const callerAborted = () => controller.abort()

  if (callerSignal?.aborted === true) {
    controller.abort()
  } else {
    callerSignal?.addEventListener('abort', callerAborted, { once: true })
  }
  touch()

  return {
    signal: controller.signal,
    touch,
    timeoutKind: () => timeoutKind,
    dispose: () => {
      clearTimeout(totalTimer)
      if (inactivityTimer !== undefined) {
        clearTimeout(inactivityTimer)
      }
      callerSignal?.removeEventListener('abort', callerAborted)
    },
  }
}

async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  onAbort?: () => void | Promise<void>,
  onLateResolve?: (value: T) => void | Promise<void>
): Promise<T> {
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const aborted = () => {
      if (settled) {
        return
      }
      settled = true
      void Promise.resolve(onAbort?.()).catch(() => undefined)
      reject(abortError())
    }
    signal.addEventListener('abort', aborted, { once: true })

    promise.then(
      value => {
        signal.removeEventListener('abort', aborted)
        if (settled) {
          void Promise.resolve(onLateResolve?.(value)).catch(() => undefined)
          return
        }
        settled = true
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', aborted)
        if (settled) {
          return
        }
        settled = true
        reject(error)
      }
    )
  })
}

function combineBytes(
  chunks: ReadonlyArray<Uint8Array>,
  size: number
): Uint8Array {
  const combined = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return combined
}

async function cancelResponseBody(response: IOllamaResponse): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // The transport or caller may already have closed the body.
  }
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<void> {
  try {
    await reader.cancel()
  } catch {
    // The transport or caller may already have closed the stream.
  }
}

async function assertContentLength(
  response: IOllamaResponse,
  maximumBytes: number
): Promise<void> {
  const raw = response.headers.get('content-length')
  if (raw === null) {
    return
  }
  if (!/^\d+$/.test(raw)) {
    await cancelResponseBody(response)
    throw new OllamaClientError(
      'response',
      'Ollama returned an invalid response size.'
    )
  }
  const length = Number(raw)
  if (!Number.isSafeInteger(length) || length > maximumBytes) {
    await cancelResponseBody(response)
    throw new OllamaClientError(
      'response',
      'The Ollama response exceeded the allowed size.'
    )
  }
}

async function readBoundedBody(
  response: IOllamaResponse,
  maximumBytes: number,
  context: IRequestContext
): Promise<Uint8Array> {
  await assertContentLength(response, maximumBytes)
  if (response.body === null) {
    return new Uint8Array()
  }

  const reader = response.body.getReader()
  const chunks = new Array<Uint8Array>()
  let received = 0
  try {
    while (true) {
      const next = await raceWithAbort(reader.read(), context.signal, () =>
        cancelReader(reader)
      )
      throwIfAborted(context.signal)
      if (next.done) {
        return combineBytes(chunks, received)
      }
      context.touch()
      if (received + next.value.byteLength > maximumBytes) {
        await cancelReader(reader)
        throw new OllamaClientError(
          'response',
          'The Ollama response exceeded the allowed size.'
        )
      }
      if (next.value.byteLength > 0) {
        chunks.push(next.value)
        received += next.value.byteLength
      }
    }
  } catch (error) {
    await cancelReader(reader)
    throw error
  }
}

function decodeJson(bytes: Uint8Array): unknown {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new OllamaClientError(
      'response',
      'Ollama returned an invalid JSON response.'
    )
  }
  if (text.trim().length === 0) {
    throw new OllamaClientError(
      'response',
      'Ollama returned an empty JSON response.'
    )
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new OllamaClientError(
      'response',
      'Ollama returned an invalid JSON response.'
    )
  }
}

function serverError(): OllamaClientError {
  return new OllamaClientError('server', 'Ollama rejected the request.')
}

async function httpError(
  response: IOllamaResponse
): Promise<OllamaClientError> {
  await cancelResponseBody(response)
  return new OllamaClientError(
    'http',
    `Ollama request failed with HTTP ${response.status}.`,
    response.status
  )
}

function parseNdjsonLine(bytes: Uint8Array): unknown | undefined {
  const content =
    bytes.length > 0 && bytes[bytes.length - 1] === 13
      ? bytes.slice(0, -1)
      : bytes
  if (content.byteLength === 0) {
    return undefined
  }

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch {
    throw new OllamaClientError(
      'response',
      'Ollama returned invalid pull progress.'
    )
  }
  if (text.trim().length === 0) {
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new OllamaClientError(
      'response',
      'Ollama returned invalid pull progress.'
    )
  }
}

async function readPullProgress(
  response: IOllamaResponse,
  context: IRequestContext,
  options: IOllamaPullOptions
): Promise<IOllamaPullProgress> {
  await assertContentLength(response, MaxOllamaPullBytes)
  if (response.body === null) {
    throw new OllamaClientError(
      'response',
      'Ollama returned an empty pull stream.'
    )
  }

  const reader = response.body.getReader()
  const lineParts = new Array<Uint8Array>()
  let lineSize = 0
  let totalBytes = 0
  let eventCount = 0
  let lastProgress: IOllamaPullProgress | undefined

  const append = (part: Uint8Array) => {
    if (lineSize + part.byteLength > MaxOllamaNdjsonLineBytes) {
      throw new OllamaClientError(
        'response',
        'An Ollama pull progress line exceeded the allowed size.'
      )
    }
    if (part.byteLength > 0) {
      lineParts.push(part)
      lineSize += part.byteLength
    }
  }

  const emit = () => {
    const value = parseNdjsonLine(combineBytes(lineParts, lineSize))
    lineParts.length = 0
    lineSize = 0
    if (value === undefined) {
      return
    }
    eventCount++
    if (eventCount > MaxOllamaPullEvents) {
      throw new OllamaClientError(
        'response',
        'Ollama returned too many pull progress events.'
      )
    }
    if (hasServerError(value)) {
      throw serverError()
    }
    const progress = parsePullProgress(value)
    lastProgress = progress
    try {
      options.onProgress?.(progress)
    } catch {
      throw new OllamaClientError(
        'response',
        'The Ollama pull progress handler failed.'
      )
    }
    throwIfAborted(context.signal)
  }

  try {
    while (true) {
      const next = await raceWithAbort(reader.read(), context.signal, () =>
        cancelReader(reader)
      )
      throwIfAborted(context.signal)
      if (next.done) {
        if (lineSize > 0) {
          emit()
        }
        if (lastProgress === undefined || !lastProgress.done) {
          throw new OllamaClientError(
            'response',
            'The Ollama pull stream ended before completion.'
          )
        }
        return lastProgress
      }

      context.touch()
      totalBytes += next.value.byteLength
      if (totalBytes > MaxOllamaPullBytes) {
        throw new OllamaClientError(
          'response',
          'The Ollama pull stream exceeded the allowed size.'
        )
      }

      let segmentStart = 0
      for (let index = 0; index < next.value.byteLength; index++) {
        if (next.value[index] !== 10) {
          continue
        }
        append(next.value.slice(segmentStart, index))
        emit()
        segmentStart = index + 1
      }
      append(next.value.slice(segmentStart))
    }
  } catch (error) {
    await cancelReader(reader)
    throw error
  }
}

/** Native Ollama API client for model discovery and lifecycle operations. */
export class OllamaClient implements IOllamaClient {
  public readonly endpoint: string

  private readonly fetcher: OllamaFetch
  private readonly requestTimeoutMs: number
  private readonly loadTimeoutMs: number
  private readonly pullInactivityTimeoutMs: number
  private readonly pullTotalTimeoutMs: number

  public constructor(endpoint: string, options: IOllamaClientOptions = {}) {
    this.endpoint = normalizeOllamaEndpoint(endpoint)
    this.fetcher = options.fetcher ?? nodeOllamaFetch
    this.requestTimeoutMs = resolveTimeout(
      options.requestTimeoutMs,
      DefaultOllamaRequestTimeoutMs
    )
    this.loadTimeoutMs = resolveTimeout(
      options.loadTimeoutMs,
      DefaultOllamaLoadTimeoutMs
    )
    this.pullInactivityTimeoutMs = resolveTimeout(
      options.pullInactivityTimeoutMs,
      DefaultOllamaPullInactivityTimeoutMs
    )
    this.pullTotalTimeoutMs = resolveTimeout(
      options.pullTotalTimeoutMs,
      DefaultOllamaPullTotalTimeoutMs
    )
  }

  public health(options: IOllamaRequestOptions = {}): Promise<IOllamaVersion> {
    return this.requestJson('GET', 'version', undefined, options, value =>
      parseVersionResponse(value)
    )
  }

  public list(
    options: IOllamaRequestOptions = {}
  ): Promise<ReadonlyArray<IOllamaModel>> {
    return this.requestJson('GET', 'tags', undefined, options, value =>
      parseModelsResponse(value)
    )
  }

  public listRunning(
    options: IOllamaRequestOptions = {}
  ): Promise<ReadonlyArray<IOllamaRunningModel>> {
    return this.requestJson('GET', 'ps', undefined, options, value =>
      parseRunningModelsResponse(value)
    )
  }

  public show(
    model: string,
    options: IOllamaRequestOptions = {}
  ): Promise<IOllamaModelInfo> {
    return this.requestJson(
      'POST',
      'show',
      { model: normalizeOllamaModelName(model) },
      options,
      value => parseShowResponse(value)
    )
  }

  public pull(
    model: string,
    options: IOllamaPullOptions = {}
  ): Promise<IOllamaPullProgress> {
    const totalTimeoutMs = resolveTimeout(
      options.timeoutMs,
      this.pullTotalTimeoutMs
    )
    return this.request(
      'POST',
      'pull',
      { model: normalizeOllamaModelName(model), stream: true },
      options,
      totalTimeoutMs,
      this.pullInactivityTimeoutMs,
      (response, context) => readPullProgress(response, context, options)
    )
  }

  public copy(
    source: string,
    destination: string,
    options: IOllamaRequestOptions = {}
  ): Promise<void> {
    return this.requestVoid(
      'POST',
      'copy',
      {
        source: normalizeOllamaModelName(source),
        destination: normalizeOllamaModelName(destination),
      },
      options
    )
  }

  public delete(
    model: string,
    options: IOllamaRequestOptions = {}
  ): Promise<void> {
    return this.requestVoid(
      'DELETE',
      'delete',
      { model: normalizeOllamaModelName(model) },
      options
    )
  }

  public load(
    model: string,
    options: IOllamaRequestOptions = {}
  ): Promise<void> {
    return this.generateKeepAlive(model, -1, {
      ...options,
      timeoutMs: options.timeoutMs ?? this.loadTimeoutMs,
    })
  }

  public unload(
    model: string,
    options: IOllamaRequestOptions = {}
  ): Promise<void> {
    return this.generateKeepAlive(model, 0, options)
  }

  private generateKeepAlive(
    model: string,
    keepAlive: -1 | 0,
    options: IOllamaRequestOptions
  ): Promise<void> {
    return this.requestJson(
      'POST',
      'generate',
      {
        model: normalizeOllamaModelName(model),
        prompt: '',
        keep_alive: keepAlive,
        stream: false,
      },
      options,
      value => validateGenerateResponse(value)
    )
  }

  private requestVoid(
    method: OllamaMethod,
    operation: OllamaOperation,
    body: unknown,
    options: IOllamaRequestOptions
  ): Promise<void> {
    return this.request(
      method,
      operation,
      body,
      options,
      resolveTimeout(options.timeoutMs, this.requestTimeoutMs),
      undefined,
      response => cancelResponseBody(response)
    )
  }

  private requestJson<T>(
    method: OllamaMethod,
    operation: OllamaOperation,
    body: unknown,
    options: IOllamaRequestOptions,
    parse: (value: unknown) => T
  ): Promise<T> {
    return this.request(
      method,
      operation,
      body,
      options,
      resolveTimeout(options.timeoutMs, this.requestTimeoutMs),
      undefined,
      async (response, context) => {
        const value = decodeJson(
          await readBoundedBody(response, MaxOllamaJsonBodyBytes, context)
        )
        if (hasServerError(value)) {
          throw serverError()
        }
        return parse(value)
      }
    )
  }

  private async request<T>(
    method: OllamaMethod,
    operation: OllamaOperation,
    body: unknown,
    options: IOllamaRequestOptions,
    totalTimeoutMs: number,
    inactivityTimeoutMs: number | undefined,
    handle: (response: IOllamaResponse, context: IRequestContext) => Promise<T>
  ): Promise<T> {
    throwIfAborted(options.signal)
    const context = createRequestContext(
      options.signal,
      totalTimeoutMs,
      inactivityTimeoutMs
    )
    const request: RequestInit = {
      method,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: context.signal,
    }

    try {
      const response = await raceWithAbort(
        this.fetcher(getOllamaApiUrl(this.endpoint, operation), request),
        context.signal,
        undefined,
        cancelResponseBody
      )
      throwIfAborted(context.signal)
      context.touch()
      if (!response.ok) {
        throw await httpError(response)
      }
      const result = await handle(response, context)
      throwIfAborted(context.signal)
      return result
    } catch (error) {
      if (options.signal?.aborted === true) {
        throw abortError()
      }
      if (context.timeoutKind() !== undefined) {
        throw new OllamaClientError('timeout', 'The Ollama request timed out.')
      }
      if (error instanceof OllamaClientError) {
        throw error
      }
      throw new OllamaClientError(
        'network',
        'Desktop Material could not reach the Ollama endpoint.'
      )
    } finally {
      context.dispose()
    }
  }
}

export function createOllamaClient(
  endpoint: string,
  options?: IOllamaClientOptions
): IOllamaClient {
  return new OllamaClient(endpoint, options)
}
