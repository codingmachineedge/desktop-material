import { readdir } from 'fs/promises'

/**
 * Validate that a path is a suitable clone destination: it must either not exist
 * yet or be an empty directory. Returns `null` when the path is usable, or an
 * `Error` describing why it isn't.
 *
 * Extracted from the clone dialog so both single and batch clone flows share one
 * implementation.
 */
export async function validateEmptyFolder(
  path: string | null
): Promise<Error | null> {
  if (path === null) {
    return new Error(
      'Unable to read path on disk. Please check the path and try again.'
    )
  }

  try {
    const directoryFiles = await readdir(path)

    if (directoryFiles.length === 0) {
      return null
    }

    return new Error(
      'This folder contains files. Git can only clone to empty folders.'
    )
  } catch (error) {
    if (error.code === 'ENOTDIR') {
      // path refers to a file or other file system entry
      return new Error(
        'There is already a file with this name. Git can only clone to a folder.'
      )
    }

    if (error.code === 'ENOENT') {
      // Folder does not exist
      return null
    }

    log.error(
      'validateEmptyFolder: Path validation failed. Error: ' + error.message
    )
    return new Error(
      'Unable to read path on disk. Please check the path and try again.'
    )
  }
}
