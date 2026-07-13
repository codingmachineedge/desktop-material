import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  assessGitHubAPIWorkbenchRequest,
  formatGitHubAPIWorkbenchPreview,
  normalizeGitHubAPIPath,
  prepareGitHubAPIWorkbenchExecution,
  readGitHubAPIWorkbenchResponse,
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

  it('prepares exact requests and gates every mutation', () => {
    assert.deepEqual(
      prepareGitHubAPIWorkbenchExecution({
        mode: 'rest',
        method: 'GET',
        path: '/repos/octo/repo',
        bodyText: '',
      }),
      { method: 'GET', path: 'repos/octo/repo', body: undefined }
    )
    assert.throws(() =>
      prepareGitHubAPIWorkbenchExecution({
        mode: 'rest',
        method: 'DELETE',
        path: 'repos/octo/repo',
        bodyText: '',
      })
    )
    assert.deepEqual(
      prepareGitHubAPIWorkbenchExecution(
        {
          mode: 'graphql',
          query:
            'mutation Rename { updateRepository(input: {}) { clientMutationId } }',
          variablesText: '{}',
          operationName: 'Rename',
        },
        true
      ),
      {
        method: 'POST',
        path: 'graphql',
        body: {
          query:
            'mutation Rename { updateRepository(input: {}) { clientMutationId } }',
          variables: {},
          operationName: 'Rename',
        },
      }
    )
  })

  it('bounds and redacts response bodies and exposes safe headers only', async () => {
    const response = new Response(
      JSON.stringify({
        token: ['github', 'pat', 'abcdefghijklmnopqrstuvwxyz'].join('_'),
        ok: true,
      }),
      {
        status: 200,
        headers: {
          Authorization: 'Bearer do-not-render',
          'Content-Type': 'application/json',
          'X-GitHub-Request-Id': 'request-id',
          'X-RateLimit-Remaining': '4999',
        },
      }
    )
    const result = await readGitHubAPIWorkbenchResponse(response)
    assert.deepEqual(result.body, { token: '[redacted]', ok: true })
    assert.equal(result.headers.authorization, undefined)
    assert.equal(result.headers['x-github-request-id'], 'request-id')
    assert.equal(result.headers['x-ratelimit-remaining'], '4999')
    assert.equal(result.truncated, false)

    const truncated = await readGitHubAPIWorkbenchResponse(
      new Response('Bearer secret-value and more text', {
        headers: { 'Content-Type': 'text/plain' },
      }),
      20
    )
    assert.equal(truncated.truncated, true)
    assert.equal(truncated.displayedBytes, 20)
    assert.doesNotMatch(String(truncated.body), /secret-value/)
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

  it('redacts signed URL query credentials while preserving safe diagnostics', async () => {
    const secrets = {
      awsCredential: 'aws-credential-secret',
      awsDate: 'aws-date-secret',
      awsSignature: 'aws-signature-secret',
      googleCredential: 'google-credential-secret',
      googleSignature: 'google-signature-secret',
      azureVersion: 'azure-version-secret',
      azurePermission: 'azure-permission-secret',
      azureExpiry: 'azure-expiry-secret',
      azureSignature: 'azure-signature-secret',
      azureIdentifier: 'azure-identifier-secret',
      azureEncryptionScope: 'azure-encryption-scope-secret',
      azureAuthorizedObject: 'azure-authorized-object-secret',
      azureUnauthorizedObject: 'azure-unauthorized-object-secret',
      azureCorrelation: 'azure-correlation-secret',
      cloudFrontPolicy: 'cloudfront-policy-secret',
      cloudFrontSignature: 'cloudfront-signature-secret',
      cloudFrontKey: 'cloudfront-key-secret',
      cloudFrontExpiry: 'cloudfront-expiry-secret',
      genericToken: 'generic-token-secret',
      genericAccessKey: 'generic-access-key-secret',
      genericClientSecret: 'generic-client-secret-value',
      genericPassword: 'generic-password-value',
      legacyAWSAccessKey: 'legacy-aws-access-key-secret',
      legacyAWSSignature: 'legacy-aws-signature-secret',
      legacyAWSExpiry: 'legacy-aws-expiry-secret',
      textToken: 'text-token-secret',
    }
    const response = new Response(
      JSON.stringify({
        links: {
          aws: `https://objects.example.test/file?X-Amz-Credential=${secrets.awsCredential}&X-Amz-Date=${secrets.awsDate}&X-Amz-Signature=${secrets.awsSignature}&safe=visible`,
          google: `https://storage.example.test/file?X-Goog-Credential=${secrets.googleCredential}&X-Goog-Signature=${secrets.googleSignature}&alt=media`,
          azure: `https://blob.example.test/file?sv=${secrets.azureVersion}&sp=${secrets.azurePermission}&se=${secrets.azureExpiry}&si=${secrets.azureIdentifier}&ses=${secrets.azureEncryptionScope}&saoid=${secrets.azureAuthorizedObject}&suoid=${secrets.azureUnauthorizedObject}&scid=${secrets.azureCorrelation}&sig=${secrets.azureSignature}&safe=azure-visible`,
          cloudfront: `https://cdn.example.test/file?Policy=${secrets.cloudFrontPolicy}&Signature=${secrets.cloudFrontSignature}&Key-Pair-Id=${secrets.cloudFrontKey}&Expires=${secrets.cloudFrontExpiry}&download=1`,
          legacyAws: `https://objects.example.test/file?AWSAccessKeyId=${secrets.legacyAWSAccessKey}&Signature=${secrets.legacyAWSSignature}&Expires=${secrets.legacyAWSExpiry}&response-content-type=text%2Fplain`,
          generic: `https://api.example.test/file?access_token=${secrets.genericToken}&access-key=${secrets.genericAccessKey}&client_secret=${secrets.genericClientSecret}&password=${secrets.genericPassword}&page=2`,
          safe: 'https://api.example.test/items?page=2&label=diagnostic',
        },
        text: `download https://api.example.test/file?token=${secrets.textToken}&mode=raw`,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          Location: `https://objects.example.test/file?X-Amz-Credential=${secrets.awsCredential}&X-Amz-Signature=${secrets.awsSignature}&safe=visible`,
        },
      }
    )

    const result = await readGitHubAPIWorkbenchResponse(response)
    const rendered = JSON.stringify(result)
    for (const secret of Object.values(secrets)) {
      assert.equal(rendered.includes(secret), false, secret)
    }
    assert.match(rendered, /\[redacted\]/)
    assert.match(rendered, /safe=visible/)
    assert.match(rendered, /safe=azure-visible/)
    assert.match(rendered, /page=2/)
    assert.match(rendered, /label=diagnostic/)
    assert.match(rendered, /mode=raw/)
    assert.match(rendered, /response-content-type=text%2Fplain/)

    const rawText = await readGitHubAPIWorkbenchResponse(
      new Response(
        'download https://cdn.example.test/file?signature=raw-signature-secret&mode=text',
        { headers: { 'Content-Type': 'text/plain' } }
      )
    )
    assert.doesNotMatch(String(rawText.body), /raw-signature-secret/)
    assert.match(String(rawText.body), /mode=text/)
  })
})
