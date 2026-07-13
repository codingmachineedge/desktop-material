import { randomBytes } from 'crypto'
import { Account } from '../models/account'
import { GitHubRepository } from '../models/github-repository'
import { IActionsArtifact } from './actions-artifacts'
import {
  IActionsArtifactDownloadProgress,
  IActionsArtifactDownloadResult,
} from './actions-artifact-download'
import {
  actionsTransferFailureMessage,
  ActionsTransferError,
  IActionsArtifactTransferRequest,
  IActionsJobLogTransferRequest,
  IActionsTransferProgressEvent,
} from './actions-transfer'
import * as ipcRenderer from './ipc-renderer'

function operationId(): string {
  return randomBytes(16).toString('hex')
}

function abortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw abortError('Actions transfer canceled.')
  }
}

function transferError(
  failure: {
    readonly reason: ConstructorParameters<typeof ActionsTransferError>[0]
    readonly status: number | null
  },
  subject: 'artifact' | 'job logs'
): ActionsTransferError {
  return new ActionsTransferError(
    failure.reason,
    failure.status,
    actionsTransferFailureMessage({ ok: false, ...failure }, subject)
  )
}

export async function downloadActionsArtifactThroughMainProcess(
  account: Account,
  repository: GitHubRepository,
  artifact: IActionsArtifact,
  destination: string,
  signal: AbortSignal,
  onProgress?: (progress: IActionsArtifactDownloadProgress) => void
): Promise<IActionsArtifactDownloadResult> {
  throwIfAborted(signal)
  const id = operationId()
  const request: IActionsArtifactTransferRequest = {
    operationId: id,
    endpoint: account.endpoint,
    token: account.token,
    owner: repository.owner.login,
    repository: repository.name,
    artifact: {
      id: artifact.id,
      sizeInBytes: artifact.sizeInBytes,
      expired: artifact.expired,
      digest: artifact.digest,
    },
    destination,
  }
  const progressListener = (
    _event: unknown,
    progress: IActionsTransferProgressEvent
  ) => {
    if (progress.operationId === id) {
      onProgress?.(progress)
    }
  }
  const cancel = () => ipcRenderer.send('cancel-actions-transfer', id)
  ipcRenderer.on('actions-transfer-progress', progressListener)
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) {
      cancel()
      throw abortError('Artifact download canceled.')
    }
    const result = await ipcRenderer.invoke(
      'download-actions-artifact',
      request
    )
    if (!result.ok) {
      if (result.reason === 'canceled') {
        throw abortError('Artifact download canceled.')
      }
      throw transferError(result, 'artifact')
    }
    return {
      path: result.path,
      bytes: result.bytes,
      localDigest: result.localDigest,
      matchesGitHubDigest: result.matchesGitHubDigest,
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    ipcRenderer.removeListener('actions-transfer-progress', progressListener)
  }
}

export async function fetchActionsJobLogThroughMainProcess(
  account: Account,
  repository: GitHubRepository,
  jobId: number,
  signal?: AbortSignal
): Promise<string> {
  throwIfAborted(signal)
  const id = operationId()
  const request: IActionsJobLogTransferRequest = {
    operationId: id,
    endpoint: account.endpoint,
    token: account.token,
    owner: repository.owner.login,
    repository: repository.name,
    jobId,
  }
  const cancel = () => ipcRenderer.send('cancel-actions-transfer', id)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    if (signal?.aborted) {
      cancel()
      throw abortError('Job log request canceled.')
    }
    const result = await ipcRenderer.invoke('fetch-actions-job-log', request)
    if (!result.ok) {
      if (result.reason === 'canceled') {
        throw abortError('Job log request canceled.')
      }
      throw transferError(result, 'job logs')
    }
    return result.log
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}
