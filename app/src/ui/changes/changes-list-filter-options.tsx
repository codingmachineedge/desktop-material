import * as React from 'react'
import { countActiveFilterOptions } from './filter-changes-logic'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { IFileListFilterState } from '../../lib/app-state'
import memoizeOne from 'memoize-one'
import { Button } from '../lib/button'
import classNames from 'classnames'
import { IChangesListItem } from './filter-changes-list'
import { WorkingDirectoryStatus } from '../../models/status'

interface IChangesFilterButtonProps {
  /** The current file-list filter state (drives the active-count badge). */
  readonly fileListFilter: IFileListFilterState

  /** Whether the inline filter chip row is currently shown. */
  readonly isOpen: boolean

  /** Toggles the inline filter chip row. */
  readonly onToggle: () => void
}

/**
 * The "tune" toggle button that lives in the Changes search row (§6.2). Unlike
 * the historical implementation it no longer opens a checkbox popover — it
 * toggles the inline MD3 filter chip row rendered below the search field
 * (§6.3).
 */
export class ChangesFilterButton extends React.Component<IChangesFilterButtonProps> {
  public render() {
    const activeFiltersCount = countActiveFilterOptions(
      this.props.fileListFilter
    )
    const hasActiveFilters = activeFiltersCount > 0
    const buttonTextLabel = `Filter Options ${
      hasActiveFilters ? `(${activeFiltersCount} applied)` : ''
    }`

    return (
      <Button
        className={classNames('filter-button', {
          active: hasActiveFilters || this.props.isOpen,
        })}
        onClick={this.props.onToggle}
        ariaExpanded={this.props.isOpen}
        tooltip={buttonTextLabel}
        ariaLabel={buttonTextLabel}
      >
        <span>
          <Octicon symbol={octicons.filter} />
        </span>
        {hasActiveFilters ? (
          <span className="active-badge">
            <div className="badge-bg">
              <div className="badge"></div>
            </div>
          </span>
        ) : null}
      </Button>
    )
  }
}

interface IChangesFilterChipRowProps {
  readonly fileListFilter: IFileListFilterState
  readonly filteredItems: Map<string, IChangesListItem>
  readonly workingDirectory: WorkingDirectoryStatus
  readonly onFilterToIncludedInCommit: () => void
  readonly onFilterExcludedFiles: () => void
  readonly onFilterDeletedFiles: () => void
  readonly onFilterModifiedFiles: () => void
  readonly onFilterNewFiles: () => void

  /** Opens the full regex builder dialog (§6.3 trailing chip). */
  readonly onOpenRegexBuilder: () => void
}

interface IFilterChipConfig {
  readonly id: string
  readonly label: string
  readonly count: number
  readonly on: boolean
  readonly onToggle: () => void
}

/**
 * The inline MD3 filter chip row shown under the Changes search field when the
 * tune button is toggled (design-spec-shell §6.3). Each predicate is rendered
 * as a tonal-selectable chip carrying a leading check when active, followed by
 * a "Regex builder" chip that launches the full regex builder. The predicates
 * are identical to the previous checkbox popover.
 */
export class ChangesFilterChipRow extends React.Component<IChangesFilterChipRowProps> {
  private getFilterCounts = memoizeOne(
    (
      wd: WorkingDirectoryStatus,
      filteredItems: Map<string, IChangesListItem>
    ) => {
      const counts = {
        newFilesCount: 0,
        modifiedFilesCount: 0,
        deletedFilesCount: 0,
        includedFilesCount: 0,
        excludedFilesCount: 0,
      }

      Array.from(filteredItems.values()).forEach(v => {
        const file = wd.findFileWithID(v.id)
        if (file) {
          if (file.isNew() || file.isUntracked()) {
            counts.newFilesCount++
          }
          if (file.isModified()) {
            counts.modifiedFilesCount++
          }
          if (file.isDeleted()) {
            counts.deletedFilesCount++
          }
          if (file.isIncludedInCommit()) {
            counts.includedFilesCount++
          }
          if (file.isExcludedFromCommit()) {
            counts.excludedFilesCount++
          }
        }
      })

      return counts
    }
  )

  private renderChip(chip: IFilterChipConfig) {
    return (
      <button
        key={chip.id}
        className={classNames('changes-filter-chip', { active: chip.on })}
        aria-pressed={chip.on}
        onClick={chip.onToggle}
      >
        {chip.on && <Octicon className="chip-check" symbol={octicons.check} />}
        <span className="chip-label">{chip.label}</span>
        <span className="chip-count">{chip.count}</span>
      </button>
    )
  }

  public render() {
    const { fileListFilter: filter } = this.props
    const {
      newFilesCount,
      modifiedFilesCount,
      deletedFilesCount,
      includedFilesCount,
      excludedFilesCount,
    } = this.getFilterCounts(
      this.props.workingDirectory,
      this.props.filteredItems
    )

    const chips: ReadonlyArray<IFilterChipConfig> = [
      {
        id: 'new',
        label: 'New',
        count: newFilesCount,
        on: filter.isNewFile,
        onToggle: this.props.onFilterNewFiles,
      },
      {
        id: 'modified',
        label: 'Modified',
        count: modifiedFilesCount,
        on: filter.isModifiedFile,
        onToggle: this.props.onFilterModifiedFiles,
      },
      {
        id: 'deleted',
        label: 'Deleted',
        count: deletedFilesCount,
        on: filter.isDeletedFile,
        onToggle: this.props.onFilterDeletedFiles,
      },
      {
        id: 'included',
        label: 'Included in commit',
        count: includedFilesCount,
        on: filter.isIncludedInCommit,
        onToggle: this.props.onFilterToIncludedInCommit,
      },
      {
        id: 'excluded',
        label: 'Excluded',
        count: excludedFilesCount,
        on: filter.isExcludedFromCommit,
        onToggle: this.props.onFilterExcludedFiles,
      },
    ]

    return (
      <div className="changes-filter-chips" role="group" aria-label="Filters">
        {chips.map(chip => this.renderChip(chip))}
        <button
          className="changes-regex-builder-chip"
          aria-label="Open regex builder"
          onClick={this.props.onOpenRegexBuilder}
        >
          <span className="chip-glyph">.*</span>
          <span className="chip-label">Regex builder</span>
        </button>
      </div>
    )
  }
}
