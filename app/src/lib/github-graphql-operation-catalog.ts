import catalogSource from '../../../.codex/audits/github-graphql-root-operations-2026-07-16.json'
import {
  GitHubAPICatalogProduct,
  GitHubAPICatalogResolution,
  GitHubEndpointVersionReader,
  resolveGitHubAPIOperationCatalog,
} from './github-api-operation-catalog'

export type GitHubGraphQLOperationKind = 'query' | 'mutation'
export type GitHubGraphQLReturnKind =
  | 'scalar'
  | 'enum'
  | 'object'
  | 'interface'
  | 'union'
export type GitHubGraphQLCatalogSourceProduct = 'dotcom' | 'ghec' | 'ghes-3.21'

export interface IGitHubGraphQLOperationArgument {
  readonly name: string
  readonly description: string | null
  /** Complete GraphQL type expression, including list and non-null wrappers. */
  readonly type: string
  /** Complete GraphQL constant literal, or null when no default is defined. */
  readonly defaultValue: string | null
}

export interface IGitHubGraphQLOperation {
  readonly id: string
  readonly kind: GitHubGraphQLOperationKind
  readonly name: string
  readonly description: string | null
  readonly args: ReadonlyArray<IGitHubGraphQLOperationArgument>
  readonly returnType: string
  readonly returnNamedType: string
  readonly returnKind: GitHubGraphQLReturnKind
  readonly deprecated: boolean
  readonly deprecationReason: string | null
}

export interface IGitHubGraphQLCatalogInventory {
  readonly queries: number
  readonly mutations: number
  readonly operations: number
  readonly arguments: number
  readonly defaults: number
  readonly deprecated: number
}

interface IGitHubGraphQLCatalogProductSource {
  readonly id: GitHubGraphQLCatalogSourceProduct
  readonly label: string
  readonly productVersion: string | null
  readonly sourceCommit: string
  readonly sourceCommitDate: string
  readonly sourceBytes: number
  readonly sourceSha256: string
  readonly sourceUrl: string
  readonly inventory: IGitHubGraphQLCatalogInventory
  readonly operations: ReadonlyArray<IGitHubGraphQLOperation>
}

interface IGitHubGraphQLCatalogSource {
  readonly version: 1
  readonly purpose: string
  readonly snapshotDate: string
  readonly sourceRepository: 'github/docs'
  readonly sourceCommit: string
  readonly sourceCommitDate: string
  readonly products: ReadonlyArray<IGitHubGraphQLCatalogProductSource>
}

export interface IGitHubGraphQLOperationCatalog {
  readonly id: string
  readonly product: GitHubAPICatalogProduct
  readonly sourceProduct: GitHubGraphQLCatalogSourceProduct
  readonly productVersion: string | null
  readonly label: string
  readonly snapshotDate: string
  readonly sourceCommit: string
  readonly sourceCommitDate: string
  readonly sourceBytes: number
  readonly sourceSha256: string
  readonly sourceUrl: string
  readonly inventory: IGitHubGraphQLCatalogInventory
  readonly operations: ReadonlyArray<IGitHubGraphQLOperation>
}

const source = catalogSource as unknown as IGitHubGraphQLCatalogSource
if (source.version !== 1 || source.sourceRepository !== 'github/docs') {
  throw new Error('The GitHub GraphQL operation catalog is unsupported.')
}

function productForSource(
  product: GitHubGraphQLCatalogSourceProduct
): GitHubAPICatalogProduct {
  return product === 'ghes-3.21' ? 'ghes' : product
}

function validateAndFreezeCatalog(
  product: IGitHubGraphQLCatalogProductSource
): IGitHubGraphQLOperationCatalog {
  const operationIds = new Set(
    product.operations.map(operation => operation.id)
  )
  const queryCount = product.operations.filter(
    operation => operation.kind === 'query'
  ).length
  const mutationCount = product.operations.filter(
    operation => operation.kind === 'mutation'
  ).length
  const argumentCount = product.operations.reduce(
    (count, operation) => count + operation.args.length,
    0
  )
  const defaultCount = product.operations.reduce(
    (count, operation) =>
      count +
      operation.args.filter(argument => argument.defaultValue !== null).length,
    0
  )
  const deprecatedCount = product.operations.filter(
    operation => operation.deprecated
  ).length
  if (
    operationIds.size !== product.operations.length ||
    product.inventory.operations !== product.operations.length ||
    product.inventory.queries !== queryCount ||
    product.inventory.mutations !== mutationCount ||
    product.inventory.arguments !== argumentCount ||
    product.inventory.defaults !== defaultCount ||
    product.inventory.deprecated !== deprecatedCount
  ) {
    throw new Error(
      `The ${product.label} GraphQL root-operation catalog is incomplete or duplicated.`
    )
  }
  for (const operation of product.operations) {
    if (
      operation.id !== `${operation.kind}:${operation.name}` ||
      operation.returnType.length === 0 ||
      operation.returnNamedType.length === 0 ||
      new Set(operation.args.map(argument => argument.name)).size !==
        operation.args.length ||
      (operation.deprecated && operation.deprecationReason === null)
    ) {
      throw new Error(
        `The ${product.label} GraphQL catalog has an invalid ${operation.id}.`
      )
    }
  }

  return Object.freeze({
    id:
      product.productVersion === null
        ? `graphql-${product.id}:${source.snapshotDate}`
        : `graphql-ghes:${product.productVersion}`,
    product: productForSource(product.id),
    sourceProduct: product.id,
    productVersion: product.productVersion,
    label: product.label,
    snapshotDate: source.snapshotDate,
    sourceCommit: product.sourceCommit,
    sourceCommitDate: product.sourceCommitDate,
    sourceBytes: product.sourceBytes,
    sourceSha256: product.sourceSha256,
    sourceUrl: product.sourceUrl,
    inventory: Object.freeze({ ...product.inventory }),
    operations: Object.freeze(
      product.operations.map(operation => Object.freeze(operation))
    ),
  })
}

const catalogs = new Map<
  GitHubGraphQLCatalogSourceProduct,
  IGitHubGraphQLOperationCatalog
>()
for (const product of source.products) {
  if (catalogs.has(product.id)) {
    throw new Error(`The GitHub GraphQL catalog duplicates ${product.id}.`)
  }
  catalogs.set(product.id, validateAndFreezeCatalog(product))
}

function requireCatalog(
  product: GitHubGraphQLCatalogSourceProduct
): IGitHubGraphQLOperationCatalog {
  const catalog = catalogs.get(product)
  if (catalog === undefined) {
    throw new Error(`The GitHub GraphQL catalog is missing ${product}.`)
  }
  return catalog
}

export const GitHubDotComGraphQLCatalog = requireCatalog('dotcom')
export const GitHubEnterpriseCloudGraphQLCatalog = requireCatalog('ghec')
export const GitHubEnterpriseServer321GraphQLCatalog =
  requireCatalog('ghes-3.21')
export const GitHubGraphQLCatalogs = Object.freeze([
  GitHubDotComGraphQLCatalog,
  GitHubEnterpriseCloudGraphQLCatalog,
  GitHubEnterpriseServer321GraphQLCatalog,
])

export interface IGitHubGraphQLCatalogAvailableResolution {
  readonly status: 'available'
  readonly endpoint: string
  readonly product: GitHubAPICatalogProduct
  readonly detectedVersion: string | null
  readonly catalog: IGitHubGraphQLOperationCatalog
}

export interface IGitHubGraphQLCatalogUnavailableResolution {
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

export type GitHubGraphQLCatalogResolution =
  | IGitHubGraphQLCatalogAvailableResolution
  | IGitHubGraphQLCatalogUnavailableResolution

function unavailableGraphQLResolution(
  resolution: Exclude<GitHubAPICatalogResolution, { status: 'available' }>
): IGitHubGraphQLCatalogUnavailableResolution {
  return {
    ...resolution,
    message: resolution.message.replace(
      'operation catalog',
      'GraphQL root-operation schema'
    ),
  }
}

export function resolveGitHubGraphQLOperationCatalog(
  endpoint: string,
  getVersion?: GitHubEndpointVersionReader
): GitHubGraphQLCatalogResolution {
  const resolution = resolveGitHubAPIOperationCatalog(endpoint, getVersion)
  if (resolution.status !== 'available') {
    return unavailableGraphQLResolution(resolution)
  }
  const catalog =
    resolution.catalog.sourceProduct === 'dotcom'
      ? GitHubDotComGraphQLCatalog
      : resolution.catalog.sourceProduct === 'ghec'
      ? GitHubEnterpriseCloudGraphQLCatalog
      : resolution.catalog.sourceProduct === 'ghes-3.21'
      ? GitHubEnterpriseServer321GraphQLCatalog
      : null
  if (catalog === null) {
    return {
      status: 'unsupported-version',
      endpoint,
      product: 'ghes',
      detectedVersion: resolution.detectedVersion,
      catalog: null,
      message:
        'This GitHub product does not have a pinned GraphQL root-operation schema in this build.',
    }
  }
  return {
    status: 'available',
    endpoint,
    product: catalog.product,
    detectedVersion: resolution.detectedVersion,
    catalog,
  }
}

export interface IGitHubGraphQLOperationFilter {
  readonly query?: string
  readonly kind?: GitHubGraphQLOperationKind | null
}

export function filterGitHubGraphQLOperations(
  filter: IGitHubGraphQLOperationFilter,
  catalog: IGitHubGraphQLOperationCatalog = GitHubDotComGraphQLCatalog
): ReadonlyArray<IGitHubGraphQLOperation> {
  const terms = (filter.query ?? '')
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(term => term.length > 0)
  return catalog.operations.filter(operation => {
    if (filter.kind !== undefined && filter.kind !== null) {
      if (operation.kind !== filter.kind) {
        return false
      }
    }
    if (terms.length === 0) {
      return true
    }
    const searchable = [
      operation.id,
      operation.kind,
      operation.name,
      operation.description ?? '',
      operation.returnType,
      ...operation.args.flatMap(argument => [
        argument.name,
        argument.type,
        argument.description ?? '',
        argument.defaultValue ?? '',
      ]),
      operation.deprecationReason ?? '',
    ]
      .join(' ')
      .toLocaleLowerCase()
    return terms.every(term => searchable.includes(term))
  })
}

export interface IGitHubGraphQLOperationTemplate {
  readonly query: string
  readonly variablesText: string
  readonly operationName: string
}

function graphQLOperationName(fieldName: string): string {
  return `${fieldName.slice(0, 1).toLocaleUpperCase()}${fieldName.slice(1)}`
}

export function getGitHubGraphQLOperationTemplate(
  operation: IGitHubGraphQLOperation
): IGitHubGraphQLOperationTemplate {
  const operationName = graphQLOperationName(operation.name)
  const variableDeclarations = operation.args.map(
    argument =>
      `$${argument.name}: ${argument.type}${
        argument.defaultValue === null ? '' : ` = ${argument.defaultValue}`
      }`
  )
  const fieldArguments = operation.args.map(
    argument => `${argument.name}: $${argument.name}`
  )
  const declaration =
    variableDeclarations.length === 0
      ? `${operation.kind} ${operationName}`
      : `${operation.kind} ${operationName}(\n  ${variableDeclarations.join(
          '\n  '
        )}\n)`
  const field =
    fieldArguments.length === 0
      ? operation.name
      : `${operation.name}(\n    ${fieldArguments.join('\n    ')}\n  )`
  const selection =
    operation.returnKind === 'scalar' || operation.returnKind === 'enum'
      ? ''
      : ' {\n    __typename\n  }'
  return {
    query: `${declaration} {\n  ${field}${selection}\n}`,
    variablesText: '{}',
    operationName,
  }
}
