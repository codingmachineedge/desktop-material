import { Branch } from '../models/branch'
import { Account, getAccountKey } from '../models/account'
import { GitHubRepository } from '../models/github-repository'
import { IRemote } from '../models/remote'
import { Repository } from '../models/repository'
import { getHTMLURL } from './api'
import { getGitHubPullRequestHead } from './github-pull-request'

export type EffectiveBranchRulesContext =
  | {
      readonly kind: 'ready'
      readonly gitHubRepository: GitHubRepository
      /** Canonical provider-side branch name on the validated remote. */
      readonly branch: string
      readonly contextVersion: string
    }
  | {
      readonly kind: 'unsupported'
      readonly branch: string | null
      readonly message: string
      readonly contextVersion: string
    }

export type EffectiveBranchRulesAccountResolution =
  | { readonly kind: 'ready'; readonly account: Account }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'incompatible' }

/**
 * Resolve the exact actor used for account-specific permission and bypass
 * responses. Legacy repositories without a saved account may use an endpoint
 * fallback only when it identifies one unique GitHub account.
 */
export function resolveEffectiveBranchRulesAccount(
  accounts: ReadonlyArray<Account>,
  repository: Repository,
  endpoint: string
): EffectiveBranchRulesAccountResolution {
  if (repository.accountKey !== null) {
    const account = accounts.find(
      candidate => getAccountKey(candidate) === repository.accountKey
    )
    if (account === undefined) {
      return { kind: 'signed-out' }
    }
    return account.provider === 'github' && account.endpoint === endpoint
      ? { kind: 'ready', account }
      : { kind: 'incompatible' }
  }

  const matching = [
    ...new Map(
      accounts
        .filter(
          account =>
            account.provider === 'github' && account.endpoint === endpoint
        )
        .map(account => [getAccountKey(account), account] as const)
    ).values(),
  ]
  return matching.length === 0
    ? { kind: 'signed-out' }
    : matching.length === 1
    ? { kind: 'ready', account: matching[0] }
    : { kind: 'ambiguous' }
}

function contextVersion(
  repository: Repository,
  branch: Branch | null,
  remote: IRemote | null,
  resolvedRepository: GitHubRepository | null
): string {
  return JSON.stringify([
    repository.id,
    repository.path,
    repository.hash,
    branch?.ref ?? null,
    branch?.name ?? null,
    branch?.nameWithoutRemote ?? null,
    branch?.tip.sha ?? null,
    branch?.upstream ?? null,
    branch?.upstreamRemoteName ?? null,
    branch?.upstreamWithoutRemote ?? null,
    remote?.name ?? null,
    remote?.url ?? null,
    resolvedRepository?.hash ?? null,
    resolvedRepository?.endpoint ?? null,
    resolvedRepository?.owner.login ?? null,
    resolvedRepository?.name ?? null,
  ])
}

/**
 * Bind the checked-out branch to the exact GitHub remote it tracks. A fork's
 * own repository and its parent are both valid, but an unrelated or
 * unpublished remote is never guessed from the local repository metadata.
 */
export function resolveEffectiveBranchRulesContext(
  repository: Repository,
  branch: Branch | null,
  remote: IRemote | null
): EffectiveBranchRulesContext {
  const fallbackBranch =
    branch?.upstreamWithoutRemote ?? branch?.nameWithoutRemote ?? null
  const gitHubRepository = repository.gitHubRepository

  if (gitHubRepository === null) {
    return {
      kind: 'unsupported',
      branch: fallbackBranch,
      message:
        'This repository is not associated with a supported GitHub provider.',
      contextVersion: contextVersion(repository, branch, remote, null),
    }
  }

  if (branch === null) {
    return {
      kind: 'unsupported',
      branch: null,
      message: 'A checked-out branch is required to inspect branch rules.',
      contextVersion: contextVersion(repository, null, remote, null),
    }
  }

  const candidates = [gitHubRepository, gitHubRepository.parent].filter(
    (candidate): candidate is GitHubRepository => candidate !== null
  )
  for (const candidate of candidates) {
    try {
      const providerBranch = getGitHubPullRequestHead(
        candidate,
        candidate,
        branch,
        remote,
        getHTMLURL(candidate.endpoint)
      )
      return {
        kind: 'ready',
        gitHubRepository: candidate,
        branch: providerBranch,
        contextVersion: contextVersion(repository, branch, remote, candidate),
      }
    } catch {
      // Try the fork parent before reporting a safe unsupported state.
    }
  }

  return {
    kind: 'unsupported',
    branch: fallbackBranch,
    message:
      'The checked-out branch is not published to a recognized GitHub remote.',
    contextVersion: contextVersion(repository, branch, remote, null),
  }
}
