import assert from 'node:assert'
import { describe, it } from 'node:test'
import { ActionsArtifactProvenanceCredentialSource } from '../../../src/main-process/actions-artifact-provenance-credential-source'

const lease = {
  endpoint: 'https://api.octocorp.ghe.com/',
  login: 'octocat',
}

describe('Actions artifact provenance credential source', () => {
  it('reads exactly one endpoint-derived key and login with no fallback or enumeration', async () => {
    const calls = new Array<readonly [string, string]>()
    const source = new ActionsArtifactProvenanceCredentialSource({
      getKeyForEndpoint: endpoint => {
        assert.equal(endpoint, lease.endpoint)
        return `GitHub - ${endpoint}`
      },
      readToken: async (key, login) => {
        calls.push([key, login])
        return 'ghe-token-value'
      },
    })
    assert.equal(
      await source.read(lease, new AbortController().signal),
      'ghe-token-value'
    )
    assert.deepEqual(calls, [[`GitHub - ${lease.endpoint}`, lease.login]])
  })

  it('maps missing, invalid, and rejected keychain reads to null without a token-bearing error', async () => {
    for (const value of [null, '', 'bad\ntoken'] as const) {
      const source = new ActionsArtifactProvenanceCredentialSource({
        readToken: async () => value,
      })
      assert.equal(await source.read(lease, new AbortController().signal), null)
    }
    const rejected = new ActionsArtifactProvenanceCredentialSource({
      readToken: async () => {
        throw new Error('keychain unavailable')
      },
    })
    assert.equal(await rejected.read(lease, new AbortController().signal), null)
  })

  it('bounds a hanging read and suppresses its late settlement', async () => {
    let resolveToken!: (value: string | null) => void
    const pending = new Promise<string | null>(resolve => {
      resolveToken = resolve
    })
    const timeout = { fire: null as (() => void) | null }
    const source = new ActionsArtifactProvenanceCredentialSource({
      readToken: async () => await pending,
      schedule: callback => {
        timeout.fire = callback
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      cancelSchedule: () => undefined,
    })
    const reading = source.read(lease, new AbortController().signal)
    while (timeout.fire === null) {
      await new Promise(resolve => setImmediate(resolve))
    }
    timeout.fire()
    assert.equal(await reading, null)
    resolveToken('late-token')
    await new Promise(resolve => setImmediate(resolve))
  })

  it('does not return a credential after lease cancellation', async () => {
    const controller = new AbortController()
    const source = new ActionsArtifactProvenanceCredentialSource({
      readToken: async () => {
        controller.abort()
        return 'ghe-token-value'
      },
    })
    assert.equal(await source.read(lease, controller.signal), null)
  })
})
