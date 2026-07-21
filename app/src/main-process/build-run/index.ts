import { buildRunner } from './runner'
import { registerOpencodeIpc } from './opencode-runner'
import { registerCodexIpc } from './codex-runner'
import * as ipcMain from '../ipc-main'

export { BuildRunner, buildRunner } from './runner'
export { OpencodeRunner, opencodeRunner } from './opencode-runner'
export { CodexRunner, codexRunner } from './codex-runner'
export { killTree } from './kill-tree'

/**
 * Register the Build & Run IPC handlers on the main process.
 *
 * Progress is pushed back to whichever renderer invoked `start-build-run`
 * (captured as `event.sender`), so no window handle needs threading in here.
 * Handlers are dormant until a renderer calls them.
 */
export function registerBuildRunIpc(): void {
  ipcMain.handle('start-build-run', async (event, plan) => {
    buildRunner.start(plan, event.sender)
  })

  ipcMain.handle('cancel-build-run', async (_event, runId) => {
    await buildRunner.cancel(runId)
  })

  registerOpencodeIpc()
  registerCodexIpc()
}
