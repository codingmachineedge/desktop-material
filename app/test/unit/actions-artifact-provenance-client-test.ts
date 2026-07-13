import assert from 'node:assert'
import { describe, it, mock } from 'node:test'
import {
  ActionsArtifactProvenanceResult,
  IActionsArtifactVerificationPolicy,
} from '../../src/lib/actions-artifact-provenance'

let invokes = 0
let payload: unknown
const sends = new Array<{ readonly channel: string; readonly value: unknown }>()
let onInvoke: () => void = () => undefined
let invokeResult: ActionsArtifactProvenanceResult = {
  ok: false,
  reason: 'not-attested',
}

mock.module('../../src/lib/ipc-renderer', {
  namedExports: {
    invoke: async (_channel: string, value: unknown) => {
      invokes++
      payload = value
      onInvoke()
      return invokeResult
    },
    send: (channel: string, value: unknown) => sends.push({ channel, value }),
  },
})

const policy: IActionsArtifactVerificationPolicy = {
  sourceRepositoryURI: 'https://github.com/actions/attest',
  sourceDigest: 'a'.repeat(40),
  sourceRef: 'refs/heads/main',
  signerIdentity:
    'https://github.com/actions/attest/.github/workflows/prober.yml@refs/heads/main',
  signerDigest: 'b'.repeat(40),
  repositoryVisibility: 'public',
}
const request = {
  downloadId: 'c'.repeat(32),
  inventoryId: 'd'.repeat(32),
  entryId: 'e'.repeat(32),
  expectedSubjectDigest: `sha256:${'f'.repeat(64)}`,
  bundles: [
    JSON.stringify({
      mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
      verificationMaterial: {},
      dsseEnvelope: {},
    }),
  ],
  policy,
}

function reset(): void {
  invokes = 0
  payload = undefined
  sends.length = 0
  onInvoke = () => undefined
  invokeResult = { ok: false, reason: 'not-attested' }
}

function registrationRaceSignal(): AbortSignal {
  let reads = 0
  return {
    get aborted() {
      reads++
      return reads > 1
    },
    addEventListener() {},
    removeEventListener() {},
  } as unknown as AbortSignal
}

describe('Actions artifact provenance renderer client', () => {
  it('closes the post-registration abort race before invoking main', async () => {
    reset()
    const { verifyActionsArtifactProvenanceThroughMainProcess } = await import(
      '../../src/lib/actions-artifact-provenance-client'
    )
    await assert.rejects(
      verifyActionsArtifactProvenanceThroughMainProcess(
        request,
        registrationRaceSignal()
      ),
      { name: 'AbortError' }
    )
    assert.equal(invokes, 0)
    assert.equal(sends.length, 1)
    assert.equal(sends[0].channel, 'cancel-actions-artifact-provenance')
    assert.match(String(sends[0].value), /^[a-f0-9]{32}$/)
  })

  it('suppresses a late green result when abort wins before invoke resolves', async () => {
    reset()
    const controller = new AbortController()
    onInvoke = () => controller.abort()
    invokeResult = {
      ok: true,
      subject: {
        inventoryId: request.inventoryId,
        entryId: request.entryId,
        path: 'artifact.bin',
        bytes: 4,
        digest: request.expectedSubjectDigest,
      },
      evidence: {
        subjectDigest: request.expectedSubjectDigest,
        predicateType: 'https://slsa.dev/provenance/v1',
        signerIdentity: policy.signerIdentity,
        signerDigest: policy.signerDigest,
        oidcIssuer: 'https://token.actions.githubusercontent.com',
        runnerEnvironment: 'github-hosted',
        sourceRepositoryURI: policy.sourceRepositoryURI,
        sourceRepositoryDigest: policy.sourceDigest,
        sourceRepositoryRef: policy.sourceRef,
        sourceRepositoryVisibilityAtSigning: 'public',
        attestations: [],
      },
    }
    const { verifyActionsArtifactProvenanceThroughMainProcess } = await import(
      '../../src/lib/actions-artifact-provenance-client'
    )
    await assert.rejects(
      verifyActionsArtifactProvenanceThroughMainProcess(
        request,
        controller.signal
      ),
      { name: 'AbortError' }
    )
    assert.equal(invokes, 1)
    assert.equal(sends.length, 1)
  })

  it('sends only the exact opaque verifier request and preserves normalized failures', async () => {
    reset()
    invokeResult = { ok: false, reason: 'verification-failed' }
    const { verifyActionsArtifactProvenanceThroughMainProcess } = await import(
      '../../src/lib/actions-artifact-provenance-client'
    )
    assert.deepEqual(
      await verifyActionsArtifactProvenanceThroughMainProcess(
        request,
        new AbortController().signal
      ),
      invokeResult
    )
    assert.equal(invokes, 1)
    const value = payload as Record<string, unknown>
    assert.deepEqual(Object.keys(value).sort(), [
      'bundles',
      'downloadId',
      'entryId',
      'expectedSubjectDigest',
      'inventoryId',
      'operationId',
      'policy',
    ])
    assert.match(String(value.operationId), /^[a-f0-9]{32}$/)
    const serialized = JSON.stringify(value)
    for (const forbidden of [
      'C:\\',
      'token',
      'endpoint',
      'executable',
      'argv',
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden)
    }
  })
})
