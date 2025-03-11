import { git } from './core'
import { Repository } from '../../models/repository'

/**
 * Clean untracked files from the repository.
 */
export async function cleanUntrackedFiles(repository: Repository) {
  await git(['clean', '-d', '--force'], repository.path, 'cleanUntrackedFiles')
}
