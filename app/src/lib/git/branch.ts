import { git, isGitError } from './core'
import { Repository } from '../../models/repository'
import { Branch } from '../../models/branch'
import { formatAsLocalRef } from './refs'
import { deleteRef } from './update-ref'
import { GitError as DugiteError } from 'dugite'
import { envForRemoteOperation } from './environment'
import { createForEachRefParser } from './git-delimiter-parser'
import { IRemote } from '../../models/remote'
import { coerceToString } from './coerce-to-string'
import { listWorktrees } from './worktree'

export const MaximumReviewedBranchDeletions = 100

export interface IReviewedBranchDeletion {
  readonly name: string
  readonly expectedSha: string
}

export interface IReviewedBranchDeletionResult {
  readonly name: string
  readonly status: 'deleted' | 'failed'
  readonly detail: string
}

/**
 * Create a new branch from the given start point.
 *
 * @param repository - The repository in which to create the new branch
 * @param name       - The name of the new branch
 * @param startPoint - A committish string that the new branch should be based
 *                     on, or undefined if the branch should be created based
 *                     off of the current state of HEAD
 */
export async function createBranch(
  repository: Repository,
  name: string,
  startPoint: string | null,
  noTrack?: boolean
): Promise<void> {
  const args =
    startPoint !== null ? ['branch', name, startPoint] : ['branch', name]

  // if we're branching directly from a remote branch, we don't want to track it
  // tracking it will make the rest of desktop think we want to push to that
  // remote branch's upstream (which would likely be the upstream of the fork)
  if (noTrack) {
    args.push('--no-track')
  }

  await git(args, repository.path, 'createBranch')
}

export const getBranchNames = ({ path }: Repository): Promise<string[]> => {
  const parser = createForEachRefParser({ name: '%(refname:short)' })
  return git(['branch', ...parser.formatArgs], path, 'getBranchNames').then(x =>
    parser.parse(x.stdout).map(b => b.name)
  )
}

/** Rename the given branch to a new name. */
export async function renameBranch(
  repository: Repository,
  branch: Branch,
  newName: string,
  force?: boolean
): Promise<void> {
  try {
    await git(
      ['branch', force ? '-M' : '-m', branch.nameWithoutRemote, newName],
      repository.path,
      'renameBranch'
    )
  } catch (error) {
    // If we failed to rename and the branch name only differs by case, we
    // we'll try again with the -M flag to force the rename. See
    // https://github.com/desktop/desktop/issues/21320
    if (
      // Only retry if the caller hasn't explicitly asked us to force the rename
      force === undefined &&
      isGitError(error) &&
      error.result.gitError === DugiteError.BranchAlreadyExists
    ) {
      const stderr = coerceToString(error.result.stderr)
      const m = /fatal: a branch named '(.+?)' already exists/.exec(stderr)

      if (m && m[1].toLowerCase() === newName.toLowerCase()) {
        // At this point we're almost certain that we are dealing with a
        // case-only rename on a case insensitive filesystem, but we can't
        // be 100% sure, NTFS can be configured to be case sensitive and macOS
        // might have case sensitive file systems mounted so we have to list
        // all branches and check the names.
        return (
          getBranchNames(repository)
            // Throw the original error if we fail to get the branch names
            .catch(() => Promise.reject(error))
            .then(names =>
              // If we find the new name in the list of branches we can't
              // safely assume it's a case-only rename and have to
              // propagate the original error, otherwise try again with -M
              names.includes(newName)
                ? Promise.reject(error)
                : renameBranch(repository, branch, newName, true)
            )
        )
      }
    }
    throw error
  }
}

/**
 * Delete the branch locally.
 */
export async function deleteLocalBranch(
  repository: Repository,
  branchName: string
): Promise<true> {
  await git(['branch', '-D', branchName], repository.path, 'deleteLocalBranch')
  return true
}

function normalizeReviewedBranchDeletion(
  value: IReviewedBranchDeletion
): IReviewedBranchDeletion {
  const name = value.name.trim()
  const expectedSha = value.expectedSha.trim().toLowerCase()
  if (
    name.length === 0 ||
    name.length > 1_024 ||
    name === 'HEAD' ||
    name.startsWith('-') ||
    /[\0-\x20\x7f~^:?*\[\\]/.test(name) ||
    name.includes('..') ||
    name.includes('@{') ||
    name.endsWith('/') ||
    name.endsWith('.') ||
    name.split('/').some(part => part.length === 0 || part.endsWith('.lock')) ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(expectedSha)
  ) {
    throw new Error('A reviewed branch identity is invalid.')
  }
  return { name, expectedSha }
}

/**
 * Delete only exact reviewed local branch identities. All candidates are
 * revalidated before the first mutation and each update-ref includes the old
 * object ID, so a concurrent branch move is never deleted accidentally.
 */
export async function deleteReviewedLocalBranches(
  repository: Repository,
  reviewedBranches: ReadonlyArray<IReviewedBranchDeletion>
): Promise<ReadonlyArray<IReviewedBranchDeletionResult>> {
  if (
    reviewedBranches.length === 0 ||
    reviewedBranches.length > MaximumReviewedBranchDeletions
  ) {
    throw new Error(
      `Review between 1 and ${MaximumReviewedBranchDeletions} local branches.`
    )
  }
  const reviewed = reviewedBranches.map(normalizeReviewedBranchDeletion)
  if (new Set(reviewed.map(branch => branch.name)).size !== reviewed.length) {
    throw new Error('Reviewed branch names must be unique.')
  }

  const current = await git(
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    repository.path,
    'reviewBulkBranchDeletion',
    { successExitCodes: new Set([0, 1]) }
  )
  const currentName = current.exitCode === 0 ? current.stdout.trim() : null
  if (reviewed.some(branch => branch.name === currentName)) {
    throw new Error('The checked-out branch cannot be deleted.')
  }

  const checkedOutRefs = new Set(
    (await listWorktrees(repository)).flatMap(worktree =>
      worktree.branch === null ? [] : [worktree.branch]
    )
  )
  if (
    reviewed.some(branch => checkedOutRefs.has(formatAsLocalRef(branch.name)))
  ) {
    throw new Error('A branch checked out in a worktree cannot be deleted.')
  }

  const { formatArgs, parse } = createForEachRefParser({
    name: '%(refname:short)',
    sha: '%(objectname)',
  })
  const inventory = await git(
    ['for-each-ref', ...formatArgs, 'refs/heads'],
    repository.path,
    'reviewBulkBranchDeletion'
  )
  const live = new Map(
    parse(inventory.stdout).map(branch => [
      branch.name,
      branch.sha.toLowerCase(),
    ])
  )
  for (const branch of reviewed) {
    if (live.get(branch.name) !== branch.expectedSha) {
      throw new Error(
        'The reviewed branch list changed. Refresh and review it again.'
      )
    }
  }

  const results: IReviewedBranchDeletionResult[] = []
  for (const branch of reviewed) {
    try {
      await git(
        ['update-ref', '-d', formatAsLocalRef(branch.name), branch.expectedSha],
        repository.path,
        'deleteReviewedLocalBranches'
      )
      log.info(
        `Deleted reviewed local branch ${branch.name} (was ${branch.expectedSha})`
      )
      results.push({
        name: branch.name,
        status: 'deleted',
        detail: `Deleted at ${branch.expectedSha.slice(0, 12)}.`,
      })
    } catch {
      results.push({
        name: branch.name,
        status: 'failed',
        detail: 'The branch moved or could not be deleted.',
      })
    }
  }
  return results
}

/**
 * Deletes a remote branch
 *
 * @param remoteName - the name of the remote to delete the branch from
 * @param remoteBranchName - the name of the branch on the remote
 */
export async function deleteRemoteBranch(
  repository: Repository,
  remote: IRemote,
  remoteBranchName: string
): Promise<true> {
  const args = ['push', remote.name, `:${remoteBranchName}`]

  // If the user is not authenticated, the push is going to fail
  // Let this propagate and leave it to the caller to handle
  const result = await git(args, repository.path, 'deleteRemoteBranch', {
    env: await envForRemoteOperation(remote.url),
    expectedErrors: new Set<DugiteError>([DugiteError.BranchDeletionFailed]),
  })

  // It's possible that the delete failed because the ref has already
  // been deleted on the remote. If we identify that specific
  // error we can safely remove our remote ref which is what would
  // happen if the push didn't fail.
  if (result.gitError === DugiteError.BranchDeletionFailed) {
    const ref = `refs/remotes/${remote.name}/${remoteBranchName}`
    await deleteRef(repository, ref)
  }

  return true
}

/**
 * Finds branches that have a tip equal to the given committish
 *
 * @param repository within which to execute the command
 * @param commitish a sha, HEAD, etc that the branch(es) tip should be
 * @returns list branch names. null if an error is encountered
 */
export async function getBranchesPointedAt(
  repository: Repository,
  commitish: string
): Promise<Array<string> | null> {
  const args = [
    'branch',
    `--points-at=${commitish}`,
    '--format=%(refname:short)',
  ]
  // this command has an implicit \n delimiter
  const { stdout, exitCode } = await git(
    args,
    repository.path,
    'branchPointedAt',
    {
      // - 1 is returned if a common ancestor cannot be resolved
      // - 129 is returned if ref is malformed
      //   "warning: ignoring broken ref refs/remotes/origin/main."
      successExitCodes: new Set([0, 1, 129]),
    }
  )
  if (exitCode === 1 || exitCode === 129) {
    return null
  }
  // split (and remove trailing element cause its always an empty string)
  return stdout.split('\n').slice(0, -1)
}

/**
 * Gets all branches that have been merged into the given branch
 *
 * @param repository The repository in which to search
 * @param branchName The to be used as the base branch
 * @returns map of branch canonical refs paired to its sha
 */
export async function getMergedBranches(
  repository: Repository,
  branchName: string
): Promise<Map<string, string>> {
  const canonicalBranchRef = formatAsLocalRef(branchName)
  const { formatArgs, parse } = createForEachRefParser({
    sha: '%(objectname)',
    canonicalRef: '%(refname)',
  })

  const args = ['branch', ...formatArgs, '--merged', branchName]
  const mergedBranches = new Map<string, string>()
  const { stdout } = await git(args, repository.path, 'mergedBranches')

  for (const branch of parse(stdout)) {
    // Don't include the branch we're using to compare against
    // in the list of branches merged into that branch.
    if (branch.canonicalRef !== canonicalBranchRef) {
      mergedBranches.set(branch.canonicalRef, branch.sha)
    }
  }

  return mergedBranches
}
