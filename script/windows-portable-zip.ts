/* eslint-disable no-sync */

import { execFileSync } from 'child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'fs'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'path'

interface IArchiveCommandOptions {
  readonly cwd: string
  readonly stdio: 'ignore' | 'inherit'
  readonly windowsHide: true
}

export type ArchiveCommandRunner = (
  executable: string,
  arguments_: ReadonlyArray<string>,
  options: IArchiveCommandOptions
) => void

export interface IWindowsPortableZipOptions {
  readonly tarExecutable?: string
  readonly runCommand?: ArchiveCommandRunner
}

function isPathInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate)
  return (
    pathFromParent === '' ||
    (!isAbsolute(pathFromParent) &&
      pathFromParent !== '..' &&
      !pathFromParent.startsWith(`..${sep}`))
  )
}

function getNativeTarExecutable(): string {
  const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR
  if (windowsRoot === undefined || windowsRoot.trim().length === 0) {
    throw new Error('Unable to locate Windows tar.exe: SystemRoot is unset.')
  }

  const executable = join(resolve(windowsRoot), 'System32', 'tar.exe')
  if (!existsSync(executable)) {
    throw new Error(`Unable to locate Windows tar.exe at ${executable}.`)
  }

  return executable
}

const defaultArchiveCommandRunner: ArchiveCommandRunner = (
  executable,
  arguments_,
  options
) => {
  // Keep the archive streaming through native tar. Capturing output here would
  // grow Node's memory usage with the size of the packaged application.
  execFileSync(executable, [...arguments_], options)
}

/**
 * Create an atomic, portable ZIP around one packaged Windows application tree.
 * Windows' in-box bsdtar streams ZIP64 archives, avoiding Compress-Archive's
 * historical per-entry size limits and keeping large release builds bounded.
 */
export function createWindowsPortableZip(
  sourceDirectory: string,
  destinationPath: string,
  options: IWindowsPortableZipOptions = {}
): string {
  const source = resolve(sourceDirectory)
  const destination = resolve(destinationPath)

  const sourceEntry = lstatSync(source)
  if (!sourceEntry.isDirectory()) {
    throw new Error(`Portable ZIP source is not a directory: ${source}`)
  }
  if (readdirSync(source).length === 0) {
    throw new Error(`Portable ZIP source is empty: ${source}`)
  }
  if (!destination.toLowerCase().endsWith('.zip')) {
    throw new Error(`Portable ZIP destination must end in .zip: ${destination}`)
  }
  if (isPathInside(source, destination)) {
    throw new Error(
      `Portable ZIP destination must be outside its source tree: ${destination}`
    )
  }

  const destinationDirectory = dirname(destination)
  const temporaryDestination = `${destination}.partial.zip`
  mkdirSync(destinationDirectory, { recursive: true })

  // Never let a prior or interrupted package masquerade as this build's ZIP.
  rmSync(destination, { force: true })
  rmSync(temporaryDestination, { force: true })

  const executable = options.tarExecutable ?? getNativeTarExecutable()
  const runCommand = options.runCommand ?? defaultArchiveCommandRunner
  const sourceParent = dirname(source)
  const sourceName = basename(source)

  try {
    runCommand(
      executable,
      ['-c', '-a', '-f', temporaryDestination, '-C', sourceParent, sourceName],
      {
        cwd: destinationDirectory,
        stdio: 'inherit',
        windowsHide: true,
      }
    )

    // A successful list pass rejects truncated/corrupt output before the
    // temporary archive is atomically promoted to the declared release name.
    runCommand(executable, ['-t', '-f', temporaryDestination], {
      cwd: destinationDirectory,
      stdio: 'ignore',
      windowsHide: true,
    })

    if (statSync(temporaryDestination).size === 0) {
      throw new Error('Windows tar.exe produced an empty portable ZIP.')
    }

    renameSync(temporaryDestination, destination)
    return destination
  } catch (error) {
    rmSync(temporaryDestination, { force: true })
    throw error
  }
}
