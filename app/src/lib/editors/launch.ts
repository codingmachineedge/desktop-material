import { spawn, SpawnOptions } from 'child_process'
import { pathExists } from '../path-exists'
import { ExternalEditorError, FoundEditor } from './shared'
import {
  expandTargetPathArgument,
  ICustomIntegration,
  parseCustomIntegrationArguments,
} from '../custom-integration'

async function launchEditor(
  editorPath: string,
  args: readonly string[],
  editorName: string,
  spawnAsDarwinApp: boolean
) {
  const exists = await pathExists(editorPath)
  const label = __DARWIN__ ? 'Settings' : 'Options'
  if (!exists) {
    throw new ExternalEditorError(
      `Could not find executable for ${editorName} at path '${editorPath}'. Please open ${label} and select an available editor.`,
      { openPreferences: true }
    )
  }

  return new Promise<void>((resolve, reject) => {
    const opts: SpawnOptions = {
      // Make sure the editor processes are detached from the Desktop app.
      // Otherwise, some editors (like Notepad++) will be killed when the
      // Desktop app is closed.
      detached: true,
      stdio: 'ignore',
    }

    const child = spawnAsDarwinApp
      ? spawn('open', ['-a', editorPath, ...args], opts)
      : spawn(editorPath, args, opts)

    child.on('error', reject)
    child.on('spawn', resolve)
    child.unref() // Don't wait for editor to exit
  }).catch((e: unknown) => {
    log.error(
      `Error while launching ${editorName}`,
      e instanceof Error ? e : undefined
    )
    throw new ExternalEditorError(
      e && typeof e === 'object' && 'code' in e && e.code === 'EACCES'
        ? `GitHub Desktop doesn't have the proper permissions to start ${editorName}. Please open ${label} and try another editor.`
        : `Something went wrong while trying to start ${editorName}. Please open ${label} and try another editor.`,
      { openPreferences: true }
    )
  })
}

const MaxIntegrationOutput = 1024 * 1024
const IntegrationTimeoutMs = 15_000

async function launchExecutableAndReturnStdout(
  executablePath: string,
  args: readonly string[]
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executablePath, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    let output = ''
    let settled = false

    const finish = (error?: Error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      if (error === undefined) {
        resolve(output)
      } else {
        reject(error)
      }
    }

    const timeout = setTimeout(() => {
      child.kill()
      finish(new Error('The branch preset script timed out.'))
    }, IntegrationTimeoutMs)

    child.stdout?.on('data', data => {
      output += data.toString()
      if (output.length > MaxIntegrationOutput) {
        child.kill()
        finish(new Error('The branch preset script returned too much data.'))
      }
    })
    child.on('error', error => finish(error))
    child.on('close', code => {
      finish(
        code === 0
          ? undefined
          : new Error(`The branch preset script exited with code ${code}.`)
      )
    })
  }).catch((error: unknown) => {
    log.error(
      `Error while launching branch preset script at ${executablePath}`,
      error instanceof Error ? error : undefined
    )
    throw new ExternalEditorError(
      'The branch preset script could not be run. Check its path and arguments in Settings.',
      { openPreferences: true }
    )
  })
}

/**
 * Open a given file or folder in the desired external editor.
 *
 * @param fullPath A folder or file path to pass as an argument when launching the editor.
 * @param editor The external editor to launch.
 */
export const launchExternalEditor = (fullPath: string, editor: FoundEditor) =>
  launchEditor(editor.path, [fullPath], `'${editor.editor}'`, __DARWIN__)

/**
 * Open a given file or folder in the desired custom external editor.
 *
 * @param fullPath A folder or file path to pass as an argument when launching the editor.
 * @param customEditor The external editor to launch.
 */
export const launchCustomExternalEditor = (
  fullPath: string,
  customEditor: ICustomIntegration
) => {
  const argv = parseCustomIntegrationArguments(customEditor.arguments)

  // Replace instances of RepoPathArgument with fullPath in customEditor.arguments
  const args = expandTargetPathArgument(argv, fullPath)

  // In macOS we can use `open` if it's an app (i.e. if we have a bundleID),
  // which will open the right executable file for us, we only need the path
  // to the editor .app folder.
  const spawnAsDarwinApp = __DARWIN__ && customEditor.bundleID !== undefined
  const editorName = `custom editor at path '${customEditor.path}'`

  return launchEditor(customEditor.path, args, editorName, spawnAsDarwinApp)
}

export function launchAndReturnStdout(
  fullPath: string,
  executable: ICustomIntegration
): Promise<string> {
  const argv = parseCustomIntegrationArguments(executable.arguments)
  const args = expandTargetPathArgument(argv, fullPath)
  return launchExecutableAndReturnStdout(executable.path, args)
}
