import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  getOllamaApiUrl,
  getOllamaManagementEndpoint,
  isTrustedOllamaEndpoint,
  normalizeOllamaEndpoint,
} from '../../../src/lib/ollama/endpoint'
import { OllamaClientError } from '../../../src/lib/ollama/types'

describe('Ollama endpoint normalization', () => {
  it('normalizes root, native, and Copilot-compatible endpoints', () => {
    assert.equal(
      normalizeOllamaEndpoint(' HTTP://LOCALHOST:11434/v1/ '),
      'http://localhost:11434'
    )
    assert.equal(
      normalizeOllamaEndpoint('http://127.0.0.8:11434/api'),
      'http://127.0.0.8:11434'
    )
    assert.equal(
      normalizeOllamaEndpoint('https://models.example.com/ollama/v1/'),
      'https://models.example.com/ollama'
    )
    assert.equal(
      normalizeOllamaEndpoint('https://models.example.com/ollama'),
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
      getOllamaApiUrl('https://models.example.com/ollama', 'tags'),
      'https://models.example.com/ollama/api/tags'
    )
  })

  it('allows HTTPS remotely but restricts HTTP to loopback addresses', () => {
    assert.equal(isTrustedOllamaEndpoint('https://models.example.com/v1'), true)
    assert.equal(isTrustedOllamaEndpoint('http://localhost:11434/v1'), true)
    assert.equal(isTrustedOllamaEndpoint('http://127.42.8.9:11434'), true)
    assert.equal(isTrustedOllamaEndpoint('http://192.168.1.5:11434'), false)
    assert.equal(isTrustedOllamaEndpoint('http://example.com:11434'), false)
  })

  it('rejects ambiguous or credential-bearing endpoints without echoing them', () => {
    const credentialed = 'https://alice:super-secret@models.example.com/v1'
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
      'ftp://localhost/models',
      'https://models.example.com/v1?token=secret',
      'https://models.example.com/v1#secret',
      'not a URL',
    ]) {
      assert.equal(isTrustedOllamaEndpoint(endpoint), false, endpoint)
    }
  })
})
