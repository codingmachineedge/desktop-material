import { randomBytes } from 'crypto'
import { Account } from '../models/account'
import { GitHubRepository } from '../models/github-repository'
import { IGitHubReleaseAsset } from './github-releases'
import {
  githubReleaseTransferFailureMessage,
  GitHubReleaseTransferError,
  IGitHubReleaseAssetDownloadRequest,
  IGitHubReleaseAssetUploadRange,
  IGitHubReleaseAssetUploadRequest,
  IGitHubReleaseTransferProgressEvent,
} from './github-release-transfer'
import * as ipcRenderer from './ipc-renderer'

function operationId(): string {
  return randomBytes(16).toString('hex')
}

function abortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw abortError('Release asset transfer canceled.')
  }
}

function transferError(
  failure: {
    readonly reason: ConstructorParameters<typeof GitHubReleaseTransferError>[0]
    readonly status: number | null
  },
  direction: 'upload' | 'download'
): GitHubReleaseTransferError {
  return new GitHubReleaseTransferError(
    failure.reason,
    failure.status,
    githubReleaseTransferFailureMessage({ ok: false, ...failure }, direction)
  )
}

async function invokeTransfer<T extends { readonly ok: boolean }>(
  channel: 'download-release-asset' | 'upload-release-asset',
  request:
    | IGitHubReleaseAssetDownloadRequest
    | IGitHubReleaseAssetUploadRequest,
  signal: AbortSignal,
  direction: 'upload' | 'download',
  onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
): Promise<T> {
  throwIfAborted(signal)
  const listener = (
    _event: unknown,
    progress: IGitHubReleaseTransferProgressEvent
  ) => {
    if (progress.operationId === request.operationId) {
      onProgress?.(progress)
    }
  }
  const cancel = () =>
    ipcRenderer.send('cancel-github-release-transfer', request.operationId)
  ipcRenderer.on('github-release-transfer-progress', listener)
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) {
      cancel()
      throw abortError('Release asset transfer canceled.')
    }
    const result =
      channel === 'download-release-asset'
        ? await ipcRenderer.invoke(
            channel,
            request as IGitHubReleaseAssetDownloadRequest
          )
        : await ipcRenderer.invoke(
            channel,
            request as IGitHubReleaseAssetUploadRequest
          )
    if (!result.ok) {
      if (result.reason === 'canceled') {
        throw abortError('Release asset transfer canceled.')
      }
      throw transferError(result, direction)
    }
    return result as unknown as T
  } finally {
    signal.removeEventListener('abort', cancel)
    ipcRenderer.removeListener('github-release-transfer-progress', listener)
  }
}

export async function downloadGitHubReleaseAssetThroughMainProcess(
  account: Account,
  repository: GitHubRepository,
  releaseId: number,
  asset: IGitHubReleaseAsset,
  destination: string,
  signal: AbortSignal,
  onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void
) {
  const request: IGitHubReleaseAssetDownloadRequest = {
    operationId: operationId(),
    endpoint: account.endpoint,
    token: account.token,
    owner: repository.owner.login,
    repository: repository.name,
    releaseId,
    asset: {
      id: asset.id,
      name: asset.name,
      state: asset.state,
      sizeInBytes: asset.sizeInBytes,
      digest: asset.digest,
    },
    destination,
  }
  return await invokeTransfer<{
    readonly ok: true
    readonly path: string
    readonly bytes: number
    readonly localDigest: string
    readonly matchesGitHubDigest: boolean | null
  }>('download-release-asset', request, signal, 'download', onProgress)
}

export async function uploadGitHubReleaseAssetThroughMainProcess(
  account: Account,
  repository: GitHubRepository,
  releaseId: number,
  sourcePath: string,
  name: string,
  label: string | null,
  signal: AbortSignal,
  onProgress?: (progress: IGitHubReleaseTransferProgressEvent) => void,
  range?: IGitHubReleaseAssetUploadRange,
  expectedDigest?: string
) {
  const request: IGitHubReleaseAssetUploadRequest = {
    operationId: operationId(),
    endpoint: account.endpoint,
    token: account.token,
    owner: repository.owner.login,
    repository: repository.name,
    releaseId,
    sourcePath,
    name,
    label,
    ...(range !== undefined ? { range } : {}),
    ...(expectedDigest !== undefined ? { expectedDigest } : {}),
  }
  return await invokeTransfer<{
    readonly ok: true
    readonly asset: IGitHubReleaseAsset
    readonly bytes: number
    readonly localDigest: string
  }>('upload-release-asset', request, signal, 'upload', onProgress)
}
