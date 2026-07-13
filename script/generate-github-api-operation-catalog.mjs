#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ApiVersion = '2026-03-10'
const SourceCommit = '3b43edf675308c515b5e92a3eb89db17f6e6d806'
const SourceSha256 =
  '9b0a095713ff578ebe58b7d7fc284470b6ac7fd005cb384bed2e2c0f7640dc0a'
const Expected = {
  paths: 790,
  operations: 1196,
  tags: 49,
  categories: 51,
  webhooks: 270,
}
const Methods = ['get', 'head', 'post', 'put', 'patch', 'delete']

function usage() {
  console.error(
    'Usage: node script/generate-github-api-operation-catalog.mjs <api.github.com.json> [output.json]'
  )
  process.exit(1)
}

const sourcePath = process.argv[2]
if (!sourcePath) {
  usage()
}
const outputPath = resolve(
  process.argv[3] ?? '.codex/audits/github-rest-operations-2026-03-10.json'
)
const sourceBytes = readFileSync(resolve(sourcePath))
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex')
if (sourceSha256 !== SourceSha256) {
  throw new Error(
    `OpenAPI source SHA-256 changed: expected ${SourceSha256}, got ${sourceSha256}`
  )
}

const api = JSON.parse(sourceBytes.toString('utf8'))

function resolveParameter(parameter) {
  if (typeof parameter?.$ref !== 'string') {
    return parameter
  }
  const prefix = '#/components/parameters/'
  if (!parameter.$ref.startsWith(prefix)) {
    throw new Error(`Unsupported parameter reference: ${parameter.$ref}`)
  }
  return api.components.parameters[parameter.$ref.slice(prefix.length)]
}

function parameterType(parameter) {
  const schema = parameter.schema ?? {}
  if (Array.isArray(schema.enum)) {
    return { type: schema.type ?? 'string', values: schema.enum }
  }
  return { type: schema.type ?? 'string' }
}

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
    const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
      .map(resolveParameter)
      .filter(parameter => parameter?.in === 'path' || parameter?.in === 'query')
      .map(parameter => ({
        name: parameter.name,
        in: parameter.in,
        required: parameter.required === true,
        ...parameterType(parameter),
      }))

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
      parameters,
      requestBodyRequired: operation.requestBody?.required === true,
      requestBodyContentTypes: Object.keys(operation.requestBody?.content ?? {}),
    })
  }
}

operations.sort((left, right) => left.id.localeCompare(right.id))
const inventory = {
  paths: Object.keys(api.paths).length,
  operations: operations.length,
  tags: api.tags.length,
  categories: categoryCounts.size,
  webhooks: Object.keys(api['x-webhooks']).length,
}
for (const [name, expected] of Object.entries(Expected)) {
  if (inventory[name] !== expected) {
    throw new Error(
      `OpenAPI ${name} inventory changed: expected ${expected}, got ${inventory[name]}`
    )
  }
}

const catalog = {
  purpose:
    'Coverage evidence for implementing named app functions; not a runtime endpoint-search catalog.',
  apiVersion: ApiVersion,
  sourceCommit: SourceCommit,
  sourceSha256,
  sourceUrl: `https://github.com/github/rest-api-description/blob/${SourceCommit}/descriptions/api.github.com/api.github.com.json`,
  inventory,
  categories: [...categoryCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => ({ name, count })),
  operations,
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(catalog)}\n`)
console.log(
  `Generated ${operations.length} GitHub REST operations in ${outputPath}`
)
