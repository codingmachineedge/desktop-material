export const ActionsArtifactSubjectMaximumEntries = 2_000
export const ActionsArtifactSubjectMaximumAggregateBytes =
  8 * 1024 * 1024 * 1024
export const ActionsArtifactSubjectMaximumBytes = 1024 * 1024 * 1024
export const ActionsArtifactSubjectMaximumCompressionRatio = 200
export const ActionsArtifactSubjectMaximumPathBytes = 4_096
export const ActionsArtifactSubjectMaximumSegmentBytes = 255

export interface IActionsArtifactSubjectInspectRequest {
  readonly operationId: string
  readonly downloadId: string
}

export interface IActionsArtifactSubjectPrepareRequest
  extends IActionsArtifactSubjectInspectRequest {
  readonly inventoryId: string
  readonly entryId: string
}

export interface IActionsArtifactSubjectEntry {
  readonly entryId: string
  readonly path: string
  readonly compressedBytes: number
  readonly bytes: number
}

export interface IActionsArtifactSubjectInventorySuccess {
  readonly ok: true
  readonly inventoryId: string
  readonly archiveDigest: string
  readonly archiveBytes: number
  readonly entries: ReadonlyArray<IActionsArtifactSubjectEntry>
}

export interface IActionsArtifactSubjectPrepareSuccess {
  readonly ok: true
  readonly entryId: string
  readonly path: string
  readonly bytes: number
  readonly digest: string
  readonly archiveDigest: string
}

export type ActionsArtifactSubjectFailureReason =
  | 'canceled'
  | 'invalid-request'
  | 'not-found'
  | 'changed'
  | 'invalid-archive'
  | 'unsafe-entry'
  | 'too-large'
  | 'io'

export interface IActionsArtifactSubjectFailure {
  readonly ok: false
  readonly reason: ActionsArtifactSubjectFailureReason
}

export type ActionsArtifactSubjectInventoryResult =
  | IActionsArtifactSubjectInventorySuccess
  | IActionsArtifactSubjectFailure

export type ActionsArtifactSubjectPrepareResult =
  | IActionsArtifactSubjectPrepareSuccess
  | IActionsArtifactSubjectFailure

export class ActionsArtifactSubjectError extends Error {
  public constructor(
    public readonly reason: ActionsArtifactSubjectFailureReason,
    message: string
  ) {
    super(message)
    this.name = 'ActionsArtifactSubjectError'
  }
}
