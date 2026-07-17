import assert from 'node:assert'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import * as React from 'react'
import * as semver from 'semver'

import {
  GitHubAPIWorkbenchRequest,
  IGitHubAPIWorkbenchResponse,
} from '../../../src/lib/github-api-workbench'
import { resolveGitHubGraphQLOperationCatalog } from '../../../src/lib/github-graphql-operation-catalog'
import { resolveGitHubAPIOperationCatalog } from '../../../src/lib/github-api-operation-catalog'
import { Account, getAccountKey } from '../../../src/models/account'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import {
  GitHubAPIExplorer,
  GitHubAPIExplorerDefaultPageSize,
  GitHubAPIExplorerResponseCharacterCap,
  IGitHubAPIExplorerClient,
} from '../../../src/ui/github-api-explorer'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'

interface IExplorerCall {
  readonly account: Account
  readonly request: GitHubAPIWorkbenchRequest
  readonly confirmed: boolean
  readonly signal: AbortSignal
}

const successfulResponse: IGitHubAPIWorkbenchResponse = {
  status: 200,
  statusText: 'OK',
  headers: {
    authorization: 'Bearer fixture-secret',
    'set-cookie': 'session=fixture-secret',
    'x-github-request-id': 'fixture-request',
    'x-ratelimit-remaining': '4999',
  },
  body: {
    token: 'fixture-secret',
    payload: 'x'.repeat(GitHubAPIExplorerResponseCharacterCap + 32),
  },
  contentType: 'application/json',
  displayedBytes: GitHubAPIExplorerResponseCharacterCap + 64,
  truncated: false,
}

class FakeExplorerClient implements IGitHubAPIExplorerClient {
  public readonly calls = new Array<IExplorerCall>()

  public constructor(
    private readonly run: (
      call: IExplorerCall
    ) => Promise<IGitHubAPIWorkbenchResponse> = async () => successfulResponse
  ) {}

  public readonly execute = (
    account: Account,
    request: GitHubAPIWorkbenchRequest,
    confirmed: boolean,
    signal: AbortSignal
  ) => {
    const call = { account, request, confirmed, signal }
    this.calls.push(call)
    return this.run(call)
  }
}

function account(
  login: string,
  id: number,
  provider: Account['provider'] = 'github',
  endpoint = 'https://api.github.com'
) {
  return new Account(
    login,
    endpoint,
    `${login}-token`,
    [],
    '',
    id,
    login,
    'free',
    undefined,
    undefined,
    undefined,
    undefined,
    provider
  )
}

function repository(
  selectedAccount: Account,
  owner: string = 'desktop',
  name: string = 'material',
  id: number = 1
) {
  return new Repository(
    resolve('api-explorer-fixtures', `${owner}-${name}`),
    id,
    new GitHubRepository(
      name,
      new Owner(owner, selectedAccount.endpoint, id),
      id
    ),
    false,
    null,
    {},
    false,
    undefined,
    getAccountKey(selectedAccount)
  )
}

const selectedAccount = account('fixture-bot', 42)
const selectedRepository = repository(selectedAccount)

describe('GitHub API Explorer', () => {
  it('starts on the exact ten new operations and prefills repository coordinates', () => {
    render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[selectedAccount]}
        client={new FakeExplorerClient()}
      />
    )

    assert.ok(screen.getByRole('main', { name: 'GitHub API Explorer' }))
    assert.equal(
      (screen.getByLabelText('Catalog scope') as HTMLSelectElement).value,
      'new'
    )
    const list = screen.getByRole('list', {
      name: 'GitHub API operations',
    })
    assert.equal(within(list).getAllByRole('listitem').length, 10)
    assert.equal(
      screen
        .getByRole('button', {
          name: /GET List repository custom patterns/,
        })
        .getAttribute('aria-pressed'),
      'true'
    )
    assert.equal(
      (screen.getByLabelText('REST method') as HTMLSelectElement).value,
      'GET'
    )
    assert.equal(
      (screen.getByLabelText('REST API path') as HTMLInputElement).value,
      'repos/desktop/material/secret-scanning/custom-patterns'
    )
  })

  it('searches and categorizes the bounded all-operation catalog', () => {
    render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[selectedAccount]}
        client={new FakeExplorerClient()}
      />
    )

    fireEvent.change(screen.getByLabelText('Catalog scope'), {
      target: { value: 'all' },
    })
    let list = screen.getByRole('list', { name: 'GitHub API operations' })
    assert.equal(
      within(list).getAllByRole('listitem').length,
      GitHubAPIExplorerDefaultPageSize
    )
    assert.ok(
      screen.getByRole('navigation', { name: 'GitHub API operation pages' })
    )

    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: 'secret-scanning' },
    })
    fireEvent.change(screen.getByLabelText('Search operations'), {
      target: { value: 'custom patterns' },
    })
    list = screen.getByRole('list', { name: 'GitHub API operations' })
    assert.ok(within(list).getAllByRole('listitem').length > 0)

    fireEvent.change(screen.getByLabelText('Search operations'), {
      target: { value: 'no-such-operation-fixture' },
    })
    assert.ok(screen.getByText('No operations match these filters.'))
    assert.equal(
      screen.queryByRole('list', { name: 'GitHub API operations' }),
      null
    )
    assert.equal(
      screen.queryByRole('navigation', {
        name: 'GitHub API operation pages',
      }),
      null
    )
  })

  it('paginates the REST catalog with first, previous, next, and last controls', () => {
    render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[selectedAccount]}
        client={new FakeExplorerClient()}
      />
    )

    fireEvent.change(screen.getByLabelText('Catalog scope'), {
      target: { value: 'all' },
    })

    const nav = screen.getByRole('navigation', {
      name: 'GitHub API operation pages',
    })
    const first = within(nav).getByRole('button', { name: 'First page' })
    const previous = within(nav).getByRole('button', { name: 'Previous page' })
    const next = within(nav).getByRole('button', { name: 'Next page' })
    const last = within(nav).getByRole('button', { name: 'Last page' })

    // First page: backward controls disabled, exact leading range shown.
    assert.equal(first.getAttribute('aria-disabled'), 'true')
    assert.equal(previous.getAttribute('aria-disabled'), 'true')
    assert.equal(next.getAttribute('aria-disabled'), 'false')
    assert.ok(within(nav).getByText('Page 1 of 25'))
    assert.ok(screen.getByText('Showing 1–50 of 1,206'))

    fireEvent.click(next)
    assert.ok(within(nav).getByText('Page 2 of 25'))
    assert.ok(screen.getByText('Showing 51–100 of 1,206'))
    assert.equal(previous.getAttribute('aria-disabled'), 'false')
    assert.equal(
      within(
        screen.getByRole('list', { name: 'GitHub API operations' })
      ).getAllByRole('listitem').length,
      GitHubAPIExplorerDefaultPageSize
    )

    fireEvent.click(last)
    assert.ok(within(nav).getByText('Page 25 of 25'))
    assert.ok(screen.getByText('Showing 1,201–1,206 of 1,206'))
    assert.equal(next.getAttribute('aria-disabled'), 'true')
    assert.equal(last.getAttribute('aria-disabled'), 'true')
    // Final page holds the remainder (1206 - 1200 = 6 operations).
    assert.equal(
      within(
        screen.getByRole('list', { name: 'GitHub API operations' })
      ).getAllByRole('listitem').length,
      6
    )

    fireEvent.click(first)
    assert.ok(within(nav).getByText('Page 1 of 25'))
    assert.ok(screen.getByText('Showing 1–50 of 1,206'))
  })

  it('keeps boundary controls focusable so activating them does not drop focus', () => {
    render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[selectedAccount]}
        client={new FakeExplorerClient()}
      />
    )

    fireEvent.change(screen.getByLabelText('Catalog scope'), {
      target: { value: 'all' },
    })
    const nav = screen.getByRole('navigation', {
      name: 'GitHub API operation pages',
    })
    const last = within(nav).getByRole('button', { name: 'Last page' })

    // Boundary controls use aria-disabled, not the disabled attribute, so a
    // keyboard user who activates "Last page" (which then disables it) keeps
    // focus on the control instead of dropping it to the document body.
    last.focus()
    assert.equal(document.activeElement, last)
    fireEvent.click(last)
    assert.ok(within(nav).getByText('Page 25 of 25'))
    assert.equal(last.getAttribute('aria-disabled'), 'true')
    assert.equal(last.hasAttribute('disabled'), false)
    assert.equal(document.activeElement, last)

    // A stray click on the now-boundary control is a no-op, not an overshoot.
    fireEvent.click(last)
    assert.ok(within(nav).getByText('Page 25 of 25'))
  })

  it('changes the REST page size and resets to the first page', () => {
    render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[selectedAccount]}
        client={new FakeExplorerClient()}
      />
    )

    fireEvent.change(screen.getByLabelText('Catalog scope'), {
      target: { value: 'all' },
    })
    const nav = screen.getByRole('navigation', {
      name: 'GitHub API operation pages',
    })
    fireEvent.click(within(nav).getByRole('button', { name: 'Next page' }))
    assert.ok(within(nav).getByText('Page 2 of 25'))

    fireEvent.change(screen.getByLabelText('Operations per page'), {
      target: { value: '200' },
    })
    assert.ok(within(nav).getByText('Page 1 of 7'))
    assert.ok(screen.getByText('Showing 1–200 of 1,206'))
    assert.equal(
      within(
        screen.getByRole('list', { name: 'GitHub API operations' })
      ).getAllByRole('listitem').length,
      200
    )
  })

  it('jumps directly to a chosen REST page via the page selector', () => {
    render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[selectedAccount]}
        client={new FakeExplorerClient()}
      />
    )

    fireEvent.change(screen.getByLabelText('Catalog scope'), {
      target: { value: 'all' },
    })
    const nav = screen.getByRole('navigation', {
      name: 'GitHub API operation pages',
    })

    // The selector offers exactly one option per page.
    const jump = within(nav).getByLabelText('Go to page') as HTMLSelectElement
    assert.equal(jump.options.length, 25)

    fireEvent.change(jump, { target: { value: '13' } })
    assert.ok(within(nav).getByText('Page 13 of 25'))
    // Page 13 of 50 => items 601–650.
    assert.ok(screen.getByText('Showing 601–650 of 1,206'))
    assert.equal(
      (within(nav).getByLabelText('Go to page') as HTMLSelectElement).value,
      '13'
    )
  })

  it('hides the page selector when a filter leaves a single page', () => {
    render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[selectedAccount]}
        client={new FakeExplorerClient()}
      />
    )

    fireEvent.change(screen.getByLabelText('Search operations'), {
      target: { value: 'secret-scanning/list-repo-custom-patterns' },
    })
    const nav = screen.getByRole('navigation', {
      name: 'GitHub API operation pages',
    })
    assert.ok(within(nav).getByText('Page 1 of 1'))
    assert.equal(within(nav).queryByLabelText('Go to page'), null)
  })

  it('resets to the first page when a filter narrows the REST catalog', () => {
    render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[selectedAccount]}
        client={new FakeExplorerClient()}
      />
    )

    fireEvent.change(screen.getByLabelText('Catalog scope'), {
      target: { value: 'all' },
    })
    const nav = screen.getByRole('navigation', {
      name: 'GitHub API operation pages',
    })
    fireEvent.click(within(nav).getByRole('button', { name: 'Last page' }))
    assert.ok(within(nav).getByText('Page 25 of 25'))

    // Changing any filter returns to page 1, so the view can never be left on a
    // page beyond the narrowed result set. (The pure page-clamp guard for stale
    // requests is covered directly in catalog-pagination-test.ts.)
    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: 'secret-scanning' },
    })
    assert.ok(within(nav).getByText('Page 1 of 1'))
    assert.ok(
      within(
        screen.getByRole('list', { name: 'GitHub API operations' })
      ).getAllByRole('listitem').length > 0
    )
  })

  it('paginates the GraphQL root catalog independently of REST', () => {
    render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[selectedAccount]}
        client={new FakeExplorerClient()}
      />
    )

    // Advance the REST catalog to a non-first page first.
    fireEvent.change(screen.getByLabelText('Catalog scope'), {
      target: { value: 'all' },
    })
    const restNav = screen.getByRole('navigation', {
      name: 'GitHub API operation pages',
    })
    fireEvent.click(within(restNav).getByRole('button', { name: 'Next page' }))
    assert.ok(within(restNav).getByText('Page 2 of 25'))

    fireEvent.click(screen.getByRole('tab', { name: 'GraphQL' }))
    const nav = screen.getByRole('navigation', {
      name: 'GitHub GraphQL root operation pages',
    })
    // 31 queries + 268 mutations = 299 roots across 6 pages of 50.
    assert.ok(within(nav).getByText('Page 1 of 6'))
    assert.ok(screen.getByText('Showing 1–50 of 299'))
    assert.equal(
      within(
        screen.getByRole('list', { name: 'GitHub GraphQL root operations' })
      ).getAllByRole('listitem').length,
      GitHubAPIExplorerDefaultPageSize
    )

    const graphQLLast = within(nav).getByRole('button', { name: 'Last page' })
    fireEvent.click(graphQLLast)
    assert.ok(within(nav).getByText('Page 6 of 6'))
    assert.ok(screen.getByText('Showing 251–299 of 299'))
    assert.equal(graphQLLast.getAttribute('aria-disabled'), 'true')
    assert.equal(
      within(nav)
        .getByRole('button', { name: 'Next page' })
        .getAttribute('aria-disabled'),
      'true'
    )

    // Changing the GraphQL page size resets GraphQL to page 1...
    fireEvent.change(screen.getByLabelText('Roots per page'), {
      target: { value: '100' },
    })
    assert.ok(within(nav).getByText('Page 1 of 3'))
    assert.ok(screen.getByText('Showing 1–100 of 299'))

    // ...while the REST catalog kept its own independent page-2 position.
    fireEvent.click(screen.getByRole('tab', { name: 'REST' }))
    assert.ok(
      within(
        screen.getByRole('navigation', { name: 'GitHub API operation pages' })
      ).getByText('Page 2 of 25')
    )
  })

  it('uses only the repository-bound GitHub account', () => {
    const sameHostAccount = account('other-user', 99)
    const client = new FakeExplorerClient()
    let catalogResolutionCount = 0
    render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[sameHostAccount]}
        client={client}
        catalogResolver={endpoint => {
          catalogResolutionCount++
          return resolveGitHubAPIOperationCatalog(endpoint)
        }}
      />
    )

    assert.ok(screen.getByRole('heading', { name: 'Sign in required' }))
    assert.ok(screen.getByText(/never falls back to another account/))
    assert.equal(screen.queryByRole('button', { name: 'Run request' }), null)
    assert.equal(client.calls.length, 0)
    assert.equal(catalogResolutionCount, 0)
  })

  it('shows the GHEC catalog without leaking GitHub.com-only operations', () => {
    const ghecAccount = account(
      'enterprise-bot',
      43,
      'github',
      'https://api.acme.ghe.com'
    )
    render(
      <GitHubAPIExplorer
        repository={repository(ghecAccount)}
        accounts={[ghecAccount]}
        client={new FakeExplorerClient()}
      />
    )

    assert.ok(
      screen.getByText(
        /GitHub Enterprise Cloud REST API 2026-03-10 · 1,446 operations/
      )
    )
    assert.equal(
      (screen.getByLabelText('Catalog scope') as HTMLSelectElement).value,
      'all'
    )
    fireEvent.change(screen.getByLabelText('Search operations'), {
      target: { value: 'actions/create-hosted-runner-for-enterprise' },
    })
    const list = screen.getByRole('list', { name: 'GitHub API operations' })
    assert.equal(within(list).getAllByRole('listitem').length, 1)
    assert.match(
      list.textContent ?? '',
      /actions\/create-hosted-runner-for-enterprise/
    )
  })

  it('fails closed for unknown GHES versions but keeps the manual builder', () => {
    const ghesAccount = account(
      'server-bot',
      44,
      'github',
      'https://github.enterprise.test/api/v3'
    )
    render(
      <GitHubAPIExplorer
        repository={repository(ghesAccount)}
        accounts={[ghesAccount]}
        client={new FakeExplorerClient()}
        catalogResolver={endpoint =>
          resolveGitHubAPIOperationCatalog(endpoint, () => null)
        }
      />
    )

    assert.ok(
      screen.getByRole('heading', { name: 'Operation catalog unavailable' })
    )
    assert.ok(screen.getByText('GitHub Enterprise Server version unknown'))
    assert.ok(screen.getByText(/No GitHub.com operation is substituted/))
    assert.equal(
      screen.queryByRole('list', { name: 'GitHub API operations' }),
      null
    )
    assert.ok(screen.getByLabelText('REST API path'))
    assert.ok(screen.getByRole('button', { name: 'Run request' }))
  })

  it('shows the exact GHES 3.21 catalog when that server version is known', () => {
    const ghesAccount = account(
      'server-bot',
      45,
      'github',
      'https://github.enterprise.test/api/v3'
    )
    render(
      <GitHubAPIExplorer
        repository={repository(ghesAccount)}
        accounts={[ghesAccount]}
        client={new FakeExplorerClient()}
        catalogResolver={endpoint =>
          resolveGitHubAPIOperationCatalog(
            endpoint,
            () => new semver.SemVer('3.21.7')
          )
        }
      />
    )

    assert.ok(
      screen.getByText(
        /GitHub Enterprise Server 3.21 REST API 2026-03-10 · 1,092 operations/
      )
    )
    fireEvent.change(screen.getByLabelText('Search operations'), {
      target: { value: 'enterprise-admin/create-global-webhook' },
    })
    const list = screen.getByRole('list', { name: 'GitHub API operations' })
    assert.equal(within(list).getAllByRole('listitem').length, 1)
    assert.match(
      list.textContent ?? '',
      /enterprise-admin\/create-global-webhook/
    )
  })

  it('searches GraphQL roots and generates an editable exact-signature template', () => {
    render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[selectedAccount]}
        client={new FakeExplorerClient()}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'GraphQL' }))
    assert.ok(
      screen.getByText(
        /GitHub.com · schema 2026-07-16 · 31 queries · 268 mutations/
      )
    )
    fireEvent.change(screen.getByLabelText('Root kind'), {
      target: { value: 'query' },
    })
    let list = screen.getByRole('list', {
      name: 'GitHub GraphQL root operations',
    })
    assert.equal(within(list).getAllByRole('listitem').length, 31)

    fireEvent.change(screen.getByLabelText('Search GraphQL roots'), {
      target: { value: 'repository owner String!' },
    })
    list = screen.getByRole('list', {
      name: 'GitHub GraphQL root operations',
    })
    const operation = within(list).getByRole('button', {
      name: 'query repository, returns Repository',
    })
    fireEvent.click(operation)
    assert.equal(operation.getAttribute('aria-pressed'), 'true')
    assert.match(
      (screen.getByLabelText('GraphQL query') as HTMLTextAreaElement).value,
      /query Repository\([\s\S]*\$owner: String![\s\S]*repository\([\s\S]*__typename/
    )
    assert.equal(
      (screen.getByLabelText('GraphQL variables') as HTMLTextAreaElement).value,
      '{}'
    )
    assert.equal(
      (
        screen.getByLabelText(
          'GraphQL operation name (optional)'
        ) as HTMLInputElement
      ).value,
      'Repository'
    )
    assert.ok(screen.getByText('Root signature and product provenance'))
    assert.ok(screen.getByRole('link', { name: 'Official product schema' }))

    fireEvent.change(screen.getByLabelText('Root kind'), {
      target: { value: 'mutation' },
    })
    fireEvent.change(screen.getByLabelText('Search GraphQL roots'), {
      target: { value: 'updateRepository' },
    })
    const mutation = screen.getByRole('button', {
      name: 'mutation updateRepository, returns UpdateRepositoryPayload',
    })
    fireEvent.click(mutation)
    assert.match(
      (screen.getByLabelText('GraphQL query') as HTMLTextAreaElement).value,
      /^mutation UpdateRepository\(/
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
    assert.ok(
      screen.getByRole('heading', { name: 'Review GitHub API mutation' })
    )
  })

  it('keeps manual GraphQL available when a GHES schema cannot be selected', () => {
    const ghesAccount = account(
      'server-graphql-bot',
      46,
      'github',
      'https://graphql.enterprise.test/api/v3'
    )
    render(
      <GitHubAPIExplorer
        repository={repository(ghesAccount)}
        accounts={[ghesAccount]}
        client={new FakeExplorerClient()}
        graphQLCatalogResolver={endpoint =>
          resolveGitHubGraphQLOperationCatalog(endpoint, () => null)
        }
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'GraphQL' }))
    assert.ok(
      screen.getByRole('heading', {
        name: 'GraphQL root schema unavailable',
      })
    )
    assert.ok(screen.getByText(/manual GraphQL builder remains available/))
    assert.equal(
      screen.queryByRole('list', {
        name: 'GitHub GraphQL root operations',
      }),
      null
    )
    assert.ok(screen.getByLabelText('GraphQL query'))
    assert.ok(screen.getByRole('button', { name: 'Run request' }))
  })

  it('shows only the pinned GHES 3.21 GraphQL roots for a known server', () => {
    const ghesAccount = account(
      'server-graphql-bot',
      47,
      'github',
      'https://graphql.enterprise.test/api/v3'
    )
    render(
      <GitHubAPIExplorer
        repository={repository(ghesAccount)}
        accounts={[ghesAccount]}
        client={new FakeExplorerClient()}
        graphQLCatalogResolver={endpoint =>
          resolveGitHubGraphQLOperationCatalog(
            endpoint,
            () => new semver.SemVer('3.21.4')
          )
        }
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'GraphQL' }))
    assert.ok(
      screen.getByText(
        /GitHub Enterprise Server 3.21 · schema 2026-07-16 · 24 queries · 236 mutations/
      )
    )
    fireEvent.change(screen.getByLabelText('Search GraphQL roots'), {
      target: { value: 'addEnterpriseAdmin' },
    })
    const list = screen.getByRole('list', {
      name: 'GitHub GraphQL root operations',
    })
    assert.equal(within(list).getAllByRole('listitem').length, 1)
    assert.match(list.textContent ?? '', /mutation:addEnterpriseAdmin/)
  })

  it('executes GET and HEAD directly but reviews REST mutations', async () => {
    const client = new FakeExplorerClient()
    render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[selectedAccount]}
        client={client}
      />
    )

    fireEvent.change(screen.getByLabelText('REST method'), {
      target: { value: 'HEAD' },
    })
    fireEvent.change(screen.getByLabelText('REST API path'), {
      target: { value: 'repos/desktop/material' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
    await waitFor(() => assert.equal(client.calls.length, 1))
    assert.equal(client.calls[0].account, selectedAccount)
    assert.equal(client.calls[0].confirmed, false)
    assert.deepEqual(client.calls[0].request, {
      mode: 'rest',
      method: 'HEAD',
      path: 'repos/desktop/material',
      bodyText: '',
    })

    const responseBody = screen.getByLabelText('GitHub API response body')
    assert.ok(
      (responseBody.textContent ?? '').length <=
        GitHubAPIExplorerResponseCharacterCap
    )
    assert.match(responseBody.textContent ?? '', /\[redacted\]/)
    assert.doesNotMatch(responseBody.textContent ?? '', /fixture-secret/)
    const headers = screen.getByLabelText('GitHub API response headers')
    assert.match(headers.textContent ?? '', /x-ratelimit-remaining/)
    assert.doesNotMatch(headers.textContent ?? '', /authorization|set-cookie/)
    assert.ok(screen.getByText(/output truncated/))

    fireEvent.change(screen.getByLabelText('REST method'), {
      target: { value: 'DELETE' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
    assert.equal(client.calls.length, 1)
    assert.ok(
      screen.getByRole('heading', { name: 'Review GitHub API mutation' })
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Run reviewed request' })
    )
    await waitFor(() => assert.equal(client.calls.length, 2))
    assert.equal(client.calls[1].confirmed, true)
    assert.equal(client.calls[1].request.mode, 'rest')
    assert.equal(
      client.calls[1].request.mode === 'rest'
        ? client.calls[1].request.method
        : null,
      'DELETE'
    )
  })

  it('runs GraphQL queries and reviews GraphQL mutations with variables and operation name', async () => {
    const client = new FakeExplorerClient()
    render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[selectedAccount]}
        client={client}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'GraphQL' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
    await waitFor(() => assert.equal(client.calls.length, 1))
    assert.equal(client.calls[0].confirmed, false)
    assert.deepEqual(client.calls[0].request, {
      mode: 'graphql',
      query:
        'query RepositoryOverview($owner: String!, $name: String!) {\n' +
        '  repository(owner: $owner, name: $name) {\n' +
        '    id\n' +
        '    nameWithOwner\n' +
        '  }\n' +
        '}',
      variablesText: '{\n  "owner": "desktop",\n  "name": "material"\n}',
      operationName: 'RepositoryOverview',
    })

    const mutation =
      'mutation RenameRepository($repositoryId: ID!, $name: String!) { updateRepository(input: { repositoryId: $repositoryId, name: $name }) { repository { name } } }'
    fireEvent.change(screen.getByLabelText('GraphQL query'), {
      target: { value: mutation },
    })
    fireEvent.change(screen.getByLabelText('GraphQL variables'), {
      target: { value: '{"repositoryId":"R_1","name":"renamed"}' },
    })
    fireEvent.change(
      screen.getByLabelText('GraphQL operation name (optional)'),
      { target: { value: 'RenameRepository' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
    assert.equal(client.calls.length, 1)
    fireEvent.click(
      screen.getByRole('button', { name: 'Run reviewed request' })
    )
    await waitFor(() => assert.equal(client.calls.length, 2))
    assert.equal(client.calls[1].confirmed, true)
    assert.deepEqual(client.calls[1].request, {
      mode: 'graphql',
      query: mutation,
      variablesText: '{"repositoryId":"R_1","name":"renamed"}',
      operationName: 'RenameRepository',
    })
  })

  it('aborts loading requests on repository changes and unmount', () => {
    const client = new FakeExplorerClient(
      call =>
        new Promise((_resolve, reject) => {
          call.signal.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
    )
    const view = render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[selectedAccount]}
        client={client}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
    assert.ok(screen.getByText('Running request…'))
    assert.equal(client.calls[0].signal.aborted, false)

    const nextAccount = account('next-bot', 84)
    const nextRepository = repository(nextAccount, 'octo', 'rocket', 2)
    view.rerender(
      <GitHubAPIExplorer
        repository={nextRepository}
        accounts={[nextAccount]}
        client={client}
      />
    )
    assert.equal(client.calls[0].signal.aborted, true)
    assert.equal(
      (screen.getByLabelText('REST API path') as HTMLInputElement).value,
      'repos/octo/rocket/secret-scanning/custom-patterns'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
    assert.equal(client.calls.length, 2)
    view.unmount()
    assert.equal(client.calls[1].signal.aborted, true)
  })

  it('renders execution errors without exposing a stale response', async () => {
    const client = new FakeExplorerClient(async () => {
      throw new Error('Fixture API failure')
    })
    render(
      <GitHubAPIExplorer
        repository={selectedRepository}
        accounts={[selectedAccount]}
        client={client}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run request' }))
    await waitFor(() =>
      assert.ok(
        screen.getByRole('alert').textContent?.includes('Fixture API failure')
      )
    )
    assert.equal(screen.queryByRole('heading', { name: 'Response' }), null)
  })
})
