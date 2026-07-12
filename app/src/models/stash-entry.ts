import { CommittedFileChange } from './status'

export interface IStashEntry {
  /** The fully qualified name of the entry i.e., `refs/stash@{0}` */
  readonly name: string

  /** The name of the branch at the time the entry was created. */
  readonly branchName: string

  /** The SHA of the commit object created as a result of stashing. */
  readonly stashSha: string

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

/** A compact, stable-enough label for a stash row in the Changes sidebar. */
export function stashEntryLabel(stashEntry: IStashEntry): string {
  const ordinalMatch = /stash@\{(\d+)\}/.exec(stashEntry.name)
  const ordinal = ordinalMatch === null ? '' : ` ${Number(ordinalMatch[1]) + 1}`
  const prefix = `Stash${ordinal}`

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
