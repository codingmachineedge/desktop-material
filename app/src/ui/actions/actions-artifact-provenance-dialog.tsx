import * as React from 'react'
import { ActionsArtifactProvenanceResult } from '../../lib/actions-artifact-provenance'
import {
  IActionsArtifactProvenanceReview as IActionsArtifactProvenanceStoreReview,
  IActionsArtifactProvenanceReviewSigner,
  IActionsArtifactProvenanceVerificationSelection,
} from '../../lib/stores/actions-store'
import { Button } from '../lib/button'
import { Select } from '../lib/select'
import { formatBytes } from '../lib/bytes'
import { trapActionsDialogFocus } from './actions-dialog-focus'

interface IActionsArtifactProvenanceDialogProps {
  readonly review: IActionsArtifactProvenanceStoreReview | null
  readonly loading: boolean
  readonly verifying: boolean
  readonly result: ActionsArtifactProvenanceResult | null
  readonly error: Error | null
  readonly onVerify: (
    selection: IActionsArtifactProvenanceVerificationSelection
  ) => void
  readonly onCancelVerification: () => void
  readonly onRetry: () => void
  readonly onDismissed: () => void
}

interface IActionsArtifactProvenanceDialogState {
  readonly entryId: string
  readonly signerCandidateId: string
}

let actionsArtifactProvenanceDialogSequence = 0

function digest(value: string): string {
  return value.replace(/^sha256:/, 'sha256:')
}

function signerLabel(signer: IActionsArtifactProvenanceReviewSigner): string {
  return `${signer.identity} · ${
    signer.kind === 'current-workflow'
      ? 'current workflow'
      : 'reusable workflow'
  }`
}

function resultStatus(result: ActionsArtifactProvenanceResult): {
  readonly label: string
  readonly tone: 'success' | 'warning' | 'failure'
} {
  if (result.ok) {
    return { label: 'Verified', tone: 'success' }
  }
  switch (result.reason) {
    case 'canceled':
      return { label: 'Canceled', tone: 'warning' }
    case 'archive-changed':
    case 'invalid-archive':
    case 'entry-unavailable':
      return { label: 'Changed bytes', tone: 'warning' }
    case 'not-attested':
      return { label: 'Not attested', tone: 'warning' }
    case 'verification-failed':
    case 'invalid-result':
      return { label: 'Verification failed', tone: 'failure' }
    default:
      return { label: 'Unavailable', tone: 'warning' }
  }
}

function resultGuidance(result: ActionsArtifactProvenanceResult): string {
  if (result.ok) {
    return 'Only this selected subject was verified. Other files and the ZIP transport digest remain separate claims.'
  }
  switch (result.reason) {
    case 'not-attested':
      return 'No bounded attestation matched this selected subject and fixed policy. The archive remains available for another subject selection.'
    case 'archive-changed':
    case 'invalid-archive':
    case 'entry-unavailable':
      return 'The archive or selected member changed or is no longer safe to read. Download it again before verifying.'
    case 'verification-failed':
    case 'invalid-result':
      return 'The verifier returned a bounded policy or signature failure. No raw verifier output is shown.'
    case 'canceled':
      return 'Verification was canceled before a result could be completed.'
    default:
      return 'The selected host, account, trust material, or provider capability is unavailable. No failed signature claim was made.'
  }
}

function safeError(error: Error | null): string | null {
  return error === null ? null : error.message
}

/** Review one downloaded ZIP subject without exposing paths, tokens, or raw verifier output. */
export class ActionsArtifactProvenanceDialog extends React.Component<
  IActionsArtifactProvenanceDialogProps,
  IActionsArtifactProvenanceDialogState
> {
  private previousFocus: HTMLElement | null = null
  private dialog: HTMLElement | null = null
  private readonly titleId: string
  private readonly descriptionId: string
  private readonly errorId: string

  public constructor(props: IActionsArtifactProvenanceDialogProps) {
    super(props)
    const instanceId = ++actionsArtifactProvenanceDialogSequence
    this.titleId = `actions-artifact-provenance-title-${instanceId}`
    this.descriptionId = `actions-artifact-provenance-description-${instanceId}`
    this.errorId = `actions-artifact-provenance-error-${instanceId}`
    this.state = { entryId: '', signerCandidateId: '' }
  }

  public componentDidMount() {
    this.previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    this.dialog?.focus()
  }

  public componentDidUpdate(prevProps: IActionsArtifactProvenanceDialogProps) {
    if (
      prevProps.review?.reviewId !== this.props.review?.reviewId &&
      this.props.review !== null
    ) {
      this.setState({
        entryId: this.props.review.entries[0]?.entryId ?? '',
        signerCandidateId:
          this.props.review.signerCandidates[0]?.candidateId ?? '',
      })
    }
  }

  public componentWillUnmount() {
    if (this.previousFocus?.isConnected) {
      this.previousFocus.focus()
    }
  }

  private setDialogRef = (dialog: HTMLFormElement | null) => {
    this.dialog = dialog
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    event.stopPropagation()
    trapActionsDialogFocus(event, event.currentTarget)
    if (event.key === 'Escape' && !this.props.verifying) {
      event.preventDefault()
      this.props.onDismissed()
    }
  }

  private onEntryChange = (event: React.FormEvent<HTMLSelectElement>) => {
    this.setState({ entryId: event.currentTarget.value })
  }

  private onSignerCandidateChange = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    this.setState({ signerCandidateId: event.currentTarget.value })
  }

  private submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (
      !this.props.verifying &&
      this.state.entryId.length > 0 &&
      this.state.signerCandidateId.length > 0
    ) {
      this.props.onVerify({
        entryId: this.state.entryId,
        signerCandidateId: this.state.signerCandidateId,
      })
    }
  }

  private renderArchiveSummary(review: IActionsArtifactProvenanceStoreReview) {
    return (
      <div className="actions-provenance-summary-grid">
        <div className="actions-provenance-digest">
          <span>Archive transport digest</span>
          <code>{digest(review.archive.digest)}</code>
          <small>
            {formatBytes(review.archive.bytes, 1)} downloaded bytes · exact ZIP
            transport identity
          </small>
        </div>
        <div className="actions-provenance-digest">
          <span>Selected subject digest</span>
          <p>
            Select one regular file below; it is re-read and hashed immediately
            before verification.
          </p>
        </div>
      </div>
    )
  }

  private renderPolicy(review: IActionsArtifactProvenanceStoreReview) {
    return (
      <section
        className="actions-provenance-section"
        aria-labelledby={this.descriptionId}
      >
        <div className="actions-provenance-section-heading">
          <div>
            <span className="eyebrow">Fixed verification policy</span>
            <h3 id={this.descriptionId}>Source, account, and signer scope</h3>
          </div>
          <span className="actions-status-chip neutral">SLSA v1</span>
        </div>
        <dl className="actions-provenance-metadata">
          <div>
            <dt>Selected account</dt>
            <dd>
              {review.account.login} · {review.account.friendlyEndpoint}
            </dd>
          </div>
          <div>
            <dt>Source repository</dt>
            <dd>{review.source.repository}</dd>
          </div>
          <div>
            <dt>Source commit</dt>
            <dd>
              <code>{review.source.digest}</code>
            </dd>
          </div>
          <div>
            <dt>Authoritative ref</dt>
            <dd>
              <code>{review.source.ref}</code>
            </dd>
          </div>
          <div>
            <dt>Workflow run attempt</dt>
            <dd>
              #{review.run.id} · attempt {review.run.attempt}
            </dd>
          </div>
          <div>
            <dt>Visibility at signing</dt>
            <dd>{review.source.visibility}</dd>
          </div>
        </dl>
      </section>
    )
  }

  private renderSelection(review: IActionsArtifactProvenanceStoreReview) {
    return (
      <section
        className="actions-provenance-selection"
        aria-label="Subject and signer selection"
      >
        <div className="actions-provenance-selection-heading">
          <div>
            <span className="eyebrow">Explicit subject selection</span>
            <h3>Choose one file to verify</h3>
          </div>
          <small>
            {review.entries.length} regular file
            {review.entries.length === 1 ? '' : 's'} inventoried
          </small>
        </div>
        <p className="actions-provenance-guidance">
          Selecting a member does not verify the archive or any other ZIP file.
        </p>
        <div className="actions-provenance-select-grid">
          <Select
            label="ZIP member"
            value={this.state.entryId}
            disabled={this.props.verifying}
            onChange={this.onEntryChange}
          >
            {review.entries.map(entry => (
              <option key={entry.entryId} value={entry.entryId}>
                {entry.path} · {formatBytes(entry.bytes, 1)}
              </option>
            ))}
          </Select>
          <Select
            label="Signer scope"
            value={this.state.signerCandidateId}
            disabled={this.props.verifying}
            onChange={this.onSignerCandidateChange}
          >
            {review.signerCandidates.map(signer => (
              <option key={signer.candidateId} value={signer.candidateId}>
                {signerLabel(signer)}
              </option>
            ))}
          </Select>
        </div>
        <div className="actions-provenance-selection-details">
          <div>
            <span>Selected member</span>
            <code>
              {review.entries.find(
                entry => entry.entryId === this.state.entryId
              )?.path ?? 'Choose a member'}
            </code>
          </div>
          <div>
            <span>Signer identity</span>
            <code>
              {review.signerCandidates.find(
                signer => signer.candidateId === this.state.signerCandidateId
              )?.identity ?? 'Choose a signer'}
            </code>
          </div>
        </div>
      </section>
    )
  }

  private renderResult(result: ActionsArtifactProvenanceResult) {
    const status = resultStatus(result)
    return (
      <section
        className={`actions-provenance-result ${status.tone}`}
        aria-live="polite"
      >
        <header>
          <div>
            <span className="eyebrow">Verification result</span>
            <h3>{status.label}</h3>
          </div>
          <span className={`actions-status-chip ${status.tone}`}>
            {status.label}
          </span>
        </header>
        <p>{resultGuidance(result)}</p>
        {result.ok ? (
          <dl className="actions-provenance-evidence">
            <div>
              <dt>Verified subject</dt>
              <dd>
                <code>{result.subject.path}</code>
              </dd>
            </div>
            <div>
              <dt>Subject digest</dt>
              <dd>
                <code>{result.subject.digest}</code>
              </dd>
            </div>
            <div>
              <dt>Certificate issuer</dt>
              <dd>{result.evidence.oidcIssuer}</dd>
            </div>
            <div>
              <dt>Signer</dt>
              <dd>
                <code>{result.evidence.signerIdentity}</code>
              </dd>
            </div>
            <div>
              <dt>Attestation evidence</dt>
              <dd>
                {result.evidence.attestations.length} bounded attestation
                {result.evidence.attestations.length === 1 ? '' : 's'} retained
              </dd>
            </div>
          </dl>
        ) : (
          <p className="actions-provenance-result-reason">
            Outcome code: {result.reason}
          </p>
        )}
      </section>
    )
  }

  public render() {
    const { review } = this.props
    const error = safeError(this.props.error)
    const canVerify =
      review !== null &&
      this.state.entryId.length > 0 &&
      this.state.signerCandidateId.length > 0
    return (
      <div className="actions-dialog-layer">
        {/* The dialog owns Escape and Tab so the review never leaks focus to the page. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <form
          ref={this.setDialogRef}
          className="actions-artifact-provenance-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={this.titleId}
          aria-describedby={this.descriptionId}
          tabIndex={-1}
          onKeyDown={this.onKeyDown}
          onSubmit={this.submit}
        >
          <header>
            <div>
              <span className="eyebrow">Actions artifact security</span>
              <h2 id={this.titleId}>Verify provenance</h2>
            </div>
            <Button
              size="small"
              onClick={this.props.onDismissed}
              disabled={this.props.verifying}
            >
              Close
            </Button>
          </header>
          <p className="actions-provenance-intro">
            Review the fixed policy, choose one ZIP subject, and verify only
            those bytes through the selected repository account.
          </p>
          {this.props.loading && (
            <div className="actions-loading" role="status">
              Preparing archive inventory and provenance policy…
            </div>
          )}
          {error !== null && (
            <div
              id={this.errorId}
              className="actions-inline-error"
              role="alert"
            >
              {error}
            </div>
          )}
          {review !== null && (
            <>
              {this.renderArchiveSummary(review)}
              {this.renderPolicy(review)}
              {this.renderSelection(review)}
            </>
          )}
          {this.props.result !== null && this.renderResult(this.props.result)}
          <footer>
            {this.props.verifying ? (
              <Button onClick={this.props.onCancelVerification}>
                Cancel verification
              </Button>
            ) : error !== null ? (
              <Button
                onClick={this.props.onRetry}
                disabled={this.props.loading}
              >
                Retry review
              </Button>
            ) : null}
            <Button
              onClick={this.props.onDismissed}
              disabled={this.props.verifying}
            >
              Close
            </Button>
            <Button
              type="submit"
              className="button-component-primary"
              disabled={
                !canVerify || this.props.loading || this.props.verifying
              }
            >
              {this.props.verifying
                ? 'Verifying selected subject…'
                : 'Verify selected subject'}
            </Button>
          </footer>
        </form>
      </div>
    )
  }
}
