import { WorkingDirectoryStatus } from '../models/status'
import { DiffSelectionType } from '../models/diff'
import { Repository } from '../models/repository'
import { stat } from 'fs/promises'
import { join } from 'path'

/** GitHub rejects a push containing any single file larger than this. */
export const ReceiveLimit = 100 * 1024 * 1024 // 100 MiB

/**
 * The size at which the auto-pin-on-commit feature moves a selected file to a
 * GitHub Release asset instead of committing it directly. A file strictly over
 * this size cannot be pushed, so pinning it (committing only a small pointer) is
 * what keeps the repository pushable. Anchored to {@link ReceiveLimit}.
 */
export const CheapLfsPinThresholdBytes = ReceiveLimit

/**
 * Retrieve paths of working directory files that are larger than a given Megabyte size.
 *
 * @param repository        - The repository from which the base file directory will be retrieved.
 * @param workingDirectory  - The collection of changed files, from which the selected files will
 *                            be determined.
 * @param maximumSizeMB     - The size limit (in Megabytes) at which an exceeding file size will
 *                            result in it's path being retrieved.
 */
export async function getLargeFilePaths(
  repository: Repository,
  workingDirectory: WorkingDirectoryStatus
) {
  const fileNames = new Array<string>()
  const workingDirectoryFiles = workingDirectory.files
  const includedFiles = workingDirectoryFiles.filter(
    file => file.selection.getSelectionType() !== DiffSelectionType.None
  )

  for (const file of includedFiles) {
    const filePath = join(repository.path, file.path)
    try {
      const fileStatus = await stat(filePath)
      const fileSizeBytes = fileStatus.size
      if (fileSizeBytes > ReceiveLimit) {
        fileNames.push(file.path)
      }
    } catch (error) {
      log.debug(`Unable to get the file size for ${filePath}`, error)
    }
  }

  return fileNames
}
