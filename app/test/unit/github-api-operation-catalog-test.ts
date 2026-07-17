import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as semver from 'semver'
import {
  filterGitHubAPIOperations,
  getGitHubAPIOperationPath,
  GitHubAPICatalogs,
  GitHubAPICatalogInventory,
  GitHubAPICatalogVersion,
  GitHubAPIOperations,
  GitHubDotComAPICatalog,
  GitHubEnterpriseCloudAPICatalog,
  GitHubEnterpriseServer321APICatalog,
  isNewGitHubAPIOperation,
  NewGitHubAPIOperationIds,
  resolveGitHubAPIOperationCatalog,
} from '../../src/lib/github-api-operation-catalog'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'

describe('GitHub API operation catalog', () => {
  it('contains every operation in the current official description', () => {
    assert.equal(GitHubAPICatalogVersion, '2026-03-10')
    assert.deepEqual(GitHubAPICatalogInventory, {
      paths: 796,
      operations: 1206,
      tags: 49,
      categories: 51,
      webhooks: 270,
    })
    assert.equal(GitHubAPIOperations.length, 1206)
    assert.equal(new Set(GitHubAPIOperations.map(value => value.id)).size, 1206)
  })

  it('keeps complete, distinct catalogs for every pinned GitHub product', () => {
    assert.deepEqual(
      GitHubAPICatalogs.map(catalog => ({
        id: catalog.id,
        sourceProduct: catalog.sourceProduct,
        inventory: catalog.inventory,
      })),
      [
        {
          id: 'dotcom:2026-03-10',
          sourceProduct: 'dotcom',
          inventory: {
            paths: 796,
            operations: 1206,
            tags: 49,
            categories: 51,
            webhooks: 270,
          },
        },
        {
          id: 'ghec:2026-03-10',
          sourceProduct: 'ghec',
          inventory: {
            paths: 941,
            operations: 1446,
            tags: 53,
            categories: 54,
            webhooks: 294,
          },
        },
        {
          id: 'ghes:3.21',
          sourceProduct: 'ghes-3.21',
          inventory: {
            paths: 706,
            operations: 1092,
            tags: 40,
            categories: 44,
            webhooks: 272,
          },
        },
      ]
    )
    for (const catalog of GitHubAPICatalogs) {
      assert.equal(
        new Set(catalog.operations.map(operation => operation.id)).size,
        catalog.inventory.operations
      )
      assert.match(
        catalog.sourceUrl,
        /bf7e007714988319f286ebbd102f1d3cea20dfc2/
      )
    }
    assert.ok(
      GitHubEnterpriseCloudAPICatalog.operations.some(
        operation =>
          operation.id === 'actions/create-hosted-runner-for-enterprise'
      )
    )
    assert.ok(
      !GitHubDotComAPICatalog.operations.some(
        operation =>
          operation.id === 'actions/create-hosted-runner-for-enterprise'
      )
    )
    assert.ok(
      GitHubEnterpriseServer321APICatalog.operations.some(
        operation => operation.id === 'enterprise-admin/create-global-webhook'
      )
    )
    assert.ok(
      !GitHubDotComAPICatalog.operations.some(
        operation => operation.id === 'enterprise-admin/create-global-webhook'
      )
    )
  })

  it('selects by endpoint product and fails closed for unknown GHES catalogs', () => {
    const shouldNotReadVersion = () => {
      throw new Error('Cloud product resolution must not read a GHES version.')
    }
    const dotcom = resolveGitHubAPIOperationCatalog(
      'https://api.github.com',
      shouldNotReadVersion
    )
    assert.equal(dotcom.status, 'available')
    assert.equal(
      dotcom.status === 'available' ? dotcom.catalog.id : null,
      'dotcom:2026-03-10'
    )

    const ghec = resolveGitHubAPIOperationCatalog(
      'https://api.acme.ghe.com',
      shouldNotReadVersion
    )
    assert.equal(ghec.status, 'available')
    assert.equal(
      ghec.status === 'available' ? ghec.catalog.id : null,
      'ghec:2026-03-10'
    )

    for (const version of ['3.21.0', '3.21.9']) {
      const ghes = resolveGitHubAPIOperationCatalog(
        'https://github.acme.test/api/v3',
        () => new semver.SemVer(version)
      )
      assert.equal(ghes.status, 'available')
      assert.equal(
        ghes.status === 'available' ? ghes.catalog.id : null,
        'ghes:3.21'
      )
    }

    const unknown = resolveGitHubAPIOperationCatalog(
      'https://github.acme.test/api/v3',
      () => null
    )
    assert.equal(unknown.status, 'unknown-version')
    assert.equal(unknown.catalog, null)
    const unreadable = resolveGitHubAPIOperationCatalog(
      'https://github.acme.test/api/v3',
      () => {
        throw new Error('version cache unavailable')
      }
    )
    assert.equal(unreadable.status, 'unknown-version')
    assert.equal(unreadable.catalog, null)

    for (const version of ['3.20.99', '3.22.0']) {
      const unsupported = resolveGitHubAPIOperationCatalog(
        'https://github.acme.test/api/v3',
        () => new semver.SemVer(version)
      )
      assert.equal(unsupported.status, 'unsupported-version')
      assert.equal(unsupported.catalog, null)
      assert.equal(unsupported.detectedVersion, version)
    }

    const invalid = resolveGitHubAPIOperationCatalog('not a URL')
    assert.equal(invalid.status, 'invalid-endpoint')
    assert.equal(invalid.catalog, null)
  })

  it('preserves server, request, lifecycle, reference, union, and constraint metadata', () => {
    const operation = (id: string) => {
      const match = GitHubDotComAPICatalog.operations.find(
        value => value.id === id
      )
      assert.ok(match, `Missing operation ${id}`)
      return match
    }
    const parameter = (operationId: string, name: string) => {
      const match = operation(operationId).parameters.find(
        value => value.name === name
      )
      assert.ok(match, `Missing parameter ${operationId}.${name}`)
      return match
    }

    assert.deepEqual(operation('repos/upload-release-asset').servers, [
      {
        url: 'https://uploads.github.com',
        description:
          'The URL origin (protocol + host name + port) is included in `upload_url` returned in the response of the "Create a release" endpoint',
      },
    ])
    assert.deepEqual(operation('markdown/render-raw').requestBodyContentTypes, [
      'text/plain',
      'text/x-markdown',
    ])
    assert.equal(operation('repos/create-release').requestBodyRequired, true)
    assert.equal(
      operation('classroom/get-an-assignment').deprecationDate,
      '2026-05-22'
    )
    assert.equal(
      operation('classroom/get-an-assignment').removalDate,
      '2026-08-28'
    )
    assert.deepEqual(parameter('actions/get-workflow', 'workflow_id').types, [
      'integer',
      'string',
    ])
    assert.deepEqual(
      parameter('actions/get-workflow', 'workflow_id').schema.oneOf,
      [{ type: 'integer' }, { type: 'string' }]
    )
    assert.equal(
      parameter('code-scanning/get-alert', 'alert_number').schema.ref,
      '#/components/schemas/alert-number'
    )
    assert.equal(
      parameter('actions/get-actions-cache-list', 'per_page').schema.default,
      30
    )
    assert.equal(
      parameter('actions/get-concurrency-group-for-repository', 'ahead_of_run')
        .schema.minimum,
      1
    )
    assert.equal(
      parameter('actions/delete-custom-image-version-from-org', 'version')
        .schema.pattern,
      '^\\d+\\.\\d+\\.\\d+$'
    )
    assert.deepEqual(
      parameter('agent-tasks/list-tasks-for-repo', 'creator_id').schema.items,
      { type: 'integer' }
    )
  })

  it('marks all ten and only the ten operations added since the March audit', () => {
    assert.equal(NewGitHubAPIOperationIds.length, 10)
    assert.deepEqual(
      filterGitHubAPIOperations({ newOnly: true }).map(value => value.id),
      [
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
    )
    assert.ok(NewGitHubAPIOperationIds.every(id => isNewGitHubAPIOperation(id)))
  })

  it('searches identifiers, summaries, paths, categories, and subcategories', () => {
    const results = filterGitHubAPIOperations({
      query: 'secret-scanning custom-patterns repository',
      newOnly: true,
    })
    assert.deepEqual(
      results.map(value => value.id),
      [
        'secret-scanning/bulk-create-repo-custom-patterns',
        'secret-scanning/bulk-delete-repo-custom-patterns',
        'secret-scanning/list-repo-custom-patterns',
        'secret-scanning/update-repo-custom-pattern',
      ]
    )
  })

  it('fills repository coordinates without guessing other path parameters', () => {
    const repository = new GitHubRepository(
      'material explorer',
      new Owner('fixture owner', 'https://api.github.test', 1),
      1
    )
    const operation = GitHubAPIOperations.find(
      value => value.id === 'secret-scanning/update-repo-custom-pattern'
    )
    assert.ok(operation)
    assert.equal(
      getGitHubAPIOperationPath(operation, repository),
      'repos/fixture%20owner/material%20explorer/secret-scanning/custom-patterns/{pattern_id}'
    )
  })
})
