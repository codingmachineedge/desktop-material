import { randomBytes } from 'crypto'
import {
  ActionsArtifactProvenanceResult,
  IActionsArtifactProvenanceVerifyRequest,
} from './actions-artifact-provenance'
import * as ipcRenderer from './ipc-renderer'

function abortError(): Error {
  const error = new Error('Artifact provenance verification canceled.')
  error.name = 'AbortError'
  return error
}

/** Invoke the fixed verifier using only opaque handles and normalized data. */
export async function verifyActionsArtifactProvenanceThroughMainProcess(
  request: Omit<IActionsArtifactProvenanceVerifyRequest, 'operationId'>,
  signal: AbortSignal
): Promise<ActionsArtifactProvenanceResult> {
  if (signal.aborted) {
    throw abortError()
  }
  const operationId = randomBytes(16).toString('hex')
  const cancel = () =>
    ipcRenderer.send('cancel-actions-artifact-provenance', operationId)
  signal.addEventListener('abort', cancel, { once: true })
  try {
    // Close the post-registration race before any main-process work starts.
    if (signal.aborted) {
      cancel()
      throw abortError()
    }
    const result = await ipcRenderer.invoke(
      'verify-actions-artifact-provenance',
      {
        operationId,
        downloadId: request.downloadId,
        inventoryId: request.inventoryId,
        entryId: request.entryId,
        expectedSubjectDigest: request.expectedSubjectDigest,
        bundles: request.bundles,
        policy: request.policy,
      }
    )
    if (signal.aborted) {
      throw abortError()
    }
    return result
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}
