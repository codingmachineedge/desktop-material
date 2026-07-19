import * as React from 'react'
import memoizeOne from 'memoize-one'
import { mapStatus } from '../../lib/status'

import { CommittedFileChange } from '../../models/status'
import { ClickSource, List } from '../lib/list'
import { CommittedFileItem } from './committed-file-item'
import {
  buildChangedFileTreeRows,
  ChangedFileTreeRow,
  ChangedFileViewMode,
  ChangedFileViewModeChangedEvent,
  normalizeChangedFileViewMode,
  readChangedFileViewMode,
} from '../lib/changed-file-view'
import { ChangedFileViewToggle } from '../lib/changed-file-view-toggle'
import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translateForAccessibleName,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IFileListProps {
  readonly files: ReadonlyArray<CommittedFileChange>
  readonly selectedFile: CommittedFileChange | null
  readonly onSelectedFileChanged: (file: CommittedFileChange) => void
  readonly onRowDoubleClick: (row: number, source: ClickSource) => void
  readonly availableWidth: number
  /** Enables the shared flat/tree control for History and pull request lists. */
  readonly showViewToggle?: boolean
  readonly onContextMenu?: (
    file: CommittedFileChange,
    event: React.MouseEvent<HTMLDivElement>
  ) => void
}

interface IFileListState {
  readonly focusedFilePath: string | null
  readonly fileViewMode: ChangedFileViewMode
  readonly languageMode: LanguageMode
}

/**
 * Display a list of changed files as part of a commit or stash
 */
export class FileList extends React.Component<IFileListProps, IFileListState> {
  private readonly buildRows = memoizeOne(
    (
      files: ReadonlyArray<CommittedFileChange>,
      mode: ChangedFileViewMode,
      showViewToggle: boolean
    ): ReadonlyArray<ChangedFileTreeRow<CommittedFileChange>> => {
      if (!showViewToggle || mode === 'flat') {
        return files.map((file, sourceIndex) => ({
          kind: 'file' as const,
          file,
          path: file.path,
          depth: 0,
          sourceIndex,
        }))
      }

      return buildChangedFileTreeRows(files, file => file.path)
    }
  )

  public constructor(props: IFileListProps) {
    super(props)

    this.state = {
      focusedFilePath: null,
      fileViewMode: readChangedFileViewMode(),
      languageMode: getPersistedLanguageMode(),
    }
  }

  public componentDidMount() {
    document.addEventListener(
      ChangedFileViewModeChangedEvent,
      this.onFileViewModeChanged
    )
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public componentWillUnmount() {
    document.removeEventListener(
      ChangedFileViewModeChangedEvent,
      this.onFileViewModeChanged
    )
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  private getRows(): ReadonlyArray<ChangedFileTreeRow<CommittedFileChange>> {
    return this.buildRows(
      this.props.files,
      this.state.fileViewMode,
      this.props.showViewToggle === true
    )
  }

  private onSelectedRowChanged = (row: number) => {
    const item = this.getRows()[row]
    if (item?.kind === 'file') {
      this.props.onSelectedFileChanged(item.file)
    }
  }

  private renderFile = (row: number) => {
    const item = this.getRows()[row]
    if (item.kind === 'directory') {
      const treeStyle = {
        '--changed-file-tree-indent': `${item.depth * 12}px`,
      } as React.CSSProperties
      return (
        <div className="changed-file-tree-directory" style={treeStyle}>
          <Octicon symbol={octicons.fileDirectory} />
          <span>{item.path}</span>
        </div>
      )
    }

    const committedFile = (
      <CommittedFileItem
        file={item.file}
        availableWidth={Math.max(
          this.props.availableWidth - item.depth * 12,
          0
        )}
        focused={this.state.focusedFilePath === item.path}
      />
    )

    if (!this.props.showViewToggle || this.state.fileViewMode === 'flat') {
      return committedFile
    }

    const treeStyle = {
      '--changed-file-tree-indent': `${item.depth * 12}px`,
    } as React.CSSProperties
    return (
      <div className="changed-file-tree-file" style={treeStyle}>
        {committedFile}
      </div>
    )
  }

  private selectedRowsForFile(): ReadonlyArray<number> {
    const file = this.props.selectedFile
    const fileIndex = file
      ? this.getRows().findIndex(
          row => row.kind === 'file' && row.file.path === file.path
        )
      : -1
    return fileIndex >= 0 ? [fileIndex] : []
  }

  private onRowContextMenu = (
    row: number,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    const item = this.getRows()[row]
    if (item?.kind === 'file') {
      this.props.onContextMenu?.(item.file, event)
    }
  }

  private getFileAriaLabel = (row: number) => {
    const item = this.getRows()[row]
    if (item.kind === 'directory') {
      return translateForAccessibleName(
        'fileList.directory',
        { path: item.path },
        this.state.languageMode
      )
    }

    const file = item.file
    const { path, status } = file
    const fileStatus = mapStatus(status)
    return `${path} ${fileStatus}`
  }

  private getRowHeight = ({ index }: { readonly index: number }) =>
    this.getRows()[index].kind === 'directory' ? 25 : 29

  private canSelectRow = (row: number) => this.getRows()[row].kind === 'file'

  public render() {
    const rows = this.getRows()
    const list = (
      <div className="file-list">
        <List
          rowRenderer={this.renderFile}
          rowCount={rows.length}
          rowHeight={this.getRowHeight}
          selectedRows={this.selectedRowsForFile()}
          onSelectedRowChanged={this.onSelectedRowChanged}
          onRowDoubleClick={this.onRowDoubleClick}
          onRowContextMenu={this.onRowContextMenu}
          onRowKeyboardFocus={this.onRowFocus}
          onRowBlur={this.onRowBlur}
          canSelectRow={this.canSelectRow}
          getRowAriaLabel={this.getFileAriaLabel}
          invalidationProps={{
            focusedFilePath: this.state.focusedFilePath,
            fileViewMode: this.state.fileViewMode,
            languageMode: this.state.languageMode,
            files: this.props.files,
          }}
        />
      </div>
    )

    return this.props.showViewToggle ? (
      <div className="changed-file-list-layout">
        <div className="changed-file-list-toolbar">
          <ChangedFileViewToggle mode={this.state.fileViewMode} />
        </div>
        {list}
      </div>
    ) : (
      list
    )
  }

  private onRowFocus = (row: number) => {
    const item = this.getRows()[row]
    this.setState({
      focusedFilePath: item.kind === 'file' ? item.path : null,
    })
  }

  private onRowBlur = (row: number) => {
    const item = this.getRows()[row]
    if (item.kind === 'file' && this.state.focusedFilePath === item.path) {
      this.setState({ focusedFilePath: null })
    }
  }

  private onRowDoubleClick = (row: number, source: ClickSource) => {
    const item = this.getRows()[row]
    if (item?.kind === 'file') {
      this.props.onRowDoubleClick(item.sourceIndex, source)
    }
  }

  private onFileViewModeChanged = (event: Event) => {
    const fileViewMode = normalizeChangedFileViewMode(
      (event as CustomEvent<unknown>).detail
    )
    if (fileViewMode !== this.state.fileViewMode) {
      this.setState({ fileViewMode })
    }
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }
}
