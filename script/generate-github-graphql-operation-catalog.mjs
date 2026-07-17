#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CatalogVersion = 1
const SnapshotDate = '2026-07-16'
const SourceCommit = 'df4329a271f3a195338ed6ab8cd493e1a413444f'
const SourceCommitDate = '2026-07-16T20:40:29Z'
const DefaultOutputPath =
  '.codex/audits/github-graphql-root-operations-2026-07-16.json'

const Sources = [
  {
    id: 'dotcom',
    label: 'GitHub.com',
    path: 'src/graphql/data/fpt/schema.docs.graphql',
    bytes: 1520362,
    sha256: 'c98cb9edeedd1fb56c8678c19a8ad540c8d0739dd94579dfedbe044192e4ab18',
    expected: {
      queries: 31,
      mutations: 268,
      operations: 299,
      arguments: 345,
      defaults: 8,
      deprecated: 16,
    },
  },
  {
    id: 'ghec',
    label: 'GitHub Enterprise Cloud',
    path: 'src/graphql/data/ghec/schema.docs.graphql',
    bytes: 1520362,
    sha256: 'c98cb9edeedd1fb56c8678c19a8ad540c8d0739dd94579dfedbe044192e4ab18',
    expected: {
      queries: 31,
      mutations: 268,
      operations: 299,
      arguments: 345,
      defaults: 8,
      deprecated: 16,
    },
  },
  {
    id: 'ghes-3.21',
    label: 'GitHub Enterprise Server 3.21',
    path: 'src/graphql/data/ghes-3.21/schema.docs-enterprise.graphql',
    bytes: 1324156,
    sha256: 'f38867e129ba03db6975cd42743be90a4bf70b798ac6157f58265c8fc96e21f7',
    expected: {
      queries: 24,
      mutations: 236,
      operations: 260,
      arguments: 284,
      defaults: 3,
      deprecated: 16,
    },
  },
]

function rawURL(path) {
  return `https://raw.githubusercontent.com/github/docs/${SourceCommit}/${path}`
}

function sourceURL(path) {
  return `https://github.com/github/docs/blob/${SourceCommit}/${path}`
}

function normalizeBlockString(value) {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  let commonIndent = null
  for (const line of lines.slice(1)) {
    if (line.trim().length === 0) {
      continue
    }
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0
    commonIndent =
      commonIndent === null ? indent : Math.min(commonIndent, indent)
  }
  if (commonIndent !== null && commonIndent > 0) {
    for (let index = 1; index < lines.length; index++) {
      lines[index] = lines[index].slice(commonIndent)
    }
  }
  while (lines.length > 0 && lines[0].trim().length === 0) {
    lines.shift()
  }
  while (lines.length > 0 && lines.at(-1).trim().length === 0) {
    lines.pop()
  }
  return lines.join('\n')
}

function stringValue(raw) {
  if (raw.startsWith('"""')) {
    return normalizeBlockString(raw.slice(3, -3).replaceAll('\\"""', '"""'))
  }
  return JSON.parse(raw)
}

function tokenize(source) {
  const tokens = []
  let index = 0
  while (index < source.length) {
    const character = source[index]
    if (character === '\ufeff' || character === ',' || /\s/.test(character)) {
      index++
      continue
    }
    if (character === '#') {
      const newline = source.indexOf('\n', index + 1)
      index = newline < 0 ? source.length : newline + 1
      continue
    }

    const start = index
    if (source.startsWith('"""', index)) {
      index += 3
      while (index < source.length) {
        if (source.startsWith('"""', index) && source[index - 1] !== '\\') {
          index += 3
          break
        }
        index++
      }
      if (!source.slice(start, index).endsWith('"""')) {
        throw new Error(
          'The GraphQL schema contains an unterminated block string.'
        )
      }
      const raw = source.slice(start, index)
      tokens.push({
        kind: 'string',
        raw,
        value: stringValue(raw),
        start,
        end: index,
      })
      continue
    }
    if (character === '"') {
      index++
      let escaped = false
      while (index < source.length) {
        const next = source[index++]
        if (next === '"' && !escaped) {
          break
        }
        escaped = next === '\\' && !escaped
      }
      const raw = source.slice(start, index)
      if (!raw.endsWith('"')) {
        throw new Error('The GraphQL schema contains an unterminated string.')
      }
      tokens.push({
        kind: 'string',
        raw,
        value: stringValue(raw),
        start,
        end: index,
      })
      continue
    }
    if (/[_A-Za-z]/.test(character)) {
      index++
      while (index < source.length && /[_0-9A-Za-z]/.test(source[index])) {
        index++
      }
      const raw = source.slice(start, index)
      tokens.push({ kind: 'name', raw, value: raw, start, end: index })
      continue
    }
    if (character === '-' || /[0-9]/.test(character)) {
      index++
      while (index < source.length && /[0-9.eE+-]/.test(source[index])) {
        index++
      }
      const raw = source.slice(start, index)
      tokens.push({ kind: 'number', raw, value: raw, start, end: index })
      continue
    }
    const raw = source.startsWith('...', index) ? '...' : character
    index += raw.length
    tokens.push({ kind: 'punct', raw, value: raw, start, end: index })
  }
  return tokens
}

function expectToken(tokens, index, value) {
  if (tokens[index]?.value !== value) {
    throw new Error(
      `Expected GraphQL token '${value}', got '${
        tokens[index]?.value ?? 'EOF'
      }'.`
    )
  }
  return index + 1
}

function parseType(tokens, start) {
  let index = start
  let namedType
  if (tokens[index]?.value === '[') {
    const nested = parseType(tokens, index + 1)
    namedType = nested.namedType
    index = expectToken(tokens, nested.index, ']')
  } else {
    const name = tokens[index]
    if (name?.kind !== 'name') {
      throw new Error(`Expected a GraphQL type at token ${index}.`)
    }
    namedType = name.value
    index++
  }
  if (tokens[index]?.value === '!') {
    index++
  }
  return {
    index,
    namedType,
    text: tokens
      .slice(start, index)
      .map(token => token.raw)
      .join(''),
  }
}

function parseConstValue(tokens, start) {
  const opening = tokens[start]?.value
  const closing = opening === '[' ? ']' : opening === '{' ? '}' : null
  if (closing === null) {
    if (tokens[start] === undefined) {
      throw new Error('Expected a GraphQL constant value, got EOF.')
    }
    return start + 1
  }

  let index = start + 1
  while (tokens[index]?.value !== closing) {
    if (tokens[index] === undefined) {
      throw new Error(`GraphQL constant value is missing '${closing}'.`)
    }
    if (opening === '{') {
      if (tokens[index].kind !== 'name') {
        throw new Error('Expected a GraphQL input-object field name.')
      }
      index = expectToken(tokens, index + 1, ':')
    }
    index = parseConstValue(tokens, index)
  }
  return index + 1
}

function parseDirectives(tokens, start) {
  const directives = new Map()
  let index = start
  while (tokens[index]?.value === '@') {
    const name = tokens[index + 1]
    if (name?.kind !== 'name') {
      throw new Error('Expected a GraphQL directive name.')
    }
    index += 2
    const args = new Map()
    if (tokens[index]?.value === '(') {
      index++
      while (tokens[index]?.value !== ')') {
        const argument = tokens[index]
        if (argument?.kind !== 'name') {
          throw new Error(`Expected an argument for @${name.value}.`)
        }
        index = expectToken(tokens, index + 1, ':')
        const valueStart = index
        index = parseConstValue(tokens, index)
        const valueTokens = tokens.slice(valueStart, index)
        args.set(argument.value, {
          raw: valueTokens.map(token => token.raw).join(''),
          value:
            valueTokens.length === 1 &&
            (valueTokens[0].kind === 'string' ||
              valueTokens[0].kind === 'name' ||
              valueTokens[0].kind === 'number')
              ? valueTokens[0].value
              : null,
        })
      }
      index++
    }
    directives.set(name.value, args)
  }
  return { directives, index }
}

function parseArguments(source, tokens, start) {
  const args = []
  let index = expectToken(tokens, start, '(')
  while (tokens[index]?.value !== ')') {
    let description = null
    if (tokens[index]?.kind === 'string') {
      description = tokens[index].value
      index++
    }
    const name = tokens[index]
    if (name?.kind !== 'name') {
      throw new Error('Expected a GraphQL root-field argument name.')
    }
    index = expectToken(tokens, index + 1, ':')
    const type = parseType(tokens, index)
    index = type.index
    let defaultValue = null
    if (tokens[index]?.value === '=') {
      const valueStart = index + 1
      index = parseConstValue(tokens, valueStart)
      defaultValue = source
        .slice(tokens[valueStart].start, tokens[index - 1].end)
        .trim()
    }
    index = parseDirectives(tokens, index).index
    args.push({
      name: name.value,
      description,
      type: type.text,
      defaultValue,
    })
  }
  return { args, index: index + 1 }
}

function schemaTypeKinds(tokens) {
  const result = new Map([
    ['String', 'scalar'],
    ['Int', 'scalar'],
    ['Float', 'scalar'],
    ['Boolean', 'scalar'],
    ['ID', 'scalar'],
  ])
  const kinds = new Set(['scalar', 'enum', 'type', 'interface', 'union'])
  for (let index = 0; index < tokens.length - 1; index++) {
    if (kinds.has(tokens[index].value) && tokens[index + 1].kind === 'name') {
      result.set(
        tokens[index + 1].value,
        tokens[index].value === 'type' ? 'object' : tokens[index].value
      )
    }
  }
  return result
}

function parseRootDefinition(source, tokens, start, rootKind, typeKinds) {
  let index = start + 2
  while (tokens[index]?.value !== '{') {
    if (tokens[index] === undefined) {
      throw new Error(`The GraphQL ${rootKind} root has no field block.`)
    }
    index++
  }
  index++
  const operations = []
  while (tokens[index]?.value !== '}') {
    let description = null
    if (tokens[index]?.kind === 'string') {
      description = tokens[index].value
      index++
    }
    const name = tokens[index]
    if (name?.kind !== 'name') {
      throw new Error(`Expected a ${rootKind} root-field name.`)
    }
    index++
    let args = []
    if (tokens[index]?.value === '(') {
      const parsed = parseArguments(source, tokens, index)
      args = parsed.args
      index = parsed.index
    }
    index = expectToken(tokens, index, ':')
    const returnType = parseType(tokens, index)
    index = returnType.index
    const parsedDirectives = parseDirectives(tokens, index)
    index = parsedDirectives.index
    const deprecation = parsedDirectives.directives.get('deprecated')
    const returnKind = typeKinds.get(returnType.namedType) ?? 'unknown'
    operations.push({
      id: `${rootKind}:${name.value}`,
      kind: rootKind,
      name: name.value,
      description,
      args,
      returnType: returnType.text,
      returnNamedType: returnType.namedType,
      returnKind,
      deprecated: deprecation !== undefined,
      deprecationReason:
        deprecation === undefined
          ? null
          : deprecation.get('reason')?.value ?? 'No longer supported',
    })
  }
  return operations
}

export function projectRootOperations(source) {
  const tokens = tokenize(source)
  const typeKinds = schemaTypeKinds(tokens)
  const operations = []
  for (let index = 0; index < tokens.length - 1; index++) {
    if (
      tokens[index].value === 'type' &&
      (tokens[index + 1].value === 'Query' ||
        tokens[index + 1].value === 'Mutation')
    ) {
      const rootKind = tokens[index + 1].value.toLocaleLowerCase()
      operations.push(
        ...parseRootDefinition(source, tokens, index, rootKind, typeKinds)
      )
    }
  }
  operations.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name)
  )
  const operationIds = new Set(operations.map(operation => operation.id))
  if (operations.length === 0 || operationIds.size !== operations.length) {
    throw new Error('The GraphQL schema has missing or duplicate root fields.')
  }
  const unknownReturnKinds = operations.filter(
    operation => operation.returnKind === 'unknown'
  )
  if (unknownReturnKinds.length > 0) {
    throw new Error(
      `Unknown GraphQL return types: ${unknownReturnKinds
        .map(operation => `${operation.id}:${operation.returnNamedType}`)
        .join(', ')}`
    )
  }
  return operations
}

async function fetchPinnedSource(source) {
  const response = await fetch(rawURL(source.path), {
    headers: { Accept: 'text/plain' },
  })
  if (!response.ok) {
    throw new Error(
      `Could not fetch ${source.label} GraphQL schema: ${response.status} ${response.statusText}`
    )
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (bytes.length !== source.bytes || sha256 !== source.sha256) {
    throw new Error(
      `${source.label} GraphQL schema changed: expected ${source.bytes} bytes and ${source.sha256}, got ${bytes.length} bytes and ${sha256}`
    )
  }
  return { text: bytes.toString('utf8'), sha256 }
}

function projectProduct(source, schema, sourceSha256) {
  const operations = projectRootOperations(schema)
  const inventory = {
    queries: operations.filter(operation => operation.kind === 'query').length,
    mutations: operations.filter(operation => operation.kind === 'mutation')
      .length,
    operations: operations.length,
    arguments: operations.reduce(
      (count, operation) => count + operation.args.length,
      0
    ),
    defaults: operations.reduce(
      (count, operation) =>
        count +
        operation.args.filter(argument => argument.defaultValue !== null)
          .length,
      0
    ),
    deprecated: operations.filter(operation => operation.deprecated).length,
  }
  for (const [name, expected] of Object.entries(source.expected)) {
    if (inventory[name] !== expected) {
      throw new Error(
        `${source.label} GraphQL ${name} changed: expected ${expected}, got ${inventory[name]}`
      )
    }
  }
  return {
    id: source.id,
    label: source.label,
    productVersion: source.id === 'ghes-3.21' ? '3.21' : null,
    sourceCommit: SourceCommit,
    sourceCommitDate: SourceCommitDate,
    sourceBytes: source.bytes,
    sourceSha256,
    sourceUrl: sourceURL(source.path),
    inventory,
    operations,
  }
}

export async function generateGitHubGraphQLOperationCatalog(outputPath) {
  const products = []
  for (const source of Sources) {
    const { text, sha256 } = await fetchPinnedSource(source)
    products.push(projectProduct(source, text, sha256))
  }
  const catalog = {
    version: CatalogVersion,
    purpose:
      'Product-aware GitHub GraphQL query and mutation root-field catalogs.',
    snapshotDate: SnapshotDate,
    sourceRepository: 'github/docs',
    sourceCommit: SourceCommit,
    sourceCommitDate: SourceCommitDate,
    products,
  }
  const resolvedOutputPath = resolve(outputPath ?? DefaultOutputPath)
  mkdirSync(dirname(resolvedOutputPath), { recursive: true })
  writeFileSync(resolvedOutputPath, `${JSON.stringify(catalog)}\n`)
  return { catalog, outputPath: resolvedOutputPath }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { catalog, outputPath } = await generateGitHubGraphQLOperationCatalog(
    process.argv[2]
  )
  console.log(
    `Generated ${catalog.products
      .map(product => `${product.inventory.operations} ${product.id}`)
      .join(', ')} GitHub GraphQL root operations in ${outputPath}`
  )
}
