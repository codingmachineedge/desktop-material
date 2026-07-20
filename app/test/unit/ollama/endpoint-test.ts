import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  getOllamaApiUrl,
  getOllamaManagementEndpoint,
  isTrustedOllamaEndpoint,
  normalizeOllamaEndpoint,
} from '../../../src/lib/ollama/endpoint'
import { OllamaClientError } from '../../../src/lib/ollama/types'

describe('Ollama endpoint trust', () => {
  it('normalizes root, native, and Copilot-compatible endpoints', () => {
    assert.equal(
      normalizeOllamaEndpoint(' HTTP://LOCALHOST:11434/v1/ '),
      'http://localhost:11434'
    )
    assert.equal(
      normalizeOllamaEndpoint('http://127.42.8.9:11434/api'),
      'http://127.42.8.9:11434'
    )
    assert.equal(
      normalizeOllamaEndpoint('https://models.example.com/ollama/v1/'),
      'https://models.example.com/ollama'
    )
    assert.equal(
      normalizeOllamaEndpoint('http://[::1]:11434/v1'),
      'http://[::1]:11434'
    )
    assert.equal(
      getOllamaManagementEndpoint('https://models.example.com/ollama/v1'),
      'https://models.example.com/ollama'
    )
    assert.equal(
      getOllamaManagementEndpoint('http://localhost.:11434/v1'),
      'http://localhost.:11434'
    )
  })

  it('requires a terminal /v1 path for Copilot management endpoints', () => {
    for (const endpoint of [
      'http://localhost:11434/',
      'http://localhost:11434/api',
      'http://localhost:11434/v1/models',
    ]) {
      assert.throws(
        () => getOllamaManagementEndpoint(endpoint),
        (error: unknown) =>
          error instanceof OllamaClientError && error.kind === 'endpoint'
      )
    }
    assert.equal(
      getOllamaManagementEndpoint('http://localhost:11434/ollama/v1/'),
      'http://localhost:11434/ollama'
    )
  })

  it('builds only fixed native API routes under an optional base path', () => {
    assert.equal(
      getOllamaApiUrl('https://models.example.com/ollama', 'tags'),
      'https://models.example.com/ollama/api/tags'
    )
    assert.equal(
      getOllamaApiUrl(
        normalizeOllamaEndpoint('http://localhost:11434/v1'),
        'version'
      ),
      'http://localhost:11434/api/version'
    )
    const providerBase = getOllamaManagementEndpoint(
      'https://models.example.com/team/api/v1'
    )
    assert.equal(providerBase, 'https://models.example.com/team/api')
    assert.equal(
      getOllamaApiUrl(providerBase, 'tags'),
      'https://models.example.com/team/api/api/tags'
    )
    assert.throws(
      () => getOllamaApiUrl('http://localhost:11434', 'unknown' as never),
      (error: unknown) =>
        error instanceof OllamaClientError && error.kind === 'endpoint'
    )
  })

  it('allows HTTPS remotely but restricts HTTP to loopback addresses', () => {
    assert.equal(isTrustedOllamaEndpoint('https://models.example.com/v1'), true)
    assert.equal(
      isTrustedOllamaEndpoint('https://10.0.0.2:11434/ollama/v1'),
      true
    )
    assert.equal(isTrustedOllamaEndpoint('http://localhost:11434/v1'), true)
    assert.equal(isTrustedOllamaEndpoint('http://127.42.8.9:11434'), true)
    assert.equal(isTrustedOllamaEndpoint('http://192.168.1.5:11434'), false)
    assert.equal(isTrustedOllamaEndpoint('http://example.com:11434'), false)
  })

  it('accepts loopback and HTTPS reverse-proxy base paths', () => {
    assert.equal(
      normalizeOllamaEndpoint('http://localhost:11434/ollama'),
      'http://localhost:11434/ollama'
    )
    assert.equal(
      normalizeOllamaEndpoint('https://models.example.com/team/ollama/api'),
      'https://models.example.com/team/ollama'
    )
    assert.equal(
      normalizeOllamaEndpoint('http://localhost:11434/v1/models'),
      'http://localhost:11434/v1/models'
    )
  })

  it('rejects credentials, query strings, and fragments without echoing them', () => {
    const credentialed =
      'https://alice:super-secret@models.example.com/ollama/v1'
    assert.throws(
      () => normalizeOllamaEndpoint(credentialed),
      (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.kind, 'endpoint')
        assert.equal(error.message.includes('alice'), false)
        assert.equal(error.message.includes('super-secret'), false)
        return true
      }
    )

    for (const endpoint of [
      'https://models.example.com/v1?token=secret',
      'https://models.example.com/v1#secret',
    ]) {
      assert.equal(isTrustedOllamaEndpoint(endpoint), false, endpoint)
    }
  })

  it('rejects unsupported schemes and malformed values without echoing them', () => {
    const secret = 'ftp://alice:super-secret@localhost/models'
    assert.throws(
      () => normalizeOllamaEndpoint(secret),
      (error: unknown) => {
        assert.ok(error instanceof OllamaClientError)
        assert.equal(error.message.includes('alice'), false)
        assert.equal(error.message.includes('super-secret'), false)
        return true
      }
    )
    assert.equal(isTrustedOllamaEndpoint('not a URL'), false)
  })
})
