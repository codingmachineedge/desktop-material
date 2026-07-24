import { git } from './core'
import { Repository } from '../../models/repository'
import { WorkingDirectoryFileChange } from '../../models/status'
import { largeRepositoryGitArgsForPath } from '../large-repository/large-repository-mode'

/**
 * Add a conflicted file to the index.
 *
 * Typically done after having resolved conflicts either manually
 * or through checkout --theirs/--ours.
 */
export async function addConflictedFile(
  repository: Repository,
  file: WorkingDirectoryFileChange
) {
  await git(
    [
      // Suppress background gc/maintenance for large repositories only.
      ...largeRepositoryGitArgsForPath(repository.path),
      'add',
      '--',
      file.path,
    ],
    repository.path,
    'addConflictedFile'
  )
}
