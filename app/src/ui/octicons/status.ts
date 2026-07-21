import {
  AppFileStatusKind,
  AppFileStatus,
  isConflictWithMarkers,
} from '../../models/status'
import * as octicons from './octicons.generated'
import { OcticonSymbol } from '../octicons'
import { assertNever } from '../../lib/fatal-error'
import { MaterialSymbolName } from '../lib/material-symbol'

/**
 * Converts a given `AppFileStatusKind` value to an Octicon symbol
 * presented to users when displaying the file path.
 *
 * Used in file lists.
 */
export function iconForStatus(status: AppFileStatus): OcticonSymbol {
  switch (status.kind) {
    case AppFileStatusKind.New:
    case AppFileStatusKind.Untracked:
      return octicons.diffAdded
    case AppFileStatusKind.Modified:
      return octicons.diffModified
    case AppFileStatusKind.Deleted:
      return octicons.diffRemoved
    case AppFileStatusKind.Renamed:
      return octicons.diffRenamed
    case AppFileStatusKind.Conflicted:
      if (isConflictWithMarkers(status)) {
        const conflictsCount = status.conflictMarkerCount
        return conflictsCount > 0 ? octicons.alert : octicons.check
      }
      return octicons.alert
    case AppFileStatusKind.Copied:
      return octicons.diffAdded
    default:
      return assertNever(status, `Unknown file status ${status}`)
  }
}

/**
 * The Material Symbols Rounded ligature presented for a given
 * `AppFileStatusKind` inside the tonal status chip used by the Changes and
 * History file lists. Mirrors the prototype's `statusMeta` (A→add, M→edit,
 * D→remove) while keeping the octicon-based {@link iconForStatus} for surfaces
 * that still render an `<Octicon>` (e.g. the diff header).
 */
export function materialSymbolForStatus(
  status: AppFileStatus
): MaterialSymbolName {
  switch (status.kind) {
    case AppFileStatusKind.New:
    case AppFileStatusKind.Untracked:
    case AppFileStatusKind.Copied:
      return 'add'
    case AppFileStatusKind.Modified:
    case AppFileStatusKind.Renamed:
      return 'edit'
    case AppFileStatusKind.Deleted:
      return 'remove'
    case AppFileStatusKind.Conflicted:
      if (isConflictWithMarkers(status)) {
        return status.conflictMarkerCount > 0 ? 'warning' : 'check'
      }
      return 'warning'
    default:
      return assertNever(status, `Unknown file status ${status}`)
  }
}
