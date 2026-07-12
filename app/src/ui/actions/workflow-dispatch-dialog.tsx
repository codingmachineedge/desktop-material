import * as React from 'react'
import { GitHubRepository } from '../../models/github-repository'
import { IAPIWorkflow } from '../../lib/api'
import {
  IWorkflowDispatchDefinition,
  IWorkflowDispatchInput,
  parseFreeformWorkflowInputs,
  parseWorkflowDispatchInputs,
} from '../../lib/actions-workflow-inputs'
import { ActionsStore } from '../../lib/stores/actions-store'
import { Button } from '../lib/button'
import { Select } from '../lib/select'

interface IWorkflowDispatchDialogProps {
  readonly repository: GitHubRepository
  readonly workflows: ReadonlyArray<IAPIWorkflow>
  readonly initialWorkflowId: number | null
  readonly branchNames: ReadonlyArray<string>
  readonly initialRef: string
  readonly actionsStore: ActionsStore
  readonly onSubmit: (
    workflowId: number,
    ref: string,
    inputs: Readonly<Record<string, string>>
  ) => Promise<void>
  readonly onDismissed: () => void
}

interface IWorkflowDispatchDialogState {
  readonly workflowId: number
  readonly ref: string
  readonly loadingDefinition: boolean
  readonly definition: IWorkflowDispatchDefinition | null
  readonly values: Readonly<Record<string, string>>
  readonly freeform: string
  readonly submitting: boolean
  readonly error: Error | null
}

export class WorkflowDispatchDialog extends React.Component<
  IWorkflowDispatchDialogProps,
  IWorkflowDispatchDialogState
> {
  public constructor(props: IWorkflowDispatchDialogProps) {
    super(props)
    const workflowId =
      props.workflows.find(x => x.id === props.initialWorkflowId)?.id ??
      props.workflows[0]?.id ??
      0
    this.state = {
      workflowId,
      ref: props.initialRef || props.branchNames[0] || 'main',
      loadingDefinition: false,
      definition: null,
      values: {},
      freeform: '',
      submitting: false,
      error: null,
    }
  }

  public componentDidMount() {
    this.loadDefinition()
  }

  private async loadDefinition() {
    const workflow = this.props.workflows.find(
      item => item.id === this.state.workflowId
    )
    if (workflow === undefined) {
      return
    }
    this.setState({ loadingDefinition: true, definition: null, error: null })
    try {
      const source = await this.props.actionsStore.fetchWorkflowSource(
        this.props.repository,
        workflow
      )
      const definition = parseWorkflowDispatchInputs(source)
      const values: Record<string, string> = {}
      for (const input of definition.inputs) {
        values[input.name] =
          input.defaultValue ||
          (input.type === 'choice' ? input.options[0] ?? '' : '')
      }
      this.setState({ definition, values, loadingDefinition: false })
    } catch (error) {
      this.setState({
        definition: {
          available: false,
          inputs: [],
          error: error instanceof Error ? error : new Error(String(error)),
        },
        loadingDefinition: false,
      })
    }
  }

  private onWorkflowChange = (event: React.FormEvent<HTMLSelectElement>) => {
    this.setState(
      { workflowId: Number(event.currentTarget.value) },
      this.loadDefinition
    )
  }

  private onRefChange = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({ ref: event.currentTarget.value })

  private onInputChange = (
    event: React.FormEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const input = event.currentTarget
    const value =
      input instanceof HTMLInputElement && input.type === 'checkbox'
        ? String(input.checked)
        : input.value
    this.setState({ values: { ...this.state.values, [input.name]: value } })
  }

  private onFreeformChange = (event: React.FormEvent<HTMLTextAreaElement>) =>
    this.setState({ freeform: event.currentTarget.value })

  private submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const definition = this.state.definition
    try {
      const inputs =
        definition?.available === true
          ? this.state.values
          : parseFreeformWorkflowInputs(this.state.freeform)
      for (const input of definition?.inputs ?? []) {
        if (input.required && !inputs[input.name]) {
          throw new Error(`${input.name} is required.`)
        }
      }
      this.setState({ submitting: true, error: null })
      await this.props.onSubmit(this.state.workflowId, this.state.ref, inputs)
    } catch (error) {
      this.setState({
        submitting: false,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }

  private renderInput(input: IWorkflowDispatchInput) {
    const value = this.state.values[input.name] ?? ''
    return (
      <label className="workflow-input" key={input.name}>
        <span>
          {input.name}
          {input.required && <strong> *</strong>}
        </span>
        {input.description && <small>{input.description}</small>}
        {input.type === 'choice' ? (
          <select name={input.name} value={value} onChange={this.onInputChange}>
            {input.options.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : input.type === 'boolean' ? (
          <input
            name={input.name}
            type="checkbox"
            checked={value === 'true'}
            onChange={this.onInputChange}
          />
        ) : (
          <input
            name={input.name}
            type="text"
            value={value}
            required={input.required}
            onChange={this.onInputChange}
          />
        )}
      </label>
    )
  }

  public render() {
    const { definition, loadingDefinition, submitting } = this.state
    const branchNames =
      this.props.branchNames.length > 0
        ? this.props.branchNames
        : [this.state.ref]
    return (
      <div className="actions-dialog-layer">
        <form
          className="workflow-dispatch-dialog"
          role="dialog"
          aria-modal="false"
          aria-labelledby="workflow-dispatch-title"
          onSubmit={this.submit}
        >
          <header>
            <div>
              <span className="eyebrow">workflow_dispatch</span>
              <h2 id="workflow-dispatch-title">Run workflow</h2>
            </div>
            <Button type="button" onClick={this.props.onDismissed}>
              Close
            </Button>
          </header>
          {this.state.error && (
            <div className="actions-inline-error" role="alert">
              {this.state.error.message}
            </div>
          )}
          <div className="workflow-dispatch-selects">
            <Select
              label="Workflow"
              value={String(this.state.workflowId)}
              onChange={this.onWorkflowChange}
            >
              {this.props.workflows.map(workflow => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </Select>
            <Select
              label="Git ref"
              value={this.state.ref}
              onChange={this.onRefChange}
            >
              {branchNames.map(branch => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </Select>
          </div>
          <div className="workflow-dispatch-inputs">
            {loadingDefinition ? (
              <div className="actions-loading">Reading workflow inputs…</div>
            ) : definition?.available ? (
              definition.inputs.length > 0 ? (
                definition.inputs.map(input => this.renderInput(input))
              ) : (
                <p>This workflow has no inputs.</p>
              )
            ) : (
              <label className="workflow-input">
                <span>Inputs (optional name=value lines)</span>
                <small>
                  {definition?.error?.message ??
                    'The workflow definition could not provide a generated form.'}
                </small>
                <textarea
                  value={this.state.freeform}
                  onChange={this.onFreeformChange}
                  placeholder={'environment=staging\ndry_run=false'}
                />
              </label>
            )}
          </div>
          <footer>
            <Button type="button" onClick={this.props.onDismissed}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                submitting || loadingDefinition || this.state.workflowId === 0
              }
            >
              {submitting ? 'Starting…' : 'Run workflow'}
            </Button>
          </footer>
        </form>
      </div>
    )
  }
}
