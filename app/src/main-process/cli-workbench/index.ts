import * as ipcMain from '../ipc-main'
import { cliWorkbenchCatalog } from './catalog'
import { cliWorkbenchRunner } from './runner'

export { CLIWorkbenchCatalogService, cliWorkbenchCatalog } from './catalog'
export { CLIWorkbenchRunner, cliWorkbenchRunner } from './runner'

/** Register the typed renderer/main CLI workbench boundary. */
export function registerCLIWorkbenchIpc(): void {
  ipcMain.handle('get-cli-workbench-catalog', async () =>
    cliWorkbenchCatalog.getCatalog()
  )
  ipcMain.handle('start-cli-command', async (event, request) => {
    await cliWorkbenchRunner.start(request, event.sender)
  })
  ipcMain.handle('cancel-cli-command', async (event, id) =>
    cliWorkbenchRunner.cancel(id, event.sender)
  )
  ipcMain.handle('write-cli-command-input', async (event, id, data) =>
    cliWorkbenchRunner.writeInput(id, data, event.sender)
  )
}
