import { IGitHubReleaseAssetDownloadResult } from './github-release-asset-download'
import { IGitHubReleaseAsset } from './github-releases'

export const GitHubReleaseTransferMaximumRedirects = 5

interface IGitHubReleaseTransferBaseRequest {
  readonly operationId: string
  readonly endpoint: string
  readonly token: string
  readonly owner: string
  readonly repository: string
}

export interface IGitHubReleaseAssetDownloadRequest
  extends IGitHubReleaseTransferBaseRequest {
  readonly releaseId: number
  readonly asset: {
    readonly id: number
    readonly name: string
    readonly sizeInBytes: number
    readonly digest: string | null
  }
  readonly destination: string
}

/**
 * A contiguous byte range of the source file to upload as one asset. Absent for
 * a whole-file upload; present when a file larger than the per-asset cap is
 * split into parts, so part K uploads exactly `[offset, offset + length)`.
 */
export interface IGitHubReleaseAssetUploadRange {
  readonly offset: number
  readonly length: number
}

export interface IGitHubReleaseAssetUploadRequest
  extends IGitHubReleaseTransferBaseRequest {
  readonly releaseId: number
  readonly sourcePath: string
  readonly name: string
  readonly label: string | null
  readonly range?: IGitHubReleaseAssetUploadRange
}

export interface IGitHubReleaseTransferProgressEvent {
  readonly operationId: string
  readonly transferredBytes: number
  readonly totalBytes: number
  readonly direction: 'upload' | 'download'
}

export type GitHubReleaseTransferFailureReason =
  | 'canceled'
  | 'invalid-request'
  | 'network'
  | 'http'
  | 'missing-location'
  | 'unsafe-redirect'
  | 'redirect-loop'
  | 'too-many-redirects'
  | 'source'
  | 'destination'
  | 'too-large'
  | 'size-mismatch'
  | 'digest-mismatch'
  | 'missing-body'
  | 'invalid-response'

export interface IGitHubReleaseTransferFailure {
  readonly ok: false
  readonly reason: GitHubReleaseTransferFailureReason
  readonly status: number | null
}

export interface IGitHubReleaseAssetDownloadSuccess
  extends IGitHubReleaseAssetDownloadResult {
  readonly ok: true
}

export interface IGitHubReleaseAssetUploadSuccess {
  readonly ok: true
  readonly asset: IGitHubReleaseAsset
  readonly bytes: number
  readonly localDigest: string
}

export type GitHubReleaseAssetDownloadTransferResult =
  | IGitHubReleaseAssetDownloadSuccess
  | IGitHubReleaseTransferFailure

export type GitHubReleaseAssetUploadTransferResult =
  | IGitHubReleaseAssetUploadSuccess
  | IGitHubReleaseTransferFailure

export class GitHubReleaseTransferError extends Error {
  public constructor(
    public readonly reason: GitHubReleaseTransferFailureReason,
    public readonly responseStatus: number | null,
    message: string
  ) {
    super(message)
    this.name = 'GitHubReleaseTransferError'
  }
}

export function githubReleaseTransferFailureMessage(
  failure: IGitHubReleaseTransferFailure,
  direction: 'upload' | 'download'
): string {
  const action = direction === 'upload' ? 'upload' : 'download'
  switch (failure.reason) {
    case 'canceled':
      return `Release asset ${action} canceled.`
    case 'invalid-request':
      return `The release asset ${action} request was invalid.`
    case 'network':
      return `GitHub could not ${action} the release asset because of a network error.`
    case 'http':
      return `GitHub could not ${action} the release asset (HTTP ${
        failure.status ?? 'unknown'
      }).`
    case 'missing-location':
      return 'GitHub did not provide a release asset download location.'
    case 'unsafe-redirect':
      return 'GitHub provided an unsafe release asset redirect.'
    case 'redirect-loop':
      return 'GitHub returned a looping release asset redirect.'
    case 'too-many-redirects':
      return 'GitHub redirected the release asset download too many times.'
    case 'source':
      return 'The selected upload file could not be read safely.'
    case 'destination':
      return 'The release asset could not be saved at the selected destination.'
    case 'too-large':
      return `The release asset exceeds the app’s ${
        direction === 'upload' ? '2 GiB upload' : '5 GiB download'
      } safety limit.`
    case 'size-mismatch':
      return 'The release asset did not match its advertised size.'
    case 'digest-mismatch':
      return 'The release asset did not match the digest reported by GitHub.'
    case 'missing-body':
      return 'GitHub returned the release asset without content.'
    case 'invalid-response':
      return 'GitHub returned release asset data the app could not safely process.'
  }
}
