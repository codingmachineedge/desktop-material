import { GitHubOAuthScopes } from './github-oauth-scopes'

/**
 * Broader classic scopes that imply one of our required scopes. A token
 * granted `admin:org` can read organization membership even though the
 * literal `read:org` scope is absent from its X-OAuth-Scopes header.
 */
const ScopeImplications: Record<string, ReadonlyArray<string>> = {
  'read:org': ['write:org', 'admin:org'],
  user: [],
  repo: [],
  workflow: [],
  notifications: [],
}

/** Parse the X-OAuth-Scopes response header into the granted scope set. */
export function parseGrantedScopes(
  header: string | null | undefined
): ReadonlySet<string> {
  if (header == null) {
    return new Set()
  }
  return new Set(
    header
      .split(',')
      .map(scope => scope.trim())
      .filter(scope => scope.length > 0)
  )
}

/**
 * The required scopes a granted set is missing. An empty result means every
 * implemented GitHub feature (including Releases) can load with this token.
 */
export function missingRequiredScopes(
  granted: ReadonlySet<string>
): ReadonlyArray<string> {
  return GitHubOAuthScopes.filter(required => {
    if (granted.has(required)) {
      return false
    }
    const implications = ScopeImplications[required] ?? []
    return !implications.some(broader => granted.has(broader))
  })
}
