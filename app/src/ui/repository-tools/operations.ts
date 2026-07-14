export type RepositoryToolCategory = 'Diagnostics' | 'Maintenance' | 'Recovery'

export type RepositoryToolID =
  | 'status-summary'
  | 'repository-health'
  | 'maintenance-preview'
  | 'maintenance-run'
  | 'reflog-view'

export interface IRepositoryToolOperation {
  readonly id: RepositoryToolID
  readonly title: string
  readonly description: string
  readonly category: RepositoryToolCategory
  /** Internal fixed argv passed to the bounded Git runner. Never user editable. */
  readonly args: ReadonlyArray<string>
  readonly mutatesRepository: boolean
  readonly requiresConfirmation: boolean
  readonly confirmationDescription?: string
  readonly supportingDetails?: ReadonlyArray<string>
}

/**
 * Curated repository functions. These recipes are the only argv accepted by
 * this surface; adding a function requires adding and reviewing a named card.
 */
export const RepositoryToolOperations: ReadonlyArray<IRepositoryToolOperation> =
  [
    {
      id: 'status-summary',
      title: 'Status summary',
      description:
        'Inspect the current branch plus staged, modified, and untracked files.',
      category: 'Diagnostics',
      args: ['status', '--short', '--branch'],
      mutatesRepository: false,
      requiresConfirmation: false,
    },
    {
      id: 'repository-health',
      title: 'Repository health check',
      description:
        'Verify object connectivity and validity without changing repository data.',
      category: 'Diagnostics',
      args: ['fsck', '--full'],
      mutatesRepository: false,
      requiresConfirmation: false,
    },
    {
      id: 'maintenance-preview',
      title: 'Preview maintenance needs',
      description:
        'Inspect loose objects, packs, disk usage, and garbage before maintenance.',
      category: 'Maintenance',
      args: ['count-objects', '-vH'],
      mutatesRepository: false,
      requiresConfirmation: false,
      supportingDetails: [
        'Reports loose and packed object counts.',
        'Reports reclaimable garbage and repository object-store size.',
        'Does not run maintenance or change repository data.',
      ],
    },
    {
      id: 'maintenance-run',
      title: 'Run repository maintenance',
      description:
        'Run Git’s configured foreground maintenance tasks for this repository.',
      category: 'Maintenance',
      args: ['maintenance', 'run'],
      mutatesRepository: true,
      requiresConfirmation: true,
      confirmationDescription:
        'Git may rewrite object packs and maintenance metadata. Working files and commits are preserved, but the operation can take time on large repositories.',
    },
    {
      id: 'reflog-view',
      title: 'View recent ref movements',
      description:
        'Inspect the latest 50 local reflog entries for recovery clues. This view never changes refs.',
      category: 'Recovery',
      args: ['reflog', 'show', '--date=local', '-50'],
      mutatesRepository: false,
      requiresConfirmation: false,
    },
  ]

export function getRepositoryToolOperation(
  id: RepositoryToolID
): IRepositoryToolOperation {
  const operation = RepositoryToolOperations.find(
    candidate => candidate.id === id
  )
  if (operation === undefined) {
    throw new Error(`Unknown repository tool: ${id}`)
  }
  return operation
}
