import assert from 'node:assert'
import { access, readFile } from 'fs/promises'
import { resolve } from 'path'
import { describe, it } from 'node:test'
import {
  ActionsArtifactAttestationMaximumBundles,
  ActionsArtifactAttestationMaximumBytes,
  IActionsArtifactProvenanceVerifyRequest,
  IActionsArtifactVerificationEvidence,
  IActionsArtifactVerificationPolicy,
} from '../../../src/lib/actions-artifact-provenance'
import { ActionsArtifactSubjectError } from '../../../src/lib/actions-artifact-subjects'
import { IActionsArtifactDownloadSender } from '../../../src/main-process/actions-artifact-download-registry'
import {
  ActionsArtifactProvenanceService,
  IActionsArtifactProvenanceVerifierFiles,
} from '../../../src/main-process/actions-artifact-provenance'
import { ActionsArtifactProvenanceCredentialLeaseRegistry } from '../../../src/main-process/actions-artifact-provenance-credential-lease'

const sha = '7d3af28c422bf02197a99f195b689b34377e11a2'
const subjectDigest =
  'sha256:5c8cbe5000262fc77cbb58a56f5cb030c46075f3e89d9a9189c525d2968748e4'
const signerIdentity =
  'https://github.com/actions/attest/.github/workflows/prober.yml@refs/heads/main'
const policy: IActionsArtifactVerificationPolicy = {
  sourceRepositoryURI: 'https://github.com/actions/attest',
  sourceDigest: sha,
  sourceRef: 'refs/heads/main',
  runId: 29283111640,
  runAttempt: 1,
  signerIdentity,
  signerDigest: sha,
  repositoryVisibility: 'public',
}
const ghePolicy: IActionsArtifactVerificationPolicy = {
  ...policy,
  sourceRepositoryURI: 'https://octocorp.ghe.com/actions/attest',
  signerIdentity:
    'https://octocorp.ghe.com/actions/attest/.github/workflows/prober.yml@refs/heads/main',
}
const bundle = JSON.stringify({
  mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
  verificationMaterial: {},
  dsseEnvelope: {},
})
const evidence: IActionsArtifactVerificationEvidence = {
  subjectDigest,
  predicateType: 'https://slsa.dev/provenance/v1',
  signerIdentity,
  signerDigest: sha,
  oidcIssuer: 'https://token.actions.githubusercontent.com',
  runnerEnvironment: 'github-hosted',
  sourceRepositoryURI: 'https://github.com/actions/attest',
  sourceRepositoryDigest: sha,
  sourceRepositoryRef: 'refs/heads/main',
  sourceRepositoryVisibilityAtSigning: 'public',
  attestations: [
    {
      subjectNames: ['artifact'],
      certificateIssuer: 'CN=GitHub Attestations',
      runInvocationURI:
        'https://github.com/actions/attest/actions/runs/29283111640/attempts/1',
      timestamps: [
        {
          type: 'Tlog',
          timestamp: '2026-07-13T20:37:25Z',
          uri: 'https://rekor.sigstore.dev',
        },
      ],
    },
  ],
}

const sender: IActionsArtifactDownloadSender = {
  id: 801,
  on: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
  isDestroyed: () => false,
}

function registerGHELease(
  registry: ActionsArtifactProvenanceCredentialLeaseRegistry
): string {
  const handle = registry.register(sender, {
    accountKey: 'https://api.octocorp.ghe.com/#42',
    endpoint: 'https://api.octocorp.ghe.com/',
    login: 'octocat',
    accountsGeneration: 1,
  })
  assert.ok(handle)
  return handle
}

const request = (
  bundles: ReadonlyArray<string> = [bundle],
  selectedPolicy: IActionsArtifactVerificationPolicy = policy,
  accountHandle: string | null = null
): IActionsArtifactProvenanceVerifyRequest => ({
  operationId: 'a'.repeat(32),
  accountHandle,
  downloadId: 'b'.repeat(32),
  inventoryId: 'c'.repeat(32),
  entryId: 'd'.repeat(32),
  expectedSubjectDigest: subjectDigest,
  bundles,
  policy: selectedPolicy,
})

const lease = {
  filePath: resolve('private', 'subject.bin'),
  entryId: 'd'.repeat(32),
  entryPath: 'artifact.bin',
  bytes: 17,
  digest: subjectDigest,
  archiveDigest: `sha256:${'e'.repeat(64)}`,
}

const withSubject = async <T>(
  _sender: IActionsArtifactDownloadSender,
  subjectRequest: {
    readonly operationId: string
    readonly downloadId: string
    readonly inventoryId: string
    readonly entryId: string
    readonly expectedDigest: string
  },
  use: (subject: typeof lease, signal: AbortSignal) => Promise<T>
): Promise<T> => {
  assert.deepEqual(subjectRequest, {
    operationId: 'a'.repeat(32),
    downloadId: 'b'.repeat(32),
    inventoryId: 'c'.repeat(32),
    entryId: 'd'.repeat(32),
    expectedDigest: subjectDigest,
  })
  return await use(lease, new AbortController().signal)
}

async function missing(path: string): Promise<boolean> {
  try {
    await access(path)
    return false
  } catch {
    return true
  }
}

describe('Actions artifact provenance service', () => {
  it('revalidates canonical bundles, writes private JSONL, and returns only normalized evidence', async () => {
    let files: IActionsArtifactProvenanceVerifierFiles | undefined
    const service = new ActionsArtifactProvenanceService({
      withSubject,
      runner: {
        verify: async input => {
          files = input
          assert.equal(await readFile(input.bundlePath, 'utf8'), `${bundle}\n`)
          assert.equal(input.subjectPath, lease.filePath)
          assert.equal(input.subjectDigest, subjectDigest)
          assert.equal(input.credential, null)
          assert.deepEqual(input.policy, policy)
          for (const path of [
            input.configDirectory,
            input.cacheDirectory,
            input.stateDirectory,
            input.dataDirectory,
          ]) {
            assert.equal(await missing(path), false)
          }
          return { ok: true, evidence }
        },
        killAll: async () => undefined,
      },
    })

    const result = await service.verify(sender, request())
    assert.deepEqual(result, {
      ok: true,
      subject: {
        inventoryId: 'c'.repeat(32),
        entryId: 'd'.repeat(32),
        path: 'artifact.bin',
        bytes: 17,
        digest: subjectDigest,
      },
      evidence,
    })
    assert.ok(files)
    assert.equal(await missing(files!.workingDirectory), true)
    assert.equal(JSON.stringify(result).includes(lease.filePath), false)
  })

  it('rehashes zero-bundle requests and rejects GHE bundles without an opaque lease', async () => {
    let subjectUses = 0
    let runnerUses = 0
    const countedSubject: typeof withSubject = async (...args) => {
      subjectUses++
      return await withSubject(...args)
    }
    const service = new ActionsArtifactProvenanceService({
      withSubject: countedSubject,
      runner: {
        verify: async () => {
          runnerUses++
          return { ok: true, evidence }
        },
        killAll: async () => undefined,
      },
    })

    assert.deepEqual(await service.verify(sender, request([])), {
      ok: false,
      reason: 'not-attested',
    })
    assert.deepEqual(
      await service.verify(sender, request([bundle], ghePolicy)),
      {
        ok: false,
        reason: 'verifier-unavailable',
      }
    )
    assert.equal(subjectUses, 1)
    assert.equal(runnerUses, 0)
  })

  it('claims GHE credentials before awaits, then reads only after rehash and bundle preparation', async () => {
    const registry = new ActionsArtifactProvenanceCredentialLeaseRegistry()
    const handle = registerGHELease(registry)
    let rehashed = false
    let bundlesPrepared = false
    let credentialReads = 0
    let runnerUses = 0
    const service = new ActionsArtifactProvenanceService({
      credentialLeases: registry,
      credentialSource: {
        read: async (credentialLease, signal) => {
          assert.equal(rehashed, true)
          assert.equal(bundlesPrepared, true)
          assert.equal(signal.aborted, false)
          assert.equal(
            credentialLease.endpoint,
            'https://api.octocorp.ghe.com/'
          )
          credentialReads++
          return 'selected-ghe-token'
        },
      },
      withSubject: async (...args) => {
        // A second claim loses synchronously before the subject callback starts.
        assert.equal(registry.claim(sender.id, handle, 'f'.repeat(32)), null)
        rehashed = true
        return await withSubject(...args)
      },
      withVerifierFiles: async (_bundles, use) => {
        bundlesPrepared = true
        return await use({
          bundlePath: resolve('private', 'bundles.jsonl'),
          workingDirectory: resolve('private'),
          configDirectory: resolve('private', 'config'),
          cacheDirectory: resolve('private', 'cache'),
          stateDirectory: resolve('private', 'state'),
          dataDirectory: resolve('private', 'data'),
        })
      },
      runner: {
        verify: async input => {
          runnerUses++
          assert.equal(input.credential, 'selected-ghe-token')
          assert.equal(input.signal.aborted, false)
          return { ok: true, evidence }
        },
        killAll: async () => undefined,
      },
    })
    try {
      assert.equal(
        (await service.verify(sender, request([bundle], ghePolicy, handle))).ok,
        true
      )
      assert.equal(credentialReads, 2)
      assert.equal(runnerUses, 1)
      assert.equal(registry.size, 0)
    } finally {
      registry.releaseAll()
    }
  })

  it('refuses a cross-tenant handle before subject, keychain, or verifier work', async () => {
    const registry = new ActionsArtifactProvenanceCredentialLeaseRegistry()
    const handle = registerGHELease(registry)
    const otherTenant: IActionsArtifactVerificationPolicy = {
      ...ghePolicy,
      sourceRepositoryURI: 'https://other.ghe.com/actions/attest',
      signerIdentity:
        'https://other.ghe.com/actions/attest/.github/workflows/prober.yml@refs/heads/main',
    }
    let subjects = 0
    let reads = 0
    const service = new ActionsArtifactProvenanceService({
      credentialLeases: registry,
      credentialSource: {
        read: async () => {
          reads++
          return 'selected-ghe-token'
        },
      },
      withSubject: async (...args) => {
        subjects++
        return await withSubject(...args)
      },
      runner: {
        verify: async () => ({ ok: true, evidence }),
        killAll: async () => undefined,
      },
    })
    try {
      assert.deepEqual(
        await service.verify(sender, request([bundle], otherTenant, handle)),
        { ok: false, reason: 'verifier-unavailable' }
      )
      assert.equal(subjects, 0)
      assert.equal(reads, 0)
      assert.equal(registry.size, 0)
    } finally {
      registry.releaseAll()
    }
  })

  it('suppresses a GHE result when the exact keychain credential rotates or is revoked', async () => {
    const rotatedRegistry =
      new ActionsArtifactProvenanceCredentialLeaseRegistry()
    const rotatedHandle = registerGHELease(rotatedRegistry)
    let reads = 0
    const rotated = new ActionsArtifactProvenanceService({
      credentialLeases: rotatedRegistry,
      credentialSource: {
        // Buffer.from encodes both of these distinct JS strings as U+FFFD in
        // UTF-8. The service must still reject this exact-token rotation.
        read: async () => (reads++ === 0 ? 'token-\uD800' : 'token-\uFFFD'),
      },
      withSubject,
      runner: {
        verify: async input => {
          assert.equal(input.credential, 'token-\uD800')
          return { ok: true, evidence }
        },
        killAll: async () => undefined,
      },
    })
    try {
      assert.deepEqual(
        await rotated.verify(
          sender,
          request([bundle], ghePolicy, rotatedHandle)
        ),
        { ok: false, reason: 'verifier-unavailable' }
      )
    } finally {
      rotatedRegistry.releaseAll()
    }

    const revokedRegistry =
      new ActionsArtifactProvenanceCredentialLeaseRegistry()
    const revokedHandle = registerGHELease(revokedRegistry)
    const revoked = new ActionsArtifactProvenanceService({
      credentialLeases: revokedRegistry,
      credentialSource: { read: async () => 'selected-ghe-token' },
      withSubject,
      runner: {
        verify: async input => {
          assert.equal(input.credential, 'selected-ghe-token')
          assert.equal(revokedRegistry.release(sender.id, revokedHandle), true)
          assert.equal(input.signal.aborted, true)
          return { ok: true, evidence }
        },
        killAll: async () => undefined,
      },
    })
    try {
      assert.deepEqual(
        await revoked.verify(
          sender,
          request([bundle], ghePolicy, revokedHandle)
        ),
        { ok: false, reason: 'canceled' }
      )
    } finally {
      revokedRegistry.releaseAll()
    }
  })

  it('rejects extra fields, noncanonical bundles, limits, and changed subjects before spawn', async () => {
    let subjectUses = 0
    let runnerUses = 0
    const service = new ActionsArtifactProvenanceService({
      withSubject: async (...args) => {
        subjectUses++
        return await withSubject(...args)
      },
      runner: {
        verify: async () => {
          runnerUses++
          return { ok: true, evidence }
        },
        killAll: async () => undefined,
      },
    })

    assert.deepEqual(
      await service.verify(sender, { ...request(), path: 'C:\\secret.bin' }),
      { ok: false, reason: 'invalid-request' }
    )
    assert.deepEqual(
      await service.verify(
        sender,
        request([JSON.stringify(JSON.parse(bundle), null, 2)])
      ),
      { ok: false, reason: 'invalid-request' }
    )
    assert.deepEqual(
      await service.verify(
        sender,
        request(
          Array(ActionsArtifactAttestationMaximumBundles + 1).fill(bundle)
        )
      ),
      { ok: false, reason: 'too-many-attestations' }
    )
    const multibyteBundle = JSON.stringify({
      mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
      verificationMaterial: {
        padding: 'é'.repeat(
          Math.floor(ActionsArtifactAttestationMaximumBytes / 2) + 1
        ),
      },
      dsseEnvelope: {},
    })
    assert.ok(multibyteBundle.length < ActionsArtifactAttestationMaximumBytes)
    assert.deepEqual(await service.verify(sender, request([multibyteBundle])), {
      ok: false,
      reason: 'too-many-attestations',
    })
    assert.equal(subjectUses, 0)
    assert.equal(runnerUses, 0)

    const changed = new ActionsArtifactProvenanceService({
      withSubject: async () => {
        throw new ActionsArtifactSubjectError('changed', 'changed')
      },
      runner: {
        verify: async () => ({ ok: true, evidence }),
        killAll: async () => undefined,
      },
    })
    assert.deepEqual(await changed.verify(sender, request()), {
      ok: false,
      reason: 'archive-changed',
    })
    assert.deepEqual(await changed.verify(sender, request([])), {
      ok: false,
      reason: 'archive-changed',
    })
  })

  it('suppresses verified output when cancellation wins after the runner settles', async () => {
    const service = new ActionsArtifactProvenanceService({
      withSubject: async (_sender, _request, use) => {
        const controller = new AbortController()
        await use(lease, controller.signal)
        controller.abort()
        const error = new Error('canceled after runner completion')
        error.name = 'AbortError'
        throw error
      },
      runner: {
        verify: async () => ({ ok: true, evidence }),
        killAll: async () => undefined,
      },
    })
    assert.deepEqual(await service.verify(sender, request()), {
      ok: false,
      reason: 'canceled',
    })
  })

  it('maps subject IO and verifier file write/cleanup failures to unavailable', async () => {
    const subjectIO = new ActionsArtifactProvenanceService({
      withSubject: async (_sender, _request, use) => {
        await use(lease, new AbortController().signal)
        throw new ActionsArtifactSubjectError('io', 'cleanup failed')
      },
      runner: {
        verify: async () => ({ ok: true, evidence }),
        killAll: async () => undefined,
      },
    })
    assert.deepEqual(await subjectIO.verify(sender, request()), {
      ok: false,
      reason: 'verifier-unavailable',
    })

    for (const withVerifierFiles of [
      async () => {
        throw new Error('write failed')
      },
      async <T>(
        _bundles: ReadonlyArray<string>,
        use: (files: IActionsArtifactProvenanceVerifierFiles) => Promise<T>
      ) => {
        await use({
          bundlePath: resolve('private', 'bundles.jsonl'),
          workingDirectory: resolve('private'),
          configDirectory: resolve('private', 'config'),
          cacheDirectory: resolve('private', 'cache'),
          stateDirectory: resolve('private', 'state'),
          dataDirectory: resolve('private', 'data'),
        })
        throw new Error('cleanup failed')
      },
    ]) {
      const service = new ActionsArtifactProvenanceService({
        withSubject,
        withVerifierFiles,
        runner: {
          verify: async () => ({ ok: true, evidence }),
          killAll: async () => undefined,
        },
      })
      assert.deepEqual(await service.verify(sender, request()), {
        ok: false,
        reason: 'verifier-unavailable',
      })
    }
  })

  it('does not remove verifier files until the injected runner settles', async () => {
    let files: IActionsArtifactProvenanceVerifierFiles | undefined
    let release!: () => void
    const runnerDone = new Promise<void>(resolveDone => {
      release = resolveDone
    })
    const service = new ActionsArtifactProvenanceService({
      withSubject,
      runner: {
        verify: async input => {
          files = input
          await runnerDone
          return { ok: true, evidence }
        },
        killAll: async () => undefined,
      },
    })
    const pending = service.verify(sender, request())
    while (files === undefined) {
      await new Promise(resolveWait => setImmediate(resolveWait))
    }
    assert.equal(await missing(files.workingDirectory), false)
    release()
    assert.equal((await pending).ok, true)
    assert.equal(await missing(files.workingDirectory), true)
  })

  it('binds cancellation to sender and operation and closes the shutdown gate', async () => {
    const cancellations = new Array<readonly [number, unknown]>()
    let runnerKills = 0
    let subjectKills = 0
    const service = new ActionsArtifactProvenanceService({
      withSubject,
      cancelSubject: (senderId, operationId) => {
        cancellations.push([senderId, operationId])
        return senderId === 801 && operationId === 'a'.repeat(32)
      },
      cancelAllSubjects: () => {
        subjectKills++
      },
      cancelAllSubjectsAndWait: async () => undefined,
      runner: {
        verify: async () => ({ ok: true, evidence }),
        killAll: async () => {
          runnerKills++
        },
      },
    })
    assert.equal(service.cancel(801, 'a'.repeat(32)), true)
    assert.equal(service.cancel(802, 'a'.repeat(32)), false)
    assert.deepEqual(cancellations, [
      [801, 'a'.repeat(32)],
      [802, 'a'.repeat(32)],
    ])
    await service.killAll()
    assert.equal(runnerKills, 1)
    assert.equal(subjectKills, 1)
    assert.deepEqual(await service.verify(sender, request()), {
      ok: false,
      reason: 'verifier-unavailable',
    })
  })

  it('caps the complete subject lease even for zero-bundle verification', async () => {
    const releases = new Array<() => void>()
    let hold = true
    let entered = 0
    const service = new ActionsArtifactProvenanceService({
      maximumConcurrency: 2,
      withSubject: async (_sender, _request, use) => {
        entered++
        if (hold) {
          await new Promise<void>(resolveHold => releases.push(resolveHold))
        }
        return await use(lease, new AbortController().signal)
      },
      runner: {
        verify: async () => ({ ok: true, evidence }),
        killAll: async () => undefined,
      },
    })
    const first = service.verify(sender, {
      ...request([]),
      operationId: '1'.repeat(32),
    })
    const second = service.verify(sender, {
      ...request([]),
      operationId: '2'.repeat(32),
    })
    while (entered < 2) {
      await new Promise(resolveWait => setImmediate(resolveWait))
    }
    assert.deepEqual(
      await service.verify(sender, {
        ...request([]),
        operationId: '3'.repeat(32),
      }),
      { ok: false, reason: 'verifier-unavailable' }
    )
    hold = false
    for (const release of releases) {
      release()
    }
    assert.deepEqual(await first, { ok: false, reason: 'not-attested' })
    assert.deepEqual(await second, { ok: false, reason: 'not-attested' })
    assert.deepEqual(
      await service.verify(sender, {
        ...request([]),
        operationId: '4'.repeat(32),
      }),
      { ok: false, reason: 'not-attested' }
    )
  })
})
