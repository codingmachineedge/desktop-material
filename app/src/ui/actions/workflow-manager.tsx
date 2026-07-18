import * as React from 'react'
import classNames from 'classnames'
import { IAPIWorkflow } from '../../lib/api'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { getWorkflowStateAction } from './workflow-state-control'
import { getWorkflowFileName, getWorkflowGlyph } from './workflow-templates'

interface IWorkflowManagerRowProps {
  readonly workflow: IAPIWorkflow
  readonly busyWorkflowId: number | null
  readonly index: number
  readonly onRequestChange: (workflow: IAPIWorkflow, enabled: boolean) => void
}

class WorkflowManagerRow extends React.PureComponent<IWorkflowManagerRowProps> {
  private toggle = () => {
    const { workflow } = this.props
    const action = getWorkflowStateAction(workflow)
    if (action !== null) {
      this.props.onRequestChange(workflow, action.enabled)
    }
  }

  public render() {
    const { workflow, busyWorkflowId, index } = this.props
    const enabled = workflow.state === 'active'
    const action = getWorkflowStateAction(workflow)
    const stateLabel = workflow.state.replace(/_/g, ' ')
    const style = { animationDelay: `${Math.min(index, 8) * 40}ms` }
    return (
      <div
        className={classNames('actions-workflow-row', { disabled: !enabled })}
        style={style}
      >
        <span className="actions-workflow-row-icon" aria-hidden="true">
          <Octicon
            symbol={getWorkflowGlyph(`${workflow.name} ${workflow.path}`)}
          />
        </span>
        <span className="actions-workflow-row-text">
          <strong>{workflow.name}</strong>
          <span className="actions-workflow-row-file">
            {getWorkflowFileName(workflow.path)} · {stateLabel}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className="actions-workflow-switch"
          onClick={this.toggle}
          disabled={action === null || busyWorkflowId === workflow.id}
          aria-label={`${enabled ? 'Disable' : 'Enable'} workflow: ${
            workflow.name
          }`}
        >
          <span className="actions-workflow-switch-thumb" aria-hidden="true" />
        </button>
      </div>
    )
  }
}

interface IWorkflowManagerProps {
  readonly workflows: ReadonlyArray<IAPIWorkflow>
  readonly busyWorkflowId: number | null
  readonly onRequestChange: (workflow: IAPIWorkflow, enabled: boolean) => void
  readonly onNewWorkflow: () => void
}

interface IWorkflowManagerState {
  /** Free-text query narrowing workflows by name or file path. */
  readonly filterText: string
}

/**
 * Filled inset card listing every workflow in the repository with an
 * enable/disable switch per row, a filter bar, plus the entry point into
 * the workflow template catalog.
 */
export class WorkflowManager extends React.PureComponent<
  IWorkflowManagerProps,
  IWorkflowManagerState
> {
  public state: IWorkflowManagerState = { filterText: '' }

  private onFilterChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ filterText: event.target.value })
  }

  private renderRow = (workflow: IAPIWorkflow, index: number) => (
    <WorkflowManagerRow
      key={workflow.id}
      workflow={workflow}
      busyWorkflowId={this.props.busyWorkflowId}
      index={index}
      onRequestChange={this.props.onRequestChange}
    />
  )

  public render() {
    const { workflows } = this.props
    const activeCount = workflows.filter(x => x.state === 'active').length
    const query = this.state.filterText.trim().toLowerCase()
    const visible =
      query.length === 0
        ? workflows
        : workflows.filter(workflow =>
            `${workflow.name} ${workflow.path}`.toLowerCase().includes(query)
          )

    return (
      <section
        className="actions-workflow-management"
        aria-label="Workflow manager"
      >
        <header className="actions-workflow-management-header">
          <span className="actions-workflow-management-title">
            Workflows · {activeCount} active
          </span>
          <button
            type="button"
            className="actions-new-workflow-button"
            onClick={this.props.onNewWorkflow}
            aria-haspopup="dialog"
          >
            <Octicon symbol={octicons.plus} />
            New workflow
          </button>
        </header>
        {workflows.length > 0 && (
          <div className="actions-search-row actions-workflow-filter">
            <div className="actions-search-pill">
              <Octicon symbol={octicons.search} />
              <input
                value={this.state.filterText}
                onChange={this.onFilterChanged}
                placeholder="Filter workflows by name or file…"
                spellCheck={false}
                aria-label="Filter workflows"
              />
            </div>
          </div>
        )}
        {workflows.length === 0 ? (
          <p className="actions-workflow-management-empty">
            No workflows yet — start from a template.
          </p>
        ) : visible.length === 0 ? (
          <p className="actions-workflow-management-empty">
            No workflows match the current filter.
          </p>
        ) : (
          visible.map(this.renderRow)
        )}
      </section>
    )
  }
}
