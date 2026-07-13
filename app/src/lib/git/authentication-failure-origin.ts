import type { GitError } from './core'

/**
 * Authentication failures synthesized by the credential trampoline can name
 * the HTTPS origin which actually rejected or lacked credentials. Keep that
 * provenance out-of-band so it cannot leak through Git's environment or
 * serialized error output.
 */
const authenticationFailureOrigins = new WeakMap<
  GitError,
  ReadonlySet<string>
>()

export function setAuthenticationFailureOrigins(
  error: GitError,
  origins: Iterable<string>
): void {
  authenticationFailureOrigins.set(error, new Set(origins))
}

export function getAuthenticationFailureOrigins(
  error: GitError
): ReadonlySet<string> | undefined {
  return authenticationFailureOrigins.get(error)
}
