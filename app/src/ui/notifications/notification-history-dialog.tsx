import * as React from 'react'

import { IProfileHistoryPage } from '../../models/profile'
import {
  IVersionedStoreHistorySource,
  VersionedStoreHistory,
} from '../version-history'

export interface INotificationHistoryDispatcher {
  readonly getNotificationHistory: (
    skip?: number,
    limit?: number
  ) => Promise<IProfileHistoryPage>
  readonly getNotificationHistoryFiles: (
    sha: string
  ) => Promise<ReadonlyArray<string>>
  readonly getNotificationHistoryDiff: (
    sha: string,
    file?: string
  ) => Promise<string>
  readonly undoLastNotificationChange: () => Promise<void>
  readonly redoLastNotificationChange: () => Promise<void>
  readonly restoreNotificationsTo: (sha: string) => Promise<void>
}

interface INotificationHistoryDialogProps {
  readonly dispatcher: INotificationHistoryDispatcher
  readonly onDismissed: () => void
}

/**
 * Thin notification-store adapter around the shared Git-backed history manager
 * (the same component that powers the settings history side sheet).
 */
export function NotificationHistoryDialog(
  props: INotificationHistoryDialogProps
) {
  const { dispatcher } = props
  const source: IVersionedStoreHistorySource = {
    getHistory: (skip, limit) =>
      dispatcher.getNotificationHistory(skip, limit),
    getFiles: sha => dispatcher.getNotificationHistoryFiles(sha),
    getDiff: (sha, file) => dispatcher.getNotificationHistoryDiff(sha, file),
    undoLastChange: () => dispatcher.undoLastNotificationChange(),
    redoLastChange: () => dispatcher.redoLastNotificationChange(),
    restoreTo: sha => dispatcher.restoreNotificationsTo(sha),
  }

  return (
    <VersionedStoreHistory
      className="notification-history-dialog"
      title="Notification history"
      timelineLabel="Notification centre timeline"
      description="Undo, redo, or restore any point without rewriting history."
      emptyTitle="No notification history yet"
      emptyDescription="Changes to your notifications will appear here."
      source={source}
      onDismissed={props.onDismissed}
    />
  )
}
