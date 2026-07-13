import { CommittedFileChange } from './status'

export interface IStashEntry {
  /** The fully qualified name of the entry i.e., `refs/stash@{0}` */
  readonly name: string

  /** The name of the branch at the time the entry was created. */
  readonly branchName: string

  /** The SHA of the commit object created as a result of stashing. */
  readonly stashSha: string

  /** A user-facing name recorded by Desktop Material, when one was supplied. */
  readonly displayName?: string | null

  /** The bounded ISO timestamp recorded on the stash commit, when available. */
  readonly createdAt?: string | null

  /** The list of files this stash touches */
  readonly files: StashedFileChanges

  readonly tree: string
  readonly parents: ReadonlyArray<string>
}

/** Whether file changes for a stash entry are loaded or not */
export enum StashedChangesLoadStates {
  NotLoaded = 'NotLoaded',
  Loading = 'Loading',
  Loaded = 'Loaded',
}

/**
 * The status of stashed file changes
 *
 * When the status us `Loaded` all the files associated
 * with the stash are made available.
 */
export type StashedFileChanges =
  | {
      readonly kind:
        | StashedChangesLoadStates.NotLoaded
        | StashedChangesLoadStates.Loading
    }
  | {
      readonly kind: StashedChangesLoadStates.Loaded
      readonly files: ReadonlyArray<CommittedFileChange>
    }

export type StashCallback = (stashEntry: IStashEntry) => Promise<void>

export type StashCreateScope = 'all' | 'selected'

/** Reviewed input for Desktop Material's purpose-built stash manager. */
export interface ICreateManagedStashRequest {
  readonly displayName: string
  readonly includeUntracked: boolean
  readonly scope: StashCreateScope
  readonly selectedPaths: ReadonlyArray<string>
}

/** User-reviewed metadata update for one Desktop-managed stash. */
export interface IUpdateManagedStashRequest {
  readonly branchName: string
  readonly displayName: string
}

/** Return the explicit name, falling back to the compact legacy label. */
export function stashEntryTitle(stashEntry: IStashEntry): string {
  const displayName = stashEntry.displayName?.trim()
  return displayName ? displayName : stashEntryLabel(stashEntry)
}

/** A compact, stable-enough label for a stash row in the Changes sidebar. */
export function stashEntryLabel(stashEntry: IStashEntry): string {
  const ordinalMatch = /stash@\{(\d+)\}/.exec(stashEntry.name)
  const ordinal = ordinalMatch === null ? '' : ` ${Number(ordinalMatch[1]) + 1}`
  const explicitName = stashEntry.displayName?.trim()
  const prefix = explicitName ? explicitName : `Stash${ordinal}`

  if (stashEntry.files.kind !== StashedChangesLoadStates.Loaded) {
    return `${prefix} · Loading…`
  }
  const files = stashEntry.files.files
  if (files.length === 0) {
    return `${prefix} · No changes`
  }
  const separator = __WIN32__ ? '\\' : '/'
  const name = files[0].path.split(separator).pop() ?? files[0].path
  return files.length === 1
    ? `${prefix} · ${name}`
    : `${prefix} · ${name} + ${files.length - 1} more`
}
