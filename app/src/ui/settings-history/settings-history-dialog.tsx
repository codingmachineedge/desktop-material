import * as React from 'react'

import { IProfileHistoryPage } from '../../models/profile'
import { SettingsHistoryScope } from '../../models/popup'
import {
  IVersionedStoreHistorySource,
  VersionedStoreHistory,
} from '../version-history'

export interface ISettingsHistoryDispatcher {
  readonly getSettingsHistory: (
    skip?: number,
    limit?: number,
    scope?: SettingsHistoryScope
  ) => Promise<IProfileHistoryPage>
  readonly getSettingsHistoryFiles: (
    sha: string
  ) => Promise<ReadonlyArray<string>>
  readonly getSettingsHistoryDiff: (
    sha: string,
    file?: string,
    scope?: SettingsHistoryScope
  ) => Promise<string>
  readonly undoLastSettingsChange: () => Promise<void>
  readonly redoLastSettingsChange: () => Promise<void>
  readonly restoreSettingsTo: (sha: string) => Promise<void>
}

interface ISettingsHistoryDialogProps {
  readonly dispatcher: ISettingsHistoryDispatcher
  /**
   * When present, restrict the timeline to one tab and render it read-only,
   * since undo/redo/restore act on the whole profile. Absent means the full
   * profile history with those mutations enabled.
   */
  readonly scope?: SettingsHistoryScope
  readonly onDismissed: () => void
}

/** Tab state lives in tabs.json, so a scoped diff only inspects that file. */
const ScopedHistoryFile = 'tabs.json'

/** Thin profile-store adapter around the shared Git-backed history manager. */
export function SettingsHistoryDialog(props: ISettingsHistoryDialogProps) {
  const { dispatcher, scope } = props

  if (scope !== undefined) {
    const source: IVersionedStoreHistorySource = {
      getHistory: (skip, limit) =>
        dispatcher.getSettingsHistory(skip, limit, scope),
      // Only surface the tab state file; the scoped timeline is about tabs.
      getFiles: sha =>
        dispatcher
          .getSettingsHistoryFiles(sha)
          .then(files => files.filter(file => file === ScopedHistoryFile)),
      getDiff: (sha, file) =>
        dispatcher.getSettingsHistoryDiff(sha, file, scope),
    }

    return (
      <VersionedStoreHistory
        className="settings-history-dialog"
        title={`Appearance history — ${scope.label}`}
        timelineLabel="Tab appearance timeline"
        description="Inspect this tab's appearance and session history. Undo, redo, and restore apply to the whole profile and stay on the full history view."
        emptyTitle="No history for this tab yet"
        emptyDescription="Opening, closing, or reordering this tab will appear here."
        source={source}
        readOnly={true}
        onDismissed={props.onDismissed}
      />
    )
  }

  const source: IVersionedStoreHistorySource = {
    getHistory: (skip, limit) => dispatcher.getSettingsHistory(skip, limit),
    getFiles: sha => dispatcher.getSettingsHistoryFiles(sha),
    getDiff: (sha, file) => dispatcher.getSettingsHistoryDiff(sha, file),
    undoLastChange: () => dispatcher.undoLastSettingsChange(),
    redoLastChange: () => dispatcher.redoLastSettingsChange(),
    restoreTo: sha => dispatcher.restoreSettingsTo(sha),
  }

  return (
    <VersionedStoreHistory
      className="settings-history-dialog"
      title="Settings history"
      timelineLabel="Profile settings timeline"
      description="Undo, redo, or restore any point without rewriting history."
      emptyTitle="No settings history yet"
      emptyDescription="Your first profile change will appear here."
      source={source}
      onDismissed={props.onDismissed}
    />
  )
}
