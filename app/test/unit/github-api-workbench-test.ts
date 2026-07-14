import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  assessGitHubAPIWorkbenchRequest,
  formatGitHubAPIWorkbenchPreview,
  normalizeGitHubAPIPath,
  redactGitHubAPIWorkbenchValue,
  validateGitHubAPIWorkbenchRequest,
} from '../../src/lib/github-api-workbench'

describe('GitHub API workbench contract', () => {
  it('keeps requests on the selected account host', () => {
    assert.equal(
      normalizeGitHubAPIPath('/repos/octo/repo?per_page=100'),
      'repos/octo/repo?per_page=100'
    )
    assert.throws(() => normalizeGitHubAPIPath('https://evil.example/'))
    assert.throws(() => normalizeGitHubAPIPath('repos/octo/../admin'))
    assert.throws(() => normalizeGitHubAPIPath('repos%2F..%2Fadmin'))
    assert.throws(() => normalizeGitHubAPIPath('repos/octo/repo#token'))
  })

  it('validates bounded REST JSON and GraphQL variables', () => {
    assert.deepEqual(
      validateGitHubAPIWorkbenchRequest({
        mode: 'rest',
        method: 'PATCH',
        path: 'repos/octo/repo',
        bodyText: '{"archived":true}',
      }),
      {
        mode: 'rest',
        method: 'PATCH',
        path: 'repos/octo/repo',
        body: { archived: true },
      }
    )
    assert.deepEqual(
      validateGitHubAPIWorkbenchRequest({
        mode: 'graphql',
        query: 'query Repo($name: String!) { viewer { login } }',
        variablesText: '{"name":"desktop-material"}',
      }),
      {
        mode: 'graphql',
        query: 'query Repo($name: String!) { viewer { login } }',
        variables: { name: 'desktop-material' },
        operationName: undefined,
      }
    )
    assert.throws(() =>
      validateGitHubAPIWorkbenchRequest({
        mode: 'graphql',
        query: '{ viewer { login } }',
        variablesText: '[]',
      })
    )
  })

  it('requires confirmation for every mutation and destructive request', () => {
    assert.equal(
      assessGitHubAPIWorkbenchRequest({
        mode: 'rest',
        method: 'GET',
        path: 'user',
        bodyText: '',
      }).risk,
      'read'
    )
    assert.equal(
      assessGitHubAPIWorkbenchRequest({
        mode: 'rest',
        method: 'DELETE',
        path: 'repos/octo/repo',
        bodyText: '',
      }).risk,
      'destructive'
    )
    assert.equal(
      assessGitHubAPIWorkbenchRequest({
        mode: 'graphql',
        query:
          'mutation Rename { updateRepository(input: {}) { clientMutationId } }',
        variablesText: '{}',
      }).requiresConfirmation,
      true
    )
    assert.equal(
      assessGitHubAPIWorkbenchRequest({
        mode: 'graphql',
        query:
          'query Text { repository(name: "mutation example", owner: "o") { id } }',
        variablesText: '{}',
      }).risk,
      'read'
    )
  })

  it('redacts credential-shaped response data and previews no body values', () => {
    assert.deepEqual(
      redactGitHubAPIWorkbenchValue({
        login: 'octocat',
        token: 'github_pat_never-show-this-value',
        nested: {
          url: 'https://user:password@example.test/path',
          header: 'Bearer abc.def.ghi',
        },
      }),
      {
        login: 'octocat',
        token: '[redacted]',
        nested: {
          url: '[redacted]example.test/path',
          header: '[redacted]',
        },
      }
    )
    const preview = formatGitHubAPIWorkbenchPreview({
      mode: 'rest',
      method: 'POST',
      path: 'repos/octo/repo/issues',
      bodyText: '{"body":"private text"}',
    })
    assert.equal(preview, 'POST /repos/octo/repo/issues with JSON body')
    assert.equal(preview.includes('private text'), false)
  })
})
