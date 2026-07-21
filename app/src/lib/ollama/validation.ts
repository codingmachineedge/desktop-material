import {
  IOllamaChatMessage,
  IOllamaChatResponseChunk,
  IOllamaMetadataEntry,
  IOllamaModel,
  IOllamaModelDetails,
  IOllamaModelInfo,
  IOllamaPullProgress,
  IOllamaRunningModel,
  IOllamaVersion,
  OllamaChatRole,
  OllamaClientError,
} from './types'

export const MaxOllamaObjectProperties = 256
export const MaxOllamaModels = 512
export const MaxOllamaFamilies = 32
export const MaxOllamaCapabilities = 64
export const MaxOllamaMetadataEntries = 256
export const MaxOllamaModelNameLength = 512
export const MaxOllamaIdentityLength = 1_024
export const MaxOllamaMetadataKeyLength = 256
export const MaxOllamaMetadataValueLength = 2_048
export const MaxOllamaLargeTextLength = 64 * 1_024
export const MaxOllamaChatMessageLength = MaxOllamaLargeTextLength
export const MaxOllamaChatMessages = 256

const OllamaChatRoles: ReadonlySet<string> = new Set<OllamaChatRole>([
  'system',
  'user',
  'assistant',
])

const MaxVersionLength = 256
const MaxDateLength = 128
const MaxDigestLength = 256
const MaxProgressStatusLength = 512
const UnsafeObjectKeys = new Set(['__proto__', 'constructor', 'prototype'])

function malformedResponse(message: string): OllamaClientError {
  return new OllamaClientError('response', message)
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireObject(
  value: unknown,
  message: string,
  allowEmpty: boolean = true
): Record<string, unknown> {
  if (!isJsonObject(value)) {
    throw malformedResponse(message)
  }
  const keys = Object.keys(value)
  if (
    (!allowEmpty && keys.length === 0) ||
    keys.length > MaxOllamaObjectProperties
  ) {
    throw malformedResponse(message)
  }
  return value
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  maximumLength: number,
  message: string
): string | undefined {
  const value = record[key]
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw malformedResponse(message)
  }
  return value
}

function requiredNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  maximumLength: number,
  message: string
): string {
  const value = optionalString(record, key, maximumLength, message)
  if (value === undefined || value.trim().length === 0) {
    throw malformedResponse(message)
  }
  return value
}

function optionalSafeInteger(
  record: Record<string, unknown>,
  key: string,
  message: string
): number | undefined {
  const value = record[key]
  if (value === undefined || value === null) {
    return undefined
  }
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw malformedResponse(message)
  }
  return value as number
}

function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  maximumItems: number,
  maximumItemLength: number,
  message: string
): ReadonlyArray<string> | undefined {
  const value = record[key]
  if (value === undefined || value === null) {
    return undefined
  }
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw malformedResponse(message)
  }
  const result = new Array<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length > maximumItemLength) {
      throw malformedResponse(message)
    }
    result.push(entry)
  }
  return result
}

function parseDetails(
  value: unknown,
  message: string
): IOllamaModelDetails | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  const details = requireObject(value, message)
  return {
    parentModel: optionalString(
      details,
      'parent_model',
      MaxOllamaIdentityLength,
      message
    ),
    format: optionalString(details, 'format', MaxOllamaIdentityLength, message),
    family: optionalString(details, 'family', MaxOllamaIdentityLength, message),
    families: optionalStringArray(
      details,
      'families',
      MaxOllamaFamilies,
      MaxOllamaIdentityLength,
      message
    ),
    parameterSize: optionalString(
      details,
      'parameter_size',
      MaxOllamaIdentityLength,
      message
    ),
    quantizationLevel: optionalString(
      details,
      'quantization_level',
      MaxOllamaIdentityLength,
      message
    ),
  }
}

function parseModel(value: unknown, message: string): IOllamaModel {
  const record = requireObject(value, message)
  const name = optionalString(record, 'name', MaxOllamaModelNameLength, message)
  const model = optionalString(
    record,
    'model',
    MaxOllamaModelNameLength,
    message
  )
  const identity = name ?? model
  if (identity === undefined || identity.trim().length === 0) {
    throw malformedResponse(message)
  }

  return {
    name: name ?? identity,
    model: model ?? identity,
    modifiedAt: optionalString(record, 'modified_at', MaxDateLength, message),
    size: optionalSafeInteger(record, 'size', message),
    digest: optionalString(record, 'digest', MaxDigestLength, message),
    details: parseDetails(record.details, message),
  }
}

function requireModels(
  value: unknown,
  message: string
): ReadonlyArray<unknown> {
  const record = requireObject(value, message)
  if (!Array.isArray(record.models) || record.models.length > MaxOllamaModels) {
    throw malformedResponse(message)
  }
  return record.models
}

function parseMetadataEntries(
  value: unknown,
  message: string
): ReadonlyArray<IOllamaMetadataEntry> {
  if (value === undefined || value === null) {
    return []
  }
  const record = requireObject(value, message)
  const keys = Object.keys(record)
  if (keys.length > MaxOllamaMetadataEntries) {
    throw malformedResponse(message)
  }

  const entries = new Array<IOllamaMetadataEntry>()
  for (const key of keys.sort()) {
    if (
      key.length === 0 ||
      key.length > MaxOllamaMetadataKeyLength ||
      UnsafeObjectKeys.has(key)
    ) {
      throw malformedResponse(message)
    }
    const value = record[key]
    if (typeof value === 'string') {
      if (value.length > MaxOllamaMetadataValueLength) {
        throw malformedResponse(message)
      }
      entries.push({ key, value })
    } else if (typeof value === 'boolean') {
      entries.push({ key, value })
    } else if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) {
        throw malformedResponse(message)
      }
      entries.push({ key, value })
    }
  }
  return entries
}

export function normalizeOllamaModelName(value: string): string {
  if (
    value.length === 0 ||
    value.length > MaxOllamaModelNameLength ||
    value !== value.trim() ||
    !/^[A-Za-z0-9][A-Za-z0-9._/@:-]*$/.test(value)
  ) {
    throw new OllamaClientError(
      'validation',
      'The Ollama model name is invalid.'
    )
  }
  return value
}

export function parseVersionResponse(value: unknown): IOllamaVersion {
  const message = 'Ollama returned a malformed version response.'
  const record = requireObject(value, message)
  return {
    version: requiredNonEmptyString(
      record,
      'version',
      MaxVersionLength,
      message
    ),
  }
}

export function parseModelsResponse(
  value: unknown
): ReadonlyArray<IOllamaModel> {
  const message = 'Ollama returned a malformed model list.'
  return requireModels(value, message).map(entry => parseModel(entry, message))
}

export function parseRunningModelsResponse(
  value: unknown
): ReadonlyArray<IOllamaRunningModel> {
  const message = 'Ollama returned a malformed running-model list.'
  return requireModels(value, message).map(entry => {
    const record = requireObject(entry, message)
    return {
      ...parseModel(record, message),
      expiresAt: optionalString(record, 'expires_at', MaxDateLength, message),
      sizeVram: optionalSafeInteger(record, 'size_vram', message),
      contextLength: optionalSafeInteger(record, 'context_length', message),
    }
  })
}

export function parseShowResponse(value: unknown): IOllamaModelInfo {
  const message = 'Ollama returned malformed model information.'
  const record = requireObject(value, message, false)
  return {
    modelfile: optionalString(
      record,
      'modelfile',
      MaxOllamaLargeTextLength,
      message
    ),
    parameters: optionalString(
      record,
      'parameters',
      MaxOllamaLargeTextLength,
      message
    ),
    template: optionalString(
      record,
      'template',
      MaxOllamaLargeTextLength,
      message
    ),
    system: optionalString(record, 'system', MaxOllamaLargeTextLength, message),
    license: optionalString(
      record,
      'license',
      MaxOllamaLargeTextLength,
      message
    ),
    modifiedAt: optionalString(record, 'modified_at', MaxDateLength, message),
    capabilities: optionalStringArray(
      record,
      'capabilities',
      MaxOllamaCapabilities,
      MaxOllamaIdentityLength,
      message
    ),
    details: parseDetails(record.details, message),
    modelInfo: parseMetadataEntries(record.model_info, message),
    projectorInfo: parseMetadataEntries(record.projector_info, message),
  }
}

export function parsePullProgress(value: unknown): IOllamaPullProgress {
  const message = 'Ollama returned malformed pull progress.'
  const record = requireObject(value, message)
  const status = requiredNonEmptyString(
    record,
    'status',
    MaxProgressStatusLength,
    message
  )
  const total = optionalSafeInteger(record, 'total', message)
  const completed = optionalSafeInteger(record, 'completed', message)
  if (total !== undefined && completed !== undefined && completed > total) {
    throw malformedResponse(message)
  }
  return {
    status,
    digest: optionalString(record, 'digest', MaxDigestLength, message),
    total,
    completed,
    done: status.toLowerCase() === 'success',
  }
}

/**
 * Validate and normalize an outbound chat transcript. Roles are restricted to
 * the known set, content is bounded, and only the two wire fields are kept so
 * no caller-attached metadata is serialized to the endpoint.
 */
export function normalizeOllamaChatMessages(
  messages: ReadonlyArray<IOllamaChatMessage>
): ReadonlyArray<IOllamaChatMessage> {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new OllamaClientError(
      'validation',
      'The Ollama chat transcript is empty.'
    )
  }
  if (messages.length > MaxOllamaChatMessages) {
    throw new OllamaClientError(
      'validation',
      'The Ollama chat transcript is too long.'
    )
  }
  return messages.map(message => {
    if (
      message === null ||
      typeof message !== 'object' ||
      !OllamaChatRoles.has(message.role) ||
      typeof message.content !== 'string' ||
      message.content.length > MaxOllamaChatMessageLength
    ) {
      throw new OllamaClientError(
        'validation',
        'The Ollama chat message is invalid.'
      )
    }
    return { role: message.role, content: message.content }
  })
}

export function parseChatResponseChunk(
  value: unknown
): IOllamaChatResponseChunk {
  const message = 'Ollama returned a malformed chat response.'
  const record = requireObject(value, message)
  const done = record.done
  if (typeof done !== 'boolean') {
    throw malformedResponse(message)
  }

  let role: OllamaChatRole | undefined
  let content = ''
  if (record.message !== undefined && record.message !== null) {
    const chatMessage = requireObject(record.message, message)
    const rawRole = optionalString(
      chatMessage,
      'role',
      MaxOllamaIdentityLength,
      message
    )
    if (rawRole !== undefined) {
      if (!OllamaChatRoles.has(rawRole)) {
        throw malformedResponse(message)
      }
      role = rawRole as OllamaChatRole
    }
    content =
      optionalString(
        chatMessage,
        'content',
        MaxOllamaChatMessageLength,
        message
      ) ?? ''
  }

  return { role, content, done }
}

export function validateGenerateResponse(value: unknown): void {
  const message = 'Ollama returned a malformed generate response.'
  const record = requireObject(value, message, false)
  if (record.done !== true) {
    throw malformedResponse(message)
  }
}

/** Detect a provider-declared error without trusting its value shape. */
export function hasServerError(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    Object.prototype.hasOwnProperty.call(value, 'error') &&
    value.error !== undefined &&
    value.error !== null
  )
}
