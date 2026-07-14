import { randomBytes } from 'crypto'
import { IActionsArtifactWorkflowRun } from '../lib/actions-artifacts'

export interface IActionsArtifactDownloadSender {
  readonly id: number
  on(event: 'did-start-navigation', listener: () => void): unknown
  once(event: 'destroyed', listener: () => void): unknown
  removeListener(
    event: 'did-start-navigation' | 'destroyed',
    listener: () => void
  ): unknown
  isDestroyed(): boolean
}

export interface ICompletedActionsArtifactDownload {
  readonly downloadId: string
  readonly senderId: number
  /** Canonical API endpoint retained only in the main process for provenance binding. */
  readonly endpoint: string
  readonly path: string
  readonly bytes: number
  readonly archiveDigest: string
  readonly owner: string
  readonly repository: string
  readonly artifactId: number
  readonly workflowRun: IActionsArtifactWorkflowRun | null
}

interface ISenderLifecycle {
  readonly sender: IActionsArtifactDownloadSender
  readonly downloads: Set<string>
  readonly release: () => void
}

const opaqueIdPattern = /^[a-f0-9]{32}$/
const downloads = new Map<string, ICompletedActionsArtifactDownload>()
const senders = new Map<number, ISenderLifecycle>()
const releaseListeners = new Set<
  (downloadId: string, senderId: number) => void
>()

function opaqueId(): string {
  let value = ''
  do {
    value = randomBytes(16).toString('hex')
  } while (downloads.has(value))
  return value
}

function lifecycle(sender: IActionsArtifactDownloadSender): ISenderLifecycle {
  const existing = senders.get(sender.id)
  if (existing !== undefined) {
    return existing
  }
  const release = () => releaseActionsArtifactDownloadsForSender(sender.id)
  const created = { sender, downloads: new Set<string>(), release }
  senders.set(sender.id, created)
  sender.on('did-start-navigation', release)
  sender.once('destroyed', release)
  return created
}

function detachSender(value: ISenderLifecycle): void {
  value.sender.removeListener('did-start-navigation', value.release)
  if (!value.sender.isDestroyed()) {
    value.sender.removeListener('destroyed', value.release)
  }
  senders.delete(value.sender.id)
}

function notifyRelease(downloadId: string, senderId: number): void {
  for (const listener of releaseListeners) {
    listener(downloadId, senderId)
  }
}

export function retainCompletedActionsArtifactDownload(
  sender: IActionsArtifactDownloadSender,
  value: Omit<ICompletedActionsArtifactDownload, 'downloadId' | 'senderId'>
): string {
  if (sender.isDestroyed()) {
    throw new Error('The artifact download owner is no longer available.')
  }
  const downloadId = opaqueId()
  const completed = { ...value, downloadId, senderId: sender.id }
  downloads.set(downloadId, completed)
  lifecycle(sender).downloads.add(downloadId)
  if (sender.isDestroyed()) {
    releaseCompletedActionsArtifactDownload(sender.id, downloadId)
    throw new Error('The artifact download owner is no longer available.')
  }
  return downloadId
}

export function getCompletedActionsArtifactDownload(
  senderId: number,
  downloadId: unknown
): ICompletedActionsArtifactDownload | null {
  if (typeof downloadId !== 'string' || !opaqueIdPattern.test(downloadId)) {
    return null
  }
  const value = downloads.get(downloadId)
  return value?.senderId === senderId ? value : null
}

export function releaseCompletedActionsArtifactDownload(
  senderId: number,
  downloadId: unknown
): boolean {
  const value = getCompletedActionsArtifactDownload(senderId, downloadId)
  if (value === null) {
    return false
  }
  downloads.delete(value.downloadId)
  const owner = senders.get(senderId)
  owner?.downloads.delete(value.downloadId)
  notifyRelease(value.downloadId, senderId)
  if (owner !== undefined && owner.downloads.size === 0) {
    detachSender(owner)
  }
  return true
}

export function releaseActionsArtifactDownloadsForSender(
  senderId: number
): void {
  const owner = senders.get(senderId)
  if (owner === undefined) {
    return
  }
  for (const downloadId of owner.downloads) {
    downloads.delete(downloadId)
    notifyRelease(downloadId, senderId)
  }
  owner.downloads.clear()
  detachSender(owner)
}

export function releaseAllCompletedActionsArtifactDownloads(): void {
  for (const senderId of [...senders.keys()]) {
    releaseActionsArtifactDownloadsForSender(senderId)
  }
}

export function onCompletedActionsArtifactDownloadReleased(
  listener: (downloadId: string, senderId: number) => void
): () => void {
  releaseListeners.add(listener)
  return () => releaseListeners.delete(listener)
}
