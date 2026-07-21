/** A shell-free, argv-encoded Codex CLI install command. */
export interface ICodexInstallPlan {
  readonly exe: string
  readonly args: ReadonlyArray<string>
  readonly label: string
  readonly hint: string
}

export const CODEX_INSTALL_GUIDANCE = {
  authHint:
    "Codex is not signed in. Open a terminal and run 'codex login'; Desktop Material never asks for or stores your credentials.",
  installNote:
    'Installs the official @openai/codex package globally via npm (no elevation and no downloaded install script).',
} as const

/**
 * Return the official npm install documented by the Codex CLI manual for
 * Desktop Material's Windows-only product surface.
 */
export function planCodexInstall(): ICodexInstallPlan {
  return {
    exe: 'npm',
    args: ['install', '--global', '@openai/codex'],
    label: 'npm install --global @openai/codex',
    hint: CODEX_INSTALL_GUIDANCE.installNote,
  }
}
