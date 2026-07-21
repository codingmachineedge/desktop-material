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
  classifyDetailedMergeStatus,
  createHeadShaGuardedApprovalIntent,
  type IMergeRequestApprovalIntent,
  type IMergeRequestIdentityOption,
  type IMergeRequestRouteIdentity,
} from './merge-request-model'

const LifecycleMaximumPeople = 20
const LifecycleDisplayMaximumLength = 240
const LifecycleCanonicalURLMaximumLength = 4_096

export type MergeRequestLifecycleState =
  | 'opened'
  | 'closed'
  | 'merged'
  | 'locked'

export type MergeRequestPipelineStatus =
  | 'none'
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'canceled'
  | 'skipped'
  | 'unknown'

export interface IMergeRequestApprovalSummary {
  readonly approved: boolean
  readonly approvalsRequired: number
  readonly approvalsLeft: number
  readonly approvedBy: ReadonlyArray<IMergeRequestIdentityOption>
  readonly currentUserApproved: boolean
  readonly canApprove: boolean
}

export interface IMergeRequestLifecycleSummary {
  readonly route: IMergeRequestRouteIdentity
  readonly mergeRequestIid: number
  readonly headSha: string
  readonly canonicalUrl: string
  readonly state: MergeRequestLifecycleState
  readonly draft: boolean
  readonly author: IMergeRequestIdentityOption
  readonly reviewers: ReadonlyArray<IMergeRequestIdentityOption>
  readonly assignees: ReadonlyArray<IMergeRequestIdentityOption>
  readonly approval: IMergeRequestApprovalSummary | null
  readonly pipelineStatus: MergeRequestPipelineStatus
  readonly detailedMergeStatus?: string
  readonly updatedAt: string
}

export type MergeRequestLifecycleUnavailableField =
  | 'approval'
  | 'pipeline'
  | 'readiness'

export type MergeRequestLifecycleAvailability =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'ready'
      readonly summary: IMergeRequestLifecycleSummary
    }
  | {
      readonly kind: 'partial'
      readonly summary: IMergeRequestLifecycleSummary
      readonly unavailable: ReadonlyArray<MergeRequestLifecycleUnavailableField>
    }
  | {
      readonly kind: 'stale'
      readonly summary: IMergeRequestLifecycleSummary
    }

export type MergeRequestLifecycleAction =
  | 'close'
  | 'reopen'
  | 'approve'
  | 'unapprove'
  | 'refresh'
  | 'open'

export type MergeRequestLifecycleOperation =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'running'
      readonly action: MergeRequestLifecycleAction
    }
  | {
      readonly kind: 'success'
      readonly action: MergeRequestLifecycleAction
    }
  | { readonly kind: 'canceled' }
  | { readonly kind: 'error' }

export interface IMergeRequestLifecycleActionsProps {
  readonly availability: MergeRequestLifecycleAvailability
  readonly operation?: MergeRequestLifecycleOperation
  readonly onClose: () => void
  readonly onReopen: () => void
  readonly onApprovalChange: (intent: IMergeRequestApprovalIntent) => void
  readonly onRefresh: () => void
  readonly onOpenCanonicalUrl: (url: string) => void
}

interface IMergeRequestLifecycleState {
  readonly languageMode: LanguageMode
}

let lifecycleInstance = 0

function boundedDisplay(value: string): string {
  const safe = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return safe.length <= LifecycleDisplayMaximumLength
    ? safe
    : `${safe.slice(0, LifecycleDisplayMaximumLength - 1).trimEnd()}…`
}

function identityLabel(identity: IMergeRequestIdentityOption): string {
  const name = boundedDisplay(identity.displayName)
  const username =
    identity.username === undefined ? '' : boundedDisplay(identity.username)
  return username === '' || username === name ? name : `${name} (@${username})`
}

function peopleLabel(
  identities: ReadonlyArray<IMergeRequestIdentityOption>
): string | null {
  const values = identities
    .slice(0, LifecycleMaximumPeople)
    .map(identityLabel)
    .filter(value => value !== '')
  return values.length === 0 ? null : values.join(', ')
}

function canonicalURL(value: string): string | null {
  if (value.length === 0 || value.length > LifecycleCanonicalURLMaximumLength) {
    return null
  }
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.username === '' &&
      parsed.password === ''
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

function summaryFrom(
  availability: MergeRequestLifecycleAvailability
): IMergeRequestLifecycleSummary | null {
  switch (availability.kind) {
    case 'ready':
    case 'partial':
    case 'stale':
      return availability.summary
    case 'loading':
    case 'empty':
    case 'unavailable':
      return null
  }
}

export class MergeRequestLifecycleActions extends React.Component<
  IMergeRequestLifecycleActionsProps,
  IMergeRequestLifecycleState
> {
  private readonly headingId = `merge-request-lifecycle-heading-${++lifecycleInstance}`

  public constructor(props: IMergeRequestLifecycleActionsProps) {
    super(props)
    this.state = { languageMode: getPersistedLanguageMode() }
  }

  public componentDidMount(): void {
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public componentWillUnmount(): void {
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public render() {
    const operation = this.props.operation ?? { kind: 'idle' as const }
    const busy = operation.kind === 'running'
    return (
      <section
        className={`merge-request-lifecycle is-${this.props.availability.kind}`}
        data-verification="merge-request-lifecycle"
        data-state={this.props.availability.kind}
        aria-labelledby={this.headingId}
        aria-busy={busy}
      >
        <header>
          <h3 id={this.headingId}>{this.tr('mrLifecycle.title')}</h3>
        </header>
        {this.renderAvailability(operation)}
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

  private renderAvailability(operation: MergeRequestLifecycleOperation) {
    const availability = this.props.availability
    switch (availability.kind) {
      case 'loading':
        return this.renderStandaloneState('status', 'mrLifecycle.loading')
      case 'empty':
        return this.renderStandaloneState(
          'status',
          'mrLifecycle.empty',
          'mrLifecycle.emptyDescription',
          true
        )
      case 'unavailable':
        return this.renderStandaloneState(
          'alert',
          'mrLifecycle.unavailable',
          'mrLifecycle.unavailableDescription',
          true
        )
      case 'ready':
        return this.renderSummary(availability.summary, [], false, operation)
      case 'partial':
        return this.renderSummary(
          availability.summary,
          availability.unavailable,
          false,
          operation
        )
      case 'stale':
        return this.renderSummary(availability.summary, [], true, operation)
    }
  }

  private renderStandaloneState(
    role: 'status' | 'alert',
    title: TranslationKey,
    description?: TranslationKey,
    refresh: boolean = false
  ) {
    return (
      <div
        className="merge-request-lifecycle-state"
        data-verification="merge-request-lifecycle-state"
        role={role}
      >
        <strong>{this.tr(title)}</strong>
        {description !== undefined && <p>{this.tr(description)}</p>}
        {refresh && (
          <Button
            type="button"
            dataVerification="merge-request-lifecycle-refresh"
            onClick={this.props.onRefresh}
          >
            {this.tr('mrLifecycle.refresh')}
          </Button>
        )}
      </div>
    )
  }

  private renderSummary(
    summary: IMergeRequestLifecycleSummary,
    unavailable: ReadonlyArray<MergeRequestLifecycleUnavailableField>,
    stale: boolean,
    operation: MergeRequestLifecycleOperation
  ) {
    const unavailableSet = new Set(unavailable)
    const disabled = stale || operation.kind === 'running'
    const approvalIntent = this.approvalIntent(summary)
    const url = canonicalURL(summary.canonicalUrl)
    return (
      <>
        {stale && (
          <div
            className="merge-request-lifecycle-stale"
            data-verification="merge-request-lifecycle-stale"
            role="alert"
          >
            <strong>{this.tr('mrLifecycle.stale')}</strong>
            <p>{this.tr('mrLifecycle.staleDescription')}</p>
          </div>
        )}
        {unavailable.length > 0 && (
          <div
            className="merge-request-lifecycle-partial"
            data-verification="merge-request-lifecycle-partial"
            role="status"
          >
            {this.tr('mrLifecycle.partial')}
          </div>
        )}
        <div
          className="merge-request-lifecycle-summary"
          data-verification="merge-request-summary"
          role="group"
          aria-label={this.aria('mrLifecycle.summaryAria')}
        >
          {this.renderStateSummary(summary)}
          {this.renderPeopleSummary(summary)}
          {this.renderApprovalSummary(summary, unavailableSet.has('approval'))}
          {this.renderPipelineSummary(
            summary.pipelineStatus,
            unavailableSet.has('pipeline')
          )}
          {this.renderReadinessSummary(
            summary.detailedMergeStatus,
            unavailableSet.has('readiness')
          )}
          <div
            className="merge-request-lifecycle-updated"
            data-verification="merge-request-updated"
          >
            <span>{this.tr('mrLifecycle.updated')}</span>
            <strong>{this.formatTime(summary.updatedAt)}</strong>
          </div>
        </div>
        <div className="merge-request-lifecycle-actions">
          {summary.state === 'opened' && (
            <Button
              type="button"
              dataVerification="merge-request-close"
              disabled={disabled}
              onClick={this.props.onClose}
            >
              {this.tr('mrLifecycle.close')}
            </Button>
          )}
          {summary.state === 'closed' && (
            <Button
              type="button"
              dataVerification="merge-request-reopen"
              disabled={disabled}
              onClick={this.props.onReopen}
            >
              {this.tr('mrLifecycle.reopen')}
            </Button>
          )}
          {summary.approval !== null && summary.approval.canApprove && (
            <Button
              type="button"
              dataVerification={
                summary.approval.currentUserApproved
                  ? 'merge-request-unapprove'
                  : 'merge-request-approve'
              }
              disabled={
                disabled ||
                unavailableSet.has('approval') ||
                approvalIntent === null
              }
              onClick={this.onApprovalChanged}
            >
              {this.tr(
                summary.approval.currentUserApproved
                  ? 'mrLifecycle.unapprove'
                  : 'mrLifecycle.approve'
              )}
            </Button>
          )}
          <Button
            type="button"
            dataVerification="merge-request-lifecycle-refresh"
            disabled={operation.kind === 'running'}
            onClick={this.props.onRefresh}
          >
            {this.tr('mrLifecycle.refresh')}
          </Button>
          <Button
            type="button"
            dataVerification="merge-request-open-canonical"
            disabled={disabled || url === null}
            onClick={this.onOpenCanonical}
          >
            {this.tr('mrLifecycle.openCanonical')}
          </Button>
        </div>
      </>
    )
  }

  private renderStateSummary(summary: IMergeRequestLifecycleSummary) {
    const stateKey: TranslationKey =
      summary.state === 'opened'
        ? 'mrLifecycle.stateOpened'
        : summary.state === 'closed'
        ? 'mrLifecycle.stateClosed'
        : summary.state === 'merged'
        ? 'mrLifecycle.stateMerged'
        : 'mrLifecycle.stateLocked'
    return (
      <div data-verification="merge-request-state-summary">
        <span>{this.tr('mrLifecycle.state')}</span>
        <strong>
          {this.tr(stateKey)}
          {summary.draft ? ` · ${this.tr('mrLifecycle.draft')}` : ''}
        </strong>
      </div>
    )
  }

  private renderPeopleSummary(summary: IMergeRequestLifecycleSummary) {
    return (
      <>
        <div data-verification="merge-request-author">
          <span>{this.tr('mrLifecycle.author')}</span>
          <strong>
            {identityLabel(summary.author) || this.tr('mrLifecycle.none')}
          </strong>
        </div>
        <div data-verification="merge-request-reviewers-summary">
          <span>{this.tr('mrLifecycle.reviewers')}</span>
          <strong>
            {peopleLabel(summary.reviewers) ?? this.tr('mrLifecycle.none')}
          </strong>
        </div>
        <div data-verification="merge-request-assignees-summary">
          <span>{this.tr('mrLifecycle.assignees')}</span>
          <strong>
            {peopleLabel(summary.assignees) ?? this.tr('mrLifecycle.none')}
          </strong>
        </div>
      </>
    )
  }

  private renderApprovalSummary(
    summary: IMergeRequestLifecycleSummary,
    unavailable: boolean
  ) {
    const approval = summary.approval
    let value = this.tr('mrLifecycle.approvalUnavailable')
    if (!unavailable && approval !== null) {
      const required = Math.max(0, approval.approvalsRequired)
      const left = Math.min(required, Math.max(0, approval.approvalsLeft))
      const approved = required - left
      value = approval.approved
        ? this.tr('mrLifecycle.approvalComplete')
        : this.tr('mrLifecycle.approvalProgress', {
            approved: String(approved),
            required: String(required),
          })
      const approvers = peopleLabel(approval.approvedBy)
      if (approvers !== null) {
        value = `${value} · ${this.tr('mrLifecycle.approvedBy', {
          names: approvers,
        })}`
      }
    }
    return (
      <div data-verification="merge-request-approval-summary">
        <span>{this.tr('mrLifecycle.approval')}</span>
        <strong>{value}</strong>
      </div>
    )
  }

  private renderPipelineSummary(
    status: MergeRequestPipelineStatus,
    unavailable: boolean
  ) {
    const key: TranslationKey = unavailable
      ? 'mrLifecycle.pipelineUnavailable'
      : status === 'none'
      ? 'mrLifecycle.pipelineNone'
      : status === 'pending'
      ? 'mrLifecycle.pipelinePending'
      : status === 'running'
      ? 'mrLifecycle.pipelineRunning'
      : status === 'passed'
      ? 'mrLifecycle.pipelinePassed'
      : status === 'failed'
      ? 'mrLifecycle.pipelineFailed'
      : status === 'canceled'
      ? 'mrLifecycle.pipelineCanceled'
      : status === 'skipped'
      ? 'mrLifecycle.pipelineSkipped'
      : 'mrLifecycle.pipelineUnknown'
    return (
      <div data-verification="merge-request-pipeline-summary">
        <span>{this.tr('mrLifecycle.pipeline')}</span>
        <strong>{this.tr(key)}</strong>
      </div>
    )
  }

  private renderReadinessSummary(
    detailedStatus: string | undefined,
    unavailable: boolean
  ) {
    const readiness = classifyDetailedMergeStatus(
      unavailable ? undefined : detailedStatus
    )
    const key: TranslationKey = unavailable
      ? 'mrEditor.readinessUnknown'
      : readiness.kind === 'transient'
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
      <div data-verification="merge-request-readiness-summary" role="status">
        <span>{this.tr('mrLifecycle.readiness')}</span>
        <strong>{this.tr(key, variables)}</strong>
      </div>
    )
  }

  private approvalIntent(
    summary: IMergeRequestLifecycleSummary
  ): IMergeRequestApprovalIntent | null {
    const approval = summary.approval
    if (approval === null) {
      return null
    }
    const context = {
      route: summary.route,
      mergeRequestIid: summary.mergeRequestIid,
      headSha: summary.headSha,
    }
    return createHeadShaGuardedApprovalIntent(
      context,
      context,
      !approval.currentUserApproved
    )
  }

  private formatTime(value: string): string {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) {
      return this.tr('mrLifecycle.timeUnavailable')
    }
    return new Intl.DateTimeFormat(
      this.state.languageMode === 'cantonese' ? 'zh-HK' : 'en-CA',
      { dateStyle: 'medium', timeStyle: 'short' }
    ).format(date)
  }

  private blockerKey(status: string): TranslationKey {
    switch (status) {
      case 'ci_must_pass':
        return 'mrEditor.blockerCiMustPass'
      case 'ci_still_running':
        return 'mrEditor.blockerCiRunning'
      case 'commits_status':
        return 'mrEditor.blockerCommitsStatus'
      case 'conflict':
        return 'mrEditor.blockerConflict'
      case 'discussions_not_resolved':
        return 'mrEditor.blockerDiscussions'
      case 'draft_status':
        return 'mrEditor.blockerDraft'
      case 'jira_association_missing':
        return 'mrEditor.blockerJira'
      case 'merge_request_blocked':
        return 'mrEditor.blockerRequestBlocked'
      case 'merge_time':
        return 'mrEditor.blockerMergeTime'
      case 'need_rebase':
        return 'mrEditor.blockerRebase'
      case 'not_approved':
        return 'mrEditor.blockerApproval'
      case 'not_open':
        return 'mrEditor.blockerNotOpen'
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
      default:
        return 'mrEditor.blockerStatus'
    }
  }

  private operationActionKey(
    action: MergeRequestLifecycleAction
  ): TranslationKey {
    switch (action) {
      case 'close':
        return 'mrLifecycle.close'
      case 'reopen':
        return 'mrLifecycle.reopen'
      case 'approve':
        return 'mrLifecycle.approve'
      case 'unapprove':
        return 'mrLifecycle.unapprove'
      case 'refresh':
        return 'mrLifecycle.refresh'
      case 'open':
        return 'mrLifecycle.openCanonical'
    }
  }

  private renderOperation(operation: MergeRequestLifecycleOperation) {
    if (operation.kind === 'idle') {
      return null
    }
    const key: TranslationKey =
      operation.kind === 'running'
        ? 'mrLifecycle.operationRunning'
        : operation.kind === 'success'
        ? 'mrLifecycle.operationSuccess'
        : operation.kind === 'canceled'
        ? 'mrLifecycle.operationCanceled'
        : 'mrLifecycle.operationError'
    const variables =
      operation.kind === 'running' || operation.kind === 'success'
        ? {
            action: bilingualVariable(
              translate(this.operationActionKey(operation.action), 'english'),
              translate(this.operationActionKey(operation.action), 'cantonese')
            ),
          }
        : undefined
    return (
      <div
        className={`merge-request-lifecycle-operation is-${operation.kind}`}
        data-verification="merge-request-lifecycle-operation"
        role={operation.kind === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        {this.tr(key, variables)}
      </div>
    )
  }

  private onApprovalChanged = () => {
    const availability = this.props.availability
    if (availability.kind !== 'ready' && availability.kind !== 'partial') {
      return
    }
    if (
      this.props.operation?.kind === 'running' ||
      (availability.kind === 'partial' &&
        availability.unavailable.includes('approval'))
    ) {
      return
    }
    const intent = this.approvalIntent(availability.summary)
    if (intent !== null) {
      this.props.onApprovalChange(intent)
    }
  }

  private onOpenCanonical = () => {
    if (
      this.props.availability.kind !== 'ready' &&
      this.props.availability.kind !== 'partial'
    ) {
      return
    }
    if (this.props.operation?.kind === 'running') {
      return
    }
    const url = canonicalURL(this.props.availability.summary.canonicalUrl)
    if (url !== null) {
      this.props.onOpenCanonicalUrl(url)
    }
  }

  private onLanguageModeChanged = (event: Event) => {
    this.setState({
      languageMode: normalizeLanguageMode(
        (event as CustomEvent<unknown>).detail
      ),
    })
  }
}

/** Name retained for integrations which distinguish summary and action surfaces. */
export const MergeRequestLifecycleSummary = MergeRequestLifecycleActions

export function getMergeRequestLifecycleSummary(
  availability: MergeRequestLifecycleAvailability
): IMergeRequestLifecycleSummary | null {
  return summaryFrom(availability)
}
