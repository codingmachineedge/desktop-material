/** Additional arguments to provide when cloning a repository */
export type CloneOptions = {
  /** The branch to checkout after the clone has completed. */
  readonly branch?: string
  /** The default branch name in case we're cloning an empty repository. */
  readonly defaultBranch?: string
  /**
   * Stable signed-in account identity preferred for the first HTTPS attempt.
   * This selector is resolved only inside Desktop's credential trampoline.
   */
  readonly accountKey?: string
}
