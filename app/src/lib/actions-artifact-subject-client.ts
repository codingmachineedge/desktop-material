import { randomBytes } from 'crypto'
import {
  ActionsArtifactSubjectInventoryResult,
  ActionsArtifactSubjectPrepareResult,
} from './actions-artifact-subjects'
import * as ipcRenderer from './ipc-renderer'

function operationId(): string {
  return randomBytes(16).toString('hex')
}

function abortError(): Error {
  const error = new Error('Artifact subject operation canceled.')
  error.name = 'AbortError'
  return error
}

async function invokeSubjectOperation<T>(
  signal: AbortSignal,
  invoke: (operationId: string) => Promise<T>
): Promise<T> {
  if (signal.aborted) {
    throw abortError()
  }
  const id = operationId()
  const cancel = () =>
    ipcRenderer.send('cancel-actions-artifact-subject-operation', id)
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) {
      cancel()
      throw abortError()
    }
    const result = await invoke(id)
    if (signal.aborted) {
      throw abortError()
    }
    return result
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

export async function inspectActionsArtifactSubjectsThroughMainProcess(
  downloadId: string,
  signal: AbortSignal
): Promise<ActionsArtifactSubjectInventoryResult> {
  return await invokeSubjectOperation(signal, operationId =>
    ipcRenderer.invoke('inspect-actions-artifact-subjects', {
      operationId,
      downloadId,
    })
  )
}

export async function prepareActionsArtifactSubjectThroughMainProcess(
  downloadId: string,
  inventoryId: string,
  entryId: string,
  signal: AbortSignal
): Promise<ActionsArtifactSubjectPrepareResult> {
  return await invokeSubjectOperation(signal, operationId =>
    ipcRenderer.invoke('prepare-actions-artifact-subject', {
      operationId,
      downloadId,
      inventoryId,
      entryId,
    })
  )
}

export function releaseActionsArtifactDownloadThroughMainProcess(
  downloadId: string
): void {
  ipcRenderer.send('release-actions-artifact-download', downloadId)
}
