import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  ActionsArtifactAttestationMaximumBundles,
  ActionsArtifactAttestationMaximumBytes,
  buildActionsArtifactSignerCandidates,
  normalizeActionsArtifactFullRef,
  normalizeActionsArtifactGitObjectId,
  normalizeActionsArtifactProvenanceOperationId,
  normalizeActionsArtifactSHA256,
  parseActionsArtifactAttestationBundles,
} from '../../src/lib/actions-artifact-provenance'

const sha = '7d3af28c422bf02197a99f195b689b34377e11a2'
const subjectDigest =
  'sha256:5c8cbe5000262fc77cbb58a56f5cb030c46075f3e89d9a9189c525d2968748e4'

const bundle = (payload: string = 'cGF5bG9hZA==') => ({
  mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
  verificationMaterial: { certificate: { rawBytes: 'Y2VydA==' } },
  dsseEnvelope: {
    payload,
    payloadType: 'application/vnd.in-toto+json',
    signatures: [{ sig: 'c2ln' }],
  },
})

describe('Actions artifact provenance contracts', () => {
  it('strips provider metadata into bounded one-line bundle JSON', () => {
    const parsed = parseActionsArtifactAttestationBundles({
      attestations: [
        {
          bundle: bundle(),
          bundle_url: 'https://api.github.com/private/provider/metadata',
          initiator: { login: 'not-rendered' },
          repository_id: 42,
        },
      ],
    })

    assert.equal(parsed.bundles.length, 1)
    assert.equal(parsed.bundles[0].includes('\n'), false)
    assert.equal(parsed.bundles[0].includes('bundle_url'), false)
    assert.deepEqual(JSON.parse(parsed.bundles[0]), bundle())
    assert.equal(
      parsed.serializedBytes,
      new TextEncoder().encode(`${parsed.bundles[0]}\n`).byteLength
    )
  })

  it('accepts zero through thirty bundles and rejects a probe record', () => {
    assert.deepEqual(
      parseActionsArtifactAttestationBundles({ attestations: [] }),
      { bundles: [], serializedBytes: 0 }
    )
    assert.equal(
      parseActionsArtifactAttestationBundles({
        attestations: Array.from(
          { length: ActionsArtifactAttestationMaximumBundles },
          () => ({ bundle: bundle() })
        ),
      }).bundles.length,
      ActionsArtifactAttestationMaximumBundles
    )
    assert.throws(() =>
      parseActionsArtifactAttestationBundles({
        attestations: Array.from(
          { length: ActionsArtifactAttestationMaximumBundles + 1 },
          () => ({ bundle: bundle() })
        ),
      })
    )
  })

  it('rejects malformed, non-JSON, overly complex, and oversized bundles', () => {
    for (const value of [
      null,
      {},
      { attestations: null },
      { attestations: [null] },
      { attestations: [{ bundle: null }] },
      {
        attestations: [{ bundle: { ...bundle(), verificationMaterial: null } }],
      },
      {
        attestations: [
          { bundle: { ...bundle(), dsseEnvelope: { payload: undefined } } },
        ],
      },
    ]) {
      assert.throws(() => parseActionsArtifactAttestationBundles(value))
    }

    const circular = bundle() as Record<string, unknown>
    circular.circular = circular
    assert.throws(() =>
      parseActionsArtifactAttestationBundles({
        attestations: [{ bundle: circular }],
      })
    )

    assert.throws(() =>
      parseActionsArtifactAttestationBundles({
        attestations: [
          {
            bundle: bundle('x'.repeat(ActionsArtifactAttestationMaximumBytes)),
          },
        ],
      })
    )
  })

  it('normalizes only exact lowercase operation, digest, object, and ref values', () => {
    assert.equal(
      normalizeActionsArtifactProvenanceOperationId('a'.repeat(32)),
      'a'.repeat(32)
    )
    assert.equal(normalizeActionsArtifactSHA256(subjectDigest), subjectDigest)
    assert.equal(normalizeActionsArtifactGitObjectId(sha), sha)
    assert.equal(
      normalizeActionsArtifactFullRef('refs/heads/main'),
      'refs/heads/main'
    )

    for (const value of ['A'.repeat(32), 'a'.repeat(31), '../operation']) {
      assert.throws(() => normalizeActionsArtifactProvenanceOperationId(value))
    }
    assert.throws(() =>
      normalizeActionsArtifactSHA256(subjectDigest.toUpperCase())
    )
    assert.throws(() => normalizeActionsArtifactGitObjectId(sha.toUpperCase()))
    assert.throws(() => normalizeActionsArtifactFullRef('main'))
  })

  it('builds exact direct and reusable signer choices without inventing refs', () => {
    const common = {
      host: 'github.com',
      owner: 'actions',
      repository: 'attest',
      sourceDigest: sha,
      workflowPath: '.github/workflows/prober-public-good.yml',
      referencedWorkflows: [
        {
          path: `actions/attest/.github/workflows/prober.yml@${sha}`,
          ref: 'refs/heads/main',
          sha,
        },
      ],
    }
    const candidates = buildActionsArtifactSignerCandidates({
      ...common,
      sourceRef: 'refs/heads/main',
    })

    assert.deepEqual(candidates, [
      {
        identity:
          'https://github.com/actions/attest/.github/workflows/prober-public-good.yml@refs/heads/main',
        digest: sha,
        repository: 'actions/attest',
        workflowPath: '.github/workflows/prober-public-good.yml',
        ref: 'refs/heads/main',
        kind: 'current-workflow',
      },
      {
        identity:
          'https://github.com/actions/attest/.github/workflows/prober.yml@refs/heads/main',
        digest: sha,
        repository: 'actions/attest',
        workflowPath: '.github/workflows/prober.yml',
        ref: 'refs/heads/main',
        kind: 'reusable-workflow',
      },
    ])

    const withoutSourceRef = buildActionsArtifactSignerCandidates({
      ...common,
      sourceRef: null,
    })
    assert.equal(withoutSourceRef.length, 1)
    assert.equal(withoutSourceRef[0].kind, 'reusable-workflow')
  })

  it('rejects incomplete or mismatched signer metadata', () => {
    assert.throws(() =>
      buildActionsArtifactSignerCandidates({
        host: 'GitHub.com',
        owner: 'actions',
        repository: 'attest',
        sourceDigest: sha,
        sourceRef: 'refs/heads/main',
      })
    )
    assert.throws(() =>
      buildActionsArtifactSignerCandidates({
        host: 'github.com',
        owner: 'actions',
        repository: 'attest',
        sourceDigest: sha,
        sourceRef: 'refs/heads/main',
        referencedWorkflows: [
          {
            path: `actions/attest/.github/workflows/prober.yml@${'b'.repeat(
              40
            )}`,
            ref: 'refs/heads/main',
            sha,
          },
        ],
      })
    )
  })
})
