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

/** Whether one remote inherits, enables, or disables fetch pruning. */
export type RemotePruneSetting = 'inherit' | 'enabled' | 'disabled'

/**
 * The bounded, display-safe configuration exposed by Remote Manager.
 * Credential-bearing HTTP userinfo is removed before these values reach the
 * renderer. The matching `*UrlHasCredentials` flag lets the UI explain that
 * an unchanged, masked value will be preserved on disk.
 */
export interface IRemoteConfiguration {
  readonly name: string
  readonly fetchUrl: string
  readonly fetchUrlHasCredentials: boolean
  readonly pushUrl: string | null
  readonly pushUrlHasCredentials: boolean
  readonly prune: RemotePruneSetting
  readonly defaultBranch: string | null
}

/** An exact, opaque snapshot used to reject stale Remote Manager reviews. */
export interface IRemoteManagementSnapshot {
  readonly token: string
  readonly remotes: ReadonlyArray<IRemoteConfiguration>
}

/** One editable row. `originalName` remains stable while the row is renamed. */
export interface IRemoteDraft extends IRemoteConfiguration {
  readonly originalName: string | null
}

/** One final desired remote and only the fields approved for mutation. */
export interface IRemoteManagementUpdate {
  readonly originalName: string | null
  readonly name: string
  readonly fetchUrl?: string
  readonly pushUrl?: string | null
  readonly prune?: RemotePruneSetting
  readonly defaultBranch?: string | null
}

/** A URL-free description safe to render in the confirmation surface. */
export interface IRemoteManagementReviewItem {
  readonly remoteName: string
  readonly description: string
  readonly destructive: boolean
}

/**
 * The immutable plan confirmed by the user. URLs may be present only when the
 * user explicitly supplied a replacement; reviews and errors never render
 * them.
 */
export interface IRemoteManagementPlan {
  readonly expectedSnapshotToken: string
  readonly removed: ReadonlyArray<string>
  readonly updates: ReadonlyArray<IRemoteManagementUpdate>
  readonly review: ReadonlyArray<IRemoteManagementReviewItem>
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
