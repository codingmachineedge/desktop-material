import assert from 'node:assert'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

import {
  createNamedAPIFunctionBinding,
  createNamedAPIFunctionDefinition,
  functionBelongsToBinding,
  namedAPIFunctionNameFromTool,
  namedAPIFunctionToolName,
  parseNamedAPIFunctionsDocument,
  prepareNamedAPIFunctionInvocation,
  serializeNamedAPIFunctionsDocument,
} from '../../src/lib/named-api-functions'
import { Account, getAccountKey } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { Repository } from '../../src/models/repository'

function fixture() {
  const account = new Account(
    'fixture',
    'https://api.github.test',
    'credential-not-persisted',
    [],
    '',
    42,
    'Fixture',
    'free'
  )
  const repository = new Repository(
    resolve('named-api-function-fixture'),
    1,
    new GitHubRepository(
      'material',
      new Owner('desktop', account.endpoint, 1),
      1
    ),
    false,
    null,
    {},
    false,
    undefined,
    getAccountKey(account)
  )
  return { account, repository }
}

describe('named API functions', () => {
  it('builds a bounded REST schema and substitutes only catalog parameters', () => {
    const { account, repository } = fixture()
    const definition = createNamedAPIFunctionDefinition({
      name: 'update_pattern',
      description: 'Update one repository secret scanning pattern.',
      operationId: 'secret-scanning/update-repo-custom-pattern',
      binding: createNamedAPIFunctionBinding(repository, account),
      request: {
        mode: 'rest',
        method: 'PATCH',
        path: 'repos/desktop/material/secret-scanning/custom-patterns/{pattern_id}',
        bodyText: '{"name":"Fixture pattern"}',
      },
      now: new Date('2026-07-17T00:00:00.000Z'),
    })

    assert.equal(definition.risk, 'write')
    assert.ok('pattern_id' in definition.parameterSchema.properties)
    assert.equal(definition.parameterSchema.properties.body.type, 'object')
    assert.ok(definition.parameterSchema.required?.includes('pattern_id'))
    assert.doesNotMatch(JSON.stringify(definition), /credential-not-persisted/)

    const reboundRepository = new Repository(
      repository.path,
      repository.id,
      repository.gitHubRepository,
      repository.missing,
      'A changed display alias',
      repository.workflowPreferences,
      repository.isTutorialRepository,
      repository.gitDir,
      repository.accountKey
    )
    assert.notEqual(reboundRepository.hash, repository.hash)
    assert.equal(
      functionBelongsToBinding(
        definition,
        createNamedAPIFunctionBinding(reboundRepository, account)
      ),
      true
    )

    const invocation = prepareNamedAPIFunctionInvocation(definition, {
      pattern_id: 7,
    })
    assert.equal(invocation.requiresConfirmation, true)
    assert.deepEqual(invocation.request, {
      mode: 'rest',
      method: 'PATCH',
      path: 'repos/desktop/material/secret-scanning/custom-patterns/7',
      bodyText: '{"name":"Fixture pattern"}',
    })
    assert.throws(
      () =>
        prepareNamedAPIFunctionInvocation(definition, {
          pattern_id: 1,
          undeclared: true,
        }),
      /not declared/
    )
    const overridden = prepareNamedAPIFunctionInvocation(definition, {
      pattern_id: 8,
      body: { name: 'Updated pattern' },
    })
    assert.equal(
      overridden.request.mode === 'rest' ? overridden.request.bodyText : null,
      '{"name":"Updated pattern"}'
    )
    assert.throws(
      () =>
        prepareNamedAPIFunctionInvocation(definition, {
          pattern_id: 8,
          body: { password: 'not-stored' },
        }),
      /credential-shaped/
    )
  })

  it('derives GraphQL variables and preserves mandatory mutation review', () => {
    const { account, repository } = fixture()
    const definition = createNamedAPIFunctionDefinition({
      name: 'rename_repository',
      description: 'Rename the bound repository.',
      operationId: 'graphql:RenameRepository',
      binding: createNamedAPIFunctionBinding(repository, account),
      request: {
        mode: 'graphql',
        query:
          'mutation RenameRepository($repositoryId: ID!, $name: String!) { updateRepository(input: { repositoryId: $repositoryId, name: $name }) { repository { name } } }',
        variablesText: '{"repositoryId":"R_1","name":"material"}',
        operationName: 'RenameRepository',
      },
      now: new Date('2026-07-17T00:00:00.000Z'),
    })

    assert.deepEqual(definition.parameterSchema.required, [
      'repositoryId',
      'name',
    ])
    const invocation = prepareNamedAPIFunctionInvocation(definition, {
      repositoryId: 'R_1',
      name: 'material-next',
    })
    assert.equal(invocation.risk, 'write')
    assert.equal(invocation.requiresConfirmation, true)
    assert.deepEqual(
      invocation.request.mode === 'graphql'
        ? JSON.parse(invocation.request.variablesText)
        : null,
      { repositoryId: 'R_1', name: 'material-next' }
    )

    assert.throws(
      () =>
        createNamedAPIFunctionDefinition({
          name: 'wrong_operation',
          description: 'A template with a stale operation selector.',
          operationId: 'graphql:MissingOperation',
          binding: createNamedAPIFunctionBinding(repository, account),
          request: {
            mode: 'graphql',
            query: 'query ActualOperation { viewer { login } }',
            variablesText: '{}',
            operationName: 'MissingOperation',
          },
        }),
      /identify an operation/
    )

    const lexicalDecoy = createNamedAPIFunctionDefinition({
      name: 'review_lexical_decoy',
      description: 'Keep a retained mutation behind mandatory review.',
      operationId: 'graphql:Evil',
      binding: createNamedAPIFunctionBinding(repository, account),
      request: {
        mode: 'graphql',
        query:
          'query Decoy { search(query: "query Evil #", type: REPOSITORY, first: 1) { repositoryCount } } mutation Evil { updateRepository(input: { repositoryId: "R_1", name: "renamed" }) { repository { name } } }',
        variablesText: '{}',
        operationName: 'Evil',
      },
    })
    assert.equal(lexicalDecoy.risk, 'write')
    assert.equal(
      prepareNamedAPIFunctionInvocation(lexicalDecoy, {}).requiresConfirmation,
      true
    )
  })

  it('rejects secret-shaped definitions and tampered persisted risk/schema', () => {
    const { account, repository } = fixture()
    const draft = {
      name: 'list_patterns',
      description: 'List repository patterns.',
      operationId: 'secret-scanning/list-repo-custom-patterns',
      binding: createNamedAPIFunctionBinding(repository, account),
      request: {
        mode: 'rest' as const,
        method: 'GET' as const,
        path: 'repos/desktop/material/secret-scanning/custom-patterns',
        bodyText: '',
      },
      now: new Date('2026-07-17T00:00:00.000Z'),
    }
    const definition = createNamedAPIFunctionDefinition(draft)
    const serialized = serializeNamedAPIFunctionsDocument([definition])
    assert.equal(parseNamedAPIFunctionsDocument(serialized).functions.length, 1)

    const tampered = JSON.parse(serialized)
    tampered.functions[0].risk = 'destructive'
    assert.throws(
      () => parseNamedAPIFunctionsDocument(JSON.stringify(tampered)),
      /risk/
    )

    assert.throws(
      () =>
        createNamedAPIFunctionDefinition({
          ...draft,
          request: {
            ...draft.request,
            bodyText: '{"access_token":"github_pat_fixture_value_123456789"}',
          },
        }),
      /credential-shaped/
    )
    assert.throws(
      () =>
        createNamedAPIFunctionDefinition({
          ...draft,
          request: {
            ...draft.request,
            bodyText: '{"accessToken":"opaque-credential-value"}',
          },
        }),
      /credential-shaped/
    )
    assert.throws(
      () =>
        createNamedAPIFunctionDefinition({
          name: 'credential_query',
          description: 'Must not retain a camel-case credential variable.',
          operationId: 'graphql:CredentialQuery',
          binding: createNamedAPIFunctionBinding(repository, account),
          request: {
            mode: 'graphql',
            query:
              'query CredentialQuery($accessToken: String!) { viewer { login } }',
            variablesText: '{"accessToken":"opaque-credential-value"}',
            operationName: 'CredentialQuery',
          },
        }),
      /credential-shaped/
    )
    assert.throws(
      () =>
        createNamedAPIFunctionDefinition({
          ...draft,
          request: {
            ...draft.request,
            path: 'repos/another/target/secret-scanning/custom-patterns',
          },
        }),
      /does not match/
    )
    assert.throws(
      () =>
        createNamedAPIFunctionDefinition({
          ...draft,
          request: {
            ...draft.request,
            bodyText: '{"password":"plain-text-value"}',
          },
        }),
      /credential-shaped/
    )
    assert.throws(
      () =>
        createNamedAPIFunctionDefinition({
          ...draft,
          binding: {
            ...draft.binding,
            repositoryHash: '0'.repeat(64),
          },
        }),
      /fingerprint/
    )
  })

  it('maps valid names to agent tool names and rejects lookalikes', () => {
    assert.equal(
      namedAPIFunctionToolName('list_patterns'),
      'github_api_list_patterns'
    )
    assert.equal(
      namedAPIFunctionNameFromTool('github_api_list_patterns'),
      'list_patterns'
    )
    assert.equal(namedAPIFunctionNameFromTool('github_api_ListPatterns'), null)
  })
})
