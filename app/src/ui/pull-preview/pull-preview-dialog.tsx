/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- bounded review regions need keyboard scrolling */
import * as React from 'react'

import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translate,
  translateForAccessibleName,
  TranslationKey,
  TranslationVariables,
} from '../../lib/i18n'
import { IPreparedPullPreview, PullPreviewError } from '../../lib/pull-preview'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { Repository } from '../../models/repository'
import { AppFileStatusKind, FileChange } from '../../models/status'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { createObservableRef } from '../lib/observable-ref'
import { Tooltip } from '../lib/tooltip'
import { TooltippedContent } from '../lib/tooltipped-content'

interface IPullPreviewDialogProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly onDismissed: () => void
}

interface IPullPreviewDialogState {
  readonly languageMode: LanguageMode
  readonly phase: 'loading' | 'review' | 'pulling'
  readonly prepared: IPreparedPullPreview | null
  readonly errorKey: TranslationKey | null
}

function shortRef(ref: string): string {
  return ref.replace(/^refs\/(?:heads|remotes)\//, '')
}

function shortOid(oid: string): string {
  return oid.slice(0, 8)
}

interface IPullPreviewOidProps {
  readonly oid: string
}

class PullPreviewOid extends React.Component<IPullPreviewOidProps> {
  private readonly elementRef = createObservableRef<HTMLElement>()

  public render() {
    const { oid } = this.props
    return (
      <>
        <code ref={this.elementRef} aria-hidden="true">
          {shortOid(oid)}
        </code>
        <span className="sr-only">{oid}</span>
        <Tooltip target={this.elementRef} className="sha-hint">
          {oid}
        </Tooltip>
      </>
    )
  }
}

function fileStatusKey(file: FileChange): TranslationKey {
  switch (file.status.kind) {
    case AppFileStatusKind.New:
      return 'pullPreview.fileNew'
    case AppFileStatusKind.Deleted:
      return 'pullPreview.fileDeleted'
    case AppFileStatusKind.Renamed:
      return 'pullPreview.fileRenamed'
    case AppFileStatusKind.Copied:
      return 'pullPreview.fileCopied'
    case AppFileStatusKind.Modified:
    case AppFileStatusKind.Conflicted:
    case AppFileStatusKind.Untracked:
      return 'pullPreview.fileModified'
  }
}

export class PullPreviewDialog extends React.Component<
  IPullPreviewDialogProps,
  IPullPreviewDialogState
> {
  private loadGeneration = 0
  private isMountedFlag = false
  private pullInFlight = false

  public constructor(props: IPullPreviewDialogProps) {
    super(props)
    this.state = {
      languageMode: getPersistedLanguageMode(),
      phase: 'loading',
      prepared: null,
      errorKey: null,
    }
  }

  public componentDidMount(): void {
    this.isMountedFlag = true
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
    void this.loadPreview()
  }

  public componentWillUnmount(): void {
    this.isMountedFlag = false
    this.loadGeneration++
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  private onLanguageModeChanged = (event: Event) => {
    this.setState({
      languageMode: normalizeLanguageMode(
        (event as CustomEvent<unknown>).detail
      ),
    })
  }

  private localize(
    key: TranslationKey,
    variables?: TranslationVariables
  ): string {
    return translate(key, this.state.languageMode, variables)
  }

  private accessibleName(
    key: TranslationKey,
    variables?: TranslationVariables
  ): string {
    return translateForAccessibleName(
      key,
      variables ?? {},
      this.state.languageMode
    )
  }

  private loadPreview = async () => {
    const generation = ++this.loadGeneration
    this.setState({ phase: 'loading', prepared: null, errorKey: null })

    try {
      const prepared = await this.props.dispatcher.preparePullPreview(
        this.props.repository
      )
      if (this.isMountedFlag && generation === this.loadGeneration) {
        this.setState({ phase: 'review', prepared, errorKey: null })
      }
    } catch (error) {
      if (this.isMountedFlag && generation === this.loadGeneration) {
        this.setState({
          phase: 'review',
          prepared: null,
          errorKey: this.errorKey(error),
        })
      }
    }
  }

  private canPull(): boolean {
    const { prepared } = this.state
    return (
      this.state.phase === 'review' &&
      prepared !== null &&
      prepared.result.kind === 'ready' &&
      prepared.integrationPlan?.canIntegrate === true &&
      prepared.worktreeState === 'clean'
    )
  }

  private onPull = async () => {
    const prepared = this.state.prepared
    if (
      this.pullInFlight ||
      !this.canPull() ||
      prepared?.result.kind !== 'ready'
    ) {
      return
    }

    this.pullInFlight = true
    this.setState({ phase: 'pulling', errorKey: null })
    try {
      await this.props.dispatcher.pullReviewed(this.props.repository, prepared)
      if (this.isMountedFlag) {
        this.props.onDismissed()
      }
    } catch (error) {
      this.pullInFlight = false
      if (this.isMountedFlag) {
        this.setState({
          phase: 'review',
          prepared: null,
          errorKey: this.errorKey(error),
        })
      } else {
        const normalizedError =
          error instanceof Error ? error : new Error(String(error))
        void this.props.dispatcher.postError(normalizedError)
      }
    }
  }

  private unavailableMessage(reason: string): TranslationKey {
    switch (reason) {
      case 'detached-head':
        return 'pullPreview.detached'
      case 'no-upstream':
        return 'pullPreview.noUpstream'
      default:
        return 'pullPreview.invalidState'
    }
  }

  private errorKey(error: unknown): TranslationKey {
    if (!(error instanceof PullPreviewError)) {
      return 'pullPreview.errorUnexpected'
    }

    switch (error.code) {
      case 'busy':
        return 'pullPreview.errorBusy'
      case 'remote-unavailable':
        return 'pullPreview.errorRemoteUnavailable'
      case 'fetch-failed':
        return 'pullPreview.errorFetchFailed'
      case 'no-incoming-commits':
        return 'pullPreview.errorNoIncoming'
      case 'dirty-worktree':
        return 'pullPreview.errorDirty'
      case 'conflicted-worktree':
        return 'pullPreview.errorConflicted'
      case 'invalid-config':
        return 'pullPreview.errorInvalidConfig'
      case 'stale-preview':
        return 'pullPreview.errorStale'
      case 'pull-failed':
        return 'pullPreview.errorPullFailed'
    }
  }

  private strategyLabel(): string | null {
    switch (this.state.prepared?.integrationPlan?.outcome) {
      case 'fast-forward':
        return this.localize('pullPreview.strategyFastForward')
      case 'merge':
        return this.localize('pullPreview.strategyMerge')
      case 'rebase':
        return this.localize('pullPreview.strategyRebase')
      case 'rebase-merges':
        return this.localize('pullPreview.strategyRebaseMerges')
      case 'rebase-interactive':
        return this.localize('pullPreview.strategyRebaseInteractive')
      case 'fast-forward-only-blocked':
        return this.localize('pullPreview.strategyFastForwardOnly')
      default:
        return null
    }
  }

  private renderError(): JSX.Element | null {
    if (this.state.errorKey === null) {
      return null
    }

    return (
      <section className="pull-preview-error" role="alert">
        <strong>{this.localize('pullPreview.errorTitle')}</strong>
        <p>{this.localize(this.state.errorKey)}</p>
      </section>
    )
  }

  private renderPreparedPreview(): JSX.Element | null {
    const prepared = this.state.prepared
    if (prepared === null) {
      return null
    }

    const result = prepared.result
    if (result.kind === 'unavailable') {
      return (
        <p className="pull-preview-unavailable" role="status">
          {this.localize(this.unavailableMessage(result.reason))}
        </p>
      )
    }

    const strategy = this.strategyLabel()
    const moreCommits = Math.max(
      result.behind - result.incomingCommits.length,
      0
    )
    const moreFiles = Math.max(
      result.changedFileCount - result.changedFiles.length,
      0
    )

    return (
      <section
        className="pull-preview-review"
        aria-label={this.accessibleName('pullPreview.reviewAria')}
      >
        <div
          className="pull-preview-route"
          role="group"
          aria-label={this.accessibleName('pullPreview.routeAria')}
        >
          <div>
            <span>{this.localize('pullPreview.localBranch')}</span>
            <strong>{shortRef(result.currentBranchRef)}</strong>
            <PullPreviewOid oid={result.currentBranchOid} />
          </div>
          <span className="pull-preview-route-arrow" aria-hidden="true">
            ←
          </span>
          <div>
            <span>{this.localize('pullPreview.upstreamBranch')}</span>
            <strong>{shortRef(result.upstreamRef)}</strong>
            <PullPreviewOid oid={result.upstreamOid} />
          </div>
        </div>

        <div className="pull-preview-metrics">
          <span>
            {this.localize('pullPreview.ahead', {
              count: String(result.ahead),
            })}
          </span>
          <span>
            {this.localize('pullPreview.behind', {
              count: String(result.behind),
            })}
          </span>
          {strategy !== null ? (
            <span>
              {this.localize('pullPreview.strategy')}: {strategy}
            </span>
          ) : null}
        </div>

        {result.behind === 0 ? (
          <div className="pull-preview-up-to-date" role="status">
            <strong>{this.localize('pullPreview.upToDateTitle')}</strong>
            <p>{this.localize('pullPreview.upToDateBody')}</p>
          </div>
        ) : (
          <div className="pull-preview-columns">
            <section>
              <h2 id="pull-preview-commits-title">
                {this.localize('pullPreview.incomingCommits')}
              </h2>
              <div
                className="pull-preview-list-scroll"
                role="region"
                aria-labelledby="pull-preview-commits-title"
                tabIndex={0}
              >
                <ol className="pull-preview-list">
                  {result.incomingCommits.map(commit => (
                    <li key={commit.sha}>
                      <PullPreviewOid oid={commit.sha} />
                      <span>{commit.summary}</span>
                    </li>
                  ))}
                </ol>
              </div>
              {result.incomingCommitsTruncated && moreCommits > 0 ? (
                <p className="pull-preview-more">
                  {this.localize('pullPreview.moreCommits', {
                    count: String(moreCommits),
                  })}
                </p>
              ) : null}
            </section>

            <section>
              <h2 id="pull-preview-files-title">
                {this.localize('pullPreview.changedFiles')}
              </h2>
              {result.changedFiles.length === 0 ? (
                <p className="pull-preview-empty">
                  {this.localize('pullPreview.noChangedFiles')}
                </p>
              ) : (
                <div
                  className="pull-preview-list-scroll"
                  role="region"
                  aria-labelledby="pull-preview-files-title"
                  tabIndex={0}
                >
                  <ul className="pull-preview-list">
                    {result.changedFiles.map(file => {
                      const path =
                        file.status.kind === AppFileStatusKind.Renamed ||
                        file.status.kind === AppFileStatusKind.Copied
                          ? `${file.status.oldPath} → ${file.path}`
                          : file.path
                      return (
                        <li key={file.id}>
                          <span
                            className={`pull-preview-file-status ${file.status.kind.toLowerCase()}`}
                          >
                            {this.localize(fileStatusKey(file))}
                          </span>
                          <TooltippedContent
                            tooltip={path}
                            onlyWhenOverflowed={true}
                          >
                            {path}
                          </TooltippedContent>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
              {result.changedFilesTruncated && moreFiles > 0 ? (
                <p className="pull-preview-more">
                  {this.localize('pullPreview.moreFiles', {
                    count: String(moreFiles),
                  })}
                </p>
              ) : null}
            </section>
          </div>
        )}

        {prepared.worktreeState !== 'clean' ? (
          <p className="pull-preview-warning" role="alert">
            {this.localize(
              prepared.worktreeState === 'conflicted'
                ? 'pullPreview.conflictedWarning'
                : 'pullPreview.dirtyWarning'
            )}
          </p>
        ) : null}

        {prepared.integrationPlan?.outcome === 'fast-forward-only-blocked' ? (
          <p className="pull-preview-warning" role="alert">
            {this.localize('pullPreview.fastForwardOnlyWarning')}
          </p>
        ) : null}

        {result.behind > 0 ? (
          <div className="pull-preview-notes">
            <p>{this.localize('pullPreview.exactCommitNote')}</p>
            {result.ahead > 0 ? (
              <p>{this.localize('pullPreview.conflictNote')}</p>
            ) : null}
          </div>
        ) : null}
      </section>
    )
  }

  public render() {
    const busy =
      this.state.phase === 'loading' || this.state.phase === 'pulling'

    return (
      <Dialog
        id="pull-preview"
        title={this.localize('pullPreview.title')}
        loading={busy}
        dismissDisabled={busy}
        onDismissed={this.props.onDismissed}
        onSubmit={this.onPull}
      >
        <DialogContent>
          {this.state.phase === 'loading' ? (
            <p className="pull-preview-loading" role="status">
              {this.localize('pullPreview.loading')}
            </p>
          ) : (
            <>
              {this.renderError()}
              {this.renderPreparedPreview()}
            </>
          )}
        </DialogContent>
        {this.state.phase === 'loading' ? null : (
          <DialogFooter>
            <div className="button-group">
              {this.state.phase === 'review' ? (
                <>
                  <Button onClick={this.props.onDismissed}>
                    {this.localize('pullPreview.cancel')}
                  </Button>
                  <Button onClick={this.loadPreview}>
                    {this.localize('pullPreview.refresh')}
                  </Button>
                </>
              ) : null}
              <Button type="submit" disabled={!this.canPull()}>
                {this.localize(
                  this.state.phase === 'pulling'
                    ? 'pullPreview.pulling'
                    : 'pullPreview.pull'
                )}
              </Button>
            </div>
          </DialogFooter>
        )}
      </Dialog>
    )
  }
}
