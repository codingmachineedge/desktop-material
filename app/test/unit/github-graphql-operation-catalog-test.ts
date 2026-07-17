import assert from 'node:assert'
import * as semver from 'semver'
import { describe, it } from 'node:test'

import {
  filterGitHubGraphQLOperations,
  getGitHubGraphQLOperationTemplate,
  GitHubDotComGraphQLCatalog,
  GitHubEnterpriseCloudGraphQLCatalog,
  GitHubEnterpriseServer321GraphQLCatalog,
  GitHubGraphQLCatalogs,
  resolveGitHubGraphQLOperationCatalog,
} from '../../src/lib/github-graphql-operation-catalog'
import { validateGitHubAPIWorkbenchRequest } from '../../src/lib/github-api-workbench'

describe('GitHub GraphQL root-operation catalog', () => {
  it('retains each pinned product inventory and exact source provenance', () => {
    assert.deepEqual(
      GitHubGraphQLCatalogs.map(catalog => ({
        id: catalog.id,
        sourceProduct: catalog.sourceProduct,
        sourceBytes: catalog.sourceBytes,
        sourceSha256: catalog.sourceSha256,
        inventory: catalog.inventory,
      })),
      [
        {
          id: 'graphql-dotcom:2026-07-16',
          sourceProduct: 'dotcom',
          sourceBytes: 1520362,
          sourceSha256:
            'c98cb9edeedd1fb56c8678c19a8ad540c8d0739dd94579dfedbe044192e4ab18',
          inventory: {
            queries: 31,
            mutations: 268,
            operations: 299,
            arguments: 345,
            defaults: 8,
            deprecated: 16,
          },
        },
        {
          id: 'graphql-ghec:2026-07-16',
          sourceProduct: 'ghec',
          sourceBytes: 1520362,
          sourceSha256:
            'c98cb9edeedd1fb56c8678c19a8ad540c8d0739dd94579dfedbe044192e4ab18',
          inventory: {
            queries: 31,
            mutations: 268,
            operations: 299,
            arguments: 345,
            defaults: 8,
            deprecated: 16,
          },
        },
        {
          id: 'graphql-ghes:3.21',
          sourceProduct: 'ghes-3.21',
          sourceBytes: 1324156,
          sourceSha256:
            'f38867e129ba03db6975cd42743be90a4bf70b798ac6157f58265c8fc96e21f7',
          inventory: {
            queries: 24,
            mutations: 236,
            operations: 260,
            arguments: 284,
            defaults: 3,
            deprecated: 16,
          },
        },
      ]
    )
    for (const catalog of GitHubGraphQLCatalogs) {
      assert.equal(
        new Set(catalog.operations.map(operation => operation.id)).size,
        catalog.inventory.operations
      )
      assert.match(
        catalog.sourceUrl,
        /df4329a271f3a195338ed6ab8cd493e1a413444f/
      )
    }
  })

  it('preserves complete argument, return, and deprecation signatures', () => {
    const repository = GitHubDotComGraphQLCatalog.operations.find(
      operation => operation.id === 'query:repository'
    )
    assert.ok(repository)
    assert.equal(
      repository.description,
      'Lookup a given repository by the owner and repository name.'
    )
    assert.deepEqual(repository.args, [
      {
        name: 'followRenames',
        description:
          'Follow repository renames. If disabled, a repository referenced by its old name will return an error.',
        type: 'Boolean',
        defaultValue: 'true',
      },
      {
        name: 'name',
        description: 'The name of the repository',
        type: 'String!',
        defaultValue: null,
      },
      {
        name: 'owner',
        description: 'The login field of a user or organization',
        type: 'String!',
        defaultValue: null,
      },
    ])
    assert.equal(repository.returnType, 'Repository')
    assert.equal(repository.returnKind, 'object')

    const deprecated = GitHubDotComGraphQLCatalog.operations.find(
      operation => operation.id === 'mutation:addProjectCard'
    )
    assert.ok(deprecated)
    assert.equal(deprecated.deprecated, true)
    assert.match(deprecated.deprecationReason ?? '', /Removal on 2025-04-01/)
  })

  it('searches exact root fields without leaking operations across products', () => {
    assert.deepEqual(
      filterGitHubGraphQLOperations(
        { query: 'repository owner String!' },
        GitHubDotComGraphQLCatalog
      )
        .filter(operation => operation.id === 'query:repository')
        .map(operation => operation.id),
      ['query:repository']
    )
    assert.equal(
      filterGitHubGraphQLOperations(
        { query: 'addEnterpriseAdmin' },
        GitHubDotComGraphQLCatalog
      ).length,
      0
    )
    assert.deepEqual(
      filterGitHubGraphQLOperations(
        { query: 'addEnterpriseAdmin', kind: 'mutation' },
        GitHubEnterpriseServer321GraphQLCatalog
      ).map(operation => operation.id),
      ['mutation:addEnterpriseAdmin']
    )
  })

  it('selects schemas by endpoint and fails closed when GHES is unavailable', () => {
    const shouldNotReadVersion = () => {
      throw new Error('Cloud GraphQL catalogs must not read a GHES version.')
    }
    const dotcom = resolveGitHubGraphQLOperationCatalog(
      'https://api.github.com',
      shouldNotReadVersion
    )
    assert.equal(dotcom.status, 'available')
    assert.equal(
      dotcom.status === 'available' ? dotcom.catalog.id : null,
      GitHubDotComGraphQLCatalog.id
    )
    const ghec = resolveGitHubGraphQLOperationCatalog(
      'https://api.acme.ghe.com',
      shouldNotReadVersion
    )
    assert.equal(ghec.status, 'available')
    assert.equal(
      ghec.status === 'available' ? ghec.catalog.id : null,
      GitHubEnterpriseCloudGraphQLCatalog.id
    )
    const ghes = resolveGitHubGraphQLOperationCatalog(
      'https://github.enterprise.test/api/v3',
      () => new semver.SemVer('3.21.8')
    )
    assert.equal(ghes.status, 'available')
    assert.equal(
      ghes.status === 'available' ? ghes.catalog.id : null,
      GitHubEnterpriseServer321GraphQLCatalog.id
    )
    const unknown = resolveGitHubGraphQLOperationCatalog(
      'https://github.enterprise.test/api/v3',
      () => null
    )
    assert.equal(unknown.status, 'unknown-version')
    assert.equal(unknown.catalog, null)
    const unsupported = resolveGitHubGraphQLOperationCatalog(
      'https://github.enterprise.test/api/v3',
      () => new semver.SemVer('3.22.0')
    )
    assert.equal(unsupported.status, 'unsupported-version')
    assert.equal(unsupported.catalog, null)
  })

  it('creates editable root-field templates without claiming nested fields', () => {
    const repository = GitHubDotComGraphQLCatalog.operations.find(
      operation => operation.id === 'query:repository'
    )
    assert.ok(repository)
    const template = getGitHubGraphQLOperationTemplate(repository)
    assert.deepEqual(template, {
      query:
        'query Repository(\n' +
        '  $followRenames: Boolean = true\n' +
        '  $name: String!\n' +
        '  $owner: String!\n' +
        ') {\n' +
        '  repository(\n' +
        '    followRenames: $followRenames\n' +
        '    name: $name\n' +
        '    owner: $owner\n' +
        '  ) {\n' +
        '    __typename\n' +
        '  }\n' +
        '}',
      variablesText: '{}',
      operationName: 'Repository',
    })
    assert.doesNotThrow(() =>
      validateGitHubAPIWorkbenchRequest({
        mode: 'graphql',
        query: template.query,
        variablesText: template.variablesText,
        operationName: template.operationName,
      })
    )

    const id = GitHubDotComGraphQLCatalog.operations.find(
      operation => operation.id === 'query:id'
    )
    assert.ok(id)
    assert.equal(
      getGitHubGraphQLOperationTemplate(id).query,
      'query Id {\n  id\n}'
    )
  })
})
