export type OllamaClientErrorKind =
  | 'endpoint'
  | 'http'
  | 'network'
  | 'response'
  | 'server'
  | 'timeout'
  | 'validation'

/** A bounded, credential-safe failure returned by the Ollama client. */
export class OllamaClientError extends Error {
  public readonly kind: OllamaClientErrorKind
  public readonly status: number | undefined

  public constructor(
    kind: OllamaClientErrorKind,
    message: string,
    status?: number
  ) {
    super(message)
    this.name = 'OllamaClientError'
    this.kind = kind
    this.status = status
  }
}

export interface IOllamaVersion {
  readonly version: string
}

export interface IOllamaModelDetails {
  readonly parentModel?: string
  readonly format?: string
  readonly family?: string
  readonly families?: ReadonlyArray<string>
  readonly parameterSize?: string
  readonly quantizationLevel?: string
}

export interface IOllamaModel {
  readonly name: string
  readonly model: string
  readonly modifiedAt?: string
  readonly size?: number
  readonly digest?: string
  readonly details?: IOllamaModelDetails
}

export interface IOllamaRunningModel extends IOllamaModel {
  readonly expiresAt?: string
  readonly sizeVram?: number
  readonly contextLength?: number
}

export type OllamaMetadataValue = string | number | boolean

/** A normalized primitive metadata entry; raw provider objects are discarded. */
export interface IOllamaMetadataEntry {
  readonly key: string
  readonly value: OllamaMetadataValue
}

export interface IOllamaModelInfo {
  readonly modelfile?: string
  readonly parameters?: string
  readonly template?: string
  readonly system?: string
  readonly license?: string
  readonly modifiedAt?: string
  readonly capabilities?: ReadonlyArray<string>
  readonly details?: IOllamaModelDetails
  readonly modelInfo: ReadonlyArray<IOllamaMetadataEntry>
  readonly projectorInfo: ReadonlyArray<IOllamaMetadataEntry>
}

export interface IOllamaPullProgress {
  readonly status: string
  readonly digest?: string
  readonly total?: number
  readonly completed?: number
  readonly done: boolean
}

export interface IOllamaRequestOptions {
  readonly signal?: AbortSignal
  /** Total operation deadline. */
  readonly timeoutMs?: number
}

export interface IOllamaPullOptions extends IOllamaRequestOptions {
  readonly onProgress?: (progress: IOllamaPullProgress) => void
}

/** The fetch response subset consumed by the bounded Ollama client. */
export interface IOllamaResponse {
  readonly body: ReadableStream<Uint8Array> | null
  readonly headers: Headers
  readonly ok: boolean
  readonly status: number
}

export type OllamaFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<IOllamaResponse>

export interface IOllamaClientOptions {
  readonly fetcher?: OllamaFetch
  readonly requestTimeoutMs?: number
  /** Total deadline for the potentially slow first model load. */
  readonly loadTimeoutMs?: number
  readonly pullInactivityTimeoutMs?: number
  readonly pullTotalTimeoutMs?: number
}

/** The bounded operation surface consumed by the model-manager store. */
export interface IOllamaClient {
  readonly endpoint: string

  health(options?: IOllamaRequestOptions): Promise<IOllamaVersion>
  list(options?: IOllamaRequestOptions): Promise<ReadonlyArray<IOllamaModel>>
  listRunning(
    options?: IOllamaRequestOptions
  ): Promise<ReadonlyArray<IOllamaRunningModel>>
  show(
    model: string,
    options?: IOllamaRequestOptions
  ): Promise<IOllamaModelInfo>
  pull(
    model: string,
    options?: IOllamaPullOptions
  ): Promise<IOllamaPullProgress>
  copy(
    source: string,
    destination: string,
    options?: IOllamaRequestOptions
  ): Promise<void>
  delete(model: string, options?: IOllamaRequestOptions): Promise<void>
  load(model: string, options?: IOllamaRequestOptions): Promise<void>
  unload(model: string, options?: IOllamaRequestOptions): Promise<void>
}
