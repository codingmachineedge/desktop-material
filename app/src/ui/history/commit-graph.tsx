import * as React from 'react'
import { ICommitGraphPath, ICommitGraphRow } from './commit-graph-model'

const ColumnWidth = 16
const RowHeight = 50
const NodeY = RowHeight / 2

const xForColumn = (column: number) => column * ColumnWidth + ColumnWidth / 2

function renderPath(
  path: ICommitGraphPath,
  startY: number,
  endY: number,
  key: string
) {
  const fromX = xForColumn(path.fromColumn)
  const toX = xForColumn(path.toColumn)
  const middleY = (startY + endY) / 2
  return (
    <path
      key={key}
      d={`M ${fromX} ${startY} C ${fromX} ${middleY}, ${toX} ${middleY}, ${toX} ${endY}`}
      stroke={path.color}
    />
  )
}

export function CommitGraph({ row }: { readonly row: ICommitGraphRow }) {
  const nodeX = xForColumn(row.column)
  return (
    <svg
      className="commit-graph"
      width={(row.maxColumn + 1) * ColumnWidth}
      height={RowHeight}
      viewBox={`0 0 ${(row.maxColumn + 1) * ColumnWidth} ${RowHeight}`}
      aria-hidden="true"
    >
      {row.continuations.map((path, index) =>
        renderPath(path, 0, RowHeight, `continuation-${index}`)
      )}
      {row.hasTopLine ? (
        <path d={`M ${nodeX} 0 L ${nodeX} ${NodeY}`} stroke={row.color} />
      ) : null}
      {row.connections.map((path, index) =>
        renderPath(path, NodeY, RowHeight, `connection-${index}`)
      )}
      <circle cx={nodeX} cy={NodeY} r="4" fill={row.color} />
    </svg>
  )
}
