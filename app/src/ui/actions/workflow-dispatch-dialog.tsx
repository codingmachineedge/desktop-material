import * as React from 'react'
import classNames from 'classnames'
import { Repository } from '../../models/repository'
import { IAPIWorkflow } from '../../lib/api'
import {
  IWorkflowDispatchDefinition,
  IWorkflowDispatchInput,
  parseFreeformWorkflowInputs,
  parseWorkflowDispatchInputs,
} from '../../lib/actions-workflow-inputs'
import { ActionsStore } from '../../lib/stores/actions-store'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { t } from '../../lib/i18n'
import { Select } from '../lib/select'
import { TextBox } from '../lib/text-box'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { trapActionsDialogFocus } from './actions-dialog-focus'
import { getWorkflowFileName, getWorkflowGlyph } from './workflow-templates'

/** How many quick-pick ref chips the popover shows before falling back. */
export const WorkflowDispatchRefChipMaximum = 6

/**
 * Stable audit identity shared by the workflow picker's search input, filter
 * mode control, and persisted filter mode. Registered in the collection
 * surface registry.
 */
export const WorkflowDispatchPickerSearchSurfaceId = 'actions-workflow-dispatch'

interface IWorkflowDispatchDialogProps {
  readonly repository: Repository
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

  /** Free-text query narrowing the workflow list by name or file path. */
  readonly filterText: string

  /** The active fuzzy/substring/regex matching strategy. */
  readonly filterMode: FilterMode

  /** Whether substring/regex matching is case sensitive. */
  readonly filterCaseSensitive: boolean
}

export class WorkflowDispatchDialog extends React.Component<
  IWorkflowDispatchDialogProps,
  IWorkflowDispatchDialogState
> {
  private dialog: HTMLFormElement | null = null
  private previousFocus: HTMLElement | null = null

  /** Live references to each rendered option row, keyed by workflow id. */
  private readonly rowRefs = new Map<number, HTMLButtonElement>()

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
      filterText: '',
      filterMode: readPersistedFilterMode(
        WorkflowDispatchPickerSearchSurfaceId
      ),
      filterCaseSensitive: false,
    }
  }

  public componentDidMount() {
    this.previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    this.loadDefinition()
    this.dialog?.focus()
  }

  public componentWillUnmount() {
    if (this.previousFocus?.isConnected) {
      this.previousFocus.focus()
    }
  }

  private setDialogRef = (dialog: HTMLFormElement | null) => {
    this.dialog = dialog
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    event.stopPropagation()
    trapActionsDialogFocus(event, event.currentTarget)
    if (event.key === 'Escape' && !this.state.submitting) {
      event.preventDefault()
      this.props.onDismissed()
    }
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

  private selectWorkflow(workflowId: number, focusRow: boolean) {
    if (workflowId !== this.state.workflowId) {
      this.setState({ workflowId }, this.loadDefinitionCallback)
    }
    if (focusRow) {
      this.rowRefs.get(workflowId)?.focus()
    }
  }

  private onWorkflowRowClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const workflowId = Number(event.currentTarget.dataset.workflowId)
    this.selectWorkflow(workflowId, false)
  }

  private setRowRef =
    (workflowId: number) => (element: HTMLButtonElement | null) => {
      if (element === null) {
        this.rowRefs.delete(workflowId)
      } else {
        this.rowRefs.set(workflowId, element)
      }
    }

  /**
   * Arrow-key navigation for the workflow list box. Selection follows focus,
   * matching the single-select listbox pattern, and Enter commits the row that
   * already carries the roving selection.
   */
  private onWorkflowListKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    const visible = this.getVisibleWorkflows().workflows
    if (visible.length === 0) {
      return
    }
    const currentIndex = visible.findIndex(w => w.id === this.state.workflowId)
    let nextIndex: number | null = null
    switch (event.key) {
      case 'ArrowDown':
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % visible.length
        break
      case 'ArrowUp':
        nextIndex =
          currentIndex < 0
            ? visible.length - 1
            : (currentIndex - 1 + visible.length) % visible.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = visible.length - 1
        break
      case 'Enter':
      case ' ':
        if (currentIndex >= 0) {
          event.preventDefault()
          this.selectWorkflow(visible[currentIndex].id, true)
        }
        return
      default:
        return
    }
    if (nextIndex !== null) {
      event.preventDefault()
      this.selectWorkflow(visible[nextIndex].id, true)
    }
  }

  private onFilterChanged = (filterText: string) => {
    this.setState({ filterText })
  }

  private onFilterModeChanged = (filterMode: FilterMode) => {
    persistFilterMode(WorkflowDispatchPickerSearchSurfaceId, filterMode)
    this.setState({ filterMode })
  }

  private onFilterCaseSensitiveChanged = (filterCaseSensitive: boolean) =>
    this.setState({ filterCaseSensitive })

  private onFilterPatternApply = (filterText: string) =>
    this.setState({ filterText })

  private getFilterSampleItems = (): ReadonlyArray<string> =>
    this.props.workflows.flatMap(workflow => [workflow.name, workflow.path])

  private getVisibleWorkflows(): {
    readonly workflows: ReadonlyArray<IAPIWorkflow>
    readonly regexError: string | null
  } {
    const { workflows } = this.props
    const query = this.state.filterText.trim()
    if (query.length === 0) {
      return { workflows, regexError: null }
    }
    const { results, regexError } = matchWithMode(
      query,
      workflows,
      workflow => [workflow.name, workflow.path],
      {
        mode: this.state.filterMode,
        caseSensitive: this.state.filterCaseSensitive,
      }
    )
    return { workflows: results.map(r => r.item), regexError }
  }

  private loadDefinitionCallback = () => {
    void this.loadDefinition()
  }

  private onRefChipClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const ref = event.currentTarget.dataset.ref
    if (ref !== undefined) {
      this.setState({ ref })
    }
  }

  private onRefSelectChange = (event: React.FormEvent<HTMLSelectElement>) =>
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

  private renderWorkflowRow = (workflow: IAPIWorkflow) => {
    const selected = workflow.id === this.state.workflowId
    const fileName = getWorkflowFileName(workflow.path) || workflow.path
    const active = workflow.state === 'active'
    const stateLabel = active
      ? t('workflowDispatch.stateActive')
      : t('workflowDispatch.stateDisabled')
    return (
      <button
        key={workflow.id}
        type="button"
        role="option"
        id={`workflow-dispatch-option-${workflow.id}`}
        aria-selected={selected}
        ref={this.setRowRef(workflow.id)}
        tabIndex={selected ? 0 : -1}
        className={classNames('workflow-dispatch-option', { selected })}
        data-workflow-id={workflow.id}
        onClick={this.onWorkflowRowClick}
      >
        <span className="workflow-dispatch-option-icon" aria-hidden="true">
          <Octicon
            symbol={getWorkflowGlyph(`${workflow.name} ${workflow.path}`)}
          />
        </span>
        <span className="workflow-dispatch-option-text">
          <span className="workflow-dispatch-option-name">{workflow.name}</span>
          <span className="workflow-dispatch-option-file">{fileName}</span>
        </span>
        <span
          className={classNames('workflow-dispatch-option-state', {
            disabled: !active,
          })}
        >
          {stateLabel}
        </span>
      </button>
    )
  }

  private renderWorkflowPicker() {
    const { workflows } = this.props
    const { workflows: visible, regexError } = this.getVisibleWorkflows()
    return (
      <div
        className="workflow-dispatch-section"
        role="group"
        aria-labelledby="workflow-dispatch-workflow-label"
      >
        <span
          className="workflow-dispatch-label"
          id="workflow-dispatch-workflow-label"
        >
          Workflow
        </span>
        <div
          className={classNames('workflow-dispatch-search', {
            invalid: regexError !== null,
          })}
        >
          <Octicon symbol={octicons.search} />
          <TextBox
            searchSurfaceId="actions-workflow-dispatch"
            className="workflow-dispatch-search-input"
            type="search"
            value={this.state.filterText}
            onValueChanged={this.onFilterChanged}
            placeholder={t('workflowDispatch.searchPlaceholder')}
            ariaLabel={t('workflowDispatch.searchAriaLabel')}
            ariaControls="workflow-dispatch-listbox"
            spellcheck={false}
          />
          <FilterModeControl
            searchSurfaceId="actions-workflow-dispatch"
            mode={this.state.filterMode}
            caseSensitive={this.state.filterCaseSensitive}
            onModeChange={this.onFilterModeChanged}
            onCaseSensitiveChange={this.onFilterCaseSensitiveChanged}
            regexBuilderTarget="Workflows"
            getSampleItems={this.getFilterSampleItems}
            filterText={this.state.filterText}
            onRegexPatternApply={this.onFilterPatternApply}
          />
        </div>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className="workflow-dispatch-listbox"
          id="workflow-dispatch-listbox"
          role="listbox"
          tabIndex={0}
          aria-label={t('workflowDispatch.listAriaLabel')}
          aria-activedescendant={
            this.state.workflowId !== 0
              ? `workflow-dispatch-option-${this.state.workflowId}`
              : undefined
          }
          onKeyDown={this.onWorkflowListKeyDown}
        >
          {workflows.length === 0 ? (
            <p className="workflow-dispatch-list-empty">
              {t('workflowDispatch.empty')}
            </p>
          ) : visible.length === 0 ? (
            <p className="workflow-dispatch-list-empty">
              {t('workflowDispatch.noMatches')}
            </p>
          ) : (
            visible.map(this.renderWorkflowRow)
          )}
        </div>
      </div>
    )
  }

  private renderRefChip = (ref: string) => {
    const on = ref === this.state.ref
    return (
      <button
        key={ref}
        type="button"
        className={classNames('workflow-dispatch-chip', { on })}
        aria-pressed={on}
        aria-label={`Run on ref: ${ref}`}
        data-ref={ref}
        onClick={this.onRefChipClick}
      >
        {ref}
      </button>
    )
  }

  private renderInput(input: IWorkflowDispatchInput) {
    const value = this.state.values[input.name] ?? ''
    return (
      <label className="workflow-input" key={input.name}>
        <span className="workflow-dispatch-label">
          Input · {input.name}
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
            placeholder={`Value for ${input.name}`}
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
    const refChips = [
      ...new Set([this.props.initialRef, this.state.ref, ...branchNames]),
    ]
      .filter(x => x.length > 0)
      .slice(0, WorkflowDispatchRefChipMaximum)
    const hasMoreRefs = branchNames.some(x => !refChips.includes(x))
    return (
      <div className="actions-dialog-layer">
        {/* The form dialog handles Escape from any descendant control. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <form
          className="workflow-dispatch-dialog workflow-dispatch-popover"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workflow-dispatch-title"
          tabIndex={-1}
          ref={this.setDialogRef}
          onKeyDown={this.onKeyDown}
          onSubmit={this.submit}
        >
          <header className="workflow-dispatch-header">
            <h2 id="workflow-dispatch-title">Run workflow</h2>
            <button
              type="button"
              className="actions-icon-button workflow-dispatch-close"
              onClick={this.props.onDismissed}
              aria-label="Close run workflow dialog"
            >
              <Octicon symbol={octicons.x} />
            </button>
          </header>
          {this.state.error && (
            <div className="actions-inline-error" role="alert">
              {this.state.error.message}
            </div>
          )}
          {this.renderWorkflowPicker()}
          <div
            className="workflow-dispatch-section"
            role="group"
            aria-labelledby="workflow-dispatch-ref-label"
          >
            <span
              className="workflow-dispatch-label"
              id="workflow-dispatch-ref-label"
            >
              Run on ref
            </span>
            <div className="workflow-dispatch-chips">
              {refChips.map(this.renderRefChip)}
            </div>
            {hasMoreRefs && (
              <Select
                label="All refs"
                value={this.state.ref}
                onChange={this.onRefSelectChange}
              >
                {branchNames.map(branch => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className="workflow-dispatch-inputs">
            {loadingDefinition ? (
              <div className="actions-loading">Reading workflow inputs…</div>
            ) : definition?.available ? (
              definition.inputs.length > 0 ? (
                definition.inputs.map(input => this.renderInput(input))
              ) : (
                <p className="workflow-dispatch-no-inputs">
                  This workflow has no inputs.
                </p>
              )
            ) : (
              <label className="workflow-input">
                <span className="workflow-dispatch-label">
                  Inputs (optional name=value lines)
                </span>
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
          <button
            type="submit"
            className="workflow-dispatch-run-button"
            disabled={
              submitting || loadingDefinition || this.state.workflowId === 0
            }
          >
            <Octicon symbol={octicons.play} />
            {submitting ? 'Starting…' : 'Run workflow'}
          </button>
        </form>
      </div>
    )
  }
}
