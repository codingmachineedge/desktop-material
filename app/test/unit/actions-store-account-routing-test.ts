import assert from 'node:assert'
import { describe, it, mock } from 'node:test'
import { Account, getAccountKey } from '../../src/models/account'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import { Repository } from '../../src/models/repository'
import { API, IAPIWorkflow } from '../../src/lib/api'
import { IActionsArtifact } from '../../src/lib/actions-artifacts'
import { AccountsStore } from '../../src/lib/stores/accounts-store'

const ipcRequests = new Array<{
  readonly channel: string
  readonly request: {
    readonly endpoint: string
    readonly token: string
    readonly owner: string
    readonly repository: string
  }
}>()

mock.module('../../src/lib/ipc-renderer', {
  namedExports: {
    invoke: async (
      channel: string,
      request: {
        endpoint: string
        token: string
        owner: string
        repository: string
      }
    ) => {
      ipcRequests.push({ channel, request })
      return channel === 'fetch-actions-job-log'
        ? { ok: true, log: 'selected account log', truncated: false }
        : {
            ok: true,
            downloadId: 'd'.repeat(32),
            path: 'C:\\Downloads\\package.zip',
            bytes: 0,
            localDigest: `sha256:${'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}`,
            matchesGitHubDigest: null,
          }
    },
    send: () => undefined,
    on: () => undefined,
    removeListener: () => undefined,
  },
})

class TestAccountsStore {
  public constructor(private readonly accounts: ReadonlyArray<Account>) {}

  public async getAll() {
    return this.accounts
  }

  public onDidUpdate() {}
}

describe('ActionsStore exact account routing', () => {
  it('uses the repository-selected same-endpoint account on every surface', async () => {
    ipcRequests.length = 0
    const endpoint = 'https://api.github.com'
    const first = new Account('first', endpoint, 'one', [], '', 1, 'First')
    const second = new Account('second', endpoint, 'two', [], '', 2, 'Second')
    const gitHubRepository = new GitHubRepository(
      'project',
      new Owner('group', endpoint, 1),
      1
    )
    const repository = new Repository(
      'C:/project',
      1,
      gitHubRepository,
      false,
      null,
      {},
      false,
      undefined,
      getAccountKey(second)
    )
    const selectedAccounts = new Array<Account>()
    const artifactPages = new Array<number>()
    const jobPages = new Array<number>()
    const reviews = new Array<{
      ids: ReadonlyArray<number>
      state: string
      comment: string
    }>()
    const fakeAPI = {
      fetchWorkflows: async () => ({ workflows: [] }),
      fetchWorkflowRuns: async () => ({ workflow_runs: [] }),
      fetchWorkflowRunJobs: async () => ({ jobs: [] }),
      fetchWorkflowRunJobPage: async (
        _owner: string,
        _name: string,
        runId: number,
        attempt: number,
        _latestAttempt: number,
        page: number
      ) => {
        jobPages.push(page)
        return {
          runId,
          attempt,
          totalCount: 0,
          jobs: [],
          page,
          nextPage: null,
          truncated: false,
        }
      },
      fetchWorkflowRunPendingDeployments: async () => [],
      fetchWorkflowRunReviewHistory: async () => [],
      reviewWorkflowRunPendingDeployments: async (
        _owner: string,
        _name: string,
        _runId: number,
        ids: ReadonlyArray<number>,
        state: string,
        comment: string
      ) => {
        reviews.push({ ids, state, comment })
      },
      approveForkWorkflowRun: async () => undefined,
      fetchWorkflowRunArtifacts: async (
        _owner: string,
        _name: string,
        _runId: number,
        page: number
      ) => {
        artifactPages.push(page)
        return {
          totalCount: 0,
          artifacts: [],
          page,
          nextPage: null,
          truncated: false,
        }
      },
      fetchArtifactAttestationPresence: async () => false,
      fetchArtifactAttestationBundles: async () => ({
        bundles: [],
        serializedBytes: 0,
      }),
      rerunWorkflowRun: async () => undefined,
      rerunFailedJobs: async () => true,
      rerunJob: async () => true,
      rerunWorkflowJob: async () => undefined,
      cancelWorkflowRun: async () => undefined,
      setWorkflowEnabled: async () => undefined,
      fetchWorkflowFileContent: async () => 'name: CI',
      dispatchWorkflow: async () => undefined,
    }
    const fromAccount = mock.method(API, 'fromAccount', (account: Account) => {
      selectedAccounts.push(account)
      return fakeAPI as unknown as API
    })
    const originalSetTimeout = window.setTimeout
    window.setTimeout = (() => 0) as unknown as typeof window.setTimeout

    try {
      const { ActionsStore } = await import(
        '../../src/lib/stores/actions-store'
      )
      const store = new ActionsStore(
        new TestAccountsStore([first, second]) as unknown as AccountsStore
      )
      await Promise.resolve()

      await store.refresh(repository, true)
      Reflect.set(store, 'refresh', async () => undefined)

      await store.fetchJobs(repository, 7)
      await store.fetchJobPage(repository, 7, 2, 2, 2)
      await store.fetchPendingDeployments(repository, 7)
      await store.fetchRunReviewHistory(repository, 7)
      await store.fetchArtifacts(repository, 7, 2)
      await store.fetchArtifactAttestationPresence(
        repository,
        `sha256:${'a'.repeat(64)}`
      )
      await store.fetchArtifactAttestationBundles(
        repository,
        `sha256:${'a'.repeat(64)}`
      )
      await store.rerun(repository, 7)
      await store.rerunFailed(repository, 7)
      await store.rerunJob(repository, 11)
      await store.reviewPendingDeployments(
        repository,
        7,
        [101],
        'approved',
        'Ready'
      )
      await store.approveForkRun(repository, 7)
      await store.cancelRun(repository, 7, false)
      await store.setWorkflowEnabled(repository, 3, false)
      await store.fetchWorkflowSource(repository, {
        id: 3,
        name: 'CI',
        path: '.github/workflows/ci.yml',
      } as IAPIWorkflow)
      await store.dispatch(repository, 3, 'main', {})
      assert.equal(
        await store.fetchJobLogs(repository, 11),
        'selected account log'
      )
      const artifact: IActionsArtifact = {
        id: 19,
        name: 'package',
        sizeInBytes: 0,
        expired: false,
        createdAt: new Date(0),
        expiresAt: null,
        updatedAt: new Date(0),
        digest: null,
        workflowRun: null,
      }
      const controller = new AbortController()
      const download = await store.downloadArtifact(
        repository,
        artifact,
        'C:\\Downloads\\package.zip',
        controller.signal
      )
      assert.equal(download.downloadId, 'd'.repeat(32))

      assert.equal(selectedAccounts.length, 17)
      assert.ok(selectedAccounts.every(account => account === second))
      assert.deepEqual(artifactPages, [2])
      assert.deepEqual(jobPages, [2])
      assert.deepEqual(reviews, [
        { ids: [101], state: 'approved', comment: 'Ready' },
      ])
      assert.deepEqual(
        ipcRequests.map(({ channel, request }) => ({
          channel,
          endpoint: request.endpoint,
          token: request.token,
          owner: request.owner,
          repository: request.repository,
        })),
        [
          {
            channel: 'fetch-actions-job-log',
            endpoint,
            token: 'two',
            owner: 'group',
            repository: 'project',
          },
          {
            channel: 'download-actions-artifact',
            endpoint,
            token: 'two',
            owner: 'group',
            repository: 'project',
          },
        ]
      )
    } finally {
      fromAccount.mock.restore()
      window.setTimeout = originalSetTimeout
    }
  })
})
