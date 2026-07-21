import {
  IOpencodeInstallRequest,
  IOpencodeInstallResult,
  IOpencodeLogEvent,
  IOpencodeRunFixRequest,
  IOpencodeRunPromptRequest,
  IOpencodeRunResult,
  IOpencodeStatus,
  PROMPT_TAIL_CAP,
  USER_PROMPT_CAP,
  buildOpencodeFixPrompt,
  buildOpencodeUserPrompt,
} from './opencode'
import { isAbsolute, relative, resolve, sep } from 'path'

/** Providers supported by the repository-scoped Build & Run repair flow. */
export type BuildFixProvider = 'opencode' | 'codex'

/** Fail closed to the established provider for absent/corrupt persisted data. */
export function normalizeBuildFixProvider(value: unknown): BuildFixProvider {
  return value === 'codex' ? 'codex' : 'opencode'
}

/** Codex detection/result types intentionally match the established runner. */
export type ICodexStatus = IOpencodeStatus
export type ICodexRunFixRequest = IOpencodeRunFixRequest
export type ICodexRunPromptRequest = IOpencodeRunPromptRequest
export type ICodexInstallRequest = IOpencodeInstallRequest
export type ICodexRunResult = IOpencodeRunResult
export type ICodexInstallResult = IOpencodeInstallResult
export type ICodexLogEvent = IOpencodeLogEvent

/** Bounds remain common across providers so switching cannot enlarge context. */
export const CODEX_PROMPT_TAIL_CAP = PROMPT_TAIL_CAP
export const CODEX_USER_PROMPT_CAP = USER_PROMPT_CAP

/** Longest selected working-directory value embedded in Codex stdin context. */
export const CODEX_WORKING_DIRECTORY_CAP = 1024

export interface ICodexExecArgsOptions {
  /** Whether Codex may proceed without pausing for command approval. */
  readonly autoApprove: boolean
  /** Optional explicit model; omitted so the user's Codex default applies. */
  readonly model?: string
}

/**
 * Build the verified non-interactive Codex argv.
 *
 * The prompt is represented only by the final `-`, which tells Codex to read
 * it from stdin. The repository path is also intentionally absent: the main
 * process sets the child's `cwd`, avoiding Windows batch-shim parsing and
 * making that working directory Codex's repository root. Both modes retain the
 * `workspace-write` sandbox. Auto-approve changes only Codex's documented
 * approval policy (`never` versus `on-request`); it never enables the dangerous
 * sandbox-bypass flag. Detached runs also disable lifecycle hooks and ignore
 * user/project execpolicy rules so trusted project configuration cannot silently
 * change the explicit approval choice. In Codex CLI 0.144,
 * `--ask-for-approval` belongs to the root command and must precede `exec`.
 */
export function buildCodexExecArgs({
  autoApprove,
  model,
}: ICodexExecArgsOptions): ReadonlyArray<string> {
  return [
    '--ask-for-approval',
    autoApprove ? 'never' : 'on-request',
    'exec',
    '--sandbox',
    'workspace-write',
    '--disable',
    'hooks',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--color',
    'never',
    ...(model ? ['--model', model] : []),
    '-',
  ]
}

/** Keep a renderer-supplied profile directory lexically inside the repo root. */
export function resolveCodexPromptWorkingDirectory(
  repoPath: string,
  requestedCwd: string
): string {
  const root = resolve(repoPath)
  const candidate = resolve(root, requestedCwd)
  const fromRoot = relative(root, candidate)
  const isWithinRoot =
    fromRoot === '' ||
    (fromRoot !== '..' &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  return isWithinRoot ? candidate : root
}

/** Render a bounded, control-character-safe path inside natural-language stdin. */
function formatCodexPromptWorkingDirectory(path: string): string {
  const safe = path.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '\ufffd')
  const bounded =
    safe.length > CODEX_WORKING_DIRECTORY_CAP
      ? `\u2026${safe.slice(-(CODEX_WORKING_DIRECTORY_CAP - 1))}`
      : safe
  return JSON.stringify(bounded)
}

/** Compose bounded failed-build context for Codex's stdin. */
export function buildCodexFixPrompt(
  options: Parameters<typeof buildOpencodeFixPrompt>[0] & {
    readonly repoPath: string
  }
): string {
  const cwd = resolveCodexPromptWorkingDirectory(options.repoPath, options.cwd)
  return buildOpencodeFixPrompt({
    ...options,
    cwd: formatCodexPromptWorkingDirectory(cwd),
  })
}

/** Compose a bounded free-form request for Codex's stdin. */
export function buildCodexUserPrompt(
  rawPrompt: string,
  context: { readonly repoPath: string; readonly cwd: string }
): string | null {
  const prompt = buildOpencodeUserPrompt(rawPrompt)
  if (prompt === null) {
    return null
  }
  const cwd = resolveCodexPromptWorkingDirectory(context.repoPath, context.cwd)
  return [
    prompt,
    '',
    `Use ${formatCodexPromptWorkingDirectory(
      cwd
    )} as the selected project working directory while keeping all work inside the repository.`,
  ].join('\n')
}
