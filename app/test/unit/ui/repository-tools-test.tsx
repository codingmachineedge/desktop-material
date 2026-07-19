import { describe, it } from 'node:test'
import assert from 'node:assert'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as React from 'react'
import {
  ICLICommandOutputEvent,
  ICLICommandStateEvent,
  ICLIWorkbenchOperationRequest,
  ICLIWorkbenchRuntime,
} from '../../../src/lib/cli-workbench'
import {
  IRepositoryBundleImportRequest,
  IRepositoryToolsClient,
  prepareRepositoryBundleImport,
  RepositoryBundleImport,
  RepositoryTools,
  isRepositoryToolMutation,
} from '../../../src/ui/repository-tools'
import { Repository, SubmoduleRepository } from '../../../src/models/repository'
import { ITagLifecycleDispatcher } from '../../../src/ui/tag/tag-lifecycle-manager'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'

const runtime: ICLIWorkbenchRuntime = {
  tools: [
    {
      tool: 'git',
      available: true,
      version: 'git version 2.55.0',
      error: null,
    },
    {
      tool: 'gh',
      available: true,
      version: 'gh version 2.80.0',
      error: null,
    },
  ],
}

const uiFixtureRoot = join(tmpdir(), 'desktop-material-repository-tools-ui')
const uiRepositoryPath = join(uiFixtureRoot, 'repo')
const uiFirstRepositoryPath = join(uiFixtureRoot, 'first')
const uiSecondRepositoryPath = join(uiFixtureRoot, 'second')
const uiExportRoot = join(uiFixtureRoot, 'exports')
const uiArchiveDestination = join(uiExportRoot, 'repository-source')
const uiArchivePath = `${uiArchiveDestination}.zip`
const uiBundleDestination = join(uiExportRoot, 'all-history')
const uiBundlePath = `${uiBundleDestination}.bundle`
const uiRepositoryBundlePath = join(uiExportRoot, 'repository.bundle')
const uiOtherBundlePath = join(uiExportRoot, 'other.bundle')

class FakeRepositoryToolsClient implements IRepositoryToolsClient {
  public readonly starts: ICLIWorkbenchOperationRequest[] = []
  public readonly cancels: string[] = []
  private readonly outputHandlers = new Set<
    (event: ICLICommandOutputEvent) => void
  >()
  private readonly stateHandlers = new Set<
    (event: ICLICommandStateEvent) => void
  >()

  public getRuntime = async () => runtime
  public start = async (request: ICLIWorkbenchOperationRequest) => {
    this.starts.push(request)
  }
  public cancel = async (id: string) => {
    this.cancels.push(id)
    return true
  }
  public onOutput = (handler: (event: ICLICommandOutputEvent) => void) => {
    this.outputHandlers.add(handler)
    return () => this.outputHandlers.delete(handler)
  }
  public onState = (handler: (event: ICLICommandStateEvent) => void) => {
    this.stateHandlers.add(handler)
    return () => this.stateHandlers.delete(handler)
  }
  public emitOutput(event: ICLICommandOutputEvent) {
    this.outputHandlers.forEach(handler => handler(event))
  }
  public emitState(event: ICLICommandStateEvent) {
    this.stateHandlers.forEach(handler => handler(event))
  }
}

function renderTools(
  client: FakeRepositoryToolsClient,
  onRefreshRepository = async () => {},
  chooseArchiveDestination?: (
    format: 'zip' | 'tar',
    defaultPath: string
  ) => Promise<string | null>,
  revealArchive?: (path: string) => Promise<void>,
  chooseBundleDestination?: (defaultPath: string) => Promise<string | null>,
  chooseBundleToVerify?: () => Promise<string | null>,
  chooseBundleToImport?: () => Promise<string | null>,
  chooseFileToBlame?: () => Promise<string | null>
) {
  return render(
    <RepositoryTools
      repositoryPath={uiRepositoryPath}
      onRefreshRepository={onRefreshRepository}
      client={client}
      chooseArchiveDestination={chooseArchiveDestination}
      revealArchive={revealArchive}
      chooseBundleDestination={chooseBundleDestination}
      chooseBundleToVerify={chooseBundleToVerify}
      chooseBundleToImport={chooseBundleToImport}
      chooseFileToBlame={chooseFileToBlame}
    />
  )
}

function selectHubTool(id: string) {
  const navigation = screen.getByRole('navigation', {
    name: 'Repository tool list',
  })
  const button = navigation.querySelector<HTMLButtonElement>(
    `[data-hub-tool="${id}"]`
  )
  assert.ok(button, `Expected repository tool ${id}`)
  fireEvent.click(button)
}

function getHubListItems() {
  const navigation = screen.getByRole('navigation', {
    name: 'Repository tool list',
  })
  return Array.from(
    navigation.querySelectorAll<HTMLButtonElement>(
      '.repository-tools-list-item'
    )
  ).map(item => ({
    title:
      item.querySelector('.repository-tools-list-item-title')?.textContent ??
      '',
    category:
      item.querySelector('.repository-tools-list-item-category')?.textContent ??
      '',
  }))
}

function distinctCategorySequence(
  items: ReadonlyArray<{ readonly category: string }>
) {
  return items
    .map(item => item.category)
    .filter(
      (category, index, all) => index === 0 || all[index - 1] !== category
    )
}

function getSelectedToolCard(title: string) {
  const detail = screen.getByRole('region', {
    name: 'Repository tool detail',
  })
  const heading = within(detail).getByRole('heading', { name: title })
  const card = heading.closest('article')
  assert.ok(card, `Expected detail card for ${title}`)
  return card
}

describe('Repository tools', () => {
  it('classifies every direct CLI mutation while retaining read-only recipes', () => {
    for (const id of [
      'maintenance-run',
      'clean-run',
      'bundle-import-fetch-objects',
      'bundle-import-create-branch',
      'history-deepen',
      'history-unshallow',
      'notes-edit',
      'notes-remove',
    ] as const) {
      const operation =
        id === 'bundle-import-fetch-objects'
          ? { id, bundlePath: 'C:/bundle', sourceRef: 'refs/heads/main' }
          : id === 'bundle-import-create-branch'
          ? { id, branchName: 'imported', oid: 'a'.repeat(40) }
          : id === 'history-deepen'
          ? { id, remote: 'origin', deepenBy: 10 }
          : id === 'history-unshallow'
          ? { id, remote: 'origin' }
          : id === 'notes-edit'
          ? { id, oid: 'a'.repeat(40), message: 'note' }
          : id === 'notes-remove'
          ? { id, oid: 'a'.repeat(40) }
          : { id }
      assert.equal(isRepositoryToolMutation(operation), true, id)
    }

    for (const operation of [
      { id: 'status-summary' } as const,
      { id: 'shallow-history-status' } as const,
      { id: 'fetch-remote-list' } as const,
      { id: 'bundle-verify', bundlePath: 'C:/bundle' } as const,
      { id: 'bundle-import-validate-commit', oid: 'a'.repeat(40) } as const,
    ]) {
      assert.equal(isRepositoryToolMutation(operation), false, operation.id)
    }
    assert.equal(
      isRepositoryToolMutation({ id: 'patch-import', patchPaths: [] }),
      true
    )
    assert.equal(
      isRepositoryToolMutation({ id: 'patch-session', operation: 'abort' }),
      true
    )
    assert.equal(
      isRepositoryToolMutation({
        id: 'custom-git-command',
        command: 'status',
        args: ['--short'],
      }),
      true
    )
    assert.equal(
      isRepositoryToolMutation({
        id: 'patch-export',
        destination: 'C:/patches',
      }),
      false
    )
  })

  it('keeps temporary child tools read-only and leaves inspections enabled', async () => {
    const client = new FakeRepositoryToolsClient()
    const parent = new Repository(uiFixtureRoot, 701, null, false)
    const repository = new SubmoduleRepository(
      uiRepositoryPath,
      join(uiFixtureRoot, '.git', 'modules', 'repo'),
      parent,
      {
        name: 'repo',
        path: 'repo',
        url: 'https://example.invalid/repo.git',
        branch: null,
        update: null,
        ignore: null,
        shallow: null,
        fetchRecurseSubmodules: null,
        sha: 'a'.repeat(40),
        describe: null,
        status: 'up-to-date',
      }
    )
    render(
      <RepositoryTools
        repository={repository}
        repositoryPath={repository.path}
        onRefreshRepository={async () => {}}
        client={client}
      />
    )
    await screen.findByText('git version 2.55.0')

    assert.ok(
      screen
        .getAllByRole('status')
        .some(status =>
          /read-only repository tools only/i.test(status.textContent ?? '')
        )
    )

    const statusCard = getSelectedToolCard('Status summary')
    const statusButton = statusCard.querySelector('button') as HTMLButtonElement
    assert.equal(statusButton.disabled, false)
    fireEvent.click(statusButton)
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].operation, { id: 'status-summary' })

    client.emitState({
      id: client.starts[0].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    selectHubTool('maintenance-run')
    const mutationButton = getSelectedToolCard(
      'Run repository maintenance'
    ).querySelector('button') as HTMLButtonElement
    await waitFor(() =>
      assert.equal(mutationButton.getAttribute('aria-disabled'), 'true')
    )
    fireEvent.click(mutationButton)
    assert.equal(client.starts.length, 1)

    selectHubTool('custom-git-presets')
    const customRun = screen.getByRole('button', { name: 'Review run' })
    assert.equal(customRun.getAttribute('aria-disabled'), 'true')
  })

  it('renders a searchable named-function hub without raw command or terminal inputs', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')

    for (const title of [
      'Status summary',
      'Repository health check',
      'Audit recent commit signatures',
      'Branch sync overview',
      'Contributor summary',
      'Describe current version',
      'Audit whitespace and conflict markers',
      'Preview ignored files',
      'Preview maintenance needs',
      'Run repository maintenance',
      'Find fully merged branches',
      'Preview unreachable object pruning',
      'Preview untracked cleanup',
      'Remove untracked files',
      'View commit notes',
      'View recent ref movements',
      'Find unreachable commits',
      'Line authorship',
      'Search tracked content',
      'Edit commit notes',
      'Export repository artifacts',
      'Exchange patch series',
      'Import a branch from a Git bundle',
    ]) {
      assert.ok(screen.getAllByText(title).length >= 1, title)
    }
    assert.ok(screen.getByRole('searchbox', { name: 'Search tools' }))
    assert.equal(screen.queryByRole('textbox'), null)
    assert.equal(screen.queryByText(/command arguments/i), null)
  })

  it('groups the catalog into plain-language categories ordered for everyday work', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')

    // Categories appear in everyday-frequency order; the gated
    // nested-repositories category is absent without submodules or subtrees.
    const items = getHubListItems()
    assert.deepStrictEqual(distinctCategorySequence(items), [
      'Status & branches',
      'Search & inspect',
      'Commits & history',
      'Cleanup & maintenance',
      'Share & transfer',
      'Repair & recovery',
    ])

    // Entries within each category are listed alphabetically by title.
    for (const category of distinctCategorySequence(items)) {
      const titles = items
        .filter(item => item.category === category)
        .map(item => item.title)
      assert.deepStrictEqual(
        titles,
        [...titles].sort((left, right) => left.localeCompare(right, 'en')),
        `${category} entries are alphabetical`
      )
    }

    // The filter chips mirror the same order behind an All chip.
    const chips = screen.getByRole('group', { name: 'Tool categories' })
    assert.deepStrictEqual(
      Array.from(chips.querySelectorAll('.repository-tools-filter-chip')).map(
        chip => chip.textContent
      ),
      [
        'All',
        'Status & branches',
        'Search & inspect',
        'Commits & history',
        'Cleanup & maintenance',
        'Share & transfer',
        'Repair & recovery',
      ]
    )

    // Each detail-pane category header carries a one-line subtitle.
    const detail = screen.getByRole('region', {
      name: 'Repository tool detail',
    })
    assert.equal(
      detail.querySelector('.repository-tools-category-subtitle')?.textContent,
      'Everyday questions about your working copy and how your branches line up.'
    )
  })

  it('slots the gated nested-repository managers into their own category', async () => {
    const client = new FakeRepositoryToolsClient()
    render(
      <RepositoryTools
        repositoryPath={uiRepositoryPath}
        onRefreshRepository={async () => {}}
        client={client}
        submoduleCount={2}
        onOpenSubmoduleManager={() => {}}
        subtreeCount={1}
        onOpenSubtreeManager={() => {}}
      />
    )
    await screen.findByText('git version 2.55.0')

    const items = getHubListItems()
    assert.deepStrictEqual(
      items
        .filter(item => item.category === 'Nested repositories')
        .map(item => item.title),
      ['Submodule manager', 'Subtree manager']
    )
    assert.deepStrictEqual(distinctCategorySequence(items), [
      'Status & branches',
      'Search & inspect',
      'Commits & history',
      'Nested repositories',
      'Cleanup & maintenance',
      'Share & transfer',
      'Repair & recovery',
    ])
    assert.ok(
      within(screen.getByRole('group', { name: 'Tool categories' })).getByRole(
        'button',
        { name: 'Nested repositories' }
      )
    )
  })

  it('lists the subtree manager for any git repository even with no subtrees', async () => {
    const client = new FakeRepositoryToolsClient()
    render(
      <RepositoryTools
        repositoryPath={uiRepositoryPath}
        onRefreshRepository={async () => {}}
        client={client}
        subtreeCount={0}
        onOpenSubtreeManager={() => {}}
      />
    )
    await screen.findByText('git version 2.55.0')

    const items = getHubListItems()
    // The subtree manager appears despite the zero count; the submodule
    // manager stays hidden because no submodule wiring was supplied.
    assert.deepStrictEqual(
      items
        .filter(item => item.category === 'Nested repositories')
        .map(item => item.title),
      ['Subtree manager']
    )
    assert.ok(
      within(screen.getByRole('group', { name: 'Tool categories' })).getByRole(
        'button',
        { name: 'Nested repositories' }
      )
    )
  })

  it('matches catalog search across title, description, and category', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')

    const searchbox = screen.getByRole('searchbox', { name: 'Search tools' })
    const listedIds = () => {
      const navigation = screen.getByRole('navigation', {
        name: 'Repository tool list',
      })
      return Array.from(
        navigation.querySelectorAll<HTMLButtonElement>('[data-hub-tool]')
      ).map(button => button.dataset.hubTool)
    }

    // Title match.
    fireEvent.change(searchbox, { target: { value: 'Line authorship' } })
    assert.ok(listedIds().includes('line-authorship'))

    // Description-only match ("corruption" appears in no title or category).
    fireEvent.change(searchbox, { target: { value: 'corruption' } })
    assert.ok(listedIds().includes('repository-health'))

    // Category-only match keeps every entry of that category listed.
    fireEvent.change(searchbox, { target: { value: 'transfer' } })
    const transferMatches = listedIds()
    assert.ok(transferMatches.includes('export-artifacts'))
    assert.ok(transferMatches.includes('bundle-import'))
    assert.ok(transferMatches.includes('patch-series'))
  })

  it('discovers the typed tag lifecycle manager when dispatcher wiring exists', async () => {
    const client = new FakeRepositoryToolsClient()
    const tagDispatcher: ITagLifecycleDispatcher = {
      getTagLifecycleInventory: async () => ({
        local: [],
        remote: null,
        remoteName: null,
        localTruncated: false,
        remoteTruncated: false,
        signingConfigured: false,
        signingFormat: 'openpgp',
      }),
      createLifecycleTag: async () => true,
      moveLifecycleTag: async () => true,
      deleteReviewedLifecycleTag: async () => true,
      pushLifecycleTags: async () => true,
      fetchLifecycleTags: async () => true,
      deleteRemoteLifecycleTag: async () => true,
    }
    render(
      <RepositoryTools
        repository={new Repository(uiRepositoryPath, 91, null, false)}
        repositoryPath={uiRepositoryPath}
        onRefreshRepository={async () => undefined}
        client={client}
        tagLifecycleDispatcher={tagDispatcher}
      />
    )
    await screen.findByText('git version 2.55.0')
    selectHubTool('tag-lifecycle')
    await screen.findByRole('heading', { name: 'Tag lifecycle' })
    assert.ok(screen.getByRole('button', { name: 'Create local tag' }))
    assert.equal(screen.queryByRole('textbox', { name: /command/i }), null)
  })

  it('mounts custom Git presets with the guarded workbench client', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')
    selectHubTool('custom-git-presets')
    assert.ok(
      screen.getByRole('heading', { name: 'Custom Git command presets' })
    )
    assert.ok(screen.getByRole('button', { name: 'Review run' }))
    assert.equal(screen.queryByLabelText(/executable/i), null)
  })

  it('runs a status summary through its fixed recipe', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')

    const card = getSelectedToolCard('Status summary')
    fireEvent.click(card.querySelector('button') as HTMLButtonElement)
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0], {
      id: client.starts[0].id,
      operation: { id: 'status-summary' },
      repositoryPath: uiRepositoryPath,
      confirmed: false,
    })
    assert.equal('args' in client.starts[0], false)
    assert.equal('tool' in client.starts[0], false)
  })

  it('keeps reflog inspection non-mutating and shell-free', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')

    selectHubTool('reflog-view')
    const card = getSelectedToolCard('View recent ref movements')
    fireEvent.click(card.querySelector('button') as HTMLButtonElement)
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].operation, { id: 'reflog-view' })
    assert.equal(client.starts[0].confirmed, false)
  })

  it('requires an explicit maintenance confirmation and refreshes on success', async () => {
    const client = new FakeRepositoryToolsClient()
    let refreshes = 0
    renderTools(client, async () => {
      refreshes++
    })
    await screen.findByText('git version 2.55.0')

    selectHubTool('maintenance-run')
    const maintenanceCard = getSelectedToolCard('Run repository maintenance')
    fireEvent.click(
      maintenanceCard.querySelector('button') as HTMLButtonElement
    )
    assert.equal(client.starts.length, 0)
    assert.ok(screen.getByRole('alertdialog'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm maintenance' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].operation, {
      id: 'maintenance-run',
    })
    assert.equal(client.starts[0].confirmed, true)

    const id = client.starts[0].id
    client.emitState({
      id,
      state: 'running',
      exitCode: null,
      signal: null,
    })
    client.emitOutput({ id, stream: 'stdout', data: 'maintenance complete\n' })
    client.emitState({
      id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(refreshes, 1))
    assert.match(
      screen.getByLabelText('Repository tool results').textContent ?? '',
      /maintenance complete/
    )
  })

  it('runs the new read-only Git functions through their fixed recipes', async () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['Branch sync overview', 'branch-overview'],
      ['Contributor summary', 'contributor-summary'],
      ['Describe current version', 'version-describe'],
      ['Audit whitespace and conflict markers', 'whitespace-audit'],
      ['Preview ignored files', 'ignored-files-view'],
      ['Find fully merged branches', 'merged-branch-audit'],
      ['Preview unreachable object pruning', 'prune-preview'],
      ['Preview untracked cleanup', 'clean-preview'],
      ['Find unreachable commits', 'unreachable-commits'],
    ]
    for (const [title, id] of cases) {
      const client = new FakeRepositoryToolsClient()
      const view = renderTools(client)
      await screen.findByText('git version 2.55.0')

      selectHubTool(id)
      const card = getSelectedToolCard(title)
      fireEvent.click(card.querySelector('button') as HTMLButtonElement)
      await waitFor(() => assert.equal(client.starts.length, 1))
      assert.deepStrictEqual(client.starts[0].operation, { id }, title)
      assert.equal(client.starts[0].confirmed, false, title)
      assert.equal(screen.queryByRole('alertdialog'), null, title)
      view.unmount()
    }
  })

  it('deletes untracked files only after its own destructive confirmation', async () => {
    const client = new FakeRepositoryToolsClient()
    let refreshes = 0
    renderTools(client, async () => {
      refreshes++
    })
    await screen.findByText('git version 2.55.0')

    selectHubTool('clean-run')
    const cleanCard = getSelectedToolCard('Remove untracked files')
    fireEvent.click(cleanCard.querySelector('button') as HTMLButtonElement)
    assert.equal(client.starts.length, 0)

    const confirmation = screen.getByRole('alertdialog')
    assert.match(confirmation.textContent ?? '', /deleted permanently/i)
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
    assert.equal(screen.queryByRole('alertdialog'), null)
    assert.equal(client.starts.length, 0)

    fireEvent.click(cleanCard.querySelector('button') as HTMLButtonElement)
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete untracked files' })
    )
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].operation, { id: 'clean-run' })
    assert.equal(client.starts[0].confirmed, true)

    client.emitState({
      id: client.starts[0].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(refreshes, 1))
  })

  it('shows line authorship only for one contained picked file', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(
      client,
      async () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => join(uiRepositoryPath, 'src', 'lib', 'app.tsx')
    )
    await screen.findByText('git version 2.55.0')

    selectHubTool('line-authorship')
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file…' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].operation, {
      id: 'file-blame',
      path: 'src/lib/app.tsx',
    })
    assert.equal(client.starts[0].confirmed, false)
    assert.equal(screen.queryByRole('alertdialog'), null)
  })

  it('rejects a picked authorship file outside the repository', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(
      client,
      async () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => join(uiFixtureRoot, 'unrelated', 'outside.ts')
    )
    await screen.findByText('git version 2.55.0')

    selectHubTool('line-authorship')
    fireEvent.click(screen.getByRole('button', { name: 'Choose a file…' }))
    await screen.findByText('Choose a file inside this repository.')
    assert.equal(client.starts.length, 0)
  })

  it('searches tracked content and reports a matchless run as complete', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')

    selectHubTool('content-search')
    assert.equal(screen.queryByRole('textbox'), null)
    fireEvent.click(
      screen.getByRole('button', { name: 'Start content search' })
    )
    fireEvent.change(screen.getByLabelText('Search tracked files for'), {
      target: { value: 'TODO: revisit' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].operation, {
      id: 'content-search',
      pattern: 'TODO: revisit',
    })
    assert.equal(client.starts[0].confirmed, false)

    const id = client.starts[0].id
    client.emitState({ id, state: 'running', exitCode: null, signal: null })
    client.emitState({ id, state: 'failed', exitCode: 1, signal: null })
    await screen.findByText('No tracked file contains the search text.')
    assert.match(
      screen.getByRole('status').textContent ?? '',
      /Status: completed/
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))
    assert.equal(screen.queryByRole('textbox'), null)
  })

  it('scopes content search to one validated revision', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')

    selectHubTool('content-search')
    fireEvent.click(
      screen.getByRole('button', { name: 'Start content search' })
    )
    fireEvent.change(screen.getByLabelText('Search tracked files for'), {
      target: { value: 'render()' },
    })
    fireEvent.change(screen.getByLabelText('At revision (optional)'), {
      target: { value: 'release/2.0' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].operation, {
      id: 'content-search',
      pattern: 'render()',
      ref: 'release/2.0',
    })

    client.emitState({
      id: client.starts[0].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() =>
      assert.match(
        screen.getByRole('status').textContent ?? '',
        /Status: completed/
      )
    )
    fireEvent.change(screen.getByLabelText('At revision (optional)'), {
      target: { value: 'main..dev' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await screen.findByText(
      'Enter one branch, tag, HEAD, or commit ID without ranges or options.'
    )
    assert.equal(client.starts.length, 1)
  })

  it('saves and removes one commit note only after its own review', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')

    selectHubTool('commit-notes')
    fireEvent.click(screen.getByRole('button', { name: 'Start note editor' }))
    fireEvent.change(screen.getByLabelText('Commit'), {
      target: { value: 'HEAD' },
    })
    fireEvent.change(screen.getByLabelText('Note text'), {
      target: { value: 'Reviewed for release' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review save' }))
    assert.equal(client.starts.length, 0)

    const saveDialog = screen.getByRole('alertdialog')
    assert.match(saveDialog.textContent ?? '', /Save this commit note\?/)
    assert.match(saveDialog.textContent ?? '', /Reviewed for release/)
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].operation, {
      id: 'notes-edit',
      oid: 'HEAD',
      message: 'Reviewed for release',
    })
    assert.equal(client.starts[0].confirmed, true)
    client.emitState({
      id: client.starts[0].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() =>
      assert.match(
        screen.getByRole('status').textContent ?? '',
        /Status: completed/
      )
    )

    fireEvent.click(screen.getByRole('button', { name: 'Review removal' }))
    const removeDialog = screen.getByRole('alertdialog')
    assert.match(removeDialog.textContent ?? '', /Remove this commit note\?/)
    fireEvent.click(screen.getByRole('button', { name: 'Remove note' }))
    await waitFor(() => assert.equal(client.starts.length, 2))
    assert.deepStrictEqual(client.starts[1].operation, {
      id: 'notes-remove',
      oid: 'HEAD',
    })
    assert.equal(client.starts[1].confirmed, true)
  })

  it('rejects an invalid commit note target before review', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')

    selectHubTool('commit-notes')
    fireEvent.click(screen.getByRole('button', { name: 'Start note editor' }))
    fireEvent.change(screen.getByLabelText('Commit'), {
      target: { value: 'not-a-sha' },
    })
    fireEvent.change(screen.getByLabelText('Note text'), {
      target: { value: 'note' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review save' }))
    await screen.findByText(
      'Enter HEAD or a commit ID of 7 to 64 hexadecimal characters.'
    )
    assert.equal(screen.queryByRole('alertdialog'), null)
    assert.equal(client.starts.length, 0)
  })

  it('streams diagnostics into one buffer and cancels the exact run', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')

    selectHubTool('repository-health')
    const card = getSelectedToolCard('Repository health check')
    fireEvent.click(card.querySelector('button') as HTMLButtonElement)
    await waitFor(() => assert.equal(client.starts.length, 1))
    const id = client.starts[0].id
    client.emitState({
      id,
      state: 'running',
      exitCode: null,
      signal: null,
    })
    client.emitOutput({ id, stream: 'stderr', data: 'dangling object\n' })
    assert.match(
      screen.getByLabelText('Repository tool results').textContent ?? '',
      /\[diagnostic\] dangling object/
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.deepStrictEqual(client.cancels, [id]))
  })

  it('exports HEAD through a guided save, confirmation, and reveal flow', async () => {
    const client = new FakeRepositoryToolsClient()
    const choices: Array<{ format: string; defaultPath: string }> = []
    const revealed: string[] = []
    renderTools(
      client,
      async () => {},
      async (format, defaultPath) => {
        choices.push({ format, defaultPath })
        return uiArchiveDestination
      },
      async path => {
        revealed.push(path)
      }
    )
    await screen.findByText('git version 2.55.0')

    selectHubTool('export-artifacts')
    fireEvent.click(screen.getByRole('button', { name: 'Export ZIP' }))
    await screen.findByRole('alertdialog')
    assert.equal(choices.length, 1)
    assert.equal(choices[0].format, 'zip')
    assert.match(choices[0].defaultPath, /repo\.zip$/)
    assert.match(
      screen.getByText(/Destination:/).textContent ?? '',
      /repository-source\.zip/
    )
    assert.equal(client.starts.length, 0)

    fireEvent.click(screen.getByRole('button', { name: 'Export archive' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].operation, {
      id: 'archive-export',
      format: 'zip',
      destination: uiArchivePath,
    })
    assert.equal(client.starts[0].confirmed, true)

    const id = client.starts[0].id
    client.emitState({
      id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await screen.findByRole('button', { name: 'Show in folder' })
    assert.match(
      screen.getByLabelText('Repository tool results').textContent ?? '',
      /repository-source\.zip/
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }))
    await waitFor(() => assert.deepStrictEqual(revealed, [uiArchivePath]))
  })

  it('exports all local refs through a guided full-history bundle flow', async () => {
    const client = new FakeRepositoryToolsClient()
    const defaults: string[] = []
    renderTools(
      client,
      async () => {},
      undefined,
      undefined,
      async defaultPath => {
        defaults.push(defaultPath)
        return uiBundleDestination
      }
    )
    await screen.findByText('git version 2.55.0')

    selectHubTool('export-artifacts')
    fireEvent.click(
      screen.getByRole('button', { name: 'Export full-history bundle' })
    )
    await screen.findByRole('alertdialog')
    assert.match(defaults[0], /repo\.bundle$/)
    assert.match(
      screen.getByText(/Destination:/).textContent ?? '',
      /all-history\.bundle/
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export bundle' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].operation, {
      id: 'bundle-export',
      destination: uiBundlePath,
    })
    assert.equal(client.starts[0].confirmed, true)
  })

  it('verifies a selected bundle without confirmation or mutation', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(
      client,
      async () => {},
      undefined,
      undefined,
      undefined,
      async () => uiRepositoryBundlePath
    )
    await screen.findByText('git version 2.55.0')
    selectHubTool('export-artifacts')
    fireEvent.click(screen.getByRole('button', { name: 'Verify a bundle' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].operation, {
      id: 'bundle-verify',
      bundlePath: uiRepositoryBundlePath,
    })
    assert.equal(client.starts[0].confirmed, false)
    assert.equal(screen.queryByRole('alertdialog'), null)
  })

  it('imports one advertised bundle ref through review and mutation-boundary rechecks', async () => {
    const client = new FakeRepositoryToolsClient()
    let refreshes = 0
    const sourceOID = 'a'.repeat(40)
    renderTools(
      client,
      async () => {
        refreshes++
      },
      undefined,
      undefined,
      undefined,
      undefined,
      async () => uiRepositoryBundlePath
    )
    await screen.findByText('git version 2.55.0')

    selectHubTool('bundle-import')
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].operation, {
      id: 'bundle-verify',
      bundlePath: uiRepositoryBundlePath,
    })
    client.emitState({
      id: client.starts[0].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })

    await waitFor(() => assert.equal(client.starts.length, 2))
    assert.deepStrictEqual(client.starts[1].operation, {
      id: 'bundle-list-heads',
      bundlePath: uiRepositoryBundlePath,
    })
    client.emitOutput({
      id: client.starts[1].id,
      stream: 'stdout',
      data: `${sourceOID} refs/heads/main\n${'b'.repeat(40)} refs/tags/v2\n`,
    })
    client.emitState({
      id: client.starts[1].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })

    const source = await screen.findByLabelText('Advertised source ref')
    assert.equal((source as HTMLSelectElement).value, 'refs/heads/main')
    fireEvent.change(screen.getByLabelText('New local branch'), {
      target: { value: 'imported/main' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Review bundle import' })
    )

    await waitFor(() => assert.equal(client.starts.length, 3))
    assert.deepStrictEqual(client.starts[2].operation, {
      id: 'bundle-import-validate-destination',
      branchName: 'imported/main',
    })
    client.emitState({
      id: client.starts[2].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 4))
    assert.deepStrictEqual(client.starts[3].operation, {
      id: 'bundle-import-check-destination',
      branchName: 'imported/main',
    })
    client.emitState({
      id: client.starts[3].id,
      state: 'failed',
      exitCode: 1,
      signal: null,
    })

    const confirmation = await screen.findByRole('alertdialog')
    assert.match(confirmation.textContent ?? '', /refs\/heads\/main/)
    assert.match(confirmation.textContent ?? '', /refs\/heads\/imported\/main/)
    fireEvent.click(
      screen.getByRole('button', { name: 'Import to new branch' })
    )

    await waitFor(() => assert.equal(client.starts.length, 5))
    assert.deepStrictEqual(
      client.starts[4].operation,
      client.starts[0].operation
    )
    client.emitState({
      id: client.starts[4].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 6))
    client.emitOutput({
      id: client.starts[5].id,
      stream: 'stdout',
      data: `${sourceOID} refs/heads/main\n`,
    })
    client.emitState({
      id: client.starts[5].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 7))
    assert.deepStrictEqual(
      client.starts[6].operation,
      client.starts[2].operation
    )
    client.emitState({
      id: client.starts[6].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 8))
    assert.deepStrictEqual(
      client.starts[7].operation,
      client.starts[3].operation
    )
    client.emitState({
      id: client.starts[7].id,
      state: 'failed',
      exitCode: 1,
      signal: null,
    })

    await waitFor(() => assert.equal(client.starts.length, 9))
    assert.deepStrictEqual(client.starts[8].operation, {
      id: 'bundle-import-fetch-objects',
      bundlePath: uiRepositoryBundlePath,
      sourceRef: 'refs/heads/main',
    })
    assert.equal(client.starts[8].confirmed, true)
    client.emitState({
      id: client.starts[8].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })

    await waitFor(() => assert.equal(client.starts.length, 10))
    assert.deepStrictEqual(client.starts[9].operation, {
      id: 'bundle-import-validate-commit',
      oid: sourceOID,
    })
    assert.equal(client.starts[9].confirmed, false)
    client.emitState({
      id: client.starts[9].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })

    await waitFor(() => assert.equal(client.starts.length, 11))
    assert.deepStrictEqual(client.starts[10].operation, {
      id: 'bundle-import-create-branch',
      branchName: 'imported/main',
      oid: sourceOID,
    })
    assert.equal(client.starts[10].confirmed, true)
    client.emitState({
      id: client.starts[10].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })

    await waitFor(() => assert.equal(refreshes, 1))
    assert.ok(
      await screen.findByText('Imported refs/heads/main as imported/main.')
    )
  })

  it('never imports when the destination appears during the final recheck', async () => {
    const client = new FakeRepositoryToolsClient()
    const sourceOID = 'a'.repeat(40)
    renderTools(
      client,
      async () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      async () => uiRepositoryBundlePath
    )
    await screen.findByText('git version 2.55.0')
    selectHubTool('bundle-import')
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
    await waitFor(() => assert.equal(client.starts.length, 1))
    client.emitState({
      id: client.starts[0].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 2))
    client.emitOutput({
      id: client.starts[1].id,
      stream: 'stdout',
      data: `${sourceOID} refs/heads/main\n`,
    })
    client.emitState({
      id: client.starts[1].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await screen.findByLabelText('New local branch')
    fireEvent.change(screen.getByLabelText('New local branch'), {
      target: { value: 'imported/main' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Review bundle import' })
    )
    await waitFor(() => assert.equal(client.starts.length, 3))
    client.emitState({
      id: client.starts[2].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 4))
    client.emitState({
      id: client.starts[3].id,
      state: 'failed',
      exitCode: 1,
      signal: null,
    })
    await screen.findByRole('alertdialog')
    fireEvent.click(
      screen.getByRole('button', { name: 'Import to new branch' })
    )
    await waitFor(() => assert.equal(client.starts.length, 5))
    client.emitState({
      id: client.starts[4].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 6))
    client.emitOutput({
      id: client.starts[5].id,
      stream: 'stdout',
      data: `${sourceOID} refs/heads/main\n`,
    })
    client.emitState({
      id: client.starts[5].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 7))
    client.emitState({
      id: client.starts[6].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 8))

    client.emitState({
      id: client.starts[7].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await screen.findByText(/already exists.*will not be overwritten/i)
    assert.equal(client.starts.length, 8)
    assert.equal(
      client.starts.some(
        start => start.operation.id === 'bundle-import-fetch-objects'
      ),
      false
    )
    assert.equal(
      client.starts.some(
        start => start.operation.id === 'bundle-import-create-branch'
      ),
      false
    )
  })

  it('drops a delayed bundle picker result after the repository changes', async () => {
    const client = new FakeRepositoryToolsClient()
    let resolvePicker: (value: string | null) => void = () => {}
    let pickerReturned = false
    const picker = new Promise<string | null>(resolve => {
      resolvePicker = resolve
    })
    const chooseBundleToImport = async () => {
      const value = await picker
      pickerReturned = true
      return value
    }
    const renderImport = (repositoryPath: string) => (
      <RepositoryBundleImport
        repositoryPath={repositoryPath}
        disabled={false}
        client={client}
        onRefreshRepository={async () => {}}
        onBusyChanged={() => {}}
        chooseBundleToImport={chooseBundleToImport}
      />
    )
    const view = render(renderImport(uiFirstRepositoryPath))

    fireEvent.click(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
    view.rerender(renderImport(uiSecondRepositoryPath))
    resolvePicker(uiRepositoryBundlePath)

    await waitFor(() => assert.equal(pickerReturned, true))
    assert.equal(client.starts.length, 0)
    assert.ok(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
  })

  it('cancels and resubscribes with the exact client when its identity changes', async () => {
    const firstClient = new FakeRepositoryToolsClient()
    const secondClient = new FakeRepositoryToolsClient()
    const renderImport = (client: FakeRepositoryToolsClient) => (
      <RepositoryBundleImport
        repositoryPath={uiRepositoryPath}
        disabled={false}
        client={client}
        onRefreshRepository={async () => {}}
        onBusyChanged={() => {}}
        chooseBundleToImport={async () => uiRepositoryBundlePath}
      />
    )
    const view = render(renderImport(firstClient))

    fireEvent.click(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
    await waitFor(() => assert.equal(firstClient.starts.length, 1))
    const firstRun = firstClient.starts[0].id

    view.rerender(renderImport(secondClient))
    await waitFor(() => assert.deepStrictEqual(firstClient.cancels, [firstRun]))
    assert.deepStrictEqual(secondClient.cancels, [])
    firstClient.emitState({
      id: firstRun,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    assert.equal(secondClient.starts.length, 0)

    fireEvent.click(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
    await waitFor(() => assert.equal(secondClient.starts.length, 1))
  })

  it('keeps refresh completion scoped to its repository and blocks a second picker', async () => {
    const client = new FakeRepositoryToolsClient()
    const request: IRepositoryBundleImportRequest =
      prepareRepositoryBundleImport(
        uiRepositoryBundlePath,
        { oid: 'a'.repeat(40), ref: 'refs/heads/main' },
        'imported/main'
      )
    let resolveRefresh: () => void = () => {}
    let refreshes = 0
    const refresh = new Promise<void>(resolve => {
      resolveRefresh = resolve
    })
    const onRefreshRepository = () => {
      refreshes++
      return refresh
    }
    const component = React.createRef<RepositoryBundleImport>()
    const renderImport = (repositoryPath: string) => (
      <RepositoryBundleImport
        ref={component}
        repositoryPath={repositoryPath}
        disabled={false}
        client={client}
        onRefreshRepository={onRefreshRepository}
        onBusyChanged={() => {}}
        chooseBundleToImport={async () => uiOtherBundlePath}
      />
    )
    const view = render(renderImport(uiFirstRepositoryPath))
    const mountedComponent = component.current
    assert.ok(mountedComponent)
    mountedComponent.setState({
      phase: 'refreshing',
      bundlePath: request.bundlePath,
      request,
      status: 'Branch created. Refreshing the repository…',
    })
    const refreshCompletion = (
      mountedComponent as unknown as {
        finishRefresh: (
          value: IRepositoryBundleImportRequest,
          repositoryPath: string,
          repositoryGeneration: number
        ) => Promise<void>
      }
    ).finishRefresh(request, uiFirstRepositoryPath, 0)

    await waitFor(() => assert.equal(refreshes, 1))
    const chooseButton = screen.getByRole('button', {
      name: 'Choose another bundle',
    }) as HTMLButtonElement
    assert.equal(chooseButton.getAttribute('aria-disabled'), 'true')
    fireEvent.click(chooseButton)
    assert.equal(client.starts.length, 0)

    view.rerender(renderImport(uiSecondRepositoryPath))
    resolveRefresh()
    await refreshCompletion

    assert.ok(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
    assert.equal(
      screen.queryByText('Imported refs/heads/main as imported/main.'),
      null
    )
  })

  it('cancels the exact active bundle inspection without advancing', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(
      client,
      async () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      async () => uiRepositoryBundlePath
    )
    await screen.findByText('git version 2.55.0')
    selectHubTool('bundle-import')
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
    await waitFor(() => assert.equal(client.starts.length, 1))
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel bundle operation' })
    )
    await waitFor(() =>
      assert.deepStrictEqual(client.cancels, [client.starts[0].id])
    )
    client.emitState({
      id: client.starts[0].id,
      state: 'cancelled',
      exitCode: null,
      signal: 'SIGTERM',
    })
    await screen.findByText(
      'Bundle operation cancelled. No local branch was created.'
    )
    assert.equal(client.starts.length, 1)
  })
})
