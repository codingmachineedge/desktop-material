import type {
  SessionFsConfig,
  SessionFsFileInfo,
  SessionFsProvider,
} from '@github/copilot-sdk'
import { posix } from 'path'

const InMemorySessionFsStatePath = 'state'
type CopilotInMemorySessionFsReaddirWithTypesEntry = Awaited<
  ReturnType<SessionFsProvider['readdirWithTypes']>
>[number]

export function getCopilotInMemorySessionFsConfig(
  repositoryPath?: string
): SessionFsConfig {
  return {
    initialCwd: repositoryPath ?? process.cwd(),
    sessionStatePath: InMemorySessionFsStatePath,
    // The runtime uses this only to construct virtual SessionFs paths before
    // sending them to the provider, so POSIX keeps the in-memory implementation
    // much simpler.
    conventions: 'posix',
  }
}

interface ICopilotInMemorySessionFsFile {
  readonly content: string
  readonly createdAt: string
  readonly updatedAt: string
}

function createCopilotInMemorySessionFsError(path: string): Error {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
}

export function createCopilotInMemorySessionFsProvider(): SessionFsProvider {
  const files = new Map<string, ICopilotInMemorySessionFsFile>()
  const directories = new Set<string>(['.', InMemorySessionFsStatePath])

  const normalizePath = (path: string) => {
    const normalized = posix.normalize(path)
    return normalized === '/' ? normalized : normalized.replace(/\/$/, '')
  }

  const getParentPath = (path: string) => {
    const normalized = normalizePath(path)
    return posix.dirname(normalized)
  }

  const addDirectory = (path: string) => {
    const normalized = normalizePath(path)
    directories.add(normalized)

    if (normalized !== '.' && normalized !== '/') {
      addDirectory(getParentPath(normalized))
    }
  }

  const addParentDirectory = (path: string) => {
    addDirectory(getParentPath(path))
  }

  const getTimestamp = () => new Date().toISOString()

  const getDirectChildren = (path: string) => {
    const normalized = normalizePath(path)
    const prefix =
      normalized === '.' ? '' : normalized === '/' ? '/' : `${normalized}/`
    const children = new Set<string>()

    for (const entry of [...files.keys(), ...directories]) {
      if (entry === normalized || !entry.startsWith(prefix)) {
        continue
      }

      const child = entry.slice(prefix.length).split('/')[0]
      if (child.length > 0) {
        children.add(child)
      }
    }

    return [...children]
  }

  const writeFile = (path: string, content: string) => {
    const normalized = normalizePath(path)
    addParentDirectory(normalized)

    const existing = files.get(normalized)
    const timestamp = getTimestamp()
    files.set(normalized, {
      content,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
  }

  return {
    readFile: async path => {
      const normalized = normalizePath(path)
      const file = files.get(normalized)

      if (file === undefined) {
        throw createCopilotInMemorySessionFsError(path)
      }

      return file.content
    },
    writeFile: async (path, content) => writeFile(path, content),
    appendFile: async (path, content) => {
      const normalized = normalizePath(path)
      const existing = files.get(normalized)
      writeFile(normalized, `${existing?.content ?? ''}${content}`)
    },
    exists: async path => {
      const normalized = normalizePath(path)
      return files.has(normalized) || directories.has(normalized)
    },
    stat: async path => {
      const normalized = normalizePath(path)
      const file = files.get(normalized)

      if (file !== undefined) {
        const fileInfo: SessionFsFileInfo = {
          isFile: true,
          isDirectory: false,
          size: Buffer.byteLength(file.content),
          mtime: file.updatedAt,
          birthtime: file.createdAt,
        }
        return fileInfo
      }

      if (directories.has(normalized)) {
        const timestamp = getTimestamp()
        const directoryInfo: SessionFsFileInfo = {
          isFile: false,
          isDirectory: true,
          size: 0,
          mtime: timestamp,
          birthtime: timestamp,
        }
        return directoryInfo
      }

      throw createCopilotInMemorySessionFsError(path)
    },
    mkdir: async path => {
      addDirectory(path)
    },
    readdir: async path => {
      const normalized = normalizePath(path)
      if (!directories.has(normalized)) {
        throw createCopilotInMemorySessionFsError(path)
      }

      return getDirectChildren(normalized)
    },
    readdirWithTypes: async path => {
      const normalized = normalizePath(path)
      if (!directories.has(normalized)) {
        throw createCopilotInMemorySessionFsError(path)
      }

      return getDirectChildren(normalized).map(name => {
        const childPath = posix.join(normalized, name)
        const entry: CopilotInMemorySessionFsReaddirWithTypesEntry = {
          name,
          type: files.has(childPath) ? 'file' : 'directory',
        }
        return entry
      })
    },
    rm: async (path, recursive, force) => {
      const normalized = normalizePath(path)
      const exists = files.has(normalized) || directories.has(normalized)

      if (!exists) {
        if (force) {
          return
        }

        throw createCopilotInMemorySessionFsError(path)
      }

      if (directories.has(normalized)) {
        const prefix = normalized === '/' ? '/' : `${normalized}/`
        const hasChildren = getDirectChildren(normalized).length > 0

        if (hasChildren && !recursive) {
          throw new Error(`Directory not empty: ${path}`)
        }

        for (const filePath of [...files.keys()]) {
          if (filePath.startsWith(prefix)) {
            files.delete(filePath)
          }
        }

        for (const directoryPath of [...directories]) {
          if (directoryPath.startsWith(prefix)) {
            directories.delete(directoryPath)
          }
        }
      }

      files.delete(normalized)
      directories.delete(normalized)
    },
    rename: async (src, dest) => {
      const normalizedSrc = normalizePath(src)
      const normalizedDest = normalizePath(dest)
      const file = files.get(normalizedSrc)

      if (file !== undefined) {
        addParentDirectory(normalizedDest)
        files.set(normalizedDest, file)
        files.delete(normalizedSrc)
        return
      }

      if (!directories.has(normalizedSrc)) {
        throw createCopilotInMemorySessionFsError(src)
      }

      addDirectory(normalizedDest)

      const srcPrefix = `${normalizedSrc}/`
      const destPrefix = `${normalizedDest}/`
      for (const [filePath, entry] of [...files]) {
        if (filePath.startsWith(srcPrefix)) {
          files.set(`${destPrefix}${filePath.slice(srcPrefix.length)}`, entry)
          files.delete(filePath)
        }
      }

      for (const directoryPath of [...directories]) {
        if (directoryPath.startsWith(srcPrefix)) {
          directories.add(
            `${destPrefix}${directoryPath.slice(srcPrefix.length)}`
          )
          directories.delete(directoryPath)
        }
      }

      directories.delete(normalizedSrc)
    },
  }
}
