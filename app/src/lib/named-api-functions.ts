import { Account, getAccountKey } from '../models/account'
import { createHash, randomUUID } from 'crypto'
import { Repository } from '../models/repository'
import {
  IGitHubAPIOperation,
  resolveGitHubAPIOperationCatalog,
} from './github-api-operation-catalog'
import {
  assessGitHubAPIWorkbenchRequest,
  getExecutableGraphQLText,
  GitHubAPIWorkbenchMethod,
  GitHubAPIWorkbenchRequest,
  GitHubAPIWorkbenchRisk,
  validateGitHubAPIWorkbenchRequest,
} from './github-api-workbench'

export const NamedAPIFunctionsFileVersion = 1 as const
export const NamedAPIFunctionsStorageKey = 'named-api-functions-v1'
export const NamedAPIFunctionOwner = 'github-api-explorer' as const
export const NamedAPIFunctionToolPrefix = 'github_api_'
export const NamedAPIFunctionLimit = 64
export const NamedAPIFunctionDefinitionByteLimit = 256 * 1024
export const NamedAPIFunctionDocumentByteLimit = 2 * 1024 * 1024

const FunctionNamePattern = /^[a-z][a-z0-9_-]{0,63}$/
const CredentialKeyPattern =
  /(?:^|[-_])(authorization|cookie|credential|password|private[-_]?key|secret|signature|token|api[-_]?key)(?:$|[-_])/i
const CredentialTextPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /\bBasic\s+[A-Za-z0-9+/=-]+/i,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/i,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
]
const ReservedParameterNames = new Set([
  '__proto__',
  'prototype',
  'constructor',
])

type JSONSchemaPrimitiveType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null'

export interface INamedAPIFunctionParameterSchema {
  readonly type: 'object'
  readonly additionalProperties: false
  readonly properties: Readonly<
    Record<
      string,
      {
        readonly type?: JSONSchemaPrimitiveType
        readonly enum?: ReadonlyArray<unknown>
        readonly description?: string
        readonly maxLength?: number
      }
    >
  >
  readonly required?: ReadonlyArray<string>
}

export interface INamedAPIFunctionBinding {
  readonly provider: 'github'
  readonly repositoryPath: string
  /** Fingerprint of the stable path/remote/account binding, not mutable UI state. */
  readonly repositoryHash: string
  readonly remoteFullName: string
  readonly endpoint: string
  /** Stable key only. The account token remains in the credential store. */
  readonly accountKey: string
}

export interface INamedRESTAPIFunctionTemplate {
  readonly mode: 'rest'
  /** Exact pinned product catalog used to validate this function. */
  readonly catalogId: string
  readonly method: GitHubAPIWorkbenchMethod
  readonly pathTemplate: string
  readonly bodyText: string
  readonly queryParameters: ReadonlyArray<string>
}

export interface INamedGraphQLAPIFunctionTemplate {
  readonly mode: 'graphql'
  readonly query: string
  readonly variables: Readonly<Record<string, unknown>>
  readonly operationName?: string
}

export type NamedAPIFunctionTemplate =
  | INamedRESTAPIFunctionTemplate
  | INamedGraphQLAPIFunctionTemplate

export interface INamedAPIFunctionDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly owner: typeof NamedAPIFunctionOwner
  readonly operationId: string
  readonly risk: GitHubAPIWorkbenchRisk
  readonly binding: INamedAPIFunctionBinding
  readonly parameterSchema: INamedAPIFunctionParameterSchema
  readonly template: NamedAPIFunctionTemplate
  readonly createdAt: string
  readonly updatedAt: string
}

export interface INamedAPIFunctionsDocument {
  readonly version: typeof NamedAPIFunctionsFileVersion
  readonly functions: ReadonlyArray<INamedAPIFunctionDefinition>
}

export interface INamedAPIFunctionDraft {
  readonly id?: string
  readonly name: string
  readonly description: string
  readonly operationId: string
  readonly binding: INamedAPIFunctionBinding
  readonly request: GitHubAPIWorkbenchRequest
  readonly now?: Date
}

export interface INamedAPIFunctionInvocation {
  readonly request: GitHubAPIWorkbenchRequest
  readonly risk: GitHubAPIWorkbenchRisk
  readonly requiresConfirmation: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Treat camelCase credential fields like their snake/kebab-case forms. */
function isCredentialShapedKey(value: string): boolean {
  const delimited = value.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  return (
    CredentialKeyPattern.test(value) || CredentialKeyPattern.test(delimited)
  )
}

function containsCredentialShapedGraphQLField(query: string): boolean {
  const executable = getExecutableGraphQLText(query)
  for (const match of executable.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
    if (isCredentialShapedKey(match[1])) {
      return true
    }
  }
  return false
}

function stringValue(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false
): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`)
  }
  const normalized = value.trim()
  if (!allowEmpty && normalized.length === 0) {
    throw new Error(`${label} is required.`)
  }
  if (normalized.length > maximum) {
    throw new Error(`${label} is limited to ${maximum} characters.`)
  }
  return normalized
}

function assertNoStoredCredentials(
  value: unknown,
  path = 'definition',
  depth = 0
): void {
  if (depth > 12) {
    throw new Error(`${path} is nested too deeply.`)
  }
  if (typeof value === 'string') {
    if (CredentialTextPatterns.some(pattern => pattern.test(value))) {
      throw new Error(`${path} contains credential-shaped text.`)
    }
    return
  }
  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw new Error(`${path} has too many items.`)
    }
    value.forEach((child, index) =>
      assertNoStoredCredentials(child, `${path}[${index}]`, depth + 1)
    )
    return
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
    if (entries.length > 100) {
      throw new Error(`${path} has too many properties.`)
    }
    for (const [key, child] of entries) {
      if (isCredentialShapedKey(key)) {
        throw new Error(`${path}.${key} is a credential-shaped field.`)
      }
      assertNoStoredCredentials(child, `${path}.${key}`, depth + 1)
    }
  }
}

function catalogParameterType(type: string): JSONSchemaPrimitiveType {
  switch (type.toLocaleLowerCase()) {
    case 'integer':
      return 'integer'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
      return 'array'
    default:
      return 'string'
  }
}

function schemaForRESTOperation(
  operation: IGitHubAPIOperation,
  pathTemplate: string,
  defaultBody: unknown
): INamedAPIFunctionParameterSchema {
  const properties: Record<
    string,
    {
      type?: JSONSchemaPrimitiveType
      enum?: ReadonlyArray<unknown>
      description?: string
      maxLength?: number
    }
  > = {}
  const required = new Set<string>()
  const unresolvedPathParameters = new Set(
    [...pathTemplate.matchAll(/\{([^{}]+)\}/g)].map(match => match[1])
  )

  for (const parameter of operation.parameters) {
    if (
      parameter.in === 'path' &&
      !unresolvedPathParameters.has(parameter.name)
    ) {
      continue
    }
    if (
      ReservedParameterNames.has(parameter.name) ||
      isCredentialShapedKey(parameter.name)
    ) {
      throw new Error('The REST operation contains an unsafe parameter name.')
    }
    properties[parameter.name] = {
      ...(parameter.values === undefined
        ? { type: catalogParameterType(parameter.type) }
        : { enum: parameter.values }),
      description: `${parameter.in} parameter for ${operation.id}`,
      ...(catalogParameterType(parameter.type) === 'string'
        ? { maxLength: 4096 }
        : {}),
    }
    if (parameter.required || parameter.in === 'path') {
      required.add(parameter.name)
    }
  }
  if (defaultBody !== undefined) {
    if (Object.prototype.hasOwnProperty.call(properties, 'body')) {
      throw new Error("The REST operation reserves the 'body' parameter name.")
    }
    properties.body = {
      type: schemaTypeForValue(defaultBody),
      description: `JSON request body for ${operation.id}`,
    }
  }

  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.size === 0 ? {} : { required: [...required] }),
  }
}

function schemaTypeForValue(value: unknown): JSONSchemaPrimitiveType {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  switch (typeof value) {
    case 'boolean':
      return 'boolean'
    case 'number':
      return Number.isInteger(value) ? 'integer' : 'number'
    case 'object':
      return 'object'
    default:
      return 'string'
  }
}

function schemaForGraphQL(
  query: string,
  variables: Readonly<Record<string, unknown>>
): INamedAPIFunctionParameterSchema {
  const properties: Record<
    string,
    { type: JSONSchemaPrimitiveType; description: string; maxLength?: number }
  > = {}
  const required = new Set<string>()
  for (const [name, value] of Object.entries(variables)) {
    if (
      ReservedParameterNames.has(name) ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)
    ) {
      throw new Error('GraphQL variables contain an unsafe name.')
    }
    const type = schemaTypeForValue(value)
    properties[name] = {
      type,
      description: 'GraphQL variable',
      ...(type === 'string' ? { maxLength: 32768 } : {}),
    }
    const declaration = new RegExp(`\\$${escapeRegExp(name)}\\s*:\\s*[^,)]+!`)
    if (declaration.test(query)) {
      required.add(name)
    }
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.size === 0 ? {} : { required: [...required] }),
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function makeDefinitionId(name: string, now: Date): string {
  return `github-api:${name}:${now.getTime().toString(36)}:${randomUUID()}`
}

function repositoryBindingFingerprint(
  repositoryPath: string,
  remoteFullName: string,
  endpoint: string,
  accountKey: string
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'github-api-function-binding-v1',
        repositoryPath,
        remoteFullName,
        endpoint,
        accountKey,
      ])
    )
    .digest('hex')
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function assertDefinitionSize(definition: INamedAPIFunctionDefinition): void {
  if (
    byteLength(JSON.stringify(definition)) > NamedAPIFunctionDefinitionByteLimit
  ) {
    throw new Error(
      `Named API functions are limited to ${NamedAPIFunctionDefinitionByteLimit} bytes each.`
    )
  }
}

function assertISOTime(value: string, label: string): string {
  const time = stringValue(value, label, 64)
  const parsed = new Date(time)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== time) {
    throw new Error(`${label} must be an ISO timestamp.`)
  }
  return time
}

function expectedOperationPath(
  operation: IGitHubAPIOperation,
  binding: INamedAPIFunctionBinding
): string {
  const separator = binding.remoteFullName.indexOf('/')
  if (separator < 1 || separator === binding.remoteFullName.length - 1) {
    throw new Error('Repository binding must contain an owner and name.')
  }
  const owner = binding.remoteFullName.slice(0, separator)
  const repository = binding.remoteFullName.slice(separator + 1)
  return operation.path
    .replace(/\{owner\}/g, encodeURIComponent(owner))
    .replace(/\{repo\}/g, encodeURIComponent(repository))
    .replace(/^\/+/, '')
}

function assertRESTPathMatchesOperation(
  path: string,
  operation: IGitHubAPIOperation,
  binding: INamedAPIFunctionBinding
): void {
  const [pathname, rawQuery = ''] = path
    .trim()
    .replace(/^\/+/, '')
    .split('?', 2)
  const expected = expectedOperationPath(operation, binding)
  let pattern = '^'
  let cursor = 0
  const placeholders = /\{([^{}]+)\}/g
  let match: RegExpExecArray | null
  while ((match = placeholders.exec(expected)) !== null) {
    pattern += escapeRegExp(expected.slice(cursor, match.index))
    pattern += `(?:\\{${escapeRegExp(match[1])}\\}|[^/?#]+)`
    cursor = match.index + match[0].length
  }
  pattern += `${escapeRegExp(expected.slice(cursor))}$`
  if (!new RegExp(pattern).test(pathname)) {
    throw new Error(
      'The REST path does not match the selected catalog operation.'
    )
  }
  const queryNames = new Set(
    operation.parameters
      .filter(parameter => parameter.in === 'query')
      .map(parameter => parameter.name)
  )
  for (const name of new URLSearchParams(rawQuery).keys()) {
    if (isCredentialShapedKey(name)) {
      throw new Error('REST templates cannot persist credential parameters.')
    }
    if (!queryNames.has(name)) {
      throw new Error(
        `REST query parameter '${name}' is not in the catalog operation.`
      )
    }
  }
}

export function createNamedAPIFunctionBinding(
  repository: Repository,
  account: Account
): INamedAPIFunctionBinding {
  const remote = repository.gitHubRepository
  if (
    remote === null ||
    account.provider !== 'github' ||
    account.endpoint !== remote.endpoint
  ) {
    throw new Error('A repository-bound GitHub account is required.')
  }
  const repositoryPath = stringValue(repository.path, 'Repository path', 4096)
  const remoteFullName = stringValue(remote.fullName, 'Remote name', 512)
  const endpoint = stringValue(remote.endpoint, 'Account endpoint', 2048)
  const accountKey = stringValue(
    getAccountKey(account),
    'Account reference',
    4096
  )
  return {
    provider: 'github',
    repositoryPath,
    repositoryHash: repositoryBindingFingerprint(
      repositoryPath,
      remoteFullName,
      endpoint,
      accountKey
    ),
    remoteFullName,
    endpoint,
    accountKey,
  }
}

function normalizeName(value: string): string {
  const name = stringValue(value, 'Function name', 64)
  if (!FunctionNamePattern.test(name)) {
    throw new Error(
      'Function names must start with a lowercase letter and use only lowercase letters, numbers, underscores, or hyphens.'
    )
  }
  return name
}

function validateBinding(value: unknown): INamedAPIFunctionBinding {
  if (!isRecord(value) || value.provider !== 'github') {
    throw new Error('Function binding must target GitHub.')
  }
  const repositoryPath = stringValue(
    value.repositoryPath,
    'Repository path',
    4096
  )
  const repositoryHash = stringValue(
    value.repositoryHash,
    'Repository hash',
    64
  )
  const remoteFullName = stringValue(value.remoteFullName, 'Remote name', 512)
  const endpoint = stringValue(value.endpoint, 'Account endpoint', 2048)
  const accountKey = stringValue(value.accountKey, 'Account reference', 4096)
  if (
    !/^[a-f0-9]{64}$/.test(repositoryHash) ||
    repositoryHash !==
      repositoryBindingFingerprint(
        repositoryPath,
        remoteFullName,
        endpoint,
        accountKey
      )
  ) {
    throw new Error('Repository binding fingerprint does not match.')
  }
  return {
    provider: 'github',
    repositoryPath,
    repositoryHash,
    remoteFullName,
    endpoint,
    accountKey,
  }
}

function normalizeOperationId(value: string, mode: 'rest' | 'graphql') {
  const operationId = stringValue(value, 'Operation ID', 256)
  if (
    mode === 'graphql'
      ? !/^graphql:[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(operationId)
      : !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(operationId)
  ) {
    throw new Error('The API operation ID is not valid.')
  }
  return operationId
}

export function createNamedAPIFunctionDefinition(
  draft: INamedAPIFunctionDraft,
  existing?: INamedAPIFunctionDefinition
): INamedAPIFunctionDefinition {
  const name = normalizeName(draft.name)
  const description = stringValue(
    draft.description,
    'Function description',
    500
  )
  const binding = validateBinding(draft.binding)
  const assessment = assessGitHubAPIWorkbenchRequest(draft.request)
  const now = draft.now ?? new Date()
  const timestamp = now.toISOString()
  let operationId: string
  let template: NamedAPIFunctionTemplate
  let parameterSchema: INamedAPIFunctionParameterSchema

  if (draft.request.mode === 'rest') {
    operationId = normalizeOperationId(draft.operationId, 'rest')
    const resolution = resolveGitHubAPIOperationCatalog(binding.endpoint)
    if (resolution.status !== 'available') {
      throw new Error(resolution.message)
    }
    const operation = resolution.catalog.operations.find(
      value => value.id === operationId
    )
    if (operation === undefined || operation.method !== draft.request.method) {
      throw new Error('Choose a matching REST catalog operation.')
    }
    const unresolved = new Set(
      [...draft.request.path.matchAll(/\{([^{}]+)\}/g)].map(match => match[1])
    )
    const catalogNames = new Set(operation.parameters.map(value => value.name))
    if ([...unresolved].some(name => !catalogNames.has(name))) {
      throw new Error('The REST path contains an undeclared parameter.')
    }
    assertRESTPathMatchesOperation(draft.request.path, operation, binding)
    const validatedREST = validateGitHubAPIWorkbenchRequest({
      ...draft.request,
      path: draft.request.path.replace(/\{[^{}]+\}/g, 'parameter'),
    })
    if (validatedREST.mode !== 'rest') {
      throw new Error('Expected a REST function template.')
    }
    assertNoStoredCredentials(validatedREST.body, 'REST body')
    if (operation.requestBodyRequired && validatedREST.body === undefined) {
      throw new Error('This REST operation requires a JSON request body.')
    }
    template = {
      mode: 'rest',
      catalogId: resolution.catalog.id,
      method: operation.method,
      pathTemplate: draft.request.path.trim().replace(/^\/+/, ''),
      bodyText: draft.request.bodyText.trim(),
      queryParameters: operation.parameters
        .filter(value => value.in === 'query')
        .map(value => value.name),
    }
    parameterSchema = schemaForRESTOperation(
      operation,
      template.pathTemplate,
      validatedREST.body
    )
  } else {
    const validated = validateGitHubAPIWorkbenchRequest(draft.request)
    if (validated.mode !== 'graphql') {
      throw new Error('Expected a GraphQL function template.')
    }
    const operationName = validated.operationName
    if (operationName === undefined) {
      throw new Error(
        'Name the GraphQL operation before adding it as a function.'
      )
    }
    operationId = normalizeOperationId(draft.operationId, 'graphql')
    if (operationId !== `graphql:${operationName}`) {
      throw new Error('The GraphQL operation ID must match its operation name.')
    }
    if (containsCredentialShapedGraphQLField(validated.query)) {
      throw new Error(
        'GraphQL templates cannot contain credential-shaped fields.'
      )
    }
    const executableQuery = getExecutableGraphQLText(validated.query)
    if (
      !new RegExp(
        `\\b(?:query|mutation|subscription)\\s+${escapeRegExp(
          operationName
        )}\\b`
      ).test(executableQuery)
    ) {
      throw new Error(
        'The GraphQL operation name must identify an operation in the template.'
      )
    }
    assertNoStoredCredentials(validated.variables, 'GraphQL variables')
    template = {
      mode: 'graphql',
      query: validated.query,
      variables: validated.variables,
      operationName,
    }
    parameterSchema = schemaForGraphQL(validated.query, validated.variables)
  }

  assertNoStoredCredentials({ description, template })
  const definition: INamedAPIFunctionDefinition = {
    id: existing?.id ?? draft.id ?? makeDefinitionId(name, now),
    name,
    description,
    owner: NamedAPIFunctionOwner,
    operationId,
    risk: assessment.risk,
    binding,
    parameterSchema,
    template,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
  assertDefinitionSize(definition)
  return definition
}

function assertParameterValue(
  name: string,
  value: unknown,
  schema: INamedAPIFunctionParameterSchema['properties'][string]
) {
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    throw new Error(`'${name}' must be one of its catalog values.`)
  }
  if (schema.type === undefined) {
    return
  }
  const valid =
    schema.type === 'array'
      ? Array.isArray(value)
      : schema.type === 'null'
      ? value === null
      : schema.type === 'integer'
      ? typeof value === 'number' && Number.isSafeInteger(value)
      : schema.type === 'number'
      ? typeof value === 'number' && Number.isFinite(value)
      : schema.type === 'object'
      ? isRecord(value)
      : typeof value === schema.type
  if (!valid) {
    throw new Error(`'${name}' must be ${schema.type}.`)
  }
  if (
    typeof value === 'string' &&
    schema.maxLength !== undefined &&
    value.length > schema.maxLength
  ) {
    throw new Error(`'${name}' is too long.`)
  }
}

function validateInvocationArguments(
  definition: INamedAPIFunctionDefinition,
  value: unknown
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error('Function arguments must be an object.')
  }
  assertNoStoredCredentials(value, 'arguments')
  const entries = Object.entries(value)
  if (entries.length > 100) {
    throw new Error('Function arguments have too many properties.')
  }
  for (const name of definition.parameterSchema.required ?? []) {
    if (!(name in value)) {
      throw new Error(`Function argument '${name}' is required.`)
    }
  }
  for (const [name, child] of entries) {
    const schema = definition.parameterSchema.properties[name]
    if (
      !Object.prototype.hasOwnProperty.call(
        definition.parameterSchema.properties,
        name
      ) ||
      schema === undefined
    ) {
      throw new Error(`Function argument '${name}' is not declared.`)
    }
    assertParameterValue(name, child, schema)
  }
  return value
}

function pathParameterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(item => String(item)).join(',')
  }
  return String(value)
}

function prepareRESTInvocation(
  template: INamedRESTAPIFunctionTemplate,
  args: Readonly<Record<string, unknown>>
): GitHubAPIWorkbenchRequest {
  const substituted = template.pathTemplate.replace(
    /\{([^{}]+)\}/g,
    (_match, name) => {
      if (!(name in args)) {
        throw new Error(`Function argument '${name}' is required.`)
      }
      return encodeURIComponent(pathParameterValue(args[name]))
    }
  )
  const [pathname, rawQuery = ''] = substituted.split('?', 2)
  const query = new URLSearchParams(rawQuery)
  for (const name of template.queryParameters) {
    const value = args[name]
    if (value === undefined) {
      continue
    }
    if (Array.isArray(value)) {
      value.forEach(item => query.append(name, String(item)))
    } else {
      query.set(name, String(value))
    }
  }
  const queryText = query.toString()
  const path = queryText.length === 0 ? pathname : `${pathname}?${queryText}`
  const request: GitHubAPIWorkbenchRequest = {
    mode: 'rest',
    method: template.method,
    path,
    bodyText: Object.prototype.hasOwnProperty.call(args, 'body')
      ? JSON.stringify(args.body)
      : template.bodyText,
  }
  validateGitHubAPIWorkbenchRequest(request)
  return request
}

export function prepareNamedAPIFunctionInvocation(
  definition: INamedAPIFunctionDefinition,
  rawArguments: unknown
): INamedAPIFunctionInvocation {
  const args = validateInvocationArguments(definition, rawArguments)
  const request: GitHubAPIWorkbenchRequest =
    definition.template.mode === 'rest'
      ? prepareRESTInvocation(definition.template, args)
      : {
          mode: 'graphql',
          query: definition.template.query,
          variablesText: JSON.stringify({
            ...definition.template.variables,
            ...args,
          }),
          operationName: definition.template.operationName,
        }
  validateGitHubAPIWorkbenchRequest(request)
  const assessment = assessGitHubAPIWorkbenchRequest(request)
  if (assessment.risk !== definition.risk) {
    throw new Error('The function risk no longer matches its API template.')
  }
  return {
    request,
    risk: assessment.risk,
    requiresConfirmation: assessment.requiresConfirmation,
  }
}

function parseParameterSchema(
  value: unknown
): INamedAPIFunctionParameterSchema {
  if (
    !isRecord(value) ||
    value.type !== 'object' ||
    value.additionalProperties !== false ||
    !isRecord(value.properties)
  ) {
    throw new Error('Function parameter schema is invalid.')
  }
  const properties: Record<string, Record<string, unknown>> = {}
  for (const [name, schema] of Object.entries(value.properties)) {
    if (
      ReservedParameterNames.has(name) ||
      !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(name) ||
      !isRecord(schema)
    ) {
      throw new Error('Function parameter schema has an invalid property.')
    }
    properties[name] = schema
  }
  const required = value.required
  if (
    required !== undefined &&
    (!Array.isArray(required) ||
      required.some(name => typeof name !== 'string' || !(name in properties)))
  ) {
    throw new Error('Function parameter schema has invalid requirements.')
  }
  return value as unknown as INamedAPIFunctionParameterSchema
}

export function validateNamedAPIFunctionDefinition(
  value: unknown
): INamedAPIFunctionDefinition {
  if (!isRecord(value) || value.owner !== NamedAPIFunctionOwner) {
    throw new Error('Named API function is invalid.')
  }
  const template = value.template
  if (
    !isRecord(template) ||
    (template.mode !== 'rest' && template.mode !== 'graphql')
  ) {
    throw new Error('Named API function template is invalid.')
  }
  const request: GitHubAPIWorkbenchRequest =
    template.mode === 'rest'
      ? {
          mode: 'rest',
          method: template.method as INamedRESTAPIFunctionTemplate['method'],
          path: String(template.pathTemplate ?? ''),
          bodyText: String(template.bodyText ?? ''),
        }
      : {
          mode: 'graphql',
          query: String(template.query ?? ''),
          variablesText: JSON.stringify(template.variables ?? {}),
          operationName:
            typeof template.operationName === 'string'
              ? template.operationName
              : undefined,
        }
  const definition = createNamedAPIFunctionDefinition(
    {
      id: stringValue(value.id, 'Function ID', 256),
      name: stringValue(value.name, 'Function name', 64),
      description: stringValue(value.description, 'Function description', 500),
      operationId: stringValue(value.operationId, 'Operation ID', 256),
      binding: validateBinding(value.binding),
      request,
      now: new Date(assertISOTime(value.updatedAt as string, 'Updated time')),
    },
    {
      ...(value as unknown as INamedAPIFunctionDefinition),
      id: stringValue(value.id, 'Function ID', 256),
      createdAt: assertISOTime(value.createdAt as string, 'Created time'),
    }
  )
  if (
    template.mode === 'rest' &&
    typeof template.catalogId === 'string' &&
    (definition.template.mode !== 'rest' ||
      template.catalogId !== definition.template.catalogId)
  ) {
    throw new Error(
      'The stored REST function catalog does not match its bound endpoint.'
    )
  }
  if (
    !/^github-api:[a-z][a-z0-9_-]{0,63}:[a-z0-9]+:[a-f0-9-]{36}$/.test(
      definition.id
    )
  ) {
    throw new Error('Function ID is invalid.')
  }
  const schema = parseParameterSchema(value.parameterSchema)
  if (JSON.stringify(schema) !== JSON.stringify(definition.parameterSchema)) {
    throw new Error(
      'Function parameter schema does not match its API operation.'
    )
  }
  if (value.risk !== definition.risk) {
    throw new Error('Function risk does not match its API operation.')
  }
  return definition
}

export function parseNamedAPIFunctionsDocument(
  raw: string | null
): INamedAPIFunctionsDocument {
  if (raw === null || raw.trim().length === 0) {
    return { version: NamedAPIFunctionsFileVersion, functions: [] }
  }
  if (byteLength(raw) > NamedAPIFunctionDocumentByteLimit) {
    throw new Error(
      `Named API function storage exceeds ${NamedAPIFunctionDocumentByteLimit} bytes.`
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Named API functions are not valid JSON.')
  }
  // Version 0 stored the array directly. This one-way migration intentionally
  // accepts only definitions that pass the current strict validator.
  const source = Array.isArray(parsed)
    ? { version: 0, functions: parsed }
    : parsed
  if (!isRecord(source) || !Array.isArray(source.functions)) {
    throw new Error('Named API function storage is invalid.')
  }
  if (source.version !== 0 && source.version !== NamedAPIFunctionsFileVersion) {
    throw new Error('Named API function storage has an unsupported version.')
  }
  if (source.functions.length > NamedAPIFunctionLimit) {
    throw new Error(
      `Only ${NamedAPIFunctionLimit} named API functions are allowed.`
    )
  }
  const functions = source.functions.map(validateNamedAPIFunctionDefinition)
  const ids = new Set(functions.map(value => value.id))
  const names = new Set(functions.map(value => value.name))
  if (ids.size !== functions.length || names.size !== functions.length) {
    throw new Error('Named API function IDs and names must be unique.')
  }
  return { version: NamedAPIFunctionsFileVersion, functions }
}

export function serializeNamedAPIFunctionsDocument(
  functions: ReadonlyArray<INamedAPIFunctionDefinition>
): string {
  if (functions.length > NamedAPIFunctionLimit) {
    throw new Error(
      `Only ${NamedAPIFunctionLimit} named API functions are allowed.`
    )
  }
  const validated = functions.map(validateNamedAPIFunctionDefinition)
  const serialized = JSON.stringify(
    { version: NamedAPIFunctionsFileVersion, functions: validated },
    null,
    2
  )
  if (byteLength(serialized) > NamedAPIFunctionDocumentByteLimit) {
    throw new Error(
      `Named API function storage exceeds ${NamedAPIFunctionDocumentByteLimit} bytes.`
    )
  }
  return serialized
}

export function namedAPIFunctionToolName(name: string): string {
  return `${NamedAPIFunctionToolPrefix}${normalizeName(name)}`
}

export function namedAPIFunctionNameFromTool(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !value.startsWith(NamedAPIFunctionToolPrefix)
  ) {
    return null
  }
  const name = value.slice(NamedAPIFunctionToolPrefix.length)
  return FunctionNamePattern.test(name) ? name : null
}

export function functionBelongsToBinding(
  definition: INamedAPIFunctionDefinition,
  binding: INamedAPIFunctionBinding
): boolean {
  return (
    definition.binding.repositoryPath === binding.repositoryPath &&
    definition.binding.repositoryHash === binding.repositoryHash &&
    definition.binding.remoteFullName === binding.remoteFullName &&
    definition.binding.endpoint === binding.endpoint &&
    definition.binding.accountKey === binding.accountKey
  )
}
