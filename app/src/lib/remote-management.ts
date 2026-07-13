import {
  IRemoteConfiguration,
  IRemoteDraft,
  IRemoteManagementPlan,
  IRemoteManagementReviewItem,
  IRemoteManagementSnapshot,
  IRemoteManagementUpdate,
  RemotePruneSetting,
} from '../models/remote'

export const MaximumManagedRemotes = 64
export const MaximumRemoteNameLength = 100
export const MaximumRemoteUrlLength = 4096
export const MaximumRemoteBranchLength = 255

const RemoteNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const RemoteBranchPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const UnsafeTextPattern = /[\0\r\n\u0001-\u001f\u007f]/

export class RemoteManagementValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'RemoteManagementValidationError'
  }
}

export function normalizeRemoteName(value: string): string {
  const name = value.trim()
  if (
    name.length === 0 ||
    name.length > MaximumRemoteNameLength ||
    !RemoteNamePattern.test(name) ||
    name.endsWith('.') ||
    name.endsWith('.lock')
  ) {
    throw new RemoteManagementValidationError(
      'Remote names must use 1–100 letters, numbers, dots, dashes, or underscores and cannot end in .lock.'
    )
  }
  return name
}

/** Validate a URL/path without ever including it in a thrown error. */
export function normalizeRemoteUrl(value: string): string {
  const url = value.trim()
  if (
    url.length === 0 ||
    url.length > MaximumRemoteUrlLength ||
    url.startsWith('-') ||
    UnsafeTextPattern.test(url)
  ) {
    throw new RemoteManagementValidationError(
      'Remote URLs must be non-empty, bounded, and cannot contain options or control characters.'
    )
  }

  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url)
      if (parsed.username !== '' || parsed.password !== '') {
        throw new RemoteManagementValidationError(
          'Store HTTPS credentials in an account or credential helper, not in a remote URL.'
        )
      }
    } catch (error) {
      if (error instanceof RemoteManagementValidationError) {
        throw error
      }
      throw new RemoteManagementValidationError(
        'The HTTP remote URL is not valid.'
      )
    }
  }

  return url
}

export function normalizeRemoteBranch(value: string | null): string | null {
  if (value === null || value.trim().length === 0) {
    return null
  }
  const branch = value.trim()
  if (
    branch.length > MaximumRemoteBranchLength ||
    !RemoteBranchPattern.test(branch) ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.includes('@{') ||
    branch.endsWith('/') ||
    branch.endsWith('.') ||
    branch.endsWith('.lock')
  ) {
    throw new RemoteManagementValidationError(
      'The default tracking branch is not a safe branch name.'
    )
  }
  return branch
}

function normalizePrune(value: RemotePruneSetting): RemotePruneSetting {
  if (value === 'inherit' || value === 'enabled' || value === 'disabled') {
    return value
  }
  throw new RemoteManagementValidationError(
    'The remote prune setting is not supported.'
  )
}

/** Create renderer-owned drafts without retaining mutable references. */
export function createRemoteDrafts(
  snapshot: IRemoteManagementSnapshot
): ReadonlyArray<IRemoteDraft> {
  return snapshot.remotes.map(remote => ({
    ...remote,
    originalName: remote.name,
  }))
}

function configurationChanged(
  initial: IRemoteConfiguration,
  draft: IRemoteDraft
): boolean {
  return (
    initial.name !== draft.name.trim() ||
    initial.fetchUrl !== draft.fetchUrl.trim() ||
    initial.pushUrl !==
      (draft.pushUrl === null ? null : draft.pushUrl.trim()) ||
    initial.prune !== draft.prune ||
    initial.defaultBranch !==
      (draft.defaultBranch === null ? null : draft.defaultBranch.trim())
  )
}

function reviewItem(
  remoteName: string,
  description: string,
  destructive = false
): IRemoteManagementReviewItem {
  return { remoteName, description, destructive }
}

/**
 * Build a bounded immutable plan. Only fields that differ from the reviewed
 * display-safe snapshot are included for existing remotes, so a masked URL is
 * preserved unless the user explicitly replaces it.
 */
export function createRemoteManagementPlan(
  snapshot: IRemoteManagementSnapshot,
  drafts: ReadonlyArray<IRemoteDraft>
): IRemoteManagementPlan {
  if (
    snapshot.remotes.length > MaximumManagedRemotes ||
    drafts.length > MaximumManagedRemotes
  ) {
    throw new RemoteManagementValidationError(
      `Remote Manager supports at most ${MaximumManagedRemotes} remotes per repository.`
    )
  }

  const initialByName = new Map(snapshot.remotes.map(item => [item.name, item]))
  if (initialByName.size !== snapshot.remotes.length) {
    throw new RemoteManagementValidationError(
      'Git returned duplicate remote names.'
    )
  }

  const seenOriginalNames = new Set<string>()
  const seenFinalNames = new Set<string>()
  const updates = new Array<IRemoteManagementUpdate>()
  const review = new Array<IRemoteManagementReviewItem>()

  for (const draft of drafts) {
    const name = normalizeRemoteName(draft.name)
    if (seenFinalNames.has(name)) {
      throw new RemoteManagementValidationError(
        `A remote named "${name}" already exists in this review.`
      )
    }
    seenFinalNames.add(name)

    const fetchUrl = normalizeRemoteUrl(draft.fetchUrl)
    const pushUrl =
      draft.pushUrl === null ? null : normalizeRemoteUrl(draft.pushUrl)
    const prune = normalizePrune(draft.prune)
    const defaultBranch = normalizeRemoteBranch(draft.defaultBranch)

    if (draft.originalName === null) {
      updates.push({
        originalName: null,
        name,
        fetchUrl,
        pushUrl,
        prune,
        defaultBranch,
      })
      review.push(
        reviewItem(name, 'Add this remote and its reviewed settings.')
      )
      continue
    }

    const originalName = normalizeRemoteName(draft.originalName)
    if (
      seenOriginalNames.has(originalName) ||
      !initialByName.has(originalName)
    ) {
      throw new RemoteManagementValidationError(
        'The remote review no longer matches the inspected repository state.'
      )
    }
    seenOriginalNames.add(originalName)
    const initial = initialByName.get(originalName)!
    if (!configurationChanged(initial, draft)) {
      continue
    }

    const update: IRemoteManagementUpdate = { originalName, name }
    if (initial.fetchUrl !== fetchUrl) {
      Object.assign(update, { fetchUrl })
      review.push(reviewItem(name, 'Replace the fetch URL.'))
    }
    if (initial.pushUrl !== pushUrl) {
      Object.assign(update, { pushUrl })
      review.push(
        reviewItem(
          name,
          pushUrl === null
            ? 'Use the fetch URL for pushes.'
            : 'Replace the explicit push URL.'
        )
      )
    }
    if (initial.prune !== prune) {
      Object.assign(update, { prune })
      review.push(reviewItem(name, `Set fetch pruning to ${prune}.`))
    }
    if (initial.defaultBranch !== defaultBranch) {
      Object.assign(update, { defaultBranch })
      review.push(
        reviewItem(
          name,
          defaultBranch === null
            ? 'Clear the locally tracked default branch.'
            : 'Change the locally tracked default branch.'
        )
      )
    }
    if (originalName !== name) {
      review.unshift(
        reviewItem(name, `Rename the ${originalName} remote to ${name}.`)
      )
    }
    updates.push(update)
  }

  const removed = snapshot.remotes
    .filter(remote => !seenOriginalNames.has(remote.name))
    .map(remote => remote.name)
  for (const name of removed) {
    review.push(
      reviewItem(
        name,
        'Remove this remote and its remote-tracking references.',
        true
      )
    )
  }

  if (review.length > MaximumManagedRemotes * 6) {
    throw new RemoteManagementValidationError(
      'The remote review contains too many changes to apply safely.'
    )
  }

  return {
    expectedSnapshotToken: snapshot.token,
    removed,
    updates,
    review,
  }
}

export function remoteManagementPlanHasChanges(
  plan: IRemoteManagementPlan
): boolean {
  return plan.removed.length > 0 || plan.updates.length > 0
}
