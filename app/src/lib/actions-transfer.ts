import {
  IActionsArtifactDownloadProgress,
  IActionsArtifactDownloadResult,
} from './actions-artifact-download'

export const ActionsTransferMaximumRedirects = 5
export const ActionsJobLogMaximumBytes = 5 * 1024 * 1024
export const ActionsJobLogTruncationMarker =
  '\n\n--- Log truncated after 5 MB by Desktop Material ---\n'

interface IActionsTransferBaseRequest {
  readonly operationId: string
  readonly endpoint: string
  readonly token: string
  readonly owner: string
  readonly repository: string
}

export interface IActionsArtifactTransferRequest
  extends IActionsTransferBaseRequest {
  readonly artifact: {
    readonly id: number
    readonly sizeInBytes: number
    readonly expired: boolean
    readonly digest: string | null
  }
  readonly destination: string
}

export interface IActionsJobLogTransferRequest
  extends IActionsTransferBaseRequest {
  readonly jobId: number
}

export interface IActionsTransferProgressEvent
  extends IActionsArtifactDownloadProgress {
  readonly operationId: string
}

export type ActionsTransferFailureReason =
  | 'canceled'
  | 'invalid-request'
  | 'network'
  | 'http'
  | 'missing-location'
  | 'unsafe-redirect'
  | 'redirect-loop'
  | 'too-many-redirects'
  | 'expired'
  | 'destination'
  | 'too-large'
  | 'size-mismatch'
  | 'digest-mismatch'
  | 'missing-body'

export interface IActionsTransferFailure {
  readonly ok: false
  readonly reason: ActionsTransferFailureReason
  readonly status: number | null
}

export interface IActionsArtifactTransferSuccess
  extends IActionsArtifactDownloadResult {
  readonly ok: true
}

export type ActionsArtifactTransferResult =
  | IActionsArtifactTransferSuccess
  | IActionsTransferFailure

export interface IActionsJobLogTransferSuccess {
  readonly ok: true
  readonly log: string
  readonly truncated: boolean
}

export type ActionsJobLogTransferResult =
  | IActionsJobLogTransferSuccess
  | IActionsTransferFailure

export class ActionsTransferError extends Error {
  public constructor(
    public readonly reason: ActionsTransferFailureReason,
    public readonly responseStatus: number | null,
    message: string
  ) {
    super(message)
    this.name = 'ActionsTransferError'
  }
}

export function actionsTransferFailureMessage(
  failure: IActionsTransferFailure,
  subject: 'artifact' | 'job logs'
): string {
  switch (failure.reason) {
    case 'canceled':
      return `${
        subject === 'artifact' ? 'Artifact download' : 'Job log request'
      } canceled.`
    case 'invalid-request':
      return `The ${subject} request was invalid.`
    case 'network':
      return `GitHub could not transfer the ${subject} because of a network error.`
    case 'http':
      return `GitHub could not transfer the ${subject} (HTTP ${
        failure.status ?? 'unknown'
      }).`
    case 'missing-location':
      return `GitHub did not provide a ${subject} download location.`
    case 'unsafe-redirect':
      return `GitHub provided an unsafe ${subject} download redirect.`
    case 'redirect-loop':
      return `GitHub returned a looping ${subject} download redirect.`
    case 'too-many-redirects':
      return `GitHub redirected the ${subject} download too many times.`
    case 'expired':
      return subject === 'artifact'
        ? 'This artifact has expired and can no longer be downloaded.'
        : 'These workflow job logs have expired and can no longer be loaded.'
    case 'destination':
      return 'The artifact archive could not be published at the selected destination.'
    case 'too-large':
      return 'The artifact archive exceeds the app’s download safety limit.'
    case 'size-mismatch':
      return 'The artifact archive did not match its advertised size.'
    case 'digest-mismatch':
      return 'The artifact archive did not match the digest reported by GitHub.'
    case 'missing-body':
      return `GitHub returned the ${subject} without content.`
  }
}
