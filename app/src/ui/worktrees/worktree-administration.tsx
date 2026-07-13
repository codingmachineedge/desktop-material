import * as React from 'react'
import {
  IWorktreeMaintenancePreview,
  WorktreeMaintenanceOperation,
} from '../../models/worktree'
import { Button } from '../lib/button'

type WorktreeAdministrationPhase =
  | 'idle'
  | 'loading'
  | 'review'
  | 'running'
  | 'completed'
  | 'failed'

interface IWorktreeAdministrationProps {
  readonly repositoryPath: string
  readonly onPreview: (
    operation: WorktreeMaintenanceOperation
  ) => Promise<IWorktreeMaintenancePreview>
  readonly onRun: (
    operation: WorktreeMaintenanceOperation
  ) => Promise<IWorktreeMaintenancePreview>
}

interface IWorktreeAdministrationState {
  readonly phase: WorktreeAdministrationPhase
  readonly preview: IWorktreeMaintenancePreview | null
  readonly status: string
  readonly error: string | null
}

function previewStatus(operation: WorktreeMaintenanceOperation): string {
  return operation === 'prune'
    ? 'Checking for missing worktree records…'
    : 'Checking registered worktree links…'
}

function emptyStatus(operation: WorktreeMaintenanceOperation): string {
  return operation === 'prune'
    ? 'No missing worktree records need pruning.'
    : 'No registered worktree links need repair.'
}

export class WorktreeAdministration extends React.Component<
  IWorktreeAdministrationProps,
  IWorktreeAdministrationState
> {
  private mounted = false
  private requestGeneration = 0
  private confirmButton: HTMLButtonElement | null = null

  public constructor(props: IWorktreeAdministrationProps) {
    super(props)
    this.state = this.initialState()
  }

  private initialState(): IWorktreeAdministrationState {
    return {
      phase: 'idle',
      preview: null,
      status: 'Review prune or repair before changing worktree metadata.',
      error: null,
    }
  }

  public componentDidMount() {
    this.mounted = true
  }

  public componentDidUpdate(
    prevProps: IWorktreeAdministrationProps,
    prevState: IWorktreeAdministrationState
  ) {
    if (prevProps.repositoryPath !== this.props.repositoryPath) {
      this.requestGeneration++
      this.setState(this.initialState())
      return
    }
    if (prevState.phase !== 'review' && this.state.phase === 'review') {
      this.confirmButton?.focus()
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.requestGeneration++
  }

  private isCurrentRequest(generation: number, repositoryPath: string) {
    return (
      this.mounted &&
      generation === this.requestGeneration &&
      repositoryPath === this.props.repositoryPath
    )
  }

  private preview = async (operation: WorktreeMaintenanceOperation) => {
    if (
      this.state.phase === 'loading' ||
      this.state.phase === 'running' ||
      this.state.phase === 'review'
    ) {
      return
    }
    const generation = ++this.requestGeneration
    const repositoryPath = this.props.repositoryPath
    this.setState({
      phase: 'loading',
      preview: null,
      status: previewStatus(operation),
      error: null,
    })
    try {
      const preview = await this.props.onPreview(operation)
      if (!this.isCurrentRequest(generation, repositoryPath)) {
        return
      }
      if (preview.operation !== operation || preview.affectedCount < 0) {
        throw new Error('The worktree maintenance preview was invalid.')
      }
      this.setState({
        phase: preview.affectedCount === 0 ? 'completed' : 'review',
        preview: preview.affectedCount === 0 ? null : preview,
        status:
          preview.affectedCount === 0
            ? emptyStatus(operation)
            : 'Review the exact maintenance scope before continuing.',
        error: null,
      })
    } catch (error) {
      if (this.isCurrentRequest(generation, repositoryPath)) {
        this.setState({
          phase: 'failed',
          preview: null,
          status: 'Worktree maintenance preview failed.',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to inspect worktree metadata.',
        })
      }
    }
  }

  private onPreviewPrune = () => {
    void this.preview('prune')
  }

  private onPreviewRepair = () => {
    void this.preview('repair')
  }

  private onConfirm = async () => {
    const preview = this.state.preview
    if (preview === null || this.state.phase !== 'review') {
      return
    }
    const generation = ++this.requestGeneration
    const repositoryPath = this.props.repositoryPath
    this.setState({
      phase: 'running',
      status:
        preview.operation === 'prune'
          ? 'Pruning revalidated missing records…'
          : 'Repairing revalidated worktree links…',
      error: null,
    })
    try {
      const result = await this.props.onRun(preview.operation)
      if (!this.isCurrentRequest(generation, repositoryPath)) {
        return
      }
      if (result.operation !== preview.operation || result.affectedCount < 0) {
        throw new Error('The worktree maintenance result was invalid.')
      }
      this.setState({
        phase: 'completed',
        preview: null,
        status:
          preview.operation === 'prune'
            ? `${result.affectedCount} missing worktree record${
                result.affectedCount === 1 ? '' : 's'
              } pruned.`
            : `${result.affectedCount} registered worktree link${
                result.affectedCount === 1 ? '' : 's'
              } repaired.`,
        error: null,
      })
    } catch (error) {
      if (this.isCurrentRequest(generation, repositoryPath)) {
        this.setState({
          phase: 'failed',
          preview: null,
          status: 'Worktree maintenance failed.',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to update worktree metadata.',
        })
      }
    }
  }

  private onCancel = () => {
    this.requestGeneration++
    this.setState(this.initialState())
  }

  private onConfirmButtonRef = (button: HTMLButtonElement | null) => {
    this.confirmButton = button
  }

  private renderReview() {
    const preview = this.state.preview
    if (this.state.phase !== 'review' || preview === null) {
      return null
    }
    const count = preview.affectedCount
    return (
      <div
        className="worktree-maintenance-review"
        role="alertdialog"
        aria-labelledby="worktree-maintenance-review-title"
        aria-describedby="worktree-maintenance-review-description"
      >
        <strong id="worktree-maintenance-review-title">
          {preview.operation === 'prune'
            ? `Prune ${count} missing worktree record${count === 1 ? '' : 's'}?`
            : `Repair ${count} registered worktree link${
                count === 1 ? '' : 's'
              }?`}
        </strong>
        <p id="worktree-maintenance-review-description">
          {preview.operation === 'prune'
            ? 'This removes stale Git administration records only. It does not delete a working directory.'
            : 'This repairs Git administrative links only. It does not rewrite commits or working files.'}
        </p>
        <div className="worktree-maintenance-controls">
          <Button
            onButtonRef={this.onConfirmButtonRef}
            onClick={this.onConfirm}
          >
            {preview.operation === 'prune' ? 'Prune records' : 'Repair links'}
          </Button>
          <Button onClick={this.onCancel}>Cancel</Button>
        </div>
      </div>
    )
  }

  public render() {
    const busy =
      this.state.phase === 'loading' ||
      this.state.phase === 'running' ||
      this.state.phase === 'review'
    return (
      <section
        className="worktree-administration"
        aria-labelledby="worktree-administration-title"
      >
        <h3 id="worktree-administration-title">Worktree maintenance</h3>
        <p>
          Preview stale-record pruning or registered-link repair with bounded,
          path-free results.
        </p>
        <div className="worktree-maintenance-controls">
          <Button disabled={busy} onClick={this.onPreviewPrune}>
            Preview prune
          </Button>
          <Button disabled={busy} onClick={this.onPreviewRepair}>
            Review repair
          </Button>
        </div>
        {this.renderReview()}
        <p
          className="worktree-maintenance-status"
          role="status"
          aria-live="polite"
        >
          {this.state.status}
        </p>
        {this.state.error !== null && (
          <p className="worktree-maintenance-error" role="alert">
            {this.state.error}
          </p>
        )}
      </section>
    )
  }
}
