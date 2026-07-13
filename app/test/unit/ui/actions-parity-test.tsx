import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as React from 'react'
import {
  APICheckConclusion,
  APICheckStatus,
  IAPIWorkflow,
  IAPIWorkflowJob,
  IAPIWorkflowRun,
} from '../../../src/lib/api'
import { RunList } from '../../../src/ui/actions/run-list'
import { RunDetails } from '../../../src/ui/actions/run-details'
import { ActionsConfirmationDialog } from '../../../src/ui/actions/actions-confirmation-dialog'
import {
  getWorkflowStateAction,
  WorkflowStateControl,
} from '../../../src/ui/actions/workflow-state-control'
import { fireEvent, render, screen } from '../../helpers/ui/render'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { ActionsStore } from '../../../src/lib/stores/actions-store'
import { Repository } from '../../../src/models/repository'

const gitHubRepository = new GitHubRepository(
  'repo',
  new Owner('owner', 'https://api.github.com', 1),
  1
)
const repository = new Repository('C:/repo', 1, gitHubRepository, false)
const actionsStore = {
  fetchArtifacts: async () => ({
    totalCount: 0,
    artifacts: [],
    truncated: false,
  }),
} as unknown as ActionsStore

const createRun = (
  status: APICheckStatus,
  conclusion: APICheckConclusion | null
): IAPIWorkflowRun => ({
  id: 7,
  workflow_id: 3,
  cancel_url: 'https://api.github.com/cancel',
  created_at: '2026-07-12T12:00:00Z',
  logs_url: 'https://api.github.com/logs',
  name: 'CI',
  rerun_url: 'https://api.github.com/rerun',
  check_suite_id: 9,
  event: 'push',
  display_title: 'A very long workflow run title that must remain responsive',
  run_number: 42,
  head_branch: 'feature/actions-parity',
  status,
  conclusion,
  html_url: 'https://github.com/owner/repo/actions/runs/7',
})

const createJob = (
  id: number,
  name: string,
  conclusion: APICheckConclusion
): IAPIWorkflowJob => ({
  id,
  name,
  status: APICheckStatus.Completed,
  conclusion,
  completed_at: '2026-07-12T12:01:00Z',
  started_at: '2026-07-12T12:00:00Z',
  steps: [],
  html_url: `https://github.com/owner/repo/actions/runs/7/job/${id}`,
})

const createWorkflow = (
  state: IAPIWorkflow['state'],
  name: string = 'CI'
): IAPIWorkflow => ({
  id: 3,
  name,
  path: '.github/workflows/ci.yml',
  state,
  html_url: 'https://github.com/owner/repo/actions/workflows/ci.yml',
  created_at: '2026-07-12T12:00:00Z',
  updated_at: '2026-07-12T12:00:00Z',
})

describe('Actions parity controls', () => {
  it('offers cancellation only while a run is active', () => {
    let requested: IAPIWorkflowRun | null = null
    const run = createRun(APICheckStatus.InProgress, null)
    const view = render(
      <RunList
        runs={[run]}
        selectedRunId={null}
        busyRunId={null}
        onSelect={() => {}}
        onRerun={() => {}}
        onRerunFailed={() => {}}
        onRequestCancel={value => (requested = value)}
      />
    )

    assert.equal(screen.queryByRole('button', { name: 'Re-run' }), null)
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel workflow run 42' })
    )
    assert.equal(requested, run)

    view.rerender(
      <RunList
        runs={[createRun(APICheckStatus.Completed, APICheckConclusion.Failure)]}
        selectedRunId={null}
        busyRunId={null}
        onSelect={() => {}}
        onRerun={() => {}}
        onRerunFailed={() => {}}
        onRequestCancel={() => {}}
      />
    )
    assert.equal(
      screen.queryByRole('button', { name: 'Cancel workflow run 42' }),
      null
    )
    assert.ok(screen.getByRole('button', { name: 'Re-run' }))
  })

  it('re-runs only an individual failed job', () => {
    const failed = createJob(
      11,
      'Build Windows package with an intentionally long descriptive name',
      APICheckConclusion.Failure
    )
    const succeeded = createJob(12, 'Lint', APICheckConclusion.Success)
    let requested: IAPIWorkflowJob | null = null
    render(
      <RunDetails
        repository={repository}
        actionsStore={actionsStore}
        run={createRun(APICheckStatus.Completed, APICheckConclusion.Failure)}
        jobs={[failed, succeeded]}
        loading={false}
        error={null}
        onClose={() => {}}
        busyJobId={null}
        onRerunJob={job => (requested = job)}
      />
    )

    const button = screen.getByRole('button', {
      name: `Re-run failed job: ${failed.name}`,
    })
    fireEvent.click(button)
    assert.equal(requested, failed)
    assert.equal(
      screen.queryByRole('button', {
        name: `Re-run failed job: ${succeeded.name}`,
      }),
      null
    )
  })

  it('requires confirmation and makes force cancellation explicit', () => {
    let force: boolean | null = null
    render(
      <ActionsConfirmationDialog
        eyebrow="Destructive action"
        title="Cancel workflow run?"
        description={<p>Cancel this run?</p>}
        confirmLabel="Cancel run"
        forceConfirmLabel="Force cancel run"
        showForceCancelOption={true}
        submitting={false}
        onConfirm={value => (force = value)}
        onDismissed={() => {}}
      />
    )

    assert.ok(screen.getByRole('alertdialog'))
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Force cancellation/ })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Force cancel run' }))
    assert.equal(force, true)
  })

  it('maps active and disabled workflow states to confirmed mutations', () => {
    assert.deepEqual(getWorkflowStateAction(createWorkflow('active')), {
      enabled: false,
      label: 'Disable workflow',
    })
    assert.deepEqual(
      getWorkflowStateAction(createWorkflow('disabled_manually')),
      { enabled: true, label: 'Enable workflow' }
    )
    assert.equal(getWorkflowStateAction(createWorkflow('deleted')), null)

    const longName =
      'A workflow name long enough to exercise responsive wrapping without overlapping adjacent controls'
    const workflow = createWorkflow('disabled_inactivity', longName)
    let requested: { workflow: IAPIWorkflow; enabled: boolean } | null = null
    render(
      <WorkflowStateControl
        workflow={workflow}
        busyWorkflowId={null}
        onRequestChange={(value, enabled) =>
          (requested = { workflow: value, enabled })
        }
      />
    )

    assert.ok(screen.getByText(longName))
    fireEvent.click(
      screen.getByRole('button', { name: `Enable workflow: ${longName}` })
    )
    assert.deepEqual(requested, { workflow, enabled: true })
  })
})
