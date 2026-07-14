import assert from 'node:assert'
import { EventEmitter } from 'events'
import { describe, it } from 'node:test'
import {
  getCompletedActionsArtifactDownload,
  IActionsArtifactDownloadSender,
  onCompletedActionsArtifactDownloadReleased,
  releaseAllCompletedActionsArtifactDownloads,
  releaseCompletedActionsArtifactDownload,
  retainCompletedActionsArtifactDownload,
} from '../../../src/main-process/actions-artifact-download-registry'

class TestSender
  extends EventEmitter
  implements IActionsArtifactDownloadSender
{
  private destroyed = false

  public constructor(public readonly id: number) {
    super()
  }

  public isDestroyed(): boolean {
    return this.destroyed
  }

  public navigate(): void {
    this.emit('did-start-navigation')
  }

  public destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

function retain(sender: TestSender, artifactId: number): string {
  return retainCompletedActionsArtifactDownload(sender, {
    endpoint: 'https://api.github.com/',
    path: `C:\\Downloads\\artifact-${artifactId}.zip`,
    bytes: artifactId,
    archiveDigest: `sha256:${artifactId.toString(16).padStart(64, '0')}`,
    owner: 'owner',
    repository: 'repository',
    artifactId,
    workflowRun: {
      id: 55,
      runAttempt: 1,
      headBranch: 'main',
      headSha: 'a'.repeat(40),
    },
  })
}

describe('completed Actions artifact download registry', () => {
  it('returns opaque records only to their sender and releases explicitly', () => {
    releaseAllCompletedActionsArtifactDownloads()
    const owner = new TestSender(501)
    const other = new TestSender(502)
    const releases = new Array<{ downloadId: string; senderId: number }>()
    const unsubscribe = onCompletedActionsArtifactDownloadReleased(
      (downloadId, senderId) => releases.push({ downloadId, senderId })
    )
    try {
      const downloadId = retain(owner, 19)
      assert.match(downloadId, /^[a-f0-9]{32}$/)
      assert.equal(
        getCompletedActionsArtifactDownload(other.id, downloadId),
        null
      )
      assert.equal(
        releaseCompletedActionsArtifactDownload(other.id, downloadId),
        false
      )
      const record = getCompletedActionsArtifactDownload(owner.id, downloadId)
      assert.deepEqual(record, {
        downloadId,
        senderId: owner.id,
        path: 'C:\\Downloads\\artifact-19.zip',
        bytes: 19,
        archiveDigest: `sha256:${'13'.padStart(64, '0')}`,
        owner: 'owner',
        repository: 'repository',
        artifactId: 19,
        workflowRun: {
          id: 55,
          headBranch: 'main',
          headSha: 'a'.repeat(40),
        },
      })
      assert.equal(
        releaseCompletedActionsArtifactDownload(owner.id, downloadId),
        true
      )
      assert.equal(
        getCompletedActionsArtifactDownload(owner.id, downloadId),
        null
      )
      assert.deepEqual(releases, [{ downloadId, senderId: owner.id }])
    } finally {
      unsubscribe()
      releaseAllCompletedActionsArtifactDownloads()
    }
  })

  it('releases every sender record on navigation and destruction', () => {
    releaseAllCompletedActionsArtifactDownloads()
    const navigating = new TestSender(503)
    const destroyed = new TestSender(504)
    const first = retain(navigating, 21)
    const second = retain(navigating, 22)
    const third = retain(destroyed, 23)

    navigating.navigate()
    assert.equal(
      getCompletedActionsArtifactDownload(navigating.id, first),
      null
    )
    assert.equal(
      getCompletedActionsArtifactDownload(navigating.id, second),
      null
    )
    assert.notEqual(
      getCompletedActionsArtifactDownload(destroyed.id, third),
      null
    )

    destroyed.destroy()
    assert.equal(getCompletedActionsArtifactDownload(destroyed.id, third), null)
    releaseAllCompletedActionsArtifactDownloads()
  })
})
