import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { BuildRunLogStream, BuildStageKind } from './types'

/**
 * Pure helpers for launching the opencode AI coding agent CLI as a Build & Run
 * auto-fixer. Everything here is argv/prompt/config construction with no Node or
 * Electron dependency beyond `fs/promises` (used only by the on-disk config
 * helper), so it can be imported from either process and unit-tested directly.
 *
 * The security-critical invariant lives here: the natural-language fix prompt is
 * NEVER an argv element. `buildOpencodeRunArgs` deliberately omits any message
 * argument — the prompt is fed to the child over stdin — so the argv can stay
 * metacharacter-free and survive the Windows `opencode.cmd` batch shim without
 * being refused (see the runner's `SAFE_BATCH_ARG`).
 */

/** Result of probing the host for a usable opencode install. */
export interface IOpencodeStatus {
  readonly installed: boolean
  readonly version: string | null
  readonly authConfigured: boolean
}

/** Longest run-output tail embedded in a fix prompt, in characters. */
export const PROMPT_TAIL_CAP = 4000

interface IOpencodeRunArgsOptions {
  /** Absolute working directory the agent operates in (`--dir`). */
  readonly cwd: string
  /** When true, add `--auto` so opencode auto-approves edits and shell calls. */
  readonly autoApprove: boolean
  /** Optional explicit `provider/model`; omitted so opencode uses its default. */
  readonly model?: string
}

/**
 * Build the argv for `opencode run`. Contains no message argument — the prompt
 * is written to the child's stdin — so every element stays metacharacter-free
 * and safe to pass through the `opencode.cmd` shim on Windows.
 */
export function buildOpencodeRunArgs({
  cwd,
  autoApprove,
  model,
}: IOpencodeRunArgsOptions): ReadonlyArray<string> {
  return [
    'run',
    ...(autoApprove ? ['--auto'] : []),
    '--dir',
    cwd,
    ...(model ? ['--model', model] : []),
  ]
}

interface IOpencodeFixPromptOptions {
  readonly stageKind: BuildStageKind
  readonly exitCode: number
  readonly tailText: string
  readonly cwd: string
}

/**
 * Compose the concise fix instruction handed to opencode over stdin. The
 * captured output tail is bounded to {@link PROMPT_TAIL_CAP} characters so an
 * arbitrarily large build log can never bloat the prompt.
 */
export function buildOpencodeFixPrompt({
  stageKind,
  exitCode,
  tailText,
  cwd,
}: IOpencodeFixPromptOptions): string {
  const tail = tailText.slice(-PROMPT_TAIL_CAP)
  return [
    `The ${stageKind} stage of this project's build failed with exit code ${exitCode}.`,
    `The project is at ${cwd}.`,
    'Here is the tail of the captured output:',
    '',
    tail,
    '',
    'Diagnose the failure and fix the errors in this repository. Make the ' +
      'smallest changes that resolve them, then stop. Do not run destructive ' +
      'commands or touch files outside this repository. This is an unattended ' +
      'Build & Run repair, so do not ask the user questions. When details are ' +
      'ambiguous, make the safest minimal reasonable choice and explain it in ' +
      'your output.',
  ].join('\n')
}

/**
 * The canonical opencode.json permission block. Scopes auto-approve to the
 * repository: edits and shell commands are allowed, but the agent is denied any
 * access outside its working directory. opencode merges the cwd config up to the
 * git root, so writing this at the repo root is sufficient.
 */
export function buildOpencodeRepoConfig(): string {
  return JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      permission: {
        edit: 'allow',
        bash: 'allow',
        question: 'deny',
        external_directory: 'deny',
      },
    },
    null,
    2
  )
}

/** The permission keys the repo config guarantees, with their scoped defaults. */
const REPO_PERMISSION_DEFAULTS: Readonly<Record<string, string>> = {
  edit: 'allow',
  bash: 'allow',
  question: 'deny',
  external_directory: 'deny',
}

/** Outcome of merging the scoped permission block into an existing config. */
export interface IOpencodeConfigMerge {
  /** The config text to persist, or `null` when nothing should be written. */
  readonly text: string | null
  /** True when `text` differs from the input and should be written. */
  readonly changed: boolean
  /** True when the existing file could not be parsed as a JSON object. */
  readonly malformed: boolean
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Merge the scoped permission block into an existing opencode.json text.
 *
 * `existing` is the current file contents, or `null` when no file is present.
 * Missing permission keys (and `$schema`) are filled in; keys the user already
 * set are preserved verbatim so their config is never clobbered. A file that
 * does not parse to a JSON object is refused — `text` is `null` and `malformed`
 * is set — so a hand-edited config is never overwritten.
 */
export function mergeOpencodeRepoConfig(
  existing: string | null
): IOpencodeConfigMerge {
  if (existing === null || existing.trim().length === 0) {
    return { text: buildOpencodeRepoConfig(), changed: true, malformed: false }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(existing)
  } catch {
    return { text: null, changed: false, malformed: true }
  }
  if (!isJsonObject(parsed)) {
    return { text: null, changed: false, malformed: true }
  }

  let changed = false
  const next: Record<string, unknown> = { ...parsed }

  if (!('$schema' in next)) {
    next.$schema = 'https://opencode.ai/config.json'
    changed = true
  }

  const existingPermission = isJsonObject(parsed.permission)
    ? parsed.permission
    : {}
  const permission: Record<string, unknown> = { ...existingPermission }
  for (const [key, value] of Object.entries(REPO_PERMISSION_DEFAULTS)) {
    if (!(key in permission)) {
      permission[key] = value
      changed = true
    }
  }
  // A detached Build & Run repair has no modal/TUI answer surface. Always
  // disable the question tool for this repository-scoped automation so an
  // explicit global `ask` preference cannot leave the repair hanging.
  if (permission.question !== 'deny') {
    permission.question = 'deny'
    changed = true
  }
  next.permission = permission

  if (!changed) {
    return { text: existing, changed: false, malformed: false }
  }
  return {
    text: JSON.stringify(next, null, 2),
    changed: true,
    malformed: false,
  }
}

/** Outcome of ensuring the repo config exists on disk. */
export interface IEnsureOpencodeConfigResult {
  /** True when a file was written (created or updated). */
  readonly written: boolean
  /** True when an existing file was malformed and left untouched. */
  readonly malformed: boolean
}

/**
 * Ensure the repo-root opencode.json carries the scoped permission block.
 *
 * Reads any existing config, merges (see {@link mergeOpencodeRepoConfig}) and
 * writes only when something changed. A malformed existing file is left
 * untouched and reported via the `malformed` flag rather than clobbered.
 */
export async function ensureOpencodeRepoConfig(
  repoPath: string
): Promise<IEnsureOpencodeConfigResult> {
  const configPath = join(repoPath, 'opencode.json')

  let existing: string | null = null
  try {
    existing = await readFile(configPath, 'utf8')
  } catch {
    existing = null
  }

  const merged = mergeOpencodeRepoConfig(existing)
  if (merged.malformed || !merged.changed || merged.text === null) {
    return { written: false, malformed: merged.malformed }
  }

  await writeFile(configPath, merged.text, 'utf8')
  return { written: true, malformed: false }
}

/**
 * A Build & Run fix request as it crosses the IPC boundary. Carries the raw
 * failure context; the main process composes the prompt (via
 * {@link buildOpencodeFixPrompt}) so the large output tail is not duplicated.
 */
export interface IOpencodeRunFixRequest {
  /** Correlates streamed log lines and cancellation with this run. */
  readonly operationId: string
  /** Git repository root — where opencode.json is ensured. */
  readonly repoPath: string
  /** Working directory the failed profile ran in (the agent's `--dir`). */
  readonly cwd: string
  /** Whether to launch in `--auto` (yolo) mode; scoped to the repo. */
  readonly autoApprove: boolean
  readonly stageKind: BuildStageKind
  readonly exitCode: number
  readonly tailText: string
  readonly model?: string
}

/** An opencode install request, correlated for streaming and cancellation. */
export interface IOpencodeInstallRequest {
  readonly operationId: string
}

/** Terminal result of an opencode fix run. */
export interface IOpencodeRunResult {
  /**
   * True when the opencode process exited without a spawn error. This is NOT a
   * claim that the build was fixed — `opencode run` is known to exit 0 even when
   * the session errored, so the caller must re-run Build & Run to judge success.
   */
  readonly ok: boolean
}

/** Terminal result of an opencode install run. */
export interface IOpencodeInstallResult {
  readonly ok: boolean
  readonly code: number
}

/** A single streamed opencode log line, pushed to the renderer. */
export interface IOpencodeLogEvent {
  readonly operationId: string
  readonly stream: BuildRunLogStream
  readonly text: string
}
