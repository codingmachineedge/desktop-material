import assert from 'node:assert'
import { describe, it, mock } from 'node:test'
import { Account } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { IActionsArtifact } from '../../src/lib/actions-artifacts'

let invokes = 0
const invocationPayloads = new Array<unknown>()
const sends = new Array<{ channel: string; payload: unknown }>()
let onInvoke: (channel: string, payload: unknown) => void = () => undefined

mock.module('../../src/lib/ipc-renderer', {
  namedExports: {
    invoke: async (channel: string, payload: unknown) => {
      invokes++
      invocationPayloads.push(payload)
      onInvoke(channel, payload)
      if (channel === 'fetch-actions-job-log') {
        return { ok: true, log: 'verified log', truncated: false }
      }
      if (channel === 'inspect-actions-artifact-subjects') {
        return {
          ok: true,
          inventoryId: 'b'.repeat(32),
          archiveDigest: `sha256:${'a'.repeat(64)}`,
          archiveBytes: 4,
          entries: [],
        }
      }
      if (channel === 'prepare-actions-artifact-subject') {
        return {
          ok: true,
          entryId: 'c'.repeat(32),
          path: 'subject.txt',
          bytes: 4,
          digest: `sha256:${'b'.repeat(64)}`,
          archiveDigest: `sha256:${'a'.repeat(64)}`,
        }
      }
      return {
        ok: true,
        downloadId: 'd'.repeat(32),
        path: 'C:\\Downloads\\artifact.zip',
        bytes: 4,
        localDigest: `sha256:${'a'.repeat(64)}`,
        matchesGitHubDigest: true,
      }
    },
    send: (channel: string, payload: unknown) =>
      sends.push({ channel, payload }),
    on: () => undefined,
    removeListener: () => undefined,
  },
})

const account = new Account(
  'selected',
  'https://api.github.com',
  'token',
  [],
  '',
  2,
  'Selected'
)
const repository = new GitHubRepository(
  'repo',
  new Owner('owner', 'https://api.github.com', 1),
  1
)
const artifact: IActionsArtifact = {
  id: 19,
  name: 'package',
  sizeInBytes: 4,
  expired: false,
  createdAt: new Date(0),
  expiresAt: null,
  updatedAt: new Date(0),
  digest: `sha256:${'a'.repeat(64)}`,
  workflowRun: null,
}

function registrationRaceSignal(): AbortSignal {
  let reads = 0
  return {
    get aborted() {
      reads++
      return reads > 1
    },
    addEventListener() {},
    removeEventListener() {},
  } as unknown as AbortSignal
}

describe('Actions transfer renderer client', () => {
  it('closes the post-registration abort race before artifact invoke', async () => {
    invokes = 0
    invocationPayloads.length = 0
    sends.length = 0
    onInvoke = () => undefined
    const { downloadActionsArtifactThroughMainProcess } = await import(
      '../../src/lib/actions-transfer-client'
    )

    await assert.rejects(
      downloadActionsArtifactThroughMainProcess(
        account,
        repository,
        artifact,
        'C:\\Downloads\\artifact.zip',
        registrationRaceSignal()
      ),
      { name: 'AbortError' }
    )
    assert.equal(invokes, 0)
    assert.equal(sends.length, 1)
    assert.equal(sends[0].channel, 'cancel-actions-transfer')
  })

  it('closes the post-registration abort race before job-log invoke', async () => {
    invokes = 0
    invocationPayloads.length = 0
    sends.length = 0
    onInvoke = () => undefined
    const { fetchActionsJobLogThroughMainProcess } = await import(
      '../../src/lib/actions-transfer-client'
    )

    await assert.rejects(
      fetchActionsJobLogThroughMainProcess(
        account,
        repository,
        7,
        registrationRaceSignal()
      ),
      { name: 'AbortError' }
    )
    assert.equal(invokes, 0)
    assert.equal(sends.length, 1)
  })

  it('treats a published artifact success as authoritative', async () => {
    invokes = 0
    invocationPayloads.length = 0
    sends.length = 0
    const controller = new AbortController()
    onInvoke = () => controller.abort()
    const { downloadActionsArtifactThroughMainProcess } = await import(
      '../../src/lib/actions-transfer-client'
    )

    const result = await downloadActionsArtifactThroughMainProcess(
      account,
      repository,
      artifact,
      'C:\\Downloads\\artifact.zip',
      controller.signal
    )

    assert.equal(result.path, 'C:\\Downloads\\artifact.zip')
    assert.equal(invokes, 1)
  })

  it('treats a completed job log response as authoritative', async () => {
    invokes = 0
    invocationPayloads.length = 0
    sends.length = 0
    const controller = new AbortController()
    onInvoke = () => controller.abort()
    const { fetchActionsJobLogThroughMainProcess } = await import(
      '../../src/lib/actions-transfer-client'
    )

    const log = await fetchActionsJobLogThroughMainProcess(
      account,
      repository,
      7,
      controller.signal
    )

    assert.equal(log, 'verified log')
    assert.equal(invokes, 1)
  })

  it('does not invoke subject inspection when already aborted', async () => {
    invokes = 0
    invocationPayloads.length = 0
    sends.length = 0
    const controller = new AbortController()
    controller.abort()
    const { inspectActionsArtifactSubjectsThroughMainProcess } = await import(
      '../../src/lib/actions-artifact-subject-client'
    )

    await assert.rejects(
      inspectActionsArtifactSubjectsThroughMainProcess(
        'd'.repeat(32),
        controller.signal
      ),
      { name: 'AbortError' }
    )
    assert.equal(invokes, 0)
    assert.deepEqual(sends, [])
  })

  it('closes the registration race before subject preparation invoke', async () => {
    invokes = 0
    invocationPayloads.length = 0
    sends.length = 0
    const { prepareActionsArtifactSubjectThroughMainProcess } = await import(
      '../../src/lib/actions-artifact-subject-client'
    )

    await assert.rejects(
      prepareActionsArtifactSubjectThroughMainProcess(
        'd'.repeat(32),
        'b'.repeat(32),
        'c'.repeat(32),
        registrationRaceSignal()
      ),
      { name: 'AbortError' }
    )
    assert.equal(invokes, 0)
    assert.equal(sends.length, 1)
    assert.equal(sends[0].channel, 'cancel-actions-artifact-subject-operation')
  })

  it('sends only opaque subject handles and explicit release messages', async () => {
    invokes = 0
    invocationPayloads.length = 0
    sends.length = 0
    onInvoke = () => undefined
    const {
      inspectActionsArtifactSubjectsThroughMainProcess,
      releaseActionsArtifactDownloadThroughMainProcess,
    } = await import('../../src/lib/actions-artifact-subject-client')
    const controller = new AbortController()
    const downloadId = 'd'.repeat(32)

    const inventory = await inspectActionsArtifactSubjectsThroughMainProcess(
      downloadId,
      controller.signal
    )
    assert.equal(inventory.ok, true)
    assert.equal(invokes, 1)
    assert.deepEqual(invocationPayloads[0], {
      operationId: (invocationPayloads[0] as { operationId: string })
        .operationId,
      downloadId,
    })
    assert.match(
      (invocationPayloads[0] as { operationId: string }).operationId,
      /^[a-f0-9]{32}$/
    )

    releaseActionsArtifactDownloadThroughMainProcess(downloadId)
    assert.deepEqual(sends, [
      { channel: 'release-actions-artifact-download', payload: downloadId },
    ])
  })
})
