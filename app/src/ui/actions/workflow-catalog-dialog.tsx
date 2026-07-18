import * as React from 'react'
import * as Path from 'path'
import classNames from 'classnames'
import { access, mkdir, writeFile } from 'fs/promises'
import { Repository } from '../../models/repository'
import { IAPIWorkflow } from '../../lib/api'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { trapActionsDialogFocus } from './actions-dialog-focus'
import {
  IWorkflowTemplate,
  WorkflowTemplateCategories,
  WorkflowTemplateCategory,
  WorkflowTemplates,
} from './workflow-templates'

/** localStorage key used to persist the template search filter mode. */
const WorkflowCatalogFilterListId = 'actions-workflow-catalog'

// Two keys so fuzzy mode (which only scores the first two) still matches on
// every field: the template name is the "title" and the rest fold into the
// "subtitle". Substring / regex modes test every key.
const getTemplateSearchKeys = (
  template: IWorkflowTemplate
): ReadonlyArray<string> => [
  template.name,
  `${template.path} ${template.category} ${template.trigger} ${template.description}`,
]

interface IWorkflowCatalogDialogProps {
  readonly repository: Repository
  /** Workflows GitHub already reports so their templates read as installed. */
  readonly workflows: ReadonlyArray<IAPIWorkflow>
  /** Branch name shown in the subtitle, e.g. the current branch. */
  readonly branchName: string
  readonly onTemplateAdded: (
    template: IWorkflowTemplate,
    alreadyExisted: boolean
  ) => void
  readonly onDismissed: () => void
}

interface IWorkflowCatalogDialogState {
  readonly query: string
  readonly queryMode: FilterMode
  readonly queryCaseSensitive: boolean
  readonly filtersOpen: boolean
  readonly categories: ReadonlyArray<WorkflowTemplateCategory>
  readonly installedPaths: ReadonlyArray<string>
  readonly busyId: string | null
  readonly error: Error | null
}

/**
 * The "New workflow" catalog: a curated grid of GitHub starter workflows
 * that can be written straight into the repository's .github/workflows/.
 */
export class WorkflowCatalogDialog extends React.Component<
  IWorkflowCatalogDialogProps,
  IWorkflowCatalogDialogState
> {
  private dialog: HTMLDivElement | null = null
  private previousFocus: HTMLElement | null = null
  private unmounted = false

  public constructor(props: IWorkflowCatalogDialogProps) {
    super(props)
    this.state = {
      query: '',
      queryMode: readPersistedFilterMode(WorkflowCatalogFilterListId),
      queryCaseSensitive: false,
      filtersOpen: false,
      categories: [],
      installedPaths: props.workflows
        .map(workflow => workflow.path)
        .filter(path =>
          WorkflowTemplates.some(template => template.path === path)
        ),
      busyId: null,
      error: null,
    }
  }

  public componentDidMount() {
    this.previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    this.dialog?.focus()
    void this.detectExistingTemplates()
  }

  public componentWillUnmount() {
    this.unmounted = true
    if (this.previousFocus?.isConnected) {
      this.previousFocus.focus()
    }
  }

  private setDialogRef = (dialog: HTMLDivElement | null) => {
    this.dialog = dialog
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Keys pressed inside the regex builder overlay belong to the builder: it
    // dismisses itself on Escape via a window-level listener that would never
    // fire past this handler's stopPropagation.
    if (
      event.target instanceof Element &&
      event.target.closest('.regex-builder-overlay') !== null
    ) {
      return
    }
    event.stopPropagation()
    trapActionsDialogFocus(event, event.currentTarget)
    if (event.key === 'Escape' && this.state.busyId === null) {
      event.preventDefault()
      this.props.onDismissed()
    }
  }

  private templateFilePath(template: IWorkflowTemplate) {
    return Path.join(
      this.props.repository.path,
      '.github',
      'workflows',
      template.file
    )
  }

  private async fileExists(path: string) {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }

  private async detectExistingTemplates() {
    const checks = await Promise.all(
      WorkflowTemplates.map(async template => ({
        template,
        exists: await this.fileExists(this.templateFilePath(template)),
      }))
    )
    if (this.unmounted) {
      return
    }
    const existing = checks.filter(x => x.exists).map(x => x.template.path)
    if (existing.length > 0) {
      this.setState(state => ({
        installedPaths: [...new Set([...state.installedPaths, ...existing])],
      }))
    }
  }

  private onQueryChange = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ query: event.currentTarget.value })

  private onQueryModeChange = (queryMode: FilterMode) => {
    persistFilterMode(WorkflowCatalogFilterListId, queryMode)
    this.setState({ queryMode })
  }

  private onQueryCaseSensitiveChange = (queryCaseSensitive: boolean) =>
    this.setState({ queryCaseSensitive })

  private onQueryPatternApply = (query: string) => this.setState({ query })

  private getQuerySampleItems = (): ReadonlyArray<string> =>
    WorkflowTemplates.flatMap(getTemplateSearchKeys)

  private getVisibleTemplates(): {
    readonly templates: ReadonlyArray<IWorkflowTemplate>
    readonly regexError: string | null
  } {
    const { categories } = this.state
    const candidates = WorkflowTemplates.filter(
      template =>
        categories.length === 0 || categories.includes(template.category)
    )
    const query = this.state.query.trim()
    if (query.length === 0) {
      return { templates: candidates, regexError: null }
    }
    const { results, regexError } = matchWithMode(
      query,
      candidates,
      getTemplateSearchKeys,
      {
        mode: this.state.queryMode,
        caseSensitive: this.state.queryCaseSensitive,
      }
    )
    return { templates: results.map(r => r.item), regexError }
  }

  private toggleFilters = () =>
    this.setState(state => ({ filtersOpen: !state.filtersOpen }))

  private onCategoryChipClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const category = event.currentTarget.dataset
      .category as WorkflowTemplateCategory
    this.setState(state => ({
      categories: state.categories.includes(category)
        ? state.categories.filter(x => x !== category)
        : [...state.categories, category],
    }))
  }

  private onUseWorkflow = async (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const id = event.currentTarget.dataset.templateId
    const template = WorkflowTemplates.find(x => x.id === id)
    if (template === undefined || this.state.busyId !== null) {
      return
    }
    this.setState({ busyId: template.id, error: null })
    try {
      const directory = Path.join(
        this.props.repository.path,
        '.github',
        'workflows'
      )
      await mkdir(directory, { recursive: true })
      const filePath = this.templateFilePath(template)
      const alreadyExisted = await this.fileExists(filePath)
      if (!alreadyExisted) {
        await writeFile(filePath, template.yaml)
      }
      if (this.unmounted) {
        return
      }
      this.setState(state => ({
        busyId: null,
        installedPaths: [...new Set([...state.installedPaths, template.path])],
      }))
      this.props.onTemplateAdded(template, alreadyExisted)
    } catch (error) {
      if (!this.unmounted) {
        this.setState({
          busyId: null,
          error: error instanceof Error ? error : new Error(String(error)),
        })
      }
    }
  }

  private renderCategoryChip = (category: WorkflowTemplateCategory) => {
    const on = this.state.categories.includes(category)
    return (
      <button
        key={category}
        type="button"
        className={classNames('actions-filter-chip', { on })}
        aria-pressed={on}
        data-category={category}
        onClick={this.onCategoryChipClick}
      >
        {on && <Octicon symbol={octicons.check} />}
        {category}
      </button>
    )
  }

  private renderTemplate = (template: IWorkflowTemplate, index: number) => {
    const installed = this.state.installedPaths.includes(template.path)
    const busy = this.state.busyId === template.id
    const style = { animationDelay: `${Math.min(index, 9) * 40}ms` }
    return (
      <article
        className="workflow-template-card"
        key={template.id}
        style={style}
      >
        <header>
          <span
            className={classNames(
              'workflow-template-icon',
              `category-${template.category.toLowerCase()}`
            )}
            aria-hidden="true"
          >
            <Octicon symbol={template.icon} />
          </span>
          <span className="workflow-template-text">
            <strong>{template.name}</strong>
            <span className="workflow-template-file">{template.path}</span>
          </span>
          <span className="workflow-template-category">
            {template.category}
          </span>
        </header>
        <p className="workflow-template-description">{template.description}</p>
        <footer>
          <span className="workflow-template-trigger">
            <Octicon symbol={octicons.zap} />
            {template.trigger}
          </span>
          {installed ? (
            <span className="workflow-template-added">
              <Octicon symbol={octicons.check} />
              Added
            </span>
          ) : (
            <button
              type="button"
              className="workflow-template-use"
              data-template-id={template.id}
              onClick={this.onUseWorkflow}
              disabled={this.state.busyId !== null}
              aria-label={`Use workflow template: ${template.name}`}
            >
              <Octicon symbol={octicons.plus} />
              {busy ? 'Adding…' : 'Use workflow'}
            </button>
          )}
        </footer>
      </article>
    )
  }

  public render() {
    const { query, filtersOpen } = this.state
    const { templates: visible, regexError } = this.getVisibleTemplates()
    return (
      <div className="actions-dialog-layer">
        {/* The dialog handles Escape and focus wrap from any descendant. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <div
          className="workflow-catalog-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workflow-catalog-title"
          tabIndex={-1}
          ref={this.setDialogRef}
          onKeyDown={this.onKeyDown}
        >
          <header className="workflow-catalog-header">
            <span className="workflow-catalog-glyph" aria-hidden="true">
              <Octicon symbol={octicons.workflow} />
            </span>
            <div className="workflow-catalog-heading">
              <h2 id="workflow-catalog-title">New workflow</h2>
              <span className="workflow-catalog-subtitle">
                GitHub starter workflow catalog — pick a template and it lands
                in .github/workflows/ on {this.props.branchName}
              </span>
            </div>
            <button
              type="button"
              className="actions-icon-button workflow-catalog-close"
              onClick={this.props.onDismissed}
              aria-label="Close new workflow dialog"
            >
              <Octicon symbol={octicons.x} />
            </button>
          </header>
          {this.state.error && (
            <div className="actions-inline-error" role="alert">
              {this.state.error.message}
            </div>
          )}
          <div className="workflow-catalog-search">
            <div
              className={classNames(
                'actions-search-pill',
                'workflow-catalog-search-pill',
                { invalid: regexError !== null }
              )}
            >
              <Octicon symbol={octicons.search} />
              <input
                value={query}
                onChange={this.onQueryChange}
                placeholder="Search templates — try node, docker, pages…"
                spellCheck={false}
                aria-label="Search workflow templates"
              />
              <FilterModeControl
                mode={this.state.queryMode}
                caseSensitive={this.state.queryCaseSensitive}
                onModeChange={this.onQueryModeChange}
                onCaseSensitiveChange={this.onQueryCaseSensitiveChange}
                regexBuilderTarget="Workflow templates"
                getSampleItems={this.getQuerySampleItems}
                filterText={query}
                onRegexPatternApply={this.onQueryPatternApply}
              />
              <button
                type="button"
                className={classNames('actions-search-toggle', {
                  on: filtersOpen,
                })}
                aria-pressed={filtersOpen}
                aria-expanded={filtersOpen}
                aria-label="Search filters"
                onClick={this.toggleFilters}
              >
                <Octicon symbol={octicons.filter} />
              </button>
            </div>
            {filtersOpen && (
              <div
                className="actions-filter-chips"
                role="group"
                aria-label="Template categories"
              >
                {WorkflowTemplateCategories.map(this.renderCategoryChip)}
              </div>
            )}
          </div>
          <div className="workflow-catalog-grid">
            {visible.map(this.renderTemplate)}
            {visible.length === 0 && (
              <div className="workflow-catalog-empty" role="status">
                <Octicon symbol={octicons.filterRemove} />
                <div>No templates match your search or filters</div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }
}
