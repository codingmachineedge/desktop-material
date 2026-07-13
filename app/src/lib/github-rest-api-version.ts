/** The current stable REST API version used for GitHub.com requests. */
export const GitHubDotComRESTAPIVersion = '2026-03-10'

export const GitHubRESTAPIVersionHeader = 'X-GitHub-Api-Version'

function isGraphQLRequestPath(path: string): boolean {
  return path.split(/[?#]/, 1)[0].replace(/^\/+/, '') === 'graphql'
}

function isDotComRESTEndpoint(endpoint: string): boolean {
  const configured = process.env['DESKTOP_GITHUB_DOTCOM_API_ENDPOINT']
  if (
    configured !== undefined &&
    configured.replace(/\/+$/, '') === endpoint.replace(/\/+$/, '')
  ) {
    return true
  }

  try {
    const hostname = new URL(endpoint).hostname
    return hostname === 'api.github.com' || hostname === 'github.com'
  } catch {
    return false
  }
}

/** Return the REST version known to be supported by this endpoint and path. */
export function getGitHubRESTAPIVersion(
  endpoint: string,
  path: string
): string | null {
  return isDotComRESTEndpoint(endpoint) && !isGraphQLRequestPath(path)
    ? GitHubDotComRESTAPIVersion
    : null
}

/** Add the stable REST version to GitHub.com API request headers. */
export function createGitHubAPIRequestHeaders(
  endpoint: string,
  path: string,
  customHeaders?: HeadersInit
): Headers {
  const headers = new Headers(customHeaders)
  const version = getGitHubRESTAPIVersion(endpoint, path)

  if (version !== null) {
    headers.set(GitHubRESTAPIVersionHeader, version)
  }

  return headers
}
