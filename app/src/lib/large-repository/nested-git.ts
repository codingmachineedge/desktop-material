/**
 * A nested `.git` directory found somewhere below a repository's own root — the
 * signature of an accidentally-committed inner clone or an un-registered
 * submodule. These bloat status/add on large repositories and can be offered
 * (confirm-class, never automatic) for compression into a single archive.
 */
export interface INestedGitDirectory {
  /** Path to the nested `.git` directory, relative to the repository root. */
  readonly gitDir: string
  /** The directory that contains the nested `.git` (the inner working root). */
  readonly containingDir: string
}

/** Archive produced when the user confirms compressing nested `.git` dirs. */
export const NestedGitArchiveName = 'nested-dotgit.tar.gz'

function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

/** Split a normalized POSIX path into non-empty, non-`.` segments. */
function segments(path: string): ReadonlyArray<string> {
  return toPosix(path)
    .split('/')
    .filter(segment => segment.length > 0 && segment !== '.')
}

/**
 * Pure detection of nested `.git` directories from a listing of candidate paths
 * (relative to the repository root, in any separator style). A path qualifies
 * when its final segment is `.git` AND it is nested — i.e. it has at least one
 * segment before the `.git`, so the repository's own top-level `.git` is never
 * flagged. Results are de-duplicated and sorted by containing directory for a
 * stable, reviewable confirm prompt.
 */
export function detectNestedGitDirectories(
  relativePaths: Iterable<string>
): ReadonlyArray<INestedGitDirectory> {
  const byGitDir = new Map<string, INestedGitDirectory>()

  for (const raw of relativePaths) {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      continue
    }
    const parts = segments(raw)
    if (parts.length < 2) {
      // `.git` alone (the repo's own) or an empty path — not nested.
      continue
    }
    if (parts[parts.length - 1] !== '.git') {
      continue
    }
    const gitDir = parts.join('/')
    const containingDir = parts.slice(0, -1).join('/')
    if (!byGitDir.has(gitDir)) {
      byGitDir.set(gitDir, { gitDir, containingDir })
    }
  }

  return [...byGitDir.values()].sort((a, b) =>
    a.containingDir.localeCompare(b.containingDir)
  )
}

/** A confirm-class plan describing what compressing nested `.git` dirs will do. */
export interface INestedGitCompressionPlan {
  readonly archiveName: string
  /** Nested `.git` directories to be tar-gzipped, in stable order. */
  readonly sources: ReadonlyArray<INestedGitDirectory>
}

/**
 * Build the compression plan, or `null` when there is nothing nested to
 * compress. Never performs the compression itself — the caller must gate this
 * behind an explicit user confirmation.
 */
export function planNestedGitCompression(
  nested: ReadonlyArray<INestedGitDirectory>
): INestedGitCompressionPlan | null {
  if (nested.length === 0) {
    return null
  }
  return { archiveName: NestedGitArchiveName, sources: nested }
}
