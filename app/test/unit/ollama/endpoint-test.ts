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
  it('canonicalizes loopback origins and the exact /v1 BYOK base', () => {
    assert.equal(
      normalizeOllamaEndpoint('http://localhost:11434/v1/'),
      'http://localhost:11434'
    )
    assert.equal(
      normalizeOllamaEndpoint('http://127.42.8.9:11434/'),
      'http://127.42.8.9:11434'
    )
    assert.equal(
      normalizeOllamaEndpoint('https://[::1]:11434/v1'),
      'https://[::1]:11434'
    )
    assert.equal(
      getOllamaManagementEndpoint('http://localhost:11434/v1'),
      'http://localhost:11434'
    )
  })

  it('builds only fixed native API routes', () => {
    assert.equal(
      getOllamaApiUrl('http://localhost:11434', 'tags'),
      'http://localhost:11434/api/tags'
    )
    assert.throws(
      () => getOllamaApiUrl('http://localhost:11434', 'unknown' as never),
      (error: unknown) =>
        error instanceof OllamaClientError && error.kind === 'endpoint'
    )
  })

  it('rejects remote HTTP and HTTPS endpoints', () => {
    for (const endpoint of [
      'http://192.168.1.5:11434/v1',
      'http://example.com:11434/v1',
      'https://models.example.com/v1',
      'https://10.0.0.2:11434/v1',
    ]) {
      assert.equal(isTrustedOllamaEndpoint(endpoint), false, endpoint)
    }
  })

  it('rejects URL credentials, query strings, fragments, and whitespace', () => {
    for (const endpoint of [
      'http://alice:secret@localhost:11434/v1',
      'http://localhost:11434/v1?token=secret',
      'http://localhost:11434/v1#secret',
      ' http://localhost:11434/v1',
      'http://localhost:11434/v1 ',
      'http://localhost.:11434/v1',
    ]) {
      assert.equal(isTrustedOllamaEndpoint(endpoint), false, endpoint)
    }
  })

  it('rejects arbitrary paths and native API bases', () => {
    for (const endpoint of [
      'http://localhost:11434/api',
      'http://localhost:11434/ollama',
      'http://localhost:11434/ollama/v1',
      'http://localhost:11434/v1/models',
    ]) {
      assert.equal(isTrustedOllamaEndpoint(endpoint), false, endpoint)
    }
    assert.throws(() => getOllamaManagementEndpoint('http://localhost:11434/'))
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
