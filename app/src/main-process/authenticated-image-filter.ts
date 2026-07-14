import { getDotComAPIEndpoint, getHTMLURL } from '../lib/api'
import { EndpointToken } from '../lib/endpoint-token'
import { OrderedWebRequest } from './ordered-webrequest'

function isEnterpriseAvatarPath(pathname: string) {
  return pathname.startsWith('/api/v3/enterprise/avatars/')
}

function isGitHubRepoAssetPath(pathname: string) {
  // Matches paths like: /repo/owner/assets/userID/guid
  return (
    /^\/[^/]+\/[^/]+\/assets\/[^/]+\/[^/]+\/?$/.test(pathname) ||
    // or: /user-attachments/assets/guid
    /^\/user-attachments\/assets\/[^/]+\/?$/.test(pathname)
  )
}

/**
 * Installs a web request filter which adds the Authorization header for
 * unauthenticated requests to the GHES/GHAE private avatars API, and for private
 * repo assets.
 *
 * Returns a method that can be used to update the list of signed-in accounts
 * which is used to resolve which token to use.
 */
export function installAuthenticatedImageFilter(
  orderedWebRequest: OrderedWebRequest
) {
  let originTokens = new Map<string, string>()

  orderedWebRequest.onBeforeSendHeaders.addEventListener(async details => {
    const { origin, pathname } = new URL(details.url)
    const token = originTokens.get(origin)

    if (
      token &&
      (isEnterpriseAvatarPath(pathname) || isGitHubRepoAssetPath(pathname))
    ) {
      return {
        requestHeaders: {
          ...details.requestHeaders,
          Authorization: `token ${token}`,
        },
      }
    }

    return {}
  })

  return (accounts: ReadonlyArray<EndpointToken>) => {
    originTokens = getAuthenticatedImageOriginTokens(accounts)
  }
}

/**
 * Build the origin-to-token map used by the main-process image filter.
 *
 * GitHub.com/private asset URLs are served from the HTML host while account
 * tokens are registered against the API host. Keep both keys as normalized
 * origins so this remains correct for a configured development endpoint too.
 */
export function getAuthenticatedImageOriginTokens(
  accounts: ReadonlyArray<EndpointToken>,
  dotComAPIEndpoint = getDotComAPIEndpoint()
) {
  const originTokens = new Map(
    accounts.map(({ endpoint, token }) => [
      new globalThis.URL(endpoint).origin,
      token,
    ])
  )

  // If we have a token for api.github.com, add another entry in our
  // tokens-by-origin map with the same token for github.com. This is
  // necessary for private image URLs.
  const dotComAPIToken = originTokens.get(
    new globalThis.URL(dotComAPIEndpoint).origin
  )
  if (dotComAPIToken) {
    originTokens.set(
      new globalThis.URL(getHTMLURL(dotComAPIEndpoint)).origin,
      dotComAPIToken
    )
  }

  return originTokens
}
