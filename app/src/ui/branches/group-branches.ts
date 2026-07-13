import { Branch } from '../../models/branch'
import {
  BranchSortOrder,
  DefaultBranchSortOrder,
} from '../../models/branch-sort-order'
import { IFilterListGroup, IFilterListItem } from '../lib/filter-list'

export type BranchGroupIdentifier = 'default' | 'pinned' | 'recent' | 'other'

export interface IBranchListVisibility {
  readonly pinned: ReadonlyArray<string>
  readonly hidden: ReadonlyArray<string>
  readonly solo: string | null
}

export interface IBranchListItem extends IFilterListItem {
  readonly text: ReadonlyArray<string>
  readonly id: string
  readonly branch: Branch
  readonly isPinned: boolean
}

export function groupBranches(
  defaultBranch: Branch | null,
  currentBranch: Branch | null,
  allBranches: ReadonlyArray<Branch>,
  recentBranches: ReadonlyArray<Branch>,
  sortOrder = DefaultBranchSortOrder,
  visibility: IBranchListVisibility = { pinned: [], hidden: [], solo: null }
): ReadonlyArray<IFilterListGroup<IBranchListItem>> {
  const groups = new Array<IFilterListGroup<IBranchListItem>>()

  const defaultBranchName = defaultBranch ? defaultBranch.name : null
  const currentBranchName = currentBranch ? currentBranch.name : null
  const pinnedBranchNames = new Set(visibility.pinned)
  const hiddenBranchNames = new Set(visibility.hidden)
  const isVisible = (branch: Branch) =>
    branch.name === defaultBranchName ||
    branch.name === currentBranchName ||
    (visibility.solo === null
      ? !hiddenBranchNames.has(branch.name)
      : branch.name === visibility.solo)

  const visibleBranches = allBranches.filter(
    branch => isVisible(branch) && !branch.isDesktopForkRemoteBranch
  )

  if (defaultBranch && isVisible(defaultBranch)) {
    groups.push({
      identifier: 'default',
      items: [
        {
          text: [defaultBranch.name],
          id: defaultBranch.name,
          branch: defaultBranch,
          isPinned: pinnedBranchNames.has(defaultBranch.name),
        },
      ],
    })
  }

  const pinnedBranches = visibility.pinned
    .map(name => visibleBranches.find(branch => branch.name === name))
    .filter(
      (branch): branch is Branch =>
        branch !== undefined && branch.name !== defaultBranchName
    )
  if (pinnedBranches.length > 0) {
    groups.push({
      identifier: 'pinned',
      items: pinnedBranches.map(branch => ({
        text: [branch.name],
        id: branch.name,
        branch,
        isPinned: true,
      })),
    })
  }

  const recentBranchNames = new Set<string>()
  const recentBranchesWithoutDefault = recentBranches.filter(
    b =>
      b.name !== defaultBranchName &&
      !pinnedBranchNames.has(b.name) &&
      isVisible(b)
  )
  if (recentBranchesWithoutDefault.length > 0) {
    const recentBranches = new Array<IBranchListItem>()

    for (const branch of recentBranchesWithoutDefault) {
      recentBranches.push({
        text: [branch.name],
        id: branch.name,
        branch,
        isPinned: false,
      })
      recentBranchNames.add(branch.name)
    }

    groups.push({
      identifier: 'recent',
      items: recentBranches,
    })
  }

  const remainingBranches = visibleBranches.filter(
    b =>
      b.name !== defaultBranchName &&
      !recentBranchNames.has(b.name) &&
      !pinnedBranchNames.has(b.name)
  )

  const remainingItems = [...remainingBranches]
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type - b.type
      }

      if (sortOrder === BranchSortOrder.Alphabetical) {
        return a.name.localeCompare(b.name)
      }

      const aDate = a.tip.author?.date.getTime() ?? 0
      const bDate = b.tip.author?.date.getTime() ?? 0
      return bDate - aDate || a.name.localeCompare(b.name)
    })
    .map(b => ({
      text: [b.name],
      id: b.name,
      branch: b,
      isPinned: false,
    }))
  groups.push({
    identifier: 'other',
    items: remainingItems,
  })

  return groups
}
