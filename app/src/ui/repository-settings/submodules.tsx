import * as React from 'react'
import { DialogContent } from '../dialog'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { IManagedSubmodule, SubmoduleStatusKind } from '../../lib/git'
import { Button } from '../lib/button'
import { Loading } from '../lib/loading'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { TooltippedContent } from '../lib/tooltipped-content'
import { PopupType } from '../../models/popup'
import { TextBox } from '../lib/text-box'
import {
  SubmoduleStatusFilter,
  filterSubmodules,
} from '../../lib/submodules/submodule-filter'
import { FilterMode, matchWithMode } from '../../lib/fuzzy-find'
import { FilterModeControl } from '../lib/filter-mode-control'
import {
  persistFilterMode,
  readPersistedFilterMode,
} from '../lib/filter-list-mode'
import {
  t,
  translate,
  translateForAccessibleName,
  TranslationKey,
  TranslationVariables,
} from '../../lib/i18n'
import { LocalizedText } from '../lib/localized-text'
import { IAppearanceCustomization } from '../../models/appearance-customization'
import { SubmoduleBackButton } from '../submodules/submodule-back-button'
import { ProfileAppearanceElementId } from '../../models/element-appearance'

interface ISubmodulesProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  /** Dismisses only the popup which owns this submodule surface. */
  readonly onRepositoryOpened: () => void
  /** Staged active-profile appearance, supplied by Repository Settings. */
  readonly appearanceCustomization?: IAppearanceCustomization
  /** Stages a profile appearance change until Repository Settings is saved. */
  readonly onAppearanceCustomizationChanged?: (
    customization: IAppearanceCustomization
  ) => void
}

interface ISubmodulesState {
  /** The reconciled submodules, or null until the first load resolves. */
  readonly submodules: ReadonlyArray<IManagedSubmodule> | null

  /** True while the submodule list is (re)loading. */
  readonly isLoading: boolean

  /** The paths of submodules with an in-flight per-row operation. */
  readonly busyPaths: ReadonlySet<string>

  /** True while an "Update all" operation spanning the repo runs. */
  readonly isBusyGlobal: boolean

  /** True while opening and initially refreshing a temporary child repo. */
  readonly isOpeningRepository: boolean

  /** The latest streamed progress line from an update, if any. */
  readonly progress: string | null

  /** The most recent operation error, surfaced inline. */
  readonly error: ILocalizedSubmoduleMessage | null

  /** Free-text query narrowing the list by name, path, or URL. */
  readonly filterText: string

  /** The text-match strategy for the search field. */
  readonly filterMode: FilterMode

  /** Whether Substring / Regex matching is case sensitive. */
  readonly filterCaseSensitive: boolean

  /** Status scope narrowing the list. */
  readonly statusFilter: SubmoduleStatusFilter
}

interface ILocalizedSubmoduleMessage {
  readonly key: TranslationKey
  readonly variables?: TranslationVariables
}

/** The per-surface persistence id for the submodule search's filter mode. */
const SubmodulesFilterId = 'submodule-manager'

const StatusFilterLabels: ReadonlyArray<{
  readonly key: SubmoduleStatusFilter
  readonly labelKey: TranslationKey
}> = [
  { key: 'all', labelKey: 'submodule.filterAll' },
  { key: 'cloned', labelKey: 'submodule.filterCloned' },
  { key: 'uncloned', labelKey: 'submodule.filterNotCloned' },
  { key: 'out-of-date', labelKey: 'submodule.filterOutOfDate' },
  { key: 'conflicted', labelKey: 'submodule.filterConflicted' },
]

/** The user-facing label for each submodule status kind. */
const StatusLabelKey: Record<SubmoduleStatusKind, TranslationKey> = {
  uninitialized: 'submodule.statusUninitialized',
  'up-to-date': 'submodule.statusUpToDate',
  'out-of-date': 'submodule.statusOutOfDate',
  conflicted: 'submodule.statusConflicted',
}

/**
 * The Repository Settings "Submodules" tab.
 *
 * Lists the repository's submodules (path, URL, tracked branch, current SHA and
 * working-tree status) and offers add / update / sync / remove actions plus an
 * "Update all". Every action routes through the {@link Dispatcher}; results are
 * reflected by reloading the list. Unlike the other settings tabs these
 * operations apply immediately rather than being deferred to the dialog's Save
 * button.
 */
export class Submodules extends React.Component<
  ISubmodulesProps,
  ISubmodulesState
> {
  private mounted = false

  /**
   * Synchronously fences action callbacks before the state update which
   * disables their controls has rendered.
   */
  private openTransitionInFlight = false

  public constructor(props: ISubmodulesProps) {
    super(props)
    this.state = {
      submodules: null,
      isLoading: true,
      busyPaths: new Set<string>(),
      isBusyGlobal: false,
      isOpeningRepository: false,
      progress: null,
      error: null,
      filterText: '',
      filterMode: readPersistedFilterMode(SubmodulesFilterId),
      filterCaseSensitive: false,
      statusFilter: 'all',
    }
  }

  private onFilterTextChanged = (filterText: string) => {
    this.setState({ filterText })
  }

  private onFilterModeChanged = (filterMode: FilterMode) => {
    persistFilterMode(SubmodulesFilterId, filterMode)
    this.setState({ filterMode })
  }

  private onFilterCaseSensitiveChanged = (filterCaseSensitive: boolean) => {
    this.setState({ filterCaseSensitive })
  }

  private onRegexPatternApply = (pattern: string) => {
    this.setState({ filterText: pattern })
  }

  private getFilterSampleItems = (): ReadonlyArray<string> =>
    (this.state.submodules ?? []).map(submodule =>
      [submodule.path, submodule.url].filter(Boolean).join(' · ')
    )

  private onStatusChipClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const key = event.currentTarget.dataset.statusFilter
    const entry = StatusFilterLabels.find(value => value.key === key)
    if (entry !== undefined) {
      this.setState({ statusFilter: entry.key })
    }
  }

  public componentDidMount() {
    this.mounted = true
    this.loadSubmodules()
  }

  public componentWillUnmount() {
    this.mounted = false
  }

  private loadSubmodules = async () => {
    this.setState({ isLoading: true })
    try {
      const submodules = await this.props.dispatcher.getSubmodules(
        this.props.repository
      )
      this.setState({ submodules, isLoading: false })
    } catch (e) {
      log.error(
        `Submodules: unable to list submodules for ${this.props.repository.path}`,
        e
      )
      this.setState({
        submodules: [],
        isLoading: false,
        error: {
          key: 'submodule.listFailed',
          variables: { error: String(e) },
        },
      })
    }
  }

  private setPathBusy(path: string, busy: boolean) {
    this.setState(prev => {
      const busyPaths = new Set(prev.busyPaths)
      if (busy) {
        busyPaths.add(path)
      } else {
        busyPaths.delete(path)
      }
      return { busyPaths }
    })
  }

  private onProgress = (line: string) => {
    this.setState({ progress: line })
  }

  private onUpdateAll = async () => {
    if (this.openTransitionInFlight) {
      return
    }

    this.setState({ isBusyGlobal: true, error: null, progress: null })
    try {
      await this.props.dispatcher.updateSubmodules(
        this.props.repository,
        undefined,
        this.onProgress
      )
      await this.loadSubmodules()
    } catch (e) {
      this.setState({
        error: {
          key: 'submodule.updateAllFailed',
          variables: { error: String(e) },
        },
      })
    } finally {
      this.setState({ isBusyGlobal: false, progress: null })
    }
  }

  private onUpdate = async (submodule: IManagedSubmodule) => {
    if (this.openTransitionInFlight) {
      return
    }

    this.setPathBusy(submodule.path, true)
    this.setState({ error: null, progress: null })
    try {
      await this.props.dispatcher.updateSubmodules(
        this.props.repository,
        [submodule.path],
        this.onProgress
      )
      await this.loadSubmodules()
    } catch (e) {
      this.setState({
        error: {
          key: 'submodule.updateFailed',
          variables: { path: submodule.path, error: String(e) },
        },
      })
    } finally {
      this.setPathBusy(submodule.path, false)
      this.setState({ progress: null })
    }
  }

  private onSyncSubmodule = async (submodule: IManagedSubmodule) => {
    if (this.openTransitionInFlight) {
      return
    }

    this.setPathBusy(submodule.path, true)
    this.setState({ error: null })
    try {
      await this.props.dispatcher.syncSubmodules(this.props.repository, [
        submodule.path,
      ])
      await this.loadSubmodules()
    } catch (e) {
      this.setState({
        error: {
          key: 'submodule.syncFailed',
          variables: { path: submodule.path, error: String(e) },
        },
      })
    } finally {
      this.setPathBusy(submodule.path, false)
    }
  }

  private onRemove = async (submodule: IManagedSubmodule) => {
    if (this.openTransitionInFlight) {
      return
    }

    this.setPathBusy(submodule.path, true)
    this.setState({ error: null })
    try {
      await this.props.dispatcher.removeSubmodule(
        this.props.repository,
        submodule.path,
        submodule.name
      )
      await this.loadSubmodules()
    } catch (e) {
      this.setState({
        error: {
          key: 'submodule.removeFailed',
          variables: { path: submodule.path, error: String(e) },
        },
      })
    } finally {
      this.setPathBusy(submodule.path, false)
    }
  }

  private onShowAddSubmodule = () => {
    if (this.openTransitionInFlight) {
      return
    }

    this.props.dispatcher.showPopup({
      type: PopupType.AddSubmodule,
      repository: this.props.repository,
      onAdded: this.loadSubmodules,
    })
  }

  private onConfigure = (submodule: IManagedSubmodule) => {
    if (this.openTransitionInFlight) {
      return
    }

    this.props.dispatcher.showPopup({
      type: PopupType.SubmoduleConfig,
      repository: this.props.repository,
      submodule,
    })
  }

  private onOpenAsRepository = async (submodule: IManagedSubmodule) => {
    if (this.openTransitionInFlight) {
      return
    }

    this.openTransitionInFlight = true
    this.setState({ isOpeningRepository: true, error: null })

    let didOpen = false
    try {
      await this.props.dispatcher.openSubmoduleAsRepository(
        this.props.repository,
        submodule
      )
      didOpen = true
    } catch (error) {
      if (this.mounted) {
        this.setState({
          error: {
            key: 'submodule.openFailed',
            variables: {
              child: submodule.path,
              error: String(error),
            },
          },
        })
      }
    } finally {
      this.openTransitionInFlight = false
      if (this.mounted) {
        this.setState({ isOpeningRepository: false })
      }
    }

    if (didOpen && this.mounted) {
      this.props.onRepositoryOpened()
    }
  }

  private renderSummary(): JSX.Element | null {
    const { submodules } = this.state
    if (submodules === null || submodules.length === 0) {
      return null
    }

    const uncloned = submodules.filter(s => s.status === 'uninitialized').length
    const cloned = submodules.length - uncloned

    return (
      <div className="submodules-summary" role="status">
        <span className="submodules-summary-chip">
          <LocalizedText
            translationKey={
              submodules.length === 1
                ? 'submodule.summarySingle'
                : 'submodule.summaryMultiple'
            }
            variables={{ count: String(submodules.length) }}
          />
        </span>
        <span className="submodules-summary-chip submodules-summary-cloned">
          <LocalizedText
            translationKey="submodule.summaryCloned"
            variables={{ count: String(cloned) }}
          />
        </span>
        {uncloned > 0 && (
          <span className="submodules-summary-chip submodules-summary-uncloned">
            <LocalizedText
              translationKey="submodule.summaryNotCloned"
              variables={{ count: String(uncloned) }}
            />
          </span>
        )}
      </div>
    )
  }

  private renderStatusPill(submodule: IManagedSubmodule): JSX.Element {
    const className = `submodule-status submodule-status-${submodule.status}`
    return (
      <span className={className}>
        <LocalizedText translationKey={StatusLabelKey[submodule.status]} />
      </span>
    )
  }

  private renderRow(submodule: IManagedSubmodule): JSX.Element {
    const isBusy =
      this.state.busyPaths.has(submodule.path) ||
      this.state.isBusyGlobal ||
      this.state.isOpeningRepository

    return (
      <SubmoduleRow
        key={submodule.path}
        submodule={submodule}
        isBusy={isBusy}
        statusPill={this.renderStatusPill(submodule)}
        onUpdate={this.onUpdate}
        onOpenAsRepository={this.onOpenAsRepository}
        onSyncSubmodule={this.onSyncSubmodule}
        onConfigure={this.onConfigure}
        onRemove={this.onRemove}
      />
    )
  }

  private renderFilterControls(): JSX.Element | null {
    const { submodules } = this.state
    if (submodules === null || submodules.length === 0) {
      return null
    }

    return (
      <div className="submodules-filter-row">
        <div className="submodules-filter-search">
          <TextBox
            searchSurfaceId="submodules"
            className="submodules-filter-text"
            placeholder={t('submodule.searchPlaceholder')}
            ariaLabel={translateForAccessibleName('submodule.searchAriaLabel')}
            value={this.state.filterText}
            onValueChanged={this.onFilterTextChanged}
          />
          <FilterModeControl
            searchSurfaceId="submodules"
            mode={this.state.filterMode}
            caseSensitive={this.state.filterCaseSensitive}
            onModeChange={this.onFilterModeChanged}
            onCaseSensitiveChange={this.onFilterCaseSensitiveChanged}
            regexBuilderTarget={translateForAccessibleName('submodule.title')}
            getSampleItems={this.getFilterSampleItems}
            filterText={this.state.filterText}
            onRegexPatternApply={this.onRegexPatternApply}
          />
        </div>
        <div
          className="submodules-filter-chips"
          role="group"
          aria-label={translateForAccessibleName('submodule.filterByStatus')}
        >
          {StatusFilterLabels.map(({ key, labelKey }) => (
            <button
              type="button"
              key={key}
              data-status-filter={key}
              className={
                this.state.statusFilter === key
                  ? 'submodules-filter-chip selected'
                  : 'submodules-filter-chip'
              }
              aria-pressed={this.state.statusFilter === key}
              aria-label={translateForAccessibleName(labelKey)}
              onClick={this.onStatusChipClick}
            >
              <LocalizedText translationKey={labelKey} />
            </button>
          ))}
        </div>
      </div>
    )
  }

  private getVisibleSubmodules(
    submodules: ReadonlyArray<IManagedSubmodule>
  ): ReadonlyArray<IManagedSubmodule> {
    const { filterText, filterMode, filterCaseSensitive, statusFilter } =
      this.state
    const statusMatches = filterSubmodules(submodules, '', statusFilter)
    const query = filterText.trim()

    if (query.length === 0) {
      return statusMatches
    }

    // Fuzzy matching only scores the first two keys, so name and URL fold
    // into the second one; Substring / Regex modes test each key.
    const { results } = matchWithMode(
      query,
      statusMatches,
      submodule => [submodule.path, `${submodule.name} ${submodule.url ?? ''}`],
      { mode: filterMode, caseSensitive: filterCaseSensitive }
    )

    return results.map(result => result.item)
  }

  private onBackAppearanceHistoryMutation = () => {
    const onChanged = this.props.onAppearanceCustomizationChanged
    const current = this.props.appearanceCustomization
    const getElement = this.props.dispatcher.getProfileAppearanceElement
    if (
      onChanged === undefined ||
      current === undefined ||
      !this.isElementAppearanceCoordinatorReady() ||
      typeof getElement !== 'function'
    ) {
      return
    }
    const restored = getElement.call(
      this.props.dispatcher,
      ProfileAppearanceElementId.SubmoduleBackButton
    )
    onChanged({ ...current, ...restored })
  }

  /**
   * Repository Settings is also rendered with deliberately minimal dispatcher
   * doubles in unit and embedding contexts. Treat the element coordinator as
   * an optional capability there; the production Dispatcher always provides
   * it after startup.
   */
  private isElementAppearanceCoordinatorReady(): boolean {
    const isReady = this.props.dispatcher.isElementAppearanceCoordinatorReady
    return (
      typeof isReady === 'function' &&
      isReady.call(this.props.dispatcher) === true
    )
  }

  private getBackAppearanceHistorySource() {
    const getHistory = this.props.dispatcher.getProfileAppearanceHistorySource
    return this.isElementAppearanceCoordinatorReady() &&
      typeof getHistory === 'function'
      ? getHistory.call(
          this.props.dispatcher,
          ProfileAppearanceElementId.SubmoduleBackButton
        )
      : undefined
  }

  private getBackAppearanceRepositoryPath(): string | undefined {
    const getPath = this.props.dispatcher.getProfileAppearanceRepositoryPath
    return this.isElementAppearanceCoordinatorReady() &&
      typeof getPath === 'function'
      ? getPath.call(
          this.props.dispatcher,
          ProfileAppearanceElementId.SubmoduleBackButton
        )
      : undefined
  }

  private renderAppearanceCustomizer(): JSX.Element | null {
    const customization = this.props.appearanceCustomization
    if (
      customization === undefined ||
      this.props.onAppearanceCustomizationChanged === undefined
    ) {
      return null
    }

    const mode = customization.languageMode
    const localize = (key: TranslationKey) => translate(key, mode)
    const parentName = this.props.repository.alias ?? this.props.repository.name

    return (
      <section
        className="submodule-appearance-customizer"
        aria-labelledby="submodule-appearance-heading"
      >
        <div className="submodule-appearance-copy">
          <h3 id="submodule-appearance-heading">
            <Octicon symbol={octicons.paintbrush} />
            {localize('submodule.appearanceHeading')}
          </h3>
          <p>{localize('submodule.appearanceDescription')}</p>
        </div>
        <div
          className="submodule-appearance-preview"
          role="group"
          aria-label={translateForAccessibleName(
            'submodule.appearancePreview',
            {},
            mode
          )}
        >
          <span className="submodule-appearance-preview-title">
            {localize('submodule.appearancePreview')}
          </span>
          <div className="submodule-repository-context">
            <SubmoduleBackButton
              appearanceCustomization={customization}
              parentName={parentName}
              onAppearanceCustomizationChanged={
                this.props.onAppearanceCustomizationChanged
              }
              historySource={this.getBackAppearanceHistorySource()}
              repositoryPath={this.getBackAppearanceRepositoryPath()}
              onHistoryMutation={this.onBackAppearanceHistoryMutation}
            />
            <p>
              <LocalizedText
                translationKey="submodule.viewingContext"
                variables={{ child: 'library', parent: parentName }}
                languageMode={mode}
              />
            </p>
          </div>
        </div>
      </section>
    )
  }

  private renderList(): JSX.Element {
    const { submodules, isLoading } = this.state

    if (isLoading && submodules === null) {
      return (
        <p className="submodules-empty">
          <Loading /> <LocalizedText translationKey="submodule.loading" />
        </p>
      )
    }

    if (submodules === null || submodules.length === 0) {
      return (
        <p className="submodules-empty">
          <LocalizedText translationKey="submodule.none" />
        </p>
      )
    }

    const visible = this.getVisibleSubmodules(submodules)

    if (visible.length === 0) {
      return (
        <p className="submodules-empty">
          <LocalizedText translationKey="submodule.noMatches" />
        </p>
      )
    }

    return (
      <ul className="submodule-list">{visible.map(s => this.renderRow(s))}</ul>
    )
  }

  public render() {
    const hasSubmodules =
      this.state.submodules !== null && this.state.submodules.length > 0

    return (
      <DialogContent>
        <div className="submodules-settings">
          {this.renderAppearanceCustomizer()}
          <section className="submodules-section">
            <div className="submodules-section-header">
              <h3 className="submodules-section-title">
                <Octicon symbol={octicons.fileSubmodule} />
                <LocalizedText translationKey="submodule.title" />
              </h3>
              <div className="submodules-header-actions">
                <Button
                  type="button"
                  disabled={
                    this.state.isBusyGlobal || this.state.isOpeningRepository
                  }
                  onClick={this.onShowAddSubmodule}
                  ariaLabel={translateForAccessibleName('submodule.addAction')}
                  tooltip={t('submodule.addTooltip')}
                >
                  <Octicon symbol={octicons.plus} />
                  <LocalizedText translationKey="submodule.addAction" />
                </Button>
                {hasSubmodules && (
                  <Button
                    type="button"
                    disabled={
                      this.state.isBusyGlobal || this.state.isOpeningRepository
                    }
                    onClick={this.onUpdateAll}
                    ariaLabel={translateForAccessibleName(
                      'submodule.updateAllAction'
                    )}
                    tooltip={t('submodule.updateAllTooltip')}
                  >
                    {this.state.isBusyGlobal ? <Loading /> : null}
                    <LocalizedText translationKey="submodule.updateAllAction" />
                  </Button>
                )}
              </div>
            </div>
            <p className="submodules-temporary-open-note">
              <Octicon symbol={octicons.info} />
              <LocalizedText translationKey="submodule.temporaryOpenDescription" />
            </p>
            {this.renderSummary()}
            {this.renderFilterControls()}
            {this.state.error !== null && (
              <p
                className="submodules-error"
                role="alert"
                aria-live="assertive"
              >
                <LocalizedText
                  translationKey={this.state.error.key}
                  variables={this.state.error.variables}
                />
              </p>
            )}
            {this.state.progress !== null && (
              <p
                className="submodules-progress"
                role="status"
                aria-live="polite"
              >
                {this.state.progress}
              </p>
            )}
            {this.renderList()}
          </section>
        </div>
      </DialogContent>
    )
  }
}

interface ISubmoduleRowProps {
  readonly submodule: IManagedSubmodule
  readonly isBusy: boolean
  readonly statusPill: JSX.Element
  readonly onUpdate: (submodule: IManagedSubmodule) => void
  readonly onOpenAsRepository: (submodule: IManagedSubmodule) => void
  readonly onSyncSubmodule: (submodule: IManagedSubmodule) => void
  readonly onConfigure: (submodule: IManagedSubmodule) => void
  readonly onRemove: (submodule: IManagedSubmodule) => void
}

/**
 * A single submodule row. Extracted so the per-row action handlers can be
 * stable instance methods bound to the submodule rather than inline arrows.
 */
function SubmoduleRow(props: ISubmoduleRowProps) {
  const { submodule, isBusy, statusPill } = props
  const onUpdate = React.useCallback(
    () => props.onUpdate(submodule),
    [props.onUpdate, submodule]
  )
  const onOpenAsRepository = React.useCallback(
    () => props.onOpenAsRepository(submodule),
    [props.onOpenAsRepository, submodule]
  )
  const onSyncClicked = React.useCallback(
    () => props.onSyncSubmodule(submodule),
    [props.onSyncSubmodule, submodule]
  )
  const onConfigure = React.useCallback(
    () => props.onConfigure(submodule),
    [props.onConfigure, submodule]
  )
  const onRemove = React.useCallback(
    () => props.onRemove(submodule),
    [props.onRemove, submodule]
  )
  const shortSha = submodule.sha ? submodule.sha.slice(0, 8) : '—'

  return (
    <li className="submodule-row">
      <div className="submodule-row-main">
        <div className="submodule-row-heading">
          <Octicon
            className="submodule-row-icon"
            symbol={octicons.fileSubmodule}
          />
          <span className="submodule-row-path">{submodule.path}</span>
          {statusPill}
        </div>
        <div className="submodule-row-meta">
          {submodule.url !== null && (
            <TooltippedContent
              tagName="span"
              className="submodule-row-url"
              tooltip={submodule.url}
              onlyWhenOverflowed={true}
            >
              {submodule.url}
            </TooltippedContent>
          )}
          {submodule.branch !== null && (
            <span className="submodule-row-branch">
              <Octicon symbol={octicons.gitBranch} />
              {submodule.branch}
            </span>
          )}
          <TooltippedContent
            tagName="span"
            className="submodule-row-sha"
            tooltip={submodule.sha ?? ''}
          >
            <Octicon symbol={octicons.gitCommit} />
            {shortSha}
          </TooltippedContent>
        </div>
      </div>
      <div className="submodule-row-actions">
        <Button
          type="button"
          className="submodule-open-repository"
          disabled={isBusy || submodule.status === 'uninitialized'}
          onClick={onOpenAsRepository}
          ariaLabel={`${translateForAccessibleName(
            'submodule.openAsRepository'
          )}: ${submodule.path}`}
          tooltip={
            submodule.status === 'uninitialized'
              ? t('submodule.openUnavailable')
              : t('submodule.temporaryOpenDescription')
          }
        >
          <Octicon symbol={octicons.repo} />
          <LocalizedText translationKey="submodule.openAsRepository" />
        </Button>
        <Button
          type="button"
          disabled={isBusy}
          onClick={onUpdate}
          tooltip={
            submodule.status === 'uninitialized'
              ? t('submodule.cloneTooltip')
              : t('submodule.updateTooltip')
          }
          ariaLabel={translateForAccessibleName(
            submodule.status === 'uninitialized'
              ? 'submodule.cloneAction'
              : 'submodule.updateAction'
          )}
        >
          {submodule.status === 'uninitialized' ? (
            <LocalizedText translationKey="submodule.cloneAction" />
          ) : (
            <LocalizedText translationKey="submodule.updateAction" />
          )}
        </Button>
        <Button
          type="button"
          disabled={isBusy}
          onClick={onSyncClicked}
          ariaLabel={translateForAccessibleName('submodule.syncAction')}
          tooltip={t('submodule.syncTooltip')}
        >
          <LocalizedText translationKey="submodule.syncAction" />
        </Button>
        <Button
          type="button"
          disabled={isBusy}
          onClick={onConfigure}
          ariaLabel={translateForAccessibleName('submodule.configureAction')}
          tooltip={t('submodule.configureTooltip')}
        >
          <LocalizedText translationKey="submodule.configureAction" />
        </Button>
        <Button
          type="button"
          disabled={isBusy}
          onClick={onRemove}
          ariaLabel={translateForAccessibleName('submodule.removeAction')}
          tooltip={t('submodule.removeTooltip')}
        >
          <LocalizedText translationKey="submodule.removeAction" />
        </Button>
      </div>
    </li>
  )
}
