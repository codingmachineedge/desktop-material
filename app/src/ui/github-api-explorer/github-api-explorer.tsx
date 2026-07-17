import * as React from 'react'

import { API } from '../../lib/api'
import { getAccountForRepository } from '../../lib/get-account-for-repository'
import {
  filterGitHubAPIOperations,
  getGitHubAPIOperationPath,
  GitHubAPICatalogCategories,
  GitHubAPICatalogVersion,
  GitHubAPIOperations,
  IGitHubAPIOperation,
  isNewGitHubAPIOperation,
} from '../../lib/github-api-operation-catalog'
import {
  assessGitHubAPIWorkbenchRequest,
  formatGitHubAPIWorkbenchPreview,
  GitHubAPIWorkbenchMethod,
  GitHubAPIWorkbenchRequest,
  IGitHubAPIWorkbenchAssessment,
  IGitHubAPIWorkbenchResponse,
  redactGitHubAPIWorkbenchValue,
  validateGitHubAPIWorkbenchRequest,
} from '../../lib/github-api-workbench'
import { Account, getAccountKey } from '../../models/account'
import { Repository } from '../../models/repository'
import { Button } from '../lib/button'
import {
  createNamedAPIFunctionBinding,
  functionBelongsToBinding,
  INamedAPIFunctionDefinition,
  INamedAPIFunctionDraft,
  prepareNamedAPIFunctionInvocation,
} from '../../lib/named-api-functions'

export const GitHubAPIExplorerDefaultOperationId =
  'secret-scanning/list-repo-custom-patterns'
export const GitHubAPIExplorerVisibleOperationCap = 60
export const GitHubAPIExplorerResponseCharacterCap = 128 * 1024

const GitHubAPIExplorerHeaderValueCap = 1024
const restMethods: ReadonlyArray<GitHubAPIWorkbenchMethod> = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]
const visibleResponseHeaders = new Set([
  'content-type',
  'deprecation',
  'link',
  'location',
  'retry-after',
  'sunset',
  'x-accepted-github-permissions',
  'x-accepted-oauth-scopes',
  'x-github-api-version-selected',
  'x-github-enterprise-version',
  'x-github-request-id',
  'x-oauth-scopes',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-resource',
  'x-ratelimit-used',
])

type GitHubAPIExplorerMode = 'rest' | 'graphql'

export interface IGitHubAPIExplorerClient {
  readonly execute: (
    account: Account,
    request: GitHubAPIWorkbenchRequest,
    confirmed: boolean,
    signal: AbortSignal
  ) => Promise<IGitHubAPIWorkbenchResponse>
}

export interface IGitHubAPIExplorerProps {
  readonly repository: Repository
  readonly accounts: ReadonlyArray<Account>
  readonly client?: IGitHubAPIExplorerClient
  readonly functionRegistry?: IGitHubAPIFunctionRegistry
}

export interface IGitHubAPIFunctionRegistry {
  readonly getNamedAPIFunctions: () =>
    | ReadonlyArray<INamedAPIFunctionDefinition>
    | Promise<ReadonlyArray<INamedAPIFunctionDefinition>>
  readonly saveNamedAPIFunction: (
    draft: INamedAPIFunctionDraft
  ) => INamedAPIFunctionDefinition | Promise<INamedAPIFunctionDefinition>
  readonly removeNamedAPIFunction: (id: string) => boolean | Promise<boolean>
  readonly onNamedAPIFunctionsChanged?: (
    listener: (functions: ReadonlyArray<INamedAPIFunctionDefinition>) => void
  ) => { readonly dispose: () => void } | null
}

interface IGitHubAPIExplorerReview {
  readonly request: GitHubAPIWorkbenchRequest
  readonly assessment: IGitHubAPIWorkbenchAssessment
  readonly preview: string
}

interface IGitHubAPIExplorerState {
  readonly mode: GitHubAPIExplorerMode
  readonly catalogQuery: string
  readonly catalogCategory: string
  readonly newOnly: boolean
  readonly selectedOperationId: string | null
  readonly restMethod: GitHubAPIWorkbenchMethod
  readonly restPath: string
  readonly restBody: string
  readonly graphQLQuery: string
  readonly graphQLVariables: string
  readonly graphQLOperationName: string
  readonly loading: boolean
  readonly review: IGitHubAPIExplorerReview | null
  readonly response: IGitHubAPIWorkbenchResponse | null
  readonly error: string | null
  readonly message: string | null
  readonly namedFunctions: ReadonlyArray<INamedAPIFunctionDefinition>
  readonly functionName: string
  readonly functionDescription: string
  readonly editingFunctionId: string | null
  readonly functionArguments: Readonly<Record<string, string>>
  readonly functionError: string | null
  readonly functionMessage: string | null
}

const defaultOperation = GitHubAPIOperations.find(
  operation => operation.id === GitHubAPIExplorerDefaultOperationId
)

const defaultClient: IGitHubAPIExplorerClient = {
  execute: (account, request, confirmed, signal) =>
    API.fromAccount(account).executeGitHubAPIWorkbench(
      request,
      confirmed,
      signal
    ),
}

function getExplorerAccount(
  repository: Repository,
  accounts: ReadonlyArray<Account>
): Account | null {
  const remote = repository.gitHubRepository
  const account = getAccountForRepository(accounts, repository)
  return remote !== null &&
    account?.provider === 'github' &&
    account.endpoint === remote.endpoint
    ? account
    : null
}

function repositoryContextKey(props: IGitHubAPIExplorerProps): string {
  const remote = props.repository.gitHubRepository
  const account = getExplorerAccount(props.repository, props.accounts)
  return `${props.repository.hash}:${
    remote === null ? 'local' : remote.fullName
  }:${account === null ? 'signed-out' : getAccountKey(account)}`
}

function operationPath(
  operation: IGitHubAPIOperation,
  repository: Repository
): string {
  const remote = repository.gitHubRepository
  return remote === null
    ? operation.path.replace(/^\/+/, '')
    : getGitHubAPIOperationPath(operation, remote)
}

function graphQLDefaults(repository: Repository): {
  readonly query: string
  readonly variables: string
  readonly operationName: string
} {
  const remote = repository.gitHubRepository
  return {
    query: `query RepositoryOverview($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    id
    nameWithOwner
  }
}`,
    variables: JSON.stringify(
      {
        owner: remote?.owner.login ?? '',
        name: remote?.name ?? '',
      },
      null,
      2
    ),
    operationName: 'RepositoryOverview',
  }
}

function initialState(props: IGitHubAPIExplorerProps): IGitHubAPIExplorerState {
  const graphQL = graphQLDefaults(props.repository)
  return {
    mode: 'rest',
    catalogQuery: '',
    catalogCategory: '',
    newOnly: true,
    selectedOperationId: defaultOperation?.id ?? null,
    restMethod: defaultOperation?.method ?? 'GET',
    restPath:
      defaultOperation === undefined
        ? ''
        : operationPath(defaultOperation, props.repository),
    restBody: '',
    graphQLQuery: graphQL.query,
    graphQLVariables: graphQL.variables,
    graphQLOperationName: graphQL.operationName,
    loading: false,
    review: null,
    response: null,
    error: null,
    message: null,
    namedFunctions: [],
    functionName: '',
    functionDescription: '',
    editingFunctionId: null,
    functionArguments: {},
    functionError: null,
    functionMessage: null,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'GitHub API Explorer could not complete this request safely.'
}

function safeHeaderEntries(
  headers: Readonly<Record<string, string>>
): ReadonlyArray<readonly [string, string]> {
  const entries = new Array<readonly [string, string]>()
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLocaleLowerCase()
    if (!visibleResponseHeaders.has(name)) {
      continue
    }
    const redacted = redactGitHubAPIWorkbenchValue(rawValue)
    const value =
      typeof redacted === 'string' ? redacted : String(redacted ?? '')
    entries.push([name, value.slice(0, GitHubAPIExplorerHeaderValueCap)])
  }
  return entries
}

function safeResponseBody(response: IGitHubAPIWorkbenchResponse): {
  readonly text: string
  readonly truncated: boolean
} {
  const redacted = redactGitHubAPIWorkbenchValue(response.body)
  let text: string
  if (typeof redacted === 'string') {
    text = redacted
  } else if (redacted === undefined) {
    text = ''
  } else {
    try {
      text = JSON.stringify(redacted, null, 2) ?? ''
    } catch {
      text = '[Response body could not be displayed safely.]'
    }
  }
  const truncated = text.length > GitHubAPIExplorerResponseCharacterCap
  return {
    text:
      text.length === 0
        ? '(empty response body)'
        : text.slice(0, GitHubAPIExplorerResponseCharacterCap),
    truncated,
  }
}

export class GitHubAPIExplorer extends React.Component<
  IGitHubAPIExplorerProps,
  IGitHubAPIExplorerState
> {
  private mounted = false
  private generation = 0
  private functionLoadGeneration = 0
  private executionController: AbortController | null = null
  private functionRegistrySubscription: {
    readonly dispose: () => void
  } | null = null
  private readonly clearReviewState = {
    review: null,
    error: null,
    message: null,
  } as const

  public constructor(props: IGitHubAPIExplorerProps) {
    super(props)
    this.state = initialState(props)
  }

  public componentDidMount() {
    this.mounted = true
    this.subscribeToNamedFunctions()
    void this.loadNamedFunctions()
  }

  public componentDidUpdate(prevProps: IGitHubAPIExplorerProps) {
    if (prevProps.functionRegistry !== this.props.functionRegistry) {
      this.functionRegistrySubscription?.dispose()
      this.functionRegistrySubscription = null
      this.subscribeToNamedFunctions()
    }
    if (
      repositoryContextKey(prevProps) !== repositoryContextKey(this.props) ||
      prevProps.accounts !== this.props.accounts ||
      prevProps.client !== this.props.client ||
      prevProps.functionRegistry !== this.props.functionRegistry
    ) {
      this.invalidateExecution()
      this.setState(
        initialState(this.props),
        () => void this.loadNamedFunctions()
      )
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    this.functionLoadGeneration++
    this.functionRegistrySubscription?.dispose()
    this.functionRegistrySubscription = null
    this.invalidateExecution()
  }

  private invalidateExecution() {
    this.generation++
    this.executionController?.abort()
    this.executionController = null
  }

  private isCurrent(controller: AbortController, generation: number) {
    return (
      this.mounted &&
      this.executionController === controller &&
      this.generation === generation
    )
  }

  private getRequest(): GitHubAPIWorkbenchRequest {
    return this.state.mode === 'rest'
      ? {
          mode: 'rest',
          method: this.state.restMethod,
          path: this.state.restPath,
          bodyText: this.state.restBody,
        }
      : {
          mode: 'graphql',
          query: this.state.graphQLQuery,
          variablesText: this.state.graphQLVariables,
          operationName: this.state.graphQLOperationName,
        }
  }

  private async loadNamedFunctions() {
    const registry = this.props.functionRegistry
    const generation = ++this.functionLoadGeneration
    if (registry === undefined) {
      if (this.mounted) {
        this.setState({ namedFunctions: [] })
      }
      return
    }
    const context = repositoryContextKey(this.props)
    try {
      const functions = await registry.getNamedAPIFunctions()
      if (
        this.mounted &&
        this.props.functionRegistry === registry &&
        this.functionLoadGeneration === generation &&
        repositoryContextKey(this.props) === context
      ) {
        this.setState({ namedFunctions: functions, functionError: null })
      }
    } catch (error) {
      if (
        this.mounted &&
        this.props.functionRegistry === registry &&
        this.functionLoadGeneration === generation &&
        repositoryContextKey(this.props) === context
      ) {
        this.setState({ functionError: errorMessage(error) })
      }
    }
  }

  private subscribeToNamedFunctions() {
    const registry = this.props.functionRegistry
    if (registry?.onNamedAPIFunctionsChanged === undefined) {
      return
    }
    this.functionRegistrySubscription = registry.onNamedAPIFunctionsChanged(
      functions => {
        if (this.mounted && this.props.functionRegistry === registry) {
          this.setState({
            namedFunctions: functions,
            functionError: null,
          })
        }
      }
    )
  }

  private onRunRequest = (event: React.FormEvent) => {
    event.preventDefault()
    const request = this.getRequest()
    try {
      validateGitHubAPIWorkbenchRequest(request)
      const assessment = assessGitHubAPIWorkbenchRequest(request)
      if (assessment.requiresConfirmation) {
        this.setState({
          review: {
            request,
            assessment,
            preview: formatGitHubAPIWorkbenchPreview(request),
          },
          error: null,
          message: null,
        })
        return
      }
      void this.execute(request, false)
    } catch (error) {
      this.setState({
        review: null,
        response: null,
        error: errorMessage(error),
        message: null,
      })
    }
  }

  private onRunReviewedRequest = () => {
    const review = this.state.review
    if (review === null) {
      return
    }
    this.setState(
      { review: null },
      () => void this.execute(review.request, true)
    )
  }

  private execute = async (
    request: GitHubAPIWorkbenchRequest,
    confirmed: boolean
  ) => {
    const account = getExplorerAccount(
      this.props.repository,
      this.props.accounts
    )
    if (account === null) {
      this.setState({
        loading: false,
        error: 'Sign in to the GitHub account selected for this repository.',
      })
      return
    }

    this.executionController?.abort()
    const controller = new AbortController()
    const generation = ++this.generation
    this.executionController = controller
    this.setState({
      loading: true,
      response: null,
      error: null,
      message: null,
    })

    try {
      const response = await (this.props.client ?? defaultClient).execute(
        account,
        request,
        confirmed,
        controller.signal
      )
      if (!this.isCurrent(controller, generation)) {
        return
      }
      this.executionController = null
      this.setState({
        loading: false,
        response,
        error: null,
        message: 'GitHub API request completed.',
      })
    } catch (error) {
      if (!this.isCurrent(controller, generation)) {
        return
      }
      this.executionController = null
      this.setState({
        loading: false,
        response: null,
        error:
          controller.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
            ? null
            : errorMessage(error),
        message: controller.signal.aborted ? 'Request canceled.' : null,
      })
    }
  }

  private onCancelRequest = () => {
    if (this.executionController === null) {
      return
    }
    this.invalidateExecution()
    this.setState({
      loading: false,
      error: null,
      message: 'Request canceled.',
    })
  }

  private onSelectOperation = (operation: IGitHubAPIOperation) => {
    this.setState({
      mode: 'rest',
      selectedOperationId: operation.id,
      restMethod: operation.method,
      restPath: operationPath(operation, this.props.repository),
      restBody: '',
      response: null,
      ...this.clearReviewState,
    })
  }

  private onCatalogQueryChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({ catalogQuery: event.currentTarget.value })
  }

  private onCatalogCategoryChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    this.setState({ catalogCategory: event.currentTarget.value })
  }

  private onCatalogScopeChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    this.setState({ newOnly: event.currentTarget.value === 'new' })
  }

  private onOperationClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const operationId = event.currentTarget.dataset.operationId
    const operation = GitHubAPIOperations.find(
      candidate => candidate.id === operationId
    )
    if (operation !== undefined) {
      this.onSelectOperation(operation)
    }
  }

  private onRESTMethodChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    this.setState({
      restMethod: event.currentTarget.value as GitHubAPIWorkbenchMethod,
      ...this.clearReviewState,
    })
  }

  private onRESTPathChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({
      restPath: event.currentTarget.value,
      ...this.clearReviewState,
    })
  }

  private onRESTBodyChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    this.setState({
      restBody: event.currentTarget.value,
      ...this.clearReviewState,
    })
  }

  private onGraphQLQueryChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    this.setState({
      graphQLQuery: event.currentTarget.value,
      ...this.clearReviewState,
    })
  }

  private onGraphQLVariablesChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    this.setState({
      graphQLVariables: event.currentTarget.value,
      ...this.clearReviewState,
    })
  }

  private onGraphQLOperationNameChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({
      graphQLOperationName: event.currentTarget.value,
      ...this.clearReviewState,
    })
  }

  private onCancelReview = () => {
    this.setState({ review: null, message: 'Mutation canceled.' })
  }

  private onSelectRESTMode = () => {
    this.setState({ mode: 'rest', ...this.clearReviewState })
  }

  private onSelectGraphQLMode = () => {
    this.setState({ mode: 'graphql', ...this.clearReviewState })
  }

  private onFunctionNameChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({ functionName: event.currentTarget.value })
  }

  private onFunctionDescriptionChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    this.setState({ functionDescription: event.currentTarget.value })
  }

  private currentFunctionBinding(account: Account) {
    return createNamedAPIFunctionBinding(this.props.repository, account)
  }

  private currentOperationId(): string {
    if (this.state.mode === 'rest') {
      if (this.state.selectedOperationId === null) {
        throw new Error('Choose a REST catalog operation first.')
      }
      return this.state.selectedOperationId
    }
    const name = this.state.graphQLOperationName.trim()
    if (name.length === 0) {
      throw new Error('Name the GraphQL operation first.')
    }
    return `graphql:${name}`
  }

  private onSaveNamedFunction = async (event: React.FormEvent) => {
    event.preventDefault()
    const registry = this.props.functionRegistry
    const account = getExplorerAccount(
      this.props.repository,
      this.props.accounts
    )
    if (registry === undefined || account === null) {
      this.setState({
        functionError: 'Named app functions are unavailable in this window.',
        functionMessage: null,
      })
      return
    }
    try {
      const saved = await registry.saveNamedAPIFunction({
        ...(this.state.editingFunctionId === null
          ? {}
          : { id: this.state.editingFunctionId }),
        name: this.state.functionName,
        description: this.state.functionDescription,
        operationId: this.currentOperationId(),
        binding: this.currentFunctionBinding(account),
        request: this.getRequest(),
      })
      if (!this.mounted) {
        return
      }
      this.setState({
        namedFunctions: [
          ...this.state.namedFunctions.filter(value => value.id !== saved.id),
          saved,
        ],
        functionName: '',
        functionDescription: '',
        editingFunctionId: null,
        functionError: null,
        functionMessage: `Function '${saved.name}' is available to the app and agent catalog.`,
      })
    } catch (error) {
      if (this.mounted) {
        this.setState({
          functionError: errorMessage(error),
          functionMessage: null,
        })
      }
    }
  }

  private onEditNamedFunction = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const id = event.currentTarget.dataset.functionId
    const definition = this.state.namedFunctions.find(value => value.id === id)
    if (definition === undefined) {
      return
    }
    this.setState({
      functionName: definition.name,
      functionDescription: definition.description,
      editingFunctionId: definition.id,
      functionError: null,
      functionMessage:
        'Editing metadata. Saving replaces its template with the current request.',
    })
  }

  private onCancelFunctionEdit = () => {
    this.setState({
      functionName: '',
      functionDescription: '',
      editingFunctionId: null,
      functionError: null,
      functionMessage: null,
    })
  }

  private onRemoveNamedFunction = async (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const id = event.currentTarget.dataset.functionId
    const registry = this.props.functionRegistry
    if (id === undefined || registry === undefined) {
      return
    }
    try {
      const removed = await registry.removeNamedAPIFunction(id)
      if (this.mounted && removed) {
        const definition = this.state.namedFunctions.find(
          value => value.id === id
        )
        this.setState({
          namedFunctions: this.state.namedFunctions.filter(
            value => value.id !== id
          ),
          editingFunctionId:
            this.state.editingFunctionId === id
              ? null
              : this.state.editingFunctionId,
          functionError: null,
          functionMessage:
            definition === undefined
              ? 'Function removed.'
              : `Function '${definition.name}' removed from the catalog.`,
        })
      }
    } catch (error) {
      if (this.mounted) {
        this.setState({
          functionError: errorMessage(error),
          functionMessage: null,
        })
      }
    }
  }

  private onFunctionArgumentsChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    const id = event.currentTarget.dataset.functionId
    if (id === undefined) {
      return
    }
    this.setState({
      functionArguments: {
        ...this.state.functionArguments,
        [id]: event.currentTarget.value,
      },
    })
  }

  private onRunNamedFunction = (event: React.MouseEvent<HTMLButtonElement>) => {
    const id = event.currentTarget.dataset.functionId
    const definition = this.state.namedFunctions.find(value => value.id === id)
    const account = getExplorerAccount(
      this.props.repository,
      this.props.accounts
    )
    if (definition === undefined || account === null) {
      return
    }
    try {
      const binding = this.currentFunctionBinding(account)
      if (!functionBelongsToBinding(definition, binding)) {
        throw new Error(
          'This function belongs to another repository or account.'
        )
      }
      const text = this.state.functionArguments[definition.id] ?? '{}'
      if (text.length > 64 * 1024) {
        throw new Error('Function arguments are limited to 64 KiB.')
      }
      const invocation = prepareNamedAPIFunctionInvocation(
        definition,
        JSON.parse(text)
      )
      if (invocation.requiresConfirmation) {
        this.setState({
          review: {
            request: invocation.request,
            assessment: assessGitHubAPIWorkbenchRequest(invocation.request),
            preview: formatGitHubAPIWorkbenchPreview(invocation.request),
          },
          functionError: null,
          functionMessage: `Review function '${definition.name}' before it runs.`,
        })
      } else {
        this.setState({
          functionError: null,
          functionMessage: `Running function '${definition.name}'.`,
        })
        void this.execute(invocation.request, false)
      }
    } catch (error) {
      this.setState({
        functionError: errorMessage(error),
        functionMessage: null,
      })
    }
  }

  private renderUnavailable() {
    return (
      <section className="github-api-explorer-state" role="status">
        <h2>GitHub repository required</h2>
        <p>
          Choose a repository with a GitHub remote to explore its GitHub API.
        </p>
      </section>
    )
  }

  private renderSignedOut() {
    const endpoint = this.props.repository.gitHubRepository?.endpoint
    return (
      <section className="github-api-explorer-state" role="status">
        <h2>Sign in required</h2>
        <p>
          Sign in to the GitHub account selected for this repository
          {endpoint === undefined ? '.' : ` on ${endpoint}.`}
        </p>
        <p>
          API Explorer never falls back to another account on the same host.
        </p>
      </section>
    )
  }

  private renderCatalog() {
    const filtered = filterGitHubAPIOperations({
      query: this.state.catalogQuery,
      category: this.state.catalogCategory,
      newOnly: this.state.newOnly,
    })
    const visible = filtered.slice(0, GitHubAPIExplorerVisibleOperationCap)
    return (
      <aside
        className="github-api-explorer-catalog"
        aria-labelledby="github-api-explorer-catalog-heading"
      >
        <header>
          <div>
            <h2 id="github-api-explorer-catalog-heading">Operation catalog</h2>
            <p>GitHub REST API {GitHubAPICatalogVersion}</p>
          </div>
          <span aria-live="polite">
            {visible.length} of {filtered.length} shown
          </span>
        </header>
        <div className="github-api-explorer-filters">
          <label>
            Search operations
            <input
              type="search"
              value={this.state.catalogQuery}
              disabled={this.state.loading}
              onChange={this.onCatalogQueryChange}
              placeholder="Method, path, summary, or ID"
            />
          </label>
          <label>
            Category
            <select
              value={this.state.catalogCategory}
              disabled={this.state.loading}
              onChange={this.onCatalogCategoryChange}
            >
              <option value="">All categories</option>
              {GitHubAPICatalogCategories.map(category => (
                <option key={category.name} value={category.name}>
                  {category.name} ({category.count})
                </option>
              ))}
            </select>
          </label>
          <label>
            Catalog scope
            <select
              value={this.state.newOnly ? 'new' : 'all'}
              disabled={this.state.loading}
              onChange={this.onCatalogScopeChange}
            >
              <option value="new">New operations</option>
              <option value="all">All operations</option>
            </select>
          </label>
        </div>
        {visible.length === 0 ? (
          <div className="github-api-explorer-empty" role="status">
            <strong>No operations match these filters.</strong>
            <span>Try another search, category, or catalog scope.</span>
          </div>
        ) : (
          <ul
            className="github-api-explorer-operation-list"
            aria-label="GitHub API operations"
          >
            {visible.map(operation => (
              <li key={operation.id}>
                <button
                  type="button"
                  className={
                    this.state.selectedOperationId === operation.id
                      ? 'selected'
                      : undefined
                  }
                  aria-pressed={this.state.selectedOperationId === operation.id}
                  aria-label={`${operation.method} ${operation.summary}, ${operation.path}`}
                  disabled={this.state.loading}
                  data-operation-id={operation.id}
                  onClick={this.onOperationClick}
                >
                  <span className="github-api-explorer-operation-heading">
                    <strong>{operation.method}</strong>
                    <span>{operation.summary}</span>
                    {isNewGitHubAPIOperation(operation.id) ? (
                      <em>New</em>
                    ) : null}
                  </span>
                  <code>{operation.path}</code>
                  <small>{operation.id}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {filtered.length > visible.length ? (
          <p className="github-api-explorer-capped" role="status">
            Refine the filters to inspect the remaining{' '}
            {filtered.length - visible.length} operations.
          </p>
        ) : null}
      </aside>
    )
  }

  private renderOperationSummary() {
    const operation = GitHubAPIOperations.find(
      value => value.id === this.state.selectedOperationId
    )
    if (operation === undefined) {
      return null
    }
    return (
      <section className="github-api-explorer-operation-summary">
        <div>
          <strong>{operation.summary}</strong>
          <code>{operation.id}</code>
        </div>
        <div className="github-api-explorer-operation-flags">
          <span>{operation.category}</span>
          {operation.cloudOnly ? <span>GitHub.com only</span> : null}
          {operation.deprecated ? <span>Deprecated</span> : null}
          {operation.requestBodyRequired ? <span>Body required</span> : null}
        </div>
      </section>
    )
  }

  private renderRESTForm() {
    return (
      <div
        id="github-api-explorer-rest-panel"
        className="github-api-explorer-form"
        role="tabpanel"
        aria-labelledby="github-api-explorer-rest-tab"
      >
        {this.renderOperationSummary()}
        <div className="github-api-explorer-rest-target">
          <label>
            REST method
            <select
              value={this.state.restMethod}
              disabled={this.state.loading}
              onChange={this.onRESTMethodChange}
            >
              {restMethods.map(method => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>
          <label>
            REST API path
            <input
              value={this.state.restPath}
              disabled={this.state.loading}
              spellCheck={false}
              onChange={this.onRESTPathChange}
            />
          </label>
        </div>
        <label>
          REST JSON body (optional)
          <textarea
            value={this.state.restBody}
            disabled={this.state.loading}
            spellCheck={false}
            onChange={this.onRESTBodyChange}
            placeholder={'{\n  "key": "value"\n}'}
          />
        </label>
      </div>
    )
  }

  private renderGraphQLForm() {
    return (
      <div
        id="github-api-explorer-graphql-panel"
        className="github-api-explorer-form"
        role="tabpanel"
        aria-labelledby="github-api-explorer-graphql-tab"
      >
        <label>
          GraphQL query
          <textarea
            className="github-api-explorer-query"
            value={this.state.graphQLQuery}
            disabled={this.state.loading}
            spellCheck={false}
            onChange={this.onGraphQLQueryChange}
          />
        </label>
        <div className="github-api-explorer-graphql-options">
          <label>
            GraphQL variables
            <textarea
              value={this.state.graphQLVariables}
              disabled={this.state.loading}
              spellCheck={false}
              onChange={this.onGraphQLVariablesChange}
            />
          </label>
          <label>
            GraphQL operation name (optional)
            <input
              value={this.state.graphQLOperationName}
              disabled={this.state.loading}
              spellCheck={false}
              onChange={this.onGraphQLOperationNameChange}
            />
          </label>
        </div>
      </div>
    )
  }

  private renderNamedFunctions(account: Account) {
    const binding = this.currentFunctionBinding(account)
    const functions = this.state.namedFunctions.filter(value =>
      functionBelongsToBinding(value, binding)
    )
    const registryAvailable = this.props.functionRegistry !== undefined
    return (
      <section
        className="github-api-functions"
        aria-labelledby="github-api-functions-heading"
      >
        <header>
          <div>
            <h2 id="github-api-functions-heading">App functions</h2>
            <p>
              Extend the app and local agent with validated, repository-bound
              API operations. Credentials stay in the selected account.
            </p>
          </div>
          <span>{functions.length} for this repository</span>
        </header>
        <form
          className="github-api-function-editor"
          onSubmit={this.onSaveNamedFunction}
        >
          <label>
            Function name
            <input
              value={this.state.functionName}
              disabled={!registryAvailable || this.state.loading}
              maxLength={64}
              pattern="[a-z][a-z0-9_-]{0,63}"
              placeholder="list_custom_patterns"
              onChange={this.onFunctionNameChange}
            />
          </label>
          <label>
            Function description
            <input
              value={this.state.functionDescription}
              disabled={!registryAvailable || this.state.loading}
              maxLength={500}
              placeholder="Describe what this function returns or changes"
              onChange={this.onFunctionDescriptionChange}
            />
          </label>
          <div className="github-api-explorer-actions">
            <Button
              type="submit"
              className="primary"
              disabled={!registryAvailable || this.state.loading}
            >
              {this.state.editingFunctionId === null
                ? 'Add current request as function'
                : 'Update function from current request'}
            </Button>
            {this.state.editingFunctionId === null ? null : (
              <Button onClick={this.onCancelFunctionEdit}>Cancel edit</Button>
            )}
          </div>
        </form>
        {!registryAvailable ? (
          <p className="github-api-functions-unavailable" role="status">
            The app function registry is unavailable in this window.
          </p>
        ) : functions.length === 0 ? (
          <p className="github-api-functions-unavailable" role="status">
            No functions yet. Choose a catalog operation or validated GraphQL
            template, then add the current request.
          </p>
        ) : (
          <ul aria-label="Named API functions">
            {functions.map(definition => (
              <li key={definition.id}>
                <header>
                  <div>
                    <strong>{definition.name}</strong>
                    <code>{definition.operationId}</code>
                  </div>
                  <span className={definition.risk}>{definition.risk}</span>
                </header>
                <p>{definition.description}</p>
                <details>
                  <summary>Parameters</summary>
                  <pre>
                    {JSON.stringify(definition.parameterSchema, null, 2)}
                  </pre>
                </details>
                <label>
                  Arguments for {definition.name}
                  <textarea
                    value={this.state.functionArguments[definition.id] ?? '{}'}
                    disabled={this.state.loading}
                    spellCheck={false}
                    data-function-id={definition.id}
                    onChange={this.onFunctionArgumentsChange}
                  />
                </label>
                <div className="github-api-function-actions">
                  <button
                    type="button"
                    disabled={this.state.loading}
                    data-function-id={definition.id}
                    onClick={this.onRunNamedFunction}
                  >
                    {definition.risk === 'read'
                      ? 'Run function'
                      : 'Review function'}
                  </button>
                  <button
                    type="button"
                    disabled={this.state.loading}
                    data-function-id={definition.id}
                    onClick={this.onEditNamedFunction}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={this.state.loading}
                    data-function-id={definition.id}
                    onClick={this.onRemoveNamedFunction}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {this.state.functionError === null ? null : (
          <div className="github-api-explorer-error" role="alert">
            {this.state.functionError}
          </div>
        )}
        {this.state.functionMessage === null ? null : (
          <div className="github-api-explorer-message" role="status">
            {this.state.functionMessage}
          </div>
        )}
      </section>
    )
  }

  private renderReview(account: Account) {
    const review = this.state.review
    if (review === null) {
      return null
    }
    return (
      <section
        className={`github-api-explorer-review ${review.assessment.risk}`}
        aria-labelledby="github-api-explorer-review-heading"
      >
        <h2 id="github-api-explorer-review-heading">
          Review GitHub API mutation
        </h2>
        <p>{review.assessment.reason}</p>
        <code>{review.preview}</code>
        <p>
          Review the request fields above. This exact request will run as @
          {account.login} only after confirmation.
        </p>
        <div className="github-api-explorer-actions">
          <Button className="primary" onClick={this.onRunReviewedRequest}>
            Run reviewed request
          </Button>
          <Button onClick={this.onCancelReview}>Cancel review</Button>
        </div>
      </section>
    )
  }

  private renderResponse() {
    const response = this.state.response
    if (response === null) {
      return null
    }
    const headers = safeHeaderEntries(response.headers)
    const body = safeResponseBody(response)
    const truncated = response.truncated || body.truncated
    return (
      <section
        className="github-api-explorer-response"
        aria-labelledby="github-api-explorer-response-heading"
      >
        <header>
          <h2 id="github-api-explorer-response-heading">Response</h2>
          <strong>
            {response.status}{' '}
            {response.statusText.slice(0, 160) || 'Unknown status'}
          </strong>
        </header>
        <p>
          {response.displayedBytes.toLocaleString()} response bytes displayed
          {truncated ? ' · output truncated' : ''}
        </p>
        {headers.length > 0 ? (
          <dl aria-label="GitHub API response headers">
            {headers.map(([name, value]) => (
              <React.Fragment key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        ) : (
          <p>No allowlisted diagnostic headers were returned.</p>
        )}
        <pre role="region" aria-label="GitHub API response body">
          {body.text}
        </pre>
      </section>
    )
  }

  private renderWorkspace(account: Account) {
    return (
      <div className="github-api-explorer-layout">
        {this.renderCatalog()}
        <section
          className="github-api-explorer-builder"
          aria-labelledby="github-api-explorer-builder-heading"
        >
          <header>
            <div>
              <h2 id="github-api-explorer-builder-heading">Request builder</h2>
              <p>
                Relative requests stay on {account.friendlyEndpoint} as @
                {account.login}.
              </p>
            </div>
            <div
              className="github-api-explorer-tabs"
              role="tablist"
              aria-label="GitHub API request type"
            >
              <button
                id="github-api-explorer-rest-tab"
                type="button"
                role="tab"
                aria-selected={this.state.mode === 'rest'}
                aria-controls="github-api-explorer-rest-panel"
                disabled={this.state.loading}
                onClick={this.onSelectRESTMode}
              >
                REST
              </button>
              <button
                id="github-api-explorer-graphql-tab"
                type="button"
                role="tab"
                aria-selected={this.state.mode === 'graphql'}
                aria-controls="github-api-explorer-graphql-panel"
                disabled={this.state.loading}
                onClick={this.onSelectGraphQLMode}
              >
                GraphQL
              </button>
            </div>
          </header>
          <form onSubmit={this.onRunRequest}>
            {this.state.mode === 'rest'
              ? this.renderRESTForm()
              : this.renderGraphQLForm()}
            <div className="github-api-explorer-actions">
              <Button
                type="submit"
                className="primary"
                disabled={this.state.loading}
              >
                Run request
              </Button>
              {this.state.loading ? (
                <Button onClick={this.onCancelRequest}>Cancel request</Button>
              ) : null}
            </div>
          </form>
          {this.renderNamedFunctions(account)}
          {this.renderReview(account)}
          {this.state.loading ? (
            <div className="github-api-explorer-loading" role="status">
              Running request…
            </div>
          ) : null}
          {this.state.error === null ? null : (
            <div className="github-api-explorer-error" role="alert">
              {this.state.error}
            </div>
          )}
          {this.state.message === null ? null : (
            <div className="github-api-explorer-message" role="status">
              {this.state.message}
            </div>
          )}
          {this.renderResponse()}
        </section>
      </div>
    )
  }

  public render() {
    const remote = this.props.repository.gitHubRepository
    const account = getExplorerAccount(
      this.props.repository,
      this.props.accounts
    )
    return (
      <main className="github-api-explorer" aria-label="GitHub API Explorer">
        <header className="github-api-explorer-header">
          <div>
            <h1>GitHub API Explorer</h1>
            <p>{remote?.fullName ?? this.props.repository.name}</p>
          </div>
          <span className="github-api-explorer-account">
            {account === null
              ? 'No repository-bound GitHub account'
              : `@${account.login} · ${account.friendlyEndpoint}`}
          </span>
        </header>
        {remote === null
          ? this.renderUnavailable()
          : account === null
          ? this.renderSignedOut()
          : this.renderWorkspace(account)}
      </main>
    )
  }
}
