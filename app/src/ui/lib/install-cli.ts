import * as Path from 'path'

import * as fsAdmin from 'fs-admin'
import { mkdir, readlink, symlink, unlink } from 'fs/promises'
import { DesktopMaterialCLIName } from '../../lib/desktop-material-cli'

/** The path for the installed command line tool. */
export const InstalledCLIPath = `/usr/local/bin/${DesktopMaterialCLIName}`

/** The path to the packaged CLI. */
export const PackagedCLIPath = Path.resolve(
  __dirname,
  'static',
  `${DesktopMaterialCLIName}.sh`
)

/** Install the command line tool on macOS. */
export async function installCLI(): Promise<void> {
  const installedPath = await getResolvedInstallPath()
  if (installedPath === PackagedCLIPath) {
    return
  }

  try {
    await symlinkCLI(false)
  } catch (e) {
    // If we error without running as an admin, try again as an admin.
    await symlinkCLI(true)
  }
}

async function getResolvedInstallPath(): Promise<string | null> {
  try {
    return await readlink(InstalledCLIPath)
  } catch {
    return null
  }
}

function removeExistingSymlink(asAdmin: boolean) {
  if (!asAdmin) {
    return unlink(InstalledCLIPath).catch(error => {
      if (!isNoEntryError(error)) {
        throw error
      }
    })
  }

  return new Promise<void>((resolve, reject) => {
    fsAdmin.unlink(InstalledCLIPath, error => {
      if (error !== null && !isNoEntryError(error)) {
        reject(
          new Error(
            `Failed to remove file at ${InstalledCLIPath}. Authorization of Desktop Material Helper is required.`
          )
        )
        return
      }

      resolve()
    })
  })
}

function createDirectories(asAdmin: boolean) {
  const path = Path.dirname(InstalledCLIPath)

  if (!asAdmin) {
    return mkdir(path, { recursive: true })
  }

  return new Promise<void>((resolve, reject) => {
    fsAdmin.makeTree(path, error => {
      if (error !== null) {
        reject(
          new Error(
            `Failed to create intermediate directories to ${InstalledCLIPath}`
          )
        )
        return
      }

      resolve()
    })
  })
}

function createNewSymlink(asAdmin: boolean) {
  if (!asAdmin) {
    return symlink(PackagedCLIPath, InstalledCLIPath)
  }

  return new Promise<void>((resolve, reject) => {
    fsAdmin.symlink(PackagedCLIPath, InstalledCLIPath, error => {
      if (error !== null) {
        reject(
          new Error(
            `Failed to symlink ${PackagedCLIPath} to ${InstalledCLIPath}`
          )
        )
        return
      }

      resolve()
    })
  })
}

function isNoEntryError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

async function symlinkCLI(asAdmin: boolean): Promise<void> {
  await removeExistingSymlink(asAdmin)
  await createDirectories(asAdmin)
  await createNewSymlink(asAdmin)
}
