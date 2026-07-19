import * as React from 'react'
import classNames from 'classnames'

import {
  getPersistedLanguageMode,
  LanguageModeChangedEvent,
  translateForAccessibleName,
  TranslationKey,
} from '../../lib/i18n'
import { LanguageMode, normalizeLanguageMode } from '../../models/language-mode'
import { Button } from '../lib/button'
import { LocalizedText } from '../lib/localized-text'
import {
  IStructuredDiffCell,
  IStructuredDiffData,
  IStructuredDiffRow,
} from './structured-diff-data'

interface IStructuredDiffProps {
  readonly data: IStructuredDiffData
  readonly codeDiff: React.ReactNode
  readonly readOnly: boolean
}

interface IStructuredDiffState {
  readonly view: 'code' | 'table'
  readonly languageMode: LanguageMode
}

const RowStatusKeys: Readonly<Record<string, TranslationKey>> = {
  added: 'diff.structured.rowAdded',
  removed: 'diff.structured.rowRemoved',
  changed: 'diff.structured.rowChanged',
}

const CellStatusKeys: Readonly<Record<string, TranslationKey>> = {
  added: 'diff.structured.cellAdded',
  removed: 'diff.structured.cellRemoved',
  changed: 'diff.structured.cellChanged',
}

/** A bounded table presentation which always retains the original code diff. */
export class StructuredDiff extends React.Component<
  IStructuredDiffProps,
  IStructuredDiffState
> {
  public constructor(props: IStructuredDiffProps) {
    super(props)
    this.state = {
      view: 'table',
      languageMode: getPersistedLanguageMode(),
    }
  }

  public componentDidMount() {
    document.addEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  public componentWillUnmount() {
    document.removeEventListener(
      LanguageModeChangedEvent,
      this.onLanguageModeChanged
    )
  }

  private onLanguageModeChanged = (event: Event) => {
    const languageMode = normalizeLanguageMode(
      (event as CustomEvent<unknown>).detail
    )
    if (languageMode !== this.state.languageMode) {
      this.setState({ languageMode })
    }
  }

  private accessibleName = (key: TranslationKey) =>
    translateForAccessibleName(key, {}, this.state.languageMode)

  private showCode = () => this.setState({ view: 'code' })
  private showTable = () => this.setState({ view: 'table' })

  public render() {
    const showTable = this.state.view === 'table'
    return (
      <div className="structured-diff">
        <div
          className="structured-diff-toolbar"
          role="group"
          aria-label={this.accessibleName('diff.structured.viewSwitcher')}
        >
          <Button
            className={classNames('button-group-item', {
              selected: !showTable,
            })}
            ariaPressed={!showTable}
            ariaLabel={this.accessibleName('diff.structured.code')}
            onClick={this.showCode}
            inferTooltip={false}
          >
            <LocalizedText
              translationKey="diff.structured.code"
              languageMode={this.state.languageMode}
            />
          </Button>
          <Button
            className={classNames('button-group-item', {
              selected: showTable,
            })}
            ariaPressed={showTable}
            ariaLabel={this.accessibleName('diff.structured.table')}
            onClick={this.showTable}
            inferTooltip={false}
          >
            <LocalizedText
              translationKey="diff.structured.table"
              languageMode={this.state.languageMode}
            />
          </Button>
          {showTable && !this.props.readOnly ? (
            <span className="structured-diff-selection-hint">
              <LocalizedText
                translationKey="diff.structured.selectionHint"
                languageMode={this.state.languageMode}
              />
            </span>
          ) : null}
        </div>
        {showTable ? this.renderTable() : this.props.codeDiff}
      </div>
    )
  }

  private renderTable() {
    const { data } = this.props
    const captionKey =
      data.format === 'csv'
        ? 'diff.structured.csvCaption'
        : 'diff.structured.tsvCaption'

    return (
      <div className="structured-diff-table-scroll" id="structured-diff-table">
        <table className="structured-diff-table">
          <caption className="sr-only">
            <LocalizedText
              translationKey={captionKey}
              languageMode={this.state.languageMode}
            />
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="structured-diff-row-number"
                aria-label={this.accessibleName('diff.structured.rowNumber')}
              >
                #
              </th>
              {Array.from({ length: data.columnCount }, (_, column) => (
                <th scope="col" key={column}>
                  <LocalizedText
                    translationKey="diff.structured.column"
                    variables={{ number: String(column + 1) }}
                    languageMode={this.state.languageMode}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, index) => this.renderRow(row, index))}
          </tbody>
        </table>
      </div>
    )
  }

  private renderRow(row: IStructuredDiffRow, index: number) {
    const rowNumber = row.currentRowNumber ?? row.previousRowNumber ?? index + 1
    const statusKey = RowStatusKeys[row.status]
    return (
      <tr
        key={`${row.previousRowNumber ?? 'new'}-${
          row.currentRowNumber ?? 'old'
        }-${index}`}
        className={`structured-diff-row-${row.status}`}
        data-diff-status={row.status}
      >
        <th scope="row" className="structured-diff-row-number">
          <span aria-hidden={true}>{rowNumber}</span>
          {statusKey === undefined ? null : (
            <span className="sr-only">
              {'. '}
              <LocalizedText
                translationKey={statusKey}
                languageMode={this.state.languageMode}
              />
            </span>
          )}
        </th>
        {row.cells.map((cell, column) => this.renderCell(cell, column))}
      </tr>
    )
  }

  private renderCell(cell: IStructuredDiffCell, column: number) {
    const statusKey = CellStatusKeys[cell.status]
    const status =
      statusKey === undefined ? null : (
        <span className="sr-only">
          <LocalizedText
            translationKey={statusKey}
            languageMode={this.state.languageMode}
          />
          {'. '}
        </span>
      )

    let value: React.ReactNode
    if (cell.status === 'changed') {
      value = (
        <>
          <del className="structured-diff-previous-value">
            {cell.previous ?? ''}
          </del>
          <ins className="structured-diff-current-value">
            {cell.current ?? ''}
          </ins>
        </>
      )
    } else if (cell.status === 'removed') {
      value = <del>{cell.previous ?? ''}</del>
    } else if (cell.status === 'added') {
      value = <ins>{cell.current ?? ''}</ins>
    } else {
      value = cell.current ?? cell.previous ?? ''
    }

    return (
      <td
        key={column}
        className={`structured-diff-cell-${cell.status}`}
        data-diff-status={cell.status}
      >
        {status}
        {value}
      </td>
    )
  }
}
