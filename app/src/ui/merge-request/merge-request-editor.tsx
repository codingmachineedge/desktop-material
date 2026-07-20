import * as React from 'react'
import {
  bilingualVariable,
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
  translateForAccessibleName,
  type TranslationKey,
  type TranslationVariables,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { Button } from '../lib/button'
import {
  MergeRequestBodyMaximumLength,
  MergeRequestMaximumAssignees,
  MergeRequestMaximumReviewers,
  MergeRequestTitleMaximumLength,
  boundMergeRequestEditorContext,
  classifyDetailedMergeStatus,
  getMergeRequestRouteKey,
  normalizeMergeRequestInitialValue,
  validateMergeRequestDraft,
  type IBoundedMergeRequestContext,
  type IMergeRequestEditorContext,
  type IMergeRequestEditorInitialValue,
  type IMergeRequestEditorSubmission,
  type IMergeRequestIdentityOption,
  type IMergeRequestRouteIdentity,
  type MergeRequestCappedCollection,
  type MergeRequestEditorAvailability,
  type MergeRequestEditorMode,
  type MergeRequestEditorOperation,
  type MergeRequestLoadError,
  type MergeRequestOptionalField,
  type MergeRequestSubmissionError,
  type MergeRequestValidationError,
} from './merge-request-model'

export interface IMergeRequestEditorProps {
  readonly mode: MergeRequestEditorMode
  /** Exact repository-bound GitLab identity; never an active-account default. */
  readonly route: IMergeRequestRouteIdentity
  readonly availability: MergeRequestEditorAvailability
  readonly initialValue?: IMergeRequestEditorInitialValue
  readonly operation?: MergeRequestEditorOperation
  readonly onSubmit: (submission: IMergeRequestEditorSubmission) => void
  readonly onRefresh: () => void
  readonly onCancel: () => void
}

interface IMergeRequestEditorState {
  readonly languageMode: LanguageMode
  readonly contextKey: string | null
  readonly sourceBranch: string
  readonly targetBranch: string
  readonly title: string
  readonly body: string
  readonly draft: boolean
  readonly reviewerIds: ReadonlyArray<string>
  readonly assigneeIds: ReadonlyArray<string>
  readonly validationErrors: ReadonlyArray<MergeRequestValidationError>
}

interface IPreparedFields {
  readonly contextKey: string | null
  readonly sourceBranch: string
  readonly targetBranch: string
  readonly title: string
  readonly body: string
  readonly draft: boolean
  readonly reviewerIds: ReadonlyArray<string>
  readonly assigneeIds: ReadonlyArray<string>
}

const RouteDisplayMaximumLength = 240
let editorInstance = 0

function availabilityContext(
  availability: MergeRequestEditorAvailability
): IMergeRequestEditorContext | null {
  switch (availability.kind) {
    case 'ready':
    case 'partial':
    case 'stale':
      return availability.context
    case 'loading':
    case 'empty':
    case 'error':
      return null
  }
}

function contextKey(context: IMergeRequestEditorContext): string {
  return JSON.stringify([
    getMergeRequestRouteKey(context.route),
    context.version,
  ])
}

function routeMatches(
  expected: IMergeRequestRouteIdentity,
  actual: IMergeRequestRouteIdentity
): boolean {
  return getMergeRequestRouteKey(expected) === getMergeRequestRouteKey(actual)
}

function boundedDisplay(value: string): string {
  const trimmed = value.trim()
  return trimmed.length <= RouteDisplayMaximumLength
    ? trimmed
    : `${trimmed.slice(0, RouteDisplayMaximumLength - 1).trimEnd()}…`
}

function uniqueAvailableIds(
  requested: ReadonlyArray<string>,
  options: ReadonlyArray<IMergeRequestIdentityOption>,
  maximum: number
): ReadonlyArray<string> {
  const available = new Set(options.map(option => option.id))
  return [...new Set(requested)]
    .filter(id => available.has(id))
    .slice(0, maximum)
}

function prepareFields(
  route: IMergeRequestRouteIdentity,
  availability: MergeRequestEditorAvailability,
  initialValue: IMergeRequestEditorInitialValue | undefined
): IPreparedFields {
  const initial = normalizeMergeRequestInitialValue(initialValue)
  const rawContext = availabilityContext(availability)
  if (rawContext === null || !routeMatches(route, rawContext.route)) {
    return {
      contextKey: null,
      sourceBranch: initial.sourceBranch,
      targetBranch: initial.targetBranch,
      title: initial.title,
      body: initial.body,
      draft: initial.draft,
      reviewerIds: [],
      assigneeIds: [],
    }
  }

  const bounded = boundMergeRequestEditorContext(rawContext).context
  const sourceNames = bounded.sourceBranches.map(branch => branch.name)
  const targetNames = bounded.targetBranches.map(branch => branch.name)
  const sourceBranch = sourceNames.includes(initial.sourceBranch)
    ? initial.sourceBranch
    : sourceNames[0] ?? ''
  const targetBranch = targetNames.includes(initial.targetBranch)
    ? initial.targetBranch
    : targetNames.find(branch => branch !== sourceBranch) ??
      targetNames[0] ??
      ''

  return {
    contextKey: contextKey(bounded),
    sourceBranch,
    targetBranch,
    title: initial.title,
    body: initial.body,
    draft: initial.draft,
    reviewerIds: uniqueAvailableIds(
      initial.reviewerIds,
      bounded.reviewers,
      MergeRequestMaximumReviewers
    ),
    assigneeIds: uniqueAvailableIds(
      initial.assigneeIds,
      bounded.assignees,
      MergeRequestMaximumAssignees
    ),
  }
}

function identityLabel(identity: IMergeRequestIdentityOption): string {
  if (
    identity.username === undefined ||
    identity.username === identity.displayName
  ) {
    return identity.displayName
  }
  return `${identity.displayName} (@${identity.username})`
}

function unique<T>(values: ReadonlyArray<T>): ReadonlyArray<T> {
  return [...new Set(values)]
}

export class MergeRequestEditor extends React.Component<
  IMergeRequestEditorProps,
  IMergeRequestEditorState
> {
  private readonly headingId = `merge-request-editor-heading-${++editorInstance}`
  private readonly validationId = `${this.headingId}-validation`
  private readonly titleCountId = `${this.headingId}-title-count`
  private readonly bodyCountId = `${this.headingId}-body-count`

  public constructor(props: IMergeRequestEditorProps) {
    super(props)
    this.state = {
      languageMode: getPersistedLanguageMode(),
      ...prepareFields(props.route, props.availability, props.initialValue),
      validationErrors: [],
    }
  }

  public componentDidMount(): void {
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public componentDidUpdate(): void {
    const rawContext = availabilityContext(this.props.availability)
    if (
      rawContext !== null &&
      routeMatches(this.props.route, rawContext.route) &&
      contextKey(rawContext) !== this.state.contextKey
    ) {
      this.setState({
        ...prepareFields(
          this.props.route,
          this.props.availability,
          this.props.initialValue
        ),
        validationErrors: [],
      })
    }
  }

  public componentWillUnmount(): void {
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public render() {
    const availability = this.props.availability
    const rawContext = availabilityContext(availability)
    const routeStale =
      rawContext !== null && !routeMatches(this.props.route, rawContext.route)
    const effectiveKind = routeStale ? 'stale' : availability.kind
    const operation = this.props.operation ?? { kind: 'idle' as const }
    const busy = effectiveKind === 'loading' || operation.kind === 'submitting'

    return (
      <section
        className={`merge-request-editor is-${effectiveKind}`}
        data-verification="merge-request-editor"
        data-state={effectiveKind}
        aria-labelledby={this.headingId}
        aria-busy={busy}
      >
        <header className="merge-request-editor-header">
          <div>
            <h2 id={this.headingId}>
              {this.tr(
                this.props.mode === 'create'
                  ? 'mrEditor.createTitle'
                  : 'mrEditor.editTitle'
              )}
            </h2>
            <p>{this.tr('mrEditor.description')}</p>
          </div>
        </header>
        {this.renderRoute()}
        {this.renderAvailability(routeStale)}
        {this.renderOperation(operation)}
      </section>
    )
  }

  private tr(key: TranslationKey, variables?: TranslationVariables): string {
    return translate(key, this.state.languageMode, variables)
  }

  private aria(key: TranslationKey, variables?: TranslationVariables): string {
    return translateForAccessibleName(key, variables, this.state.languageMode)
  }

  private renderRoute() {
    const route = this.props.route
    return (
      <div
        className="merge-request-editor-route"
        data-verification="merge-request-route"
        role="group"
        aria-label={this.aria('mrEditor.routeAria')}
      >
        <div>
          <span>{this.tr('mrEditor.project')}</span>
          <strong>{boundedDisplay(route.projectPath)}</strong>
        </div>
        <div>
          <span>{this.tr('mrEditor.boundAccount')}</span>
          <strong>{boundedDisplay(route.accountDisplayName)}</strong>
          <small>{boundedDisplay(route.friendlyEndpoint)}</small>
        </div>
      </div>
    )
  }

  private renderAvailability(routeStale: boolean) {
    const availability = this.props.availability
    if (routeStale) {
      const context = availabilityContext(availability)
      return context === null
        ? this.renderStaleState(null)
        : this.renderStaleState(boundMergeRequestEditorContext(context))
    }

    switch (availability.kind) {
      case 'loading':
        return this.renderState('status', 'mrEditor.loading', undefined, false)
      case 'empty':
        return this.renderState(
          'status',
          this.emptyKey(availability.reason),
          'mrEditor.emptyDescription',
          true
        )
      case 'error':
        return this.renderState(
          'alert',
          'mrEditor.errorTitle',
          this.loadErrorKey(availability.reason),
          true
        )
      case 'stale':
        return this.renderStaleState(
          boundMergeRequestEditorContext(availability.context)
        )
      case 'ready':
      case 'partial': {
        const bounded = boundMergeRequestEditorContext(availability.context)
        if (bounded.context.sourceBranches.length === 0) {
          return this.renderState(
            'status',
            'mrEditor.emptySource',
            'mrEditor.emptyDescription',
            true
          )
        }
        if (bounded.context.targetBranches.length === 0) {
          return this.renderState(
            'status',
            'mrEditor.emptyTarget',
            'mrEditor.emptyDescription',
            true
          )
        }
        const unavailable =
          availability.kind === 'partial' ? availability.unavailable : []
        const capped = unique([
          ...bounded.capped,
          ...(availability.kind === 'partial' ? availability.capped : []),
        ])
        return this.renderForm(bounded.context, unavailable, capped, false)
      }
    }
  }

  private renderState(
    role: 'status' | 'alert',
    titleKey: TranslationKey,
    descriptionKey: TranslationKey | undefined,
    refresh: boolean
  ) {
    return (
      <div
        className="merge-request-editor-state"
        data-verification="merge-request-state"
        role={role}
      >
        <strong>{this.tr(titleKey)}</strong>
        {descriptionKey !== undefined && <p>{this.tr(descriptionKey)}</p>}
        {refresh && (
          <Button
            type="button"
            dataVerification="merge-request-refresh"
            onClick={this.props.onRefresh}
          >
            {this.tr('mrEditor.refresh')}
          </Button>
        )}
      </div>
    )
  }

  private renderStaleState(bounded: IBoundedMergeRequestContext | null) {
    return (
      <>
        <div
          className="merge-request-editor-stale"
          data-verification="merge-request-stale"
          role="alert"
        >
          <strong>{this.tr('mrEditor.staleTitle')}</strong>
          <p>{this.tr('mrEditor.staleDescription')}</p>
          <Button
            type="button"
            dataVerification="merge-request-refresh"
            onClick={this.props.onRefresh}
          >
            {this.tr('mrEditor.refresh')}
          </Button>
        </div>
        {bounded !== null &&
          bounded.context.sourceBranches.length > 0 &&
          bounded.context.targetBranches.length > 0 &&
          this.renderForm(bounded.context, [], bounded.capped, true)}
      </>
    )
  }

  private renderForm(
    context: IMergeRequestEditorContext,
    unavailable: ReadonlyArray<MergeRequestOptionalField>,
    capped: ReadonlyArray<MergeRequestCappedCollection>,
    stale: boolean
  ) {
    const operation = this.props.operation ?? { kind: 'idle' as const }
    const disabled = stale || operation.kind === 'submitting'
    const unavailableSet = new Set(unavailable)
    const titleRemaining =
      MergeRequestTitleMaximumLength - this.state.title.length
    const bodyRemaining = MergeRequestBodyMaximumLength - this.state.body.length
    const errors = new Set(this.state.validationErrors)
    const sourceInvalid =
      errors.has('source-required') || errors.has('branches-must-differ')
    const targetInvalid =
      errors.has('target-required') || errors.has('branches-must-differ')
    const titleInvalid =
      errors.has('title-required') ||
      errors.has('title-too-long') ||
      errors.has('title-invalid')
    const bodyInvalid =
      errors.has('body-too-long') || errors.has('body-invalid')
    const reviewersInvalid = [
      'too-many-reviewers',
      'duplicate-reviewers',
      'invalid-reviewer',
    ].some(error => errors.has(error as MergeRequestValidationError))
    const assigneesInvalid = [
      'too-many-assignees',
      'duplicate-assignees',
      'invalid-assignee',
    ].some(error => errors.has(error as MergeRequestValidationError))

    return (
      <div
        className="merge-request-editor-form"
        data-verification="merge-request-form"
        role="group"
        aria-label={this.aria('mrEditor.formAria')}
      >
        {(unavailable.length > 0 || capped.length > 0) &&
          this.renderPartialWarning(unavailable, capped)}
        {this.renderReadiness(context)}
        {this.renderValidationSummary()}
        <div className="merge-request-editor-routing">
          <label className="merge-request-editor-field">
            <span>{this.tr('mrEditor.sourceBranch')}</span>
            <select
              data-verification="merge-request-source"
              value={this.state.sourceBranch}
              disabled={disabled || this.props.mode === 'edit'}
              required={true}
              aria-label={this.aria('mrEditor.sourceBranch')}
              aria-invalid={sourceInvalid}
              aria-describedby={sourceInvalid ? this.validationId : undefined}
              onChange={this.onSourceBranchChanged}
            >
              {context.sourceBranches.map(branch => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                </option>
              ))}
            </select>
            {this.props.mode === 'edit' && (
              <small>{this.tr('mrEditor.sourceEditLocked')}</small>
            )}
          </label>
          <label className="merge-request-editor-field">
            <span>{this.tr('mrEditor.targetBranch')}</span>
            <select
              data-verification="merge-request-target"
              value={this.state.targetBranch}
              disabled={disabled}
              required={true}
              aria-label={this.aria('mrEditor.targetBranch')}
              aria-invalid={targetInvalid}
              aria-describedby={targetInvalid ? this.validationId : undefined}
              onChange={this.onTargetBranchChanged}
            >
              {context.targetBranches.map(branch => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="merge-request-editor-field">
          <span>{this.tr('mrEditor.titleField')}</span>
          <input
            data-verification="merge-request-title"
            type="text"
            value={this.state.title}
            maxLength={MergeRequestTitleMaximumLength}
            disabled={disabled}
            required={true}
            aria-label={this.aria('mrEditor.titleField')}
            aria-invalid={titleInvalid}
            aria-describedby={
              titleInvalid
                ? `${this.titleCountId} ${this.validationId}`
                : this.titleCountId
            }
            onChange={this.onTitleChanged}
            onKeyDown={this.onTitleKeyDown}
          />
          <small id={this.titleCountId}>
            {this.tr('mrEditor.charactersRemaining', {
              count: String(titleRemaining),
            })}
          </small>
        </label>

        <label className="merge-request-editor-field">
          <span>{this.tr('mrEditor.descriptionField')}</span>
          <textarea
            data-verification="merge-request-body"
            value={this.state.body}
            maxLength={MergeRequestBodyMaximumLength}
            rows={8}
            disabled={disabled}
            aria-label={this.aria('mrEditor.descriptionField')}
            aria-invalid={bodyInvalid}
            aria-describedby={
              bodyInvalid
                ? `${this.bodyCountId} ${this.validationId}`
                : this.bodyCountId
            }
            onChange={this.onBodyChanged}
            onKeyDown={this.onBodyKeyDown}
          />
          <small id={this.bodyCountId}>
            {this.tr('mrEditor.charactersRemaining', {
              count: String(bodyRemaining),
            })}{' '}
            · {this.tr('mrEditor.markdownSupported')}
          </small>
        </label>

        <label className="merge-request-editor-draft">
          <input
            data-verification="merge-request-draft"
            type="checkbox"
            checked={this.state.draft}
            disabled={disabled}
            onChange={this.onDraftChanged}
          />
          <span>{this.tr('mrEditor.draftAction')}</span>
        </label>

        <div className="merge-request-editor-people">
          {this.renderIdentitySelect(
            'reviewers',
            context.reviewers,
            this.state.reviewerIds,
            unavailableSet.has('reviewers'),
            reviewersInvalid,
            disabled,
            this.onReviewersChanged
          )}
          {this.renderIdentitySelect(
            'assignees',
            context.assignees,
            this.state.assigneeIds,
            unavailableSet.has('assignees'),
            assigneesInvalid,
            disabled,
            this.onAssigneesChanged
          )}
        </div>

        <p className="merge-request-editor-keyboard-hint">
          {this.tr('mrEditor.keyboardHint')}
        </p>
        <div className="merge-request-editor-actions">
          <Button
            type="button"
            dataVerification="merge-request-cancel"
            disabled={operation.kind === 'submitting'}
            onClick={this.props.onCancel}
          >
            {this.tr('mrEditor.cancel')}
          </Button>
          <Button
            type="button"
            dataVerification="merge-request-submit"
            disabled={disabled}
            onClick={this.onSubmit}
          >
            {this.submitLabel(operation)}
          </Button>
        </div>
      </div>
    )
  }

  private renderIdentitySelect(
    kind: MergeRequestOptionalField,
    options: ReadonlyArray<IMergeRequestIdentityOption>,
    selected: ReadonlyArray<string>,
    unavailable: boolean,
    invalid: boolean,
    formDisabled: boolean,
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void
  ) {
    const key =
      kind === 'reviewers' ? 'mrEditor.reviewers' : 'mrEditor.assignees'
    const hook =
      kind === 'reviewers'
        ? 'merge-request-reviewers'
        : 'merge-request-assignees'
    return (
      <label className="merge-request-editor-field">
        <span>{this.tr(key)}</span>
        <select
          data-verification={hook}
          multiple={true}
          size={Math.min(5, Math.max(3, options.length))}
          value={[...selected]}
          disabled={formDisabled || unavailable || options.length === 0}
          aria-label={this.aria(key)}
          aria-invalid={invalid}
          aria-describedby={invalid ? this.validationId : undefined}
          onChange={onChange}
        >
          {options.map(identity => (
            <option key={identity.id} value={identity.id}>
              {identityLabel(identity)}
            </option>
          ))}
        </select>
        {(unavailable || options.length === 0) && (
          <small>
            {this.tr(
              unavailable
                ? kind === 'reviewers'
                  ? 'mrEditor.reviewersUnavailable'
                  : 'mrEditor.assigneesUnavailable'
                : 'mrEditor.noneAvailable'
            )}
          </small>
        )}
      </label>
    )
  }

  private renderPartialWarning(
    unavailable: ReadonlyArray<MergeRequestOptionalField>,
    capped: ReadonlyArray<MergeRequestCappedCollection>
  ) {
    return (
      <div
        className="merge-request-editor-partial"
        data-verification="merge-request-partial"
        role="status"
      >
        <strong>{this.tr('mrEditor.partialTitle')}</strong>
        {unavailable.length > 0 && (
          <span>{this.tr('mrEditor.partialUnavailable')}</span>
        )}
        {capped.length > 0 && <span>{this.tr('mrEditor.partialCapped')}</span>}
      </div>
    )
  }

  private renderReadiness(context: IMergeRequestEditorContext) {
    if (
      this.props.mode !== 'edit' &&
      context.detailedMergeStatus === undefined
    ) {
      return null
    }
    const readiness = classifyDetailedMergeStatus(context.detailedMergeStatus)
    const statusKey =
      readiness.kind === 'transient'
        ? 'mrEditor.readinessChecking'
        : readiness.kind === 'ready'
        ? 'mrEditor.readinessReady'
        : readiness.kind === 'blocked'
        ? 'mrEditor.readinessBlocked'
        : 'mrEditor.readinessUnknown'
    const variables =
      readiness.kind === 'blocked'
        ? {
            reason: bilingualVariable(
              translate(this.blockerKey(readiness.status), 'english'),
              translate(this.blockerKey(readiness.status), 'cantonese')
            ),
          }
        : undefined
    return (
      <div
        className={`merge-request-editor-readiness is-${readiness.kind}`}
        data-verification="merge-request-readiness"
        data-status={readiness.kind}
        role="status"
        aria-live={readiness.kind === 'transient' ? 'polite' : undefined}
      >
        <span>{this.tr('mrEditor.readinessLabel')}</span>
        <strong>{this.tr(statusKey, variables)}</strong>
      </div>
    )
  }

  private renderValidationSummary() {
    if (this.state.validationErrors.length === 0) {
      return null
    }
    return (
      <div
        id={this.validationId}
        className="merge-request-editor-validation"
        data-verification="merge-request-validation"
        role="alert"
      >
        <strong>{this.tr('mrEditor.validationTitle')}</strong>
        <ul>
          {this.state.validationErrors.map(error => (
            <li key={error}>{this.tr(this.validationKey(error))}</li>
          ))}
        </ul>
      </div>
    )
  }

  private renderOperation(operation: MergeRequestEditorOperation) {
    if (operation.kind === 'idle') {
      return null
    }
    const role = operation.kind === 'error' ? 'alert' : 'status'
    const key =
      operation.kind === 'submitting'
        ? this.props.mode === 'create'
          ? 'mrEditor.creating'
          : 'mrEditor.saving'
        : operation.kind === 'success'
        ? this.props.mode === 'create'
          ? 'mrEditor.created'
          : 'mrEditor.saved'
        : operation.kind === 'canceled'
        ? 'mrEditor.canceled'
        : this.submissionErrorKey(operation.reason)
    return (
      <div
        className={`merge-request-editor-operation is-${operation.kind}`}
        data-verification="merge-request-operation"
        role={role}
        aria-live="polite"
      >
        {this.tr(key)}
      </div>
    )
  }

  private emptyKey(reason: string): TranslationKey {
    switch (reason) {
      case 'no-source-branches':
        return 'mrEditor.emptySource'
      case 'no-target-branches':
        return 'mrEditor.emptyTarget'
      default:
        return 'mrEditor.emptyBranches'
    }
  }

  private loadErrorKey(reason: MergeRequestLoadError): TranslationKey {
    switch (reason) {
      case 'authentication':
        return 'mrEditor.errorAuthentication'
      case 'permission':
        return 'mrEditor.errorPermission'
      case 'network':
        return 'mrEditor.errorNetwork'
      case 'unsupported':
        return 'mrEditor.errorUnsupported'
      case 'invalid-response':
        return 'mrEditor.errorInvalidResponse'
      case 'unknown':
        return 'mrEditor.errorUnknown'
    }
  }

  private blockerKey(status: string): TranslationKey {
    switch (status) {
      case 'commits_status':
        return 'mrEditor.blockerCommitsStatus'
      case 'merge_request_blocked':
        return 'mrEditor.blockerRequestBlocked'
      case 'merge_time':
        return 'mrEditor.blockerMergeTime'
      case 'requested_changes':
        return 'mrEditor.blockerRequestedChanges'
      case 'security_policy_pipeline_check':
        return 'mrEditor.blockerSecurityPipeline'
      case 'security_policy_violations':
        return 'mrEditor.blockerSecurityViolation'
      case 'status_checks_must_pass':
        return 'mrEditor.blockerStatusChecks'
      case 'locked_paths':
        return 'mrEditor.blockerLockedPaths'
      case 'locked_lfs_files':
        return 'mrEditor.blockerLockedLfs'
      case 'title_regex':
        return 'mrEditor.blockerTitleRegex'
      case 'ci_must_pass':
        return 'mrEditor.blockerCiMustPass'
      case 'ci_still_running':
        return 'mrEditor.blockerCiRunning'
      case 'conflict':
        return 'mrEditor.blockerConflict'
      case 'discussions_not_resolved':
        return 'mrEditor.blockerDiscussions'
      case 'draft_status':
        return 'mrEditor.blockerDraft'
      case 'external_status_checks':
        return 'mrEditor.blockerExternalChecks'
      case 'jira_association_missing':
        return 'mrEditor.blockerJira'
      case 'need_rebase':
        return 'mrEditor.blockerRebase'
      case 'not_approved':
        return 'mrEditor.blockerApproval'
      case 'not_open':
        return 'mrEditor.blockerNotOpen'
      case 'policies_denied':
        return 'mrEditor.blockerPolicy'
      case 'blocked_status':
      default:
        return 'mrEditor.blockerStatus'
    }
  }

  private validationKey(error: MergeRequestValidationError): TranslationKey {
    switch (error) {
      case 'source-required':
        return 'mrEditor.validationSource'
      case 'target-required':
        return 'mrEditor.validationTarget'
      case 'branches-must-differ':
        return 'mrEditor.validationBranchesDiffer'
      case 'title-required':
        return 'mrEditor.validationTitleRequired'
      case 'title-too-long':
        return 'mrEditor.validationTitleLength'
      case 'title-invalid':
        return 'mrEditor.validationTitleInvalid'
      case 'body-too-long':
        return 'mrEditor.validationBodyLength'
      case 'body-invalid':
        return 'mrEditor.validationBodyInvalid'
      case 'too-many-reviewers':
        return 'mrEditor.validationReviewerLimit'
      case 'too-many-assignees':
        return 'mrEditor.validationAssigneeLimit'
      case 'duplicate-reviewers':
        return 'mrEditor.validationReviewerDuplicate'
      case 'duplicate-assignees':
        return 'mrEditor.validationAssigneeDuplicate'
      case 'invalid-reviewer':
        return 'mrEditor.validationReviewerInvalid'
      case 'invalid-assignee':
        return 'mrEditor.validationAssigneeInvalid'
    }
  }

  private submissionErrorKey(
    reason: MergeRequestSubmissionError
  ): TranslationKey {
    switch (reason) {
      case 'rejected':
        return 'mrEditor.submitRejected'
      case 'network':
        return 'mrEditor.submitNetwork'
      case 'stale':
        return 'mrEditor.submitStale'
      case 'invalid-response':
        return 'mrEditor.submitInvalidResponse'
      case 'unknown':
        return 'mrEditor.submitUnknown'
    }
  }

  private submitLabel(operation: MergeRequestEditorOperation): string {
    if (operation.kind === 'submitting') {
      return this.tr(
        this.props.mode === 'create' ? 'mrEditor.creating' : 'mrEditor.saving'
      )
    }
    return this.tr(
      this.props.mode === 'create'
        ? 'mrEditor.createAction'
        : 'mrEditor.saveAction'
    )
  }

  private selectedValues(
    event: React.ChangeEvent<HTMLSelectElement>
  ): ReadonlyArray<string> {
    return Array.from(
      event.currentTarget.selectedOptions,
      option => option.value
    )
  }

  private clearValidationErrors(
    errors: ReadonlyArray<MergeRequestValidationError>
  ): ReadonlyArray<MergeRequestValidationError> {
    const cleared = new Set(errors)
    return this.state.validationErrors.filter(error => !cleared.has(error))
  }

  private onSourceBranchChanged = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    if (this.props.mode === 'edit') {
      return
    }
    this.setState({
      sourceBranch: event.currentTarget.value,
      validationErrors: this.clearValidationErrors([
        'source-required',
        'branches-must-differ',
      ]),
    })
  }

  private onTargetBranchChanged = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    this.setState({
      targetBranch: event.currentTarget.value,
      validationErrors: this.clearValidationErrors([
        'target-required',
        'branches-must-differ',
      ]),
    })
  }

  private onTitleChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({
      title: event.currentTarget.value,
      validationErrors: this.clearValidationErrors([
        'title-required',
        'title-too-long',
      ]),
    })
  }

  private onBodyChanged = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    this.setState({
      body: event.currentTarget.value,
      validationErrors: this.clearValidationErrors(['body-too-long']),
    })
  }

  private onDraftChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ draft: event.currentTarget.checked })
  }

  private onReviewersChanged = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const selected = this.selectedValues(event)
    if (selected.length > MergeRequestMaximumReviewers) {
      this.setState({
        validationErrors: unique([
          ...this.state.validationErrors,
          'too-many-reviewers',
        ]),
      })
      return
    }
    this.setState({
      reviewerIds: selected,
      validationErrors: this.clearValidationErrors([
        'too-many-reviewers',
        'duplicate-reviewers',
        'invalid-reviewer',
      ]),
    })
  }

  private onAssigneesChanged = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const selected = this.selectedValues(event)
    if (selected.length > MergeRequestMaximumAssignees) {
      this.setState({
        validationErrors: unique([
          ...this.state.validationErrors,
          'too-many-assignees',
        ]),
      })
      return
    }
    this.setState({
      assigneeIds: selected,
      validationErrors: this.clearValidationErrors([
        'too-many-assignees',
        'duplicate-assignees',
        'invalid-assignee',
      ]),
    })
  }

  private onTitleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      this.onSubmit()
    }
  }

  private onBodyKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      this.onSubmit()
    }
  }

  private onSubmit = () => {
    const availability = this.props.availability
    if (availability.kind !== 'ready' && availability.kind !== 'partial') {
      return
    }
    if (
      this.props.operation?.kind === 'submitting' ||
      !routeMatches(this.props.route, availability.context.route)
    ) {
      return
    }
    const context = boundMergeRequestEditorContext(availability.context).context
    const draft = {
      sourceBranch: this.state.sourceBranch.trim(),
      targetBranch: this.state.targetBranch.trim(),
      title: this.state.title.trim(),
      body: this.state.body,
      draft: this.state.draft,
      reviewerIds: this.state.reviewerIds,
      assigneeIds: this.state.assigneeIds,
    }
    const validationErrors = validateMergeRequestDraft(draft, context)
    if (validationErrors.length > 0) {
      this.setState({ validationErrors })
      return
    }

    this.setState({ validationErrors: [] })
    this.props.onSubmit({
      route: context.route,
      contextVersion: context.version,
      headSha: context.headSha,
      ...draft,
    })
  }

  private onLanguageModeChanged = (event: Event) => {
    this.setState({
      languageMode: normalizeLanguageMode(
        (event as CustomEvent<unknown>).detail
      ),
    })
  }
}
