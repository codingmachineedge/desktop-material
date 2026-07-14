import * as React from 'react'
import { IAPIWorkflow } from '../../lib/api'
import { Button } from '../lib/button'

export interface IWorkflowStateAction {
  readonly enabled: boolean
  readonly label: string
}

/** Resolve the available state mutation for a workflow returned by GitHub. */
export function getWorkflowStateAction(
  workflow: IAPIWorkflow
): IWorkflowStateAction | null {
  if (workflow.state === 'active') {
    return { enabled: false, label: 'Disable workflow' }
  }
  if (workflow.state.startsWith('disabled_')) {
    return { enabled: true, label: 'Enable workflow' }
  }
  return null
}

interface IWorkflowStateControlProps {
  readonly workflow: IAPIWorkflow | null
  readonly busyWorkflowId: number | null
  readonly onRequestChange: (workflow: IAPIWorkflow, enabled: boolean) => void
}

/** State summary and confirmation entry point for the selected workflow. */
export class WorkflowStateControl extends React.PureComponent<IWorkflowStateControlProps> {
  private requestChange = () => {
    const { workflow } = this.props
    if (workflow === null) {
      return
    }
    const action = getWorkflowStateAction(workflow)
    if (action !== null) {
      this.props.onRequestChange(workflow, action.enabled)
    }
  }

  public render() {
    const { workflow, busyWorkflowId } = this.props
    if (workflow === null) {
      return (
        <section
          className="actions-workflow-management"
          aria-label="Workflow state management"
        >
          <span>Choose one workflow above to manage its state.</span>
        </section>
      )
    }

    const action = getWorkflowStateAction(workflow)
    const stateLabel = workflow.state.replace(/_/g, ' ')
    return (
      <section
        className="actions-workflow-management"
        aria-label="Workflow state management"
      >
        <div>
          <span className="eyebrow">Selected workflow</span>
          <strong>{workflow.name}</strong>
          <span className="actions-workflow-state">{stateLabel}</span>
        </div>
        {action === null ? (
          <span>This workflow state cannot be changed.</span>
        ) : (
          <Button
            onClick={this.requestChange}
            disabled={busyWorkflowId === workflow.id}
            ariaLabel={`${action.label}: ${workflow.name}`}
          >
            {busyWorkflowId === workflow.id ? 'Updating…' : action.label}
          </Button>
        )}
      </section>
    )
  }
}
