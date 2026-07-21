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
 * sandbox-bypass flag. In Codex CLI 0.144, `--ask-for-approval` belongs to the
 * root command and must precede `exec`.
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
    '--ephemeral',
    '--ignore-user-config',
    '--color',
    'never',
    ...(model ? ['--model', model] : []),
    '-',
  ]
}

/** Compose bounded failed-build context for Codex's stdin. */
export function buildCodexFixPrompt(
  options: Parameters<typeof buildOpencodeFixPrompt>[0]
): string {
  return buildOpencodeFixPrompt(options)
}

/** Compose a bounded free-form request for Codex's stdin. */
export function buildCodexUserPrompt(rawPrompt: string): string | null {
  return buildOpencodeUserPrompt(rawPrompt)
}
