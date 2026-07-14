/** Additional arguments to provide when cloning a repository */
export type CloneOptions = {
  /** The branch to checkout after the clone has completed. */
  readonly branch?: string
  /** The default branch name in case we're cloning an empty repository. */
  readonly defaultBranch?: string
  /** Limit fetched history to this many commits. */
  readonly depth?: number
  /** Fetch only the selected/default branch when cloning shallow history. */
  readonly singleBranch?: boolean
  /** Apply the shallow-history limit to recursively cloned submodules. */
  readonly shallowSubmodules?: boolean
}

export const MaximumCloneDepth = 2_147_483_647

/** Parse the guided depth field without accepting signs, decimals, or flags. */
export function normalizeCloneDepth(value: string): number {
  const input = value.trim()
  if (!/^\d+$/.test(input)) {
    throw new Error('Clone depth must be a whole number of commits.')
  }
  const depth = Number(input)
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > MaximumCloneDepth) {
    throw new Error(`Clone depth must be between 1 and ${MaximumCloneDepth}.`)
  }
  return depth
}

/** Build only the fixed shallow-history arguments supported by the clone UI. */
export function getShallowCloneArgs(
  options: CloneOptions
): ReadonlyArray<string> {
  if (options.depth === undefined) {
    return []
  }

  const depth = normalizeCloneDepth(String(options.depth))
  const args = [`--depth=${depth}`]
  if (options.singleBranch === true) {
    args.push('--single-branch')
  }
  if (options.shallowSubmodules === true) {
    args.push('--shallow-submodules')
  }
  return args
}
