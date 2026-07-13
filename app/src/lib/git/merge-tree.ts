import { Branch } from '../../models/branch'
import { ComputedAction } from '../../models/computed-action'
import { MergeTreeResult } from '../../models/merge'
import { Repository } from '../../models/repository'
import { git, isGitError } from './core'
import { GitError } from 'dugite'

const MaximumMergeTreeOutputBytes = 4 * 1024 * 1024
const MaximumConflictPaths = 1_000
const MaximumConflictPathBytes = 16 * 1024
const MaximumConflictPathTotalBytes = 256 * 1024

function escapeConflictPathForDisplay(path: string): string {
  return path.replace(
    /[\u0000-\u001f\u007f]/g,
    character => `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`
  )
}

export function parseMergeTreeOutput(stdout: string): MergeTreeResult {
  if (Buffer.byteLength(stdout, 'utf8') > MaximumMergeTreeOutputBytes) {
    throw new Error('The merge-tree preview exceeded its safety limit.')
  }
  if (!stdout.endsWith('\0')) {
    throw new Error('Git returned an invalid merge-tree preview.')
  }
  const fields = stdout.split('\0')
  if (fields[fields.length - 1] === '') {
    fields.pop()
  }
  const treeID = fields.shift()
  if (treeID === undefined || !/^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(treeID)) {
    throw new Error('Git returned an invalid merge-tree preview.')
  }
  if (fields.length > MaximumConflictPaths) {
    throw new Error('The merge-tree preview contains too many conflict paths.')
  }
  let totalBytes = 0
  const paths = fields.map(path => {
    const bytes = Buffer.byteLength(path, 'utf8')
    totalBytes += bytes
    if (
      path.length === 0 ||
      bytes > MaximumConflictPathBytes ||
      path.startsWith('/') ||
      path
        .split('/')
        .some(part => part.length === 0 || part === '.' || part === '..')
    ) {
      throw new Error('Git returned an invalid merge-tree conflict path.')
    }
    return escapeConflictPathForDisplay(path)
  })
  if (
    totalBytes > MaximumConflictPathTotalBytes ||
    new Set(paths).size !== paths.length
  ) {
    throw new Error('The merge-tree conflict path list is invalid.')
  }
  return paths.length > 0
    ? {
        kind: ComputedAction.Conflicts,
        conflictedFiles: paths.length,
        conflictedFilePaths: paths,
      }
    : { kind: ComputedAction.Clean }
}

export async function determineMergeability(
  repository: Repository,
  ours: Branch,
  theirs: Branch
) {
  return git(
    [
      'merge-tree',
      '--write-tree',
      '--name-only',
      '--no-messages',
      '-z',
      ours.tip.sha,
      theirs.tip.sha,
    ],
    repository.path,
    'determineMergeability',
    {
      successExitCodes: new Set([0, 1]),
      maxBuffer: MaximumMergeTreeOutputBytes,
    }
  )
    .then<MergeTreeResult>(({ stdout }) => parseMergeTreeOutput(stdout))
    .catch<MergeTreeResult>(e =>
      isGitError(e, GitError.CannotMergeUnrelatedHistories)
        ? Promise.resolve({ kind: ComputedAction.Invalid })
        : Promise.reject(e)
    )
}
