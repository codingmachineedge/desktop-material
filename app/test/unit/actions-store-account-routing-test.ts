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
    readonly operationId: string
    readonly endpoint: string
    readonly token: string
    readonly owner: string
    readonly repository: string
  }
}>()
const canceledTransfers = new Array<string>()
const pendingArtifactDownloads = new Map<
  string,
  (result: { readonly ok: false; readonly reason: 'canceled' }) => void
>()
const pendingJobLogs = new Map<
  string,
  (result: {
    readonly ok: true
    readonly log: string
    readonly truncated: false
  }) => void
>()
let pauseArtifactDownloads = false
let pauseJobLogs = false

mock.module('../../src/lib/ipc-renderer', {
  namedExports: {
    invoke: async (
      channel: string,
      request: {
        operationId: string
        endpoint: string
        token: string
        owner: string
        repository: string
      }
    ) => {
      ipcRequests.push({ channel, request })
      if (channel === 'download-actions-artifact' && pauseArtifactDownloads) {
        return await new Promise(resolve => {
          pendingArtifactDownloads.set(request.operationId, resolve)
        })
      }
      if (channel === 'fetch-actions-job-log' && pauseJobLogs) {
        return await new Promise(resolve => {
          pendingJobLogs.set(request.operationId, resolve)
        })
      }
      return channel === 'fetch-actions-job-log'
        ? { ok: true, log: 'selected account log', truncated: false }
        : {
            ok: true,
            path: 'C:\\Downloads\\package.zip',
            bytes: 0,
            localDigest: `sha256:${'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'}`,
            matchesGitHubDigest: null,
          }
    },
    send: (channel: string, operationId: string) => {
      if (channel === 'cancel-actions-transfer') {
        canceledTransfers.push(operationId)
        pendingArtifactDownloads.get(operationId)?.({
          ok: false,
          reason: 'canceled',
        })
        pendingArtifactDownloads.delete(operationId)
      }
    },
    on: () => undefined,
    removeListener: () => undefined,
  },
})

class TestAccountsStore {
  private listener: ((accounts: ReadonlyArray<Account>) => void) | null = null

  public constructor(private readonly accounts: ReadonlyArray<Account>) {}

  public async getAll() {
    return this.accounts
  }

  public onDidUpdate(listener: (accounts: ReadonlyArray<Account>) => void) {
    this.listener = listener
  }

  public update(accounts: ReadonlyArray<Account>) {
    this.listener?.(accounts)
  }
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
    const fakeAPI = {
      fetchWorkflows: async () => ({ workflows: [] }),
      fetchWorkflowRuns: async () => ({ workflow_runs: [] }),
      fetchWorkflowRunJobs: async () => ({ jobs: [] }),
      fetchWorkflowRunArtifacts: async () => ({
        totalCount: 0,
        artifacts: [],
        page: 1,
        nextPage: null,
        truncated: false,
        capped: false,
      }),
      fetchArtifactAttestationPresence: async () => false,
      fetchEffectiveBranchRules: async () => ({
        branch: 'main',
        rules: [],
        capped: false,
      }),
      rerunWorkflowRun: async () => undefined,
      rerunFailedJobs: async () => true,
      rerunJob: async () => true,
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
      await store.fetchArtifacts(repository, 7)
      await store.fetchArtifactAttestationPresence(
        repository,
        `sha256:${'a'.repeat(64)}`
      )
      await store.fetchBranchRules(repository, 'main')
      await store.rerun(repository, 7)
      await store.rerunFailed(repository, 7)
      await store.rerunJob(repository, 11)
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
      await store.downloadArtifact(
        repository,
        artifact,
        'C:\\Downloads\\package.zip',
        controller.signal
      )

      assert.equal(selectedAccounts.length, 12)
      assert.ok(selectedAccounts.every(account => account === second))
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

  it('cancels an in-flight artifact transfer when the selected account changes', async () => {
    ipcRequests.length = 0
    canceledTransfers.length = 0
    pendingArtifactDownloads.clear()
    pauseArtifactDownloads = true
    const endpoint = 'https://api.github.com'
    const selected = new Account(
      'selected',
      endpoint,
      'token-one',
      [],
      '',
      2,
      'Selected'
    )
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
      getAccountKey(selected)
    )
    const accounts = new TestAccountsStore([selected])
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

    try {
      const { ActionsStore } = await import(
        '../../src/lib/stores/actions-store'
      )
      const store = new ActionsStore(accounts as unknown as AccountsStore)
      await Promise.resolve()
      const transfer = store.downloadArtifact(
        repository,
        artifact,
        'C:\\Downloads\\package.zip',
        new AbortController().signal
      )
      await Promise.resolve()
      assert.equal(pendingArtifactDownloads.size, 1)

      accounts.update([selected.withToken('token-two')])
      await assert.rejects(
        transfer,
        error => (error as Error).name === 'AbortError'
      )
      assert.equal(canceledTransfers.length, 1)
      assert.equal(pendingArtifactDownloads.size, 0)
    } finally {
      pauseArtifactDownloads = false
      pendingArtifactDownloads.clear()
    }
  })

  it('drops a late job log result after the selected account changes', async () => {
    ipcRequests.length = 0
    canceledTransfers.length = 0
    pendingJobLogs.clear()
    pauseJobLogs = true
    const endpoint = 'https://api.github.com'
    const selected = new Account(
      'selected',
      endpoint,
      'token-one',
      [],
      '',
      2,
      'Selected'
    )
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
      getAccountKey(selected)
    )
    const accounts = new TestAccountsStore([selected])

    try {
      const { ActionsStore } = await import(
        '../../src/lib/stores/actions-store'
      )
      const store = new ActionsStore(accounts as unknown as AccountsStore)
      await Promise.resolve()
      const log = store.fetchJobLogs(repository, 11)
      await Promise.resolve()
      assert.equal(pendingJobLogs.size, 1)

      accounts.update([selected.withToken('token-two')])
      const [operationId, resolve] = [...pendingJobLogs.entries()][0]
      assert.deepEqual(canceledTransfers, [operationId])
      resolve({ ok: true, log: 'old account log', truncated: false })
      await assert.rejects(log, error => (error as Error).name === 'AbortError')
    } finally {
      pauseJobLogs = false
      pendingJobLogs.clear()
    }
  })

  it('drops late jobs and workflow source after the selected account changes', async () => {
    const endpoint = 'https://api.github.com'
    const selected = new Account(
      'selected',
      endpoint,
      'token-one',
      [],
      '',
      2,
      'Selected'
    )
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
      getAccountKey(selected)
    )
    const accounts = new TestAccountsStore([selected])
    const signals = new Array<AbortSignal>()
    let resolveJobs!: (value: { readonly jobs: ReadonlyArray<never> }) => void
    let resolveSource!: (value: string) => void
    const jobsResult = new Promise<{ readonly jobs: ReadonlyArray<never> }>(
      resolve => {
        resolveJobs = resolve
      }
    )
    const sourceResult = new Promise<string>(resolve => {
      resolveSource = resolve
    })
    const fromAccount = mock.method(
      API,
      'fromAccount',
      () =>
        ({
          fetchWorkflowRunJobs: async (
            _owner: string,
            _name: string,
            _runId: number,
            signal: AbortSignal
          ) => {
            signals.push(signal)
            return await jobsResult
          },
          fetchWorkflowFileContent: async (
            _owner: string,
            _name: string,
            _path: string,
            _ref: string | undefined,
            signal: AbortSignal
          ) => {
            signals.push(signal)
            return await sourceResult
          },
        } as unknown as API)
    )

    try {
      const { ActionsStore } = await import(
        '../../src/lib/stores/actions-store'
      )
      const store = new ActionsStore(accounts as unknown as AccountsStore)
      await Promise.resolve()
      const jobs = store.fetchJobs(repository, 7)
      const source = store.fetchWorkflowSource(repository, {
        id: 3,
        name: 'CI',
        path: '.github/workflows/ci.yml',
      } as IAPIWorkflow)
      assert.equal(signals.length, 2)

      accounts.update([selected.withToken('token-two')])
      assert.ok(signals.every(signal => signal.aborted))
      resolveJobs({ jobs: [] })
      resolveSource('name: Old account workflow')
      await assert.rejects(
        jobs,
        error => (error as Error).name === 'AbortError'
      )
      await assert.rejects(
        source,
        error => (error as Error).name === 'AbortError'
      )
    } finally {
      fromAccount.mock.restore()
    }
  })
})
