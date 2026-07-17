#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const CatalogVersion = 2
const ApiVersion = '2026-03-10'
const SourceCommit = 'bf7e007714988319f286ebbd102f1d3cea20dfc2'
const PreviousSourceCommit = '3b43edf675308c515b5e92a3eb89db17f6e6d806'
const OutputPath = resolve(
  process.argv[2] ?? '.codex/audits/github-rest-operations-2026-03-10.json'
)

const Sources = [
  {
    id: 'dotcom',
    label: 'GitHub.com',
    path: 'descriptions/api.github.com/api.github.com.json',
    sha256: '368e7d20bb84ee4558c65082243040539179deb195d6ad46a6c53e1bd940d3c0',
    expected: {
      paths: 796,
      operations: 1206,
      tags: 49,
      categories: 51,
      webhooks: 270,
    },
  },
  {
    id: 'ghec',
    label: 'GitHub Enterprise Cloud',
    path: 'descriptions/ghec/ghec.2026-03-10.json',
    sha256: 'eaaf2e29cd72607ebc56d4e9643289d8a1b1551870d4c382131a4bb0be57f37c',
    expected: {
      paths: 941,
      operations: 1446,
      tags: 53,
      categories: 54,
      webhooks: 294,
    },
  },
  {
    id: 'ghes-3.21',
    label: 'GitHub Enterprise Server 3.21',
    path: 'descriptions/ghes-3.21/ghes-3.21.2026-03-10.json',
    sha256: 'cbf171bea8aa76e174c3f1fcadb8dc33a866c891c666fb61b4dae4d7f5e74e32',
    expected: {
      paths: 706,
      operations: 1092,
      tags: 40,
      categories: 44,
      webhooks: 272,
    },
  },
]

const NewDotComOperationIds = [
  'copilot/copilot-enterprise-repos-one-day-report',
  'copilot/copilot-organization-repos-one-day-report',
  'secret-scanning/bulk-create-org-custom-patterns',
  'secret-scanning/bulk-create-repo-custom-patterns',
  'secret-scanning/bulk-delete-org-custom-patterns',
  'secret-scanning/bulk-delete-repo-custom-patterns',
  'secret-scanning/list-org-custom-patterns',
  'secret-scanning/list-repo-custom-patterns',
  'secret-scanning/update-org-custom-pattern',
  'secret-scanning/update-repo-custom-pattern',
]
const Methods = ['get', 'head', 'post', 'put', 'patch', 'delete']
const ParameterSchemaKeys = [
  'type',
  'enum',
  'const',
  'default',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'nullable',
]

function rawURL(path) {
  return `https://raw.githubusercontent.com/github/rest-api-description/${SourceCommit}/${path}`
}

function sourceURL(path) {
  return `https://github.com/github/rest-api-description/blob/${SourceCommit}/${path}`
}

async function fetchPinnedSource(source) {
  const response = await fetch(rawURL(source.path), {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(
      `Could not fetch ${source.label} OpenAPI source: ${response.status} ${response.statusText}`
    )
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== source.sha256) {
    throw new Error(
      `${source.label} OpenAPI SHA-256 changed: expected ${source.sha256}, got ${sha256}`
    )
  }
  return { api: JSON.parse(bytes.toString('utf8')), sha256 }
}

function resolveLocalReference(api, value, component) {
  if (typeof value?.$ref !== 'string') {
    return value
  }
  const prefix = `#/components/${component}/`
  if (!value.$ref.startsWith(prefix)) {
    throw new Error(`Unsupported ${component} reference: ${value.$ref}`)
  }
  const resolved =
    api.components?.[component]?.[value.$ref.slice(prefix.length)]
  if (resolved === undefined) {
    throw new Error(`Missing ${component} reference: ${value.$ref}`)
  }
  return resolved
}

function projectParameterSchema(api, schema, ancestors = new Set()) {
  if (schema === undefined || schema === null || typeof schema !== 'object') {
    return {}
  }

  let source = schema
  let ref = null
  if (typeof schema.$ref === 'string') {
    ref = schema.$ref
    if (ancestors.has(ref)) {
      return { ref }
    }
    source = resolveLocalReference(api, schema, 'schemas')
    ancestors = new Set(ancestors).add(ref)
  }

  const result = {}
  if (ref !== null) {
    result.ref = ref
  }
  for (const key of ParameterSchemaKeys) {
    if (source[key] !== undefined) {
      result[key] = source[key]
    }
  }
  if (source.items !== undefined) {
    result.items = projectParameterSchema(api, source.items, ancestors)
  }
  for (const union of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(source[union])) {
      result[union] = source[union].map(value =>
        projectParameterSchema(api, value, ancestors)
      )
    }
  }
  return result
}

function schemaTypes(schema) {
  const result = new Set()
  const visit = value => {
    if (typeof value?.type === 'string') {
      result.add(value.type)
    } else if (Array.isArray(value?.type)) {
      value.type.forEach(type => result.add(type))
    }
    for (const union of ['oneOf', 'anyOf', 'allOf']) {
      value?.[union]?.forEach(visit)
    }
  }
  visit(schema)
  return [...result]
}

function projectParameter(api, parameter) {
  const resolved = resolveLocalReference(api, parameter, 'parameters')
  const schema = projectParameterSchema(api, resolved.schema ?? {})
  const types = schemaTypes(schema)
  return {
    name: resolved.name,
    in: resolved.in,
    required: resolved.required === true,
    type:
      types.length === 1 ? types[0] : types.length === 0 ? 'string' : 'union',
    types,
    ...(Array.isArray(schema.enum) ? { values: schema.enum } : {}),
    schema,
  }
}

function projectServer(server) {
  return {
    url: server.url,
    ...(server.description === undefined
      ? {}
      : { description: server.description }),
    ...(server.variables === undefined ? {} : { variables: server.variables }),
  }
}

function projectProduct(source, api, sourceSha256) {
  const operations = []
  const categoryCounts = new Map()

  for (const [path, pathItem] of Object.entries(api.paths)) {
    for (const method of Methods) {
      const operation = pathItem[method]
      if (operation === undefined) {
        continue
      }

      const github = operation['x-github'] ?? {}
      const category = github.category ?? operation.tags?.[0] ?? 'other'
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)
      const parameters = [
        ...(pathItem.parameters ?? []),
        ...(operation.parameters ?? []),
      ]
        .map(parameter => projectParameter(api, parameter))
        .filter(
          parameter => parameter.in === 'path' || parameter.in === 'query'
        )
      const requestBody = resolveLocalReference(
        api,
        operation.requestBody,
        'requestBodies'
      )
      const explicitServers = operation.servers ?? pathItem.servers ?? []

      operations.push({
        id: operation.operationId,
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? operation.operationId,
        category,
        subcategory: github.subcategory ?? null,
        documentationUrl: operation.externalDocs?.url ?? null,
        cloudOnly: github.githubCloudOnly === true,
        enabledForGitHubApps: github.enabledForGitHubApps !== false,
        deprecated: operation.deprecated === true,
        deprecationDate: github.deprecationDate ?? null,
        removalDate: github.removalDate ?? null,
        previewed: Object.prototype.hasOwnProperty.call(github, 'previews'),
        previews: github.previews ?? [],
        triggersNotification: github.triggersNotification === true,
        requestBodyParameterName: github.requestBodyParameterName ?? null,
        parameters,
        requestBodyRequired: requestBody?.required === true,
        requestBodyContentTypes: Object.keys(requestBody?.content ?? {}),
        servers: explicitServers.map(projectServer),
      })
    }
  }

  operations.sort((left, right) => left.id.localeCompare(right.id))
  const operationIds = new Set(operations.map(operation => operation.id))
  if (operationIds.size !== operations.length) {
    throw new Error(`${source.label} contains duplicate operation IDs.`)
  }

  const newOperationIds =
    source.id === 'dotcom'
      ? NewDotComOperationIds.filter(id => operationIds.has(id))
      : []
  if (
    source.id === 'dotcom' &&
    newOperationIds.length !== NewDotComOperationIds.length
  ) {
    throw new Error('The GitHub.com source is missing a pinned new operation.')
  }

  const inventory = {
    paths: Object.keys(api.paths).length,
    operations: operations.length,
    tags: api.tags.length,
    categories: categoryCounts.size,
    webhooks: Object.keys(api['x-webhooks'] ?? {}).length,
  }
  for (const [name, expected] of Object.entries(source.expected)) {
    if (inventory[name] !== expected) {
      throw new Error(
        `${source.label} OpenAPI ${name} changed: expected ${expected}, got ${inventory[name]}`
      )
    }
  }

  return {
    id: source.id,
    label: source.label,
    apiVersion: ApiVersion,
    sourceCommit: SourceCommit,
    sourceSha256,
    sourceUrl: sourceURL(source.path),
    inventory,
    newOperationIds,
    categories: [...categoryCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, count]) => ({ name, count })),
    operations,
  }
}

const products = []
for (const source of Sources) {
  const { api, sha256 } = await fetchPinnedSource(source)
  products.push(projectProduct(source, api, sha256))
}

const catalog = {
  version: CatalogVersion,
  purpose:
    'Product-aware runtime GitHub REST operation catalogs for named app functions.',
  apiVersion: ApiVersion,
  sourceCommit: SourceCommit,
  previousSourceCommit: PreviousSourceCommit,
  products,
}

mkdirSync(dirname(OutputPath), { recursive: true })
writeFileSync(OutputPath, `${JSON.stringify(catalog)}\n`)
console.log(
  `Generated ${products
    .map(product => `${product.inventory.operations} ${product.id}`)
    .join(', ')} GitHub REST operations in ${OutputPath}`
)
