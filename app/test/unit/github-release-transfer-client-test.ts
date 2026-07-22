import assert from 'node:assert'
import { describe, it, mock } from 'node:test'
import { Account } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { IGitHubReleaseAsset } from '../../src/lib/github-releases'

let invokes = 0
const requests = new Array<{
  channel: string
  request: Record<string, unknown>
}>()
const sends = new Array<{ channel: string; operationId: string }>()

mock.module('../../src/lib/ipc-renderer', {
  namedExports: {
    invoke: async (channel: string, request: Record<string, unknown>) => {
      invokes++
      requests.push({ channel, request })
      return channel === 'upload-release-asset'
        ? {
            ok: true,
            asset,
            bytes: 4,
            localDigest: `sha256:${'a'.repeat(64)}`,
          }
        : {
            ok: true,
            path: 'C:\\Downloads\\desktop.exe',
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
const asset: IGitHubReleaseAsset = {
  id: 19,
  name: 'desktop.exe',
  label: null,
  state: 'uploaded',
  contentType: 'application/octet-stream',
  sizeInBytes: 4,
  downloadCount: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  digest: `sha256:${'a'.repeat(64)}`,
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

describe('GitHub release transfer renderer client', () => {
  it('closes the cancellation registration race before invoking main', async () => {
    invokes = 0
    requests.length = 0
    sends.length = 0
    const { downloadGitHubReleaseAssetThroughMainProcess } = await import(
      '../../src/lib/github-release-transfer-client'
    )
    await assert.rejects(
      downloadGitHubReleaseAssetThroughMainProcess(
        account,
        repository,
        7,
        asset,
        'C:\\Downloads\\desktop.exe',
        registrationRaceSignal()
      ),
      { name: 'AbortError' }
    )
    assert.equal(invokes, 0)
    assert.equal(sends[0].channel, 'cancel-github-release-transfer')
  })

  it('sends exact account, repository, release, and asset download data', async () => {
    invokes = 0
    requests.length = 0
    sends.length = 0
    const { downloadGitHubReleaseAssetThroughMainProcess } = await import(
      '../../src/lib/github-release-transfer-client'
    )
    const result = await downloadGitHubReleaseAssetThroughMainProcess(
      account,
      repository,
      7,
      asset,
      'C:\\Downloads\\desktop.exe',
      new AbortController().signal
    )
    assert.equal(result.path, 'C:\\Downloads\\desktop.exe')
    assert.equal(requests[0].channel, 'download-release-asset')
    assert.equal(requests[0].request.endpoint, account.endpoint)
    assert.equal(requests[0].request.token, account.token)
    assert.equal(requests[0].request.releaseId, 7)
    assert.deepEqual(requests[0].request.asset, {
      id: 19,
      name: 'desktop.exe',
      state: 'uploaded',
      sizeInBytes: 4,
      digest: asset.digest,
    })
  })

  it('sends reviewed upload metadata through the upload-only channel', async () => {
    invokes = 0
    requests.length = 0
    sends.length = 0
    const { uploadGitHubReleaseAssetThroughMainProcess } = await import(
      '../../src/lib/github-release-transfer-client'
    )
    const result = await uploadGitHubReleaseAssetThroughMainProcess(
      account,
      repository,
      7,
      'C:\\Build\\desktop.exe',
      'desktop.exe',
      'Windows installer',
      new AbortController().signal,
      undefined,
      { offset: 0, length: 4 },
      `sha256:${'a'.repeat(64)}`
    )
    assert.equal(result.asset.id, 19)
    assert.equal(requests[0].channel, 'upload-release-asset')
    assert.equal(requests[0].request.sourcePath, 'C:\\Build\\desktop.exe')
    assert.equal(requests[0].request.name, 'desktop.exe')
    assert.equal(requests[0].request.label, 'Windows installer')
    assert.deepEqual(requests[0].request.range, { offset: 0, length: 4 })
    assert.equal(requests[0].request.expectedDigest, `sha256:${'a'.repeat(64)}`)
  })
})
