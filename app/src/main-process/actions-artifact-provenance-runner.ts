import {
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio,
  spawn,
} from 'child_process'
import { realpathSync, statSync } from 'fs'
import { delimiter, isAbsolute, join } from 'path'
import {
  ActionsArtifactProvenanceFailureReason,
  ActionsArtifactProvenanceMaximumProjectedBytes,
  ActionsArtifactProvenancePredicate,
  IActionsArtifactVerificationEvidence,
  IActionsArtifactVerificationPolicy,
  getActionsArtifactProvenanceOIDCIssuer,
  getActionsArtifactProvenanceWebHost,
} from '../lib/actions-artifact-provenance'
import { killTreeAndWait } from './build-run/kill-tree'
import { resolveCLIWorkbenchTool } from './cli-workbench/tool-resolver'
import {
  ActionsArtifactProvenanceJQProjection,
  parseActionsArtifactProvenanceProjectedResult,
} from './actions-artifact-provenance-result'

export const ActionsArtifactProvenanceVerifierTimeoutMilliseconds = 120_000
export const ActionsArtifactProvenanceVerifierMaximumStderrBytes = 64 * 1024
export const ActionsArtifactProvenanceVerifierMaximumConcurrency = 2

export interface IActionsArtifactProvenanceRunnerInput {
  readonly subjectPath: string
  readonly subjectDigest: string
  readonly bundlePath: string
  readonly workingDirectory: string
  readonly configDirectory: string
  readonly cacheDirectory: string
  readonly stateDirectory: string
  readonly dataDirectory: string
  readonly policy: IActionsArtifactVerificationPolicy
  /** Main-process-only GHE.com credential; never part of argv, IPC, or output. */
  readonly credential: string | null
  readonly signal: AbortSignal
}

export type ActionsArtifactProvenanceRunnerResult =
  | {
      readonly ok: true
      readonly evidence: IActionsArtifactVerificationEvidence
    }
  | {
      readonly ok: false
      readonly reason: ActionsArtifactProvenanceFailureReason
    }

interface IActiveVerifierRun {
  readonly terminate: () => void
  readonly done: Promise<void>
}

type SpawnVerifier = (
  executable: string,
  args: ReadonlyArray<string>,
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams

export interface IActionsArtifactProvenanceRunnerDependencies {
  readonly spawn?: SpawnVerifier
  readonly resolveExecutable?: () => string
  readonly killTree?: (
    pid: number,
    isStillOwned: () => boolean
  ) => Promise<boolean>
  readonly environment?: NodeJS.ProcessEnv
  readonly timeoutMilliseconds?: number
  readonly maximumConcurrency?: number
}

function verifierEnvironment(
  input: Pick<
    IActionsArtifactProvenanceRunnerInput,
    'cacheDirectory' | 'configDirectory' | 'dataDirectory' | 'stateDirectory'
  >,
  environment: NodeJS.ProcessEnv,
  credential: string | null
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(environment)) {
    if (
      !/^(?:GH|GITHUB)_/i.test(key) &&
      !/^(?:COSIGN|FULCIO|REKOR|SIGSTORE|TUF)_/i.test(key) &&
      !/^(?:DEBUG|NO_COLOR|CLICOLOR|CLICOLOR_FORCE|DO_NOT_TRACK|XDG_CACHE_HOME|XDG_CONFIG_HOME|XDG_DATA_HOME|XDG_STATE_HOME)$/i.test(
        key
      )
    ) {
      result[key] = value
    }
  }
  result.GH_CONFIG_DIR = input.configDirectory
  result.XDG_CACHE_HOME = input.cacheDirectory
  result.XDG_CONFIG_HOME = input.configDirectory
  result.XDG_STATE_HOME = input.stateDirectory
  result.XDG_DATA_HOME = input.dataDirectory
  result.GH_PROMPT_DISABLED = '1'
  result.GH_NO_UPDATE_NOTIFIER = '1'
  result.GH_NO_EXTENSION_UPDATE_NOTIFIER = '1'
  result.GH_TELEMETRY = '0'
  result.DO_NOT_TRACK = '1'
  result.NO_COLOR = '1'
  result.CLICOLOR = '0'
  if (credential !== null) {
    // The source/lease gate has already proved this is a GHE.com credential.
    // Do not set GH_HOST: fixed --hostname remains the only host selector.
    result.GH_TOKEN = credential
  }
  return result
}

function isUsableCredential(value: string | null): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  )
}

function resolveExecutableOnTrustedPath(
  executable: string,
  environment: NodeJS.ProcessEnv
): string {
  const candidates = new Array<string>()
  if (isAbsolute(executable)) {
    candidates.push(executable)
  } else if (executable === 'gh' || executable === 'gh.exe') {
    const pathValue = Object.entries(environment).find(
      ([key]) => key.toLowerCase() === 'path'
    )?.[1]
    if (pathValue !== undefined) {
      for (const directory of pathValue.split(delimiter)) {
        // Empty and relative entries search the current directory and are not
        // valid for this security-sensitive executable boundary.
        if (directory.length > 0 && isAbsolute(directory)) {
          candidates.push(
            join(directory, process.platform === 'win32' ? 'gh.exe' : 'gh')
          )
        }
      }
    }
  }
  for (const candidate of candidates) {
    try {
      const resolved = realpathSync(candidate)
      const stats = statSync(resolved)
      if (
        stats.isFile() &&
        (process.platform === 'win32' || (stats.mode & 0o111) !== 0)
      ) {
        return resolved
      }
    } catch {
      // Continue through the bounded, absolute PATH candidates.
    }
  }
  throw new Error('GitHub CLI is unavailable.')
}

/** Main-owned fixed argv. Renderer input can neither add nor reorder flags. */
export function buildActionsArtifactProvenanceVerifierArgs(
  input: Omit<
    IActionsArtifactProvenanceRunnerInput,
    | 'cacheDirectory'
    | 'configDirectory'
    | 'credential'
    | 'dataDirectory'
    | 'signal'
    | 'stateDirectory'
    | 'workingDirectory'
  >
): ReadonlyArray<string> {
  const source = new URL(input.policy.sourceRepositoryURI)
  const hostname = getActionsArtifactProvenanceWebHost(source.origin)
  const repository = source.pathname.slice(1)
  return [
    'attestation',
    'verify',
    input.subjectPath,
    '--repo',
    repository,
    '--bundle',
    input.bundlePath,
    '--digest-alg',
    'sha256',
    '--predicate-type',
    ActionsArtifactProvenancePredicate,
    '--cert-identity',
    input.policy.signerIdentity,
    '--cert-oidc-issuer',
    getActionsArtifactProvenanceOIDCIssuer(source.origin),
    '--signer-digest',
    input.policy.signerDigest,
    '--source-digest',
    input.policy.sourceDigest,
    '--source-ref',
    input.policy.sourceRef,
    '--deny-self-hosted-runners',
    '--hostname',
    hostname,
    '--format',
    'json',
    '--jq',
    ActionsArtifactProvenanceJQProjection,
  ]
}

function knownPolicyFailure(stderr: Buffer): boolean {
  const value = stderr.toString('utf8')
  return (
    /^Error: verifying with issuer "(?:sigstore\.dev|GitHub, Inc\.)"(?:\r?\n)?$/.test(
      value
    ) ||
    /^(?:error verifying attestation: )?expected (?:certificate|source|signer|runner)[^\r\n]{0,512}, got [^\r\n]{1,512}(?:\r?\n)?$/i.test(
      value
    ) ||
    /^(?:error verifying attestation: )?unrecognized bundle issuer(?:: [^\r\n]{1,256})?(?:\r?\n)?$/i.test(
      value
    )
  )
}

/** Dedicated, bounded gh verifier with no raw output or argv result surface. */
export class ActionsArtifactProvenanceRunner {
  private readonly spawnVerifier: SpawnVerifier
  private readonly resolveExecutable: () => string
  private readonly killProcessTree: (
    pid: number,
    isStillOwned: () => boolean
  ) => Promise<boolean>
  private readonly environment: NodeJS.ProcessEnv
  private readonly timeoutMilliseconds: number
  private readonly maximumConcurrency: number
  private readonly active = new Set<IActiveVerifierRun>()
  private accepting = true

  public constructor(
    dependencies: IActionsArtifactProvenanceRunnerDependencies = {}
  ) {
    this.spawnVerifier = dependencies.spawn ?? spawn
    this.resolveExecutable =
      dependencies.resolveExecutable ??
      (() =>
        resolveExecutableOnTrustedPath(
          resolveCLIWorkbenchTool('gh').executable,
          this.environment
        ))
    this.killProcessTree = dependencies.killTree ?? killTreeAndWait
    this.environment = dependencies.environment ?? process.env
    this.timeoutMilliseconds =
      dependencies.timeoutMilliseconds ??
      ActionsArtifactProvenanceVerifierTimeoutMilliseconds
    this.maximumConcurrency =
      dependencies.maximumConcurrency ??
      ActionsArtifactProvenanceVerifierMaximumConcurrency
  }

  public async verify(
    input: IActionsArtifactProvenanceRunnerInput
  ): Promise<ActionsArtifactProvenanceRunnerResult> {
    if (input.signal.aborted) {
      return { ok: false, reason: 'canceled' }
    }
    if (!this.accepting || this.active.size >= this.maximumConcurrency) {
      return { ok: false, reason: 'verifier-unavailable' }
    }

    let executable: string
    let args: ReadonlyArray<string>
    let webHost: string
    try {
      executable = this.resolveExecutable()
      args = buildActionsArtifactProvenanceVerifierArgs(input)
      webHost = getActionsArtifactProvenanceWebHost(
        new URL(input.policy.sourceRepositoryURI).origin
      )
    } catch {
      return { ok: false, reason: 'verifier-unavailable' }
    }
    if (
      (webHost === 'github.com' && input.credential !== null) ||
      (webHost !== 'github.com' && !isUsableCredential(input.credential))
    ) {
      return { ok: false, reason: 'verifier-unavailable' }
    }
    if (input.signal.aborted) {
      return { ok: false, reason: 'canceled' }
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = this.spawnVerifier(executable, args, {
        env: verifierEnvironment(input, this.environment, input.credential),
        cwd: input.workingDirectory,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      })
    } catch {
      return { ok: false, reason: 'verifier-unavailable' }
    }

    let terminate: () => void = () => undefined
    const result = new Promise<ActionsArtifactProvenanceRunnerResult>(
      resolve => {
        let settled = false
        let closed = false
        let exited = false
        let killStarted = false
        let terminalReason: ActionsArtifactProvenanceFailureReason | null = null
        let killPromise: Promise<boolean> = Promise.resolve(true)
        let stdoutBytes = 0
        let stderrBytes = 0
        let stderrTruncated = false
        const stdout = new Array<Buffer>()
        const stderr = new Array<Buffer>()

        const requestTermination = (
          reason: ActionsArtifactProvenanceFailureReason
        ) => {
          if (terminalReason === null) {
            terminalReason = reason
          }
          child.stdin.end()
          if (!closed && !exited && !killStarted && child.pid !== undefined) {
            killStarted = true
            // Invoke synchronously while this exact child is still live. Never
            // defer a PID lookup that could target a reused process id.
            try {
              killPromise = Promise.resolve(
                this.killProcessTree(child.pid, () => !closed && !exited)
              ).then(ok => {
                if (!ok && !closed && !exited) {
                  try {
                    child.kill('SIGKILL')
                  } catch {
                    // The exact child may have closed between the checks.
                  }
                }
                return ok
              })
            } catch {
              if (!closed && !exited) {
                try {
                  child.kill('SIGKILL')
                } catch {
                  // The exact child may already be closed.
                }
              }
              killPromise = Promise.resolve(false)
            }
          }
        }
        terminate = () => requestTermination('canceled')

        const onAbort = () => requestTermination('canceled')
        input.signal.addEventListener('abort', onAbort, { once: true })
        const timeout = setTimeout(
          () => requestTermination('timed-out'),
          this.timeoutMilliseconds
        )

        child.stdout.on('data', (chunk: Buffer) => {
          const remaining =
            ActionsArtifactProvenanceMaximumProjectedBytes - stdoutBytes
          if (remaining > 0) {
            const retained = Buffer.from(chunk.subarray(0, remaining))
            stdout.push(retained)
            stdoutBytes += retained.length
          }
          if (chunk.length > remaining) {
            requestTermination('output-too-large')
          }
        })
        child.stderr.on('data', (chunk: Buffer) => {
          const remaining =
            ActionsArtifactProvenanceVerifierMaximumStderrBytes - stderrBytes
          if (remaining > 0) {
            const retained = Buffer.from(chunk.subarray(0, remaining))
            stderr.push(retained)
            stderrBytes += retained.length
          }
          if (chunk.length > remaining) {
            stderrTruncated = true
          }
        })
        child.stdin.on('error', () => undefined)
        child.stdin.end()
        child.once('error', () => requestTermination('verifier-unavailable'))
        child.once('exit', () => {
          exited = true
        })
        child.once('close', code => {
          closed = true
          exited = true
          clearTimeout(timeout)
          input.signal.removeEventListener('abort', onAbort)
          void (async () => {
            await killPromise.catch(() => false)
            if (settled) {
              return
            }
            settled = true
            if (terminalReason !== null) {
              resolve({ ok: false, reason: terminalReason })
              return
            }
            if (code !== 0) {
              resolve({
                ok: false,
                reason:
                  !stderrTruncated &&
                  code === 1 &&
                  knownPolicyFailure(Buffer.concat(stderr))
                    ? 'verification-failed'
                    : 'verifier-unavailable',
              })
              return
            }
            try {
              resolve({
                ok: true,
                evidence: parseActionsArtifactProvenanceProjectedResult(
                  Buffer.concat(stdout),
                  input.subjectDigest,
                  input.policy
                ),
              })
            } catch {
              resolve({ ok: false, reason: 'invalid-result' })
            }
          })()
        })

        if (input.signal.aborted) {
          onAbort()
        }
      }
    )

    const active: IActiveVerifierRun = {
      terminate: () => terminate(),
      done: result.then(() => undefined),
    }
    this.active.add(active)
    try {
      return await result
    } finally {
      this.active.delete(active)
    }
  }

  /** Cancel every owned child and wait for tree-kill attempts plus child close. */
  public async killAll(): Promise<void> {
    this.accepting = false
    const active = [...this.active]
    for (const run of active) {
      run.terminate()
    }
    await Promise.all(active.map(run => run.done))
  }

  public get activeCount(): number {
    return this.active.size
  }
}

export const actionsArtifactProvenanceRunner =
  new ActionsArtifactProvenanceRunner()
