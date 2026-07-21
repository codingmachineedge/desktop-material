import { WebContents } from 'electron'
import * as ipcMain from '../ipc-main'
import * as ipcWebContents from '../ipc-webcontents'
import { BuildRunLogStream } from '../../lib/build-run/types'
import { resolveRunEnv } from '../../lib/build-run/resolve-user-path'
import {
  ICodexInstallResult,
  ICodexRunResult,
  ICodexStatus,
  buildCodexExecArgs,
  buildCodexFixPrompt,
  buildCodexUserPrompt,
} from '../../lib/build-run/codex'
import {
  ICodexInstallPlan,
  planCodexInstall,
} from '../../lib/build-run/codex-install'
import { OnAgentLog, OpencodeRunner } from './opencode-runner'

/** Parameters for one repository-scoped Codex invocation. */
export interface ICodexFixRun {
  /** Git repository root and the child process's writable sandbox root. */
  readonly repoPath: string
  /** The bounded instruction written to stdin. */
  readonly prompt: string
  readonly autoApprove: boolean
  readonly model?: string
}

/**
 * Shell-free Codex CLI runner.
 *
 * It reuses the established agent process plumbing (PATH/PATHEXT resolution,
 * guarded Windows batch shims, bounded streaming, abort-driven process-tree
 * teardown, and shutdown cleanup). Detection uses only the installed CLI's
 * documented `--version` and `login status` commands. Runs use the documented
 * `codex --ask-for-approval … exec … -` stdin form; neither prompts nor
 * repository paths enter argv.
 */
export class CodexRunner extends OpencodeRunner {
  public async detect(
    env: Record<string, string> = resolveRunEnv()
  ): Promise<ICodexStatus> {
    const version = await this.capture('codex', ['--version'], env)
    if (version.spawnError || version.code !== 0) {
      return { installed: false, version: null, authConfigured: false }
    }

    const auth = await this.capture('codex', ['login', 'status'], env)
    return {
      installed: true,
      version: parseCodexVersion(version.output),
      // `codex login status` uses its exit status for the configured state; no
      // credential-bearing output is parsed, logged, or returned to the UI.
      authConfigured: !auth.spawnError && auth.code === 0,
    }
  }

  public async install(
    plan: ICodexInstallPlan,
    onLog: OnAgentLog,
    signal: AbortSignal,
    env: Record<string, string> = resolveRunEnv()
  ): Promise<ICodexInstallResult> {
    onLog('command', plan.label)
    const result = await this.stream(
      plan.exe,
      plan.args,
      env,
      undefined,
      null,
      onLog,
      signal
    )
    return {
      ok: !result.spawnError && result.code === 0,
      code: result.code,
    }
  }

  public async runCodex(
    run: ICodexFixRun,
    onLog: OnAgentLog,
    signal: AbortSignal,
    env: Record<string, string> = resolveRunEnv()
  ): Promise<ICodexRunResult> {
    const args = buildCodexExecArgs({
      autoApprove: run.autoApprove,
      model: run.model,
    })
    onLog('command', `codex ${args.join(' ')}`)
    const result = await this.stream(
      'codex',
      args,
      env,
      run.repoPath,
      run.prompt,
      onLog,
      signal
    )
    // This says only that the child could be started. The renderer always
    // performs a real Build & Run rerun and never trusts the agent exit status.
    return { ok: !result.spawnError }
  }
}

function parseCodexVersion(output: string): string | null {
  const match = output.match(/\d+\.\d+\.\d+(?:[-.\w]*)?/)
  return match ? match[0] : output.trim().length > 0 ? output.trim() : null
}

export const codexRunner = new CodexRunner()

const controllers = new Map<string, AbortController>()

function emit(
  sender: WebContents,
  operationId: string,
  stream: BuildRunLogStream,
  text: string
): void {
  if (!sender.isDestroyed()) {
    ipcWebContents.send(sender, 'codex-log', { operationId, stream, text })
  }
}

/** Register Codex detection, install, execution, streaming, and cancellation. */
export function registerCodexIpc(): void {
  ipcMain.handle('codex-detect', async () => codexRunner.detect())

  ipcMain.handle('codex-install', async (event, request) => {
    const controller = new AbortController()
    controllers.set(request.operationId, controller)
    try {
      return await codexRunner.install(
        planCodexInstall(),
        (stream, text) => emit(event.sender, request.operationId, stream, text),
        controller.signal
      )
    } finally {
      controllers.delete(request.operationId)
    }
  })

  ipcMain.handle('codex-run-fix', async (event, request) => {
    const controller = new AbortController()
    controllers.set(request.operationId, controller)
    const prompt = buildCodexFixPrompt({
      stageKind: request.stageKind,
      exitCode: request.exitCode,
      tailText: request.tailText,
      cwd: request.cwd,
    })
    try {
      return await codexRunner.runCodex(
        {
          repoPath: request.repoPath,
          autoApprove: request.autoApprove,
          prompt,
          model: request.model,
        },
        (stream, text) => emit(event.sender, request.operationId, stream, text),
        controller.signal
      )
    } finally {
      controllers.delete(request.operationId)
    }
  })

  ipcMain.handle('codex-run-prompt', async (event, request) => {
    const prompt = buildCodexUserPrompt(request.prompt)
    if (prompt === null) {
      return { ok: false }
    }
    const controller = new AbortController()
    controllers.set(request.operationId, controller)
    try {
      return await codexRunner.runCodex(
        {
          repoPath: request.repoPath,
          autoApprove: request.autoApprove,
          prompt,
          model: request.model,
        },
        (stream, text) => emit(event.sender, request.operationId, stream, text),
        controller.signal
      )
    } finally {
      controllers.delete(request.operationId)
    }
  })

  ipcMain.handle('codex-cancel', async (_event, operationId) => {
    controllers.get(operationId)?.abort()
  })
}
