import assert from 'node:assert'
import {
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio,
} from 'child_process'
import { EventEmitter } from 'events'
import { resolve } from 'path'
import { PassThrough } from 'stream'
import { describe, it } from 'node:test'
import {
  ActionsArtifactProvenanceMaximumProjectedBytes,
  IActionsArtifactVerificationPolicy,
} from '../../../src/lib/actions-artifact-provenance'
import { ActionsArtifactProvenanceJQProjection } from '../../../src/main-process/actions-artifact-provenance-result'
import {
  ActionsArtifactProvenanceRunner,
  IActionsArtifactProvenanceRunnerInput,
} from '../../../src/main-process/actions-artifact-provenance-runner'

const sha = '7d3af28c422bf02197a99f195b689b34377e11a2'
const subjectHex =
  '5c8cbe5000262fc77cbb58a56f5cb030c46075f3e89d9a9189c525d2968748e4'
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

const projected = (
  selectedPolicy: IActionsArtifactVerificationPolicy = policy
) => {
  const source = new URL(selectedPolicy.sourceRepositoryURI)
  const host = source.hostname
  return [
    {
      subject: [{ name: 'artifact', digest: { sha256: subjectHex } }],
      predicateType: 'https://slsa.dev/provenance/v1',
      certificate: {
        certificateIssuer: 'CN=sigstore-intermediate,O=sigstore.dev',
        subjectAlternativeName: selectedPolicy.signerIdentity,
        buildSignerURI: selectedPolicy.signerIdentity,
        buildSignerDigest: selectedPolicy.signerDigest,
        issuer:
          host === 'github.com'
            ? 'https://token.actions.githubusercontent.com'
            : `https://token.actions.${host}`,
        runnerEnvironment: 'github-hosted',
        sourceRepositoryURI: selectedPolicy.sourceRepositoryURI,
        sourceRepositoryDigest: selectedPolicy.sourceDigest,
        sourceRepositoryRef: selectedPolicy.sourceRef,
        sourceRepositoryVisibilityAtSigning:
          selectedPolicy.repositoryVisibility,
        runInvocationURI: `${selectedPolicy.sourceRepositoryURI}/actions/runs/${selectedPolicy.runId}/attempts/${selectedPolicy.runAttempt}`,
      },
      timestamps: [
        {
          type: 'Tlog',
          timestamp: '2026-07-13T20:37:25Z',
          uri: 'https://rekor.sigstore.dev',
        },
      ],
    },
  ]
}

class FakeChild extends EventEmitter {
  public readonly stdin = new PassThrough()
  public readonly stdout = new PassThrough()
  public readonly stderr = new PassThrough()
  public pid: number | undefined = 701
  public readonly killSignals = new Array<NodeJS.Signals | number | undefined>()
  private closed = false

  public kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignals.push(signal)
    return true
  }

  public close(code: number | null): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.stdout.end()
    this.stderr.end()
    this.emit('close', code, null)
  }
}

const input = (
  signal: AbortSignal,
  overrides: Partial<IActionsArtifactProvenanceRunnerInput> = {}
): IActionsArtifactProvenanceRunnerInput => ({
  subjectPath: resolve('private-operation', 'subject.bin'),
  subjectDigest: `sha256:${subjectHex}`,
  bundlePath: resolve('private-operation', 'bundles.jsonl'),
  workingDirectory: resolve('private-operation'),
  configDirectory: resolve('private-operation', 'config'),
  cacheDirectory: resolve('private-operation', 'cache'),
  stateDirectory: resolve('private-operation', 'state'),
  dataDirectory: resolve('private-operation', 'data'),
  policy,
  credential: null,
  signal,
  ...overrides,
})

type SpawnCapture = {
  executable?: string
  args?: ReadonlyArray<string>
  options?: SpawnOptionsWithoutStdio
  child?: FakeChild
}

function runnerWithChild(
  capture: SpawnCapture,
  start: (child: FakeChild) => void,
  options: {
    readonly timeout?: number
    readonly maximumConcurrency?: number
    readonly kill?: (child: FakeChild) => Promise<boolean>
  } = {}
): ActionsArtifactProvenanceRunner {
  return new ActionsArtifactProvenanceRunner({
    resolveExecutable: () => resolve('trusted-bin', 'gh.exe'),
    environment: {
      PATH: resolve('trusted-bin'),
      GH_TOKEN: 'ambient-token',
      gh_token: 'ambient-lowercase-token',
      Gh_Host: 'ambient-mixedcase-host',
      GITHUB_TOKEN: 'ambient-github-token',
      GH_DEBUG: 'api',
      SIGSTORE_ROOT_FILE: resolve('untrusted-root.json'),
      DEBUG: '1',
    },
    timeoutMilliseconds: options.timeout ?? 5_000,
    maximumConcurrency: options.maximumConcurrency,
    killTree: async () =>
      options.kill === undefined ? true : await options.kill(capture.child!),
    spawn: (executable, args, spawnOptions) => {
      const child = new FakeChild()
      capture.executable = executable
      capture.args = args
      capture.options = spawnOptions
      capture.child = child
      queueMicrotask(() => start(child))
      return child as unknown as ChildProcessWithoutNullStreams
    },
  })
}

describe('Actions artifact provenance runner', () => {
  it('spawns only the fixed argv, private cwd/env, closed stdin, and strict projection', async () => {
    const capture: SpawnCapture = {}
    const runner = runnerWithChild(capture, child => {
      child.stdout.write(JSON.stringify(projected()))
      child.close(0)
    })
    const result = await runner.verify(input(new AbortController().signal))

    assert.equal(result.ok, true)
    assert.equal(capture.executable, resolve('trusted-bin', 'gh.exe'))
    assert.deepEqual(capture.args, [
      'attestation',
      'verify',
      input(new AbortController().signal).subjectPath,
      '--repo',
      'actions/attest',
      '--bundle',
      input(new AbortController().signal).bundlePath,
      '--digest-alg',
      'sha256',
      '--predicate-type',
      'https://slsa.dev/provenance/v1',
      '--cert-identity',
      signerIdentity,
      '--cert-oidc-issuer',
      'https://token.actions.githubusercontent.com',
      '--signer-digest',
      sha,
      '--source-digest',
      sha,
      '--source-ref',
      'refs/heads/main',
      '--deny-self-hosted-runners',
      '--hostname',
      'github.com',
      '--format',
      'json',
      '--jq',
      ActionsArtifactProvenanceJQProjection,
    ])
    assert.equal(capture.options?.cwd, resolve('private-operation'))
    assert.equal(capture.options?.shell, false)
    assert.equal(capture.options?.windowsHide, true)
    assert.deepEqual(capture.options?.stdio, ['pipe', 'pipe', 'pipe'])
    const env = capture.options?.env ?? {}
    assert.equal(env.GH_TOKEN, undefined)
    assert.equal(env.gh_token, undefined)
    assert.equal(env.Gh_Host, undefined)
    assert.equal(env.GITHUB_TOKEN, undefined)
    assert.equal(env.GH_DEBUG, undefined)
    assert.equal(env.SIGSTORE_ROOT_FILE, undefined)
    assert.equal(env.DEBUG, undefined)
    assert.equal(env.GH_CONFIG_DIR, resolve('private-operation', 'config'))
    assert.equal(env.XDG_CACHE_HOME, resolve('private-operation', 'cache'))
    assert.equal(env.XDG_CONFIG_HOME, resolve('private-operation', 'config'))
    assert.equal(env.XDG_STATE_HOME, resolve('private-operation', 'state'))
    assert.equal(env.XDG_DATA_HOME, resolve('private-operation', 'data'))
    assert.equal(capture.child?.stdin.writableEnded, true)
  })

  it('injects only a validated GHE.com credential and never a host override or token argv', async () => {
    const capture: SpawnCapture = {}
    const runner = runnerWithChild(capture, child => {
      child.stdout.write(JSON.stringify(projected(ghePolicy)))
      child.close(0)
    })
    const result = await runner.verify(
      input(new AbortController().signal, {
        policy: ghePolicy,
        credential: 'selected-ghe-token',
      })
    )
    assert.equal(result.ok, true)
    const env = capture.options?.env ?? {}
    assert.equal(env.GH_TOKEN, 'selected-ghe-token')
    assert.equal(env.GH_HOST, undefined)
    assert.equal(env.GITHUB_TOKEN, undefined)
    assert.equal(capture.args?.includes('selected-ghe-token'), false)
    assert.equal(capture.args?.includes('GH_TOKEN'), false)
    assert.ok(capture.args?.includes('octocorp.ghe.com'))
  })

  it('does not spawn when credential presence disagrees with the fixed policy host', async () => {
    let spawned = false
    const runner = new ActionsArtifactProvenanceRunner({
      resolveExecutable: () => resolve('trusted-bin', 'gh.exe'),
      spawn: () => {
        spawned = true
        return new FakeChild() as unknown as ChildProcessWithoutNullStreams
      },
    })
    assert.deepEqual(
      await runner.verify(
        input(new AbortController().signal, { credential: 'dotcom-token' })
      ),
      { ok: false, reason: 'verifier-unavailable' }
    )
    assert.deepEqual(
      await runner.verify(
        input(new AbortController().signal, {
          policy: ghePolicy,
          credential: null,
        })
      ),
      { ok: false, reason: 'verifier-unavailable' }
    )
    assert.equal(spawned, false)
  })

  it('rejects relative and empty PATH entries instead of spawning a local gh', async () => {
    let spawned = false
    const runner = new ActionsArtifactProvenanceRunner({
      environment: { PATH: process.platform === 'win32' ? '.;' : '.:' },
      spawn: () => {
        spawned = true
        return new FakeChild() as unknown as ChildProcessWithoutNullStreams
      },
    })
    assert.deepEqual(await runner.verify(input(new AbortController().signal)), {
      ok: false,
      reason: 'verifier-unavailable',
    })
    assert.equal(spawned, false)
  })

  it('classifies only a fully captured allowlisted policy mismatch as verification failure', async () => {
    for (const [stderr, code, reason] of [
      ['Error: verifying with issuer "sigstore.dev"', 1, 'verification-failed'],
      ['Error: verifying with issuer "GitHub, Inc."', 1, 'verification-failed'],
      [
        'Error: verifying with issuer "sigstore.dev"\nfailed to update TUF root',
        1,
        'verifier-unavailable',
      ],
      [
        'expected certificate source repository, got another repository',
        1,
        'verification-failed',
      ],
      ['unknown gh failure', 1, 'verifier-unavailable'],
      ['authentication required', 4, 'verifier-unavailable'],
      [
        'panic: runtime error: invalid memory address',
        1,
        'verifier-unavailable',
      ],
    ] as const) {
      const capture: SpawnCapture = {}
      const runner = runnerWithChild(capture, child => {
        child.stderr.write(stderr)
        child.close(code)
      })
      assert.deepEqual(
        await runner.verify(input(new AbortController().signal)),
        { ok: false, reason },
        stderr
      )
    }

    const truncatedCapture: SpawnCapture = {}
    const truncated = runnerWithChild(truncatedCapture, child => {
      child.stderr.write(
        `expected certificate source repository, got another repository${'x'.repeat(
          70 * 1024
        )}`
      )
      child.close(1)
    })
    assert.deepEqual(
      await truncated.verify(input(new AbortController().signal)),
      { ok: false, reason: 'verifier-unavailable' }
    )

    const nonzeroCapture: SpawnCapture = {}
    const nonzero = runnerWithChild(nonzeroCapture, child => {
      child.stdout.write(JSON.stringify(projected()))
      child.stderr.write(
        'expected certificate source repository, got another repository'
      )
      child.close(1)
    })
    assert.deepEqual(
      await nonzero.verify(input(new AbortController().signal)),
      { ok: false, reason: 'verification-failed' }
    )
  })

  it('rejects malformed success output and kills oversized output while draining it', async () => {
    const malformedCapture: SpawnCapture = {}
    const malformed = runnerWithChild(malformedCapture, child => {
      child.stdout.write('{')
      child.close(0)
    })
    assert.deepEqual(
      await malformed.verify(input(new AbortController().signal)),
      { ok: false, reason: 'invalid-result' }
    )

    const capture: SpawnCapture = {}
    let kills = 0
    const oversizedController = new AbortController()
    const oversized = runnerWithChild(
      capture,
      child => {
        child.stdout.write(
          Buffer.alloc(ActionsArtifactProvenanceMaximumProjectedBytes, 0x20)
        )
        child.stdout.write(Buffer.from('x'))
        oversizedController.abort()
        setImmediate(() => child.close(null))
      },
      {
        kill: async () => {
          kills++
          return true
        },
      }
    )
    assert.deepEqual(
      await oversized.verify(input(oversizedController.signal)),
      { ok: false, reason: 'output-too-large' }
    )
    assert.equal(kills, 1)
  })

  it('normalizes a spawn error without a PID and still waits for close', async () => {
    const capture: SpawnCapture = {}
    let kills = 0
    const runner = runnerWithChild(
      capture,
      child => {
        child.pid = undefined
        child.emit('error', new Error('missing executable'))
        setImmediate(() => child.close(null))
      },
      {
        kill: async () => {
          kills++
          return true
        },
      }
    )
    assert.deepEqual(await runner.verify(input(new AbortController().signal)), {
      ok: false,
      reason: 'verifier-unavailable',
    })
    assert.equal(kills, 0)
  })

  it('latches cancellation before timeout and waits for close after one kill', async () => {
    const capture: SpawnCapture = {}
    const controller = new AbortController()
    let kills = 0
    const runner = runnerWithChild(capture, () => controller.abort(), {
      timeout: 5,
      kill: async child => {
        kills++
        setTimeout(() => child.close(null), 15)
        return false
      },
    })
    assert.deepEqual(await runner.verify(input(controller.signal)), {
      ok: false,
      reason: 'canceled',
    })
    assert.equal(kills, 1)
    assert.deepEqual(capture.child?.killSignals, ['SIGKILL'])
  })

  it('times out a hanging verifier at the injected deadline', async () => {
    const capture: SpawnCapture = {}
    const runner = runnerWithChild(capture, () => undefined, {
      timeout: 5,
      kill: async child => {
        setImmediate(() => child.close(null))
        return true
      },
    })
    assert.deepEqual(await runner.verify(input(new AbortController().signal)), {
      ok: false,
      reason: 'timed-out',
    })
  })

  it('enforces concurrency and closes the accepting gate during killAll', async () => {
    const capture: SpawnCapture = {}
    const controller = new AbortController()
    const runner = runnerWithChild(capture, () => undefined, {
      maximumConcurrency: 1,
      kill: async child => {
        queueMicrotask(() => child.close(null))
        return true
      },
    })
    const first = runner.verify(input(controller.signal))
    assert.equal(runner.activeCount, 1)
    assert.deepEqual(await runner.verify(input(new AbortController().signal)), {
      ok: false,
      reason: 'verifier-unavailable',
    })
    await runner.killAll()
    assert.deepEqual(await first, { ok: false, reason: 'canceled' })
    assert.deepEqual(await runner.verify(input(new AbortController().signal)), {
      ok: false,
      reason: 'verifier-unavailable',
    })
  })

  it('does not kill a PID after the child has already closed', async () => {
    const capture: SpawnCapture = {}
    let kills = 0
    const runner = runnerWithChild(
      capture,
      child => {
        child.stdout.write(JSON.stringify(projected()))
        child.close(0)
      },
      {
        kill: async () => {
          kills++
          return true
        },
      }
    )
    const controller = new AbortController()
    const result = await runner.verify(input(controller.signal))
    controller.abort()
    assert.equal(result.ok, true)
    assert.equal(kills, 0)
  })

  it('does not taskkill a reusable PID after exit while streams remain open', async () => {
    const capture: SpawnCapture = {}
    const controller = new AbortController()
    let kills = 0
    const runner = runnerWithChild(
      capture,
      child => {
        child.emit('exit', 0, null)
        controller.abort()
        setImmediate(() => child.close(0))
      },
      {
        kill: async () => {
          kills++
          return true
        },
      }
    )
    assert.deepEqual(await runner.verify(input(controller.signal)), {
      ok: false,
      reason: 'canceled',
    })
    assert.equal(kills, 0)
  })

  it('does not direct-kill a reusable PID when exit wins during taskkill', async () => {
    const capture: SpawnCapture = {}
    const controller = new AbortController()
    let releaseKill!: (ok: boolean) => void
    const killResult = new Promise<boolean>(resolveKill => {
      releaseKill = resolveKill
    })
    const runner = runnerWithChild(
      capture,
      child => {
        controller.abort()
        setImmediate(() => {
          child.emit('exit', null, 'SIGTERM')
          releaseKill(false)
          setImmediate(() => child.close(null))
        })
      },
      { kill: async () => await killResult }
    )
    assert.deepEqual(await runner.verify(input(controller.signal)), {
      ok: false,
      reason: 'canceled',
    })
    assert.deepEqual(capture.child?.killSignals, [])
  })
})
