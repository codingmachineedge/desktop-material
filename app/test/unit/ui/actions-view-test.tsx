import assert from 'node:assert'
import { describe, it } from 'node:test'

import { IAPIWorkflowJob } from '../../../src/lib/api'
import { ActionsStore } from '../../../src/lib/stores/actions-store'
import { Repository } from '../../../src/models/repository'
import { ActionsView } from '../../../src/ui/actions/actions-view'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createJob(id: number, name: string): IAPIWorkflowJob {
  return { id, name } as IAPIWorkflowJob
}

function createHarness(
  requests: ReadonlyMap<number, Promise<string>>
): ActionsView {
  const repository = {
    gitHubRepository: {
      endpoint: 'https://api.github.com',
      owner: { login: 'owner' },
      name: 'repository',
    },
  } as Repository
  const actionsStore = {
    fetchJobLogs: (_repository: unknown, jobId: number) => {
      const request = requests.get(jobId)
      assert(request !== undefined)
      return request
    },
  } as unknown as ActionsStore
  const view = new ActionsView({
    repository,
    currentBranch: null,
    branchNames: [],
    actionsStore,
  })

  Reflect.set(
    view,
    'setState',
    (
      update:
        | Partial<typeof view.state>
        | ((
            state: typeof view.state,
            props: typeof view.props
          ) => Partial<typeof view.state> | null),
      callback?: () => void
    ) => {
      const patch =
        typeof update === 'function' ? update(view.state, view.props) : update
      if (patch !== null) {
        Reflect.set(view, 'state', { ...view.state, ...patch })
      }
      callback?.()
    }
  )

  return view
}

function viewLogs(view: ActionsView, job: IAPIWorkflowJob): Promise<void> {
  return (
    Reflect.get(view, 'viewLogs') as (
      requestedJob: IAPIWorkflowJob
    ) => Promise<void>
  )(job)
}

function closeLogs(view: ActionsView) {
  const close = Reflect.get(view, 'closeLogs') as () => void
  close()
}

describe('ActionsView job logs', () => {
  it("does not let an old job's rejection overwrite the active job", async () => {
    const jobARequest = deferred<string>()
    const jobBRequest = deferred<string>()
    const jobA = createJob(1, 'job A')
    const jobB = createJob(2, 'job B')
    const view = createHarness(
      new Map([
        [jobA.id, jobARequest.promise],
        [jobB.id, jobBRequest.promise],
      ])
    )

    const loadingA = viewLogs(view, jobA)
    const loadingB = viewLogs(view, jobB)
    jobARequest.reject(new Error('job A failed late'))
    await loadingA

    assert.equal(view.state.logJob?.id, jobB.id)
    assert.equal(view.state.logLoading, true)
    assert.equal(view.state.logError, null)

    jobBRequest.resolve('job B log')
    await loadingB
    assert.equal(view.state.log, 'job B log')
    assert.equal(view.state.logLoading, false)
    assert.equal(view.state.logError, null)
  })

  it('keeps a closed log viewer clear after a late rejection', async () => {
    const jobRequest = deferred<string>()
    const job = createJob(1, 'job A')
    const view = createHarness(new Map([[job.id, jobRequest.promise]]))

    const loading = viewLogs(view, job)
    closeLogs(view)
    jobRequest.reject(new Error('job failed after close'))
    await loading

    assert.equal(view.state.logJob, null)
    assert.equal(view.state.log, '')
    assert.equal(view.state.logLoading, false)
    assert.equal(view.state.logError, null)
  })
})
