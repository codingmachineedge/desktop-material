import * as React from 'react'

import { IProfileHistoryPage } from '../../models/profile'
import {
  IVersionedStoreHistorySource,
  VersionedStoreHistory,
} from '../version-history'

export interface ILogHistoryDispatcher {
  readonly getLogHistory: (
    skip?: number,
    limit?: number
  ) => Promise<IProfileHistoryPage>
  readonly getLogHistoryFiles: (sha: string) => Promise<ReadonlyArray<string>>
  readonly getLogHistoryDiff: (sha: string, file?: string) => Promise<string>
  readonly undoLastLogChange: () => Promise<void>
  readonly redoLastLogChange: () => Promise<void>
  readonly restoreLogsTo: (sha: string) => Promise<void>
}

interface ILogHistoryDialogProps {
  readonly dispatcher: ILogHistoryDispatcher
  readonly onDismissed: () => void
}

/**
 * Thin log-store adapter around the shared Git-backed history manager (the
 * same component that powers the settings and notification history sheets).
 */
export function LogHistoryDialog(props: ILogHistoryDialogProps) {
  const { dispatcher } = props
  const source: IVersionedStoreHistorySource = {
    getHistory: (skip, limit) => dispatcher.getLogHistory(skip, limit),
    getFiles: sha => dispatcher.getLogHistoryFiles(sha),
    getDiff: (sha, file) => dispatcher.getLogHistoryDiff(sha, file),
    undoLastChange: () => dispatcher.undoLastLogChange(),
    redoLastChange: () => dispatcher.redoLastLogChange(),
    restoreTo: sha => dispatcher.restoreLogsTo(sha),
  }

  return (
    <VersionedStoreHistory
      className="log-history-dialog"
      title="Log history"
      timelineLabel="Logs"
      description="Undo, redo, or restore any point without rewriting history."
      emptyTitle="No log history yet"
      emptyDescription="Captured log activity will appear here."
      source={source}
      onDismissed={props.onDismissed}
    />
  )
}
