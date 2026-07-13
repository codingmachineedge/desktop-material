import { URL } from 'url'
import * as Path from 'path'

import { Account, getAccountKey } from '../models/account'
import { IRemote } from '../models/remote'
import { getHTMLURL } from './api'
import { parseRemote, parseRepositoryIdentifier } from './remote-parsing'
import { caseInsensitiveEquals } from './compare'
import { GitHubRepository } from '../models/github-repository'

export interface IMatchedGitHubRepository {
  /**
   * The name of the repository, e.g., for https://github.com/user/repo, the
   * name is `repo`.
   */
  readonly name: string

  /**
   * The login of the owner of the repository, e.g., for
   * https://github.com/user/repo, the owner is `user`.
   */
  readonly owner: string

  /** The account matching the repository remote */
  readonly account: Account
}

interface IRepositoryAuthority {
  /** A canonical hostname, without a transport-specific port. */
  readonly hostname: string

  /** The canonical HTTP(S) origin, when the repository URL is a web URL. */
  readonly webOrigin: string | null
}

/**
 * Parse the authority represented by a repository URL.
 *
 * WHATWG URL parsing gives us case-normalized hostnames, canonical IPv6
 * literals, and default-port normalization. Git's scp-like SSH syntax isn't a
 * valid URL, so callers can provide the hostname already extracted by
 * `parseRemote` as a fallback for those remotes.
 */
function parseRepositoryAuthority(
  value: string,
  fallbackHostname: string | null = null
): IRepositoryAuthority | null {
  try {
    const parsed = new URL(value)

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (parsed.hostname.length === 0) {
        return null
      }

      return {
        hostname: parsed.hostname.toLowerCase(),
        webOrigin: parsed.origin,
      }
    }

    if (parsed.hostname.length > 0) {
      return {
        hostname: parsed.hostname.toLowerCase(),
        webOrigin: null,
      }
    }
  } catch {
    // Fall through for Git's scp-like SSH syntax. A malformed HTTP(S) URL must
    // never degrade to a hostname-only comparison and accidentally cross an
    // origin boundary.
    if (/^https?:\/\//i.test(value)) {
      return null
    }
  }

  if (fallbackHostname === null) {
    return null
  }

  return {
    hostname: fallbackHostname.toLowerCase(),
    webOrigin: null,
  }
}

/**
 * Compare repository authorities without discarding a non-default web port.
 *
 * Two HTTP(S) URLs must have the same canonical origin, including scheme and
 * port. If either side is an SSH remote there is no shared web origin to
 * compare, so preserve the existing Git behavior of matching by hostname.
 */
function repositoryAuthoritiesMatch(
  firstURL: string,
  firstFallbackHostname: string | null,
  secondURL: string,
  secondFallbackHostname: string | null
): boolean {
  const first = parseRepositoryAuthority(firstURL, firstFallbackHostname)
  const second = parseRepositoryAuthority(secondURL, secondFallbackHostname)

  if (first === null || second === null) {
    return false
  }

  if (first.webOrigin !== null && second.webOrigin !== null) {
    return first.webOrigin === second.webOrigin
  }

  return caseInsensitiveEquals(first.hostname, second.hostname)
}

/** Try to use the list of users and a remote URL to guess a GitHub repository. */
export function matchGitHubRepository(
  accounts: ReadonlyArray<Account>,
  remote: string,
  accountKey: string | null = null
): IMatchedGitHubRepository | null {
  const parsedRemote = parseRemote(remote)
  if (parsedRemote === null) {
    return null
  }

  const candidateAccounts =
    accountKey === null
      ? accounts
      : accounts.filter(account => getAccountKey(account) === accountKey)

  for (const account of candidateAccounts) {
    const htmlURL = getHTMLURL(account.endpoint)

    if (
      repositoryAuthoritiesMatch(htmlURL, null, remote, parsedRemote.hostname)
    ) {
      return { name: parsedRemote.name, owner: parsedRemote.owner, account }
    }
  }

  return null
}

/**
 * Find an existing repository associated with this path
 *
 * @param repos The list of repositories tracked in the app
 * @param path The path on disk which might be a repository
 */
export function matchExistingRepository<T extends { readonly path: string }>(
  repos: ReadonlyArray<T>,
  path: string
): T | undefined {
  // Windows is guaranteed to be case-insensitive so we can be a bit less strict
  const normalize = __WIN32__
    ? (p: string) => Path.normalize(p).toLowerCase()
    : (p: string) => Path.normalize(p)

  const needle = normalize(path)
  return repos.find(r => normalize(r.path) === needle)
}

/**
 * Check whether or not a GitHub repository matches a given remote.
 *
 * @param gitHubRepository the repository containing information from the GitHub API
 * @param remote the remote details found in the Git repository
 */
export function repositoryMatchesRemote(
  gitHubRepository: GitHubRepository,
  remote: IRemote
): boolean {
  return (
    urlMatchesRemote(gitHubRepository.htmlURL, remote) ||
    urlMatchesRemote(gitHubRepository.cloneURL, remote)
  )
}

/**
 * Check whether or not a GitHub repository URL matches a given remote, by
 * parsing and comparing the structure of the each URL.
 *
 * @param url a URL associated with the GitHub repository
 * @param remote the remote details found in the Git repository
 */
export function urlMatchesRemote(url: string | null, remote: IRemote): boolean {
  if (url == null) {
    return false
  }

  const cloneUrl = parseRemote(url)
  const remoteUrl = parseRemote(remote.url)

  if (remoteUrl == null || cloneUrl == null) {
    return false
  }

  if (
    !repositoryAuthoritiesMatch(
      remote.url,
      remoteUrl.hostname,
      url,
      cloneUrl.hostname
    )
  ) {
    return false
  }

  if (remoteUrl.owner == null || cloneUrl.owner == null) {
    return false
  }

  if (remoteUrl.name == null || cloneUrl.name == null) {
    return false
  }

  return (
    caseInsensitiveEquals(remoteUrl.owner, cloneUrl.owner) &&
    caseInsensitiveEquals(remoteUrl.name, cloneUrl.name)
  )
}

/**
 * Match a URL-like string to the Clone URL of a GitHub Repository
 *
 * @param url A remote-like URL to verify against the existing information
 * @param gitHubRepository GitHub API details for a repository
 */
export function urlMatchesCloneURL(
  url: string,
  gitHubRepository: GitHubRepository
): boolean {
  if (gitHubRepository.cloneURL === null) {
    return false
  }

  return urlsMatch(gitHubRepository.cloneURL, url)
}

export function urlsMatch(url1: string, url2: string) {
  const firstIdentifier = parseRepositoryIdentifier(url1)
  const secondIdentifier = parseRepositoryIdentifier(url2)

  const authoritiesMatch =
    firstIdentifier !== null &&
    secondIdentifier !== null &&
    (firstIdentifier.hostname === null || secondIdentifier.hostname === null
      ? firstIdentifier.hostname === secondIdentifier.hostname
      : repositoryAuthoritiesMatch(
          url1,
          firstIdentifier.hostname,
          url2,
          secondIdentifier.hostname
        ))

  return (
    firstIdentifier !== null &&
    secondIdentifier !== null &&
    authoritiesMatch &&
    firstIdentifier.owner === secondIdentifier.owner &&
    firstIdentifier.name === secondIdentifier.name
  )
}
