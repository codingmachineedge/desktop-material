import * as Path from 'path'
import type { Repository } from '../../models/repository'
import type { WorktreeEntry, WorktreeType } from '../../models/worktree'
import { git } from './core'

const MaximumRepairWorktrees = 1_000
const MaximumRepairPathBytes = 256 * 1024

function validateWorktreePath(path: string): string {
  if (path.includes('\0') || !Path.isAbsolute(path)) {
    throw new Error('Worktree administration requires an absolute path.')
  }
  return Path.normalize(path)
}

export function parseWorktreePorcelainOutput(
  stdout: string
): ReadonlyArray<WorktreeEntry> {
  if (stdout.trim().length === 0) {
    return []
  }

  // With -z, worktree blocks are separated by double NUL and fields within
  // a block are separated by single NUL
  const blocks = stdout.replace(/\0$/, '').split('\0\0')
  const entries: WorktreeEntry[] = []

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split('\0')
    let path = ''
    let head = ''
    let branch: string | null = null
    let isDetached = false
    let isLocked = false
    let isPrunable = false

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        // Git for Windows will output paths using forward slashes, i.e.
        // c:/Users/niik/... but repositories added in Desktop always pass
        // through getRepositoryType which uses path.resolve to deduce the
        // absolute top level directory and that will normalize paths as well
        // so by normalizing here we can be more confident about comparing paths
        path = Path.normalize(line.substring('worktree '.length))
      } else if (line.startsWith('HEAD ')) {
        head = line.substring('HEAD '.length)
      } else if (line.startsWith('branch ')) {
        branch = line.substring('branch '.length)
      } else if (line === 'detached') {
        isDetached = true
      } else if (line === 'locked' || line.startsWith('locked ')) {
        isLocked = true
      } else if (line === 'prunable' || line.startsWith('prunable ')) {
        isPrunable = true
      }
    }

    const type: WorktreeType = i === 0 ? 'main' : 'linked'
    entries.push({ path, head, branch, isDetached, type, isLocked, isPrunable })
  }

  return entries
}

export async function listWorktrees(
  repositoryOrPath: Repository | string
): Promise<ReadonlyArray<WorktreeEntry>> {
  const result = await git(
    ['worktree', 'list', '--porcelain', '-z'],
    typeof repositoryOrPath === 'string'
      ? repositoryOrPath
      : repositoryOrPath.path,
    'listWorktrees'
  )

  return parseWorktreePorcelainOutput(result.stdout)
}

export async function listWorktreesFromGitDir(
  gitDir: string
): Promise<ReadonlyArray<WorktreeEntry>> {
  const result = await git(
    ['--git-dir', gitDir, 'worktree', 'list', '--porcelain', '-z'],
    gitDir,
    'listWorktreesFromGitDir'
  )

  return parseWorktreePorcelainOutput(result.stdout)
}

export async function addWorktree(
  repository: Repository,
  path: string,
  options: {
    /** Branch name used with -b (create new branch) */
    readonly createBranch?: string
    /** Commit-ish to check out (branch name, ref, or SHA) */
    readonly commitish?: string
  } = {}
): Promise<void> {
  const args = ['worktree', 'add']

  if (options.createBranch) {
    args.push('-b', options.createBranch)
  }

  args.push(path)

  if (options.commitish) {
    args.push(options.commitish)
  }

  await git(args, repository.path, 'addWorktree')
}

export async function removeWorktree(
  repositoryPath: string,
  worktreePath: string,
  force: boolean = false
): Promise<void> {
  const args = ['worktree', 'remove']
  if (force) {
    args.push('--force')
  }
  args.push(worktreePath)

  await git(args, repositoryPath, 'removeWorktree')
}

export async function moveWorktree(
  repository: Repository,
  oldPath: string,
  newPath: string
): Promise<void> {
  await git(
    ['worktree', 'move', oldPath, newPath],
    repository.path,
    'moveWorktree'
  )
}

/** Lock one registered linked worktree so prune, move, and remove leave it alone. */
export async function lockWorktree(
  repository: Repository,
  worktreePath: string
): Promise<void> {
  const path = validateWorktreePath(worktreePath)
  await git(['worktree', 'lock', '--', path], repository.path, 'lockWorktree')
}

/** Unlock one registered linked worktree. */
export async function unlockWorktree(
  repository: Repository,
  worktreePath: string
): Promise<void> {
  const path = validateWorktreePath(worktreePath)
  await git(
    ['worktree', 'unlock', '--', path],
    repository.path,
    'unlockWorktree'
  )
}

function countReportedWorktreeRecords(output: string): number {
  return Math.min(
    output.split(/\r?\n/).filter(line => line.trim().length > 0).length,
    10_000
  )
}

/** Preview or prune every missing worktree record using a fixed expiry policy. */
export async function pruneWorktrees(
  repository: Repository,
  dryRun: boolean
): Promise<number> {
  const args = ['worktree', 'prune', '--verbose', '--expire=now']
  if (dryRun) {
    args.push('--dry-run')
  }
  const result = await git(args, repository.path, 'pruneWorktrees')
  return countReportedWorktreeRecords(`${result.stdout}\n${result.stderr}`)
}

/** Repair administrative links for an internally generated worktree path set. */
export async function repairWorktrees(
  repository: Repository,
  worktreePaths: ReadonlyArray<string>
): Promise<void> {
  const paths = validateWorktreeRepairPaths(worktreePaths)
  await git(
    ['worktree', 'repair', '--', ...paths],
    repository.path,
    'repairWorktrees'
  )
}

export function validateWorktreeRepairPaths(
  worktreePaths: ReadonlyArray<string>
): ReadonlyArray<string> {
  if (
    worktreePaths.length === 0 ||
    worktreePaths.length > MaximumRepairWorktrees
  ) {
    throw new Error('Choose a bounded set of registered worktrees to repair.')
  }
  const paths = worktreePaths.map(validateWorktreePath)
  if (
    paths.reduce((total, path) => total + Buffer.byteLength(path, 'utf8'), 0) >
      MaximumRepairPathBytes ||
    new Set(paths.map(path => (__WIN32__ ? path.toLowerCase() : path))).size !==
      paths.length
  ) {
    throw new Error('The registered worktree repair set is invalid.')
  }
  return paths
}
