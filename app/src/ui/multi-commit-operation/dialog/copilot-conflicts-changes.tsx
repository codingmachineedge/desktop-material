import * as React from 'react'
import * as Path from 'path'
import { AppFileStatusKind, CommittedFileChange } from '../../../models/status'
import { IDiff, ImageDiffType } from '../../../models/diff'
import { WorkingDirectoryFileChange } from '../../../models/status'
import { IFileResolution } from '../../../lib/copilot-conflict-resolution'
import { FileList } from '../../history/file-list'
import { Diff } from '../../diff'
import { DiffOptions } from '../../diff/diff-options'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { openFile } from '../../lib/open-file'
import { getResolutionDiff } from '../../../lib/git'

interface ICopilotConflictsChangesProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly conflictedFiles: ReadonlyArray<WorkingDirectoryFileChange>
  readonly copilotResolutions: ReadonlyArray<IFileResolution> | null
}

interface ICopilotConflictsChangesState {
  readonly selectedFile: CommittedFileChange | null
  readonly diff: IDiff | null
  readonly isLoadingDiff: boolean
  readonly showSideBySideDiff: boolean
  readonly hideWhitespaceInDiff: boolean
  readonly imageDiffType: ImageDiffType
}

/**
 * The Changes tab in the Copilot conflicts dialog, showing a file list
 * alongside a diff preview of Copilot's conflict resolutions.
 *
 * Uses the same FileList + Diff pattern as PullRequestFilesChanged.
 */
export class CopilotConflictsChanges extends React.Component<
  ICopilotConflictsChangesProps,
  ICopilotConflictsChangesState
> {
  private diffRequestId = 0
  private mounted = false

  public constructor(props: ICopilotConflictsChangesProps) {
    super(props)

    const files = this.getCommittedFiles()
    this.state = {
      selectedFile: files.length > 0 ? files[0] : null,
      diff: null,
      isLoadingDiff: false,
      showSideBySideDiff: false,
      hideWhitespaceInDiff: false,
      imageDiffType: ImageDiffType.TwoUp,
    }
  }

  public componentDidMount() {
    this.mounted = true
    if (this.state.selectedFile !== null) {
      this.loadDiffForFile(this.state.selectedFile)
    }
  }

  public componentWillUnmount() {
    this.mounted = false
  }

  public componentDidUpdate(
    prevProps: ICopilotConflictsChangesProps,
    prevState: ICopilotConflictsChangesState
  ) {
    const { selectedFile, hideWhitespaceInDiff } = this.state

    if (
      selectedFile !== prevState.selectedFile ||
      hideWhitespaceInDiff !== prevState.hideWhitespaceInDiff ||
      this.props.copilotResolutions !== prevProps.copilotResolutions
    ) {
      if (selectedFile !== null) {
        this.loadDiffForFile(selectedFile)
      } else {
        this.setState({ diff: null, isLoadingDiff: false })
      }
    }
  }

  /**
   * Convert WorkingDirectoryFileChange to CommittedFileChange for use
   * with the standard FileList component.
   */
  private getCommittedFiles(): ReadonlyArray<CommittedFileChange> {
    return this.props.conflictedFiles.map(
      f =>
        new CommittedFileChange(
          f.path,
          { kind: AppFileStatusKind.Modified },
          'HEAD',
          'HEAD^'
        )
    )
  }

  private async loadDiffForFile(file: CommittedFileChange) {
    const requestId = ++this.diffRequestId

    const resolution = this.props.copilotResolutions?.find(
      r => r.path === file.path
    )

    if (resolution === undefined) {
      this.setState({ diff: null, isLoadingDiff: false })
      return
    }

    this.setState({ isLoadingDiff: true })

    try {
      const diff = await getResolutionDiff(
        this.props.repository,
        file.path,
        { content: resolution.resolvedContent },
        this.state.hideWhitespaceInDiff
      )

      if (this.mounted && requestId === this.diffRequestId) {
        this.setState({ diff, isLoadingDiff: false })
      }
    } catch (e) {
      log.error('Failed to compute resolution diff', e)
      if (this.mounted && requestId === this.diffRequestId) {
        this.setState({ diff: null, isLoadingDiff: false })
      }
    }
  }

  private onSelectedFileChanged = (file: CommittedFileChange) => {
    this.setState({ selectedFile: file })
  }

  private onShowSideBySideDiffChanged = (showSideBySideDiff: boolean) => {
    this.setState({ showSideBySideDiff })
  }

  private onHideWhitespaceInDiffChanged = (hideWhitespaceInDiff: boolean) => {
    this.setState({ hideWhitespaceInDiff })
  }

  private onDiffOptionsOpened = () => {
    this.props.dispatcher.incrementMetric('diffOptionsViewedCount')
  }

  private onOpenBinaryFile = (fullPath: string) => {
    openFile(fullPath, this.props.dispatcher)
  }

  private onChangeImageDiffType = (imageDiffType: ImageDiffType) => {
    this.setState({ imageDiffType })
  }

  private onRowDoubleClick = (row: number) => {
    const file = this.getCommittedFiles()[row]
    if (file !== undefined) {
      const fullPath = Path.join(this.props.repository.path, file.path)
      openFile(fullPath, this.props.dispatcher)
    }
  }

  public render() {
    const files = this.getCommittedFiles()
    const {
      selectedFile,
      diff,
      isLoadingDiff,
      showSideBySideDiff,
      hideWhitespaceInDiff,
    } = this.state

    return (
      <div className="copilot-changes-tab">
        <div className="copilot-changes-header">
          <DiffOptions
            isInteractiveDiff={false}
            hideWhitespaceChanges={hideWhitespaceInDiff}
            onHideWhitespaceChangesChanged={this.onHideWhitespaceInDiffChanged}
            showSideBySideDiff={showSideBySideDiff}
            onShowSideBySideDiffChanged={this.onShowSideBySideDiffChanged}
            onDiffOptionsOpened={this.onDiffOptionsOpened}
          />
        </div>
        <div className="copilot-changes-content">
          <div className="copilot-changes-file-list">
            <FileList
              files={files}
              onSelectedFileChanged={this.onSelectedFileChanged}
              selectedFile={selectedFile}
              availableWidth={200}
              onRowDoubleClick={this.onRowDoubleClick}
            />
          </div>
          {selectedFile !== null && isLoadingDiff && (
            <div className="copilot-changes-loading">Loading diff&hellip;</div>
          )}
          {selectedFile !== null && !isLoadingDiff && diff !== null && (
            <Diff
              repository={this.props.repository}
              readOnly={true}
              file={selectedFile}
              diff={diff}
              fileContents={null}
              imageDiffType={this.state.imageDiffType}
              hideWhitespaceInDiff={hideWhitespaceInDiff}
              showSideBySideDiff={showSideBySideDiff}
              showDiffCheckMarks={false}
              onOpenBinaryFile={this.onOpenBinaryFile}
              onChangeImageDiffType={this.onChangeImageDiffType}
              onHideWhitespaceInDiffChanged={this.onHideWhitespaceInDiffChanged}
            />
          )}
          {selectedFile !== null && !isLoadingDiff && diff === null && (
            <div className="copilot-changes-no-diff">
              Diff preview is only available for files resolved by Copilot.
            </div>
          )}
        </div>
      </div>
    )
  }
}
