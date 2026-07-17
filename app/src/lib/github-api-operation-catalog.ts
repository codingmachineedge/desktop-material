import catalogSource from '../../../.codex/audits/github-rest-operations-2026-03-10.json'
import { GitHubRepository } from '../models/github-repository'
import {
  getEndpointVersion,
  isDotCom,
  isGHE,
  isGHES,
} from './endpoint-capabilities'

export type GitHubAPIOperationMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'

export type GitHubAPICatalogProduct = 'dotcom' | 'ghec' | 'ghes'
export type GitHubAPICatalogSourceProduct = 'dotcom' | 'ghec' | 'ghes-3.21'

export interface IGitHubAPIParameterSchema {
  readonly ref?: string
  readonly type?: string | ReadonlyArray<string>
  readonly enum?: ReadonlyArray<unknown>
  readonly const?: unknown
  readonly default?: unknown
  readonly format?: string
  readonly minimum?: number
  readonly maximum?: number
  readonly exclusiveMinimum?: number | boolean
  readonly exclusiveMaximum?: number | boolean
  readonly multipleOf?: number
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
  readonly minItems?: number
  readonly maxItems?: number
  readonly uniqueItems?: boolean
  readonly nullable?: boolean
  readonly items?: IGitHubAPIParameterSchema
  readonly oneOf?: ReadonlyArray<IGitHubAPIParameterSchema>
  readonly anyOf?: ReadonlyArray<IGitHubAPIParameterSchema>
  readonly allOf?: ReadonlyArray<IGitHubAPIParameterSchema>
}

export interface IGitHubAPIOperationParameter {
  readonly name: string
  readonly in: 'path' | 'query'
  readonly required: boolean
  /** Compatibility projection for existing JSON-schema generation. */
  readonly type: string
  /** Every primitive type represented by direct, referenced, or union schemas. */
  readonly types: ReadonlyArray<string>
  readonly values?: ReadonlyArray<unknown>
  readonly schema: IGitHubAPIParameterSchema
}

export interface IGitHubAPIOperationServer {
  readonly url: string
  readonly description?: string
  readonly variables?: Readonly<Record<string, unknown>>
}

export interface IGitHubAPIOperationPreview {
  readonly name?: string
  readonly notice?: string
  readonly description?: string
  readonly required?: boolean
  readonly [key: string]: unknown
}

export interface IGitHubAPIOperation {
  readonly id: string
  readonly method: GitHubAPIOperationMethod
  readonly path: string
  readonly summary: string
  readonly category: string
  readonly subcategory: string | null
  readonly documentationUrl: string | null
  readonly cloudOnly: boolean
  readonly enabledForGitHubApps: boolean
  readonly deprecated: boolean
  readonly deprecationDate: string | null
  readonly removalDate: string | null
  readonly previewed: boolean
  readonly previews: ReadonlyArray<IGitHubAPIOperationPreview>
  readonly triggersNotification: boolean
  readonly requestBodyParameterName: string | null
  readonly parameters: ReadonlyArray<IGitHubAPIOperationParameter>
  readonly requestBodyRequired: boolean
  readonly requestBodyContentTypes: ReadonlyArray<string>
  readonly servers: ReadonlyArray<IGitHubAPIOperationServer>
}

export interface IGitHubAPICatalogInventory {
  readonly paths: number
  readonly operations: number
  readonly tags: number
  readonly categories: number
  readonly webhooks: number
}

interface IGitHubAPIOperationCatalogProductSource {
  readonly id: GitHubAPICatalogSourceProduct
  readonly label: string
  readonly apiVersion: string
  readonly sourceCommit: string
  readonly sourceSha256: string
  readonly sourceUrl: string
  readonly inventory: IGitHubAPICatalogInventory
  readonly newOperationIds: ReadonlyArray<string>
  readonly categories: ReadonlyArray<{
    readonly name: string
    readonly count: number
  }>
  readonly operations: ReadonlyArray<IGitHubAPIOperation>
}

interface IGitHubAPIOperationCatalogSource {
  readonly version: 2
  readonly purpose: string
  readonly apiVersion: string
  readonly sourceCommit: string
  readonly previousSourceCommit: string
  readonly products: ReadonlyArray<IGitHubAPIOperationCatalogProductSource>
}

export interface IGitHubAPIOperationCatalog {
  readonly id: string
  readonly product: GitHubAPICatalogProduct
  readonly sourceProduct: GitHubAPICatalogSourceProduct
  readonly productVersion: string | null
  readonly label: string
  readonly apiVersion: string
  readonly sourceCommit: string
  readonly sourceSha256: string
  readonly sourceUrl: string
  readonly inventory: IGitHubAPICatalogInventory
  readonly newOperationIds: ReadonlyArray<string>
  readonly categories: ReadonlyArray<{
    readonly name: string
    readonly count: number
  }>
  readonly operations: ReadonlyArray<IGitHubAPIOperation>
}

const source = catalogSource as unknown as IGitHubAPIOperationCatalogSource
if (source.version !== 2) {
  throw new Error('The GitHub API operation catalog version is unsupported.')
}

function productForSource(
  product: IGitHubAPIOperationCatalogProductSource
): GitHubAPICatalogProduct {
  return product.id === 'ghes-3.21' ? 'ghes' : product.id
}

function productVersionForSource(
  product: IGitHubAPIOperationCatalogProductSource
): string | null {
  return product.id === 'ghes-3.21' ? '3.21' : null
}

function validateAndFreezeCatalog(
  product: IGitHubAPIOperationCatalogProductSource
): IGitHubAPIOperationCatalog {
  const operationIds = new Set(
    product.operations.map(operation => operation.id)
  )
  if (
    product.operations.length !== product.inventory.operations ||
    operationIds.size !== product.operations.length
  ) {
    throw new Error(
      `The ${product.label} API operation catalog is incomplete or duplicated.`
    )
  }
  for (const operationId of product.newOperationIds) {
    if (!operationIds.has(operationId)) {
      throw new Error(
        `The ${product.label} API operation catalog is missing ${operationId}.`
      )
    }
  }

  const productVersion = productVersionForSource(product)
  return Object.freeze({
    id:
      productVersion === null
        ? `${product.id}:${product.apiVersion}`
        : `ghes:${productVersion}`,
    product: productForSource(product),
    sourceProduct: product.id,
    productVersion,
    label: product.label,
    apiVersion: product.apiVersion,
    sourceCommit: product.sourceCommit,
    sourceSha256: product.sourceSha256,
    sourceUrl: product.sourceUrl,
    inventory: Object.freeze({ ...product.inventory }),
    newOperationIds: Object.freeze([...product.newOperationIds]),
    categories: Object.freeze(
      product.categories.map(category => Object.freeze({ ...category }))
    ),
    operations: Object.freeze(
      product.operations.map(operation => Object.freeze(operation))
    ),
  })
}

const catalogs = new Map<
  GitHubAPICatalogSourceProduct,
  IGitHubAPIOperationCatalog
>()
for (const product of source.products) {
  if (catalogs.has(product.id)) {
    throw new Error(`The GitHub API catalog duplicates ${product.id}.`)
  }
  catalogs.set(product.id, validateAndFreezeCatalog(product))
}

function requireCatalog(
  product: GitHubAPICatalogSourceProduct
): IGitHubAPIOperationCatalog {
  const catalog = catalogs.get(product)
  if (catalog === undefined) {
    throw new Error(`The GitHub API catalog is missing ${product}.`)
  }
  return catalog
}

export const GitHubDotComAPICatalog = requireCatalog('dotcom')
export const GitHubEnterpriseCloudAPICatalog = requireCatalog('ghec')
export const GitHubEnterpriseServer321APICatalog = requireCatalog('ghes-3.21')
export const GitHubAPICatalogs = Object.freeze([
  GitHubDotComAPICatalog,
  GitHubEnterpriseCloudAPICatalog,
  GitHubEnterpriseServer321APICatalog,
])

export interface IGitHubAPICatalogAvailableResolution {
  readonly status: 'available'
  readonly endpoint: string
  readonly product: GitHubAPICatalogProduct
  readonly detectedVersion: string | null
  readonly catalog: IGitHubAPIOperationCatalog
}

export interface IGitHubAPICatalogUnavailableResolution {
  readonly status:
    | 'unknown-version'
    | 'unsupported-version'
    | 'invalid-endpoint'
  readonly endpoint: string
  readonly product: 'ghes' | 'unknown'
  readonly detectedVersion: string | null
  readonly catalog: null
  readonly message: string
}

export type GitHubAPICatalogResolution =
  | IGitHubAPICatalogAvailableResolution
  | IGitHubAPICatalogUnavailableResolution

export type GitHubEndpointVersionReader = typeof getEndpointVersion

/**
 * Resolve an exact product catalog for a bound account endpoint. GHES versions
 * without a pinned catalog fail closed instead of inheriting GitHub.com APIs.
 */
export function resolveGitHubAPIOperationCatalog(
  endpoint: string,
  getVersion: GitHubEndpointVersionReader = getEndpointVersion
): GitHubAPICatalogResolution {
  try {
    if (isDotCom(endpoint)) {
      return {
        status: 'available',
        endpoint,
        product: 'dotcom',
        detectedVersion: null,
        catalog: GitHubDotComAPICatalog,
      }
    }
    if (isGHE(endpoint)) {
      return {
        status: 'available',
        endpoint,
        product: 'ghec',
        detectedVersion: null,
        catalog: GitHubEnterpriseCloudAPICatalog,
      }
    }
    if (!isGHES(endpoint)) {
      return {
        status: 'invalid-endpoint',
        endpoint,
        product: 'unknown',
        detectedVersion: null,
        catalog: null,
        message: 'The bound account endpoint is not a recognized GitHub host.',
      }
    }
  } catch {
    return {
      status: 'invalid-endpoint',
      endpoint,
      product: 'unknown',
      detectedVersion: null,
      catalog: null,
      message: 'The bound account endpoint is not a valid URL.',
    }
  }

  let version: ReturnType<GitHubEndpointVersionReader>
  try {
    version = getVersion(endpoint)
  } catch {
    return {
      status: 'unknown-version',
      endpoint,
      product: 'ghes',
      detectedVersion: null,
      catalog: null,
      message:
        'The GitHub Enterprise Server version could not be read, so no operation catalog can be selected safely.',
    }
  }
  if (version === null) {
    return {
      status: 'unknown-version',
      endpoint,
      product: 'ghes',
      detectedVersion: null,
      catalog: null,
      message:
        'The GitHub Enterprise Server version is unknown, so no operation catalog can be selected safely.',
    }
  }
  const detectedVersion = version.version
  if (version.major === 3 && version.minor === 21) {
    return {
      status: 'available',
      endpoint,
      product: 'ghes',
      detectedVersion,
      catalog: GitHubEnterpriseServer321APICatalog,
    }
  }
  return {
    status: 'unsupported-version',
    endpoint,
    product: 'ghes',
    detectedVersion,
    catalog: null,
    message: `GitHub Enterprise Server ${detectedVersion} does not have a pinned operation catalog in this build.`,
  }
}

// Compatibility exports remain GitHub.com-specific. Product-aware consumers
// must use resolveGitHubAPIOperationCatalog and pass its catalog to helpers.
export const GitHubAPICatalogVersion = GitHubDotComAPICatalog.apiVersion
export const GitHubAPICatalogSourceCommit = source.sourceCommit
export const GitHubAPICatalogPreviousSourceCommit = source.previousSourceCommit
export const GitHubAPICatalogSourceURL = GitHubDotComAPICatalog.sourceUrl
export const GitHubAPICatalogInventory = GitHubDotComAPICatalog.inventory
export const GitHubAPICatalogCategories = GitHubDotComAPICatalog.categories
export const GitHubAPIOperations = GitHubDotComAPICatalog.operations
export const NewGitHubAPIOperationIds = GitHubDotComAPICatalog.newOperationIds

export function isNewGitHubAPIOperation(
  operationId: string,
  catalog: IGitHubAPIOperationCatalog = GitHubDotComAPICatalog
): boolean {
  return catalog.newOperationIds.includes(operationId)
}

export interface IGitHubAPIOperationFilter {
  readonly query?: string
  readonly category?: string | null
  readonly newOnly?: boolean
}

/** Search the selected product catalog without changing its stable order. */
export function filterGitHubAPIOperations(
  filter: IGitHubAPIOperationFilter,
  catalog: IGitHubAPIOperationCatalog = GitHubDotComAPICatalog
): ReadonlyArray<IGitHubAPIOperation> {
  const terms = (filter.query ?? '')
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(term => term.length > 0)
  const newOperationIds = new Set(catalog.newOperationIds)
  return catalog.operations.filter(operation => {
    if (filter.newOnly === true && !newOperationIds.has(operation.id)) {
      return false
    }
    if (
      filter.category !== undefined &&
      filter.category !== null &&
      filter.category.length > 0 &&
      operation.category !== filter.category
    ) {
      return false
    }
    if (terms.length === 0) {
      return true
    }
    const searchable = [
      operation.id,
      operation.method,
      operation.path,
      operation.summary,
      operation.category,
      operation.subcategory ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase()
    return terms.every(term => searchable.includes(term))
  })
}

/** Fill repository coordinates while leaving unrelated placeholders editable. */
export function getGitHubAPIOperationPath(
  operation: IGitHubAPIOperation,
  repository: GitHubRepository
): string {
  return operation.path
    .replace(/\{owner\}/g, encodeURIComponent(repository.owner.login))
    .replace(/\{repo\}/g, encodeURIComponent(repository.name))
    .replace(/^\/+/, '')
}
