import { createHash } from 'crypto'

import { Repository } from '../../models/repository'
import {
  forkPullRequestRemoteName,
  ForkedRemotePrefix,
  IRemote,
} from '../../models/remote'
import {
  ForkBranchCheckoutError,
  getForkNetworkRepositoryIdentity,
  IForkBranchCheckoutPlan,
  IForkNetworkBranch,
  IForkNetworkBranchCatalog,
  isSafeForkBranchName,
  suggestedForkLocalBranchName,
} from '../fork-network'
import { urlMatchesRemote } from '../repository-matching'
import { git } from './core'
import { envForRemoteOperation } from './environment'
import { addRemote, getRemotes } from './remote'

const ZeroObjectID40 = '0'.repeat(40)
const ZeroObjectID64 = '0'.repeat(64)
const MaximumRemoteCollisionAttempts = 32
const MaximumLocalCollisionSuggestions = 50

function hash(values: ReadonlyArray<string>): string {
  const digest = createHash('sha256')
  for (const value of values) {
    digest.update(String(value.length))
    digest.update(':')
    digest.update(value)
  }
  return digest.digest('hex')
}

function remoteInventoryToken(remotes: ReadonlyArray<IRemote>): string {
  return hash(
    [...remotes]
      .sort((left, right) => left.name.localeCompare(right.name))
      .flatMap(remote => [remote.name, remote.url])
  )
}

function remoteMatchesReviewedCloneURL(
  cloneURL: string,
  remote: IRemote
): boolean {
  return remote.url === cloneURL || urlMatchesRemote(cloneURL, remote)
}

function zeroObjectIDFor(sha: string): string {
  return sha.length === 64 ? ZeroObjectID64 : ZeroObjectID40
}

async function resolveRef(
  repository: Repository,
  ref: string
): Promise<string | null> {
  const result = await git(
    ['rev-parse', '--verify', '--end-of-options', ref],
    repository.path,
    'resolveReviewedForkBranchRef',
    { successExitCodes: new Set([0, 1, 128]) }
  )
  const value = result.exitCode === 0 ? result.stdout.trim().toLowerCase() : ''
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value) ? value : null
}

async function validateLocalBranchName(
  repository: Repository,
  value: string
): Promise<string> {
  const name = value.trim()
  if (!isSafeForkBranchName(name)) {
    throw new ForkBranchCheckoutError('invalid-selection')
  }
  const result = await git(
    ['check-ref-format', '--branch', name],
    repository.path,
    'validateReviewedForkBranchName',
    { successExitCodes: new Set([0, 1, 128]) }
  )
  if (result.exitCode !== 0) {
    throw new ForkBranchCheckoutError('invalid-selection')
  }
  return name
}

async function suggestAvailableLocalBranchName(
  repository: Repository,
  forkOwner: string,
  branchName: string
): Promise<string | undefined> {
  const base = suggestedForkLocalBranchName(forkOwner, branchName)
  if ((await resolveRef(repository, `refs/heads/${base}`)) === null) {
    return base
  }
  for (let suffix = 2; suffix <= MaximumLocalCollisionSuggestions; suffix++) {
    const candidate = `${base}-${suffix}`
    if ((await resolveRef(repository, `refs/heads/${candidate}`)) === null) {
      return candidate
    }
  }
  return undefined
}

function chooseDesktopRemote(
  remotes: ReadonlyArray<IRemote>,
  forkOwner: string,
  forkID: string,
  cloneURL: string
): { readonly name: string; readonly willBeCreated: boolean } {
  const matchingManaged = remotes.find(
    remote =>
      remote.name.startsWith(ForkedRemotePrefix) &&
      remoteMatchesReviewedCloneURL(cloneURL, remote)
  )
  if (matchingManaged !== undefined) {
    return { name: matchingManaged.name, willBeCreated: false }
  }

  const baseName = forkPullRequestRemoteName(forkOwner)
  const baseRemote = remotes.find(remote => remote.name === baseName)
  if (baseRemote === undefined) {
    return { name: baseName, willBeCreated: true }
  }
  if (remoteMatchesReviewedCloneURL(cloneURL, baseRemote)) {
    return { name: baseName, willBeCreated: false }
  }

  const suffix = hash([forkID]).slice(0, 8)
  for (let attempt = 1; attempt <= MaximumRemoteCollisionAttempts; attempt++) {
    const candidate = `${baseName}-${suffix}${
      attempt === 1 ? '' : `-${attempt}`
    }`
    const existing = remotes.find(remote => remote.name === candidate)
    if (existing === undefined) {
      return { name: candidate, willBeCreated: true }
    }
    if (remoteMatchesReviewedCloneURL(cloneURL, existing)) {
      return { name: candidate, willBeCreated: false }
    }
  }
  throw new ForkBranchCheckoutError('remote-collision')
}

function planToken(plan: Omit<IForkBranchCheckoutPlan, 'reviewToken'>): string {
  return hash([
    plan.repositoryIdentity,
    plan.rootOwner.toLowerCase(),
    plan.rootName.toLowerCase(),
    plan.fork.id,
    plan.fork.cloneURL,
    plan.branch.name,
    plan.branch.headSha,
    plan.branchCatalogToken,
    plan.localBranchName,
    plan.remoteName,
    plan.remoteRef,
    plan.expectedRemoteInventoryToken,
    String(plan.remoteWillBeCreated),
  ])
}

/** Build the exact non-mutating review shown immediately before confirmation. */
export async function reviewForkBranchCheckout(
  repository: Repository,
  catalog: IForkNetworkBranchCatalog,
  branch: IForkNetworkBranch,
  requestedLocalBranchName: string
): Promise<IForkBranchCheckoutPlan> {
  if (
    catalog.repositoryIdentity !==
      getForkNetworkRepositoryIdentity(repository) ||
    !catalog.branches.some(
      candidate =>
        candidate.id === branch.id &&
        candidate.name === branch.name &&
        candidate.headSha === branch.headSha
    )
  ) {
    throw new ForkBranchCheckoutError('stale-review')
  }
  const localBranchName = await validateLocalBranchName(
    repository,
    requestedLocalBranchName
  )
  if (
    (await resolveRef(repository, `refs/heads/${localBranchName}`)) !== null
  ) {
    throw new ForkBranchCheckoutError(
      'local-branch-collision',
      await suggestAvailableLocalBranchName(
        repository,
        catalog.fork.owner,
        branch.name
      )
    )
  }

  const remotes = await getRemotes(repository)
  const remote = chooseDesktopRemote(
    remotes,
    catalog.fork.owner,
    catalog.fork.id,
    catalog.fork.cloneURL
  )
  const planWithoutToken = {
    repositoryIdentity: catalog.repositoryIdentity,
    rootOwner: catalog.rootOwner,
    rootName: catalog.rootName,
    fork: catalog.fork,
    branch,
    branchCatalogToken: catalog.snapshotToken,
    localBranchName,
    remoteName: remote.name,
    remoteRef: `refs/remotes/${remote.name}/${branch.name}`,
    expectedRemoteInventoryToken: remoteInventoryToken(remotes),
    remoteWillBeCreated: remote.willBeCreated,
  }
  return {
    ...planWithoutToken,
    reviewToken: planToken(planWithoutToken),
  }
}

async function deleteExactRef(
  repository: Repository,
  ref: string,
  expectedSha: string
): Promise<void> {
  await git(
    ['update-ref', '-d', ref, expectedSha],
    repository.path,
    'cleanupReviewedForkBranchRef',
    { successExitCodes: new Set([0, 1, 128]) }
  )
}

/**
 * Fetch the reviewed source ref into an isolated temporary namespace, verify
 * its object ID, and only then atomically publish the managed remote and local
 * refs. No command is interpreted by a shell.
 */
export async function applyForkBranchCheckoutPlan(
  repository: Repository,
  plan: IForkBranchCheckoutPlan
): Promise<void> {
  const planWithoutToken: Omit<IForkBranchCheckoutPlan, 'reviewToken'> = {
    repositoryIdentity: plan.repositoryIdentity,
    rootOwner: plan.rootOwner,
    rootName: plan.rootName,
    fork: plan.fork,
    branch: plan.branch,
    branchCatalogToken: plan.branchCatalogToken,
    localBranchName: plan.localBranchName,
    remoteName: plan.remoteName,
    remoteRef: plan.remoteRef,
    expectedRemoteInventoryToken: plan.expectedRemoteInventoryToken,
    remoteWillBeCreated: plan.remoteWillBeCreated,
  }
  if (
    plan.reviewToken !== planToken(planWithoutToken) ||
    plan.repositoryIdentity !== getForkNetworkRepositoryIdentity(repository)
  ) {
    throw new ForkBranchCheckoutError('stale-review')
  }
  await validateLocalBranchName(repository, plan.localBranchName)
  if (
    (await resolveRef(repository, `refs/heads/${plan.localBranchName}`)) !==
    null
  ) {
    throw new ForkBranchCheckoutError(
      'local-branch-collision',
      await suggestAvailableLocalBranchName(
        repository,
        plan.fork.owner,
        plan.branch.name
      )
    )
  }

  let remotes = await getRemotes(repository)
  if (remoteInventoryToken(remotes) !== plan.expectedRemoteInventoryToken) {
    throw new ForkBranchCheckoutError('stale-review')
  }
  let remote = remotes.find(candidate => candidate.name === plan.remoteName)
  if (plan.remoteWillBeCreated) {
    if (remote !== undefined) {
      throw new ForkBranchCheckoutError('stale-review')
    }
    try {
      remote = await addRemote(repository, plan.remoteName, plan.fork.cloneURL)
    } catch {
      throw new ForkBranchCheckoutError('git-failed')
    }
  } else if (
    remote === undefined ||
    !remote.name.startsWith(ForkedRemotePrefix) ||
    !remoteMatchesReviewedCloneURL(plan.fork.cloneURL, remote)
  ) {
    throw new ForkBranchCheckoutError('stale-review')
  }
  // Re-read after creation so an external remote rewrite cannot redirect fetch.
  remotes = await getRemotes(repository)
  remote = remotes.find(candidate => candidate.name === plan.remoteName)
  if (
    remote === undefined ||
    !remoteMatchesReviewedCloneURL(plan.fork.cloneURL, remote)
  ) {
    throw new ForkBranchCheckoutError('stale-review')
  }

  const oldRemoteSha = await resolveRef(repository, plan.remoteRef)
  const temporaryRef = `refs/desktop-material/fork-checkout/${plan.reviewToken}`
  const existingTemporarySha = await resolveRef(repository, temporaryRef)
  if (existingTemporarySha !== null) {
    await deleteExactRef(repository, temporaryRef, existingTemporarySha)
  }

  let temporarySha: string | null = null
  try {
    try {
      await git(
        [
          'fetch',
          '--no-tags',
          '--no-write-fetch-head',
          '--refmap=',
          remote.name,
          `+refs/heads/${plan.branch.name}:${temporaryRef}`,
        ],
        repository.path,
        'fetchReviewedForkBranch',
        {
          env: await envForRemoteOperation(remote.url),
          successExitCodes: new Set([0]),
        }
      )
    } catch {
      throw new ForkBranchCheckoutError('network-or-permission')
    }

    temporarySha = await resolveRef(repository, temporaryRef)
    if (temporarySha !== plan.branch.headSha) {
      throw new ForkBranchCheckoutError('branch-moved')
    }
    if ((await resolveRef(repository, plan.remoteRef)) !== oldRemoteSha) {
      throw new ForkBranchCheckoutError('stale-review')
    }

    const expectedOldRemote =
      oldRemoteSha ?? zeroObjectIDFor(plan.branch.headSha)
    await git(
      ['update-ref', plan.remoteRef, plan.branch.headSha, expectedOldRemote],
      repository.path,
      'promoteReviewedForkBranchRef'
    )
    await git(
      [
        'update-ref',
        `refs/heads/${plan.localBranchName}`,
        plan.branch.headSha,
        zeroObjectIDFor(plan.branch.headSha),
      ],
      repository.path,
      'createReviewedForkBranch'
    )
    try {
      await git(
        [
          'branch',
          `--set-upstream-to=${plan.remoteName}/${plan.branch.name}`,
          plan.localBranchName,
        ],
        repository.path,
        'trackReviewedForkBranch'
      )
    } catch {
      await deleteExactRef(
        repository,
        `refs/heads/${plan.localBranchName}`,
        plan.branch.headSha
      )
      throw new ForkBranchCheckoutError('git-failed')
    }
  } finally {
    if (temporarySha !== null) {
      await deleteExactRef(repository, temporaryRef, temporarySha)
    }
  }
}
