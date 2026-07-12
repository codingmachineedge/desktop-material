/**
 * This is the magic remote name prefix
 * for when we add a remote on behalf of
 * the user.
 */
export const ForkedRemotePrefix = 'github-desktop-'

export function forkPullRequestRemoteName(remoteName: string) {
  return `${ForkedRemotePrefix}${remoteName}`
}

/** A remote as defined in Git. */
export interface IRemote {
  readonly name: string
  readonly url: string
}

/**
 * Gets a value indicating whether two remotes can be considered
 * structurally equivalent to each other.
 */
export function remoteEquals(x: IRemote | null, y: IRemote | null) {
  if (x === y) {
    return true
  }

  if (x === null || y === null) {
    return false
  }

  return x.name === y.name && x.url === y.url
}

/**
 * The set of changes required to reconcile a repository's on-disk remotes with
 * an edited list produced by the remotes manager UI.
 */
export interface IRemotesDiff {
  /** Remotes present in the edited list but not the original set. */
  readonly added: ReadonlyArray<IRemote>
  /** Remotes present in the original set but removed from the edited list. */
  readonly removed: ReadonlyArray<IRemote>
  /** Remotes kept (matched by name) whose URL was changed. */
  readonly changed: ReadonlyArray<IRemote>
}

/**
 * Compute the difference between the original remotes (as loaded from Git) and
 * the edited list, matching remotes by name. Renames are not supported, so a
 * changed name is treated as a removal plus an addition.
 */
export function diffRemotes(
  initial: ReadonlyArray<IRemote>,
  current: ReadonlyArray<IRemote>
): IRemotesDiff {
  const initialByName = new Map(initial.map(r => [r.name, r]))
  const currentByName = new Map(current.map(r => [r.name, r]))

  const added = current.filter(r => !initialByName.has(r.name))
  const removed = initial.filter(r => !currentByName.has(r.name))
  const changed = current.filter(r => {
    const previous = initialByName.get(r.name)
    return previous !== undefined && previous.url !== r.url
  })

  return { added, removed, changed }
}
