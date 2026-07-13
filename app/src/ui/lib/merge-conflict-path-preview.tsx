import * as React from 'react'

const MaximumVisibleConflictPaths = 20

interface IMergeConflictPathPreviewProps {
  readonly paths: ReadonlyArray<string>
}

export function MergeConflictPathPreview({
  paths,
}: IMergeConflictPathPreviewProps) {
  if (paths.length === 0) {
    return null
  }
  const visiblePaths = paths.slice(0, MaximumVisibleConflictPaths)
  const additional = paths.length - visiblePaths.length
  return (
    <div className="merge-conflict-path-preview">
      <strong>Predicted conflict paths</strong>
      <ol aria-label="Predicted conflict paths">
        {visiblePaths.map((path, index) => (
          <li key={`${index}:${path}`}>{path}</li>
        ))}
      </ol>
      {additional > 0 && (
        <p>
          {additional} additional conflict path{additional === 1 ? '' : 's'}
          {' not shown.'}
        </p>
      )}
    </div>
  )
}
