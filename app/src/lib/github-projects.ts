import { IGitHubAPIWorkbenchResponse } from './github-api-workbench'

export const GitHubProjectsProjectPageSize = 6
export const GitHubProjectsMaximumProjectPages = 2
export const GitHubProjectsItemPageSize = 25
export const GitHubProjectsMaximumItemPages = 2
export const GitHubProjectsMaximumItems = 200
export const GitHubProjectsMaximumViews = 10

const MaximumIdentifierLength = 256
const MaximumTitleLength = 256
const MaximumDescriptionLength = 2_048
const MaximumStatusLength = 128
const MaximumRepositoryLength = 256
const MaximumURLLength = 2_048

export type GitHubProjectsSource = 'projects-v2' | 'classic'
export type GitHubProjectItemKind =
  | 'issue'
  | 'pull-request'
  | 'draft-issue'
  | 'note'
  | 'unavailable'

export type GitHubProjectsPartialReason =
  | 'projects-capped'
  | 'items-capped'
  | 'views-capped'
  | 'classic-fallback'

export interface IGitHubProjectView {
  readonly id: string
  readonly name: string
  readonly layout: string | null
}

export interface IGitHubProjectItem {
  readonly id: string
  readonly kind: GitHubProjectItemKind
  readonly title: string
  readonly url: string | null
  readonly state: string | null
  readonly repository: string | null
  readonly status: string | null
  readonly updatedAt: string | null
}

export interface IGitHubProject {
  readonly id: string
  readonly number: number | null
  readonly title: string
  readonly description: string
  readonly url: string | null
  readonly state: 'open' | 'closed'
  readonly updatedAt: string | null
  readonly views: ReadonlyArray<IGitHubProjectView>
  readonly items: ReadonlyArray<IGitHubProjectItem>
  readonly partial: boolean
}

export interface IGitHubProjectsSnapshot {
  readonly version: 1
  readonly endpoint: string
  readonly owner: string
  readonly repository: string
  readonly source: GitHubProjectsSource
  readonly fetchedAt: string
  readonly projects: ReadonlyArray<IGitHubProject>
  readonly partialReasons: ReadonlyArray<GitHubProjectsPartialReason>
}

export interface IProjectPageInfo {
  readonly hasNextPage: boolean
  readonly endCursor: string | null
}

export interface IParsedGitHubProject extends IGitHubProject {
  readonly itemPageInfo: IProjectPageInfo
  readonly viewsPartial: boolean
}

export interface IParsedGitHubProjectPage {
  readonly projects: ReadonlyArray<IParsedGitHubProject>
  readonly pageInfo: IProjectPageInfo
}

export interface IParsedGitHubProjectItemsPage {
  readonly items: ReadonlyArray<IGitHubProjectItem>
  readonly pageInfo: IProjectPageInfo
}

export interface IClassicGitHubProject {
  readonly id: number
  readonly title: string
  readonly description: string
  readonly url: string | null
  readonly state: 'open' | 'closed'
  readonly updatedAt: string | null
}

export interface IClassicGitHubProjectColumn {
  readonly id: number
  readonly name: string
}

type UnknownRecord = Readonly<Record<string, unknown>>

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function boundedString(
  value: unknown,
  maximum: number,
  fallback: string = ''
): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return normalized.slice(0, maximum)
}

function identifier(value: unknown, fallback: string): string {
  return boundedString(value, MaximumIdentifierLength, fallback)
}

function optionalDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function safeURL(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MaximumURLLength) {
    return null
  }
  try {
    const parsed = new URL(value)
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      return null
    }
    parsed.hash = ''
    return parsed.toString().slice(0, MaximumURLLength)
  } catch {
    return null
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function nodes(value: unknown): ReadonlyArray<unknown> {
  const connection = record(value)
  const candidate = connection?.nodes
  return Array.isArray(candidate) ? candidate : []
}

function pageInfo(value: unknown): IProjectPageInfo {
  const connection = record(value)
  const info = record(connection?.pageInfo)
  return {
    hasNextPage: info?.hasNextPage === true,
    endCursor:
      typeof info?.endCursor === 'string' && info.endCursor.length <= 512
        ? info.endCursor
        : null,
  }
}

function parseStatus(value: unknown): string | null {
  const field = record(value)
  if (field === null) {
    return null
  }
  for (const key of ['name', 'title', 'text', 'date']) {
    const parsed = boundedString(field[key], MaximumStatusLength)
    if (parsed.length > 0) {
      return parsed
    }
  }
  return typeof field.number === 'number' && Number.isFinite(field.number)
    ? String(field.number).slice(0, MaximumStatusLength)
    : null
}

function parseV2Item(value: unknown, index: number): IGitHubProjectItem {
  const item = record(value) ?? {}
  const content = record(item.content)
  const type = boundedString(item.type, 32).toUpperCase()
  const kind: GitHubProjectItemKind =
    type === 'UNAVAILABLE'
      ? 'unavailable'
      : type === 'NOTE'
      ? 'note'
      : type === 'ISSUE'
      ? 'issue'
      : type === 'PULL_REQUEST'
      ? 'pull-request'
      : type === 'DRAFT_ISSUE'
      ? 'draft-issue'
      : content === null
      ? 'unavailable'
      : 'note'
  const contentRepository = record(content?.repository)
  const title = boundedString(content?.title, MaximumTitleLength)
  return Object.freeze({
    id: identifier(item.id, `item-${index}`),
    kind,
    title: title.length > 0 ? title : 'Unavailable item',
    url: safeURL(content?.url),
    state: boundedString(content?.state, 32) || null,
    repository:
      boundedString(
        contentRepository?.nameWithOwner,
        MaximumRepositoryLength
      ) || null,
    status: parseStatus(item.fieldValueByName),
    updatedAt: optionalDate(item.updatedAt),
  })
}

function parseV2ItemsConnection(value: unknown): IParsedGitHubProjectItemsPage {
  const rawNodes = nodes(value)
  return {
    items: rawNodes
      .slice(0, GitHubProjectsItemPageSize)
      .map((item, index) => parseV2Item(item, index)),
    pageInfo: pageInfo(value),
  }
}

function parseV2Views(value: unknown): ReadonlyArray<IGitHubProjectView> {
  return nodes(value)
    .slice(0, GitHubProjectsMaximumViews)
    .map((candidate, index) => {
      const view = record(candidate) ?? {}
      const name = boundedString(view.name, MaximumTitleLength)
      return Object.freeze({
        id: identifier(view.id, `view-${index}`),
        name: name.length > 0 ? name : `View ${index + 1}`,
        layout: boundedString(view.layout, 64) || null,
      })
    })
}

function parseV2Project(value: unknown, index: number): IParsedGitHubProject {
  const project = record(value) ?? {}
  const items = parseV2ItemsConnection(project.items)
  const rawViews = nodes(project.views)
  const title = boundedString(project.title, MaximumTitleLength)
  return Object.freeze({
    id: identifier(project.id, `project-${index}`),
    number: finiteNumber(project.number),
    title: title.length > 0 ? title : `Project ${index + 1}`,
    description: boundedString(
      project.shortDescription,
      MaximumDescriptionLength
    ),
    url: safeURL(project.url),
    state:
      project.closedAt === null || project.closedAt === undefined
        ? 'open'
        : 'closed',
    updatedAt: optionalDate(project.updatedAt),
    views: parseV2Views(project.views),
    items: items.items,
    partial:
      items.pageInfo.hasNextPage ||
      pageInfo(project.views).hasNextPage ||
      rawViews.length > GitHubProjectsMaximumViews,
    itemPageInfo: items.pageInfo,
    viewsPartial:
      pageInfo(project.views).hasNextPage ||
      rawViews.length > GitHubProjectsMaximumViews,
  })
}

export function getGraphQLErrors(
  response: IGitHubAPIWorkbenchResponse
): ReadonlyArray<string> {
  const body = record(response.body)
  const errors = body?.errors
  if (!Array.isArray(errors)) {
    return []
  }
  return errors.slice(0, 20).map(error => {
    const parsed = record(error)
    return boundedString(
      parsed?.message,
      512,
      'GitHub returned a GraphQL error.'
    )
  })
}

export function responseIndicatesProjectsV2Unsupported(
  response: IGitHubAPIWorkbenchResponse
): boolean {
  if (response.status === 404 || response.status === 410) {
    return true
  }
  return getGraphQLErrors(response).some(message =>
    /cannot query field\s+["']?projectsV2|field\s+["']?projectsV2["']?.*(?:undefined|does(?: not|n't) exist)/i.test(
      message
    )
  )
}

export function parseGitHubProjectsV2Page(
  body: unknown
): IParsedGitHubProjectPage {
  const root = record(body)
  const data = record(root?.data)
  const repository = record(data?.repository)
  if (repository === null) {
    throw new Error('GitHub did not return the requested repository.')
  }
  const projectsConnection = repository.projectsV2
  const rawProjects = nodes(projectsConnection)
  return {
    projects: rawProjects
      .slice(0, GitHubProjectsProjectPageSize)
      .map((project, index) => parseV2Project(project, index)),
    pageInfo: pageInfo(projectsConnection),
  }
}

export function parseGitHubProjectV2ItemsPage(
  body: unknown
): IParsedGitHubProjectItemsPage {
  const root = record(body)
  const data = record(root?.data)
  const project = record(data?.node)
  if (project === null) {
    throw new Error('GitHub did not return the requested project.')
  }
  return parseV2ItemsConnection(project.items)
}

export function parseClassicGitHubProjects(
  body: unknown
): ReadonlyArray<IClassicGitHubProject> {
  if (!Array.isArray(body)) {
    throw new Error('GitHub returned an invalid classic Projects response.')
  }
  return body.slice(0, GitHubProjectsProjectPageSize).flatMap(candidate => {
    const project = record(candidate)
    const id = finiteNumber(project?.id)
    if (project === null || id === null) {
      return []
    }
    const title = boundedString(project.name, MaximumTitleLength)
    return [
      Object.freeze({
        id,
        title: title.length > 0 ? title : `Project ${id}`,
        description: boundedString(project.body, MaximumDescriptionLength),
        url: safeURL(project.html_url),
        state: project.state === 'closed' ? 'closed' : 'open',
        updatedAt: optionalDate(project.updated_at),
      }),
    ]
  })
}

export function parseClassicGitHubProjectColumns(
  body: unknown
): ReadonlyArray<IClassicGitHubProjectColumn> {
  if (!Array.isArray(body)) {
    throw new Error('GitHub returned an invalid classic Project view response.')
  }
  return body.slice(0, GitHubProjectsMaximumViews).flatMap(candidate => {
    const column = record(candidate)
    const id = finiteNumber(column?.id)
    if (column === null || id === null) {
      return []
    }
    const name = boundedString(column.name, MaximumTitleLength)
    return [Object.freeze({ id, name: name || `Column ${id}` })]
  })
}

export function parseClassicGitHubProjectCards(
  body: unknown,
  status: string
): ReadonlyArray<IGitHubProjectItem> {
  if (!Array.isArray(body)) {
    throw new Error('GitHub returned an invalid classic Project item response.')
  }
  return body.slice(0, GitHubProjectsItemPageSize).flatMap(candidate => {
    const card = record(candidate)
    const id = finiteNumber(card?.id)
    if (card === null || id === null) {
      return []
    }
    const note = boundedString(card.note, MaximumDescriptionLength)
    const contentURL = safeURL(card.content_url)
    return [
      Object.freeze({
        id: `classic-card-${id}`,
        kind: note.length > 0 ? 'note' : 'unavailable',
        title: note.length > 0 ? note : `Linked item ${id}`,
        url: contentURL,
        state: null,
        repository: null,
        status: boundedString(status, MaximumStatusLength) || null,
        updatedAt: optionalDate(card.updated_at),
      }) as IGitHubProjectItem,
    ]
  })
}

export function sanitizeGitHubProjectsSnapshot(
  value: unknown
): IGitHubProjectsSnapshot | null {
  const snapshot = record(value)
  if (snapshot?.version !== 1) {
    return null
  }
  const endpoint = safeURL(snapshot.endpoint)
  const owner = boundedString(snapshot.owner, MaximumRepositoryLength)
  const repository = boundedString(snapshot.repository, MaximumRepositoryLength)
  const fetchedAt = optionalDate(snapshot.fetchedAt)
  const source = snapshot.source
  if (
    endpoint === null ||
    owner.length === 0 ||
    repository.length === 0 ||
    fetchedAt === null ||
    (source !== 'projects-v2' && source !== 'classic') ||
    !Array.isArray(snapshot.projects)
  ) {
    return null
  }

  const maximumProjects =
    GitHubProjectsProjectPageSize * GitHubProjectsMaximumProjectPages
  let itemCount = 0
  const projects: Array<IGitHubProject> = []
  for (const [index, candidate] of snapshot.projects
    .slice(0, maximumProjects)
    .entries()) {
    const project = record(candidate)
    if (project === null || !Array.isArray(project.items)) {
      continue
    }
    const title = boundedString(project.title, MaximumTitleLength)
    const items: Array<IGitHubProjectItem> = []
    for (const rawItem of project.items) {
      if (itemCount >= GitHubProjectsMaximumItems) {
        break
      }
      const item = record(rawItem)
      if (item === null) {
        continue
      }
      const parsed = parseV2Item(
        {
          id: item.id,
          type:
            item.kind === 'pull-request'
              ? 'PULL_REQUEST'
              : item.kind === 'issue'
              ? 'ISSUE'
              : item.kind === 'draft-issue'
              ? 'DRAFT_ISSUE'
              : item.kind === 'note'
              ? 'NOTE'
              : 'UNAVAILABLE',
          updatedAt: item.updatedAt,
          fieldValueByName: { name: item.status },
          content: {
            title: item.title,
            url: item.url,
            state: item.state,
            repository: { nameWithOwner: item.repository },
          },
        },
        itemCount
      )
      items.push(parsed)
      itemCount++
    }
    const views = Array.isArray(project.views)
      ? parseV2Views({ nodes: project.views })
      : []
    projects.push(
      Object.freeze({
        id: identifier(project.id, `project-${index}`),
        number: finiteNumber(project.number),
        title: title || `Project ${index + 1}`,
        description: boundedString(
          project.description,
          MaximumDescriptionLength
        ),
        url: safeURL(project.url),
        state: project.state === 'closed' ? 'closed' : 'open',
        updatedAt: optionalDate(project.updatedAt),
        views,
        items,
        partial: project.partial === true,
      })
    )
  }

  const allowedReasons = new Set<GitHubProjectsPartialReason>([
    'projects-capped',
    'items-capped',
    'views-capped',
    'classic-fallback',
  ])
  const partialReasons = Array.isArray(snapshot.partialReasons)
    ? snapshot.partialReasons
        .filter(
          (reason): reason is GitHubProjectsPartialReason =>
            typeof reason === 'string' &&
            allowedReasons.has(reason as GitHubProjectsPartialReason)
        )
        .slice(0, allowedReasons.size)
    : []

  return Object.freeze({
    version: 1,
    endpoint,
    owner,
    repository,
    source,
    fetchedAt,
    projects: Object.freeze(projects),
    partialReasons: Object.freeze([...new Set(partialReasons)]),
  })
}
