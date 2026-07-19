import * as Path from 'path'
import { homedir } from 'os'
import { mkdir, readFile, stat } from 'fs/promises'

import { writeCrashSafeText } from '../crash-safe-file'
import { getGlobalPathConfigValue, setGlobalConfigValue } from './config'

export const GlobalIgnoreMaximumBytes = 512 * 1024
export const DefaultGlobalIgnoreFileName = '.gitignore_global'

export interface IGlobalIgnoreDocument {
  readonly configured: boolean
  readonly path: string
  readonly contents: string
  readonly exists: boolean
}

export interface IGlobalIgnoreEnvironment {
  readonly HOME: string
}

function homePath(environment?: IGlobalIgnoreEnvironment): string {
  return environment?.HOME ?? homedir()
}

/** Resolve a user-entered global-ignore path without invoking a shell. */
export function resolveGlobalIgnorePath(
  value: string,
  environment?: IGlobalIgnoreEnvironment
): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error('Choose a global ignore file path.')
  }
  if (trimmed.includes('\0') || trimmed.length > 4096) {
    throw new Error('The global ignore file path is invalid.')
  }

  const home = homePath(environment)
  const expanded =
    trimmed === '~'
      ? home
      : trimmed.startsWith('~/') || trimmed.startsWith('~\\')
      ? Path.join(home, trimmed.slice(2))
      : trimmed

  return Path.resolve(expanded)
}

function normalizedContents(contents: string): string {
  if (Buffer.byteLength(contents, 'utf8') > GlobalIgnoreMaximumBytes) {
    throw new Error('Global ignore rules are limited to 512 KiB.')
  }
  if (contents.includes('\0')) {
    throw new Error('Global ignore rules cannot contain NUL characters.')
  }
  return contents.length > 0 && !contents.endsWith('\n')
    ? `${contents}\n`
    : contents
}

/** Read the effective global ignore file without creating or changing it. */
export async function readGlobalIgnore(
  environment?: IGlobalIgnoreEnvironment
): Promise<IGlobalIgnoreDocument> {
  const configuredPath = await getGlobalPathConfigValue(
    'core.excludesFile',
    environment
  )
  const configured = configuredPath !== null && configuredPath.trim().length > 0
  const path = resolveGlobalIgnorePath(
    configuredPath ??
      Path.join(homePath(environment), DefaultGlobalIgnoreFileName),
    environment
  )

  try {
    const metadata = await stat(path)
    if (!metadata.isFile()) {
      throw new Error('The configured global ignore path is not a file.')
    }
    if (metadata.size > GlobalIgnoreMaximumBytes) {
      throw new Error('The configured global ignore file exceeds 512 KiB.')
    }
    return {
      configured,
      path,
      contents: await readFile(path, 'utf8'),
      exists: true,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    return { configured, path, contents: '', exists: false }
  }
}

/**
 * Persist global rules first, then point Git at the accepted file. Crash-safe
 * persistence refuses linked directories and bounds recovery artifacts.
 */
export async function saveGlobalIgnore(
  pathValue: string,
  contents: string,
  environment?: IGlobalIgnoreEnvironment
): Promise<IGlobalIgnoreDocument> {
  const path = resolveGlobalIgnorePath(pathValue, environment)
  const text = normalizedContents(contents)
  await mkdir(Path.dirname(path), { recursive: true })
  await writeCrashSafeText(path, text)
  await setGlobalConfigValue('core.excludesFile', path, environment)
  return { configured: true, path, contents: text, exists: true }
}
