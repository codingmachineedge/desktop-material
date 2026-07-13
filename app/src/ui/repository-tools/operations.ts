import * as Path from 'path'

export type RepositoryToolCategory = 'Diagnostics' | 'Maintenance' | 'Recovery'

export type RepositoryArchiveFormat = 'zip' | 'tar'

export interface IRepositoryArchiveRequest {
  readonly format: RepositoryArchiveFormat
  readonly destination: string
  readonly args: ReadonlyArray<string>
}

export type RepositoryToolID =
  | 'status-summary'
  | 'repository-health'
  | 'maintenance-preview'
  | 'maintenance-run'
  | 'reflog-view'
  | 'signature-audit'

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
      id: 'signature-audit',
      title: 'Audit recent commit signatures',
      description:
        'Inspect signature status, signer identity, and subject for the latest 50 commits.',
      category: 'Diagnostics',
      args: [
        'log',
        '--format=%h%x09%G?%x09%GS%x09%s',
        '--show-signature',
        '-50',
      ],
      mutatesRepository: false,
      requiresConfirmation: false,
      supportingDetails: [
        'G = good, U = good with unknown trust, B = bad, N = unsigned.',
        'Also reports expired, revoked, and missing-key signature states.',
        'Does not change signing keys, trust, commits, or Git configuration.',
      ],
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

/**
 * Contain and normalize the only user-selected value accepted by the archive
 * function. The source ref and Git arguments remain fixed and reviewed.
 */
export function prepareRepositoryArchive(
  repositoryPath: string,
  destination: string,
  format: RepositoryArchiveFormat
): IRepositoryArchiveRequest {
  const value = destination.trim()
  if (value.length === 0 || value.includes('\0') || !Path.isAbsolute(value)) {
    throw new Error(
      'Choose an absolute destination for the repository archive.'
    )
  }

  const extension = `.${format}`
  const normalizedDestination = value.toLowerCase().endsWith(extension)
    ? value
    : `${value}${extension}`
  const resolvedRepository = Path.resolve(repositoryPath)
  const resolvedDestination = Path.resolve(normalizedDestination)
  const gitDirectory = Path.join(resolvedRepository, '.git')
  const relativeToGitDirectory = Path.relative(
    gitDirectory,
    resolvedDestination
  )

  if (
    relativeToGitDirectory.length === 0 ||
    (!relativeToGitDirectory.startsWith(`..${Path.sep}`) &&
      relativeToGitDirectory !== '..' &&
      !Path.isAbsolute(relativeToGitDirectory))
  ) {
    throw new Error('Repository archives cannot be saved inside .git.')
  }

  return {
    format,
    destination: resolvedDestination,
    args: [
      'archive',
      `--format=${format}`,
      `--output=${resolvedDestination}`,
      'HEAD',
    ],
  }
}
