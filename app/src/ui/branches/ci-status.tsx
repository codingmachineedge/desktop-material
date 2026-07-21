import * as React from 'react'
import { OcticonSymbol } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { MaterialSymbol, MaterialSymbolName } from '../lib/material-symbol'
import classNames from 'classnames'
import { GitHubRepository } from '../../models/github-repository'
import type { Disposable } from 'event-kit'
import { Dispatcher } from '../dispatcher'
import { ICombinedRefCheck, IRefCheck } from '../../lib/ci-checks/ci-checks'
import { APICheckConclusion, IAPIWorkflowJobStep } from '../../lib/api'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  t,
  translateForAccessibleName,
  translatedVariable,
  TranslationKey,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'

interface ICIStatusProps {
  /** The classname for the underlying element. */
  readonly className?: string

  readonly dispatcher: Dispatcher

  /** The GitHub repository to use when looking up commit status. */
  readonly repository: GitHubRepository

  /** The commit ref (can be a SHA or a Git ref) for which to fetch status. */
  readonly commitRef: string

  /** A callback to bubble up whether there is a check displayed */
  readonly onCheckChange?: (check: ICombinedRefCheck | null) => void
}

interface ICIStatusState {
  readonly check: ICombinedRefCheck | null
  readonly languageMode: LanguageMode
}

/** The little CI status indicator. */
export class CIStatus extends React.PureComponent<
  ICIStatusProps,
  ICIStatusState
> {
  private statusSubscription: Disposable | null = null

  public constructor(props: ICIStatusProps) {
    super(props)
    const check = props.dispatcher.tryGetCommitStatus(
      this.props.repository,
      this.props.commitRef
    )
    this.state = {
      check,
      languageMode: getPersistedLanguageMode(),
    }
    this.props.onCheckChange?.(check)
  }

  private subscribe() {
    this.unsubscribe()

    this.statusSubscription = this.props.dispatcher.subscribeToCommitStatus(
      this.props.repository,
      this.props.commitRef,
      this.onStatus
    )
  }

  private unsubscribe() {
    if (this.statusSubscription) {
      this.statusSubscription.dispose()
      this.statusSubscription = null
    }
  }

  public componentDidUpdate(prevProps: ICIStatusProps) {
    // Re-subscribe if we're being reused to show a different status.
    if (
      this.props.repository !== prevProps.repository ||
      this.props.commitRef !== prevProps.commitRef
    ) {
      this.setState({
        check: this.props.dispatcher.tryGetCommitStatus(
          this.props.repository,
          this.props.commitRef
        ),
      })
      this.subscribe()
    }
  }

  public componentDidMount() {
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    this.subscribe()
  }

  public componentWillUnmount() {
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    this.unsubscribe()
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }

  private onStatus = (check: ICombinedRefCheck | null) => {
    if (this.props.onCheckChange !== undefined) {
      this.props.onCheckChange(check)
    }

    this.setState({ check })
  }

  public render() {
    const { check } = this.state

    if (check === null || check.checks.length === 0) {
      return null
    }

    const accessibleName = translateForAccessibleName(
      'ci.status',
      { status: translatedVariable(getTranslationKeyForCheck(check)) },
      this.state.languageMode
    )

    // MaterialSymbol is always decorative (aria-hidden); the status meaning is
    // carried by the labelled wrapper so the check remains announced/hoverable.
    return (
      <span
        className={classNames(
          'ci-status',
          `ci-status-${getClassNameForCheck(check)}`,
          this.props.className
        )}
        role="img"
        aria-label={accessibleName}
      >
        <MaterialSymbol
          name={getMaterialSymbolForCheck(check)}
          size={16}
          fill={1}
        />
      </span>
    )
  }
}

export function getLabelForCheck(check: {
  readonly conclusion: APICheckConclusion | null
}): string {
  return t(getTranslationKeyForCheck(check))
}

function getTranslationKeyForCheck(check: {
  readonly conclusion: APICheckConclusion | null
}): TranslationKey {
  let key: TranslationKey
  switch (check.conclusion) {
    case 'timed_out':
      key = 'ci.timedOut'
      break
    case 'action_required':
      key = 'ci.actionRequired'
      break
    case 'failure':
      key = 'ci.failed'
      break
    case 'neutral':
      key = 'ci.neutral'
      break
    case 'success':
      key = 'ci.successful'
      break
    case 'cancelled':
      key = 'ci.cancelled'
      break
    case 'skipped':
      key = 'ci.skipped'
      break
    case 'stale':
      key = 'ci.stale'
      break
    default:
      key = 'ci.inProgress'
  }
  return key
}

export function getSymbolForCheck(
  check: ICombinedRefCheck | IRefCheck | IAPIWorkflowJobStep
): OcticonSymbol {
  switch (check.conclusion) {
    case 'timed_out':
      return octicons.x
    case 'failure':
      return octicons.x
    case 'neutral':
      return octicons.squareFill
    case 'success':
      return octicons.check
    case 'cancelled':
      return octicons.stop
    case 'action_required':
      return octicons.alert
    case 'skipped':
      return octicons.skip
    case 'stale':
      return octicons.issueReopened
  }

  // Pending
  return octicons.dotFill
}

/**
 * The Material Symbols Rounded ligature used by the {@link CIStatus} indicator.
 * Kept separate from {@link getSymbolForCheck} (which still feeds the
 * Octicon-based check-run surfaces) so the coloured `ci-status-*` role classes
 * drive the glyph tint while the prototype's run glyphs (check_circle / cancel /
 * schedule / do_not_disturb_on …) render as Material Symbols.
 */
export function getMaterialSymbolForCheck(
  check: ICombinedRefCheck | IRefCheck | IAPIWorkflowJobStep
): MaterialSymbolName {
  switch (check.conclusion) {
    case 'timed_out':
      return 'schedule'
    case 'failure':
      return 'error'
    case 'neutral':
      return 'do_not_disturb_on'
    case 'success':
      return 'check_circle'
    case 'cancelled':
      return 'cancel'
    case 'action_required':
      return 'warning'
    case 'skipped':
      return 'do_not_disturb_on'
    case 'stale':
      return 'sync_problem'
  }

  // Pending
  return 'circle'
}

export function getClassNameForCheck(
  check: ICombinedRefCheck | IRefCheck | IAPIWorkflowJobStep
): string {
  switch (check.conclusion) {
    case 'timed_out':
      return 'timed-out'
    case 'action_required':
      return 'action-required'
    case 'failure':
    case 'neutral':
    case 'success':
    case 'cancelled':
    case 'skipped':
    case 'stale':
      return check.conclusion
  }

  // Pending
  return 'pending'
}

export function getSymbolForLogStep(
  logStep: IAPIWorkflowJobStep
): OcticonSymbol {
  switch (logStep.conclusion) {
    case 'success':
      return octicons.checkCircleFill
    case 'failure':
      return octicons.xCircleFill
  }

  return getSymbolForCheck(logStep)
}

export function getClassNameForLogStep(logStep: IAPIWorkflowJobStep): string {
  switch (logStep.conclusion) {
    case 'failure':
      return logStep.conclusion
  }

  // Pending
  return ''
}
