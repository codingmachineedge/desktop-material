import { Commit } from '../../models/commit'

const GraphColors = [
  'var(--md-sys-color-primary)',
  'var(--md-sys-color-tertiary)',
  'var(--md-sys-color-secondary)',
  'var(--md-sys-color-error)',
  'var(--md-sys-color-inverse-primary)',
  'var(--md-sys-color-on-surface-variant)',
]

interface IActiveLane {
  readonly sha: string
  readonly color: string
}

export interface ICommitGraphPath {
  readonly fromColumn: number
  readonly toColumn: number
  readonly color: string
}

export interface ICommitGraphRow {
  readonly sha: string
  readonly column: number
  readonly color: string
  readonly hasTopLine: boolean
  readonly continuations: ReadonlyArray<ICommitGraphPath>
  readonly connections: ReadonlyArray<ICommitGraphPath>
  readonly maxColumn: number
}

/**
 * Builds the lane geometry for commits ordered newest first. This is adapted
 * from desktop-plus' MIT-licensed graph model, with a smaller row-oriented
 * representation tailored to Desktop Material's virtualized history list.
 */
export function buildCommitGraphRows(
  commits: ReadonlyArray<Commit>
): ReadonlyArray<ICommitGraphRow> {
  const visibleSHAs = new Set(commits.map(commit => commit.sha))
  const colors = new Map<string, string>()
  let nextColor = 0
  let lanes = new Array<IActiveLane>()

  const colorForSHA = (sha: string) => {
    const existing = colors.get(sha)
    if (existing !== undefined) {
      return existing
    }

    const color = GraphColors[nextColor % GraphColors.length]
    nextColor++
    colors.set(sha, color)
    return color
  }

  return commits.map(commit => {
    let column = lanes.findIndex(lane => lane.sha === commit.sha)
    const hasTopLine = column >= 0

    if (column < 0) {
      column = lanes.length
      lanes.push({ sha: commit.sha, color: colorForSHA(commit.sha) })
    }

    const currentLane = lanes[column]
    const parents = commit.parentSHAs.filter(sha => visibleSHAs.has(sha))
    let nextLanes = lanes.slice()

    if (parents.length === 0) {
      nextLanes.splice(column, 1)
    } else {
      nextLanes[column] = { sha: parents[0], color: currentLane.color }
      colors.set(parents[0], currentLane.color)
    }

    for (const parent of parents.slice(1)) {
      if (!nextLanes.some(lane => lane.sha === parent)) {
        nextLanes.splice(Math.min(column + 1, nextLanes.length), 0, {
          sha: parent,
          color: colorForSHA(parent),
        })
      }
    }

    const seen = new Set<string>()
    nextLanes = nextLanes.filter(lane => {
      if (seen.has(lane.sha)) {
        return false
      }
      seen.add(lane.sha)
      return true
    })

    const continuations = lanes.flatMap((lane, fromColumn) => {
      if (fromColumn === column) {
        return []
      }
      const toColumn = nextLanes.findIndex(next => next.sha === lane.sha)
      return toColumn < 0 ? [] : [{ fromColumn, toColumn, color: lane.color }]
    })

    const connections = parents.map(parent => {
      const toColumn = nextLanes.findIndex(lane => lane.sha === parent)
      return {
        fromColumn: column,
        toColumn: toColumn < 0 ? column : toColumn,
        color: colors.get(parent) ?? currentLane.color,
      }
    })

    const touchedColumns = [
      column,
      ...continuations.flatMap(path => [path.fromColumn, path.toColumn]),
      ...connections.flatMap(path => [path.fromColumn, path.toColumn]),
    ]
    lanes = nextLanes

    return {
      sha: commit.sha,
      column,
      color: currentLane.color,
      hasTopLine,
      continuations,
      connections,
      maxColumn: Math.max(...touchedColumns),
    }
  })
}
