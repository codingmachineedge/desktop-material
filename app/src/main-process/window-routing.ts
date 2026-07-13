import * as Path from 'path'
import { PrimaryWindowScope } from '../lib/window-scope'

export { PrimaryWindowScope }

export interface IWindowRepositoryState {
  readonly selectedRepositoryPath: string | null
  readonly openRepositoryPaths: ReadonlyArray<string>
}

/** Pick a stable, reusable slot for a newly-created application window. */
export function nextWindowScope(activeScopes: ReadonlySet<string>): string {
  if (!activeScopes.has(PrimaryWindowScope)) {
    return PrimaryWindowScope
  }

  for (let index = 2; ; index++) {
    const candidate = `window-${index}`
    if (!activeScopes.has(candidate)) {
      return candidate
    }
  }
}

export function normalizeRepositoryPath(
  path: string,
  caseInsensitive: boolean
): string {
  const pathImplementation = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path)
    ? Path.win32
    : Path.posix
  const normalized = pathImplementation
    .normalize(path)
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
  return caseInsensitive ? normalized.toLowerCase() : normalized
}

function pathContainsTarget(
  repositoryPath: string,
  targetPath: string,
  caseInsensitive: boolean
): boolean {
  const repository = normalizeRepositoryPath(repositoryPath, caseInsensitive)
  const target = normalizeRepositoryPath(targetPath, caseInsensitive)
  return target === repository || target.startsWith(repository + '/')
}

/**
 * Find the window which already owns a repository tab for a target path.
 * Selected tabs win over background tabs, then the most-specific repository
 * root wins (important for repositories nested inside another repository).
 * Input order is the final tie-breaker and should put the focused window first.
 */
export function findWindowForRepositoryPath<T extends IWindowRepositoryState>(
  windows: ReadonlyArray<T>,
  targetPath: string,
  caseInsensitive: boolean
): T | null {
  const matches = windows.flatMap((window, windowIndex) => {
    const uniquePaths = new Set(window.openRepositoryPaths)
    if (window.selectedRepositoryPath !== null) {
      uniquePaths.add(window.selectedRepositoryPath)
    }

    return [...uniquePaths]
      .filter(path => pathContainsTarget(path, targetPath, caseInsensitive))
      .map(path => ({
        window,
        windowIndex,
        selected: path === window.selectedRepositoryPath,
        specificity: normalizeRepositoryPath(path, caseInsensitive).length,
      }))
  })

  matches.sort(
    (a, b) =>
      Number(b.selected) - Number(a.selected) ||
      b.specificity - a.specificity ||
      a.windowIndex - b.windowIndex
  )

  return matches[0]?.window ?? null
}
