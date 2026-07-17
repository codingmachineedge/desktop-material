import assert from 'node:assert'
import { describe, it } from 'node:test'

import { projectRootOperations } from './generate-github-graphql-operation-catalog.mjs'

const fixtureSchema = `
directive @docsCategory(name: String!) on OBJECT | FIELD_DEFINITION

scalar String
scalar Int
scalar Boolean

enum State {
  OPEN
  CLOSED
}

input Filter {
  states: [State!]
  include: Boolean
}

type Repository {
  name: String!
}

type UpdatePayload {
  repository: Repository
}

"""
The root query.
"""
type Query @docsCategory(name: "meta") {
  """
  Find a repository.
  """
  repository(
    """Repository owner."""
    owner: String!
    limit: Int = 10
    filter: Filter = { states: [OPEN], include: true }
  ): Repository @deprecated(reason: "Use node instead.")

  version: String!
}

type Mutation {
  """Update a repository."""
  updateRepository(input: Filter!): UpdatePayload
}
`

describe('GitHub GraphQL operation catalog generator', () => {
  it('projects exact root operation signatures and lifecycle metadata', () => {
    const operations = projectRootOperations(fixtureSchema)
    assert.deepEqual(
      operations.map(operation => operation.id),
      ['mutation:updateRepository', 'query:repository', 'query:version']
    )

    const repository = operations.find(
      operation => operation.id === 'query:repository'
    )
    assert.ok(repository)
    assert.equal(repository.kind, 'query')
    assert.equal(repository.name, 'repository')
    assert.equal(repository.description, 'Find a repository.')
    assert.equal(repository.returnType, 'Repository')
    assert.equal(repository.returnNamedType, 'Repository')
    assert.equal(repository.returnKind, 'object')
    assert.equal(repository.deprecated, true)
    assert.equal(repository.deprecationReason, 'Use node instead.')
    assert.deepEqual(repository.args, [
      {
        name: 'owner',
        description: 'Repository owner.',
        type: 'String!',
        defaultValue: null,
      },
      {
        name: 'limit',
        description: null,
        type: 'Int',
        defaultValue: '10',
      },
      {
        name: 'filter',
        description: null,
        type: 'Filter',
        defaultValue: '{ states: [OPEN], include: true }',
      },
    ])

    const version = operations.find(
      operation => operation.id === 'query:version'
    )
    assert.ok(version)
    assert.equal(version.returnKind, 'scalar')
    assert.equal(version.description, null)
    assert.equal(version.deprecated, false)
    assert.equal(version.deprecationReason, null)
  })
})
