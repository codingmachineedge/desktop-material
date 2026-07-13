import assert from 'node:assert'
import { describe, it, mock } from 'node:test'
import { Account } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { IActionsArtifact } from '../../src/lib/actions-artifacts'

let invokes = 0
const sends = new Array<{ channel: string; operationId: string }>()
let onInvoke: (channel: string) => void = () => undefined

mock.module('../../src/lib/ipc-renderer', {
  namedExports: {
    invoke: async (channel: string) => {
      invokes++
      onInvoke(channel)
      if (channel === 'fetch-actions-job-log') {
        return { ok: true, log: 'verified log', truncated: false }
      }
      return {
        ok: true,
        path: 'C:\\Downloads\\artifact.zip',
        bytes: 4,
        localDigest: `sha256:${'a'.repeat(64)}`,
        matchesGitHubDigest: true,
      }
    },
    send: (channel: string, operationId: string) =>
      sends.push({ channel, operationId }),
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
})
