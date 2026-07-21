/**
 * The outcome of an attempt to remove a repository from the app (and,
 * optionally, from disk).
 *
 * - `removed`: the repository was removed from the app. When a disk removal was
 *   requested it also succeeded.
 * - `trash-failed`: the user asked to move the repository to the Recycle
 *   Bin/Trash but that step failed (locked files, unsupported volume, network
 *   or exFAT path, …). The repository was left untouched so the caller can
 *   surface a "Force delete permanently" fallback.
 * - `error`: an unexpected error occurred and was already surfaced to the user
 *   through the global error notice.
 */
export type RemoveRepositoryResult = 'removed' | 'trash-failed' | 'error'
