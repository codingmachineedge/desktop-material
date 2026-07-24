import { IActionsRunInput } from './types'

/**
 * Pure construction of the `act` (nektos/act) command line.
 *
 * The runner spawns `act` with `shell: false`, so every argument is an explicit
 * argv entry — nothing is interpolated into a shell string. This module only
 * assembles and validates that argv; it performs no I/O and is fully
 * unit-testable. Secret *values* never appear here: they are written to a
 * `--secret-file` on disk by the runner, and only that file path (never a
 * value) is passed on the command line.
 */

/** Event names accepted on the command line (lower snake, e.g. `pull_request`). */
const EventNameRegex = /^[a-z][a-z0-9_]*$/
/** Job ids and input names accepted on the command line. */
const IdentifierRegex = /^[A-Za-z_][A-Za-z0-9_-]*$/

/** Thrown when a value that would reach the `act` argv fails validation. */
export class ActionsLocalRunCommandError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'ActionsLocalRunCommandError'
  }
}

export interface IActArgsOptions {
  /** Repo-relative, forward-slash workflow path, e.g. `.github/workflows/ci.yml`. */
  readonly workflowRelativePath: string
  /** The event to simulate, e.g. `push`, `workflow_dispatch`. */
  readonly event: string
  /** A specific job id, or null to run the whole workflow. */
  readonly job: string | null
  /** `workflow_dispatch` inputs; values may contain arbitrary text (no shell). */
  readonly inputs: ReadonlyArray<IActionsRunInput>
  /** When true, `act` lists the plan (`-n`) without executing steps. */
  readonly dryRun: boolean
  /**
   * Absolute path to a temp secrets file (`NAME=value` per line) or null when
   * no secrets were supplied. Only the path is placed on the argv.
   */
  readonly secretFilePath: string | null
}

function assertSafeWorkflowPath(relativePath: string): void {
  if (relativePath.length === 0) {
    throw new ActionsLocalRunCommandError('A workflow file must be selected.')
  }
  if (relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath)) {
    throw new ActionsLocalRunCommandError(
      'The workflow path must be repository-relative.'
    )
  }
  if (relativePath.split('/').includes('..')) {
    throw new ActionsLocalRunCommandError(
      'The workflow path must not escape the repository.'
    )
  }
}

/**
 * Build the argv for an `act` invocation. Throws
 * {@link ActionsLocalRunCommandError} when any repo-derived value that would
 * reach the command line fails validation. The workflow is always addressed by
 * `-W <path>` so `act` runs the exact file the user chose.
 */
export function buildActArgs(options: IActArgsOptions): ReadonlyArray<string> {
  assertSafeWorkflowPath(options.workflowRelativePath)

  if (!EventNameRegex.test(options.event)) {
    throw new ActionsLocalRunCommandError(
      `Refusing to run: "${options.event}" is not a valid workflow event name.`
    )
  }

  const args: string[] = [options.event, '-W', options.workflowRelativePath]

  if (options.job !== null) {
    if (!IdentifierRegex.test(options.job)) {
      throw new ActionsLocalRunCommandError(
        `Refusing to run: "${options.job}" is not a valid job id.`
      )
    }
    args.push('-j', options.job)
  }

  if (options.dryRun) {
    args.push('-n')
  }

  for (const input of options.inputs) {
    if (!IdentifierRegex.test(input.name)) {
      throw new ActionsLocalRunCommandError(
        `Refusing to run: "${input.name}" is not a valid input name.`
      )
    }
    // Values travel as a single argv entry (spawn shell:false), so any text —
    // including spaces and `=` — is safe without escaping.
    args.push('--input', `${input.name}=${input.value}`)
  }

  if (options.secretFilePath !== null) {
    args.push('--secret-file', options.secretFilePath)
  }

  return args
}

/**
 * Serialise supplied secrets into the `NAME=value` line format `act` reads with
 * `--secret-file`. Values may contain anything except a newline (which would be
 * read as a new entry); such values are rejected. Never logged by callers.
 */
export function buildSecretFileContents(
  secrets: ReadonlyArray<{ readonly name: string; readonly value: string }>
): string {
  const lines: string[] = []
  for (const secret of secrets) {
    if (!IdentifierRegex.test(secret.name)) {
      throw new ActionsLocalRunCommandError(
        `Refusing to run: "${secret.name}" is not a valid secret name.`
      )
    }
    if (/[\r\n]/.test(secret.value)) {
      throw new ActionsLocalRunCommandError(
        `Refusing to run: the value of secret "${secret.name}" contains a line break.`
      )
    }
    lines.push(`${secret.name}=${secret.value}`)
  }
  return lines.length === 0 ? '' : lines.join('\n') + '\n'
}
