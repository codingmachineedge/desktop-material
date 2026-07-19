import {
  GitHubAPIWorkbenchRequest,
  IGitHubAPIWorkbenchResponse,
} from './github-api-workbench'
import {
  getGraphQLErrors,
  GitHubProjectsItemPageSize,
  GitHubProjectsMaximumItemPages,
  GitHubProjectsMaximumItems,
  GitHubProjectsMaximumProjectPages,
  GitHubProjectsMaximumViews,
  GitHubProjectsProjectPageSize,
  IGitHubProject,
  IGitHubProjectItem,
  IGitHubProjectsSnapshot,
  IParsedGitHubProject,
  parseClassicGitHubProjectCards,
  parseClassicGitHubProjectColumns,
  parseClassicGitHubProjects,
  parseGitHubProjectsV2Page,
  parseGitHubProjectV2ItemsPage,
  responseIndicatesProjectsV2Unsupported,
  sanitizeGitHubProjectsSnapshot,
} from './github-projects'

export type GitHubProjectsErrorKind =
  | 'authentication'
  | 'permission'
  | 'rate-limit'
  | 'not-found'
  | 'unsupported'
  | 'service'
  | 'network'
  | 'invalid-response'

export class GitHubProjectsError extends Error {
  public constructor(
    public readonly kind: GitHubProjectsErrorKind,
    message: string,
    public readonly responseStatus: number | null = null
  ) {
    super(message)
    this.name = 'GitHubProjectsError'
  }
}

export interface IGitHubProjectsClient {
  executeGitHubAPIWorkbench(
    request: GitHubAPIWorkbenchRequest,
    confirmed?: boolean,
    signal?: AbortSignal
  ): Promise<IGitHubAPIWorkbenchResponse>
}

export interface IGitHubProjectsRepositoryIdentity {
  readonly endpoint: string
  readonly owner: string
  readonly repository: string
}

const ProjectFields = `
  id
  number
  title
  shortDescription
  url
  closedAt
  updatedAt
  views(first: ${GitHubProjectsMaximumViews}) {
    nodes { id number name layout }
    pageInfo { hasNextPage endCursor }
  }
  items(first: ${GitHubProjectsItemPageSize}) {
    nodes {
      id
      type
      updatedAt
      fieldValueByName(name: "Status") {
        __typename
        ... on ProjectV2ItemFieldSingleSelectValue { name }
        ... on ProjectV2ItemFieldIterationValue { title }
        ... on ProjectV2ItemFieldTextValue { text }
        ... on ProjectV2ItemFieldNumberValue { number }
        ... on ProjectV2ItemFieldDateValue { date }
      }
      content {
        __typename
        ... on Issue {
          number title url state repository { nameWithOwner }
        }
        ... on PullRequest {
          number title url state repository { nameWithOwner }
        }
        ... on DraftIssue { title }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
`

export const GitHubProjectsV2RepositoryQuery = `
query DesktopMaterialRepositoryProjects(
  $owner: String!
  $repository: String!
  $after: String
) {
  repository(owner: $owner, name: $repository) {
    projectsV2(
      first: ${GitHubProjectsProjectPageSize}
      after: $after
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      nodes { ${ProjectFields} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`

export const GitHubProjectsV2ItemsQuery = `
query DesktopMaterialProjectItems($project: ID!, $after: String) {
  node(id: $project) {
    ... on ProjectV2 {
      items(first: ${GitHubProjectsItemPageSize}, after: $after) {
        nodes {
          id
          type
          updatedAt
          fieldValueByName(name: "Status") {
            __typename
            ... on ProjectV2ItemFieldSingleSelectValue { name }
            ... on ProjectV2ItemFieldIterationValue { title }
            ... on ProjectV2ItemFieldTextValue { text }
            ... on ProjectV2ItemFieldNumberValue { number }
            ... on ProjectV2ItemFieldDateValue { date }
          }
          content {
            __typename
            ... on Issue {
              number title url state repository { nameWithOwner }
            }
            ... on PullRequest {
              number title url state repository { nameWithOwner }
            }
            ... on DraftIssue { title }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`

function coordinate(value: string, label: string): string {
  const normalized = value.trim()
  if (
    normalized.length < 1 ||
    normalized.length > 256 ||
    /[\u0000-\u001f\u007f/\\]/.test(normalized)
  ) {
    throw new GitHubProjectsError(
      'invalid-response',
      `The selected GitHub ${label} is invalid.`
    )
  }
  return normalized
}

function isSuccessful(response: IGitHubAPIWorkbenchResponse): boolean {
  return response.status >= 200 && response.status < 300
}

function responseError(
  response: IGitHubAPIWorkbenchResponse,
  operation: string
): GitHubProjectsError {
  const status = response.status
  if (status === 401) {
    return new GitHubProjectsError(
      'authentication',
      `GitHub could not ${operation}. Sign in again and retry.`,
      status
    )
  }
  if (status === 403) {
    const remaining = response.headers['x-ratelimit-remaining']
    const rateLimited =
      remaining === '0' || response.headers['retry-after'] !== undefined
    return new GitHubProjectsError(
      rateLimited ? 'rate-limit' : 'permission',
      rateLimited
        ? `GitHub could not ${operation} because the API rate limit was reached. Retry after it resets.`
        : `GitHub denied permission to ${operation}. Check the selected account's repository and Projects access.`,
      status
    )
  }
  if (status === 404) {
    return new GitHubProjectsError(
      'not-found',
      `GitHub could not ${operation}. The repository or Project may be unavailable to this account.`,
      status
    )
  }
  if (status === 410 || status === 422) {
    return new GitHubProjectsError(
      'unsupported',
      `GitHub Projects are not available through this server's supported APIs.`,
      status
    )
  }
  if (status >= 500) {
    return new GitHubProjectsError(
      'service',
      `GitHub could not ${operation} because the service returned an error (${status}). Retry in a moment.`,
      status
    )
  }
  return new GitHubProjectsError(
    'invalid-response',
    `GitHub could not ${operation} safely. Refresh Projects and retry.`,
    status
  )
}

function assertResponse(
  response: IGitHubAPIWorkbenchResponse,
  operation: string
): void {
  if (!isSuccessful(response)) {
    throw responseError(response, operation)
  }
}

function graphQLResponseError(
  response: IGitHubAPIWorkbenchResponse,
  operation: string
): GitHubProjectsError | null {
  const errors = getGraphQLErrors(response)
  if (errors.length === 0) {
    return null
  }
  const combined = errors.join(' ')
  const kind: GitHubProjectsErrorKind = /rate limit/i.test(combined)
    ? 'rate-limit'
    : /permission|forbidden|scope|access denied/i.test(combined)
    ? 'permission'
    : /not found|could not resolve to a repository/i.test(combined)
    ? 'not-found'
    : 'invalid-response'
  return new GitHubProjectsError(
    kind,
    kind === 'rate-limit'
      ? `GitHub could not ${operation} because the API rate limit was reached.`
      : kind === 'permission'
      ? `GitHub denied permission to ${operation}. Check the selected account's Projects access.`
      : kind === 'not-found'
      ? `GitHub could not ${operation}. The repository may be unavailable to this account.`
      : `GitHub could not ${operation} safely. Refresh Projects and retry.`
  )
}

async function execute(
  client: IGitHubProjectsClient,
  request: GitHubAPIWorkbenchRequest,
  signal: AbortSignal
): Promise<IGitHubAPIWorkbenchResponse> {
  try {
    return await client.executeGitHubAPIWorkbench(request, false, signal)
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      throw error
    }
    throw new GitHubProjectsError(
      'network',
      'GitHub Projects could not be reached. Check the network and retry.'
    )
  }
}

function graphQLRequest(
  query: string,
  variables: Readonly<Record<string, unknown>>,
  operationName: string
): GitHubAPIWorkbenchRequest {
  return {
    mode: 'graphql',
    query,
    variablesText: JSON.stringify(variables),
    operationName,
  }
}

function restRequest(path: string): GitHubAPIWorkbenchRequest {
  return { mode: 'rest', method: 'GET', path, bodyText: '' }
}

function appendUniqueItems(
  target: Array<IGitHubProjectItem>,
  incoming: ReadonlyArray<IGitHubProjectItem>,
  maximum: number
): void {
  const ids = new Set(target.map(item => item.id))
  for (const item of incoming) {
    if (target.length >= maximum) {
      return
    }
    if (!ids.has(item.id)) {
      ids.add(item.id)
      target.push(item)
    }
  }
}

async function loadProjectsV2(
  identity: IGitHubProjectsRepositoryIdentity,
  client: IGitHubProjectsClient,
  signal: AbortSignal,
  now: Date
): Promise<IGitHubProjectsSnapshot | 'unsupported'> {
  const projects: Array<IParsedGitHubProject> = []
  let cursor: string | null = null
  let hasNextPage = false

  for (let page = 0; page < GitHubProjectsMaximumProjectPages; page++) {
    const response = await execute(
      client,
      graphQLRequest(
        GitHubProjectsV2RepositoryQuery,
        {
          owner: identity.owner,
          repository: identity.repository,
          after: cursor,
        },
        'DesktopMaterialRepositoryProjects'
      ),
      signal
    )
    if (responseIndicatesProjectsV2Unsupported(response)) {
      return 'unsupported'
    }
    assertResponse(response, 'load Projects')
    const graphQLError = graphQLResponseError(response, 'load Projects')
    if (graphQLError !== null) {
      throw graphQLError
    }
    let parsed
    try {
      parsed = parseGitHubProjectsV2Page(response.body)
    } catch {
      throw new GitHubProjectsError(
        'invalid-response',
        'GitHub returned Projects data the app could not validate.'
      )
    }
    projects.push(...parsed.projects)
    hasNextPage = parsed.pageInfo.hasNextPage
    cursor = parsed.pageInfo.endCursor
    if (!hasNextPage || cursor === null) {
      break
    }
  }

  const partialReasons = new Set<
    IGitHubProjectsSnapshot['partialReasons'][number]
  >()
  if (hasNextPage) {
    partialReasons.add('projects-capped')
  }

  let totalItems = projects.reduce(
    (count, project) => count + project.items.length,
    0
  )
  const normalized: Array<IGitHubProject> = []
  for (const project of projects) {
    const items = [...project.items]
    let itemCursor = project.itemPageInfo.endCursor
    let moreItems = project.itemPageInfo.hasNextPage
    for (
      let itemPage = 1;
      itemPage < GitHubProjectsMaximumItemPages &&
      moreItems &&
      itemCursor !== null &&
      totalItems < GitHubProjectsMaximumItems;
      itemPage++
    ) {
      const response = await execute(
        client,
        graphQLRequest(
          GitHubProjectsV2ItemsQuery,
          { project: project.id, after: itemCursor },
          'DesktopMaterialProjectItems'
        ),
        signal
      )
      assertResponse(response, 'load Project items')
      const graphQLError = graphQLResponseError(response, 'load Project items')
      if (graphQLError !== null) {
        throw graphQLError
      }
      let parsed
      try {
        parsed = parseGitHubProjectV2ItemsPage(response.body)
      } catch {
        throw new GitHubProjectsError(
          'invalid-response',
          'GitHub returned Project items the app could not validate.'
        )
      }
      const before = items.length
      appendUniqueItems(
        items,
        parsed.items,
        Math.min(
          GitHubProjectsItemPageSize * GitHubProjectsMaximumItemPages,
          GitHubProjectsMaximumItems - totalItems + items.length
        )
      )
      totalItems += items.length - before
      moreItems = parsed.pageInfo.hasNextPage
      itemCursor = parsed.pageInfo.endCursor
    }
    if (moreItems || totalItems >= GitHubProjectsMaximumItems) {
      partialReasons.add('items-capped')
    }
    if (project.viewsPartial) {
      partialReasons.add('views-capped')
    }
    normalized.push(
      Object.freeze({
        id: project.id,
        number: project.number,
        title: project.title,
        description: project.description,
        url: project.url,
        state: project.state,
        updatedAt: project.updatedAt,
        views: project.views,
        items: Object.freeze(items),
        partial:
          moreItems ||
          project.viewsPartial ||
          totalItems >= GitHubProjectsMaximumItems,
      })
    )
  }

  const snapshot = sanitizeGitHubProjectsSnapshot({
    version: 1,
    endpoint: identity.endpoint,
    owner: identity.owner,
    repository: identity.repository,
    source: 'projects-v2',
    fetchedAt: now.toISOString(),
    projects: normalized,
    partialReasons: [...partialReasons],
  })
  if (snapshot === null) {
    throw new GitHubProjectsError(
      'invalid-response',
      'GitHub returned Projects data the app could not validate.'
    )
  }
  return snapshot
}

async function loadClassicProjects(
  identity: IGitHubProjectsRepositoryIdentity,
  client: IGitHubProjectsClient,
  signal: AbortSignal,
  now: Date
): Promise<IGitHubProjectsSnapshot> {
  const safeOwner = encodeURIComponent(identity.owner)
  const safeRepository = encodeURIComponent(identity.repository)
  const projectMetadata = []
  let projectsCapped = false

  for (let page = 1; page <= GitHubProjectsMaximumProjectPages; page++) {
    const response = await execute(
      client,
      restRequest(
        `repos/${safeOwner}/${safeRepository}/projects?state=all&per_page=${GitHubProjectsProjectPageSize}&page=${page}`
      ),
      signal
    )
    assertResponse(response, 'load classic Projects')
    let parsed
    try {
      parsed = parseClassicGitHubProjects(response.body)
    } catch {
      throw new GitHubProjectsError(
        'invalid-response',
        'GitHub returned classic Projects data the app could not validate.'
      )
    }
    projectMetadata.push(...parsed)
    if (parsed.length < GitHubProjectsProjectPageSize) {
      projectsCapped = false
      break
    }
    projectsCapped = page === GitHubProjectsMaximumProjectPages
  }

  const partialReasons = new Set<
    IGitHubProjectsSnapshot['partialReasons'][number]
  >(['classic-fallback'])
  if (projectsCapped) {
    partialReasons.add('projects-capped')
  }

  let totalItems = 0
  const projects: Array<IGitHubProject> = []
  for (const metadata of projectMetadata) {
    const columnsResponse = await execute(
      client,
      restRequest(
        `projects/${metadata.id}/columns?per_page=${GitHubProjectsMaximumViews}&page=1`
      ),
      signal
    )
    assertResponse(columnsResponse, 'load classic Project columns')
    let columns
    try {
      columns = parseClassicGitHubProjectColumns(columnsResponse.body)
    } catch {
      throw new GitHubProjectsError(
        'invalid-response',
        'GitHub returned classic Project columns the app could not validate.'
      )
    }
    if (columns.length === GitHubProjectsMaximumViews) {
      partialReasons.add('views-capped')
    }
    const items: Array<IGitHubProjectItem> = []
    for (const column of columns) {
      if (totalItems >= GitHubProjectsMaximumItems) {
        partialReasons.add('items-capped')
        break
      }
      const cardsResponse = await execute(
        client,
        restRequest(
          `projects/columns/${column.id}/cards?per_page=${GitHubProjectsItemPageSize}&page=1`
        ),
        signal
      )
      assertResponse(cardsResponse, 'load classic Project cards')
      let cards
      try {
        cards = parseClassicGitHubProjectCards(cardsResponse.body, column.name)
      } catch {
        throw new GitHubProjectsError(
          'invalid-response',
          'GitHub returned classic Project cards the app could not validate.'
        )
      }
      const remaining = GitHubProjectsMaximumItems - totalItems
      appendUniqueItems(
        items,
        cards.slice(0, remaining),
        items.length + remaining
      )
      totalItems += Math.min(cards.length, remaining)
      if (
        cards.length === GitHubProjectsItemPageSize ||
        totalItems >= GitHubProjectsMaximumItems
      ) {
        partialReasons.add('items-capped')
      }
    }
    projects.push(
      Object.freeze({
        id: `classic-project-${metadata.id}`,
        number: metadata.id,
        title: metadata.title,
        description: metadata.description,
        url: metadata.url,
        state: metadata.state,
        updatedAt: metadata.updatedAt,
        views: Object.freeze(
          columns.map(column => ({
            id: `classic-column-${column.id}`,
            name: column.name,
            layout: 'column',
          }))
        ),
        items: Object.freeze(items),
        partial:
          columns.length === GitHubProjectsMaximumViews ||
          partialReasons.has('items-capped'),
      })
    )
  }

  const snapshot = sanitizeGitHubProjectsSnapshot({
    version: 1,
    endpoint: identity.endpoint,
    owner: identity.owner,
    repository: identity.repository,
    source: 'classic',
    fetchedAt: now.toISOString(),
    projects,
    partialReasons: [...partialReasons],
  })
  if (snapshot === null) {
    throw new GitHubProjectsError(
      'invalid-response',
      'GitHub returned classic Projects data the app could not validate.'
    )
  }
  return snapshot
}

/**
 * Load a bounded read-only Projects snapshot. Projects v2 is authoritative;
 * the retired classic API is attempted only when the endpoint explicitly
 * reports that the v2 GraphQL field is unavailable.
 */
export async function loadGitHubProjects(
  rawIdentity: IGitHubProjectsRepositoryIdentity,
  client: IGitHubProjectsClient,
  signal: AbortSignal,
  now: Date = new Date()
): Promise<IGitHubProjectsSnapshot> {
  const identity = {
    endpoint: rawIdentity.endpoint,
    owner: coordinate(rawIdentity.owner, 'owner'),
    repository: coordinate(rawIdentity.repository, 'repository'),
  }
  const v2 = await loadProjectsV2(identity, client, signal, now)
  return v2 === 'unsupported'
    ? loadClassicProjects(identity, client, signal, now)
    : v2
}
