import { randomBytes } from 'crypto'
import {
  ActionsArtifactProvenanceResult,
  IActionsArtifactProvenanceCredentialRegistration,
  IActionsArtifactProvenanceVerifyRequest,
} from './actions-artifact-provenance'
import * as ipcRenderer from './ipc-renderer'

function abortError(): Error {
  const error = new Error('Artifact provenance verification canceled.')
  error.name = 'AbortError'
  return error
}

/** Register one selected GHE.com identity; the main process returns only an opaque handle. */
export function registerActionsArtifactProvenanceCredentialLease(
  registration: IActionsArtifactProvenanceCredentialRegistration
): Promise<string | null> {
  return ipcRenderer.invoke(
    'register-actions-artifact-provenance-credential-lease',
    registration
  )
}

/** Idempotently discard an unused or active opaque account handle. */
export function releaseActionsArtifactProvenanceCredentialLease(
  accountHandle: string
): void {
  ipcRenderer.send(
    'release-actions-artifact-provenance-credential-lease',
    accountHandle
  )
}

/** Invalidate only leases created before the renderer's new account generation. */
export function invalidateActionsArtifactProvenanceCredentialLeaseGeneration(
  accountsGeneration: number
): void {
  ipcRenderer.send(
    'invalidate-actions-artifact-provenance-credential-lease-generation',
    accountsGeneration
  )
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
        accountHandle: request.accountHandle,
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
