import assert from 'node:assert'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import * as React from 'react'

import {
  createNamedAPIFunctionBinding,
  createNamedAPIFunctionDefinition,
  INamedAPIFunctionDefinition,
  INamedAPIFunctionDraft,
} from '../../../src/lib/named-api-functions'
import {
  GitHubAPIWorkbenchRequest,
  IGitHubAPIWorkbenchResponse,
} from '../../../src/lib/github-api-workbench'
import { Account, getAccountKey } from '../../../src/models/account'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import {
  GitHubAPIExplorer,
  IGitHubAPIFunctionRegistry,
  IGitHubAPIExplorerClient,
} from '../../../src/ui/github-api-explorer'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'

const response: IGitHubAPIWorkbenchResponse = {
  status: 200,
  statusText: 'OK',
  headers: {},
  body: { ok: true },
  contentType: 'application/json',
  displayedBytes: 11,
  truncated: false,
}

class FunctionRegistry implements IGitHubAPIFunctionRegistry {
  public functions: INamedAPIFunctionDefinition[] = []
  private readonly listeners = new Set<
    (functions: ReadonlyArray<INamedAPIFunctionDefinition>) => void
  >()

  public getNamedAPIFunctions = () => this.functions

  public saveNamedAPIFunction = (draft: INamedAPIFunctionDraft) => {
    const existing = this.functions.find(value => value.id === draft.id)
    const definition = createNamedAPIFunctionDefinition(draft, existing)
    this.functions = [
      ...this.functions.filter(value => value.id !== definition.id),
      definition,
    ]
    this.emit()
    return definition
  }

  public removeNamedAPIFunction = (id: string) => {
    const next = this.functions.filter(value => value.id !== id)
    const removed = next.length !== this.functions.length
    this.functions = next
    if (removed) {
      this.emit()
    }
    return removed
  }

  public onNamedAPIFunctionsChanged = (
    listener: (functions: ReadonlyArray<INamedAPIFunctionDefinition>) => void
  ) => {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  public replaceFromProfile(functions: INamedAPIFunctionDefinition[]) {
    this.functions = functions
    this.emit()
  }

  private emit() {
    this.listeners.forEach(listener => listener(this.functions))
  }
}

class ExplorerClient implements IGitHubAPIExplorerClient {
  public readonly calls: Array<{
    readonly request: GitHubAPIWorkbenchRequest
    readonly confirmed: boolean
  }> = []

  public execute = async (
    _account: Account,
    request: GitHubAPIWorkbenchRequest,
    confirmed: boolean,
    _signal: AbortSignal
  ) => {
    this.calls.push({ request, confirmed })
    return response
  }
}

const account = new Account(
  'fixture',
  'https://api.github.com',
  'fixture-token-never-persisted',
  [],
  '',
  42,
  'Fixture',
  'free'
)
const repository = new Repository(
  resolve('github-api-function-ui'),
  1,
  new GitHubRepository(
    'material',
    new Owner('desktop', account.endpoint, 1),
    1
  ),
  false,
  null,
  {},
  false,
  undefined,
  getAccountKey(account)
)

describe('GitHub API Explorer app functions', () => {
  it('refreshes immediately when a restored profile publishes a new catalog', async () => {
    const registry = new FunctionRegistry()
    render(
      <GitHubAPIExplorer
        repository={repository}
        accounts={[account]}
        functionRegistry={registry}
      />
    )

    const restored = createNamedAPIFunctionDefinition({
      name: 'restored_patterns',
      description: 'Restored from profile history.',
      operationId: 'secret-scanning/list-repo-custom-patterns',
      binding: createNamedAPIFunctionBinding(repository, account),
      request: {
        mode: 'rest',
        method: 'GET',
        path: 'repos/desktop/material/secret-scanning/custom-patterns',
        bodyText: '',
      },
    })
    registry.replaceFromProfile([restored])

    await waitFor(() => assert.ok(screen.getByText('restored_patterns')))
  })

  it('adds, invokes, updates, and removes a read function', async () => {
    const registry = new FunctionRegistry()
    const client = new ExplorerClient()
    render(
      <GitHubAPIExplorer
        repository={repository}
        accounts={[account]}
        client={client}
        functionRegistry={registry}
      />
    )

    fireEvent.change(screen.getByLabelText('Function name'), {
      target: { value: 'list_patterns' },
    })
    fireEvent.change(screen.getByLabelText('Function description'), {
      target: { value: 'List custom secret scanning patterns.' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Add current request as function' })
    )
    await waitFor(() => assert.equal(registry.functions.length, 1))
    assert.equal(registry.functions[0].risk, 'read')
    assert.doesNotMatch(
      JSON.stringify(registry.functions[0]),
      /fixture-token-never-persisted/
    )

    const list = screen.getByRole('list', { name: 'Named API functions' })
    assert.ok(within(list).getByText('list_patterns'))
    fireEvent.click(within(list).getByRole('button', { name: 'Run function' }))
    await waitFor(() => assert.equal(client.calls.length, 1))
    assert.deepEqual(client.calls[0], {
      request: {
        mode: 'rest',
        method: 'GET',
        path: 'repos/desktop/material/secret-scanning/custom-patterns',
        bodyText: '',
      },
      confirmed: false,
    })

    fireEvent.click(within(list).getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Function description'), {
      target: { value: 'Updated description.' },
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Update function from current request',
      })
    )
    await waitFor(() =>
      assert.equal(registry.functions[0].description, 'Updated description.')
    )

    fireEvent.click(within(list).getByRole('button', { name: 'Remove' }))
    await waitFor(() => assert.equal(registry.functions.length, 0))
    assert.equal(
      screen.queryByRole('list', { name: 'Named API functions' }),
      null
    )
  })

  it('routes mutation functions through the existing interactive review', async () => {
    const registry = new FunctionRegistry()
    const client = new ExplorerClient()
    render(
      <GitHubAPIExplorer
        repository={repository}
        accounts={[account]}
        client={client}
        functionRegistry={registry}
      />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'GraphQL' }))
    fireEvent.change(screen.getByLabelText('GraphQL query'), {
      target: {
        value:
          'mutation RenameRepository($repositoryId: ID!, $name: String!) { updateRepository(input: { repositoryId: $repositoryId, name: $name }) { repository { name } } }',
      },
    })
    fireEvent.change(screen.getByLabelText('GraphQL variables'), {
      target: { value: '{"repositoryId":"R_1","name":"material"}' },
    })
    fireEvent.change(
      screen.getByLabelText('GraphQL operation name (optional)'),
      { target: { value: 'RenameRepository' } }
    )
    fireEvent.change(screen.getByLabelText('Function name'), {
      target: { value: 'rename_repository' },
    })
    fireEvent.change(screen.getByLabelText('Function description'), {
      target: { value: 'Rename the repository.' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Add current request as function' })
    )
    await waitFor(() => assert.equal(registry.functions.length, 1))

    fireEvent.change(screen.getByLabelText('Arguments for rename_repository'), {
      target: { value: '{"repositoryId":"R_1","name":"renamed"}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review function' }))
    assert.equal(client.calls.length, 0)
    assert.ok(
      screen.getByRole('heading', { name: 'Review GitHub API mutation' })
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Run reviewed request' })
    )
    await waitFor(() => assert.equal(client.calls.length, 1))
    assert.equal(client.calls[0].confirmed, true)
  })
})
