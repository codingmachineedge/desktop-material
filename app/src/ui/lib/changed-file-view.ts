export type ChangedFileViewMode = 'flat' | 'tree'

export const ChangedFileViewModeChangedEvent =
  'desktop-material-changed-file-view-mode-changed'
export const ChangedFileViewStorageKey = 'changed-file-view-v1'

const MaxChangedFilePathLength = 4096
const MaxChangedFilePathSegments = 128
let volatileChangedFileViewMode: ChangedFileViewMode | null = null

interface IIndexedFile<T> {
  readonly file: T
  readonly path: string
  readonly index: number
}

interface ITreeNode<T> {
  readonly path: string
  readonly depth: number
  readonly directories: Map<string, ITreeNode<T>>
  readonly files: Array<IIndexedFile<T>>
}

export interface IChangedFileTreeGroup<T> {
  readonly directoryPath: string | null
  readonly depth: number
  readonly files: ReadonlyArray<T>
}

export type ChangedFileTreeRow<T> =
  | {
      readonly kind: 'directory'
      readonly path: string
      readonly depth: number
    }
  | {
      readonly kind: 'file'
      readonly file: T
      readonly path: string
      readonly depth: number
      readonly sourceIndex: number
    }

/**
 * Git paths use `/` on every platform. Reject traversal-like, absolute,
 * empty-segment, control-character, and unreasonably deep paths before using
 * them to construct presentation-only directory nodes.
 */
export function getSafeChangedFilePathParts(
  path: string
): ReadonlyArray<string> | null {
  if (
    path.length === 0 ||
    path.length > MaxChangedFilePathLength ||
    path.startsWith('/') ||
    /[\0-\x1f\x7f]/.test(path)
  ) {
    return null
  }

  const parts = path.split('/')
  if (
    parts.length > MaxChangedFilePathSegments ||
    parts.some(part => part.length === 0 || part === '.' || part === '..')
  ) {
    return null
  }

  return parts
}

export function getChangedFileTreeDepth(path: string): number {
  const parts = getSafeChangedFilePathParts(path)
  return parts === null ? 0 : Math.max(parts.length - 1, 0)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareIndexedFiles<T>(
  left: IIndexedFile<T>,
  right: IIndexedFile<T>
): number {
  return compareText(left.path, right.path) || left.index - right.index
}

function createNode<T>(path: string, depth: number): ITreeNode<T> {
  return { path, depth, directories: new Map(), files: [] }
}

function buildTree<T>(
  files: ReadonlyArray<T>,
  getPath: (file: T) => string
): ITreeNode<T> {
  const root = createNode<T>('', 0)

  files.forEach((file, index) => {
    const path = getPath(file)
    const parts = getSafeChangedFilePathParts(path)
    if (parts === null || parts.length === 1) {
      root.files.push({
        file,
        path,
        index,
      })
      return
    }

    let node = root
    for (let partIndex = 0; partIndex < parts.length - 1; partIndex++) {
      const segment = parts[partIndex]
      const directoryPath = parts.slice(0, partIndex + 1).join('/')
      let child = node.directories.get(segment)
      if (child === undefined) {
        child = createNode<T>(directoryPath, partIndex)
        node.directories.set(segment, child)
      }
      node = child
    }

    node.files.push({
      file,
      path,
      index,
    })
  })

  return root
}

function sortedDirectories<T>(node: ITreeNode<T>): ReadonlyArray<ITreeNode<T>> {
  return Array.from(node.directories.values()).sort((left, right) =>
    compareText(left.path, right.path)
  )
}

/** Build a deterministic depth-first tree while keeping source indexes. */
export function buildChangedFileTreeRows<T>(
  files: ReadonlyArray<T>,
  getPath: (file: T) => string
): ReadonlyArray<ChangedFileTreeRow<T>> {
  const root = buildTree(files, getPath)
  const rows = new Array<ChangedFileTreeRow<T>>()

  const appendFiles = (node: ITreeNode<T>, depth: number) => {
    for (const entry of [...node.files].sort(compareIndexedFiles)) {
      rows.push({
        kind: 'file',
        file: entry.file,
        path: entry.path,
        depth,
        sourceIndex: entry.index,
      })
    }
  }

  const appendDirectory = (node: ITreeNode<T>) => {
    rows.push({ kind: 'directory', path: node.path, depth: node.depth })
    appendFiles(node, node.depth + 1)
    for (const child of sortedDirectories(node)) {
      appendDirectory(child)
    }
  }

  appendFiles(root, 0)
  for (const child of sortedDirectories(root)) {
    appendDirectory(child)
  }

  return rows
}

/**
 * Build non-overlapping directory groups for section-based lists. Empty
 * intermediate directories are represented by the full path of their nearest
 * descendant group, so each selectable file still occurs exactly once.
 */
export function buildChangedFileTreeGroups<T>(
  files: ReadonlyArray<T>,
  getPath: (file: T) => string
): ReadonlyArray<IChangedFileTreeGroup<T>> {
  const root = buildTree(files, getPath)
  const groups = new Array<IChangedFileTreeGroup<T>>()

  const appendGroup = (node: ITreeNode<T>, isRoot: boolean) => {
    if (node.files.length > 0) {
      groups.push({
        directoryPath: isRoot ? null : node.path,
        depth: isRoot ? 0 : node.depth,
        files: [...node.files]
          .sort(compareIndexedFiles)
          .map(entry => entry.file),
      })
    }
    for (const child of sortedDirectories(node)) {
      appendGroup(child, false)
    }
  }

  appendGroup(root, true)
  return groups
}

export function normalizeChangedFileViewMode(
  value: unknown
): ChangedFileViewMode {
  return value === 'tree' ? 'tree' : 'flat'
}

export function readChangedFileViewMode(): ChangedFileViewMode {
  if (typeof localStorage === 'undefined') {
    return volatileChangedFileViewMode ?? 'flat'
  }

  try {
    const serialized = localStorage.getItem(ChangedFileViewStorageKey)
    if (serialized === null) {
      return volatileChangedFileViewMode ?? 'flat'
    }
    if (serialized.length > 1024) {
      return 'flat'
    }
    const parsed: unknown = JSON.parse(serialized)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return 'flat'
    }
    const record = parsed as Record<string, unknown>
    return record.version === 1
      ? normalizeChangedFileViewMode(record.mode)
      : 'flat'
  } catch {
    return volatileChangedFileViewMode ?? 'flat'
  }
}

export function setChangedFileViewMode(mode: ChangedFileViewMode): void {
  let stored = false
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(
        ChangedFileViewStorageKey,
        JSON.stringify({ version: 1, mode })
      )
      stored = true
    } catch {
      // The view still changes for this session when storage is unavailable.
    }
  }
  volatileChangedFileViewMode = stored ? null : mode

  if (typeof document !== 'undefined') {
    document.dispatchEvent(
      new CustomEvent(ChangedFileViewModeChangedEvent, { detail: mode })
    )
  }
}
