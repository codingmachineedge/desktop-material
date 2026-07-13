import * as React from 'react'

import { Branch, BranchType } from '../../models/branch'

import { IBranchListItem } from './group-branches'
import { BranchListItem } from './branch-list-item'
import { IMatches } from '../../lib/fuzzy-find'
import { getRelativeTimeInfoFromDate } from '../relative-time'
import { getPreferAbsoluteDates } from '../../models/formatting-preferences'

export function renderDefaultBranch(
  item: IBranchListItem,
  matches: IMatches,
  currentBranch: Branch | null,
  authorDate: Date | undefined,
  onDropOntoBranch?: (branchName: string) => void,
  onDropOntoCurrentBranch?: () => void
): JSX.Element {
  const branch = item.branch
  const currentBranchName = currentBranch ? currentBranch.name : null
  const isLocalOnly =
    branch.type === BranchType.Local &&
    (branch.upstream === null || branch.isGone)
  return (
    <BranchListItem
      name={branch.name}
      isPinned={item.isPinned}
      isCurrentBranch={branch.name === currentBranchName}
      isLocalOnly={isLocalOnly}
      authorDate={authorDate}
      matches={matches}
      onDropOntoBranch={onDropOntoBranch}
      onDropOntoCurrentBranch={onDropOntoCurrentBranch}
    />
  )
}

export function getDefaultAriaLabelForBranch(
  item: IBranchListItem,
  authorDate: Date | undefined
): string {
  const branch = item.branch
  const localOnlySuffix =
    branch.type === BranchType.Local &&
    (branch.upstream === null || branch.isGone)
      ? ', not published'
      : ''
  const pinnedSuffix = item.isPinned ? ', pinned' : ''

  if (!authorDate) {
    return `${branch.name}${localOnlySuffix}${pinnedSuffix}`
  }

  const { relativeText, absoluteText } = getRelativeTimeInfoFromDate(
    authorDate,
    true
  )

  return `${item.branch.name}${localOnlySuffix}${pinnedSuffix} ${
    getPreferAbsoluteDates() ? absoluteText : relativeText
  }`
}
